import Message from "pebble/message";
import Vibes from "pebble/vibes";
import WakeUp from "pebble/wakeup";

// --- UI strings (fr/en) ---
// The language is resolved phone-side (config page choice, or the watch's
// own language via Pebble.getActiveWatchInfo() on "auto") and arrives in
// configMeta. English until then -- only the boot-time "Loading..." is
// ever shown before the first configMeta.
const STRINGS = {
	en: {
		loading: "Loading...",
		noStops: "No stop configured",
		configureHint: "Add stops in the Pebble app",
		cycleHint: "Up / Down to switch",
		network: "Network error",
		noRealtimeData: "No real-time data for this stop",
		quotaExceeded: "API quota exceeded",
		rateLimited: "Paused (call guard), back in {n} min",
		pausedFor: "Call guard pause: {n} min",
		updatedAgo: "Updated {n} min ago",
		invalidKey: "Invalid API key",
		invalidStop: "Invalid stop, re-add it in the settings",
		cancelled: "Cancelled",
		atStop: "At platform",
		towards: "To",
		thenLabel: "Then",
		settings: "Settings",
		quotaRemaining: "PRIM quota: {n} left",
		quotaUnknown: "PRIM quota: unknown",
		noAlert: "No disruption",
		alertsUnavailable: "Traffic info unavailable",
		alertsStale: "Not up to date",
		noDeparture: "No known departure",
		nextAlert: "Select: next",
		trafficInfoCount: "Traffic info: {n}",
		phoneDisconnected: "Phone disconnected",
	},
	fr: {
		loading: "Chargement...",
		noStops: "Aucun arrêt configuré",
		configureHint: "Ajoute-en dans l'app Pebble",
		cycleHint: "Haut / Bas pour changer",
		network: "Erreur réseau",
		noRealtimeData: "Pas de temps réel pour cet arrêt",
		quotaExceeded: "Quota API dépassé",
		rateLimited: "Pause anti-quota, reprise dans {n} min",
		pausedFor: "Pause quota : {n} min",
		updatedAgo: "Màj il y a {n} min",
		invalidKey: "Clé API invalide",
		invalidStop: "Arrêt invalide, ré-ajoute-le dans les réglages",
		cancelled: "Supprimé",
		atStop: "À quai",
		towards: "Vers",
		thenLabel: "Puis",
		settings: "Réglages",
		quotaRemaining: "Quota PRIM : {n} restant(s)",
		quotaUnknown: "Quota PRIM : inconnu",
		noAlert: "Pas de perturbation",
		alertsUnavailable: "Info trafic indisponible",
		alertsStale: "Info pas à jour",
		noDeparture: "Plus de départ connu",
		nextAlert: "Select : suivante",
		trafficInfoCount: "Info trafic : {n}",
		phoneDisconnected: "Téléphone déconnecté",
	},
};
let language = "en";

/**
 * @param {string} key - A STRINGS entry.
 * @param {number|string} [n] - Replaces "{n}" in the string, if any.
 * @returns {string} The string in the current language.
 */
function t(key, n) {
	const table = STRINGS[language] || STRINGS.en;
	const str = table[key] || STRINGS.en[key] || key;
	return n === undefined ? str : str.replace("{n}", String(n));
}

// --- Diagnostics ---
// Store builds can't be debugged live: there is no xsbug on Pebble and
// nobody is watching `pebble logs` when a crash happens. An exception thrown
// from anything the runtime calls back into (AppMessage, timers, buttons) is
// fatal -- Alloy aborts the app ("Alloy: Fatal Error") -- and XS reports a
// bad call as a bare "call: not a function", naming neither the function nor
// the line. So every such entry point runs through safe()/run() below, which
// keep the app alive and record the error in a small journal instead: the
// entry point's name, the message, the stack when XS has one, and a trail of
// the last events. The journal lives in the watch's localStorage until it
// reaches pkjs (see tryWriteDiag), which keeps it for the config page's
// Diagnostic section.

const DIAG_LOG_KEY = "diagLog";
const DIAG_SESSION_KEY = "diagSession";
const DIAG_MAX_ENTRIES = 5;
const DIAG_MAX_TRAIL = 12;
// Fits easily in one AppMessage (the outbox is several KB).
const DIAG_MAX_TEXT = 2000;

const trail = [];

/** @param {string} event - Short ASCII label, kept in the trail of recent events. */
function note(event) {
	trail.push(event);
	if (trail.length > DIAG_MAX_TRAIL) trail.shift();
}

/** @returns {string|null} localStorage value, null if missing or unreadable. */
function storageGet(key) {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

/** localStorage write that never throws (diagnostics must not crash the app). */
function storageSet(key, value) {
	try {
		localStorage.setItem(key, value);
	} catch (error) {
		console.log(`storage write failed for ${key}: ${error}`);
	}
}

/** localStorage delete that never throws. */
function storageRemove(key) {
	try {
		localStorage.removeItem(key);
	} catch (error) {
		console.log(`storage delete failed for ${key}: ${error}`);
	}
}

/** @returns {object[]} Journal entries not yet handed to pkjs. */
function loadDiagLog() {
	const raw = storageGet(DIAG_LOG_KEY);
	if (!raw) return [];
	try {
		const list = JSON.parse(raw);
		return Array.isArray(list) ? list : [];
	} catch {
		return [];
	}
}

// True while the journal holds entries pkjs hasn't received yet.
let diagPending = false;

/**
 * Appends one entry to the journal (the oldest ones go past DIAG_MAX_ENTRIES).
 * @param {string} where - Entry point that failed.
 * @param {*} message
 * @param {*} [stack]
 */
function recordDiag(where, message, stack) {
	try {
		const log = loadDiagLog();
		log.push({
			t: Date.now(),
			w: where,
			m: String(message).slice(0, 200),
			s: stack ? String(stack).slice(0, 300) : "",
			tr: trail.join(" > "),
		});
		while (log.length > DIAG_MAX_ENTRIES) log.shift();
		storageSet(DIAG_LOG_KEY, JSON.stringify(log));
		diagPending = true;
		console.log(`diag ${where}: ${message}`);
	} catch (error) {
		console.log(`diag record failed: ${error}`);
	}
}

/** Records `error` and tries to hand the journal to pkjs right away. */
function reportError(where, error) {
	// biome-ignore lint/complexity/useOptionalChain: no `?.` on this XS build, see requestRefresh
	recordDiag(where, error, error && error.stack);
	try {
		flushOutbox(); // sends the journal first, if the slot is free
	} catch (flushError) {
		console.log(`diag flush failed: ${flushError}`);
	}
}

/**
 * @param {string} where - Name recorded if `fn` throws.
 * @param {Function} fn
 * @returns {Function} `fn` with the same `this` and arguments, recording
 *   instead of propagating any exception (which would abort the app).
 */
function safe(where, fn) {
	return function (...args) {
		try {
			return fn.apply(this, args);
		} catch (error) {
			reportError(where, error);
			return undefined;
		}
	};
}

/**
 * Runs `fn` now, recording instead of propagating any exception.
 * @param {string} where
 * @param {Function} fn
 * @param {*} [fallback] - Returned when `fn` throws.
 */
function run(where, fn, fallback) {
	try {
		return fn();
	} catch (error) {
		reportError(where, error);
		return fallback;
	}
}

// How far the previous launch got. Written at a few milestones only (flash
// wear): "boot" at launch, "ready" once the config is loaded, "ok" a little
// later, "exit" when Back closes the app. A launch left at "boot" or "ready"
// was cut short during startup -- the trace of what safe() can't catch: an
// engine abort (memory full), a native fault, a frozen watch that had to be
// restarted.
const SESSION_OK_DELAY_MS = 20000;
const previousSession = storageGet(DIAG_SESSION_KEY);
if (previousSession === "boot" || previousSession === "ready") {
	recordDiag(
		"previousLaunch",
		`stopped at "${previousSession}" (crash, freeze, or closed while loading)`
	);
}
let sessionStage = "";

/** @param {"boot"|"ready"|"ok"|"exit"} stage */
function markSession(stage) {
	if (sessionStage === stage) return;
	sessionStage = stage;
	storageSet(DIAG_SESSION_KEY, stage);
}
markSession("boot");
diagPending = loadDiagLog().length > 0;

// --- Config state ---
// Filled from the configMeta/configStop/configLine items pkjs sends one at a
// time (sendConfigToWatch in src/pkjs/index.js, CONFIG_SEND_GAP_MS apart).

let stops = [];
let alertLines = [];
let configLoaded = false;
// Received but not used yet: they belong to the traffic alerts.
let schedule = { days: 0, startMinutes: 0, endMinutes: 0, timeline: false };
// Vibrate when the next departure of the stop on screen gets this close, in
// minutes (0 = off). Set on the config page.
let vibrateMinutes = 0;

let pendingConfigCount = 0;
let pendingStops = [];
let pendingLines = [];
// Indices received for the batch being assembled, reset by each configMeta.
// A Set rather than a counter, so a duplicate delivery can't complete a
// batch that is still missing an item.
let receivedConfigIndices = new Set();

const CONFIG_ITEM_TYPES = ["configMeta", "configStop", "configLine"];

// --- Watch <-> phone messages ---
// `pebble/message` numbers keys 10000 + their index in package.json's
// pebble.messageKeys (that's what pkjs and the AppMessage transport use), so
// this list must be an exact copy of it, same order.
// !!! KEEP IN EXACT SYNC WITH `pebble.messageKeys` IN package.json !!!
// (test/message-keys.test.js fails when they differ.)
const ALL_MESSAGE_KEYS = [
	"itemIndex",
	"itemCount",
	"itemType",
	"scheduleDaysBitmask",
	"scheduleStartMinutes",
	"scheduleEndMinutes",
	"timelineEnabled",
	"stopRef",
	"lineRef",
	"lineName",
	"stopName",
	"state",
	"destination",
	"minutes",
	"atStop",
	"cancelled",
	"lineColor",
	"lineTextColor",
	"minutes2",
	"quotaRemaining",
	"language",
	"destStopRef",
	"destStopName",
	"mission",
	"mission2",
	"staleReason",
	"staleAge",
	"pauseMinutes",
	"diagText",
	"departTime",
	"departTime2",
	"vibrateMinutes",
	"alertCount",
	"alertText",
	"autoOpen",
	"screens",
	"alertPart",
	"configId",
];
const MESSAGE_KEY_CODES = new Map(
	ALL_MESSAGE_KEYS.map((key, index) => [key, 10000 + index])
);

// A single Message instance for everything. The native layer hands each
// incoming message to exactly one instance (the newest one owning the
// message's first known key), and an instance that writes suspends the
// others: with two instances, routing depended on the order of the keys
// and the two kept suspending each other (pebble-appmessage.c in the
// Moddable SDK). Everything outgoing goes through flushOutbox().
const message = new Message({
	keys: MESSAGE_KEY_CODES,
	// AppMessage buffers, taken from the app's RAM (the default is the
	// 8,200-byte maximum each way). The largest message in is an alertUpdate
	// (under 1 KB), the largest out the error journal (DIAG_MAX_TEXT chars).
	input: 2048,
	output: 2560,
	onReadable: safe("message.onReadable", function () {
		const msg = this.read();
		if (!msg) return; // nothing queued
		const item = {};
		msg.forEach((value, key) => {
			item[key] = value;
		});
		note(
			`rx ${item.itemType} ${item.itemIndex === undefined ? item.state : item.itemIndex}`
		);
		if (item.itemType === "departureUpdate") {
			handleDepartureUpdate(item);
		} else if (item.itemType === "alertUpdate") {
			handleAlertUpdate(item);
		} else if (CONFIG_ITEM_TYPES.includes(item.itemType)) {
			handleConfigItem(item);
		}
	}),
	// Edge-triggered: fires when the single outbound slot frees up (or the
	// phone side becomes ready), not when idle. Writes are attempted
	// directly, and a busy slot is retried from here.
	onWritable: safe("message.onWritable", () => {
		flushOutbox();
	}),
});

// --- Outbox ---
// Writers of the single outbound slot, in priority order: the error
// journal, a config resend request, then refreshStop requests.
let configRequestPending = false;
let alertRequestPending = false;
const refreshQueue = [];

/**
 * @param {*} error - What Message.write() threw.
 * @returns {boolean} True when it only means the outbound slot is busy
 *   (or the phone side isn't ready yet): retry on onWritable. Anything else
 *   ("unexpected value", "overflow"...) would fail again on every retry.
 */
function isBusyWriteError(error) {
	const text = String(error);
	return text.includes("not writable") || text.includes("output_begin");
}

/**
 * @param {Map<string, *>} map - Keys from ALL_MESSAGE_KEYS.
 * @returns {"sent"|"busy"|"failed"} "failed" is recorded in the journal;
 *   the caller drops the message.
 */
function writeMessage(map) {
	try {
		message.write(map);
		note(`tx ${map.get("itemType")}`);
		return "sent";
	} catch (error) {
		if (isBusyWriteError(error)) return "busy";
		recordDiag(`write ${map.get("itemType")}`, error);
		return "failed";
	}
}

/**
 * Hands the journal to pkjs (itemType "diagReport"), oldest entries dropped
 * if it doesn't fit in one message.
 * @returns {boolean} False only when the outbound slot is busy.
 */
function writeDiag() {
	const log = loadDiagLog();
	let text = JSON.stringify(log);
	while (text.length > DIAG_MAX_TEXT && log.length > 1) {
		log.shift();
		text = JSON.stringify(log);
	}
	// Cleared before writing: a failed write records a new entry, which
	// must not be wiped with the old ones.
	diagPending = false;
	if (log.length === 0) return true;
	storageRemove(DIAG_LOG_KEY);
	const result = writeMessage(
		new Map([
			["itemType", "diagReport"],
			["diagText", text],
		])
	);
	if (result !== "busy") return true;
	storageSet(DIAG_LOG_KEY, text); // put back for the retry
	diagPending = true;
	return false;
}

/**
 * @param {{stopRef: string, lineRef: string, lineName: string,
 *   destStopRef?: string}} stop
 * @returns {Map<string, *>} The refreshStop request for `stop`.
 */
function refreshStopMessage(stop) {
	const m = new Map([
		["itemType", "refreshStop"],
		["stopRef", stop.stopRef],
		["lineRef", stop.lineRef],
		["lineName", stop.lineName],
	]);
	// Omitted when empty, never sent as "" (see pkjs sendConfigToWatch).
	if (stop.destStopRef) m.set("destStopRef", stop.destStopRef);
	return m;
}

/** Writes whatever is waiting, in priority order, while the slot is free. */
function flushOutbox() {
	if (diagPending && !writeDiag()) return;
	if (configRequestPending) {
		const result = writeMessage(new Map([["itemType", "configResendRequest"]]));
		if (result === "busy") return;
		configRequestPending = false;
		// The wait for the config (and the next try) starts once the request
		// is out, however long the phone took to become reachable.
		if (!configLoaded) {
			clearConfigResendTimeout();
			scheduleConfigResendTimeout();
		}
	}
	if (alertRequestPending) {
		if (writeMessage(new Map([["itemType", "refreshAlerts"]])) === "busy")
			return;
		alertRequestPending = false;
	}
	while (refreshQueue.length > 0) {
		if (writeMessage(refreshStopMessage(refreshQueue[0])) === "busy") return;
		refreshQueue.shift(); // sent, or failed and recorded
	}
}

// --- Config loading ---
// pkjs pushes the config on its own "ready", but that push usually fails at
// boot (the watch's inbox isn't open yet), so the watch also asks for it,
// right away and then every CONFIG_RESEND_TIMEOUT_MS until the first load
// completes. A later config update losing an item isn't covered.
let configResendTimer = null;
let configResendCount = 0;
const CONFIG_RESEND_TIMEOUT_MS = 1500;
const MAX_CONFIG_RESENDS = 3;

/** Arms the config resend timer, if not already armed. */
function scheduleConfigResendTimeout() {
	if (configResendTimer !== null) return;
	configResendTimer = setTimeout(
		safe("configResendTimeout", requestConfigResend),
		CONFIG_RESEND_TIMEOUT_MS
	);
}

/** Disarms the config resend timer, if armed. */
function clearConfigResendTimeout() {
	if (configResendTimer !== null) {
		clearTimeout(configResendTimer);
		configResendTimer = null;
	}
}

/** Asks pkjs for a full config resend, up to MAX_CONFIG_RESENDS times. */
function requestConfigResend() {
	configResendTimer = null;
	if (configLoaded) return;
	if (configResendCount >= MAX_CONFIG_RESENDS) {
		console.log(`config still not loaded after ${MAX_CONFIG_RESENDS} requests`);
		return;
	}
	// The last request is still waiting for the phone: no new one, and no
	// retry spent until one is actually sent. The timer for the next try is
	// armed by flushOutbox once this one is written.
	if (!configRequestPending) {
		configResendCount++;
		note(`resend ${configResendCount}`);
		configRequestPending = true;
	}
	flushOutbox();
}

/**
 * Accumulates one configMeta/configStop/configLine item, committing the
 * batch to stops/alertLines and calling onConfigReady() once every
 * expected item has arrived.
 * @param {object} item - Decoded AppMessage item (itemType + fields).
 */
function handleConfigItem(item) {
	if (!configLoaded) scheduleConfigResendTimeout();

	if (item.itemType === "configMeta") {
		schedule = {
			days: item.scheduleDaysBitmask,
			startMinutes: item.scheduleStartMinutes,
			endMinutes: item.scheduleEndMinutes,
			timeline: !!item.timelineEnabled,
		};
		if (STRINGS[item.language]) language = item.language;
		autoOpen = !!item.autoOpen;
		screensMode = typeof item.screens === "number" ? item.screens : 0;
		vibrateMinutes =
			typeof item.vibrateMinutes === "number" ? item.vibrateMinutes : 0;
		pendingConfigId = typeof item.configId === "number" ? item.configId : null;
		pendingConfigCount = item.itemCount;
		pendingStops = [];
		pendingLines = [];
		receivedConfigIndices = new Set();
	} else if (item.itemType === "configStop") {
		pendingStops.push({
			stopRef: item.stopRef,
			lineRef: item.lineRef,
			lineName: item.lineName,
			stopName: item.stopName,
			lineColor: item.lineColor || "#888888",
			lineTextColor: item.lineTextColor || "#ffffff",
			destStopRef: item.destStopRef || "",
			destStopName: item.destStopName || "",
		});
	} else if (item.itemType === "configLine") {
		pendingLines.push({ lineRef: item.lineRef, lineName: item.lineName });
	}

	receivedConfigIndices.add(item.itemIndex);
	if (
		pendingConfigCount > 0 &&
		receivedConfigIndices.size === pendingConfigCount
	) {
		stops = pendingStops;
		alertLines = pendingLines;
		pendingConfigCount = 0; // a late duplicate can't complete it again
		configLoaded = true;
		clearConfigResendTimeout();
		onConfigReady();
	}
}

/** A complete config arrived (first load or a settings change). */
function onConfigReady() {
	// A new config may have fixed the API key or the stop: forget every
	// known state, permanent errors included (see PERMANENT_ERROR_STATES).
	departures.clear();
	pendingAlerts.clear();
	// Requests asked under the old config: their replies are dropped (see
	// configId), and the new config's refresh is asked right away below.
	configId = pendingConfigId;
	for (const key of Array.from(pendingRefresh.keys())) clearPendingRefresh(key);
	// Traffic info of lines the new config no longer watches would
	// otherwise keep their screen until the app is closed.
	for (const lineRef of Array.from(lineAlerts.keys())) {
		const watched =
			stops.some((stop) => stop.lineRef === lineRef) ||
			alertLines.some((line) => line.lineRef === lineRef);
		if (!watched) lineAlerts.delete(lineRef);
	}
	items = buildItemList();
	if (selectedIndex >= items.length) selectedIndex = 0;
	startRefreshTimer();
	render();
	requestRefresh();
	requestAlerts();
	startAlertTimer();
	run("scheduleCommuteWakeup", scheduleCommuteWakeup);
	if (sessionStage === "boot") {
		markSession("ready");
		setTimeout(
			safe("sessionOk", () => {
				if (sessionStage === "ready") markSession("ok");
			}),
			SESSION_OK_DELAY_MS
		);
	}
}

// --- Traffic alerts ---
// pkjs fetches PRIM general-message for the watched lines (the tracked
// stops' lines plus those added in the alerts section) and answers a
// refreshAlerts request with one alertUpdate per line. Asked when the
// config loads and every ALERT_REFRESH_MS while the app is open.

const ALERT_REFRESH_MS = 10 * 60000;
// lineRef -> { lineName, count, pages, color, textColor, stale } from the
// latest complete alertUpdate.
const lineAlerts = new Map();
// The same for a line whose further parts (alertPart) are still to come.
const pendingAlerts = new Map();
let alertTimer = null;
// Open the app when the schedule starts (config page option).
let autoOpen = false;
const WAKEUP_ID_KEY = "commuteWakeupId";

/** Asks pkjs for the watched lines' traffic info. */
function requestAlerts() {
	if (stops.length === 0 && alertLines.length === 0) return;
	alertRequestPending = true;
	flushOutbox();
}

/** Starts the alerts refresh timer, once. */
function startAlertTimer() {
	if (alertTimer !== null) return;
	alertTimer = setInterval(safe("alertTick", requestAlerts), ALERT_REFRESH_MS);
}

/** @param {object} item - A decoded alertUpdate. */
function handleAlertUpdate(item) {
	// A reply asked for before a config change can arrive after it.
	if (!isWatchedLine(item.lineRef)) return;
	const text = item.alertText ? String(item.alertText).split("\n") : [];
	let entry;
	if (item.alertPart) {
		// A further part of a line's messages: appended to the parts before
		// it, only in order and for the same count (else dropped: the next
		// check sends them all again).
		entry = pendingAlerts.get(item.lineRef);
		if (
			!entry ||
			entry.nextPart !== item.alertPart ||
			entry.count !== (item.alertCount || 0)
		) {
			pendingAlerts.delete(item.lineRef);
			return;
		}
		entry.pages = entry.pages.concat(text);
		entry.nextPart += 1;
	} else {
		entry = {
			lineName: item.lineName,
			count: item.alertCount || 0,
			pages: text,
			color: item.lineColor || "#888888",
			textColor: item.lineTextColor || "#ffffff",
			// Set when the last check failed: the messages (if any) are older.
			stale: typeof item.staleReason === "string",
			nextPart: 1,
		};
	}
	if (entry.pages.length > entry.count) {
		pendingAlerts.delete(item.lineRef);
		return;
	}
	// Shown once every message is there (one per page).
	if (entry.pages.length < entry.count) {
		pendingAlerts.set(item.lineRef, entry);
		return;
	}
	pendingAlerts.delete(item.lineRef);
	// One message per page, or more when it doesn't fit the body.
	let fitted = [];
	for (const message of entry.pages) fitted = fitted.concat(fitPages(message));
	entry.pages = fitted;
	const pages = entry.pages;
	const previous = lineAlerts.get(item.lineRef);
	lineAlerts.set(item.lineRef, entry);
	// New or ended messages on the line being read: back to its first page
	// (the same messages sent again keep the page).
	const current = items[selectedIndex];
	const changed = !previous || previous.pages.join("\n") !== pages.join("\n");
	// biome-ignore lint/complexity/useOptionalChain: see requestRefresh
	if (
		changed &&
		current &&
		current.type === "alert" &&
		current.lineRef === item.lineRef
	) {
		alertPage = 0;
	}
	rebuildItems();
	render();
}

/**
 * @param {string} text - One alert message.
 * @returns {string[]} It cut into pages that each fit the alert body
 *   (LAYOUT.body, smallStyle), measured as the Text view wraps it: at
 *   spaces, and a word wider than a line (a long URL) broken with "\n"
 *   where a line ends, so no text can run off the screen whatever its
 *   glyphs.
 */
function fitPages(text) {
	const [, inset, height] = LAYOUT.body;
	const width = screen.width - 2 * inset - 2;
	const lineHeight = smallStyle.measure("Ag").height;
	const maxLines = Math.max(1, Math.floor(height / lineHeight));
	const fits = (s) => smallStyle.measure(s).width <= width;
	// Words, each wider-than-a-line one as pieces glued without a space.
	const pieces = [];
	for (const word of String(text).split(" ")) {
		let rest = word;
		let glue = " ";
		while (rest.length > 1 && !fits(rest)) {
			let n = rest.length - 1;
			while (n > 1 && !fits(rest.slice(0, n))) n -= 1;
			pieces.push({ text: rest.slice(0, n), glue: glue });
			rest = rest.slice(n);
			// Piu doesn't break inside a word: the line break is ours.
			glue = "\n";
		}
		pieces.push({ text: rest, glue: glue });
	}
	const pages = [];
	let page = "";
	let line = "";
	let lines = 1;
	for (const piece of pieces) {
		const longer = line ? line + piece.glue + piece.text : piece.text;
		if (line && !fits(longer)) {
			lines += 1;
			line = piece.text;
			if (lines > maxLines) {
				pages.push(page);
				page = "";
				lines = 1;
			}
		} else {
			line = longer;
		}
		page = page ? page + piece.glue + piece.text : piece.text;
	}
	if (page) pages.push(page);
	return pages;
}

// Message shown on an alert screen (Select pages through a line's
// messages); back to 0 when the screen changes.
let alertPage = 0;

/** @returns {boolean} True for a tracked stop's line or an alerts-section line. */
function isWatchedLine(lineRef) {
	return (
		stops.some((stop) => stop.lineRef === lineRef) ||
		alertLines.some((line) => line.lineRef === lineRef)
	);
}

/** Rebuilds the item list, staying on the item that was on screen. */
function rebuildItems() {
	const current = items[selectedIndex];
	const key = current ? itemKey(current) : "";
	items = buildItemList();
	const index = items.findIndex((item) => itemKey(item) === key);
	selectedIndex =
		index === -1
			? Math.min(selectedIndex, Math.max(0, items.length - 1))
			: index;
}

/** @returns {string} A stable key for an item of the list. */
function itemKey(item) {
	if (item.type === "stop") return `stop|${departureKey(item)}`;
	if (item.type === "alert") return `alert|${item.lineRef}`;
	return item.type;
}

/**
 * @param {number} now - Epoch ms.
 * @returns {?number} When the schedule next starts (local time), at least a
 *   minute from now; null without days or start time.
 */
function nextScheduleStart(now) {
	if (!schedule.days) return null;
	for (let d = 0; d <= 7; d++) {
		const date = new Date(now);
		date.setDate(date.getDate() + d);
		date.setHours(
			Math.floor(schedule.startMinutes / 60),
			schedule.startMinutes % 60,
			0,
			0
		);
		if (date.getTime() > now + 60000 && schedule.days & (1 << date.getDay())) {
			return date.getTime();
		}
	}
	return null;
}

/**
 * Keeps one wakeup at the next schedule start when autoOpen is on (the app
 * then opens by itself, with departures and alerts up to date), none
 * otherwise. Re-done at every config load, so it rolls forward daily.
 */
function scheduleCommuteWakeup() {
	const stored = storageGet(WAKEUP_ID_KEY);
	if (stored !== null) {
		try {
			WakeUp.cancel(Number(stored));
		} catch (error) {
			console.log(`wakeup cancel: ${error}`);
		}
		storageRemove(WAKEUP_ID_KEY);
	}
	if (!autoOpen) return;
	const at = nextScheduleStart(Date.now());
	if (at === null) return;
	const id = WakeUp.schedule(at, 1, false);
	if (typeof id === "number" && id >= 0) storageSet(WAKEUP_ID_KEY, String(id));
}

// --- Departures ---
// The watch doesn't fetch PRIM itself (an embeddedjs fetch with a real URL
// and API key ran out of engine memory on real hardware): it sends a
// refreshStop request for the stop on screen, pkjs fetches and replies with
// a departureUpdate, stored here.

const departures = new Map();

/**
 * Key for `departures` and pendingRefresh. stopRef alone isn't unique: a
 * stop area (RER/Transilien) is shared by every line calling there, and one
 * stop+line can be tracked towards several arrival stops.
 * @param {{stopRef: string, lineRef: string, destStopRef?: string}} item
 * @returns {string}
 */
function departureKey(item) {
	return `${item.stopRef}|${item.lineRef}|${item.destStopRef || ""}`;
}

// Latest PRIM quota count pkjs reported (it attaches it to every reply),
// shown on the settings screen. null until the first reply.
let quotaRemaining = null;

// Upper end of the 30-60 s refresh rule: the PRIM quota is the scarce
// resource, and departures are only shown to the minute anyway.
const REFRESH_INTERVAL_MS = 60000;
// While the next departure is more than FAR_DEPARTURE_MINUTES away, times
// are refreshed every FAR_REFRESH_INTERVAL_MS instead: the countdown runs on
// the watch, and far times change little.
const FAR_DEPARTURE_MINUTES = 10;
const FAR_REFRESH_INTERVAL_MS = 3 * 60000;
// Timer ticks land a little before a full interval after the last reply.
const REFRESH_SLACK_MS = 5000;
// Clears the spinner when a reply never comes (the refresh timer asks again).
const REFRESH_INDICATOR_TIMEOUT_MS = 15000;
// A fast reply still shows the spinner this long, so it doesn't flash for
// one frame and read as a glitch.
const MIN_REFRESH_INDICATOR_MS = 1500;
// PRIM replies retrying can't fix: automatic refreshes skip them (Select
// still retries, and a new config clears them).
const PERMANENT_ERROR_STATES = ["invalidKey", "invalidStop"];

// departureKey -> { startedAt, timeout } for each refresh in flight.
const pendingRefresh = new Map();
// The phone's id for the config loaded (configMeta.configId), echoed in
// each departureUpdate as it was when the request was answered: a reply to
// a request made under an earlier config (an invalidKey for the old API
// key) is dropped, whatever order the replies come in.
let configId = null;
let pendingConfigId = null;
let refreshTimer = null;

// Plain-ASCII spinner: the Gothic bitmap font has no arrow or spinner glyph.
const SPINNER_FRAMES = ["-", "\\", "|", "/"];
let spinnerFrame = 0;
let spinnerTimer = null;

/** Runs the spinner animation only while a refresh is in flight. */
function updateSpinner() {
	if (pendingRefresh.size > 0 && spinnerTimer === null) {
		spinnerTimer = setInterval(
			safe("spinnerTick", () => {
				spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
				render();
			}),
			250
		);
	} else if (pendingRefresh.size === 0 && spinnerTimer !== null) {
		clearInterval(spinnerTimer);
		spinnerTimer = null;
	}
}

/** @param {string} key - departureKey of a refresh that just started. */
function markRefreshPending(key) {
	if (pendingRefresh.has(key)) return; // keeps the first start time
	const entry = { startedAt: Date.now(), timeout: null };
	entry.timeout = setTimeout(
		safe("refreshIndicatorTimeout", () => {
			entry.timeout = null; // fired: nothing to clear
			clearPendingRefresh(key);
			render();
		}),
		REFRESH_INDICATOR_TIMEOUT_MS
	);
	pendingRefresh.set(key, entry);
	updateSpinner();
}

/** @param {string} key - departureKey whose refresh is over. */
function clearPendingRefresh(key) {
	const entry = pendingRefresh.get(key);
	if (!entry) return;
	if (entry.timeout !== null) clearTimeout(entry.timeout);
	pendingRefresh.delete(key);
	updateSpinner();
}

/** @param {object} item - A decoded departureUpdate. */
function handleDepartureUpdate(item) {
	if (typeof item.quotaRemaining === "number") {
		quotaRemaining = item.quotaRemaining;
	}
	const key = departureKey(item);
	if (
		typeof item.configId === "number" &&
		configId !== null &&
		item.configId !== configId
	) {
		return;
	}
	const entry = pendingRefresh.get(key);
	const elapsed = entry
		? Date.now() - entry.startedAt
		: MIN_REFRESH_INDICATOR_MS;
	if (elapsed >= MIN_REFRESH_INDICATOR_MS) {
		clearPendingRefresh(key);
	} else {
		setTimeout(
			safe("spinnerHold", () => {
				clearPendingRefresh(key);
				render();
			}),
			MIN_REFRESH_INDICATOR_MS - elapsed
		);
	}
	// During a call-guard pause, a network failure or an exceeded quota, the
	// last good times stay on screen with their age and the reason, rather
	// than a bare error: they're still the best information available. pkjs
	// also sends its own saved copy as an "ok" reply carrying
	// staleReason/staleAge, which covers a relaunched app.
	const previous = departures.get(key);
	const staleReason =
		item.state === "ok" && typeof item.staleReason === "string"
			? item.staleReason
			: undefined;
	const failure = staleReason || item.state;
	if (
		previous &&
		previous.state === "ok" &&
		(failure === "rateLimited" ||
			failure === "network" ||
			failure === "quotaExceeded")
	) {
		previous.pauseMinutes =
			failure === "rateLimited"
				? staleReason
					? item.pauseMinutes
					: item.minutes
				: undefined;
		previous.staleReason = failure === "rateLimited" ? undefined : failure;
		render();
		return;
	}
	departures.set(key, {
		receivedAt: Date.now() - (staleReason ? (item.staleAge || 0) * 60000 : 0),
		state: item.state,
		pauseMinutes: staleReason === "rateLimited" ? item.pauseMinutes : undefined,
		staleReason: staleReason === "rateLimited" ? undefined : staleReason,
		line: item.lineName,
		destination: item.destination,
		minutes: item.minutes,
		minutes2: item.minutes2, // undefined without a following departure
		// Epoch seconds, when known: the minutes are counted down from these.
		departTime: item.departTime,
		departTime2: item.departTime2,
		atStop: !!item.atStop,
		cancelled: !!item.cancelled,
		mission: item.mission || "",
		mission2: item.mission2 || "",
	});
	render();
	checkApproach();
}

/**
 * @param {number} epochSeconds
 * @returns {number} Whole minutes from now (negative once it's passed).
 */
function minutesUntil(epochSeconds) {
	return Math.round((epochSeconds * 1000 - Date.now()) / 60000);
}

/**
 * @param {object} dep - A departures entry.
 * @returns {?{minutes: number, departTime: ?number, minutes2: ?number,
 *   mission: string, mission2: string, destination: string,
 *   shifted: boolean}} The next departure, its minutes counted down from its
 *   time when known. Once the first has left (over a minute ago) the
 *   following one takes its place until the next reply, with its own
 *   mission and no destination (only the first one's is known). Null once
 *   every known train has left.
 */
function nextDepartures(dep) {
	// A train at the platform comes without a time (pkjs sends none): seen
	// there over AT_STOP_FOR_MS ago with no fresh reply, it has most likely
	// left, and a timed following train takes over.
	if (
		dep.atStop &&
		typeof dep.departTime !== "number" &&
		typeof dep.departTime2 === "number" &&
		Date.now() - dep.receivedAt > AT_STOP_FOR_MS
	) {
		const second = minutesUntil(dep.departTime2);
		if (second < -1) return null;
		return {
			minutes: Math.max(0, second),
			departTime: dep.departTime2,
			minutes2: null,
			mission: dep.mission2,
			mission2: "",
			destination: "",
			shifted: true,
		};
	}
	if (typeof dep.departTime !== "number") {
		return {
			minutes: dep.minutes,
			departTime: null,
			minutes2: typeof dep.minutes2 === "number" ? dep.minutes2 : null,
			mission: dep.mission,
			mission2: dep.mission2,
			destination: dep.destination,
			shifted: false,
		};
	}
	const first = minutesUntil(dep.departTime);
	const second =
		typeof dep.departTime2 === "number" ? minutesUntil(dep.departTime2) : null;
	if (first < -1) {
		if (second === null || second < -1) return null;
		return {
			minutes: Math.max(0, second),
			departTime: dep.departTime2,
			minutes2: null,
			mission: dep.mission2,
			mission2: "",
			destination: "",
			shifted: true,
		};
	}
	return {
		minutes: Math.max(0, first),
		departTime: dep.departTime,
		minutes2: second === null ? null : Math.max(0, second),
		mission: dep.mission,
		mission2: dep.mission2,
		destination: dep.destination,
		shifted: false,
	};
}

// How long (ms) a train seen at the platform is shown there without a
// fresh reply before the following one takes over (see nextDepartures).
const AT_STOP_FOR_MS = 3 * 60000;

// Approach vibration: once per departure, when the countdown of the stop on
// screen goes from above vibrateMinutes to at or below it. A train already
// that close when the screen opens doesn't vibrate.
const seenAboveThreshold = new Set(); // departTimes seen above the threshold
const vibrated = new Set(); // departTimes already vibrated for

/** Vibrates if the departure on screen just reached vibrateMinutes. */
function checkApproach() {
	if (vibrateMinutes <= 0) return;
	const item = items[selectedIndex];
	// biome-ignore lint/complexity/useOptionalChain: see requestRefresh
	if (!item || item.type !== "stop") return;
	const dep = departures.get(departureKey(item));
	if (!dep || dep.state !== "ok") return;
	const next = nextDepartures(dep);
	if (next === null || next.departTime === null) return;
	// The first train's flags. A train that took over after one at the
	// platform has left still vibrates; after a cancelled one it is
	// cancelled too (pkjs ranks cancelled trains last).
	if (dep.cancelled || (dep.atStop && !next.shifted)) return;
	if (next.minutes > vibrateMinutes) {
		seenAboveThreshold.add(next.departTime);
	} else if (
		seenAboveThreshold.has(next.departTime) &&
		!vibrated.has(next.departTime)
	) {
		vibrated.add(next.departTime);
		note("vibrate");
		Vibes.doublePulse();
	}
	if (seenAboveThreshold.size > 20) seenAboveThreshold.clear();
	if (vibrated.size > 20) vibrated.clear();
}

/**
 * Asks pkjs for the departures of the stop on screen (only that one: no
 * PRIM quota or Bluetooth spent on stops nobody is looking at).
 * @param {boolean} [manual] - Select: retries even a permanent error, and
 *   asks again even while a request is in flight.
 * Automatic requests (timer, Up/Down) are skipped while the data is fresh
 * enough (refreshAge), so cycling screens doesn't spend a call per press.
 */
function requestRefresh(manual) {
	const item = items[selectedIndex];
	// Not `item?.type`: kept as written on real hardware (see git history).
	// biome-ignore lint/complexity/useOptionalChain: see above
	if (!item || item.type !== "stop") return;
	const key = departureKey(item);
	const known = departures.get(key);
	if (!manual && known && PERMANENT_ERROR_STATES.includes(known.state)) {
		return;
	}
	if (
		!manual &&
		known &&
		Date.now() - known.receivedAt < refreshAge(known) - REFRESH_SLACK_MS
	) {
		return; // still fresh enough (timer tick or Up/Down)
	}
	if (!manual && pendingRefresh.has(key)) return; // already asked
	if (!refreshQueue.some((queued) => departureKey(queued) === key)) {
		refreshQueue.push(item);
	}
	markRefreshPending(key);
	render(); // shows the spinner right away
	flushOutbox();
}

/**
 * @param {object} dep - A departures entry.
 * @returns {number} How old it may get before an automatic refresh.
 */
function refreshAge(dep) {
	if (dep.state !== "ok" || dep.staleReason || dep.pauseMinutes !== undefined) {
		return REFRESH_INTERVAL_MS;
	}
	if (dep.atStop || dep.cancelled) return REFRESH_INTERVAL_MS;
	const next = nextDepartures(dep);
	return next !== null && next.minutes > FAR_DEPARTURE_MINUTES
		? FAR_REFRESH_INTERVAL_MS
		: REFRESH_INTERVAL_MS;
}

/** Starts the foreground refresh timer, once. */
function startRefreshTimer() {
	if (refreshTimer !== null) return;
	refreshTimer = setInterval(
		safe("refreshTick", () => {
			note("tick");
			requestRefresh(false);
			render(); // the "updated N min ago" line moves on
		}),
		REFRESH_INTERVAL_MS
	);
}

// --- Screen ---
// One screen for the item at selectedIndex. describeScreen() works out what
// it shows as plain values; applyScreen() puts them into Piu contents
// created once (createView), changing only what differs. Rebuilding the
// whole tree on every update (up to 4 times a second with the spinner)
// churned the engine's fixed-size memory.
// Skin/Style/Container/Label/Text/Application/Behavior are globals the
// Alloy host injects (build/devices/pebble/host/main.js).

/**
 * @returns {object[]} What Up/Down cycles through: tracked stops (type
 *   "stop"), alert lines ("alert"), then settings once the config loaded.
 */
function buildItemList() {
	const list = [];
	if (screensMode !== SCREENS_ALERTS) {
		for (const stop of stops) list.push(Object.assign({ type: "stop" }, stop));
	}
	if (screensMode !== SCREENS_STOPS) {
		// Lines added in the alerts section always have a screen; the tracked
		// stops' lines only while they have messages, or always when alert
		// screens are all the watch shows.
		const shownLines = new Set();
		const addLine = (lineRef, lineName) => {
			if (shownLines.has(lineRef)) return;
			shownLines.add(lineRef);
			list.push({ type: "alert", lineRef: lineRef, lineName: lineName });
		};
		for (const line of alertLines) addLine(line.lineRef, line.lineName);
		if (screensMode === SCREENS_ALERTS) {
			for (const stop of stops) addLine(stop.lineRef, stop.lineName);
		}
		for (const [lineRef, info] of lineAlerts) {
			if (info.count > 0) addLine(lineRef, info.lineName);
		}
	}
	// Settings last, once loaded, and only next to something to show:
	// with nothing configured the screen says so instead.
	if (configLoaded && list.length > 0) list.push({ type: "settings" });
	return list;
}

let items = [];
let selectedIndex = 0;

// Which screens Up/Down cycles through (config page "Écrans sur la
// montre"): both, stops only, or alerts only. Settings stay last in all.
const SCREENS_BOTH = 0;
const SCREENS_STOPS = 1;
const SCREENS_ALERTS = 2;
let screensMode = SCREENS_BOTH;

// Error states shown in place of the times: [STRINGS key, shown in red].
const STATE_MESSAGES = {
	network: ["network", true],
	noRealtimeData: ["noRealtimeData", false],
	quotaExceeded: ["quotaExceeded", true],
	rateLimited: ["rateLimited", true],
	invalidKey: ["invalidKey", true],
	invalidStop: ["invalidStop", true],
};

/**
 * @returns {{banner: ?{color: string, textColor: string, text: string},
 *   title: string, line: string, lineError: boolean, status: string,
 *   next: string, alert: string, footer: string}} What the screen shows
 *   now; "" hides a part.
 */
function describeScreen() {
	const model = {
		banner: null,
		title: "",
		line: "",
		lineError: false,
		status: "",
		next: "",
		alert: "",
		footer: "",
		body: "",
	};
	const item = items[selectedIndex];
	if (!item) {
		model.line = configLoaded ? t("noStops") : t("loading");
		if (configLoaded) model.footer = t("configureHint");
		return model;
	}
	const dep =
		item.type === "stop" ? departures.get(departureKey(item)) : undefined;
	// Last good times kept through a pause or failure: the bottom of the
	// screen says why and how old they are, in place of the cycle hint.
	const paused = !!dep && typeof dep.pauseMinutes === "number";
	const stale = !!dep && typeof dep.staleReason === "string";
	const offline = !phoneConnected();
	if (paused || stale || (offline && dep)) {
		model.alert = offline
			? t("phoneDisconnected")
			: paused
				? t("pausedFor", dep.pauseMinutes)
				: t(dep.staleReason);
		model.footer = t(
			"updatedAgo",
			Math.floor((Date.now() - dep.receivedAt) / 60000)
		);
	} else if (offline) {
		model.alert = t("phoneDisconnected");
	} else {
		if (items.length > 1) model.footer = t("cycleHint");
		const info = item.type === "stop" ? lineAlerts.get(item.lineRef) : null;
		if (info && info.count > 0) {
			model.alert = t("trafficInfoCount", info.count);
		}
	}

	if (item.type === "settings") {
		model.title = t("settings");
		model.line =
			typeof quotaRemaining === "number"
				? t("quotaRemaining", quotaRemaining)
				: t("quotaUnknown");
		return model;
	}
	if (item.type === "alert") {
		// Like a stop: the line's banner, then one whole message per page.
		const info = lineAlerts.get(item.lineRef);
		const pages = info ? info.pages : [];
		model.banner = {
			color: info ? info.color : "#888888",
			textColor: info ? info.textColor : "#ffffff",
			text:
				pages.length > 1
					? `${item.lineName}  ${alertPage + 1}/${pages.length}`
					: item.lineName,
		};
		if (pages.length > 0) {
			model.body = pages[Math.min(alertPage, pages.length - 1)];
			// The last check failed: say these messages may be out of date.
			model.footer = info.stale
				? t("alertsStale")
				: pages.length > 1
					? t("nextAlert")
					: "";
		} else {
			model.line = !info
				? "..."
				: info.stale
					? t("alertsUnavailable")
					: t("noAlert");
		}
		return model;
	}

	model.banner = {
		color: item.lineColor || "#888888",
		textColor: item.lineTextColor || "#ffffff",
		// ASCII ">": Gothic has no arrow glyph.
		text: item.destStopName
			? `${item.lineName} — ${item.stopName} > ${item.destStopName}`
			: `${item.lineName} — ${item.stopName}`,
	};
	if (!dep) {
		model.status = "..."; // DestinationDisplay isn't known yet either
		return model;
	}
	const stateMessage = STATE_MESSAGES[dep.state];
	if (stateMessage) {
		model.line = t(
			stateMessage[0],
			dep.state === "rateLimited" ? dep.minutes : undefined
		);
		model.lineError = stateMessage[1];
		return model;
	}
	const next = nextDepartures(dep);
	if (next === null) {
		model.line = t("noDeparture"); // last times kept, all past
		return model;
	}
	const status =
		dep.cancelled && !next.shifted
			? t("cancelled")
			: dep.atStop && !next.shifted
				? t("atStop")
				: `${next.minutes} min`;
	model.status = pendingRefresh.has(departureKey(item))
		? `${status} ${SPINNER_FRAMES[spinnerFrame]}`
		: status;
	model.line = next.destination
		? `${next.mission ? `${next.mission} - ` : ""}${t("towards")} ${next.destination}`
		: next.mission;
	if (typeof next.minutes2 === "number") {
		model.next = `${t("thenLabel")} ${next.minutes2} min${next.mission2 ? ` - ${next.mission2}` : ""}`;
	}
	return model;
}

const whiteSkin = new Skin({ fill: "white" });
const rowStyle = new Style({ font: "18px Gothic", color: "black" });
const titleStyle = new Style({ font: "bold 24px Gothic", color: "black" });
const bodyStyle = new Style({ font: "18px Gothic", color: "black" });
const errorStyle = new Style({ font: "18px Gothic", color: "#AA0000" });
// Traffic info texts: long, so smaller.
const smallStyle = new Style({ font: "14px Gothic", color: "black" });

// One Skin per line color and one Style per banner text color, created on
// first use and kept.
const skinCache = new Map();
/** @param {string} color @returns {Skin} */
function skinFor(color) {
	let skin = skinCache.get(color);
	if (!skin) {
		skin = new Skin({ fill: color });
		skinCache.set(color, skin);
	}
	return skin;
}
// Banner texts longer than this (an A->B trip: line, boarding and arrival
// stops) would take 3 lines and overflow the banner in 18px: they use 14px.
const LONG_BANNER_CHARS = 34;
const bannerStyleCache = new Map();
/**
 * @param {string} color
 * @param {boolean} small - The 14px font, for long texts.
 * @returns {Style}
 */
function bannerStyle(color, small) {
	const key = `${color}|${small}`;
	let style = bannerStyleCache.get(key);
	if (!style) {
		style = new Style({
			font: small ? "bold 14px Gothic" : "bold 18px Gothic",
			color: color,
		});
		bannerStyleCache.set(key, style);
	}
	return style;
}

/**
 * Hardware buttons: Piu routes them to the focused container's Behavior.
 * A separate pebble/button Button can't stop the OS's exit-on-Back.
 * Up/Down cycle through the items (wrapping), Select refreshes a stop,
 * Back is left to the OS (this is the app's only screen).
 */
class MainBehavior extends Behavior {
	onPressUp() {
		note("btn up");
		run("onPressUp", () => this.step(-1));
		return true;
	}
	onPressDown() {
		note("btn down");
		run("onPressDown", () => this.step(1));
		return true;
	}
	onPressSelect() {
		// Firmware auto-repeat fires onPressSelect many times over one held
		// press: one action per physical press.
		if (this.selectDown) return true;
		this.selectDown = true;
		note("btn select");
		run("onPressSelect", () => {
			const item = items[selectedIndex];
			const info =
				// biome-ignore lint/complexity/useOptionalChain: see requestRefresh
				item && item.type === "alert" ? lineAlerts.get(item.lineRef) : null;
			if (info && info.pages.length > 1) {
				alertPage = (alertPage + 1) % info.pages.length;
				render();
				return;
			}
			requestRefresh(true);
		});
		return true;
	}
	onReleaseSelect() {
		this.selectDown = false;
		return true;
	}
	/** Not consumed (returns false): the OS then closes the app as usual. */
	onPressBack() {
		markSession("exit");
		return false;
	}
	/** Moves selectedIndex by `direction`, wrapping, and refreshes if stale. */
	step(direction) {
		if (items.length === 0) return;
		selectedIndex = (selectedIndex + direction + items.length) % items.length;
		alertPage = 0;
		render();
		requestRefresh(false);
	}
}

const application = new Application(null, {
	left: 0,
	right: 0,
	top: 0,
	bottom: 0,
	skin: whiteSkin,
	Behavior: MainBehavior,
});
// Piu only routes button presses to a focused container's Behavior.
application.focus();

// Contents of the screen, created once by createView().
const view = {};

// Where each part goes, as [top, horizontal inset]: Emery's 200x228
// rectangle, or Gabbro's 260x260 circle, where the lines near the top and
// bottom are narrower (text is centered, Piu's default).
const ROUND = typeof screen !== "undefined" && !!screen.round;
const LAYOUT = ROUND
	? {
			banner: { top: 30, height: 48, inset: 44 },
			title: [40, 30],
			line: [86, 22],
			status: [134, 20],
			next: [170, 30],
			alert: [198, 46],
			// 160 px wide, in 14 px (see createView): the circle is too narrow
			// lower down for the hints in 18 px.
			footer: [216, 50],
			body: [82, 28, 130],
		}
	: {
			banner: { top: 0, height: 44, inset: 8 },
			title: [10, 8],
			line: [60, 8],
			status: [110, 8],
			next: [150, 8],
			alert: [178, 8],
			footer: [200, 8],
			body: [48, 6, 150],
		};

/** @returns {Label} A hidden single-line label at LAYOUT[name]. */
function label(name, style) {
	const [top, inset] = LAYOUT[name];
	const content = new Label(null, {
		top: top,
		left: inset,
		right: inset,
		style: style,
		string: "",
	});
	content.visible = false;
	return content;
}

/** @returns {Text} A hidden two-line text (Label doesn't wrap). */
function text(name, style) {
	const [top, inset] = LAYOUT[name];
	const content = new Text(null, {
		top: top,
		left: inset,
		right: inset,
		height: 44,
		style: style,
		string: "",
	});
	content.visible = false;
	return content;
}

function createView() {
	view.banner = new Container(null, {
		left: 0,
		right: 0,
		top: LAYOUT.banner.top,
		height: LAYOUT.banner.height,
		skin: whiteSkin,
	});
	view.banner.visible = false;
	view.bannerText = null; // created by applyBanner, per text color
	view.title = label("title", titleStyle);
	view.line = text("line", bodyStyle);
	view.lineError = text("line", errorStyle);
	view.status = label("status", titleStyle);
	view.next = label("next", bodyStyle);
	view.alert = label("alert", errorStyle);
	view.footer = label("footer", ROUND ? smallStyle : rowStyle);
	// A line's traffic info: several lines of text under its name.
	const [bodyTop, bodyInset, bodyHeight] = LAYOUT.body;
	view.body = new Text(null, {
		top: bodyTop,
		left: bodyInset,
		right: bodyInset,
		height: bodyHeight,
		style: smallStyle,
		string: "",
	});
	view.body.visible = false;
	const root = new Container(null, {
		left: 0,
		right: 0,
		top: 0,
		bottom: 0,
		skin: whiteSkin,
		contents: [
			view.banner,
			view.title,
			view.line,
			view.lineError,
			view.status,
			view.next,
			view.alert,
			view.footer,
			view.body,
		],
	});
	application.add(root);
}

// What each content currently shows, so applyScreen only touches changes.
const shown = {};

/** Shows `value` in `view[name]`, or hides it when "". */
function show(name, value) {
	if (shown[name] === value) return;
	shown[name] = value;
	const content = view[name];
	if (value) content.string = value;
	content.visible = value !== "";
}

/** @param {?{color: string, textColor: string, text: string}} banner */
function applyBanner(banner) {
	const small = !!banner && banner.text.length > LONG_BANNER_CHARS;
	const look = banner ? `${banner.color}|${banner.textColor}|${small}` : "";
	if (shown.bannerLook !== look) {
		shown.bannerLook = look;
		view.banner.visible = !!banner;
		if (banner) {
			view.banner.skin = skinFor(banner.color);
			// A new Text per text color (rare: when switching lines) rather
			// than restyling one.
			view.banner.empty();
			view.bannerText = new Text(null, {
				left: LAYOUT.banner.inset,
				right: LAYOUT.banner.inset,
				top: 0,
				bottom: 0,
				style: bannerStyle(banner.textColor, small),
				string: banner.text,
			});
			view.banner.add(view.bannerText);
			shown.bannerText = banner.text;
		}
	}
	if (banner && shown.bannerText !== banner.text) {
		shown.bannerText = banner.text;
		view.bannerText.string = banner.text;
	}
}

/** @param {ReturnType<typeof describeScreen>} model */
function applyScreen(model) {
	applyBanner(model.banner);
	show("title", model.title);
	show("line", model.lineError ? "" : model.line || "");
	show("lineError", model.lineError ? model.line : "");
	show("status", model.status);
	show("next", model.next);
	show("alert", model.alert);
	show("footer", model.footer);
	show("body", model.body);
}

/** Brings the screen up to date. Cheap: only changed contents are touched. */
function render() {
	run("render", () => applyScreen(describeScreen()));
}

/** @returns {boolean} False only when the watch knows the phone is gone. */
function phoneConnected() {
	return !(
		typeof watch !== "undefined" &&
		watch.connected &&
		watch.connected.app === false
	);
}

if (typeof watch !== "undefined") {
	// The countdown moves on (times are counted down on the watch).
	watch.addEventListener(
		"minutechange",
		safe("minutechange", () => {
			render();
			checkApproach();
		})
	);
	// Can take 15-30 s to be reported after the phone goes away.
	watch.addEventListener(
		"connected",
		safe("connected", () => {
			note(`connected ${phoneConnected()}`);
			render();
			if (phoneConnected()) requestRefresh(false);
		})
	);
}

run("createView", createView);
render();
// Asks for the config right away (see requestConfigResend), then retries.
run("bootConfigRequest", requestConfigResend);
