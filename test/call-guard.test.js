const test = require("node:test");
const assert = require("node:assert");
const {
	DEFAULT_CALL_GUARD,
	normalizeCallGuard,
	decideCallGuard,
} = require("../src/pkjs/trips");

const MIN = 60000;
const settings = { maxCalls: 4, windowMinutes: 10, pauseMinutes: 15 };

test("missing or garbage settings fall back to defaults", () => {
	assert.deepStrictEqual(normalizeCallGuard(undefined), DEFAULT_CALL_GUARD);
	assert.deepStrictEqual(
		normalizeCallGuard({ maxCalls: "x", windowMinutes: -3 }),
		DEFAULT_CALL_GUARD
	);
});

test("maxCalls of 1 is raised to 2 so an A->B refresh can ever pass", () => {
	assert.strictEqual(normalizeCallGuard({ maxCalls: 1 }).maxCalls, 2);
	const first = decideCallGuard(null, { maxCalls: 1 }, 0, 2);
	assert.strictEqual(first.allowed, true);
});

test("allows calls under the limit and records them", () => {
	const r = decideCallGuard(null, settings, 1000, 2);
	assert.strictEqual(r.allowed, true);
	assert.deepStrictEqual(r.state.calls, [1000, 1000]);
});

test("exceeding the limit starts a pause and refuses", () => {
	const state = { calls: [0, 0, 0], pausedUntil: 0 };
	const r = decideCallGuard(state, settings, MIN, 2);
	assert.strictEqual(r.allowed, false);
	assert.strictEqual(r.minutesLeft, 15);
	assert.strictEqual(r.state.pausedUntil, MIN + 15 * MIN);
});

test("refuses during the pause with minutes left rounded up", () => {
	const state = { calls: [], pausedUntil: 10 * MIN };
	const r = decideCallGuard(state, settings, 10 * MIN - 61000, 1);
	assert.strictEqual(r.allowed, false);
	assert.strictEqual(r.minutesLeft, 2);
});

test("calls older than the window no longer count", () => {
	const state = { calls: [0, 0, 0, 0], pausedUntil: 0 };
	const r = decideCallGuard(state, settings, 11 * MIN, 2);
	assert.strictEqual(r.allowed, true);
	assert.deepStrictEqual(r.state.calls, [11 * MIN, 11 * MIN]);
});

test("allowed again once the pause is over", () => {
	const state = { calls: [], pausedUntil: 5 * MIN };
	assert.strictEqual(decideCallGuard(state, settings, 5 * MIN, 1).allowed, true);
});

test("maxCalls 0 disables the guard", () => {
	const state = { calls: new Array(500).fill(0), pausedUntil: 0 };
	assert.strictEqual(decideCallGuard(state, { maxCalls: 0 }, 1, 2).allowed, true);
});

test("a pause ending further away than pauseMinutes (clock moved back) is treated as expired", () => {
	const state = { calls: [], pausedUntil: 1000 * MIN };
	assert.strictEqual(decideCallGuard(state, settings, 0, 1).allowed, true);
});
