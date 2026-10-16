const test = require("node:test");
const assert = require("node:assert");
const { staleExtra } = require("../src/pkjs/trips");

const MIN = 60000;
const saved = { at: 1000000, extra: { lineName: "4", minutes: 3, destination: "Bagneux" } };

test("returns the saved fields with their age in whole minutes", () => {
	const out = staleExtra(saved, saved.at + 5 * MIN + 30000);
	assert.strictEqual(out.minutes, 3);
	assert.strictEqual(out.destination, "Bagneux");
	assert.strictEqual(out.staleAge, 5);
});

test("does not mutate the saved entry", () => {
	staleExtra(saved, saved.at + MIN);
	assert.strictEqual("staleAge" in saved.extra, false);
});

test("nothing saved, malformed, too old or from the future gives null", () => {
	assert.strictEqual(staleExtra(null, 0), null);
	assert.strictEqual(staleExtra({ at: "x", extra: {} }, 0), null);
	assert.strictEqual(staleExtra(saved, saved.at + 31 * MIN), null);
	assert.strictEqual(staleExtra(saved, saved.at - 2 * MIN), null);
	assert.strictEqual(staleExtra(saved, saved.at + 30 * MIN).staleAge, 30);
});
