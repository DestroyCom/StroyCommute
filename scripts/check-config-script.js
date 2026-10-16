// Evaluates CONFIG_HTML the way pkjs serves it (a JS template literal, where
// escapes like \" change meaning) and checks its <script> still parses.
const fs = require("node:fs");
const path = require("node:path");

const js = fs.readFileSync(path.join(__dirname, "..", "src", "pkjs", "index.js"), "utf8").replace(/\r\n/g, "\n");
const literal = js.match(/const CONFIG_HTML = (`[\s\S]*?`);\n/);
if (!literal) {
	console.error("CONFIG_HTML literal not found");
	process.exit(1);
}
const html = (0, eval)(literal[1]);
const script = html.match(/<script>([\s\S]*)<\/script>/);
try {
	new Function(script[1]);
	console.log("CONFIG_HTML script parses");
} catch (e) {
	console.error("CONFIG_HTML script is broken once embedded: " + e.message);
	process.exit(1);
}
