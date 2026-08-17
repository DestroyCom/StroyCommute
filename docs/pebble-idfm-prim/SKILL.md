---
name: pebble-idfm-transit
description: >
  Use for the Pebble Alloy project displaying next metro/tram/bus arrivals
  via the Île-de-France Mobilités PRIM API. Triggers on any mention of
  "IDFM", "PRIM", "StopMonitoring", "SIRI", or code in src/pkjs handling
  transit fetches.
---

# Pebble x IDFM (PRIM) — next departures

## Mandatory architecture

- **pkjs (phone)** : the only place that fetches the PRIM API. Handles SIRI
  Lite parsing (verbose, nested) and flattens it into a plain object before
  sending it to the watch.
- **embeddedjs (watch)** : does NO fetching, NO SIRI parsing. Only receives
  already-flattened data via AppMessage and displays it.

Never suggest doing the HTTP fetch or JSON parsing on the embeddedjs side:
the watch environment isn't built for that (no real direct network
capabilities anyway — all HTTP goes through pkjs).

## PRIM API — key points

- Auth: PRIM API key passed as a header (`apiKey`), obtained on
  prim.iledefrance-mobilites.fr after registration. **Never commit the
  key** — route it through `pkjs` + user config (see Config section).
- Response format: SIRI Lite (JSON), structure like
  `Siri.ServiceDelivery.StopMonitoringDelivery[0].MonitoredStopVisit[]`.
  Each visit contains `MonitoredVehicleJourney` with the line, destination,
  and `MonitoredCall.ExpectedArrivalTime` (ISO 8601).
- Two possible endpoints:
  - Single-stop query (one specific stop) — **this is the one we use**,
    the global query (`LineRef=ALL`) is far too large for a watch use case.
  - Stop ref format: `STIF:StopPoint:Q:<id>:` for a specific platform
    (gives a single direction), or `STIF:StopArea:SP:<id>:` for a stop
    area (all platforms/directions).
- Quota: limited per day depending on the PRIM account. **Never fetch more
  often than every 30-60s from pkjs**, and only when the watch app is
  actually open/visible (no perpetual background polling).

## Tracked stops configuration

The user must be able to configure which stops/lines they follow (likely
via the standard Pebble config page, opened from the mobile app —
`Pebble.openURL` on the pkjs side + a small separate config html/js page).
Store the chosen stop refs in `localStorage` on the pkjs side (persists
between sessions on the phone).

## Watch <-> phone AppMessage format

Keep the payload minimal (watch memory constraint):

```
{
  line: "4",           // line number/name, short
  destination: "...",  // truncated if needed (narrow screen)
  minutes: 3            // integer, minutes until arrival, not a raw timestamp
}
```

Convert `ExpectedArrivalTime` (ISO 8601) to minutes remaining on the pkjs
side before sending — never do this date calculation on the embeddedjs side.

## Error handling (common with this API)

- Network timeout on the phone side → send an explicit error message to
  the watch rather than leaving a blank or stale screen with no indication.
- A stop with no real-time data available (partial network coverage, per
  PRIM docs) → provide a "no real-time data for this stop" state distinct
  from "network error".
- Quota exceeded (HTTP 429 or equivalent) → back off, don't re-fetch in a
  loop.

## Before generating code

`docs/idfm-api-reference.md` contains a real SIRI StopMonitoring payload
example, the exact field mapping to the flattened AppMessage, and known
gotchas (UTC, quotas, stops without real-time data). Read it before writing
any parsing code — don't guess the JSON structure.
