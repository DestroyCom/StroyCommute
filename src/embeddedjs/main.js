import Message from "pebble/message";

console.log("Hello, Watchface.");

// --- Config state ---
// Populated from AppMessage items sent by pkjs's sendConfigToWatch() (see
// src/pkjs/index.js). Items arrive one at a time, not batched: pkjs chains
// each send through its ack callback because back-to-back sends were found
// to drop messages during Task 5's testing.

let stops = [];
let alertLines = [];
let scheduleDaysBitmask = 0;
let scheduleStartMinutes = 0;
let scheduleEndMinutes = 0;
let timelineEnabled = false;
let configLoaded = false;

let pendingConfigCount = 0;
let pendingStops = [];
let pendingLines = [];
// Set of item indices actually received for the config batch currently
// being assembled, reset alongside pendingStops/pendingLines whenever a
// fresh configMeta arrives. A Set (not a plain counter) so a duplicate
// delivery of the same index -- e.g. the watch's onReadable firing twice
// for one item, per the race described below -- can't inflate the count
// past pendingConfigCount without every distinct index actually having
// arrived.
let receivedConfigIndices = new Set();

// `pebble/message`'s Message class, when given `keys` as a plain array,
// assigns each key a private numeric code of `10000 + arrayIndex` (see the
// SDK's pebble-appmessage.js) — NOT the code pkjs and the underlying
// AppMessage transport actually use, which is `10000 + index in
// package.json's pebble.messageKeys array` (confirmed via the SDK's
// process_message_keys.py waf task, and matches the codes
// `pebble send-app-message` requires). A Message instance whose `keys`
// array isn't an exact ordered prefix of package.json's array silently
// decodes every field under the wrong name. Every Message instance in this
// file must build its `keys` option from this canonical map instead of a
// bare array, so codes always match package.json regardless of which
// keys a given instance subscribes to or in what order.
//
// !!! KEEP IN EXACT SYNC WITH `pebble.messageKeys` IN package.json !!!
// This array is a second, hand-maintained copy of that list — same keys,
// same order, nothing added/removed/reordered on one side without the
// other. There is no automated drift guard (no build-time codegen step
// ties the two together — deliberately not built, per YAGNI, since a
// loud comment on both sides is the minimum bar and a codegen step risks
// fighting Alloy's bundler for uncertain benefit). If you add, remove, or
// reorder a key in package.json's `pebble.messageKeys`, make the exact
// same edit here, or every `Message` instance in this file will silently
// decode fields under the wrong name again — see the paragraph above.
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
];
const MESSAGE_KEY_CODES = new Map(
	ALL_MESSAGE_KEYS.map((key, index) => [key, 10000 + index])
);

/**
 * @param {string[]} keys - Subset of ALL_MESSAGE_KEYS, in any order.
 * @returns {Map<string, number>} keys mapped to their package.json-derived
 *   codes, for use as a `pebble/message` Message's `keys` option.
 */
function messageKeyMap(keys) {
	return new Map(
		keys.map((key) => {
			const code = MESSAGE_KEY_CODES.get(key);
			if (code === undefined) {
				throw new Error(
					"Unknown message key (missing from ALL_MESSAGE_KEYS): " + key
				);
			}
			return [key, code];
		})
	);
}

// `let`, not `function`, because Task 8 reassigns this to chain in the
// refresh-timer startup (biome flags reassigning a function declaration).
let onConfigReady = () => {
	// overridden by the UI section (Task 9) once it exists
};

const configMessageKeys = [
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
	"lineColor",
	"lineTextColor",
];

const configMessage = new Message({
	keys: messageKeyMap(configMessageKeys),
	onReadable() {
		const msg = this.read();
		const item = {};
		msg.forEach((value, key) => {
			item[key] = value;
		});
		handleConfigItem(item);
	},
});

// Task 8b: reconciliation safety net, on top of the pkjs-side send-gap fix
// (see CONFIG_SEND_GAP_MS in src/pkjs/index.js) that closed the specific
// inbound-buffer race found via instrumented logging (task-8b-report.md).
// A clean 10-run emulator repro reached 0/10 losses with the gap fix alone,
// but this is a real-Bluetooth link never validated on physical hardware --
// added as defense-in-depth given a permanently incomplete `stops` list
// would otherwise fail silently (Task 9's list screen has no error-state UI
// yet to surface it). Forced-drop verification (task-8b-report.md) confirmed
// this timer fires, requests a resend, and recovers configLoaded within one
// cycle. Scoped to the FIRST config load of a session only (configLoaded
// still false), matching the reported bug's worst case (configMeta itself
// lost, onConfigReady never firing that session) -- a later config update
// losing an item is not covered (out of this task's scope, flagged in
// task-8b-report.md).
let configResendTimer = null;
let configResendCount = 0;
// Lowered from 4000ms (2026-08-19): real-device logs show the *first*
// pkjs "ready" send essentially always fails outright (every item "giving
// up after 3 retries") because the watch's AppMessage inbox isn't open yet
// at that exact boot moment -- not a slow-but-eventually-arriving send.
// The first 4s were pure dead waiting on a send that was never going to
// succeed; 1500ms is still comfortably above a real single-message
// round-trip, so a send that's merely slow (rather than doomed) still has
// room to complete before the timeout fires.
const CONFIG_RESEND_TIMEOUT_MS = 1500;
const MAX_CONFIG_RESENDS = 3;

/** Arms the Task 8b config-resend safety net if not already armed. */
function scheduleConfigResendTimeout() {
	if (configResendTimer !== null) return; // already scheduled
	configResendTimer = setTimeout(
		onConfigResendTimeout,
		CONFIG_RESEND_TIMEOUT_MS
	);
}

/** Disarms the config-resend safety net, if armed. */
function clearConfigResendTimeout() {
	if (configResendTimer !== null) {
		clearTimeout(configResendTimer);
		configResendTimer = null;
	}
}

/**
 * Fires when a config load hasn't completed within CONFIG_RESEND_TIMEOUT_MS;
 * asks pkjs for a fresh full resend, up to MAX_CONFIG_RESENDS times.
 */
function onConfigResendTimeout() {
	configResendTimer = null;
	if (configLoaded) return; // resolved itself between scheduling and firing
	if (configResendCount >= MAX_CONFIG_RESENDS) {
		console.log(
			"configResendRequest: giving up after " +
				MAX_CONFIG_RESENDS +
				" attempts, config still not loaded"
		);
		return;
	}
	configResendCount++;
	console.log(
		"configResendRequest: attempt " +
			configResendCount +
			"/" +
			MAX_CONFIG_RESENDS
	);
	const m = new Map();
	m.set("itemType", "configResendRequest");
	try {
		configMessage.write(m);
	} catch (error) {
		// Same try/catch pattern as tryWriteRefreshStop/departureMessage
		// (Task 8): the single outbound slot may be busy. Not retried
		// immediately -- the next scheduleConfigResendTimeout() below
		// covers it, so a busy slot just delays this attempt rather than
		// silently dropping it.
		console.log(
			`configResendRequest: write failed (outbound slot busy): ${error}`
		);
	}
	scheduleConfigResendTimeout();
}

/**
 * Accumulates one configMeta/configStop/configLine item from pkjs into
 * pendingStops/pendingLines, committing to stops/alertLines and firing
 * onConfigReady() once every expected item has arrived.
 * @param {object} item - Decoded AppMessage item (itemType + fields).
 */
function handleConfigItem(item) {
	if (!configLoaded) scheduleConfigResendTimeout();

	if (item.itemType === "configMeta") {
		scheduleDaysBitmask = item.scheduleDaysBitmask;
		scheduleStartMinutes = item.scheduleStartMinutes;
		scheduleEndMinutes = item.scheduleEndMinutes;
		timelineEnabled = !!item.timelineEnabled;
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
		});
	} else if (item.itemType === "configLine") {
		pendingLines.push({ lineRef: item.lineRef, lineName: item.lineName });
	}

	receivedConfigIndices.add(item.itemIndex);

	// Completion requires every expected index to have actually arrived, not
	// just the last one by index (see the Important finding this fixes: a
	// dropped middle item, e.g. index 1 of 3, used to slip past a
	// `itemIndex === pendingConfigCount - 1` check satisfied by index 2
	// arriving normally -- silently completing with stops/alertLines missing
	// whatever the dropped item contributed, and clearing the resend safety
	// net that was supposed to catch exactly this). Set.size against
	// pendingConfigCount is robust to duplicate/out-of-order delivery, unlike
	// a plain received-count. `pendingConfigCount > 0` guards against
	// completing before any configMeta has ever been seen this session/batch
	// (pendingConfigCount defaults to 0).
	if (
		pendingConfigCount > 0 &&
		receivedConfigIndices.size === pendingConfigCount
	) {
		stops = pendingStops;
		alertLines = pendingLines;
		configLoaded = true;
		clearConfigResendTimeout();
		onConfigReady();
	}
}

// --- Departures — refresh timer ---
// embeddedjs does NOT fetch or parse PRIM data (see
// docs/pebble-idfm-prim/SKILL.md for why: a real PRIM URL + API key
// combined in one embeddedjs fetch() reliably crashed real emery hardware
// with fxAbort memory full, a fixed ~8KB chunk-memory ceiling on the
// watch). This timer only sends a lightweight `refreshStop` request per
// tracked stop to pkjs, which owns the fetch, and stores the
// `departureUpdate` replies here for the UI to render. The timer stays in
// embeddedjs since it's the only side that reliably knows the app is
// foregrounded — Alloy apps aren't running otherwise.

// Real implementation is in the "Piu UI — list screen" section below
// (declared as a `function`, hoisted, so this forward reference from
// departureMessage's onReadable further down resolves fine).

const departures = new Map();

const departureMessageKeys = [
	"itemType",
	"stopRef",
	"lineRef",
	"lineName",
	"state",
	"destination",
	"minutes",
	"atStop",
	"cancelled",
	"minutes2",
];

// Same Message instance handles both directions of this protocol (receive
// departureUpdate, send refreshStop) — embeddedjs has no
// Pebble.sendAppMessage global, that's pkjs-only; `.write()` takes a Map,
// not a plain object.
const departureMessage = new Message({
	keys: messageKeyMap(departureMessageKeys),
	onReadable() {
		const msg = this.read();
		const item = {};
		msg.forEach((value, key) => {
			item[key] = value;
		});
		if (item.itemType !== "departureUpdate") return;

		departures.set(item.stopRef, {
			state: item.state,
			line: item.lineName,
			destination: item.destination,
			minutes: item.minutes,
			minutes2: item.minutes2, // undefined when there's no following departure
			atStop: !!item.atStop,
			cancelled: !!item.cancelled,
		});
		renderCurrentScreen();
	},
	// Sending departureMessage.write() back-to-back in a tight loop (one per
	// tracked stop) throws "Error: not writable" and crashes the app
	// (fxAbort) the moment a second write lands before the first is
	// acknowledged — confirmed on-device, the watch-side mirror of Task 5's
	// phone-side back-to-back-send-drop finding, but a hard crash here
	// instead of a silent drop.
	//
	// onWritable is edge-triggered, not a poll-first capacity gate: it does
	// NOT fire proactively when idle (confirmed on-device — a queue that
	// only flushes from inside onWritable, gated on a count it sets, never
	// sends anything at all if nothing has been attempted yet). The real
	// contract is try-then-retry: call write() speculatively, catch the
	// "not writable" throw if the single outbound slot is still busy, and
	// let onWritable's firing (once the slot frees up) drive the retry.
	onWritable() {
		flushRefreshQueue();
	},
});

let refreshTimer = null;
let refreshQueue = [];

/**
 * Attempts one `refreshStop` write for `stop`.
 * @param {{stopRef: string, lineRef: string, lineName: string}} stop
 * @returns {boolean} True if the write succeeded (outbound slot was free).
 */
function tryWriteRefreshStop(stop) {
	const m = new Map();
	m.set("itemType", "refreshStop");
	m.set("stopRef", stop.stopRef);
	m.set("lineRef", stop.lineRef);
	m.set("lineName", stop.lineName);
	try {
		departureMessage.write(m);
		return true;
	} catch {
		return false;
	}
}

/** Drains refreshQueue while the single outbound AppMessage slot is free. */
function flushRefreshQueue() {
	while (refreshQueue.length > 0) {
		if (!tryWriteRefreshStop(refreshQueue[0])) break; // wait for onWritable to retry
		refreshQueue.shift();
	}
}

/**
 * Queues a refreshStop for the currently-selected stop, if any, then
 * flushes. A no-op for the "alert" item type (not PRIM data). Scoping to
 * just the viewed stop, instead of every tracked stop, is deliberate: no
 * reason to spend PRIM quota / Bluetooth traffic on stops the user isn't
 * currently looking at.
 */
function requestRefresh() {
	const item = buildItemList()[selectedIndex];
	// Deliberately not `item?.type` -- confirmed on real hardware that this
	// XS engine's optional-chaining support is broken here (a runtime "call:
	// not a function" error in an onReadable handler, immediately after
	// switching this exact line to `?.`). Do not "simplify" this back.
	// biome-ignore lint/complexity/useOptionalChain: see comment above
	if (!item || item.type !== "stop") return;
	// Merge, don't overwrite: if the previous round hasn't fully drained
	// (e.g. a Bluetooth stall keeps the single outbound slot busy across a
	// tick boundary), discarding a still-pending entry here would silently
	// drop it. Dedup by stopRef so re-queuing the same viewed stop every
	// tick doesn't pile up duplicates.
	const alreadyQueued = refreshQueue.some(
		(queued) => queued.stopRef === item.stopRef
	);
	if (!alreadyQueued) refreshQueue.push(item);
	flushRefreshQueue();
}

/** Starts the 45s foreground departure-refresh timer, once. */
function startRefreshTimer() {
	if (refreshTimer) return;
	refreshTimer = setInterval(requestRefresh, 45000);
}

const previousOnConfigReady = onConfigReady;
onConfigReady = () => {
	previousOnConfigReady();
	startRefreshTimer();
	// renderCurrentScreen()/requestRefresh() are declared further down
	// (hoisted `function`s, so this forward reference resolves fine).
	// renderCurrentScreen() is required here: nothing else calls it once
	// config finishes loading (confirmed via real-device logs -- config
	// loaded fully after one resend cycle, but the screen stayed stuck on
	// the boot-time "Chargement..." render regardless, since no
	// departureUpdate or button press had happened yet to trigger a
	// re-render). requestRefresh() kicks off the fetch for whichever item
	// selectedIndex points to (item 0 on a fresh boot) immediately, rather
	// than waiting for the 45s timer's first tick.
	renderCurrentScreen();
	requestRefresh();
};

// --- Piu UI — single screen ---
// The first real Piu UI screen this project builds. Replaces the placeholder
// Poco clock face (raw `render.begin()/fillRectangle/drawText/end()` on
// `secondchange`, formerly here) entirely rather than running alongside it —
// a full Piu `Application` owns the display's render list once created (see
// `PiuView`'s constructor setting `screen.context = this`), and a second,
// unrelated direct-draw loop on the same `screen` would fight it for the
// same framebuffer. `Skin`/`Style`/`Container`/`Label`/`Application`/
// `Behavior` need no import: the SDK's pebble host (`build/devices/pebble/
// host/main.js`) injects them as globals into every app module's scope via
// `import {} from "piu/MC"` — confirmed by reading that file directly, not
// guessed. Hardware buttons are handled via `Behavior`'s `onPressSelect`/
// `onPressUp`/`onPressDown`/`onPressBack` methods on the focused container
// (see `MainBehavior` below), not the separate `pebble/button` `Button`
// class this file used originally — that class does receive presses, but
// runs alongside Piu's own native back-button handling rather than
// replacing it, so it can't suppress the OS's default exit-on-back
// behavior. Confirmed against a real, working multi-screen Piu app
// (Moddable-OpenSource/pebble-examples, `piu/apps/words`), not guessed.

const whiteSkin = new Skin({ fill: "white" });
const rowStyle = new Style({ font: "18px Gothic", color: "black" });

/**
 * @returns {object[]} Flattened, renderable list combining tracked stops
 *   (type "stop") and alert lines (type "alert"), in that order.
 */
function buildItemList() {
	const items = [];
	for (const stop of stops) {
		items.push({
			type: "stop",
			stopRef: stop.stopRef,
			lineRef: stop.lineRef,
			lineName: stop.lineName,
			stopName: stop.stopName,
			lineColor: stop.lineColor,
			lineTextColor: stop.lineTextColor,
		});
	}
	for (const line of alertLines) {
		items.push({
			type: "alert",
			lineRef: line.lineRef,
			lineName: line.lineName,
		});
	}
	return items;
}

let selectedIndex = 0;

// Hardware buttons in Piu route through a focused container's Behavior
// (onPressUp/onPressDown), NOT through a standalone pebble/button
// Message-style Button instance -- confirmed by reading a real, working
// multi-screen Piu app (Moddable-OpenSource/pebble-examples, piu/apps/words:
// modules/piuView.js's ViewBehavior). A separate Button({types:["back",...]})
// (the original Task 9/10 approach) DOES still receive the press (verified
// on real hardware via temporary logging), but it runs alongside Piu's own
// native back-handling rather than replacing it, so it can't suppress the
// OS's default exit-on-back behavior.
//
// Single-screen app (2026-08-19): the separate list/detail modes were
// removed -- the app now always shows buildDetailScreen() for whichever
// item selectedIndex points to; up/down cycles between tracked stops
// exactly as it did on the list screen before. No onPressSelect/onPressBack
// overrides needed any more: Select falls through as a no-op, and Back
// falls through to the OS's normal exit-on-back, since this is now the
// app's only screen (nothing to "return" to).
/** Hardware-button routing for the app's single Application/root Container. */
class MainBehavior extends Behavior {
	onPressUp() {
		this.step(-1);
		return true;
	}
	onPressDown() {
		this.step(1);
		return true;
	}
	/** Moves selectedIndex by `direction`, clamped in range, and re-fetches. */
	step(direction) {
		const items = buildItemList();
		if (items.length === 0) return;
		const maxIndex = Math.max(0, items.length - 1);
		selectedIndex = Math.max(0, Math.min(maxIndex, selectedIndex + direction));
		renderCurrentScreen();
		requestRefresh(); // fetch immediately for the newly-selected stop
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
// Piu only routes hardware button presses to a focused container's
// Behavior -- without this, MainBehavior's onPress* methods above would
// simply never fire.
application.focus();

const titleStyle = new Style({ font: "bold 24px Gothic", color: "black" });
const bodyStyle = new Style({ font: "18px Gothic", color: "black" });
const errorStyle = new Style({ font: "18px Gothic", color: "#AA0000" });

// Station-board panel (re-attempt, 2026-08-19): a prior attempt at this
// crashed real hardware (see git history / docs/pebble-alloy/SKILL.md) when
// the machine's chunk/slot budget was still the ~8-32KB library default.
// That budget is now fixed properly at the source -- see src/c/mdbl.c's
// ModdableCreationRecord (.stack=6144 .slot=32768 .chunk=32768) -- so this
// is a genuinely different starting point, not a retry of the same
// conditions. The Skin is constructed fresh per render (one per line color)
// -- the same pattern already proven stable on this target. The Style is
// cached per distinct text color in a Map, the same pattern that fixed the
// original badge-text crash.
const boardTitleStyleCache = new Map();
/** @param {string} color - Hex text color. @returns {Style} Cached per color. */
function boardTitleStyle(color) {
	const key = color || "#ffffff";
	let style = boardTitleStyleCache.get(key);
	if (!style) {
		style = new Style({ font: "bold 18px Gothic", color: key });
		boardTitleStyleCache.set(key, style);
	}
	return style;
}

/** @returns {Container} The single screen for the item at selectedIndex. */
function buildDetailScreen() {
	const items = buildItemList();
	const item = items[selectedIndex];
	if (!item) {
		return new Container(null, {
			left: 0,
			right: 0,
			top: 0,
			bottom: 0,
			skin: whiteSkin,
			contents: [
				new Label(null, {
					top: 60,
					left: 8,
					right: 8,
					style: rowStyle,
					string: configLoaded ? "Aucun arrêt configuré" : "Chargement...",
				}),
			],
		});
	}

	const lines = [];
	// "Haut/bas pour changer" hint -- only shown when there's actually
	// something to cycle to, at the bottom of the screen, below every other
	// element this screen ever renders (board banner, destination, status,
	// following-departure line all stay well above top:200 on Emery's
	// 228px-tall display).
	if (items.length > 1) {
		lines.push(
			new Label(null, {
				top: 200,
				left: 8,
				right: 8,
				style: rowStyle,
				// Plain ASCII -- the Gothic bitmap font doesn't have glyphs
				// for ▲▼, confirmed on real hardware (renders as tofu boxes).
				string: "Haut / Bas pour changer",
			})
		);
	}
	if (item.type === "stop") {
		const dep = departures.get(item.stopRef);
		lines.push(
			new Container(null, {
				left: 0,
				right: 0,
				top: 0,
				height: 44,
				skin: new Skin({ fill: item.lineColor || "#888888" }),
				contents: [
					new Label(null, {
						left: 8,
						right: 8,
						top: 0,
						bottom: 0,
						style: boardTitleStyle(item.lineTextColor),
						string: `${item.lineName} — ${item.stopName}`,
					}),
				],
			})
		);
		if (!dep) {
			// "..." in place of the minutes digit, at the same position the
			// digit itself lands in below (see the "else" branch's status
			// Label) -- the destination/direction line is left blank rather
			// than a separate "loading" message, since it's real PRIM data
			// (DestinationDisplay) that isn't known yet either.
			lines.push(
				new Label(null, {
					top: 110,
					left: 8,
					right: 8,
					style: titleStyle,
					string: "...",
				})
			);
		} else if (dep.state === "network") {
			lines.push(
				new Label(null, {
					top: 60,
					left: 8,
					right: 8,
					style: errorStyle,
					string: "Erreur réseau",
				})
			);
		} else if (dep.state === "noRealtimeData") {
			lines.push(
				new Label(null, {
					top: 60,
					left: 8,
					right: 8,
					style: bodyStyle,
					string: "Pas de temps réel pour cet arrêt",
				})
			);
		} else if (dep.state === "quotaExceeded") {
			lines.push(
				new Label(null, {
					top: 60,
					left: 8,
					right: 8,
					style: errorStyle,
					string: "Quota API dépassé",
				})
			);
		} else {
			const status = dep.cancelled
				? "Supprimé"
				: dep.atStop
					? "À quai"
					: `${dep.minutes} min`;
			lines.push(
				// Text (not Label) so a long destination -- "Vers Porte de
				// Versailles (Parc des Expositions)" -- wraps onto a second
				// line instead of running off the screen edge. Label is
				// single-line-only in Piu; Text is the native word-wrap
				// primitive (PiuText.c).
				new Text(null, {
					top: 60,
					left: 8,
					right: 8,
					height: 44,
					style: bodyStyle,
					string: `Vers ${dep.destination}`,
				})
			);
			lines.push(
				new Label(null, {
					top: 110,
					left: 8,
					right: 8,
					style: titleStyle,
					string: status,
				})
			);
			// Following departure (minutes2), same direction/stop -- absent
			// (undefined) when PRIM only returned one upcoming visit.
			if (typeof dep.minutes2 === "number") {
				lines.push(
					new Label(null, {
						top: 150,
						left: 8,
						right: 8,
						style: bodyStyle,
						string: `Puis ${dep.minutes2} min`,
					})
				);
			}
		}
	} else {
		lines.push(
			new Label(null, {
				top: 10,
				left: 8,
				right: 8,
				style: titleStyle,
				string: item.lineName,
			})
		);
		lines.push(
			new Label(null, {
				top: 60,
				left: 8,
				right: 8,
				style: bodyStyle,
				string: "Alertes trafic bientôt disponibles",
			})
		);
	}

	return new Container(null, {
		left: 0,
		right: 0,
		top: 0,
		bottom: 0,
		skin: whiteSkin,
		contents: lines,
	});
}

/** Rebuilds the Application's content from scratch (single-screen app). */
function renderCurrentScreen() {
	application.empty();
	application.add(buildDetailScreen());
}

renderCurrentScreen();

// Ask for config immediately at boot, rather than passively waiting on
// pkjs's own unprompted "ready" push (2026-08-19, real-device evidence):
// captured logs show that first push essentially always fails outright --
// every item "giving up after 3 retries" -- because the watch's AppMessage
// inbox isn't open yet at the exact wall-clock moment pkjs's "ready" fires.
// It's not a slow send, it's a doomed one, so waiting on it first (even
// briefly) was pure dead time on every single boot. Calling
// onConfigResendTimeout() directly here sends a configResendRequest right
// away (once this module has finished evaluating -- the earliest point the
// watch's own outbound message channel can realistically be up) instead of
// scheduling a delayed first attempt; it still arms the same
// CONFIG_RESEND_TIMEOUT_MS-spaced retries (up to MAX_CONFIG_RESENDS) as a
// fallback if this first request is itself dropped.
onConfigResendTimeout();
