# IDFM (PRIM) API — condensed reference

Source: PRIM functional documentation "Getting started with real-time
APIs" (IDFM). This file only covers what's relevant to the Pebble project —
for anything else, refer to the portal at
https://prim.iledefrance-mobilites.fr.

## Endpoint used

```
GET https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring?MonitoringRef=<ref>
```

Auth: PRIM API key header (obtained after registering on the portal).
Exact header name to confirm at implementation time — varies across doc
versions (`apiKey` is the most common).

Optional `LineRef=<ref>` parameter to filter on a specific line if the stop
serves multiple lines.

## Identifier format

**Line** (`LineRef`) : `STIF:Line::<ID_Line>:`
Example RER B: `STIF:Line::C01743:`

**Stop** — three possible levels, from most to least precise:

- Platform / boarding zone: `STIF:StopPoint:Q:<ArRId>:`
  - A platform has 2 different ArRIds (inbound/outbound) → a query only
    returns one direction of travel.
  - Example Châtelet M4: inbound `STIF:StopPoint:Q:22092:`, outbound
    `STIF:StopPoint:Q:463158:`
- Single-mode stop area: `STIF:StopArea:SP:<ZdAId>:`
  - Example Métro Châtelet area: `STIF:StopArea:SP:42587:`
- Multimodal interchange area: `STIF:StopArea:SP:<ZdCId>:`

**Recommendation**: prefer ZdA/ZdC over platform level for SNCF (RER/
Transilien), which sometimes assigns a fictitious platform-level stop
representing the whole station.

To find exact stop IDs: "Référentiel des arrêts" dataset on the IDFM data
portal (`arrets.xls` file / equivalent dataset).

**Open-data → PRIM id mapping** (what the config page's search returns,
`arrets-lignes` dataset):

- Metro/tram/bus stops are reference stops: `IDFM:<ArRId>` →
  `STIF:StopPoint:Q:<ArRId>:` (one platform = one direction).
- RER/Transilien (SNCF) stops are stop areas:
  `IDFM:monomodalStopPlace:<ZdAId>` → `STIF:StopArea:SP:<ZdAId>:`. A stop
  area returns **both directions mixed**, not necessarily in time order —
  pkjs sorts the visits and, for an A→B trip, keeps only trains also
  calling at the arrival stop (see "SNCF journey fields used for A→B
  trips" below).
- SNCF journeys don't always fill `MonitoredCall.DestinationDisplay` (can be
  missing or empty): fall back to `MonitoredVehicleJourney.DestinationName`
  then `DirectionName`.

## Response structure (real example)

Query: `stop-monitoring?MonitoringRef=STIF:StopPoint:Q:463158:`

```json
{
  "Siri": {
    "ServiceDelivery": {
      "ResponseTimestamp": "2022-05-24T12:13:37Z",
      "StopMonitoringDelivery": [
        {
          "ResponseTimestamp": "2022-05-24T12:13:37Z",
          "Status": "true",
          "MonitoredStopVisit": [
            {
              "RecordedAtTime": "2022-05-24T12:13:14.876Z",
              "MonitoringRef": { "value": "STIF:StopPoint:Q:463158:" },
              "MonitoredVehicleJourney": {
                "LineRef": { "value": "STIF:Line::C01374:" },
                "OperatorRef": {
                  "value": "RATP-SIV:Operator::RATP.OCTAVE.4.4:"
                },
                "DirectionName": [{ "value": "PORTE DE CLIGNANCOURT" }],
                "DestinationRef": { "value": "STIF:StopPoint:Q:22141:" },
                "DestinationName": [{ "value": "Porte de Clignancourt" }],
                "MonitoredCall": {
                  "StopPointName": [{ "value": "Châtelet" }],
                  "VehicleAtStop": false,
                  "DestinationDisplay": [{ "value": "Porte de Clignancourt" }],
                  "ExpectedArrivalTime": "2022-05-24T12:17:14.876Z",
                  "ExpectedDepartureTime": "2022-05-24T12:17:14.876Z",
                  "DepartureStatus": "onTime"
                }
              }
            }
          ]
        }
      ]
    }
  }
}
```

## Fields relevant to this project (mapping to the flattened AppMessage)

| Source field (JSON path)                                                       | → AppMessage field                                               |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `MonitoredVehicleJourney.LineRef.value` (needs parsing, e.g. extract "C01374") | `line` (ideally mapped to a readable short name, not the raw ID) |
| `MonitoredVehicleJourney.MonitoredCall.DestinationDisplay[0].value`            | `destination` (truncate if too long for the screen)              |
| `MonitoredVehicleJourney.MonitoredCall.ExpectedArrivalTime`                    | `minutes` (compute `(expectedArrival - now) / 60000`, rounded)   |
| `MonitoredVehicleJourney.MonitoredCall.VehicleAtStop`                          | useful to show "at platform" instead of a number                 |
| `MonitoredVehicleJourney.MonitoredCall.DepartureStatus`                        | `"cancelled"` = trip cancelled, filter out or display distinctly |

## SNCF journey fields used for A→B trips (verified 2026-10-15)

Present on RER/Transilien visits (`stop-monitoring` on a stop area), under
`MonitoredVehicleJourney`:

| Field                                             | Example                                                   | Use                       |
| ------------------------------------------------- | --------------------------------------------------------- | ------------------------- |
| `JourneyNote[0].value`                            | `"SCAL"`                                                  | mission code              |
| `FramedVehicleJourneyRef.DatedVehicleJourneyRef`  | `"SNCF_MAGENTA_PRD:VehicleJourney::<uuid>:LOC"` (string)  | same train across stops   |
| `TrainNumbers.TrainNumberRef[0].value`            | `"147491"`                                                | fallback train identity   |
| `MonitoredCall.Order`                             | `14` (number)                                             | stop sequence in the trip |

A train calling at A then B has the same `DatedVehicleJourneyRef` in both
stops' responses and a higher `Order` at B; a train going the other way
has a lower `Order` at B. Real captures (RER B, `LineRef=STIF:Line::C01743:`):
`test/fixtures/sm-a.json` (Denfert-Rochereau, `STIF:StopArea:SP:473890:`)
and `test/fixtures/sm-b.json` (Bourg-la-Reine, `STIF:StopArea:SP:43097:`)
— southbound trains (Robinson, Saint-Rémy, Massy) go from A to B,
northbound ones (Châtelet Les Halles) from B to A. Same SIRI producer
(`SNCF_MAGENTA_PRD`) as RER C.

## Known gotchas

- **All timestamps are UTC/GMT**, never local time. The conversion to
  Paris time (and the "minutes remaining" calculation relative to
  `Date.now()`) must happen on the pkjs side (Node has full `Intl`/`Date`
  support, unlike embeddedjs).
- **RATP doesn't provide a reliable journey identifier** — not an issue
  for a simple "next departure at a stop" (StopMonitoring), but worth
  knowing if a full trip reconstruction is ever attempted.
- Accuracy degrades with horizon: beyond ~20 min for buses and ~30 min for
  rail modes, times are less reliable.
- Not all lines/stops have real-time data available yet (progressive
  rollout) — a stop can legitimately return an empty `MonitoredStopVisit`
  array, that's not an error.
- If the stop is multi-line (area level), filter client-side on `LineRef`
  if only one line is wanted, or pass `LineRef` directly as a query
  parameter.

## Traffic alerts — `general-message` (verified 2026-11-13)

```
GET https://prim.iledefrance-mobilites.fr/marketplace/general-message?LineRef=STIF:Line::<ID_Line>:
```

Same `apiKey` header. SIRI Lite GeneralMessage, small (1-5 KB per line).
Real captures: `test/fixtures/gm-rer-b.json` (RER B, 4 messages, one
shared with lines 12/13), `test/fixtures/gm-m4.json` (metro 4, 1 message),
`test/fixtures/gm-empty.json` (no message). Shape:

```json
{"Siri": {"ServiceDelivery": {"GeneralMessageDelivery": [{
  "Status": "true",
  "InfoMessage": [{
    "FormatRef": "STIF-IDF",
    "RecordedAtTime": "2026-10-11T16:01:06.127Z",
    "ItemIdentifier": "RATP-SIV:Item::MSG.IVC.3931571241858955870.1:LOC",
    "InfoMessageIdentifier": {"value": "RATP-SIV:InfoMessage::MSG.IVC.3931571241858955870:LOC"},
    "InfoChannelRef": {"value": "Perturbation"},
    "ValidUntilTime": "2026-12-20T03:30:00.000Z",
    "Content": {
      "LineRef": [{"value": "STIF:Line::C01374:"}],
      "Message": [
        {"MessageType": "SHORT_MESSAGE", "MessageText": {"value": "Jusqu'au 19 décembre inclus, l'arrêt n'est pas desservi à Saint-Michel (travaux de rénovation)", "lang": "fr"}},
        {"MessageType": "TEXT_ONLY", "MessageText": {"value": "...same, longer...", "lang": "fr"}}
      ]
    }
  }]
}]}}}
```

- `InfoMessageIdentifier.value` is stable across calls: the key used to
  detect new and ended messages.
- No start time and no severity: planned works ("Du 30 novembre au...")
  and current disruptions look alike; dates are only in the text.
  `ValidUntilTime` is when the message stops being published.
- Texts are French only, may contain `\n`, emoji and thin spaces (U+2006).
  `SHORT_MESSAGE` is the one to show on the watch, `TEXT_ONLY` the fallback.
- `InfoChannelRef` seen: `Perturbation` only (an `InfoChannelRef=Information`
  query returned no message).

Not used: the Navitia line reports
(`/marketplace/v2/navitia/line_reports/lines/line:IDFM:<id>/line_reports`)
carry status/severity/application periods, but weigh ~1.6 MB per line (no
effect of `disable_geojson`) and, for the RER B, 111 of 112 "active"
disruptions were elevator outages with the same severity.

## Quotas (verified 2026-11-13 from response headers)

Every PRIM response carries the key's quota for that endpoint:
`X-Ratelimit-Limit-Day`, `X-Ratelimit-Remaining-Day` (also
`Ratelimit-Limit`/`Ratelimit-Remaining`/`Ratelimit-Reset`, seconds until the
reset, which happens at 00:00 UTC). Each endpoint has its own quota: with a
recent token, 1,000/day for `stop-monitoring` and 1,000/day for
`general-message`, counted separately.

Older notes (as of 2024):

- Tokens generated before March 13, 2024: 100 req/s, 1,000,000 req/day.
- More recent tokens: 5 req/s, 1,000 req/day.
- Plenty for a 30-60s refresh on a handful of tracked stops — no need to
  optimize aggressively, but avoid continuous background polling when the
  watch app isn't open.
