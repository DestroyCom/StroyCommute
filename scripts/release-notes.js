// Turns CHANGELOG.md's "Unreleased" section into a release, for the Release
// workflow:
//   node scripts/release-notes.js <version> [--since <git ref>] [--out <dir>]
// - moves the Unreleased entries under "## [<version>] - <date>" in
//   CHANGELOG.md (Unreleased is left empty, ready for the next changes);
// - writes <out>/release-notes.md, the GitHub release body: the entries, a
//   plain-text block to paste into the appstore's release notes, and the
//   commits since the previous release;
// - writes <out>/store-notes.txt, that plain text on its own.
// With an empty Unreleased section the entries fall back to the commit
// subjects, so a release is never blocked on the changelog.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const UNRELEASED = "## [Unreleased]";

/**
 * @param {string} text - CHANGELOG.md content.
 * @returns {string} The Unreleased section's body, trimmed ("" if none).
 */
function extractUnreleased(text) {
	const start = text.indexOf(UNRELEASED);
	if (start === -1) throw new Error(`CHANGELOG.md has no "${UNRELEASED}" heading`);
	const bodyStart = start + UNRELEASED.length;
	const next = text.indexOf("\n## ", bodyStart);
	return text.slice(bodyStart, next === -1 ? text.length : next).trim();
}

/**
 * @param {string} text - CHANGELOG.md content.
 * @param {string} version
 * @param {string} date - YYYY-MM-DD.
 * @param {string} body - The release's entries.
 * @returns {string} CHANGELOG.md with an empty Unreleased section followed
 *   by the new release's section.
 */
function promote(text, version, date, body) {
	const start = text.indexOf(UNRELEASED);
	const bodyStart = start + UNRELEASED.length;
	const next = text.indexOf("\n## ", bodyStart);
	const rest = next === -1 ? "" : text.slice(next + 1);
	return `${text.slice(0, bodyStart)}\n\n## [${version}] - ${date}\n\n${body}\n${rest ? `\n${rest}` : ""}`;
}

/**
 * @param {string} markdown - Changelog entries.
 * @returns {string} The same as plain text for the appstore form: headings
 *   become "Title:" lines, list items "• item", links and markup are
 *   stripped.
 */
function toStoreText(markdown) {
	return markdown
		.split("\n")
		.map((line) => {
			const heading = line.match(/^#{1,6}\s+(.*)$/);
			if (heading) return `${stripInline(heading[1])} :`;
			const item = line.match(/^(\s*)[-*]\s+(.*)$/);
			if (item) return `${item[1]}• ${stripInline(item[2])}`;
			return stripInline(line);
		})
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** @param {string} s @returns {string} `s` without links, bold or code markup. */
function stripInline(s) {
	return s
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/(\*\*|__)(.*?)\1/g, "$2")
		.replace(/`([^`]*)`/g, "$1");
}

/**
 * @param {{subject: string}[]} commits
 * @returns {string} Entries made from commit subjects (release commits and
 *   merges left out), "" if none.
 */
function entriesFromCommits(commits) {
	const items = commits
		.map((c) => c.subject)
		.filter((s) => !/^chore: release v/.test(s) && !/^Merge /.test(s))
		.map((s) => `- ${s}`);
	return items.length ? `### Changements\n\n${items.join("\n")}` : "";
}

/**
 * @param {object} p
 * @param {string} p.version
 * @param {string} p.entries - The release's changelog entries.
 * @param {{sha: string, subject: string}[]} p.commits
 * @param {string} [p.since] - Previous release tag/ref, if known.
 * @returns {string} The GitHub release body.
 */
function releaseBody({ version, entries, commits, since }) {
	const parts = [entries, "", "### Texte pour le store (à copier-coller)", "", "```text", toStoreText(entries), "```", ""];
	parts.push(`Fichier à téléverser dans le Developer Dashboard (New Release) : **StroyCommute-${version}.pbw**, ci-dessous.`, "");
	if (commits.length) {
		parts.push(
			`<details><summary>${commits.length} commit(s)${since ? ` depuis ${since}` : ""}</summary>`,
			"",
			...commits.map((c) => `- ${c.subject} (${c.sha.slice(0, 7)})`),
			"",
			"</details>",
			""
		);
	}
	return parts.join("\n");
}

/** @returns {string} Output of `git args...`, trimmed; "" on failure. */
function git(...args) {
	try {
		return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return "";
	}
}

function main(argv) {
	const version = argv[0];
	if (!version) throw new Error("usage: release-notes.js <version> [--since <ref>] [--out <dir>]");
	const option = (name) => {
		const i = argv.indexOf(name);
		return i === -1 ? "" : argv[i + 1] || "";
	};
	const root = path.join(__dirname, "..");
	const outDir = option("--out") || root;
	// The previous release: the latest v* tag, else the --since ref.
	const since = git("describe", "--tags", "--abbrev=0", "--match", "v*") || option("--since");
	const log = since ? git("log", "--format=%H%x09%s", `${since}..HEAD`) : "";
	const commits = log
		? log.split("\n").map((line) => {
				const [sha, ...subject] = line.split("\t");
				return { sha, subject: subject.join("\t") };
			})
		: [];

	const changelogPath = path.join(root, "CHANGELOG.md");
	const changelog = fs.readFileSync(changelogPath, "utf8").replace(/\r\n/g, "\n");
	let entries = extractUnreleased(changelog);
	if (!entries) {
		console.log("::warning::CHANGELOG.md has nothing under [Unreleased]: using the commit subjects.");
		entries = entriesFromCommits(commits) || `Version ${version}.`;
	}
	const date = new Date().toISOString().slice(0, 10);
	fs.writeFileSync(changelogPath, promote(changelog, version, date, entries));
	fs.writeFileSync(path.join(outDir, "release-notes.md"), releaseBody({ version, entries, commits, since }));
	fs.writeFileSync(path.join(outDir, "store-notes.txt"), `${toStoreText(entries)}\n`);
	console.log(`Release notes for ${version} written (${commits.length} commit(s) since ${since || "the start"}).`);
}

if (require.main === module) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		console.error(error.message);
		process.exit(1);
	}
}

module.exports = { extractUnreleased, promote, toStoreText, entriesFromCommits, releaseBody };
