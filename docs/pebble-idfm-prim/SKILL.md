---
name: pebble-idfm-prim
description: >
  Use for the Pebble Alloy project displaying next metro/tram/bus arrivals
  via the Île-de-France Mobilités PRIM API. Triggers on any mention of
  "IDFM", "PRIM", "StopMonitoring", "SIRI", or code in src/pkjs handling
  transit fetches.
---

# Pebble x IDFM (PRIM) — next departures

## Mandatory architecture

**Corrected 2026-08-17** after verifying against official Alloy docs and
the real `hellofetch` example — the original version of this rule
("pkjs is the only place that fetches") was wrong for Alloy and has been
reversed:

- **embeddedjs (watch)** : the only place that fetches the PRIM API,
  using `fetch()`. Also does the SIRI Lite parsing and the UTC→minutes
  conversion, since it already holds the raw response.
- **pkjs (phone)** : does NOT fetch or parse PRIM data. It wires up
  `@moddable/pebbleproxy` (`readyReceived`/`appMessageReceived`) as a
  transparent network relay — `fetch()` calls made in embeddedjs are
  proxied over Bluetooth through the phone automatically, with no
  request-specific phone-side code needed. pkjs also owns the config
  page (API key, tracked stops/lines) and Pebble Timeline pin pushes.

Never suggest doing the HTTP fetch or JSON parsing on the pkjs side for
departure/alert data — that's the reversed mistake now. See
`docs/superpowers/specs/2026-08-17-stroycommute-scaffold-design.md` for
the full verified/unverified API table and data flow.

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
  often than every 30-60s from embeddedjs**, and only while the watchapp
  is actually open/visible (Alloy apps aren't running in the background
  anyway).

## Tracked stops configuration

The user must be able to configure which stops/lines they follow via the
standard Pebble config page, opened from the mobile app —
`Pebble.openURL` on the pkjs side + a small separate config html/js page.
Store the chosen stop refs in `localStorage` on the pkjs side (persists
between sessions on the phone), then forward them to the watch via
AppMessage on `ready`/config change — see the "AppMessage protocol"
section of
`docs/superpowers/specs/2026-08-17-stroycommute-scaffold-design.md` for
the exact item shapes.

## Watch <-> phone AppMessage format

AppMessage now carries **config** phone→watch (API key, tracked
stops/lines, alert schedule), not parsed departure data — the watch
fetches and parses PRIM data itself. See the spec above for the full
`configMeta`/`configStop`/`configLine` item shapes and the
`alertForTimeline` watch→phone message used once traffic alerts are
implemented for real.

Convert `ExpectedArrivalTime` (ISO 8601) to minutes remaining in
embeddedjs, right after fetching — that's where the raw SIRI response
lands.

## Error handling (common with this API)

- Network timeout on the watch's `fetch()` → show an explicit error
  state rather than leaving a blank or stale screen with no indication.
- A stop with no real-time data available (partial network coverage, per
  PRIM docs) → provide a "no real-time data for this stop" state distinct
  from "network error".
- Quota exceeded (HTTP 429 or equivalent, checked via `response.status`)
  → back off, don't re-fetch in a loop.

## Before generating code

`docs/idfm-api-reference.md` contains a real SIRI StopMonitoring payload
example, the exact field mapping to the flattened AppMessage, and known
gotchas (UTC, quotas, stops without real-time data). Read it before writing
any parsing code — don't guess the JSON structure.
