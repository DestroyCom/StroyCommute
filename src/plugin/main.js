// StroyCommute's plugin: the next departures of the trips tracked in the
// app's settings, as the source transit/departure, so any watchface (or
// Index) can show them. Pebble app plugins are a preview feature: the
// plugin only runs while something reads its source, and is started fresh
// for each request (state lives in localStorage, shared with pkjs).
//
// This file is the plugin's own code. The script the SDK bundles,
// src/plugin/plugin.js, is generated from it plus src/pkjs/trips.js (the
// SDK copies a plugin script as is, without require()): run
// `npm run sync:plugin` after changing either.
//
// PRIM quota: a watchface can read the source all day, so the plugin
// shares the app's call guard and daily count (same localStorage keys),
// fetches a trip at most every MIN_FETCH_MS, serves at most MAX_TRIPS trips
// and stops fetching when the day's remaining quota falls under
// QUOTA_RESERVE, leaving it to the app. It answers from its cache then.

/* global trips */

const CONFIG_KEY = "stroycommuteConfig";
const CACHE_KEY = "stroycommutePluginCache";
// trip key -> when the plugin last called PRIM for it, answer or not: a
// watchface reads the source on every change, and without this a failed or
// empty answer (no departure at night) was fetched again on each read.
const TRIED_KEY = "stroycommutePluginTried";
const QUOTA_KEY = "stroycommuteQuota";
const GUARD_KEY = "stroycommuteCallGuard";
const STOP_MONITORING_URL =
	"https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring";
const MIN_FETCH_MS = 2 * 60000;
const MAX_TRIPS = 3;
const PRIM_DAILY_QUOTA = 1000;
const QUOTA_RESERVE = 300;
// Times older than this aren't served at all.
const MAX_AGE_MS = 30 * 60000;

const TEXTS = {
	fr: { atStop: "À quai", towards: "Vers", minutes: "min" },
	en: { atStop: "At stop", towards: "To", minutes: "min" },
};

/** @returns {*} The parsed localStorage value, `fallback` if missing/garbled. */
function readJson(key, fallback) {
	try {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw) : fallback;
	} catch (_error) {
		return fallback;
	}
}

/** @returns {string} The trip's key, as pkjs and the watch build it. */
function tripKey(stop) {
	return [stop.stopRef, stop.lineRef, stop.destStopRef || ""].join("|");
}

/** @returns {number} PRIM calls left today by the app's own count. */
function quotaLeft(now) {
	const today = new Date(now).toISOString().slice(0, 10);
	const state = readJson(QUOTA_KEY, null);
	const used = state && state.date === today ? state.count : 0;
	return PRIM_DAILY_QUOTA - used;
}

/** Adds one call to the app's daily count (see pkjs). */
function countCall(now) {
	const today = new Date(now).toISOString().slice(0, 10);
	let state = readJson(QUOTA_KEY, null);
	if (!state || state.date !== today) state = { date: today, count: 0 };
	state.count += 1;
	localStorage.setItem(QUOTA_KEY, JSON.stringify(state));
}

/**
 * @returns {Promise<?object[]>} The stop's MonitoredStopVisit list, null on
 *   any failure (network, quota, bad key or stop).
 */
async function fetchVisits(apiKey, ref, lineRef, now) {
	const url = `${STOP_MONITORING_URL}?MonitoringRef=${encodeURIComponent(ref)}&LineRef=${encodeURIComponent(lineRef)}`;
	countCall(now);
	// One line per PRIM call, to check the plugin's pace in `pebble logs`.
	console.log(`plugin: stop-monitoring ${ref} ${lineRef}`);
	// No timeout of our own: the Pebble app refuses setTimeout to plugins
	// (it threw on every call), and its plugin host already gives up on a
	// request that doesn't answer.
	return fetch(url, { headers: { apiKey: apiKey } })
		.then((response) => {
			if (!response.ok)
				console.log(`plugin: HTTP ${response.status} for ${ref}`);
			return response.ok ? response.json() : null;
		})
		.then((body) => {
			if (!body) return null;
			const delivery = body.Siri.ServiceDelivery.StopMonitoringDelivery[0];
			const visits = delivery.MonitoredStopVisit || [];
			console.log(`plugin: ${visits.length} visits for ${ref}`);
			return visits;
		})
		.catch((error) => {
			console.log(`plugin: failed for ${ref}: ${error}`);
			return null;
		});
}

/**
 * @param {object[]} visits - Already filtered for an A->B trip.
 * @param {number} now
 * @returns {?object} What the source serves for a trip, null if no
 *   departure has a usable time.
 */
function summarize(visits, now) {
	// A cancelled train is never served as a departure.
	const departures = trips
		.rankDepartures(visits, now)
		.filter((d) => !d.cancelled);
	if (departures.length === 0) return null;
	const first = departures[0];
	const second = departures.length > 1 ? departures[1] : null;
	return {
		at: now,
		atStop: first.atStop,
		cancelled: first.cancelled,
		time: first.timeMs,
		time2: second ? second.timeMs : null,
		destination: trips.journeyDestinationName(first.journey),
		mission: trips.journeyMission(first.journey),
	};
}

/**
 * @returns {Promise<?object>} Fresh times for `stop`, null when PRIM
 *   answers without a usable departure, or the cached ones when fetching
 *   isn't allowed right now or fails.
 */
async function tripTimes(config, stop, cached, now) {
	if (cached && now - cached.at < MIN_FETCH_MS) return cached;
	const tried = readJson(TRIED_KEY, {});
	if (now - (tried[tripKey(stop)] || 0) < MIN_FETCH_MS) return cached;
	if (quotaLeft(now) < QUOTA_RESERVE) return cached;
	const refs = stop.destStopRef
		? [stop.stopRef, stop.destStopRef]
		: [stop.stopRef];
	if (refs.some((ref) => /:monomodalStopPlace:$/.test(ref))) return null;
	const guard = trips.decideCallGuard(
		readJson(GUARD_KEY, null),
		config.callGuard,
		now,
		refs.length
	);
	localStorage.setItem(GUARD_KEY, JSON.stringify(guard.state));
	if (!guard.allowed) return cached;
	// Written before the calls, so reads arriving meanwhile don't call too.
	const triedNow = readJson(TRIED_KEY, {});
	triedNow[tripKey(stop)] = now;
	localStorage.setItem(TRIED_KEY, JSON.stringify(triedNow));
	const results = await Promise.all(
		refs.map((ref) => fetchVisits(config.apiKey, ref, stop.lineRef, now))
	);
	if (results.some((visits) => visits === null)) return cached;
	const kept = stop.destStopRef
		? trips.filterVisitsServingStop(results[0], results[1])
		: results[0];
	const times = summarize(kept, now);
	if (!times) {
		console.log(
			`plugin: no usable departure for ${tripKey(stop)} (${kept.length} kept)`
		);
	}
	// PRIM answered: no departure means none, not "keep the last train"
	// (which has left). Only a failed call keeps the cached times.
	return times;
}

/** @returns {{shortText: {text: string}}} */
function short(text) {
	return { shortText: { text: String(text).slice(0, 7) } };
}

/** @returns {number} Whole minutes from now until `timeMs`, at least 0. */
function minutesUntil(timeMs, now) {
	return Math.max(0, Math.round((timeMs - now) / 60000));
}

/** @returns {object} The source's properties for one trip. */
function propertiesOf(stop, times, texts, now) {
	const title = stop.destStopName
		? `${stop.lineName} — ${stop.stopName} > ${stop.destStopName}`
		: `${stop.lineName} — ${stop.stopName}`;
	const properties = {
		name: Object.assign(short(stop.lineName), { longText: { text: title } }),
		line: short(stop.lineName),
		stop: { longText: { text: stop.stopName } },
	};
	if (times.destination) {
		properties.destination = {
			longText: { text: `${texts.towards} ${times.destination}` },
		};
	}
	if (times.atStop) {
		properties.next = {
			shortText: { text: texts.atStop },
			longText: { text: texts.atStop },
			numericValue: { value: 0, unit: "min" },
		};
	} else if (typeof times.time === "number") {
		const minutes = minutesUntil(times.time, now);
		const label = `${minutes} ${texts.minutes}`;
		properties.next = {
			shortText: { text: label },
			longText: {
				text: times.destination ? `${label} — ${times.destination}` : label,
			},
			numericValue: { value: minutes, unit: "min" },
		};
		properties.next_time = {
			timestamp: { value: Math.floor(times.time / 1000) },
		};
	}
	if (typeof times.time2 === "number") {
		const label = `${minutesUntil(times.time2, now)} ${texts.minutes}`;
		properties.following = {
			shortText: { text: label },
			longText: { text: label },
		};
		properties.following_time = {
			timestamp: { value: Math.floor(times.time2 / 1000) },
		};
	}
	return properties;
}

// A departure this long past (ms) counts as left.
const LEFT_AFTER_MS = 60000;

/**
 * @param {?object} times - A trip's stored times.
 * @param {number} now
 * @returns {?object} The same without trains that have left: a following
 *   train takes the first one's place (its destination and mission aren't
 *   known, so they go), null when no known train is still to come.
 */
function usableTimes(times, now) {
	if (!times || times.atStop || typeof times.time !== "number") return times;
	if (times.time >= now - LEFT_AFTER_MS) return times;
	if (typeof times.time2 === "number" && times.time2 >= now - LEFT_AFTER_MS) {
		return Object.assign({}, times, {
			time: times.time2,
			time2: null,
			destination: "",
			mission: "",
		});
	}
	return null;
}

Pebble.registerSourceHandler(async (request, respond) => {
	if (request.category !== "transit" || request.item !== "departure") {
		respond.error("INVALID_REQUEST");
		return;
	}
	const now = Date.now();
	const config = readJson(CONFIG_KEY, null);
	if (!config || !config.apiKey || config.pluginEnabled === false) {
		respond.data({ validUntilMs: now + MIN_FETCH_MS, instances: [] });
		return;
	}
	const texts = config.language === "en" ? TEXTS.en : TEXTS.fr;
	const stops = (config.trackedStops || []).slice(0, MAX_TRIPS);
	const cache = readJson(CACHE_KEY, {});
	const results = await Promise.all(
		stops.map((stop) =>
			tripTimes(config, stop, cache[tripKey(stop)] || null, now).catch(
				(error) => {
					console.log(`plugin: ${tripKey(stop)} failed: ${error}`);
					return cache[tripKey(stop)] || null;
				}
			)
		)
	);
	const nextCache = {};
	const instances = [];
	stops.forEach((stop, i) => {
		const times = results[i];
		if (!times || now - times.at > MAX_AGE_MS) return;
		nextCache[tripKey(stop)] = times;
		const usable = usableTimes(times, now);
		if (!usable) return;
		instances.push({
			instanceId: tripKey(stop),
			properties: propertiesOf(stop, usable, texts, now),
		});
	});
	localStorage.setItem(CACHE_KEY, JSON.stringify(nextCache));
	// Read again within the minute, so the countdown texts move on.
	respond.data({ validUntilMs: now + 60000, instances: instances });
});
