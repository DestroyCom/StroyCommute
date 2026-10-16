const test = require("node:test");
const assert = require("node:assert");
const { filterVisitsServingStop, journeyMission } = require("../src/pkjs/trips");

const visitsOf = (json) =>
	json.Siri.ServiceDelivery.StopMonitoringDelivery[0].MonitoredStopVisit || [];

/** Minimal synthetic visit -- only the fields trips.js reads. */
function visit({ ref, number, order, time, mission }) {
	const journey = { MonitoredCall: {} };
	if (ref) journey.FramedVehicleJourneyRef = { DatedVehicleJourneyRef: ref };
	if (number) journey.TrainNumbers = { TrainNumberRef: [{ value: number }] };
	if (order !== undefined) journey.MonitoredCall.Order = order;
	if (time) journey.MonitoredCall.ExpectedDepartureTime = time;
	if (mission) journey.JourneyNote = [{ value: mission }];
	return { MonitoredVehicleJourney: journey };
}

test("real fixtures: every kept train is at B with a higher Order", () => {
	const a = visitsOf(require("./fixtures/sm-a.json"));
	const b = visitsOf(require("./fixtures/sm-b.json"));
	const kept = filterVisitsServingStop(a, b);
	assert.ok(kept.length > 0, "fixture should contain at least one A->B train");
	assert.ok(kept.length < a.length, "fixture should also contain B->A trains");
	for (const va of kept) {
		const refA = va.MonitoredVehicleJourney.FramedVehicleJourneyRef.DatedVehicleJourneyRef;
		const vb = b.find(
			(v) => v.MonitoredVehicleJourney.FramedVehicleJourneyRef.DatedVehicleJourneyRef === refA
		);
		assert.ok(vb);
		assert.ok(vb.MonitoredVehicleJourney.MonitoredCall.Order > va.MonitoredVehicleJourney.MonitoredCall.Order);
	}
});

test("train going B->A (lower Order at B) is excluded", () => {
	const a = [visit({ ref: "T1", order: 10 })];
	const b = [visit({ ref: "T1", order: 4 })];
	assert.deepStrictEqual(filterVisitsServingStop(a, b), []);
});

test("train not calling at B is excluded", () => {
	const a = [visit({ ref: "T1", order: 10 })];
	const b = [visit({ ref: "T2", order: 12 })];
	assert.deepStrictEqual(filterVisitsServingStop(a, b), []);
});

test("falls back to train number when the journey ref is missing on one side", () => {
	const a = [visit({ ref: "T1", number: "147491", order: 10 })];
	const b = [visit({ number: "147491", order: 12 })];
	assert.strictEqual(filterVisitsServingStop(a, b).length, 1);
});

test("falls back to times when Order is missing", () => {
	const a = [visit({ ref: "T1", time: "2026-10-16T08:03:00Z" })];
	const later = [visit({ ref: "T1", time: "2026-10-16T08:20:00Z" })];
	const earlier = [visit({ ref: "T1", time: "2026-10-16T07:50:00Z" })];
	assert.strictEqual(filterVisitsServingStop(a, later).length, 1);
	assert.strictEqual(filterVisitsServingStop(a, earlier).length, 0);
});

test("malformed visits are skipped, not thrown on", () => {
	const a = [{}, { MonitoredVehicleJourney: {} }, visit({ ref: "T1", order: 1 })];
	const b = [
		{ MonitoredVehicleJourney: { FramedVehicleJourneyRef: { DatedVehicleJourneyRef: "T1" } } },
		visit({ ref: "T1", order: 5 }),
	];
	assert.strictEqual(filterVisitsServingStop(a, b).length, 1);
});

test("journeyMission reads JourneyNote, empty string otherwise", () => {
	assert.strictEqual(journeyMission(visit({ mission: "SORO" }).MonitoredVehicleJourney), "SORO");
	assert.strictEqual(journeyMission({}), "");
	assert.strictEqual(journeyMission({ JourneyNote: [] }), "");
});
