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

test("rankDepartures: a train at the platform comes before one whose time has just passed", () => {
	const { rankDepartures } = require("../src/pkjs/trips");
	const now = Date.UTC(2026, 10, 14, 8);
	const visit = (offsetMin, extra) => ({
		MonitoredVehicleJourney: {
			MonitoredCall: Object.assign({ ExpectedDepartureTime: new Date(now + offsetMin * 60000).toISOString() }, extra),
		},
	});
	const ranked = rankDepartures(
		[visit(5), visit(-2), visit(1, { VehicleAtStop: true }), visit(3, { DepartureStatus: "cancelled" }), visit(5.4)],
		now
	);
	assert.deepStrictEqual(
		ranked.map((d) => [d.atStop, d.cancelled, Math.round((d.timeMs - now) / 6000) / 10]),
		[
			[true, false, 1],
			[false, false, -2],
			[false, false, 5],
			[false, false, 5.4],
			[false, true, 3],
		]
	);
});

test("rankDepartures: a train still at the platform over a minute past its time has left", () => {
	const { rankDepartures } = require("../src/pkjs/trips");
	const now = Date.UTC(2026, 10, 14, 8);
	const visit = (offsetMin, extra) => ({
		MonitoredVehicleJourney: {
			MonitoredCall: Object.assign({ ExpectedDepartureTime: new Date(now + offsetMin * 60000).toISOString() }, extra),
		},
	});
	const ranked = rankDepartures(
		[
			visit(-2, { VehicleAtStop: true }), // PRIM lagging: gone
			visit(-0.5, { VehicleAtStop: true }), // just past: still there
			visit(6),
		],
		now
	);
	assert.deepStrictEqual(
		ranked.map((d) => [d.atStop, Math.round((d.timeMs - now) / 6000) / 10]),
		[
			[true, -0.5],
			[false, 6],
		]
	);
	// An at-platform train without any time is kept.
	assert.strictEqual(rankDepartures([visit(0, { ExpectedDepartureTime: undefined, VehicleAtStop: true })], now).length, 1);
});

test("rankDepartures: a train waiting at the platform past its arrival, before its departure, is kept", () => {
	const { rankDepartures } = require("../src/pkjs/trips");
	const now = Date.UTC(2026, 10, 14, 8);
	const at = (offsetMin) => new Date(now + offsetMin * 60000).toISOString();
	const ranked = rankDepartures(
		[
			{
				MonitoredVehicleJourney: {
					MonitoredCall: { VehicleAtStop: true, ExpectedArrivalTime: at(-3), ExpectedDepartureTime: at(2) },
				},
			},
		],
		now
	);
	assert.strictEqual(ranked.length, 1);
	// Shown and sorted by its arrival, expired by its departure.
	assert.strictEqual(ranked[0].timeMs, now - 3 * 60000);
	assert.strictEqual(ranked[0].departMs, now + 2 * 60000);
});

test("rankDepartures: a late train at the platform isn't expired on its timetable", () => {
	const { rankDepartures } = require("../src/pkjs/trips");
	const now = Date.UTC(2026, 10, 14, 8);
	const at = (offsetMin) => new Date(now + offsetMin * 60000).toISOString();
	const call = (extra) => ({ MonitoredVehicleJourney: { MonitoredCall: Object.assign({ VehicleAtStop: true }, extra) } });
	// No realtime departure: the realtime arrival (30 s ago) beats the timetable (5 min ago).
	const late = rankDepartures([call({ ExpectedArrivalTime: at(-0.5), AimedDepartureTime: at(-5) })], now);
	assert.strictEqual(late.length, 1);
	assert.strictEqual(late[0].departMs, now - 30000);
	// Both long past: gone.
	assert.strictEqual(rankDepartures([call({ ExpectedArrivalTime: at(-3), AimedDepartureTime: at(-5) })], now).length, 0);
	// A realtime departure still wins over both.
	assert.strictEqual(rankDepartures([call({ ExpectedArrivalTime: at(-0.5), ExpectedDepartureTime: at(-2) })], now).length, 0);
});
