# Pebble Project — IDFM Next Departures

Pebble watchapp displaying real-time metro/tram arrival times (PRIM API,
Île-de-France Mobilités) on Pebble Time 2.

## Before any task

Read the relevant skill first:

- `docs/pebble-alloy/SKILL.md` — Alloy structure, CLI commands,
  C vs JS pitfall
- `docs/pebble-idfm-prim/SKILL.md` — project-specific
  pkjs/embeddedjs architecture, AppMessage format

And the reference doc:

- `docs/idfm-api-reference.md` — real SIRI payload example, field mapping,
  gotchas (UTC, quotas, stops without real-time data)

Never guess the JSON structure of the PRIM API or a Pebble C API without
checking these files first.

And the Pebble framework docs and reference:

- `https://developer.repebble.com/guides/alloy/`
- `https://developer.repebble.com/guides/best-practices/` - This is very important to read before starting any work on the project, as it contains best practices for developing Pebble apps.

## Stack

- Alloy (Pebble framework based on the Moddable SDK), no custom C
- Target platform: **`emery`** (Pebble Time 2). `gabbro` (Pebble Round 2)
  planned for a later pass. `basalt` does NOT exist as an Alloy target —
  it's a classic-C-SDK-only codename for the original Pebble Time, a
  different device.
- `src/embeddedjs/` : watch code — Piu UI, PRIM API fetch (via `fetch()`,
  proxied over Bluetooth through the phone), SIRI Lite parsing, UTC→minutes
  conversion, refresh timer. Confirmed by the official `hellofetch`
  example: Alloy proxies networking through the phone transparently, but
  the fetch call itself and all parsing happen watch-side.
- `src/pkjs/` : phone code — `@moddable/pebbleproxy` wiring (transparent
  network relay), config page open/persist, Pebble Timeline pin push.
  Does **not** fetch or parse PRIM data itself.
- No npm dependencies on the embeddedjs side beyond what Alloy provides
  natively (constrained embedded environment)

## Commands

```bash
pebble build                       # compile
pebble install --emulator emery    # emulator, Pebble Time 2 (verify availability at implementation time)
pebble install --cloudpebble       # physical watch (requires pebble login)
pebble logs                        # live logs, embeddedjs + pkjs
```

## Project rules

- No hardcoded API keys — go through the Pebble config page (opened via
  `Pebble.openURL` from pkjs), never commit secrets. The API key is sent
  to the watch via AppMessage so embeddedjs can call `fetch()` itself.
- Refresh data at most every 30-60s, only while the watchapp is in the
  foreground (Alloy apps aren't running otherwise) — timer lives in
  embeddedjs since that's where the fetch happens.
- All date/time conversion (UTC → minutes remaining) happens in
  embeddedjs, since that's where the raw SIRI response arrives.
- Minimal, flattened AppMessage payloads — no nested JSON. AppMessage is
  now used phone→watch for config (API key, tracked stops/lines,
  schedule) rather than watch-bound departure data; see
  `docs/superpowers/specs/2026-08-17-stroycommute-scaffold-design.md`
  for the exact protocol.
- Explicitly handle these states on the watch side: data OK, network
  error, stop with no real-time data available (not an error), quota
  exceeded (HTTP 429).

## Code style

- TypeScript/JavaScript, pnpm if dependencies are needed on the pkjs side
- Direct code, no over-explaining, but don't sacrifice readability for
  brevity either
- Code & Comments in English, but speaks with the user with his preferred language like French
