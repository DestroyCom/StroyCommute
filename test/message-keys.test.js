// The watch decodes every AppMessage key by its position in
// package.json's pebble.messageKeys (10000 + index), through a hand-kept
// copy of that list (ALL_MESSAGE_KEYS in src/embeddedjs/main.js). If the two
// drift apart, fields silently decode under the wrong name.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("ALL_MESSAGE_KEYS matches package.json messageKeys, in order", () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
	const main = fs.readFileSync(path.join(root, "src", "embeddedjs", "main.js"), "utf8");
	const block = main.match(/const ALL_MESSAGE_KEYS = \[([\s\S]*?)\];/);
	assert.ok(block, "ALL_MESSAGE_KEYS not found in main.js");
	const watchKeys = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
	assert.deepStrictEqual(watchKeys, pkg.pebble.messageKeys);
});
