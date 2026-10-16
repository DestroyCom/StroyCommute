// Pure SIRI helpers for A->B trips and the PRIM call guard -- no Pebble,
// XMLHttpRequest or localStorage access, so test/*.test.js can run them
// under plain Node. Field shapes: docs/idfm-api-reference.md ("SNCF
// journey fields used for A->B trips").
// No `?.` / `??` here: the SDK's webpack 1 bundler predates ES2020.

/**
 * @param {object} journey - A SIRI MonitoredVehicleJourney.
 * @returns {string[]} Every identity key available for this train: the
 *   dated journey ref first, then the train number. Several keys so a
 *   train missing one of them on one side still matches on the other.
 */
function journeyKeys(journey) {
	const keys = [];
	const framed = journey.FramedVehicleJourneyRef;
	if (framed && framed.DatedVehicleJourneyRef) {
		keys.push("ref:" + framed.DatedVehicleJourneyRef);
	}
	const numbers = journey.TrainNumbers
		? journey.TrainNumbers.TrainNumberRef
		: null;
	const number = (numbers || [])[0];
	if (number && number.value) keys.push("num:" + number.value);
	return keys;
}

/**
 * @param {object} call - A SIRI MonitoredCall.
 * @returns {number|null} Epoch ms of the best available time field, or
 *   null (same field order as callMinutesRemaining in index.js).
 */
function callTimeMs(call) {
	const field =
		call.ExpectedArrivalTime ||
		call.ExpectedDepartureTime ||
		call.AimedArrivalTime ||
		call.AimedDepartureTime;
	if (!field) return null;
	const ms = new Date(field).getTime();
	return Number.isNaN(ms) ? null : ms;
}

/**
 * @param {object} callA - The train's MonitoredCall at A.
 * @param {object} callB - The same train's MonitoredCall at B.
 * @returns {boolean} True when the train reaches B after A: by stop
 *   sequence (`Order`) when both sides have it, by time otherwise.
 */
function reachesBAfterA(callA, callB) {
	if (typeof callA.Order === "number" && typeof callB.Order === "number") {
		return callB.Order > callA.Order;
	}
	const timeA = callTimeMs(callA);
	const timeB = callTimeMs(callB);
	return timeA !== null && timeB !== null && timeB > timeA;
}

/**
 * @param {object} visit - A SIRI MonitoredStopVisit.
 * @returns {boolean} True when it has the fields the A->B join needs.
 */
function isUsableVisit(visit) {
	const journey = visit && visit.MonitoredVehicleJourney;
	return !!(journey && journey.MonitoredCall);
}

/**
 * @param {object[]} visitsA - MonitoredStopVisit list at the boarding stop.
 * @param {object[]} visitsB - MonitoredStopVisit list at the arrival stop
 *   (both directions mixed, as a stop area returns them).
 * @returns {object[]} The visits of `visitsA` whose train also calls at B
 *   afterwards, unchanged and in their original order.
 */
function filterVisitsServingStop(visitsA, visitsB) {
	const callsAtB = new Map();
	for (const visit of visitsB) {
		if (!isUsableVisit(visit)) continue;
		const journey = visit.MonitoredVehicleJourney;
		for (const key of journeyKeys(journey)) {
			callsAtB.set(key, journey.MonitoredCall);
		}
	}
	return visitsA.filter((visit) => {
		if (!isUsableVisit(visit)) return false;
		const journey = visit.MonitoredVehicleJourney;
		for (const key of journeyKeys(journey)) {
			const callB = callsAtB.get(key);
			if (callB) return reachesBAfterA(journey.MonitoredCall, callB);
		}
		return false;
	});
}

/**
 * @param {object} journey - A SIRI MonitoredVehicleJourney.
 * @returns {string} Mission code (e.g. "SORO"), "" if absent.
 */
function journeyMission(journey) {
	const note = (journey.JourneyNote || [])[0];
	return note && note.value ? note.value : "";
}

const DEFAULT_CALL_GUARD = {
	maxCalls: 40,
	windowMinutes: 10,
	pauseMinutes: 15,
};
const MINUTE_MS = 60000;

/**
 * @param {*} value
 * @param {number} min
 * @param {number} fallback
 * @returns {number} `value` as an integer >= min, or `fallback`.
 */
function intAtLeast(value, min, fallback) {
	const n = Math.floor(Number(value));
	return Number.isFinite(n) && n >= min ? n : fallback;
}

/**
 * @param {object} [settings] - Config page's `callGuard` (may be missing
 *   in configs saved before the guard existed).
 * @returns {{maxCalls: number, windowMinutes: number, pauseMinutes: number}}
 *   Sanitized settings. A positive maxCalls below 2 becomes 2: an A->B
 *   refresh costs 2 calls at once and would otherwise never pass.
 */
function normalizeCallGuard(settings) {
	const s = settings || {};
	let maxCalls = intAtLeast(s.maxCalls, 0, DEFAULT_CALL_GUARD.maxCalls);
	if (maxCalls === 1) maxCalls = 2;
	return {
		maxCalls: maxCalls,
		windowMinutes: intAtLeast(
			s.windowMinutes,
			1,
			DEFAULT_CALL_GUARD.windowMinutes
		),
		pauseMinutes: intAtLeast(
			s.pauseMinutes,
			1,
			DEFAULT_CALL_GUARD.pauseMinutes
		),
	};
}

/**
 * Decides whether a refresh may spend `count` PRIM calls now.
 * @param {{calls: number[], pausedUntil: number}|null} state - Persisted
 *   guard state (null on first use).
 * @param {object} [settings] - Raw `callGuard` settings.
 * @param {number} now - Epoch ms.
 * @param {number} count - Calls this refresh needs (1, or 2 for A->B).
 * @returns {{allowed: boolean, minutesLeft: number,
 *   state: {calls: number[], pausedUntil: number}}} `state` is the new
 *   state to persist; `minutesLeft` (rounded up) is only meaningful when
 *   refused.
 */
function decideCallGuard(state, settings, now, count) {
	const s = normalizeCallGuard(settings);
	if (s.maxCalls === 0) {
		return {
			allowed: true,
			minutesLeft: 0,
			state: { calls: [], pausedUntil: 0 },
		};
	}
	let pausedUntil = (state && state.pausedUntil) || 0;
	// A pause can't legitimately end later than pauseMinutes from now --
	// if it does, the phone clock moved backwards: drop it rather than
	// pausing for hours.
	if (pausedUntil - now > s.pauseMinutes * MINUTE_MS) pausedUntil = 0;
	if (pausedUntil > now) {
		return {
			allowed: false,
			minutesLeft: Math.ceil((pausedUntil - now) / MINUTE_MS),
			state: { calls: [], pausedUntil: pausedUntil },
		};
	}
	const windowStart = now - s.windowMinutes * MINUTE_MS;
	const calls = ((state && state.calls) || []).filter((t) => t > windowStart);
	if (calls.length + count > s.maxCalls) {
		return {
			allowed: false,
			minutesLeft: s.pauseMinutes,
			state: { calls: [], pausedUntil: now + s.pauseMinutes * MINUTE_MS },
		};
	}
	for (let i = 0; i < count; i++) calls.push(now);
	return {
		allowed: true,
		minutesLeft: 0,
		state: { calls: calls, pausedUntil: 0 },
	};
}

/**
 * @param {object} [before] - Previously saved raw `callGuard` settings.
 * @param {object} [after] - Newly saved raw `callGuard` settings.
 * @returns {boolean} True when the effective (normalized) settings differ
 *   -- the caller then resets the persisted guard state, so a pause
 *   started under the old settings doesn't outlive them.
 */
function callGuardSettingsChanged(before, after) {
	const a = normalizeCallGuard(before);
	const b = normalizeCallGuard(after);
	return (
		a.maxCalls !== b.maxCalls ||
		a.windowMinutes !== b.windowMinutes ||
		a.pauseMinutes !== b.pauseMinutes
	);
}

// Last good times older than this aren't worth showing as a fallback.
const STALE_MAX_AGE_MINUTES = 30;

/**
 * Builds the fallback shown when a refresh fails (network, quota, call-guard
 * pause): the trip's last good departure fields plus how old they are.
 * @param {{at: number, extra: object}|null|undefined} saved - Last good
 *   reply for the trip, as stored by pkjs.
 * @param {number} now - Epoch ms.
 * @returns {object|null} `extra` plus `staleAge` (whole minutes), or null
 *   when nothing usable was saved (none, or older than the max age).
 */
function staleExtra(saved, now) {
	if (!saved || typeof saved.at !== "number" || !saved.extra) return null;
	const ageMinutes = Math.floor((now - saved.at) / MINUTE_MS);
	// A negative age means the phone clock moved backwards: don't trust it.
	if (ageMinutes < 0 || ageMinutes > STALE_MAX_AGE_MINUTES) return null;
	return Object.assign({}, saved.extra, { staleAge: ageMinutes });
}

module.exports = {
	staleExtra: staleExtra,
	filterVisitsServingStop: filterVisitsServingStop,
	journeyMission: journeyMission,
	DEFAULT_CALL_GUARD: DEFAULT_CALL_GUARD,
	normalizeCallGuard: normalizeCallGuard,
	decideCallGuard: decideCallGuard,
	callGuardSettingsChanged: callGuardSettingsChanged,
};
