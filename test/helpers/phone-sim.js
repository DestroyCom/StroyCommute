// Runs src/pkjs/index.js under Node with a fake PebbleKit JS runtime:
// Pebble events and sendAppMessage, XMLHttpRequest answered by the test,
// timers on a fake clock, localStorage. Each loadPhone() call gets fresh
// modules and fakes.
const path = require("node:path");

const PKJS = path.join(__dirname, "..", "..", "src", "pkjs");

/**
 * @param {object} [options]
 * @param {Map<string, string>} [options.storage] - Initial localStorage.
 * @param {number} [options.nacks] - sendAppMessage calls to refuse first.
 */
function loadPhone(options = {}) {
	const storage = options.storage || new Map();
	let nacks = options.nacks || 0;
	let now = Date.UTC(2026, 10, 13, 8, 0, 0);
	const timers = [];
	const listeners = {};
	const sent = [];
	const attempts = [];
	const requests = [];
	let opened = null;

	const realNow = Date.now;
	const saved = {};
	const fakes = {
		localStorage: {
			getItem: (k) => (storage.has(k) ? storage.get(k) : null),
			setItem: (k, v) => storage.set(k, String(v)),
			removeItem: (k) => storage.delete(k),
		},
		setTimeout: (fn, ms) => {
			const timer = { fn, at: now + (ms || 0) };
			timers.push(timer);
			return timer;
		},
		clearTimeout: (timer) => {
			const i = timers.indexOf(timer);
			if (i >= 0) timers.splice(i, 1);
		},
		Pebble: {
			addEventListener: (name, fn) => {
				if (!listeners[name]) listeners[name] = [];
				listeners[name].push(fn);
			},
			sendAppMessage: (payload, ack, nack) => {
				attempts.push(payload);
				if (nacks > 0) {
					nacks--;
					if (nack) nack({ error: "busy" });
					return;
				}
				sent.push(payload);
				if (ack) ack();
			},
			openURL: (url) => {
				opened = url;
			},
			getActiveWatchInfo: () => ({
				platform: "emery",
				language: "fr_FR",
				firmware: { major: 4, minor: 9, patch: 1, suffix: "" },
			}),
		},
		XMLHttpRequest: class {
			constructor() {
				this.headers = {};
				this.aborted = false;
			}
			open(method, url) {
				this.method = method;
				this.url = url;
			}
			setRequestHeader(key, value) {
				this.headers[key] = value;
			}
			send() {
				requests.push(this);
			}
			abort() {
				this.aborted = true;
			}
			/** Test side: answer this request. */
			respond(status, body) {
				this.status = status;
				this.responseText = typeof body === "string" ? body : JSON.stringify(body);
				this.onload();
			}
		},
	};
	for (const key of Object.keys(fakes)) saved[key] = globalThis[key];
	Object.assign(globalThis, fakes);
	Date.now = () => now;

	for (const file of ["index.js", "trips.js", "diag.js"]) {
		delete require.cache[require.resolve(path.join(PKJS, file))];
	}
	const log = console.log;
	console.log = () => {};
	try {
		require(path.join(PKJS, "index.js"));
	} finally {
		console.log = log;
	}

	return {
		storage,
		sent,
		attempts,
		requests,
		get opened() {
			return opened;
		},
		/** Fires a Pebble event; console output is silenced. */
		fire(name, event) {
			const quiet = console.log;
			console.log = () => {};
			try {
				for (const fn of listeners[name] || []) fn(event);
			} finally {
				console.log = quiet;
			}
		},
		/** A watch -> phone message. */
		fromWatch(payload) {
			this.fire("appmessage", { payload });
		},
		advance(ms) {
			const end = now + ms;
			for (;;) {
				timers.sort((a, b) => a.at - b.at);
				const timer = timers[0];
				if (!timer || timer.at > end) break;
				now = timer.at;
				timers.shift();
				const quiet = console.log;
				console.log = () => {};
				try {
					timer.fn();
				} finally {
					console.log = quiet;
				}
			}
			now = end;
		},
		get now() {
			return now;
		},
		restore() {
			Date.now = realNow;
			Object.assign(globalThis, saved);
		},
	};
}

/**
 * @param {number} now - Epoch ms.
 * @param {number[]} minutes - Departures, in minutes from `now`.
 * @returns {object} A minimal SIRI Lite stop-monitoring answer.
 */
function siriAnswer(now, minutes) {
	return {
		Siri: {
			ServiceDelivery: {
				StopMonitoringDelivery: [
					{
						MonitoredStopVisit: minutes.map((m) => ({
							MonitoredVehicleJourney: {
								DestinationName: [{ value: "Porte de Clignancourt" }],
								MonitoredCall: {
									ExpectedDepartureTime: new Date(now + m * 60000).toISOString(),
								},
							},
						})),
					},
				],
			},
		},
	};
}

module.exports = { loadPhone, siriAnswer };
