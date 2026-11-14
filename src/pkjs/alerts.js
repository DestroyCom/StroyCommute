// Pure helpers for traffic alerts (PRIM general-message, see
// docs/idfm-api-reference.md): parsing, which lines to watch, what's new or
// over since the last check, the user's notification window, timeline pins.
// No Pebble, XMLHttpRequest or localStorage access: tested under Node.
// No `?.`, `??` or `**` here: the SDK's webpack 1 bundler predates them.

// Longest message text kept (the watch shows a few lines of it).
const MAX_TEXT = 280;

/**
 * @param {object} body - A general-message answer.
 * @param {string} lineRef - The line it was asked for.
 * @returns {{id: string, text: string, validUntil: ?number}[]} Its
 *   "Perturbation" messages, short text first, texts cleaned (thin spaces,
 *   repeated spaces) and capped at MAX_TEXT.
 */
function parseGeneralMessages(body, lineRef) {
	const delivery =
		body && body.Siri && body.Siri.ServiceDelivery
			? (body.Siri.ServiceDelivery.GeneralMessageDelivery || [])[0]
			: null;
	const messages = (delivery && delivery.InfoMessage) || [];
	const out = [];
	for (const message of messages) {
		const channel = message.InfoChannelRef ? message.InfoChannelRef.value : "";
		if (channel !== "Perturbation") continue;
		const id = message.InfoMessageIdentifier
			? message.InfoMessageIdentifier.value
			: message.ItemIdentifier;
		const content = message.Content || {};
		const lines = (content.LineRef || []).map((l) => l.value);
		if (lines.length && lineRef && !lines.includes(lineRef)) continue;
		const texts = content.Message || [];
		const pick = (type) => {
			const found = texts.find((m) => m.MessageType === type);
			return found && found.MessageText ? found.MessageText.value : "";
		};
		const text = cleanText(pick("SHORT_MESSAGE") || pick("TEXT_ONLY"));
		if (!id || !text) continue;
		const until = Date.parse(message.ValidUntilTime || "");
		out.push({
			id: id,
			text: text,
			validUntil: Number.isNaN(until) ? null : until,
		});
	}
	return out;
}

/** @param {string} text @returns {string} One readable paragraph. */
function cleanText(text) {
	const flat = String(text)
		.replace(/[ -​ ]/g, " ")
		.replace(/\s*\n\s*/g, " ")
		.replace(/ {2,}/g, " ")
		.trim();
	if (flat.length <= MAX_TEXT) return flat;
	// Never cut an emoji (a surrogate pair) in half.
	let end = MAX_TEXT - 1;
	const last = flat.charCodeAt(end - 1);
	if (last >= 0xd800 && last <= 0xdbff) end -= 1;
	return `${flat.slice(0, end)}…`;
}

/**
 * @param {object} config - Normalized config.
 * @returns {{lineRef: string, lineName: string, explicit: boolean}[]} The
 *   lines to check: those added in the alerts section (explicit), then the
 *   lines of the tracked stops, without duplicates.
 */
function alertLines(config) {
	const lines = [];
	const seen = {};
	const add = (lineRef, lineName, explicit) => {
		if (!lineRef || seen[lineRef]) return;
		seen[lineRef] = true;
		lines.push({
			lineRef: lineRef,
			lineName: lineName || "",
			explicit: explicit,
		});
	};
	for (const line of config.trackedLines || [])
		add(line.lineRef, line.lineName, true);
	for (const stop of config.trackedStops || [])
		add(stop.lineRef, stop.lineName, false);
	return lines;
}

/**
 * @param {{days: number[], startTime: string, endTime: string}} schedule
 * @param {Date} date - Local time.
 * @returns {boolean} True when `date` falls in the notification window
 *   (days 0 = Sunday; an end before the start spans midnight).
 */
function inSchedule(schedule, date) {
	if (!schedule || !Array.isArray(schedule.days)) return false;
	const minutes = (hhmm) => {
		const parts = String(hhmm || "").split(":");
		return Number(parts[0]) * 60 + Number(parts[1] || 0);
	};
	const start = minutes(schedule.startTime);
	const end = minutes(schedule.endTime);
	const now = date.getHours() * 60 + date.getMinutes();
	if (start <= end) {
		return schedule.days.includes(date.getDay()) && now >= start && now < end;
	}
	// Overnight window: the part after midnight belongs to the previous day.
	if (now >= start) return schedule.days.includes(date.getDay());
	return now < end && schedule.days.includes((date.getDay() + 6) % 7);
}

/**
 * @param {Object<string, number>} seen - Message id -> first seen (ms), as
 *   stored; {} on the first check ever.
 * @param {{id: string}[]} current - Every line's current messages.
 * @param {number} now
 * @param {boolean} firstRun - True when nothing was ever stored: every
 *   message counts as known, so installing doesn't fire a burst.
 * @returns {{seen: Object<string, number>, added: string[], ended: string[]}}
 *   The new store, the ids that just appeared and those that are gone.
 */
function diffMessages(seen, current, now, firstRun) {
	const next = {};
	const added = [];
	for (const message of current) {
		if (next[message.id]) continue;
		if (seen[message.id]) {
			next[message.id] = seen[message.id];
		} else {
			next[message.id] = now;
			if (!firstRun) added.push(message.id);
		}
	}
	const ended = Object.keys(seen).filter((id) => !next[id]);
	return { seen: next, added: added, ended: ended };
}

/**
 * @param {string} id - Message id.
 * @returns {string} A pin id for it (pins only need ids unique per app).
 */
function pinId(id, suffix) {
	return `alert-${String(id).replace(/[^A-Za-z0-9.]/g, "")}${suffix || ""}`;
}

/**
 * @param {{id: string, text: string, validUntil: ?number}} message
 * @param {string} lineName
 * @param {number} firstSeen - When the message appeared (ms).
 * @param {object} texts - {trafficInfo}.
 * @returns {object} A timeline pin for an active message.
 */
function alertPin(message, lineName, firstSeen, texts) {
	return {
		id: pinId(message.id),
		time: new Date(firstSeen).toISOString(),
		layout: {
			type: "genericPin",
			title: lineName,
			subtitle: texts.trafficInfo,
			body: message.text,
			tinyIcon: "system://images/NOTIFICATION_FLAG",
		},
	};
}

/**
 * @param {string} id - The ended message's id.
 * @param {string} lineName
 * @param {string} text - Its last text.
 * @param {number} now
 * @param {object} texts - {trafficEnded}.
 * @returns {object} A timeline pin saying the message is over.
 */
function endPin(id, lineName, text, now, texts) {
	return {
		id: pinId(id, "-end"),
		time: new Date(now).toISOString(),
		layout: {
			type: "genericPin",
			title: lineName,
			subtitle: texts.trafficEnded,
			body: text,
			tinyIcon: "system://images/RESULT_DISMISSED",
		},
	};
}

/**
 * @param {string} s
 * @returns {number} Its length in UTF-8 bytes (a lone surrogate counts as
 *   the 3-byte replacement character, without throwing).
 */
function utf8Length(s) {
	let bytes = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c < 0x80) bytes += 1;
		else if (c < 0x800) bytes += 2;
		else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
			const next = s.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				bytes += 4;
				i += 1;
			} else bytes += 3;
		} else bytes += 3;
	}
	return bytes;
}

/**
 * @param {{id: string, text: string, validUntil: ?number}[]} messages - A
 *   line's messages.
 * @param {number} [maxBytes] - The watch's AppMessage inbox fits one
 *   alertUpdate of about 2 KB: 1500 bytes of text leave room for the rest.
 * @returns {string[]} Their texts, the message ending soonest first (usually
 *   what is happening now rather than works announced weeks ahead; no end
 *   date last), joined with "\n" into chunks of whole messages that each
 *   stay within `maxBytes` (a message is at most MAX_TEXT characters, so it
 *   always fits alone). Every message is in one chunk; [] without messages.
 */
function alertChunks(messages, maxBytes) {
	const budget = maxBytes || 1500;
	const ordered = (messages || [])
		.map((m, i) => ({ m: m, i: i }))
		.sort((a, b) => {
			const ua =
				typeof a.m.validUntil === "number"
					? a.m.validUntil
					: Number.POSITIVE_INFINITY;
			const ub =
				typeof b.m.validUntil === "number"
					? b.m.validUntil
					: Number.POSITIVE_INFINITY;
			return ua === ub ? a.i - b.i : ua - ub;
		})
		.map((x) => x.m.text);
	const chunks = [];
	let text = "";
	for (const message of ordered) {
		const next = text ? `${text}\n${message}` : message;
		if (text && utf8Length(next) > budget) {
			chunks.push(text);
			text = message;
		} else {
			text = next;
		}
	}
	if (text) chunks.push(text);
	return chunks;
}

module.exports = {
	utf8Length: utf8Length,
	alertChunks: alertChunks,
	MAX_TEXT: MAX_TEXT,
	parseGeneralMessages: parseGeneralMessages,
	alertLines: alertLines,
	inSchedule: inSchedule,
	diffMessages: diffMessages,
	pinId: pinId,
	alertPin: alertPin,
	endPin: endPin,
};
