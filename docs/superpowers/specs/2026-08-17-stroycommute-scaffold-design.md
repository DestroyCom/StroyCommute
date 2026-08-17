# StroyCommute — scaffold design

Date: 2026-08-17
Status: approved by user, ready for implementation planning

## Purpose

Scaffold a Pebble Alloy watchapp, **StroyCommute**, displaying real-time
IDFM (Île-de-France Mobilités) metro/tram departures for multiple tracked
stops, with a stubbed traffic-alerts subsystem (per-line disruptions +
Pebble Timeline push) to be completed in a later pass once the PRIM
`general-message` endpoint has been verified against real payloads.

Two independent subsystems are involved:

- **(A) Next departures by stop** — fully implemented this pass. Covered
  by existing project docs (`docs/idfm-api-reference.md`,
  `docs/pebble-idfm-prim/SKILL.md`).
- **(B) Traffic alerts by line + timeline push** — scaffolded but stubbed
  this pass. The PRIM `general-message` endpoint JSON shape is not
  documented anywhere in this repo; guessing it would violate the
  project's "never guess the JSON structure" rule. The fetch/parsing
  logic is left as an explicit, documented TODO.

## Project structure

Verified against the official Alloy guide
(`https://developer.repebble.com/guides/alloy/`), which documents a
single `main.js` / `index.js` per environment — no multi-file module
support is documented for Alloy (the "Modular App Architecture" best
practice applies to the classic C SDK only, not Alloy/JS). Structure
kept flat, organized into commented sections within each file:

```
stroycommute/
  src/
    embeddedjs/
      main.js          # nav, list/detail rendering, AppMessage receive
                        # sections: State, List screen, Detail screen,
                        # AppMessage handlers
    pkjs/
      index.js          # entry point, orchestration
                        # sections: Config load, PRIM stop-monitoring
                        # fetch (real), PRIM general-message fetch (stub),
                        # AppMessage send sequencing, alert schedule
                        # filter (real), timeline push (real mechanism,
                        # unused until alerts are real)
    c/mdbl.c             # untouched
  resources/
  config/
    index.html            # config page, self-contained HTML/JS/CSS,
                          # opened via data: URI + Pebble.openURL
  package.json             # real uuid (uuidgen), targetPlatforms: [basalt],
                           # messageKeys per the AppMessage protocol below
docs/
  idfm-api-reference.md            # existing, extended with a
                                    # "Traffic alerts — TODO" section
  pebble-alloy/SKILL.md            # existing, unchanged
  pebble-idfm-prim/SKILL.md        # existing, unchanged
claude.md                          # fixed: skill paths now point to
                                    # docs/, not .claude/skills/
```

If a future implementation pass finds that Alloy actually does support
`require()`-based module splitting (confirmed via a working `pebble
build`), the single files can be split then — not assumed now.

## Data model & config page

`config/index.html`: self-contained HTML/JS/CSS, base64/data URI, opened
via `Pebble.openURL()`. On `webviewclosed`, pkjs receives the response
and persists it to `localStorage`.

```js
{
  apiKey: "",                    // PRIM API key, never committed
  trackedStops: [                 // multiple stops
    { id, stopName, lineRef, lineName, stopRef }
  ],
  trackedLines: [                 // lines followed for traffic alerts
    { lineRef, lineName }
  ],
  alertSchedule: {                 // when alerts are allowed to reach the user
    days: [1,2,3,4,5],            // 0=Sun..6=Sat
    startTime: "07:00",
    endTime: "19:30"
  },
  timelineEnabled: false           // push IDFM info (e.g. incident end) to timeline
}
```

Soft limit of **8 combined items** (stops + alert lines), enforced in the
config page UI — not baked into `package.json`, so it can change without
touching `messageKeys`.

## AppMessage protocol

One flat AppMessage per item (stop or alert), sequenced explicitly via
`Pebble.sendAppMessage()`'s success callback — **not** fire-and-forget in
a loop. Per the official communication guide, AppMessage has no automatic
outbox queue; sending the next message must wait for the previous one's
ACK callback.

```js
// itemType: "stop"
{
  itemIndex: 0,
  itemCount: 5,
  itemType: "stop",
  line: "4",
  destination: "Porte de Clignancourt",
  minutes: 3,          // -1 = at stop, -2 = no real-time data
  atStop: false,
  cancelled: false
}

// itemType: "alert" — always empty/default this pass (generalMessage.js stub)
{
  itemIndex: 3,
  itemCount: 5,
  itemType: "alert",
  line: "4",
  alertText: "",
  alertSeverity: "",     // "info" | "warning" | "blocking"
  alertEndTime: 0          // unix timestamp, 0 = unknown
}

// itemType: "error"
{
  itemIndex: 0,
  itemCount: 1,
  itemType: "error",
  errorCode: "network"    // "network" | "noRealtimeData" | "quotaExceeded"
}
```

`messageKeys` in `package.json` declares the union of keys once (no
per-slot duplication). embeddedjs accumulates items into an array as they
arrive, until `itemIndex === itemCount - 1`, then (re)builds the list/
carousel model.

## Watch UI — navigation & screens

- **List screen** (standard Alloy menu) on launch: one row per item
  (line badge + destination/alert name + minutes or severity). Click
  opens that item's full-screen detail.
- **Detail screen** (one per stop or alert): large display of the
  relevant fields. **Up/Down** buttons move directly to the previous/next
  item's detail (carousel), without returning to the list. **Back**
  returns to the list.
- Explicit states per detail screen: data OK, network error, no
  real-time data available (not an error) — plus, for alert screens
  only, a static "alerts coming soon" state while (B) is stubbed.

## Traffic alerts & timeline — stub scope

- `generalMessage.js` (pkjs): `fetchLineAlerts(lineRefs)` stub, returns
  `[]` and logs `TODO: implement PRIM general-message parsing — see
  docs/idfm-api-reference.md ("Traffic alerts — TODO" section)`. No real
  network call.
- `timeline.js` (pkjs): **real implementation**, not a stub — confirmed
  against `https://developer.repebble.com/guides/pebble-timeline/timeline-local-pins/`:
  - `Pebble.insertTimelinePin({id, time, layout, ...})` to push/update an
    alert pin; `Pebble.deleteTimelinePin(id)` to remove one.
  - Local pins require no timeline token, no API key, no appstore
    listing — the whole mechanism works standalone from pkjs.
  - `timelineEnabled` toggle is read from config and gates these calls;
    since `generalMessage.js` returns no alerts yet, no pins are pushed
    in practice this pass, but the plumbing is real and testable once
    (B) is implemented.
- `alertSchedule.js` (pkjs): **real implementation** — filters by
  day-of-week and time-of-day before any alert would be processed
  (dead code path this pass, but exercised by its own tests).

`docs/idfm-api-reference.md` gets a new "Traffic alerts — TODO" section
documenting that the `general-message` endpoint's JSON shape must be
verified against a real payload before `generalMessage.js` is
implemented for real.

## Error handling

Three states on stop items (per existing project rule) plus one new
item-level state:

- `network` — PRIM fetch timeout/failure.
- `noRealtimeData` — stop has no real-time data (valid, not an error).
- `quotaExceeded` — HTTP 429 or equivalent; pkjs backs off, does not
  retry in a loop.

All surfaced to the watch as an `itemType: "error"` item rather than a
blank/stale screen.

## Testing

No unit test framework on the embeddedjs side (constrained environment).
Verification there is `pebble build` + `pebble install --emulator
basalt` + `pebble logs`, checking AppMessage receipt, list/carousel nav,
and all detail-screen states.

On the pkjs side, pure functions (`alertSchedule.js`'s day/time filter,
SIRI→flat-item mapping in `stopMonitoring.js`) get targeted tests using
Node's built-in `node --test` (no added npm dependency).

## Out of scope this pass

- Real `general-message` fetch/parsing (needs a verified payload first).
- Any UI polish beyond functional list/carousel/detail screens.
- Multi-city / non-IDFM support.
