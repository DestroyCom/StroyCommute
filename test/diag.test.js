const test = require("node:test");
const assert = require("node:assert");
const { parseWatchDiag, mergeDiagEntries } = require("../src/pkjs/diag");

test("parses the watch journal and tags each entry", () => {
	const text = JSON.stringify([
		{ t: 1000, w: "departure.onReadable", m: "TypeError: call: not a function", s: "", tr: "rx departureUpdate ok" },
	]);
	assert.deepStrictEqual(parseWatchDiag(text, "emery fw 4.9.1"), [
		{
			t: 1000,
			src: "watch",
			w: "departure.onReadable",
			m: "TypeError: call: not a function",
			tr: "rx departureUpdate ok",
			dev: "emery fw 4.9.1",
		},
	]);
});

test("garbled or unexpected watch text gives no entries", () => {
	assert.deepStrictEqual(parseWatchDiag("not json"), []);
	assert.deepStrictEqual(parseWatchDiag("{}"), []);
	assert.deepStrictEqual(parseWatchDiag(undefined), []);
	assert.deepStrictEqual(parseWatchDiag(JSON.stringify([null, { w: "no time" }])), []);
});

test("merge drops duplicates, sorts oldest first and keeps the most recent", () => {
	const a = { t: 1, src: "watch", w: "x", m: "boom" };
	const b = { t: 2, src: "phone", w: "y", m: "bang" };
	const c = { t: 3, src: "watch", w: "z", m: "pow" };
	assert.deepStrictEqual(mergeDiagEntries([b, a], [a, c]), [a, b, c]);
	assert.deepStrictEqual(mergeDiagEntries([a, b], [c], 2), [b, c]);
	assert.deepStrictEqual(mergeDiagEntries(undefined, [a]), [a]);
});
