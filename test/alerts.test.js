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

test("start dates read from the texts, not end dates nor fractions", () => {
	const ref = Date.UTC(2026, 10, 12, 15);
	const start = (text) => alerts.parseStartDate(text, ref);
	const local = (y, m, d) => new Date(y, m, d).getTime();
	assert.strictEqual(start("Du 21 novembre au 22 novembre inclus, le trafic sera interrompu"), local(2026, 10, 21));
	assert.strictEqual(start("Travaux RER B, du lundi 14 au vendredi 18 décembre inclus dès 22:45"), local(2026, 11, 14));
	assert.strictEqual(start("Mouvement social local les 14 et 15/11 sur le RER B"), local(2026, 10, 14));
	assert.strictEqual(start("Match de rugby France/Afrique du Sud du 13/11"), local(2026, 10, 13));
	assert.strictEqual(start("À partir du 1er décembre, travaux"), local(2026, 11, 1));
	assert.strictEqual(start("Le 5 janvier, travaux"), local(2027, 0, 5));
	assert.strictEqual(start("Jusqu'au 19 décembre inclus, l'arrêt n'est pas desservi"), null);
	assert.strictEqual(start("1/3 des trains circulent"), null);
	assert.strictEqual(start("Le trafic est très perturbé"), null);
	const parsed = alerts.parseGeneralMessages(fixture("gm-rer-b.json"), "STIF:Line::C01743:");
	assert.strictEqual(parsed[0].start, local(2026, 10, 21));
});

test("pin on the eve of a start still ahead; notification at most a few days before", () => {
	const start = new Date(2026, 10, 21).getTime();
	const seen = new Date(2026, 10, 14, 14, 30).getTime();
	assert.strictEqual(alerts.pinTime(start, seen), new Date(2026, 10, 20, 18).getTime());
	assert.strictEqual(alerts.pinTime(null, seen), seen);
	assert.strictEqual(alerts.pinTime(new Date(2026, 10, 14).getTime(), seen), seen);
	assert.strictEqual(alerts.notifyLater(start, seen), true);
	assert.strictEqual(alerts.notifyLater(start, new Date(2026, 10, 18, 8).getTime()), false);
	assert.strictEqual(alerts.notifyLater(null, seen), false);
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

test("alertChunks orders messages ending soonest first, undated last", () => {
	const messages = [
		{ id: "1", text: "c", validUntil: 300 },
		{ id: "2", text: "n", validUntil: null },
		{ id: "3", text: "a", validUntil: 100 },
	];
	assert.deepStrictEqual(alerts.alertChunks(messages), ["a\nc\nn"]);
	assert.deepStrictEqual(alerts.alertChunks([]), []);
});

test("alertChunks splits whole messages over chunks within the byte budget, losing none", () => {
	const long = "é".repeat(280); // 560 UTF-8 bytes
	const messages = [1, 2, 3, 4, 5].map((i) => ({ id: String(i), text: long, validUntil: i }));
	const chunks = alerts.alertChunks(messages, 1500);
	assert.deepStrictEqual(chunks, [`${long}\n${long}`, `${long}\n${long}`, long]);
	assert.ok(chunks.every((c) => alerts.utf8Length(c) <= 1500));
	assert.strictEqual(chunks.join("\n").split("\n").length, 5);
});

test("a message cut at MAX_TEXT never ends with half an emoji", () => {
	const raw = `${"a".repeat(alerts.MAX_TEXT - 2)}🚧x`;
	const body = {
		Siri: { ServiceDelivery: { GeneralMessageDelivery: [{ InfoMessage: [{
			InfoChannelRef: { value: "Perturbation" },
			InfoMessageIdentifier: { value: "m1" },
			Content: { Message: [{ MessageType: "SHORT_MESSAGE", MessageText: { value: raw } }] },
		}] }] } },
	};
	const [message] = alerts.parseGeneralMessages(body, "L");
	assert.ok(!/[\uD800-\uDBFF]…$/.test(message.text));
	assert.doesNotThrow(() => encodeURIComponent(message.text));
	assert.deepStrictEqual(alerts.alertChunks([message, { ...message, id: "m2" }]).length, 1);
});

test("utf8Length counts like UTF-8 and tolerates a lone surrogate", () => {
	assert.strictEqual(alerts.utf8Length("aé🚧"), 1 + 2 + 4);
	assert.strictEqual(alerts.utf8Length("a\uD83D"), 4);
	assert.strictEqual(alerts.utf8Length("€"), 3);
});
