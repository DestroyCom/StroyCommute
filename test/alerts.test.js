const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const alerts = require("../src/pkjs/alerts");

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));

test("parses the real RER B answer: short texts, ids, end dates", () => {
	const messages = alerts.parseGeneralMessages(fixture("gm-rer-b.json"), "STIF:Line::C01743:");
	assert.strictEqual(messages.length, 4);
	assert.match(messages[0].id, /^IVTR_HET|^RATP|^SNCF|:InfoMessage:/);
	assert.match(messages[0].text, /^Du 21 novembre au 22 novembre inclus, le trafic sera interrompu entre Aulnay-sous-Bois et Mitry – Claye \(travaux\)\. Bus de remplacement\.$/);
	assert.strictEqual(messages[0].validUntil, Date.parse("2026-11-21T03:45:00.000Z"));
	assert.ok(messages.every((m) => m.text.length <= alerts.MAX_TEXT && !m.text.includes("\n")));
});

test("an answer without messages, garbage, or another line's message gives nothing", () => {
	assert.deepStrictEqual(alerts.parseGeneralMessages(fixture("gm-empty.json"), "STIF:Line::C01743:"), []);
	assert.deepStrictEqual(alerts.parseGeneralMessages(null, "x"), []);
	assert.deepStrictEqual(alerts.parseGeneralMessages(fixture("gm-m4.json"), "STIF:Line::C01743:"), []);
	assert.strictEqual(alerts.parseGeneralMessages(fixture("gm-m4.json"), "STIF:Line::C01374:").length, 1);
});

test("watched lines: explicit ones first, then the tracked stops' lines, once each", () => {
	const lines = alerts.alertLines({
		trackedLines: [{ lineRef: "L1", lineName: "RER B" }],
		trackedStops: [
			{ lineRef: "L2", lineName: "4" },
			{ lineRef: "L1", lineName: "RER B" },
			{ lineRef: "L2", lineName: "4" },
		],
	});
	assert.deepStrictEqual(lines, [
		{ lineRef: "L1", lineName: "RER B", explicit: true },
		{ lineRef: "L2", lineName: "4", explicit: false },
	]);
});

test("notification window, including one that spans midnight", () => {
	const weekdays = { days: [1, 2, 3, 4, 5], startTime: "07:00", endTime: "19:30" };
	assert.strictEqual(alerts.inSchedule(weekdays, new Date(2026, 10, 13, 8, 0)), true); // Friday
	assert.strictEqual(alerts.inSchedule(weekdays, new Date(2026, 10, 13, 19, 30)), false);
	assert.strictEqual(alerts.inSchedule(weekdays, new Date(2026, 10, 14, 8, 0)), false); // Saturday
	const night = { days: [5], startTime: "22:00", endTime: "02:00" };
	assert.strictEqual(alerts.inSchedule(night, new Date(2026, 10, 13, 23, 0)), true);
	assert.strictEqual(alerts.inSchedule(night, new Date(2026, 10, 14, 1, 0)), true);
	assert.strictEqual(alerts.inSchedule(night, new Date(2026, 10, 14, 3, 0)), false);
	assert.strictEqual(alerts.inSchedule(undefined, new Date()), false);
});

test("new and ended messages; nothing counts as new on the very first check", () => {
	const first = alerts.diffMessages({}, [{ id: "a" }, { id: "b" }], 100, true);
	assert.deepStrictEqual(first, { seen: { a: 100, b: 100 }, added: [], ended: [] });
	const next = alerts.diffMessages(first.seen, [{ id: "b" }, { id: "c" }, { id: "c" }], 200, false);
	assert.deepStrictEqual(next, { seen: { b: 100, c: 200 }, added: ["c"], ended: ["a"] });
});

test("pins for a message and for its end", () => {
	const texts = { trafficInfo: "Info trafic", trafficEnded: "Fin de perturbation" };
	const message = { id: "RATP-SIV:InfoMessage::MSG.IVC.1:LOC", text: "Travaux", validUntil: null };
	const pin = alerts.alertPin(message, "4", Date.UTC(2026, 10, 13, 8), texts);
	assert.strictEqual(pin.id, "alert-RATPSIVInfoMessageMSG.IVC.1LOC");
	assert.deepStrictEqual(pin.layout, {
		type: "genericPin",
		title: "4",
		subtitle: "Info trafic",
		body: "Travaux",
		tinyIcon: "system://images/NOTIFICATION_FLAG",
	});
	assert.strictEqual(pin.time, "2026-11-13T08:00:00.000Z");
	const end = alerts.endPin(message.id, "4", "Travaux", Date.UTC(2026, 10, 14), texts);
	assert.strictEqual(end.id, `${pin.id}-end`);
	assert.strictEqual(end.layout.subtitle, "Fin de perturbation");
});

test("alertTextFor orders messages ending soonest first, undated last", () => {
	const messages = [
		{ id: "1", text: "c", validUntil: 300 },
		{ id: "2", text: "n", validUntil: null },
		{ id: "3", text: "a", validUntil: 100 },
	];
	assert.strictEqual(alerts.alertTextFor(messages), "a\nc\nn");
});

test("alertTextFor keeps whole messages within the byte budget", () => {
	const long = "é".repeat(280); // 560 UTF-8 bytes
	const messages = [1, 2, 3].map((i) => ({ id: String(i), text: long, validUntil: i }));
	assert.strictEqual(alerts.alertTextFor(messages, 1500), `${long}\n${long}`);
});

test("alertTextFor always keeps the first message", () => {
	const text = "x".repeat(600);
	assert.strictEqual(alerts.alertTextFor([{ id: "1", text: text, validUntil: null }], 100), text);
	assert.strictEqual(alerts.alertTextFor([]), "");
});
