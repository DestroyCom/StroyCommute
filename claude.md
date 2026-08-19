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
- `src/embeddedjs/` : watch code — Piu UI, refresh timer (foreground-gated),
  and a `departures` Map populated by AppMessage responses from pkjs. Does
  **not** fetch or parse PRIM data itself — see "PRIM fetch architecture"
  below for why.
- `src/pkjs/` : phone code — config page open/persist, PRIM API fetch (via
  native `XMLHttpRequest`, no proxy needed — pkjs is close enough to a
  regular JS/Node environment for this) triggered by watch-sent
  `refreshStop` requests, SIRI Lite parsing, UTC→minutes conversion,
  Pebble Timeline pin push. `@moddable/pebbleproxy` wiring is still present
  (Task 3) but currently unused by the departures feature — kept in case a
  future feature needs embeddedjs-side networking.
- **PRIM fetch architecture** (revised 2026-08-18, see
  `.superpowers/sdd/2026-08-17-stroycommute-scaffold/progress.md`'s Task 7
  section for the full investigation): originally speced with `fetch()`
  running watch-side, proxied through the phone via
  `@moddable/pebbleproxy`. Real-hardware testing found this hits a fixed,
  effectively non-configurable ~8KB chunk-memory ceiling on the pebble/
  emery Alloy host once a real PRIM URL and a real API key are combined —
  confirmed even after fixing two real `@moddable/pebbleproxy` bugs (Task 3)
  and switching to the lower-level streaming `HTTPClient` API (which got
  the gap down to a stable ~16-40 bytes short, but no closer). Moved the
  fetch+parse entirely to pkjs instead: the watch's timer sends a
  lightweight `refreshStop` request per tracked stop, pkjs does the real
  work with its much larger memory budget, and replies with a compact
  `departureUpdate` item — eliminating the watch-side memory ceiling
  entirely rather than fighting it byte by byte.
- No npm dependencies on the embeddedjs side beyond what Alloy provides
  natively (constrained embedded environment)
- `resources/images/icon.png` : the app's menu icon (launcher list on the
  phone/watch). Wired via `package.json`'s `pebble.resources.media`
  (`menuIcon: true`) — Alloy's own resource pipeline (waf's
  `resources/` folder, `bld.path.find_node("resources")`), **not**
  Moddable's separate `manifest.json`/`mc.xsa` resource archive used for
  the embeddedjs runtime (same C-vs-JS-pitfall category as
  `docs/pebble-alloy/SKILL.md`'s build-pipeline notes — two independent
  resource systems in this one project). Max menu icon size is a hard
  25×25px (waf-enforced, `max_menu_icon_dimensions` in the SDK's
  `process_sdk_resources.py`); without a `menuIcon` resource the app falls
  back to the SDK's generic placeholder square.

## Commands

```bash
pebble build                       # compile
pebble install --emulator emery    # emulator, Pebble Time 2 (verify availability at implementation time)
pebble install --cloudpebble       # physical watch (requires pebble login)
pebble logs                        # live logs, embeddedjs + pkjs
```

## Project rules

- No hardcoded API keys — go through the Pebble config page (opened via
  `Pebble.openURL` from pkjs), never commit secrets. The API key never
  leaves the phone: it's persisted in pkjs's `localStorage` and used
  directly by pkjs's own PRIM fetch — it is **not** sent to the watch (the
  watch has no legitimate use for it now that pkjs owns the fetch).
- Refresh data at most every 30-60s, only while the watchapp is in the
  foreground (Alloy apps aren't running otherwise) — the timer stays in
  embeddedjs (it's the only side that reliably knows the app is
  foregrounded) even though the actual fetch now happens in pkjs: the
  timer sends a `refreshStop` request per tracked stop, pkjs replies with
  a `departureUpdate`. Do not move the timer to pkjs — pkjs runs whenever
  the phone has Bluetooth connectivity, independent of whether this
  watchapp is open, so a pkjs-side timer would poll PRIM in the background
  and violate this rule.
- All date/time conversion (UTC → minutes remaining) happens in pkjs,
  since that's where the raw SIRI response now arrives (also matches
  `docs/idfm-api-reference.md`'s original note that this conversion
  belongs in pkjs, since it has full `Intl`/`Date` support unlike
  embeddedjs).
- Minimal, flattened AppMessage payloads — no nested JSON, both directions:
  phone→watch for config (tracked stops/lines, schedule — no API key) and
  now also watch→phone (`refreshStop` requests) and phone→watch
  (`departureUpdate` responses). See
  `docs/superpowers/specs/2026-08-17-stroycommute-scaffold-design.md`
  for the config protocol; the departures protocol is documented in the
  SDD ledger until the design spec is updated to match.
- Explicitly handle these states on the watch side: data OK, network
  error, stop with no real-time data available (not an error), quota
  exceeded (HTTP 429).

## Code style

- TypeScript/JavaScript, pnpm if dependencies are needed on the pkjs side
- Direct code, no over-explaining, but don't sacrifice readability for
  brevity either
- Code & Comments in English, but speaks with the user with his preferred language like French
