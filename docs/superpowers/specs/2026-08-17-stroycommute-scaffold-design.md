# StroyCommute — scaffold design

Date: 2026-08-17 (revised same day after Alloy API research)
Status: approved by user, ready for implementation planning

## Revision note

The first version of this spec assumed a classic PebbleKit-JS split
(pkjs fetches/parses, embeddedjs only displays) and `basalt` as the
target platform, following what `docs/pebble-idfm-prim/SKILL.md` and
`claude.md` stated as "mandatory". Dedicated research against the
official Alloy docs (`developer.repebble.com/guides/alloy/*`) and real
example apps (`github.com/Moddable-OpenSource/pebble-examples`)
contradicted both:

- **Alloy only targets `emery` (Pebble Time 2) and `gabbro` (Pebble
  Round 2)** — never `basalt`. `basalt` is a classic-C-SDK-only
  platform codename for the original Pebble Time (144×168), a
  different device from Emery. Confirmed by the Alloy overview page and
  every real example's `package.json`.
- **Networking is proxied through the watch, not the phone.** The
  official `hellofetch` example calls `fetch()` directly in
  `src/embeddedjs/main.js`; `src/pkjs/index.js` only wires up
  `@moddable/pebbleproxy` (`readyReceived`, `appMessageReceived`) as a
  transparent network relay. No example or doc page shows pkjs making
  an HTTP request directly.

User confirmed both corollaries explicitly: target `emery` now,
`gabbro` in a later pass; and the full consequence of watch-side
fetch — SIRI parsing, UTC→minutes conversion, and the 30-60s refresh
timer all move to `embeddedjs`. **`claude.md` and
`docs/pebble-idfm-prim/SKILL.md` are updated in this same pass to drop
the now-incorrect "pkjs is the only place that fetches" rule.**

This revision keeps sections (A)/(B) subsystem split and the stub scope
for (B) from the original design; it rewrites project structure, data
flow, AppMessage protocol, watch UI, and testing to match the verified
architecture.

## Purpose

Scaffold a Pebble Alloy watchapp, **StroyCommute**, displaying real-time
IDFM (Île-de-France Mobilités) metro/tram departures for multiple tracked
stops, with a stubbed traffic-alerts subsystem (per-line disruptions +
Pebble Timeline push) to be completed in a later pass once the PRIM
`general-message` endpoint has been verified against a real payload.

- **(A) Next departures by stop** — fully implemented this pass.
- **(B) Traffic alerts by line + timeline push** — scaffolded but
  stubbed. The PRIM `general-message` JSON shape is undocumented in
  this repo; guessing it would violate the project's "never guess the
  JSON structure" rule. Fetch/parsing is an explicit, documented TODO.

## Verified vs. unverified APIs

Everything below marked **(verified)** is quoted from official docs or
real example source in `pebble-examples`. Everything marked
**(unverified)** was not confirmed by any source found — the
implementation plan must treat these as spike/verification steps, not
assumed-working code.

| API | Status |
| --- | --- |
| `pebble new-project --alloy NAME` CLI flag | verified on 2 Alloy-specific doc pages, absent from the general `pebble-tool` flag reference — inconsistency noted, treat as correct but re-verify with `--help` before first use |
| Piu `Application`, `Container`, `Column`, `Row`, `Label`, `Text`, `Skin`, `Style` constructors | verified, quoted from Moddable's `piu.md` reference |
| `Button` sensor (`import Button from "pebble/button"`, `{types, onPush(down, type)}`) | verified, quoted from real `hellobutton` example |
| `Message` class (`import Message from "pebble/message"`, `{keys, onReadable(), onWritable(), onSuspend()}`, `this.read()` returns Map-like iterable, `this.write(map)`) | verified, quoted from real `hellomessage` example |
| pkjs `Pebble.addEventListener('appmessage', ...)`, `Pebble.sendAppMessage(dict)` | verified, quoted from real `hellomessage` example |
| `Pebble.sendAppMessage` ack/nack callback argument shape | unverified beyond an AI-summarized doc page — don't assume a specific shape, only rely on the fact the callbacks fire |
| `fetch()` in embeddedjs via `@moddable/pebbleproxy` | verified, quoted from real `hellofetch` example |
| Custom HTTP headers (e.g. `apiKey`) with embeddedjs `fetch()` | **unverified** — no example anywhere sets a custom header. First implementation task must spike this before building PRIM fetch logic on top of it |
| `messageKeys` shape in `package.json` | inconsistent across real examples: flat string array in most, empty object `{}` in `hellofetch`. Use the flat array form (majority pattern); re-verify if `@moddable/pebbleproxy` requires the empty-object form |
| `enableMultiJS: true` in `package.json` | set in every real example; likely enables multi-file `import`/`require` splitting, but no doc sentence confirms this. **Decision: set it true (matches every real app) but keep single `main.js`/`index.js` this pass anyway** — not relying on the unconfirmed behavior |
| Piu `Scroller` class | verified to exist, but every real usage is touch-driven; **no example combines it with `Button`** on a non-touch device. Decision: don't use it this pass (see Watch UI section) |
| `Pebble.insertTimelinePin(pin, callback)` / `deleteTimelinePin(id, callback)` callback signature | pin object shape verified; callback argument shape unverified |
| pkjs `localStorage` | classic PebbleKit-JS docs assume it; not specifically re-confirmed for Alloy pkjs. Config persistence still uses it as the standard pattern — flag if it misbehaves during implementation |
| `Pebble.openURL()` + `webviewclosed` config page pattern | verified, quoted from official static-config guide; applies to Alloy pkjs since `Pebble.*` is the shared PebbleKit-JS runtime |

## Project structure

```text
stroycommute/
  src/
    embeddedjs/
      main.js          # Piu UI, Button input, fetch+parse PRIM, timer,
                        # Message send/receive. Sections: Config state,
                        # PRIM stop-monitoring fetch+parse (real),
                        # PRIM general-message fetch (stub), List
                        # screen, Detail screen, Button handling,
                        # Message (AppMessage) handlers
    pkjs/
      index.js          # @moddable/pebbleproxy wiring, config page
                        # open/close, localStorage persistence,
                        # timeline pin push (real mechanism, dormant
                        # until (B) is implemented)
    c/mdbl.c             # untouched
  resources/
  config/
    index.html            # config page, self-contained HTML/JS/CSS,
                          # data: URI, opened via Pebble.openURL()
  package.json             # real uuid (uuidgen), projectType: moddable,
                           # sdkVersion, enableMultiJS: true,
                           # targetPlatforms: ["emery"], messageKeys,
                           # dependencies: @moddable/pebbleproxy
docs/
  idfm-api-reference.md            # extended with "Traffic alerts —
                                    # TODO" section
  pebble-alloy/SKILL.md            # unchanged (structure/CLI guidance
                                    # already correct)
  pebble-idfm-prim/SKILL.md        # corrected: fetch/parsing now
                                    # embeddedjs-side
claude.md                          # corrected: fetch/parsing location,
                                    # target platform, skill paths
```

## Data flow

1. **Config → watch**: pkjs reads `localStorage` (populated by the
   config page via `webviewclosed`) and sends it to the watch as a
   sequence of flat `Message` writes on `ready` and after config
   changes: one `configMeta` item (apiKey, schedule, timelineEnabled)
   plus one `configStop`/`configLine` item per tracked stop/line.
2. **Watch fetches directly**: embeddedjs holds the config in memory,
   and on a `setInterval` timer (30-60s, only while the app is in the
   foreground — Alloy apps aren't running otherwise) loops over tracked
   stops, calling `fetch()` against the PRIM `stop-monitoring` endpoint
   for each (proxied transparently through the phone by
   `@moddable/pebbleproxy` — no phone-side code needed per request).
3. **Parsing + display**: embeddedjs parses the SIRI Lite JSON,
   converts `ExpectedArrivalTime` (ISO 8601) to "minutes remaining"
   using the watch's own `Date`, and re-renders the list/detail UI
   in place — no AppMessage round-trip needed for departures.
4. **Alerts (stub)**: same fetch pattern against `general-message`,
   currently a stub returning nothing.
5. **Timeline (dormant until (B) is real)**: when embeddedjs has real
   alert data and `timelineEnabled` is on, it sends an
   `alertForTimeline` `Message` to the phone; pkjs's `appmessage`
   handler (the non-proxy branch, alongside
   `moddableProxy.appMessageReceived`) calls
   `Pebble.insertTimelinePin()`.

## Data model & config page

`config/index.html`: self-contained HTML/JS/CSS, data URI, opened via
`Pebble.openURL()`. On `webviewclosed`, pkjs receives
`decodeURIComponent(e.response)`, `JSON.parse`s it, and persists to
`localStorage`.

```js
{
  apiKey: "",
  trackedStops: [
    { id, stopName, lineRef, lineName, stopRef }
  ],
  trackedLines: [
    { lineRef, lineName }
  ],
  alertSchedule: {
    days: [1,2,3,4,5],       // 0=Sun..6=Sat
    startTime: "07:00",
    endTime: "19:30"
  },
  timelineEnabled: false
}
```

Soft limit of **8 combined items** (stops + alert lines), enforced in
the config page UI.

## AppMessage protocol

One flat `Message` write per item, phone→watch on `ready`/config change:

```js
// itemType: "configMeta" — always item 0, singleton
{
  itemIndex: 0,
  itemCount: N,               // 1 (meta) + stops.length + lines.length
  itemType: "configMeta",
  apiKey: "...",
  scheduleDaysBitmask: 0b0111110,  // bit0=Sun..bit6=Sat
  scheduleStartMinutes: 420,        // minutes since midnight (07:00)
  scheduleEndMinutes: 1170,          // 19:30
  timelineEnabled: 0                 // 0/1, AppMessage has no boolean type
}

// itemType: "configStop"
{
  itemIndex: 1,
  itemCount: N,
  itemType: "configStop",
  stopRef: "STIF:StopPoint:Q:463158:",
  lineRef: "STIF:Line::C01374:",
  lineName: "4",
  stopName: "Châtelet"
}

// itemType: "configLine" (for traffic alerts)
{
  itemIndex: 6,
  itemCount: N,
  itemType: "configLine",
  lineRef: "STIF:Line::C01374:",
  lineName: "4"
}
```

Watch→phone, only once (B) is real (dormant this pass, mechanism built
and testable independently via a manually-triggered debug call):

```js
// itemType: "alertForTimeline"
{
  itemType: "alertForTimeline",
  lineRef: "STIF:Line::C01374:",
  lineName: "4",
  alertText: "...",
  alertSeverity: "warning",
  alertEndTime: 1755450000    // unix timestamp, 0 = unknown
}
```

`messageKeys` in `package.json`: flat array of every key name used
above (union, no per-slot duplication).

## Watch UI — navigation & screens

No `Scroller` (unverified for button-driven use — see table above). Max
8 tracked items (stops + alert placeholders) means a full list never
needs true scrolling if windowed:

- **List screen**: a `Column` showing a 3-row window centered on the
  currently selected index (selected item highlighted via `Skin`).
  `Button` `up`/`down` moves the selection and re-renders the window
  (`Container.remove()` + rebuild, since there's no confirmed
  incremental-update API to rely on). `select` swaps to the detail
  screen for the highlighted item (`application.remove(list);
  application.add(detail)` — no `Screen`/navigation-stack class exists
  in Piu, confirmed by the reference doc).
- **Detail screen**: one big `Text`/`Label` layout per item, built from
  the same in-memory config+data model. `up`/`down` swaps directly to
  the previous/next item's detail (re-run the same swap, new index).
  `back` returns to the list screen at the previously selected index.
- States per detail screen, detected locally in embeddedjs (no more
  AppMessage-signaled errors — the watch made the fetch itself):
  - data OK
  - `network` — `fetch()` threw or timed out
  - `noRealtimeData` — empty `MonitoredStopVisit` array (valid, not an
    error)
  - `quotaExceeded` — HTTP 429 from `fetch()`'s `response.status`
  - alert screens only: static "alerts coming soon" while (B) is
    stubbed

## Traffic alerts & timeline — stub scope

- `main.js`, general-message section: `fetchLineAlerts(lineRefs)` stub,
  returns `[]`, logs `TODO: implement PRIM general-message parsing —
  see docs/idfm-api-reference.md ("Traffic alerts — TODO" section)`. No
  real network call.
- Timeline push mechanism (pkjs): **real implementation** —
  `Pebble.insertTimelinePin({id, time, layout: {type: 'genericPin',
  title, tinyIcon}})` / `Pebble.deleteTimelinePin(id)`, triggered by the
  `alertForTimeline` `Message` from the watch. Since the watch never
  sends this message in practice this pass (stubbed alert fetch),
  exercised only via a manual debug trigger during implementation
  verification.
- Alert schedule filter (`isWithinSchedule(date, daysBitmask,
  startMinutes, endMinutes)`): **real implementation**, lives in
  `main.js` (embeddedjs) since that's where alert fetching would
  happen — gates whether `fetchLineAlerts` is even called.

`docs/idfm-api-reference.md` gets a new "Traffic alerts — TODO" section
documenting that `general-message`'s JSON shape must be verified
against a real payload before `fetchLineAlerts` is implemented for
real.

## Error handling

Same four states as before (network, noRealtimeData, quotaExceeded,
data OK), now detected directly in embeddedjs's own `fetch()`
try/catch and `response.status` check — no AppMessage signaling needed
for this, since the watch is the one making the request.

## Testing

**Revision from the original spec**: the pure functions this section
originally planned to test with `node --test` (SIRI→item mapping,
`isWithinSchedule`) now live in `main.js` (embeddedjs), which starts
with `import Button from "pebble/button"` / `import Message from
"pebble/message"` — module specifiers that don't resolve under plain
Node. Requiring `main.js` from a Node test would fail at the import
line before reaching any pure function. Duplicating the logic into a
separate Node-testable copy would violate DRY and risk drift.

**Decision**: no automated tests for `main.js` this pass — verification
is `pebble build` + `pebble install --emulator emery` (once confirmed
available; Alloy emulator support to be checked at implementation time,
`pebble install --cloudpebble` as fallback for the physical watch) +
`pebble logs`, checking Button-driven nav, all detail-screen states,
and config receipt. This matches the project's existing "no unit test
framework on the embeddedjs side" rule — it now simply applies to more
of the logic than originally assumed.

`pkjs/index.js` stays small (proxy wiring, config load/save, timeline
push) — if any pure function ends up there (e.g. bitmask encode/decode
for the schedule), it's tested with `node --test` since `index.js` uses
`require()`, which plain Node resolves fine.

## Out of scope this pass

- Real `general-message` fetch/parsing (needs a verified payload
  first).
- `gabbro` target platform (added in a later pass).
- Custom HTTP header spike failing gracefully: if `fetch()` cannot set
  the `apiKey` header on embeddedjs, this blocks (A) entirely and must
  come back to the user rather than being silently worked around.
- Any UI polish beyond functional list/detail screens.
- Multi-city / non-IDFM support.
