// Phone side (src/pkjs/index.js) under a fake PebbleKit JS runtime, see
// test/helpers/phone-sim.js.
const test = require("node:test");
const assert = require("node:assert");
const { loadPhone, siriAnswer } = require("./helpers/phone-sim");

const STOP = {
	stopRef: "STIF:StopPoint:Q:1:",
	lineRef: "STIF:Line::C01374:",
	lineName: "4",
	stopName: "Bagneux",
};
const CONFIG = {
	apiKey: "key",
	trackedStops: [STOP],
	trackedLines: [],
	alertSchedule: { days: [1], startTime: "07:00", endTime: "19:30" },
	callGuard: { maxCalls: 40, windowMinutes: 10, pauseMinutes: 15 },
	language: "fr",
};
const REFRESH = { itemType: "refreshStop", stopRef: STOP.stopRef, lineRef: STOP.lineRef, lineName: "4" };

function withConfig(options = {}) {
	const storage = new Map([["stroycommuteConfig", JSON.stringify(CONFIG)]]);
	return loadPhone({ storage, ...options });
}

const updates = (phone) => phone.sent.filter((m) => m.itemType === "departureUpdate");

test("a refresh asked twice while in flight makes one PRIM call and two replies", () => {
	const phone = withConfig();
	phone.fromWatch(REFRESH);
	phone.fromWatch(REFRESH);
	assert.strictEqual(phone.requests.length, 1);
	phone.requests[0].respond(200, siriAnswer(phone.now, [3, 9]));
	assert.deepStrictEqual(
		updates(phone).map((u) => [u.state, u.minutes, u.minutes2]),
		[
			["ok", 3, 9],
			["ok", 3, 9],
		]
	);
	phone.restore();
});

test("an answer is reused for 20 s, then PRIM is asked again", () => {
	const phone = withConfig();
	phone.fromWatch(REFRESH);
	phone.requests[0].respond(200, siriAnswer(phone.now, [5]));
	phone.advance(10000);
	phone.fromWatch(REFRESH);
	assert.strictEqual(phone.requests.length, 1);
	phone.advance(15000);
	phone.fromWatch(REFRESH);
	assert.strictEqual(phone.requests.length, 2);
	phone.restore();
});

test("a PRIM request that never answers ends as a network error", () => {
	const phone = withConfig();
	phone.fromWatch(REFRESH);
	phone.advance(10000);
	assert.strictEqual(phone.requests[0].aborted, true);
	assert.deepStrictEqual(updates(phone).map((u) => u.state), ["network"]);
	// A late answer is ignored: still one reply.
	phone.requests[0].respond(200, siriAnswer(phone.now, [5]));
	assert.strictEqual(updates(phone).length, 1);
	phone.restore();
});

test("a reply the watch refuses is sent again, up to two more times", () => {
	const phone = withConfig({ nacks: 5 });
	phone.fromWatch(REFRESH);
	phone.requests[0].respond(200, siriAnswer(phone.now, [5]));
	phone.advance(5000);
	assert.strictEqual(phone.attempts.filter((m) => m.itemType === "departureUpdate").length, 3);
	phone.restore();
});

test("a garbled saved config doesn't break startup", () => {
	const storage = new Map([["stroycommuteConfig", "{not json"]]);
	const phone = loadPhone({ storage });
	phone.fire("ready", {});
	phone.advance(1000);
	const meta = phone.sent.find((m) => m.itemType === "configMeta");
	assert.strictEqual(meta.itemCount, 1);
	phone.restore();
});

test("a config saved by an older version, without schedule, still reaches the watch", () => {
	const old = { apiKey: "key", trackedStops: [STOP] };
	const phone = loadPhone({ storage: new Map([["stroycommuteConfig", JSON.stringify(old)]]) });
	phone.fire("ready", {});
	phone.advance(2000);
	assert.deepStrictEqual(
		phone.sent.filter((m) => m.itemType && m.itemType.startsWith("config")).map((m) => m.itemType),
		["configMeta", "configStop"]
	);
	phone.restore();
});

test("saving the settings drops the saved times of trips no longer tracked", () => {
	const lastGood = {
		[`${STOP.stopRef}|${STOP.lineRef}|`]: { at: 1, extra: {} },
		"STIF:StopPoint:Q:9:|STIF:Line::C0:|": { at: 1, extra: {} },
	};
	const phone = withConfig();
	phone.storage.set("stroycommuteLastGood", JSON.stringify(lastGood));
	phone.fire("webviewclosed", { response: encodeURIComponent(JSON.stringify(CONFIG)) });
	assert.deepStrictEqual(Object.keys(JSON.parse(phone.storage.get("stroycommuteLastGood"))), [
		`${STOP.stopRef}|${STOP.lineRef}|`,
	]);
	phone.restore();
});

test("a watch diagnostic report lands in the journal shown by the settings page", () => {
	const phone = withConfig();
	phone.fromWatch({
		itemType: "diagReport",
		diagText: JSON.stringify([{ t: 5, w: "render", m: "TypeError: call: not a function" }]),
	});
	phone.fire("showConfiguration", {});
	const html = Buffer.from(phone.opened.split("base64,")[1], "base64").toString("utf8");
	assert.match(html, /window\.__diagLog = \[\{"t":5,"src":"watch","w":"render"/);
	phone.restore();
});

test("replies carry the departure times, and the config the watch colors and vibration", () => {
	const config = { ...CONFIG, vibrateMinutes: 3, trackedStops: [{ ...STOP, lineColor: "#FFCE00", lineTextColor: "#FFFFFF" }] };
	const phone = loadPhone({ storage: new Map([["stroycommuteConfig", JSON.stringify(config)]]) });
	phone.fromWatch(REFRESH);
	phone.requests[0].respond(200, siriAnswer(phone.now, [4, 11]));
	const update = updates(phone)[0];
	assert.strictEqual(update.departTime, Math.floor((phone.now + 4 * 60000) / 1000));
	assert.strictEqual(update.departTime2, Math.floor((phone.now + 11 * 60000) / 1000));
	phone.fire("ready", {});
	phone.advance(2000);
	const meta = phone.sent.find((m) => m.itemType === "configMeta");
	const stop = phone.sent.find((m) => m.itemType === "configStop");
	assert.strictEqual(meta.vibrateMinutes, 3);
	assert.deepStrictEqual([stop.lineColor, stop.lineTextColor], ["#FFAA00", "#000000"]);
	phone.restore();
});
