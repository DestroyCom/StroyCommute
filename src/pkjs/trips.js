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

module.exports = {
	filterVisitsServingStop: filterVisitsServingStop,
	journeyMission: journeyMission,
};
