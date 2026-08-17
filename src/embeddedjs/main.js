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
let apiKey = "";
let scheduleDaysBitmask = 0;
let scheduleStartMinutes = 0;
let scheduleEndMinutes = 0;
let timelineEnabled = false;
let configLoaded = false;

let pendingConfigCount = 0;
let pendingStops = [];
let pendingLines = [];

function onConfigReady() {
	// overridden by the UI section (Task 9) once it exists
}

const configMessageKeys = [
	"itemIndex",
	"itemCount",
	"itemType",
	"apiKey",
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
	keys: configMessageKeys,
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
		apiKey = item.apiKey;
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
