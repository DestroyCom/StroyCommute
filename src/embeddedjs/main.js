import Poco from "commodetto/Poco";
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

function handleConfigItem(item) {
	if (item.itemType === "configMeta") {
		scheduleDaysBitmask = item.scheduleDaysBitmask;
		scheduleStartMinutes = item.scheduleStartMinutes;
		scheduleEndMinutes = item.scheduleEndMinutes;
		timelineEnabled = !!item.timelineEnabled;
		pendingConfigCount = item.itemCount;
		pendingStops = [];
		pendingLines = [];
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

	if (item.itemIndex === pendingConfigCount - 1) {
		stops = pendingStops;
		alertLines = pendingLines;
		configLoaded = true;
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

// Real implementation lands in Task 9; stubbed here so this task is
// independently testable without depending on Task 9's completion.
const renderCurrentScreen = () => {};

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

const render = new Poco(screen);

const font = new render.Font("Bitham-Black", 30);
const black = render.makeColor(0, 0, 0);
const white = render.makeColor(255, 255, 255);

function draw() {
	render.begin();
	render.fillRectangle(white, 0, 0, render.width, render.height);

	const msg = new Date().toTimeString().slice(0, 8);
	const width = render.getTextWidth(msg, font);

	render.drawText(
		msg,
		font,
		black,
		(render.width - width) / 2,
		(render.height - font.height) / 2
	);

	render.end();
}

watch.addEventListener("secondchange", draw);
