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

**Corrected again 2026-08-18** after real-hardware testing (see
`.superpowers/sdd/2026-08-17-stroycommute-scaffold/progress.md`'s Task 7
section for the full investigation) — the 2026-08-17 version of this rule
below (embeddedjs fetches, pkjs is a transparent relay) turned out to hit
a fixed, effectively unconfigurable ~8KB memory ceiling on the pebble/
emery Alloy host once a real PRIM URL and a real API key are combined in
one `fetch()`. Confirmed on real hardware, not an emulator artifact. The
architecture is reversed again, back to pkjs owning the fetch — but this
time confirmed by hitting a real, reproducible constraint, not guessed:

- **pkjs (phone)** : the one that fetches the PRIM API, using native
  `XMLHttpRequest` (confirmed available directly in pkjs — it's exactly
  what `@moddable/pebbleproxy`'s own `proxy.js` uses for its phone-side
  leg, no proxy needed for pkjs's own outgoing requests). Also does the
  SIRI Lite parsing and the UTC→minutes conversion, since it now holds
  the raw response and has full `Intl`/`Date` support. Triggered by
  `refreshStop` AppMessage requests from the watch (one per tracked
  stop), replies with a `departureUpdate` item. Also still owns
  `@moddable/pebbleproxy` wiring (kept for potential future
  embeddedjs-side networking, unused by this feature currently), the
  config page, and Pebble Timeline pin pushes.
- **embeddedjs (watch)** : does NOT fetch or parse PRIM data. Owns the
  30-60s refresh timer (it's the only side that reliably knows the app
  is foregrounded — do not move the timer to pkjs, which runs whenever
  the phone has Bluetooth connectivity regardless of whether this
  watchapp is open) — the timer sends `refreshStop` requests and stores
  incoming `departureUpdate` replies in a `departures` Map for the UI.

The API key never reaches the watch under this architecture — it's read
by pkjs from its own `localStorage` at fetch time. See
`docs/superpowers/specs/2026-08-17-stroycommute-scaffold-design.md` for
the config protocol (still accurate) — the departures request/response
protocol is documented in the plan's Task 7/8
(`docs/superpowers/plans/2026-08-17-stroycommute-scaffold.md`) until the
design spec doc is updated to match.

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
  often than every 30-60s**, and only while the watchapp is actually
  open/visible on the watch — the timer that gates this lives in
  embeddedjs (see Mandatory architecture above) even though the fetch
  itself runs in pkjs, specifically so a closed watchapp doesn't keep
  polling PRIM in the background.

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

AppMessage now carries traffic in both directions:
- **phone→watch (config)**: API key, tracked stops/lines, alert schedule
  — sent once on config save and again on every pkjs `ready` (from
  persisted `localStorage`). See the spec above for the full
  `configMeta`/`configStop`/`configLine` item shapes.
- **watch→phone (`refreshStop`)**: one item per tracked stop, sent by
  embeddedjs's timer — `{itemType: "refreshStop", stopRef, lineRef,
  lineName}`.
- **phone→watch (`departureUpdate`)**: pkjs's reply to each `refreshStop`
  — `{itemType: "departureUpdate", stopRef, state, lineName, destination,
  minutes, atStop, cancelled, quotaRemaining}`. `quotaRemaining` is a local
  count of requests this app has made today against the documented daily
  quota (not a true server-side count -- PRIM exposes no such endpoint),
  attached to every reply regardless of `state` and shown on the watch's
  settings screen.
- **watch→phone (`alertForTimeline`)**: used once traffic alerts are
  implemented for real (currently dormant, `fetchLineAlerts()` is a stub
  in embeddedjs).

A watch-side settings screen (always the last item in the up/down cycle,
appended by `buildItemList()` once config has loaded) shows the tracked
quota. It does NOT open the phone-side config webview from the watch — an
attempt at that (`openSettings` AppMessage -> pkjs `Pebble.openURL`) never
worked on real hardware (webview never opened, root cause unresolved) and
was dropped 2026-08-20. Settings stay reachable only via the phone app's
own settings gear (`showConfiguration` listener in src/pkjs/index.js).

The API key never travels watch-bound — pkjs reads it from its own
`localStorage` at fetch time, no `apiKey` AppMessage item is ever sent to
the watch.

Convert `ExpectedArrivalTime` (ISO 8601) to minutes remaining in pkjs,
right after fetching — that's where the raw SIRI response now lands, and
pkjs has full `Intl`/`Date` support (embeddedjs doesn't).

## Error handling (common with this API)

- Network timeout on pkjs's `XMLHttpRequest` → sent to the watch as
  `state: "network"` in the `departureUpdate` item, shown as an explicit
  error state rather than a blank or stale screen with no indication.
- A stop with no real-time data available (partial network coverage, per
  PRIM docs) → `state: "noRealtimeData"`, distinct from `"network"`.
- Quota exceeded (HTTP 429, checked via `xhr.status` in pkjs) →
  `state: "quotaExceeded"`; the watch's 45s timer already rate-limits
  requests, don't add a separate pkjs-side backoff on top without a
  reason to.

## Before generating code

`docs/idfm-api-reference.md` contains a real SIRI StopMonitoring payload
example, the exact field mapping to the flattened AppMessage, and known
gotchas (UTC, quotas, stops without real-time data). Read it before writing
any parsing code — don't guess the JSON structure.
