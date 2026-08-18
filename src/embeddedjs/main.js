import Button from "pebble/button";
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
];
const MESSAGE_KEY_CODES = new Map(
	ALL_MESSAGE_KEYS.map((key, index) => [key, 10000 + index])
);

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
const CONFIG_RESEND_TIMEOUT_MS = 4000;
const MAX_CONFIG_RESENDS = 3;

function scheduleConfigResendTimeout() {
	if (configResendTimer !== null) return; // already scheduled
	configResendTimer = setTimeout(
		onConfigResendTimeout,
		CONFIG_RESEND_TIMEOUT_MS
	);
}

function clearConfigResendTimeout() {
	if (configResendTimer !== null) {
		clearTimeout(configResendTimer);
		configResendTimer = null;
	}
}

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

function flushRefreshQueue() {
	while (refreshQueue.length > 0) {
		if (!tryWriteRefreshStop(refreshQueue[0])) break; // wait for onWritable to retry
		refreshQueue.shift();
	}
}

function requestRefresh() {
	// Merge, don't overwrite: if the previous round hasn't fully drained
	// (e.g. a Bluetooth stall keeps the single outbound slot busy across a
	// tick boundary), `refreshQueue = stops.slice()` would silently discard
	// whatever was still pending and reset every stop to the front of the
	// queue — starving stops that were already waiting longer in favor of
	// ones that already got sent last round. Append only stops not already
	// queued (dedup by stopRef) so pending items keep their place in line.
	if (refreshQueue.length > 0) {
		console.log(
			`requestRefresh: ${refreshQueue.length} refreshStop(s) from the previous round still queued — merging instead of overwriting`
		);
	}
	for (const stop of stops) {
		const alreadyQueued = refreshQueue.some(
			(queued) => queued.stopRef === stop.stopRef
		);
		if (!alreadyQueued) refreshQueue.push(stop);
	}
	flushRefreshQueue();
}

function startRefreshTimer() {
	if (refreshTimer) return;
	refreshTimer = setInterval(requestRefresh, 45000);
}

const previousOnConfigReady = onConfigReady;
onConfigReady = () => {
	previousOnConfigReady();
	requestRefresh();
	startRefreshTimer();
};

// --- Piu UI — list screen ---
// The first real Piu UI screen this project builds. Replaces the placeholder
// Poco clock face (raw `render.begin()/fillRectangle/drawText/end()` on
// `secondchange`, formerly here) entirely rather than running alongside it —
// a full Piu `Application` owns the display's render list once created (see
// `PiuView`'s constructor setting `screen.context = this`), and a second,
// unrelated direct-draw loop on the same `screen` would fight it for the
// same framebuffer. `Skin`/`Style`/`Container`/`Label`/`Application` need no
// import: the SDK's pebble host (`build/devices/pebble/host/main.js`)
// injects them as globals into every app module's scope via `import {} from
// "piu/MC"` — confirmed by reading that file directly, not guessed. `Button`
// is the one exception, not in that globals list, hence the explicit
// `import Button from "pebble/button"` above (also confirmed against the
// SDK's own `setup/piu.js`, which imports it the same way).

const whiteSkin = new Skin({ fill: "white" });
const highlightSkin = new Skin({ fill: "#4444FF" });
const rowStyle = new Style({ font: "18px Gothic", color: "black" });
const rowStyleSelected = new Style({ font: "18px Gothic", color: "white" });

function buildItemList() {
	const items = [];
	for (const stop of stops) {
		items.push({
			type: "stop",
			stopRef: stop.stopRef,
			lineName: stop.lineName,
			stopName: stop.stopName,
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

function rowLabel(item) {
	if (item.type === "stop") {
		const dep = departures.get(item.stopRef);
		let status = "...";
		if (dep) {
			if (dep.state === "ok")
				status = dep.atStop ? "à quai" : `${dep.minutes} min`;
			else if (dep.state === "network") status = "erreur réseau";
			else if (dep.state === "noRealtimeData") status = "pas de temps réel";
			else if (dep.state === "quotaExceeded") status = "quota dépassé";
		}
		return `${item.lineName}  ${item.stopName}  ${status}`;
	}
	return `${item.lineName}  alertes (bientôt)`;
}

let selectedIndex = 0;
let currentScreenMode = "list"; // "list" | "detail", read/written by Task 10 too

const application = new Application(null, {
	left: 0,
	right: 0,
	top: 0,
	bottom: 0,
	skin: whiteSkin,
});

function buildListScreen() {
	const items = buildItemList();
	if (items.length === 0) {
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
					string: "Aucun arrêt configuré",
				}),
			],
		});
	}

	const windowStart = Math.max(
		0,
		Math.min(selectedIndex - 1, items.length - 3)
	);
	const visibleCount = Math.min(3, items.length);
	const rowContents = [];
	for (let i = 0; i < visibleCount; i++) {
		const absoluteIndex = windowStart + i;
		if (absoluteIndex >= items.length) break;
		const item = items[absoluteIndex];
		const selected = absoluteIndex === selectedIndex;
		rowContents.push(
			new Container(null, {
				left: 0,
				right: 0,
				top: i * 50,
				height: 50,
				skin: selected ? highlightSkin : whiteSkin,
				contents: [
					new Label(null, {
						left: 8,
						top: 15,
						style: selected ? rowStyleSelected : rowStyle,
						string: rowLabel(item),
					}),
				],
			})
		);
	}

	return new Container(null, {
		left: 0,
		right: 0,
		top: 0,
		bottom: 0,
		skin: whiteSkin,
		contents: rowContents,
	});
}

const titleStyle = new Style({ font: "bold 24px Gothic", color: "black" });
const bodyStyle = new Style({ font: "18px Gothic", color: "black" });
const errorStyle = new Style({ font: "18px Gothic", color: "#AA0000" });

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
			contents: [],
		});
	}

	const lines = [];
	if (item.type === "stop") {
		const dep = departures.get(item.stopRef);
		lines.push(
			new Label(null, {
				top: 10,
				left: 8,
				right: 8,
				style: titleStyle,
				string: `${item.lineName} — ${item.stopName}`,
			})
		);
		if (!dep) {
			lines.push(
				new Label(null, {
					top: 60,
					left: 8,
					right: 8,
					style: bodyStyle,
					string: "Chargement...",
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
				new Label(null, {
					top: 60,
					left: 8,
					right: 8,
					style: bodyStyle,
					string: dep.destination,
				})
			);
			lines.push(
				new Label(null, {
					top: 100,
					left: 8,
					right: 8,
					style: titleStyle,
					string: status,
				})
			);
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

function renderCurrentScreen() {
	application.empty();
	if (currentScreenMode === "list") {
		application.add(buildListScreen());
	} else {
		application.add(buildDetailScreen()); // Task 10
	}
}

new Button({
	types: ["select", "up", "down", "back"],
	onPush(down, type) {
		if (!down) return; // only act on press, not release
		if (currentScreenMode === "list") {
			const items = buildItemList();
			if (items.length === 0) return; // nothing to select/scroll yet
			if (type === "up") selectedIndex = Math.max(0, selectedIndex - 1);
			else if (type === "down")
				selectedIndex = Math.min(items.length - 1, selectedIndex + 1);
			else if (type === "select") currentScreenMode = "detail"; // Task 10
			renderCurrentScreen();
		} else {
			const items = buildItemList();
			// Clamp against the *current* list length, not just decrement/
			// increment the previous selectedIndex: if the tracked-stops
			// config changed while a detail screen was open (list shrank),
			// selectedIndex can be stale and out of range for `items` here.
			// Math.min(maxIndex, ...) pulls a too-large stale index straight
			// back into range on the very first up/down press (rather than
			// requiring several presses to walk it back one step at a time),
			// and the outer Math.max(0, ...) also covers items.length === 0
			// (maxIndex clamps to 0, matching buildDetailScreen's own
			// items[0] === undefined guard, which then renders an empty
			// screen instead of crashing).
			const maxIndex = Math.max(0, items.length - 1);
			if (type === "up")
				selectedIndex = Math.max(0, Math.min(maxIndex, selectedIndex - 1));
			else if (type === "down")
				selectedIndex = Math.max(0, Math.min(maxIndex, selectedIndex + 1));
			else if (type === "back") currentScreenMode = "list";
			renderCurrentScreen();
		}
	},
});

renderCurrentScreen();
