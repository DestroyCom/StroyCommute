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
	assert.ok(watch.sent.some((m) => m.itemType === "refreshAlerts"));
	assert.deepStrictEqual(watch.sent.filter((m) => m.itemType === "refreshStop").at(-1), {
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

test("a reply asked under the previous config is dropped, and the new one is asked", async () => {
	const watch = await started();
	const asked = () => watch.sent.filter((m) => m.itemType === "refreshStop").length;
	const before = asked();
	// The user fixes the API key while the first request is in flight.
	for (const item of configItems([STOP])) watch.deliver(item);
	assert.strictEqual(asked(), before + 1);
	watch.deliver({ ...OK, state: "invalidKey" }); // the old request's answer
	watch.advance(1600);
	assert.ok(!watch.screen().includes("Clé API invalide"));
	watch.deliver(OK); // the new one's
	assert.ok(watch.screen().includes("Vers Porte de Clignancourt"));
	watch.restore();
});

test("config requests made while the phone is unreachable don't use up the retries", async () => {
	const watch = await loadWatch();
	watch.advance(10000); // phone side not ready: nothing can be sent
	watch.connect();
	const requests = () => watch.sent.filter((m) => m.itemType === "configResendRequest").length;
	assert.strictEqual(requests(), 1);
	watch.advance(1600); // the config doesn't come: asked again
	assert.strictEqual(requests(), 2);
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

test("the train after one at the platform still vibrates on approach", async () => {
	const watch = await loadWatch();
	watch.connect();
	for (const item of configItems([STOP], "fr", 2)) watch.deliver(item);
	// At the platform now, the next one in 6 min; no fresh reply after.
	watch.deliver({ ...timed(watch, 0, 6), atStop: 1 });
	for (let i = 0; i < 4; i++) {
		watch.advance(60000);
		watch.emit("minutechange"); // the first has left: the second takes over
	}
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
	// Short enough for the round screen's narrow bottom line (Gabbro).
	assert.deepStrictEqual(watch.screen(), ["Aucun arrêt configuré", "Ajoute-en dans l'app Pebble"]);
	watch.press("down"); // nothing to cycle to
	assert.strictEqual(watch.screen()[0], "Aucun arrêt configuré");
	watch.restore();
});

test("the round screen (Gabbro) keeps the text away from the edges", async () => {
	const watch = await started([STOP], { screen: { width: 260, height: 260, round: true } });
	const [banner, , line, , status, , , footer] = watch.root.contents[0].contents;
	assert.ok(banner.top > 0);
	assert.ok(line.left >= 20 && status.top > 120);
	// The bottom of the circle is narrow: a 120 px wide 18 px footer let
	// "Haut / Bas pour changer" and the setup hint run past its right edge
	// (seen on the Gabbro emulator). Smaller font, wider and a bit higher.
	assert.ok(footer.left >= 40 && footer.top <= 216);
	assert.ok(260 - footer.left - footer.right >= 160);
	assert.match(footer.style.font, /^14px/);
	watch.restore();
});

test("a long A->B banner uses the smaller font", async () => {
	const watch = await started([{ ...STOP, destStopRef: "STIF:StopArea:SP:1:", destStopName: "Bourg-la-Reine Centre" }]);
	const banner = watch.root.contents[0].contents[0];
	assert.match(banner.contents[0].style.font, /^bold 14px/);
	watch.restore();
});

const ALERT = {
	itemType: "alertUpdate",
	lineRef: STOP.lineRef,
	lineName: "4",
	alertCount: 1,
	alertText: "Jusqu'au 19 décembre inclus, l'arrêt n'est pas desservi à Saint-Michel (travaux de rénovation)",
};

test("a line no longer watched after a new config loses its traffic info screen", async () => {
	const watch = await started();
	watch.deliver(ALERT);
	for (const item of configItems([])) watch.deliver(item);
	assert.deepStrictEqual(watch.screen(), ["Aucun arrêt configuré", "Ajoute-en dans l'app Pebble"]);
	watch.restore();
});

test("a line with traffic info gets its own screen, and its stops say so", async () => {
	const watch = await started();
	watch.deliver(ALERT);
	assert.ok(watch.screen().includes("Info trafic : 1"));
	watch.press("down");
	// The text takes the whole screen (no cycle hint).
	assert.deepStrictEqual(watch.screen(), ["4", ALERT.alertText]);
	// Disruption over: the screen goes, back to the stop.
	watch.deliver({ ...ALERT, alertCount: 0, alertText: undefined });
	assert.strictEqual(watch.screen()[0], "Réglages");
	watch.restore();
});

test("a line added in the alerts section always has a screen", async () => {
	const watch = await loadWatch();
	watch.connect();
	const items = configItems([]);
	items[0].itemCount = 2;
	items.push({ itemIndex: 1, itemCount: 2, itemType: "configLine", lineRef: "STIF:Line::C01743:", lineName: "RER B" });
	for (const item of items) watch.deliver(item);
	assert.deepStrictEqual(watch.screen().slice(0, 2), ["RER B", "..."]);
	watch.deliver({ itemType: "alertUpdate", lineRef: "STIF:Line::C01743:", lineName: "RER B", alertCount: 0 });
	assert.deepStrictEqual(watch.screen().slice(0, 2), ["RER B", "Pas de perturbation"]);
	watch.restore();
});

test("alerts are asked again every 10 minutes", async () => {
	const watch = await started();
	const asks = () => watch.sent.filter((m) => m.itemType === "refreshAlerts").length;
	const before = asks();
	watch.advance(10 * 60000);
	assert.strictEqual(asks(), before + 1);
	watch.restore();
});

test("with auto-open, one wakeup at the next schedule start, none without", async () => {
	const watch = await loadWatch();
	watch.connect();
	// Every day at 07:30.
	for (const item of configItems([STOP], "fr", 0, { scheduleDaysBitmask: 127, scheduleStartMinutes: 450, autoOpen: 1 })) {
		watch.deliver(item);
	}
	assert.strictEqual(watch.wakeups.size, 1);
	const [wake] = [...watch.wakeups.values()];
	const at = new Date(wake.time);
	assert.deepStrictEqual([at.getHours(), at.getMinutes()], [7, 30]);
	assert.ok(wake.time > watch.now && wake.time - watch.now <= 24 * 3600000);
	// Turned off: the wakeup is cancelled.
	for (const item of configItems([STOP], "fr", 0, { scheduleDaysBitmask: 127, scheduleStartMinutes: 450, autoOpen: 0 })) {
		watch.deliver(item);
	}
	assert.strictEqual(watch.wakeups.size, 0);
	watch.restore();
});

const ALERT2 = {
	itemType: "alertUpdate",
	lineRef: STOP.lineRef,
	lineName: "4",
	alertCount: 2,
	alertText: "Premier message\nSecond message",
	lineColor: "#5291CE",
	lineTextColor: "#FFFFFF",
};

/** Boots on one stop with ALERT2 delivered, on the line's alert screen. */
async function onAlertScreen() {
	const watch = await started();
	watch.deliver(ALERT2);
	watch.press("down");
	return watch;
}

// watch.screen() lists the contents in tree order: banner, ..., footer, body.
test("an alert screen shows one message under the line banner, Select shows the next", async () => {
	const watch = await onAlertScreen();
	assert.deepStrictEqual(watch.screen(), ["4  1/2", "Select : suivante", "Premier message"]);
	assert.strictEqual(watch.bannerColor(), "#5291CE");
	watch.press("select");
	assert.deepStrictEqual(watch.screen(), ["4  2/2", "Select : suivante", "Second message"]);
	watch.press("select");
	assert.strictEqual(watch.screen()[0], "4  1/2");
	watch.restore();
});

test("cached messages from a failed check say they may be out of date", async () => {
	const watch = await started();
	watch.deliver({ ...ALERT2, staleReason: "network" });
	watch.press("down");
	assert.deepStrictEqual(watch.screen(), ["4  1/2", "Info pas à jour", "Premier message"]);
	watch.deliver(ALERT2);
	assert.deepStrictEqual(watch.screen(), ["4  1/2", "Select : suivante", "Premier message"]);
	watch.restore();
});

test("a line's messages sent in parts are all reachable, shown once complete", async () => {
	const watch = await started();
	watch.deliver({ ...ALERT2, alertCount: 3, alertText: "Premier message\nSecond message" });
	// Not complete yet: no alert screen.
	assert.ok(!watch.screen().some((s) => /Info trafic/.test(s)));
	watch.deliver({ itemType: "alertUpdate", lineRef: ALERT2.lineRef, lineName: "4", alertCount: 3, alertPart: 1, alertText: "Troisième message" });
	watch.press("down");
	assert.deepStrictEqual(watch.screen(), ["4  1/3", "Select : suivante", "Premier message"]);
	watch.press("select");
	watch.press("select");
	assert.deepStrictEqual(watch.screen(), ["4  3/3", "Select : suivante", "Troisième message"]);
	// A further part without its first one is ignored.
	watch.deliver({ itemType: "alertUpdate", lineRef: ALERT2.lineRef, lineName: "4", alertCount: 3, alertPart: 1, alertText: "Orphelin" });
	assert.deepStrictEqual(watch.screen(), ["4  3/3", "Select : suivante", "Troisième message"]);
	watch.restore();
});

test("parts out of order or repeated never mix two checks' messages", async () => {
	const watch = await started();
	const part = (n, text) => ({ itemType: "alertUpdate", lineRef: ALERT2.lineRef, lineName: "4", alertCount: 3, alertPart: n, alertText: text });
	const first = { ...ALERT2, alertCount: 3, alertText: "Premier message\nSecond message" };
	// A part skipped: what was gathered is dropped, the late part too.
	watch.deliver(first);
	watch.deliver(part(2, "Hors d'ordre"));
	watch.deliver(part(1, "Troisième message"));
	assert.ok(!watch.screen().some((s) => /Info trafic/.test(s)));
	// A first part again restarts the gathering: no page twice.
	watch.deliver(first);
	watch.deliver(first);
	watch.deliver(part(1, "Troisième message"));
	watch.deliver(part(1, "Troisième message"));
	watch.press("down");
	assert.deepStrictEqual(watch.screen()[0], "4  1/3");
	watch.restore();
});

test("a message too long for the screen goes on more pages, cut at spaces", async () => {
	const watch = await started();
	// Wide glyphs: 40 words of "WWWW" don't fit one page (see watch-sim's measure).
	const text = Array.from({ length: 40 }, (_v, i) => `WWWW${i}`).join(" ");
	watch.deliver({ ...ALERT2, alertCount: 1, alertText: text });
	assert.ok(watch.screen().includes("Info trafic : 1"));
	watch.press("down");
	const banner = watch.screen()[0];
	const total = Number(/1\/(\d+)$/.exec(banner)[1]);
	assert.ok(total > 1);
	const pages = [];
	for (let i = 0; i < total; i++) {
		pages.push(watch.screen()[2]);
		watch.press("select");
	}
	assert.strictEqual(pages.join(" "), text);
	watch.restore();
});

test("a word longer than a line (a long URL) is cut so every part is reachable", async () => {
	for (const screen of [undefined, { width: 260, height: 260, round: true }]) {
		const watch = await started(undefined, screen ? { screen } : undefined);
		const url = `https://www.transilien.com/${"x".repeat(240)}`;
		watch.deliver({ ...ALERT2, alertCount: 1, alertText: url });
		watch.press("down");
		const total = Number(/1\/(\d+)$/.exec(watch.screen()[0])[1]);
		assert.ok(total > 1);
		const pages = [];
		for (let i = 0; i < total; i++) {
			pages.push(watch.screen()[2]);
			watch.press("select");
		}
		// Broken with "\n" where a line ends (Piu doesn't break inside a word).
		assert.strictEqual(pages.join("").replace(/\n/g, ""), url);
		assert.ok(pages.join("").includes("\n"));
		watch.restore();
	}
});

test("leaving the screen or new messages bring the alert back to its first page", async () => {
	const watch = await onAlertScreen();
	watch.press("select");
	watch.press("down");
	watch.press("up");
	assert.strictEqual(watch.screen()[0], "4  1/2");
	watch.press("select");
	watch.deliver({ ...ALERT2, alertCount: 1, alertText: "Nouveau" });
	assert.deepStrictEqual(watch.screen(), ["4", "Nouveau"]);
	watch.restore();
});

test("the same messages sent again keep the page being read", async () => {
	const watch = await onAlertScreen();
	watch.press("select");
	watch.deliver(ALERT2);
	assert.strictEqual(watch.screen()[0], "4  2/2");
	watch.restore();
});

test("Select still refreshes a stop", async () => {
	const watch = await started();
	watch.deliver(ALERT2);
	watch.deliver(OK);
	watch.advance(1600);
	const before = watch.sent.filter((m) => m.itemType === "refreshStop").length;
	watch.press("select");
	assert.strictEqual(watch.sent.filter((m) => m.itemType === "refreshStop").length, before + 1);
	watch.restore();
});

test("stops only: no alert screen, the stop still says Info trafic", async () => {
	const watch = await loadWatch();
	watch.connect();
	for (const item of configItems([STOP], "fr", 0, { screens: 1 })) watch.deliver(item);
	watch.deliver(ALERT);
	assert.ok(watch.screen().includes("Info trafic : 1"));
	watch.press("down");
	assert.strictEqual(watch.screen()[0], "Réglages");
	watch.press("down");
	assert.strictEqual(watch.screen()[0], "4 — Bagneux");
	watch.restore();
});

test("alerts only: every watched line has a screen, no stop screen", async () => {
	const watch = await loadWatch();
	watch.connect();
	for (const item of configItems([STOP], "fr", 0, { screens: 2 })) watch.deliver(item);
	assert.deepStrictEqual(watch.screen().slice(0, 2), ["4", "..."]);
	watch.deliver({ itemType: "alertUpdate", lineRef: STOP.lineRef, lineName: "4", alertCount: 0 });
	assert.deepStrictEqual(watch.screen().slice(0, 2), ["4", "Pas de perturbation"]);
	watch.press("down");
	assert.strictEqual(watch.screen()[0], "Réglages");
	watch.press("down");
	assert.strictEqual(watch.screen()[0], "4");
	watch.restore();
});

test("a config without the screens field shows stops and alerts", async () => {
	const watch = await started();
	watch.deliver(ALERT);
	assert.strictEqual(watch.screen()[0], "4 — Bagneux");
	watch.press("down");
	assert.strictEqual(watch.screen()[0], "4");
	watch.restore();
});

test("a train that took over shows its own mission, not the first one's destination", async () => {
	const watch = await started();
	watch.deliver({ ...timed(watch, 1, 6), mission: "AAAA", mission2: "BBBB", destination: "Robinson" });
	watch.advance(3 * 60000);
	watch.emit("minutechange");
	const screen = watch.screen();
	assert.ok(screen.includes("BBBB"));
	assert.ok(!screen.some((line) => /Robinson|AAAA/.test(line)));
	watch.restore();
});

test("once every known train has left, the screen says so instead of 0 min", async () => {
	const watch = await started();
	watch.deliver(timed(watch, 1, 3));
	watch.deliver({ ...OK, state: "network" }); // later refreshes keep failing
	watch.advance(6 * 60000);
	watch.emit("minutechange");
	const screen = watch.screen();
	assert.ok(screen.includes("Plus de départ connu"));
	assert.ok(!screen.some((line) => /^0 min/.test(line)));
	watch.restore();
});

test("traffic info for a line no longer watched is ignored", async () => {
	const watch = await started();
	watch.deliver({ ...ALERT, lineRef: "STIF:Line::C09999:", lineName: "X" });
	watch.press("down");
	assert.strictEqual(watch.screen()[0], "Réglages");
	watch.restore();
});

test("traffic info that couldn't be fetched isn't shown as no disruption", async () => {
	const watch = await loadWatch();
	watch.connect();
	const items = configItems([]);
	items[0].itemCount = 2;
	items.push({ itemIndex: 1, itemCount: 2, itemType: "configLine", lineRef: "STIF:Line::C01743:", lineName: "RER B" });
	for (const item of items) watch.deliver(item);
	watch.deliver({ itemType: "alertUpdate", lineRef: "STIF:Line::C01743:", lineName: "RER B", alertCount: 0, staleReason: "network" });
	assert.deepStrictEqual(watch.screen().slice(0, 2), ["RER B", "Info trafic indisponible"]);
	watch.restore();
});
