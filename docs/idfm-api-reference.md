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

## Quotas (as of 2024, to re-verify at implementation time)

- Tokens generated before March 13, 2024: 100 req/s, 1,000,000 req/day.
- More recent tokens: 5 req/s, 1,000 req/day.
- Plenty for a 30-60s refresh on a handful of tracked stops — no need to
  optimize aggressively, but avoid continuous background polling when the
  watch app isn't open.
