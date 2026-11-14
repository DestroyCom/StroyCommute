// Pure helpers for the error journal shown in the config page's Diagnostic
// section -- no Pebble or localStorage access, so test/*.test.js can run
// them under plain Node. Entries come from the watch (its own journal, sent
// as a "diagReport" AppMessage, see tryWriteDiag in src/embeddedjs/main.js)
// and from pkjs itself. Shape: { t: epoch ms, src: "watch"|"phone",
// w: where, m: message, s?: stack, tr?: trail of recent events,
// dev?: watch platform/firmware }.
// No `?.` / `??` here: the SDK's webpack 1 bundler predates ES2020.

// Keeps the injected config page and localStorage small.
const DIAG_MAX_STORED = 30;

/**
 * @param {string} text - The watch's diagText: a JSON array of entries.
 * @param {string} [device] - Watch platform/firmware, attached to each entry.
 * @returns {object[]} The entries, tagged src "watch"; [] if `text` isn't
 *   a JSON array.
 */
function parseWatchDiag(text, device) {
	let list;
	try {
		list = JSON.parse(text);
	} catch (_error) {
		return [];
	}
	if (!Array.isArray(list)) return [];
	return list
		.filter((e) => e && typeof e === "object" && typeof e.t === "number")
		.map((e) => {
			const entry = {
				t: e.t,
				src: "watch",
				w: String(e.w || "?"),
				m: String(e.m || ""),
			};
			if (e.s) entry.s = String(e.s);
			if (e.tr) entry.tr = String(e.tr);
			if (device) entry.dev = device;
			return entry;
		});
}

/**
 * @param {object[]} existing - Stored entries.
 * @param {object[]} incoming - New entries (a resent watch journal may
 *   repeat some).
 * @param {number} [max] - Defaults to DIAG_MAX_STORED.
 * @returns {object[]} Both lists without duplicates, oldest first, cut to
 *   the `max` most recent.
 */
function mergeDiagEntries(existing, incoming, max) {
	const limit = max || DIAG_MAX_STORED;
	const seen = {};
	const all = [];
	(existing || []).concat(incoming || []).forEach((e) => {
		const key = [e.src, e.t, e.w, e.m].join("|");
		if (seen[key]) return;
		seen[key] = true;
		all.push(e);
	});
	all.sort((a, b) => a.t - b.t);
	return all.slice(Math.max(0, all.length - limit));
}

module.exports = {
	DIAG_MAX_STORED: DIAG_MAX_STORED,
	parseWatchDiag: parseWatchDiag,
	mergeDiagEntries: mergeDiagEntries,
};
