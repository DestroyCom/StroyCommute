// Runs src/embeddedjs/main.js under Node with a fake Alloy runtime: just
// enough Piu, pebble/message, timers and localStorage to drive the watch
// code from tests (no rendering, no real AppMessage). Each loadWatch() call
// gets a fresh module instance and fresh fakes.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MAIN = path.join(__dirname, "..", "..", "src", "embeddedjs", "main.js");
let loads = 0;

/** Piu-like content: string, visible, skin, style, and children. */
class FakeContent {
	constructor(_behaviorData, dict = {}) {
		Object.assign(this, dict);
		if (this.visible === undefined) this.visible = true;
		this.contents = [];
		for (const child of dict.contents || []) this.add(child);
	}
	add(child) {
		this.contents.push(child);
	}
	empty() {
		this.contents = [];
	}
}

/**
 * @param {object} [options]
 * @param {Map<string, string>} [options.storage] - Initial watch localStorage.
 * @returns {Promise<object>} Handle to drive and inspect the watch app.
 */
async function loadWatch(options = {}) {
	const storage = options.storage || new Map();
	let now = 1_000_000;
	const timers = [];
	const sent = [];
	const instances = [];
	let writable = false;
	let failNextWrite = null;
	let app = null;
	const vibrations = [];
	const watchListeners = {};
	const connected = { app: true, pebblekit: true };

	const fakes = {
		localStorage: {
			getItem: (k) => (storage.has(k) ? storage.get(k) : null),
			setItem: (k, v) => storage.set(k, String(v)),
			removeItem: (k) => storage.delete(k),
		},
		setTimeout: (fn, ms) => {
			const timer = { fn, at: now + ms, repeat: 0 };
			timers.push(timer);
			return timer;
		},
		setInterval: (fn, ms) => {
			const timer = { fn, at: now + ms, repeat: ms };
			timers.push(timer);
			return timer;
		},
		clearTimeout: (timer) => {
			const i = timers.indexOf(timer);
			if (i >= 0) timers.splice(i, 1);
		},
		Skin: class {
			constructor(dict) {
				this.fill = dict.fill;
			}
		},
		Style: class {
			constructor(dict) {
				Object.assign(this, dict);
			}
		},
		Container: FakeContent,
		Label: FakeContent,
		Text: FakeContent,
		Behavior: class {},
		Application: class extends FakeContent {
			constructor(behaviorData, dict) {
				super(behaviorData, dict);
				this.behavior = new dict.Behavior();
				app = this;
			}
			focus() {}
		},
		__Message: class {
			constructor(options) {
				this.options = options;
				this.queue = [];
				instances.push(this);
			}
			read() {
				return this.queue.shift();
			}
			write(map) {
				if (failNextWrite) {
					const error = failNextWrite;
					failNextWrite = null;
					throw error;
				}
				if (!writable) throw new Error("not writable");
				for (const key of map.keys()) {
					if (!this.options.keys.has(key)) throw new Error("unmapped key");
				}
				sent.push(Object.fromEntries(map));
			}
		},
	};
	fakes.clearInterval = fakes.clearTimeout;
	// Emery's rectangle unless the test asks for another screen.
	fakes.screen = options.screen || { width: 200, height: 228, round: false };
	fakes.__Vibes = {
		shortPulse: () => vibrations.push("short"),
		longPulse: () => vibrations.push("long"),
		doublePulse: () => vibrations.push("double"),
	};
	fakes.watch = {
		connected,
		addEventListener: (name, fn) => {
			if (!watchListeners[name]) watchListeners[name] = [];
			watchListeners[name].push(fn);
		},
	};
	Object.assign(globalThis, fakes);
	const realNow = Date.now;
	Date.now = () => now;

	// main.js imports "pebble/message"; point it at the fake instead.
	const source = fs
		.readFileSync(MAIN, "utf8")
		.replace(
			'import Message from "pebble/message";',
			"const Message = globalThis.__Message;"
		)
		.replace('import Vibes from "pebble/vibes";', "const Vibes = globalThis.__Vibes;");
	const file = path.join(os.tmpdir(), `stroycommute-main-${process.pid}-${++loads}.mjs`);
	fs.writeFileSync(file, source);
	try {
		await import(pathToFileURL(file).href);
	} finally {
		fs.unlinkSync(file);
	}

	/** Collects the visible strings of a content tree, in order. */
	function visibleStrings(content, out = []) {
		if (!content || !content.visible) return out;
		if (typeof content.string === "string" && content.string) out.push(content.string);
		for (const child of content.contents) visibleStrings(child, out);
		return out;
	}

	const handle = {
		storage,
		sent,
		vibrations,
		/** Fires a `watch` event (minutechange, connected...). */
		emit(name) {
			for (const fn of watchListeners[name] || []) fn();
		},
		/** Sets watch.connected.app and fires "connected". */
		setPhoneConnected(value) {
			connected.app = value;
			handle.emit("connected");
		},
		get instances() {
			return instances;
		},
		/** The phone side became reachable: writes work, onWritable fires. */
		connect() {
			writable = true;
			for (const m of instances) if (m.options.onWritable) m.options.onWritable.call(m);
		},
		/** Next write throws `error` (e.g. busy or overflow). */
		failNextWrite(error) {
			failNextWrite = error;
		},
		/** Delivers one phone -> watch message. */
		deliver(object) {
			const m = instances[instances.length - 1];
			m.queue.push(new Map(Object.entries(object)));
			m.options.onReadable.call(m, 1);
		},
		/** Moves the fake clock, firing due timers in order. */
		advance(ms) {
			const end = now + ms;
			for (;;) {
				timers.sort((a, b) => a.at - b.at);
				const timer = timers[0];
				if (!timer || timer.at > end) break;
				now = timer.at;
				if (timer.repeat) timer.at += timer.repeat;
				else timers.shift();
				timer.fn();
			}
			now = end;
		},
		press(button) {
			const name = `onPress${button[0].toUpperCase()}${button.slice(1)}`;
			const result = app.behavior[name](app);
			const release = app.behavior[`onRelease${button[0].toUpperCase()}${button.slice(1)}`];
			if (release) release.call(app.behavior, app);
			return result;
		},
		/** @returns {string[]} What the screen shows, top to bottom. */
		screen() {
			return visibleStrings(app);
		},
		/** @returns {?string} The banner's fill color, null when hidden. */
		bannerColor() {
			const banner = app.contents[0].contents[0];
			return banner.visible ? banner.skin.fill : null;
		},
		get now() {
			return now;
		},
		get timerCount() {
			return timers.length;
		},
		get root() {
			return app;
		},
		restore() {
			Date.now = realNow;
		},
	};
	return handle;
}

/** Config items as pkjs's sendConfigToWatch sends them. */
function configItems(stops, language = "fr", vibrateMinutes = 0) {
	const count = 1 + stops.length;
	return [
		{
			itemIndex: 0,
			itemCount: count,
			itemType: "configMeta",
			scheduleDaysBitmask: 0,
			scheduleStartMinutes: 0,
			scheduleEndMinutes: 0,
			timelineEnabled: 0,
			language,
			vibrateMinutes,
		},
		...stops.map((stop, i) => ({
			itemIndex: 1 + i,
			itemCount: count,
			itemType: "configStop",
			lineColor: "#BE418D",
			lineTextColor: "#FFFFFF",
			...stop,
		})),
	];
}

module.exports = { loadWatch, configItems };
