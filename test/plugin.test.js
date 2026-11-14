// The generated plugin script (src/plugin/plugin.js) under a fake Pebble
// plugin runtime: registerSourceHandler, fetch, localStorage, timers.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { siriAnswer } = require("./helpers/phone-sim");

const PLUGIN = path.join(__dirname, "..", "src", "plugin", "plugin.js");
const STOP = { stopRef: "STIF:StopPoint:Q:1:", lineRef: "STIF:Line::C01374:", lineName: "4", stopName: "Bagneux" };
const CONFIG = { apiKey: "key", trackedStops: [STOP], language: "fr" };

/** Loads the plugin with fresh fakes; `answer(url)` plays PRIM. */
function loadPlugin({ storage = new Map(), now = Date.UTC(2026, 10, 13, 8), answer } = {}) {
	let handler = null;
	const urls = [];
	const saved = {};
	const fakes = {
		localStorage: {
			getItem: (k) => (storage.has(k) ? storage.get(k) : null),
			setItem: (k, v) => storage.set(k, String(v)),
			removeItem: (k) => storage.delete(k),
		},
		// As in the Pebble app (seen on a real phone): every PRIM call failed
		// on this, so the plugin never served a time.
		setTimeout: () => {
			throw new Error("setTimeout is not available to plugins");
		},
		fetch: async (url, options) => {
			urls.push({ url, apiKey: options.headers.apiKey });
			const body = answer ? answer(url) : siriAnswer(now, [3, 9]);
			return { ok: body !== null, json: async () => body };
		},
		Pebble: { registerSourceHandler: (fn) => (handler = fn) },
	};
	for (const key of Object.keys(fakes)) saved[key] = globalThis[key];
	Object.assign(globalThis, fakes);
	const realNow = Date.now;
	let clock = now;
	Date.now = () => clock;
	delete require.cache[require.resolve(PLUGIN)];
	require(PLUGIN);
	return {
		storage,
		urls,
		advance(ms) {
			clock += ms;
		},
		/** @returns {Promise<object>} What the handler answered. */
		read(request = { category: "transit", item: "departure" }) {
			return new Promise((resolve) => {
				handler(request, {
					data: (envelope) => resolve({ data: envelope }),
					error: (code) => resolve({ error: code }),
				});
			});
		},
		restore() {
			Date.now = realNow;
			Object.assign(globalThis, saved);
		},
	};
}

const withConfig = (config = CONFIG) => new Map([["stroycommuteConfig", JSON.stringify(config)]]);

test("serves one instance per tracked trip with the next departures", async () => {
	const plugin = loadPlugin({ storage: withConfig() });
	const { data } = await plugin.read();
	assert.strictEqual(data.instances.length, 1);
	const p = data.instances[0].properties;
	assert.strictEqual(data.instances[0].instanceId, `${STOP.stopRef}|${STOP.lineRef}|`);
	assert.deepStrictEqual(p.name.shortText, { text: "4" });
	assert.strictEqual(p.name.longText.text, "4 — Bagneux");
	// No lone `min`: the phone app drops a numericValue whose min comes
	// without max ("min and max come as a pair", seen in `pebble logs`).
	assert.deepStrictEqual(p.next.numericValue, { value: 3, unit: "min" });
	assert.strictEqual(p.next.shortText.text, "3 min");
	assert.strictEqual(p.following.shortText.text, "9 min");
	assert.strictEqual(typeof p.next_time.timestamp.value, "number");
	assert.strictEqual(p.destination.longText.text, "Vers Porte de Clignancourt");
	assert.strictEqual(plugin.urls[0].apiKey, "key");
	plugin.restore();
});

test("reads within 2 minutes reuse the cached times, counting down", async () => {
	const plugin = loadPlugin({ storage: withConfig() });
	await plugin.read();
	plugin.advance(60000);
	const { data } = await plugin.read();
	assert.strictEqual(plugin.urls.length, 1);
	assert.strictEqual(data.instances[0].properties.next.shortText.text, "2 min");
	plugin.advance(60000);
	await plugin.read();
	assert.strictEqual(plugin.urls.length, 2);
	plugin.restore();
});

// Seen on a real phone: a watchface reads the source on every property
// change, and with no usable answer (failure, or no departure at night)
// nothing was cached, so every read called PRIM again: 50 calls in 4 min.
test("a failed or empty answer still waits 2 minutes before calling again", async () => {
	for (const answer of [() => null, (url) => siriAnswer(Date.UTC(2026, 10, 13, 8), [])]) {
		const plugin = loadPlugin({ storage: withConfig(), answer });
		await plugin.read();
		plugin.advance(2000);
		await plugin.read();
		assert.strictEqual(plugin.urls.length, 1);
		plugin.advance(2 * 60000);
		await plugin.read();
		assert.strictEqual(plugin.urls.length, 2);
		plugin.restore();
	}
});

test("reads arriving together make one call per trip", async () => {
	const plugin = loadPlugin({ storage: withConfig() });
	await Promise.all([plugin.read(), plugin.read(), plugin.read()]);
	assert.strictEqual(plugin.urls.length, 1);
	plugin.restore();
});

test("stops calling PRIM when the day's quota runs low, and counts its calls", async () => {
	const today = new Date(Date.UTC(2026, 10, 13, 8)).toISOString().slice(0, 10);
	const storage = withConfig();
	storage.set("stroycommuteQuota", JSON.stringify({ date: today, count: 750 }));
	const plugin = loadPlugin({ storage });
	await plugin.read();
	assert.strictEqual(plugin.urls.length, 0);
	plugin.restore();

	storage.set("stroycommuteQuota", JSON.stringify({ date: today, count: 10 }));
	const again = loadPlugin({ storage });
	await again.read();
	assert.strictEqual(JSON.parse(storage.get("stroycommuteQuota")).count, 11);
	again.restore();
});

test("honours the app's call guard", async () => {
	const storage = withConfig({ ...CONFIG, callGuard: { maxCalls: 2, windowMinutes: 10, pauseMinutes: 15 } });
	const now = Date.UTC(2026, 10, 13, 8);
	storage.set("stroycommuteCallGuard", JSON.stringify({ calls: [now - 1000, now - 2000], pausedUntil: 0 }));
	const plugin = loadPlugin({ storage, now });
	const { data } = await plugin.read();
	assert.strictEqual(plugin.urls.length, 0);
	assert.deepStrictEqual(data.instances, []);
	plugin.restore();
});

test("serves nothing when disabled in the settings or without a key", async () => {
	for (const config of [{ ...CONFIG, pluginEnabled: false }, { ...CONFIG, apiKey: "" }]) {
		const plugin = loadPlugin({ storage: withConfig(config) });
		const { data } = await plugin.read();
		assert.deepStrictEqual(data.instances, []);
		assert.strictEqual(plugin.urls.length, 0);
		plugin.restore();
	}
});

// Seen on a real phone at night: PRIM answered 0 visits for a metro stop
// and the plugin kept serving the last (departed) train.
test("an answer without departures drops the last times", async () => {
	let empty = false;
	const plugin = loadPlugin({
		storage: withConfig(),
		answer: () => siriAnswer(Date.UTC(2026, 10, 13, 8), empty ? [] : [6]),
	});
	await plugin.read();
	empty = true;
	plugin.advance(3 * 60000);
	const { data } = await plugin.read();
	assert.deepStrictEqual(data.instances, []);
	plugin.restore();
});

test("a failed fetch keeps the last times, an unknown source is refused", async () => {
	let fail = false;
	const plugin = loadPlugin({ storage: withConfig(), answer: () => (fail ? null : siriAnswer(Date.UTC(2026, 10, 13, 8), [6])) });
	await plugin.read();
	fail = true;
	plugin.advance(3 * 60000);
	const { data } = await plugin.read();
	assert.strictEqual(data.instances[0].properties.next.shortText.text, "3 min");
	assert.deepStrictEqual(await plugin.read({ category: "weather", item: "location" }), { error: "INVALID_REQUEST" });
	plugin.restore();
});

test("a cancelled train is never served as a departure", async () => {
	const now = Date.UTC(2026, 10, 13, 8);
	const cancelledOnly = siriAnswer(now, [4]);
	cancelledOnly.Siri.ServiceDelivery.StopMonitoringDelivery[0].MonitoredStopVisit[0].MonitoredVehicleJourney.MonitoredCall.DepartureStatus =
		"cancelled";
	const plugin = loadPlugin({ storage: withConfig(), now, answer: () => cancelledOnly });
	const { data } = await plugin.read();
	assert.deepStrictEqual(data.instances, []);
	plugin.restore();

	const mixed = siriAnswer(now, [2, 7]);
	mixed.Siri.ServiceDelivery.StopMonitoringDelivery[0].MonitoredStopVisit[0].MonitoredVehicleJourney.MonitoredCall.DepartureStatus =
		"cancelled";
	const again = loadPlugin({ storage: withConfig(), now, answer: () => mixed });
	const read = await again.read();
	assert.strictEqual(read.data.instances[0].properties.next.shortText.text, "7 min");
	again.restore();
});

test("a train that has left is not served: the following one takes its place, else nothing", async () => {
	const plugin = loadPlugin({ storage: withConfig(), answer: (url) => (url ? siriAnswer(Date.UTC(2026, 10, 13, 8), [1, 6]) : null) });
	await plugin.read();
	plugin.advance(3 * 60000); // first left 2 min ago; within the fetch interval? no: refetch happens
	// Make the refetch fail so the cached times are what is served.
	globalThis.fetch = async () => ({ ok: false, json: async () => null });
	const { data } = await plugin.read();
	const p = data.instances[0].properties;
	assert.strictEqual(p.next.shortText.text, "3 min");
	assert.strictEqual(p.following, undefined);
	plugin.advance(5 * 60000);
	assert.deepStrictEqual((await plugin.read()).data.instances, []);
	plugin.restore();
});
