const test = require("node:test");
const assert = require("node:assert");
const { watchLineColors, contrast, parseHex } = require("../src/pkjs/colors");

test("colors are rounded to the watch's 64-color palette", () => {
	// Metro 4 purple, white text.
	assert.deepStrictEqual(watchLineColors("#BE418D", "#FFFFFF"), {
		color: "#AA55AA",
		textColor: "#FFFFFF",
	});
});

test("a text color too close to its background becomes black or white", () => {
	// RER C yellow with white text: unreadable once rounded, black wins.
	assert.deepStrictEqual(watchLineColors("#FFCE00", "#FFFFFF"), {
		color: "#FFAA00",
		textColor: "#000000",
	});
	// Dark blue with dark text: white wins.
	assert.strictEqual(watchLineColors("#003CA6", "#000000").textColor, "#FFFFFF");
});

test("missing or broken colors fall back to gray and white", () => {
	assert.deepStrictEqual(watchLineColors(undefined, "nope"), { color: "#AAAAAA", textColor: "#000000" });
	assert.deepStrictEqual(parseHex("#abc"), [170, 187, 204]);
	assert.strictEqual(parseHex("#12"), null);
	assert.ok(Math.abs(contrast([0, 0, 0], [255, 255, 255]) - 21) < 1e-9);
});
