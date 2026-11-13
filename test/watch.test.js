// Watch app (src/embeddedjs/main.js) under a fake Alloy runtime, see
// test/helpers/watch-sim.js.
const test = require("node:test");
const assert = require("node:assert");
const { loadWatch, configItems } = require("./helpers/watch-sim");

const STOP = {
	stopRef: "STIF:StopPoint:Q:1:",
	lineRef: "STIF:Line::C01374:",
	lineName: "4",
	stopName: "Bagneux",
};
const OK = {
	itemType: "departureUpdate",
	stopRef: STOP.stopRef,
	lineRef: STOP.lineRef,
	state: "ok",
	lineName: "4",
	destination: "Porte de Clignancourt",
	minutes: 3,
	minutes2: 9,
	atStop: 0,
	cancelled: 0,
	quotaRemaining: 990,
};

/** Boots the app, connects the phone and loads `stops`. */
async function started(stops = [STOP], options) {
	const watch = await loadWatch(options);
	watch.connect();
	for (const item of configItems(stops)) watch.deliver(item);
	return watch;
}

test("uses a single Message instance", async () => {
	const watch = await loadWatch();
	assert.strictEqual(watch.instances.length, 1);
	watch.restore();
});

test("boots on Loading, asks for the config once the phone is reachable", async () => {
	const watch = await loadWatch();
	assert.deepStrictEqual(watch.screen(), ["Loading..."]);
	assert.deepStrictEqual(watch.sent, []); // phone side not ready yet
	watch.connect();
	assert.deepStrictEqual(watch.sent, [{ itemType: "configResendRequest" }]);
	watch.restore();
});

test("a loaded config shows the stop and asks for its departures", async () => {
	const watch = await started();
	assert.deepStrictEqual(watch.screen(), ["4 — Bagneux", "...", "Haut / Bas pour changer"]);
	assert.strictEqual(watch.bannerColor(), "#BE418D");
	assert.deepStrictEqual(watch.sent.at(-1), {
		itemType: "refreshStop",
		stopRef: STOP.stopRef,
		lineRef: STOP.lineRef,
		lineName: "4",
	});
	watch.restore();
});

test("departures update the screen in place, spinner only while waiting", async () => {
	const watch = await started();
	const contentsBefore = [...watch.root.contents[0].contents];
	watch.deliver(OK);
	assert.match(watch.screen().join("|"), /Vers Porte de Clignancourt\|3 min [-\\|/]\|Puis 9 min/);
	watch.advance(1600); // minimum spinner time
	assert.deepStrictEqual(watch.screen(), [
		"4 — Bagneux",
		"Vers Porte de Clignancourt",
		"3 min",
		"Puis 9 min",
		"Haut / Bas pour changer",
	]);
	// Same Piu contents, only their strings changed.
	assert.deepStrictEqual(watch.root.contents[0].contents, contentsBefore);
	// No spinner timer left running: only the refresh timer and session timer.
	const timers = watch.timerCount;
	watch.advance(5000);
	assert.ok(watch.timerCount <= timers);
	watch.restore();
});

test("a network error keeps the last times, with the reason and their age", async () => {
	const watch = await started();
	watch.deliver(OK);
	watch.advance(2 * 60000);
	watch.deliver({ ...OK, state: "network", minutes: undefined });
	const screen = watch.screen();
	assert.ok(screen.includes("3 min") || screen.some((s) => s.startsWith("3 min")));
	assert.ok(screen.includes("Erreur réseau"));
	assert.ok(screen.includes("Màj il y a 2 min"));
	watch.restore();
});

test("an error state with nothing to fall back on is shown in place of the times", async () => {
	const watch = await started();
	watch.deliver({ ...OK, state: "invalidKey" });
	watch.advance(1600);
	assert.deepStrictEqual(watch.screen(), ["4 — Bagneux", "Clé API invalide", "Haut / Bas pour changer"]);
	watch.restore();
});

test("Down cycles to the settings screen with the quota", async () => {
	const watch = await started();
	watch.deliver(OK);
	watch.press("down");
	assert.deepStrictEqual(watch.screen(), ["Réglages", "Quota PRIM : 990 restant(s)", "Haut / Bas pour changer"]);
	assert.strictEqual(watch.bannerColor(), null);
	watch.press("down"); // wraps back to the stop
	assert.strictEqual(watch.screen()[0], "4 — Bagneux");
	watch.restore();
});

test("an exception in a callback is journaled, sent to the phone, and the app goes on", async () => {
	const watch = await started();
	// A departureUpdate whose destination isn't a string makes the screen
	// code throw (template literal on a Symbol).
	watch.deliver({ ...OK, destination: Symbol("boom") });
	const journal = JSON.parse(watch.storage.get("diagLog") || "[]");
	const sentDiag = watch.sent.filter((m) => m.itemType === "diagReport");
	const entries = journal.length ? journal : JSON.parse(sentDiag.at(-1).diagText);
	assert.strictEqual(entries.at(-1).w, "render");
	assert.match(entries.at(-1).tr, /rx departureUpdate ok/);
	watch.deliver(OK);
	watch.advance(1600);
	assert.ok(watch.screen().includes("3 min"));
	watch.restore();
});

test("a write that can never succeed doesn't block the next ones", async () => {
	const watch = await started();
	watch.deliver(OK);
	watch.advance(1600);
	watch.failNextWrite(new Error("overflow"));
	watch.press("select"); // refreshStop fails for good: dropped, recorded
	watch.press("select");
	const kinds = watch.sent.map((m) => m.itemType);
	assert.ok(kinds.includes("diagReport"));
	assert.strictEqual(kinds.at(-1), "refreshStop");
	watch.restore();
});

test("a launch that stopped during startup is reported at the next one", async () => {
	const storage = new Map([["diagSession", "boot"]]);
	const watch = await started([STOP], { storage });
	const reports = watch.sent.filter((m) => m.itemType === "diagReport");
	assert.strictEqual(reports.length, 1);
	assert.strictEqual(JSON.parse(reports[0].diagText)[0].w, "previousLaunch");
	assert.strictEqual(storage.get("diagSession"), "ready");
	watch.advance(21000);
	assert.strictEqual(storage.get("diagSession"), "ok");
	watch.restore();
});

/** A departureUpdate with departure times `m1`/`m2` minutes from now. */
function timed(watch, m1, m2) {
	const at = (m) => Math.floor((watch.now + m * 60000) / 1000);
	return { ...OK, minutes: m1, minutes2: m2, departTime: at(m1), departTime2: at(m2) };
}

test("the watch counts the minutes down itself between refreshes", async () => {
	const watch = await started();
	watch.deliver(timed(watch, 5, 12));
	watch.advance(2 * 60000);
	watch.emit("minutechange");
	// The spinner may follow: the timer asked for fresh times meanwhile.
	assert.ok(watch.screen().some((line) => /^3 min/.test(line)));
	assert.ok(watch.screen().includes("Puis 10 min"));
	watch.restore();
});

test("once the first train has left, the next one takes its place", async () => {
	const watch = await started();
	watch.deliver(timed(watch, 1, 6));
	watch.advance(3 * 60000);
	watch.emit("minutechange");
	const screen = watch.screen().join("|");
	assert.match(screen, /\|3 min[^|]*\|/); // 6 - 3
	assert.doesNotMatch(screen, /Puis/);
	watch.restore();
});

test("far departures are refreshed every 3 minutes instead of every minute", async () => {
	const watch = await started();
	watch.deliver(timed(watch, 15, 25));
	const refreshes = () => watch.sent.filter((m) => m.itemType === "refreshStop").length;
	const before = refreshes();
	watch.advance(60000);
	assert.strictEqual(refreshes(), before);
	watch.advance(2 * 60000);
	assert.strictEqual(refreshes(), before + 1);
	watch.restore();
});

test("vibrates once when the next departure comes within the setting", async () => {
	const watch = await loadWatch();
	watch.connect();
	for (const item of configItems([STOP], "fr", 2)) watch.deliver(item);
	watch.deliver(timed(watch, 4, 12));
	watch.advance(60000);
	watch.emit("minutechange"); // 3 min: nothing yet
	assert.deepStrictEqual(watch.vibrations, []);
	watch.advance(60000);
	watch.emit("minutechange"); // 2 min
	watch.advance(60000);
	watch.emit("minutechange"); // 1 min: no second vibration
	assert.deepStrictEqual(watch.vibrations, ["double"]);
	watch.restore();
});

test("no vibration for a train already that close when the screen opens", async () => {
	const watch = await loadWatch();
	watch.connect();
	for (const item of configItems([STOP], "fr", 3)) watch.deliver(item);
	watch.deliver(timed(watch, 2, 9));
	watch.emit("minutechange");
	assert.deepStrictEqual(watch.vibrations, []);
	watch.restore();
});

test("says when the phone is disconnected, keeping the last times", async () => {
	const watch = await started();
	watch.deliver(timed(watch, 5, 12));
	watch.advance(1600);
	watch.setPhoneConnected(false);
	assert.ok(watch.screen().includes("Téléphone déconnecté"));
	assert.ok(watch.screen().includes("5 min"));
	const before = watch.sent.length;
	watch.setPhoneConnected(true);
	assert.ok(!watch.screen().includes("Téléphone déconnecté"));
	watch.advance(60000);
	assert.ok(watch.sent.length >= before);
	watch.restore();
});

test("with nothing configured, the screen says so and where to fix it", async () => {
	const watch = await started([]);
	assert.deepStrictEqual(watch.screen(), ["Aucun arrêt configuré", "Ajoute des arrêts dans l'app Pebble"]);
	watch.press("down"); // nothing to cycle to
	assert.strictEqual(watch.screen()[0], "Aucun arrêt configuré");
	watch.restore();
});

test("the round screen (Gabbro) keeps the text away from the edges", async () => {
	const watch = await started([STOP], { screen: { width: 260, height: 260, round: true } });
	const [banner, , line, , status, , , footer] = watch.root.contents[0].contents;
	assert.ok(banner.top > 0);
	assert.ok(line.left >= 20 && status.top > 120);
	assert.ok(footer.left >= 60);
	watch.restore();
});

test("a long A->B banner uses the smaller font", async () => {
	const watch = await started([{ ...STOP, destStopRef: "STIF:StopArea:SP:1:", destStopName: "Bourg-la-Reine Centre" }]);
	const banner = watch.root.contents[0].contents[0];
	assert.match(banner.contents[0].style.font, /^bold 14px/);
	watch.restore();
});
