const test = require("node:test");
const assert = require("node:assert");
const {
	extractUnreleased,
	promote,
	toStoreText,
	entriesFromCommits,
	releaseBody,
} = require("../scripts/release-notes");

const changelog = `# Changelog

Intro.

## [Unreleased]

### Nouveautés

- Un **truc** [nouveau](https://example.com) avec \`code\`.

## [1.0.0]

- Première version.
`;

test("extracts the Unreleased entries", () => {
	assert.strictEqual(
		extractUnreleased(changelog),
		"### Nouveautés\n\n- Un **truc** [nouveau](https://example.com) avec `code`."
	);
	assert.strictEqual(extractUnreleased("# C\n\n## [Unreleased]\n\n## [1.0.0]\n"), "");
	assert.throws(() => extractUnreleased("# C\n"));
});

test("promote leaves Unreleased empty above the new version", () => {
	const out = promote(changelog, "1.0.1", "2026-11-13", extractUnreleased(changelog));
	assert.strictEqual(extractUnreleased(out), "");
	assert.match(out, /## \[Unreleased\]\n\n## \[1\.0\.1\] - 2026-11-13\n\n### Nouveautés\n\n- Un \*\*truc\*\*/);
	assert.match(out, /\n## \[1\.0\.0\]\n\n- Première version\.\n$/);
});

test("store text is plain", () => {
	assert.strictEqual(
		toStoreText("### Nouveautés\n\n- Un **truc** [nouveau](https://x.y) avec `code`.\n\n\n\n### Corrections\n\n- Fixé."),
		"Nouveautés :\n\n• Un truc nouveau avec code.\n\nCorrections :\n\n• Fixé."
	);
});

test("commit fallback skips release commits and merges", () => {
	assert.strictEqual(
		entriesFromCommits([{ subject: "chore: release v1.0.1" }, { subject: "Merge pull request #3" }, { subject: "Fix X" }]),
		"### Changements\n\n- Fix X"
	);
	assert.strictEqual(entriesFromCommits([]), "");
});

test("release body holds the entries, the store text and the commits", () => {
	const body = releaseBody({
		version: "1.0.1",
		entries: "### Corrections\n\n- Fixé.",
		commits: [{ sha: "0123456789abcdef", subject: "Fix X" }],
		since: "v1.0.0",
	});
	assert.match(body, /^### Corrections\n\n- Fixé\./);
	assert.match(body, /```text\nCorrections :\n\n• Fixé\.\n```/);
	assert.match(body, /StroyCommute-1\.0\.1\.pbw/);
	assert.match(body, /1 commit\(s\) depuis v1\.0\.0[\s\S]*- Fix X \(0123456\)/);
});
