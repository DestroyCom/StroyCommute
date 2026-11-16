// Pure helpers for traffic alerts (PRIM general-message, see
// docs/idfm-api-reference.md): parsing, which lines to watch, what's new or
// over since the last check, the user's notification window, timeline pins.
// No Pebble, XMLHttpRequest or localStorage access: tested under Node.
// No `?.`, `??` or `**` here: the SDK's webpack 1 bundler predates them.

// Longest message text kept (the watch shows a few lines of it).
const MAX_TEXT = 280;
// A message announced ahead of its start is notified at most this many days
// before it (a notification a month ahead is forgotten by then).
const NOTIFY_LEAD_DAYS = 3;
// Its timeline pin goes this many days before its start, at this local
// time, unless the settings say otherwise (timelinePinDays/Time).
const DEFAULT_PIN = { days: 1, time: "18:00" };
const DAY_MS = 24 * 3600000;

const MONTHS = [
	"janvier",
	"février",
	"mars",
	"avril",
	"mai",
	"juin",
	"juillet",
	"août",
	"septembre",
	"octobre",
	"novembre",
	"décembre",
];
const WEEKDAY = "(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\\s+";
const DAY = "(\\d{1,2})(?:er)?";
const MONTH_NAME = `(${MONTHS.join("|")}|fevrier|aout|decembre)`;
// Date forms seen in PRIM texts, each giving [day, month] groups:
// "du lundi 14 au vendredi 18 décembre" (month after the range), "les 14 et
// 15/11", "21 novembre", "13/11".
const DATE_PATTERNS = [
	{
		re: new RegExp(
			`\\bdu\\s+(?:${WEEKDAY})?${DAY}\\s+au\\s+(?:${WEEKDAY})?\\d{1,2}(?:er)?\\s+${MONTH_NAME}`,
			"gi"
		),
		named: true,
	},
	{
		re: new RegExp(
			`\\bles\\s+(?:${WEEKDAY})?${DAY}\\s+et\\s+(?:${WEEKDAY})?\\d{1,2}\\s*/\\s*(\\d{1,2})\\b`,
			"gi"
		),
	},
	{ re: new RegExp(`\\b${DAY}\\s+${MONTH_NAME}`, "gi"), named: true },
	// Numeric dates only after a word introducing one: "1/3 des trains" is
	// not the 1st of March.
	{
		re: new RegExp(
			`\\b(?:du|le|les|depuis le)\\s+(?:${WEEKDAY})?${DAY}\\s*/\\s*(\\d{1,2})\\b`,
			"gi"
		),
	},
];

/**
 * @param {string} text - A message text (French).
 * @param {number} reference - When the message was written (ms): the date
 *   is the first one on or after about a month before it.
 * @returns {?number} Local midnight of the first date the text gives that
 *   isn't an end ("jusqu'au 19 décembre", "au 22 novembre"), or null.
 */
function parseStartDate(text, reference) {
	let best = null;
	for (const pattern of DATE_PATTERNS) {
		pattern.re.lastIndex = 0;
		let match = pattern.re.exec(text);
		while (match) {
			const before = text.slice(Math.max(0, match.index - 20), match.index);
			const isEnd =
				/\bau\s+(?:(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+)?$/i.test(
					before
				);
			if (!isEnd && (best === null || match.index < best.index)) {
				best = {
					index: match.index,
					day: match[1],
					month: match[2],
					named: pattern.named,
				};
			}
			match = pattern.re.exec(text);
		}
	}
	if (best === null) return null;
	const day = Number(best.day);
	const month = best.named
		? MONTHS.indexOf(
				best.month
					.toLowerCase()
					.replace(/^fevrier$/, "février")
					.replace(/^aout$/, "août")
					.replace(/^decembre$/, "décembre")
			)
		: Number(best.month) - 1;
	if (month < 0 || month > 11 || day < 1 || day > 31) return null;
	const ref = new Date(reference);
	let start = new Date(ref.getFullYear(), month, day);
	if (start.getDate() !== day) return null; // 31/11 and the like
	if (start.getTime() < reference - 31 * DAY_MS) {
		start = new Date(ref.getFullYear() + 1, month, day);
	}
	return start.getTime();
}

/**
 * @param {?number} start - A message's start (local midnight), if known.
 * @param {number} now
 * @returns {boolean} True while a message starts too far ahead to notify.
 */
function notifyLater(start, now) {
	return typeof start === "number" && start - now > NOTIFY_LEAD_DAYS * DAY_MS;
}

/**
 * @param {?number} start - A message's start (local midnight), if known.
 * @param {number} firstSeen - When the message appeared (ms).
 * @param {{days: number, time: string}} [when] - How many days before its
 *   start, and at what local "HH:MM"; DEFAULT_PIN (the eve, 18:00) if
 *   omitted.
 * @returns {number} When its pin goes on the timeline: `when` for a start
 *   still ahead when it appeared, else when it appeared.
 */
function pinTime(start, firstSeen, when) {
	if (typeof start !== "number" || start <= firstSeen) return firstSeen;
	const setting = when || DEFAULT_PIN;
	const parts = String(setting.time || DEFAULT_PIN.time).split(":");
	const at = new Date(start);
	at.setDate(at.getDate() - (setting.days || 0));
	at.setHours(Number(parts[0]) || 0, Number(parts[1]) || 0, 0, 0);
	return at.getTime();
}

/**
 * @param {object} body - A general-message answer.
 * @param {string} lineRef - The line it was asked for.
 * @returns {{id: string, text: string, validUntil: ?number,
 *   start: ?number}[]} Its "Perturbation" messages, short text first, texts
 *   cleaned (thin spaces, repeated spaces) and capped at MAX_TEXT. `start`
 *   comes from the text (see parseStartDate): PRIM gives no start time.
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
		const recorded = Date.parse(message.RecordedAtTime || "");
		out.push({
			id: id,
			text: text,
			validUntil: Number.isNaN(until) ? null : until,
			start: parseStartDate(
				text,
				Number.isNaN(recorded) ? Date.now() : recorded
			),
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
 * @returns {{lineRef: string, lineName: string, explicit: boolean,
 *   lineColor?: string, lineTextColor?: string}[]} The lines to check:
 *   those added in the alerts section (explicit), then the lines of the
 *   tracked stops, without duplicates. Colours from the line entry, else
 *   from a tracked stop on the line (lines saved by older versions have
 *   none).
 */
function alertLines(config) {
	const lines = [];
	const byRef = {};
	const add = (entry, explicit) => {
		if (!entry.lineRef) return;
		const known = byRef[entry.lineRef];
		if (known) {
			if (!known.lineColor && entry.lineColor) {
				known.lineColor = entry.lineColor;
				known.lineTextColor = entry.lineTextColor;
			}
			return;
		}
		const line = {
			lineRef: entry.lineRef,
			lineName: entry.lineName || "",
			explicit: explicit,
		};
		if (entry.lineColor) {
			line.lineColor = entry.lineColor;
			line.lineTextColor = entry.lineTextColor;
		}
		byRef[entry.lineRef] = line;
		lines.push(line);
	};
	for (const line of config.trackedLines || []) add(line, true);
	for (const stop of config.trackedStops || []) add(stop, false);
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
 * @param {number} time - When it goes on the timeline (ms, see pinTime).
 * @param {object} texts - {trafficInfo}.
 * @returns {object} A timeline pin for an active message.
 */
function alertPin(message, lineName, time, texts) {
	return {
		id: pinId(message.id),
		time: new Date(time).toISOString(),
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
	NOTIFY_LEAD_DAYS: NOTIFY_LEAD_DAYS,
	parseStartDate: parseStartDate,
	notifyLater: notifyLater,
	pinTime: pinTime,
	parseGeneralMessages: parseGeneralMessages,
	alertLines: alertLines,
	inSchedule: inSchedule,
	diffMessages: diffMessages,
	pinId: pinId,
	alertPin: alertPin,
	endPin: endPin,
};
