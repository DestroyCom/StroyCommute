// Copies config/index.html into the CONFIG_HTML template literal of
// src/pkjs/index.js (see the comment above CONFIG_HTML for why it is
// inlined). `--check` only verifies both copies match (exit 1 if not).
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const htmlPath = path.join(root, "config", "index.html");
const jsPath = path.join(root, "src", "pkjs", "index.js");

const html = fs.readFileSync(htmlPath, "utf8").replace(/\r\n/g, "\n");
if (html.includes("`") || html.includes("${")) {
	console.error(
		"config/index.html must not contain a backtick or ${ (it is embedded in a template literal)"
	);
	process.exit(1);
}
const rawJs = fs.readFileSync(jsPath, "utf8");
// Written back with whatever line endings the file already uses (CRLF
// on a Windows checkout with core.autocrlf).
const eol = rawJs.includes("\r\n") ? "\r\n" : "\n";
const js = rawJs.replace(/\r\n/g, "\n");
const pattern = /const CONFIG_HTML = `[\s\S]*?`;\n/;
if (!pattern.test(js)) {
	console.error("CONFIG_HTML literal not found in src/pkjs/index.js");
	process.exit(1);
}
const updated = js.replace(
	pattern,
	() => "const CONFIG_HTML = `" + html + "`;\n"
);

if (process.argv.includes("--check")) {
	if (updated !== js) {
		console.error(
			"CONFIG_HTML is out of sync with config/index.html -- run npm run sync:config"
		);
		process.exit(1);
	}
	console.log("CONFIG_HTML in sync");
} else {
	fs.writeFileSync(jsPath, updated.replace(/\n/g, eol));
	console.log(
		updated === js ? "CONFIG_HTML already in sync" : "CONFIG_HTML updated"
	);
}
