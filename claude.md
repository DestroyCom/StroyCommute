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
- `src/embeddedjs/` : watch code — display only, no fetch/parsing
- `src/pkjs/` : phone code — PRIM API fetch, SIRI Lite parsing, AppMessage
- No npm dependencies on the embeddedjs side (constrained embedded environment)

## Commands

```bash
pebble build                       # compile
pebble install --emulator basalt   # emulator, Pebble Time / Time 2
pebble install --cloudpebble       # physical watch (requires pebble login)
pebble logs                        # live logs, embeddedjs + pkjs
```

## Project rules

- No hardcoded API keys — go through the Pebble config page (opened via
  `Pebble.openURL` from pkjs), never commit secrets.
- Refresh data at most every 30-60s from pkjs, never poll in the background
  when the watch app isn't in the foreground (quota + battery).
- All date/time conversion (UTC → minutes remaining) happens in pkjs, never
  in embeddedjs.
- Minimal, flattened AppMessage payload: `{line, destination, minutes,
atStop, cancelled}` — no nested JSON sent to the watch.
- Explicitly handle 3 distinct states on the watch side: data OK, network
  error, stop with no real-time data available (this is not an error).

## Code style

- TypeScript/JavaScript, pnpm if dependencies are needed on the pkjs side
- Direct code, no over-explaining, but don't sacrifice readability for
  brevity either
- Code & Comments in English, but speaks with the user with his preferred language like French
