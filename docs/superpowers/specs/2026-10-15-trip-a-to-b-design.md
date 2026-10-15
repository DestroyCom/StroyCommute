# StroyCommute — A→B trips, mission codes, PRIM call guard

Date: 2026-10-15
Status: design approved in chat, pending written-spec review

## Purpose

Today a RER/Transilien stop (a PRIM stop area, both directions mixed) is
filtered by **terminus**, picked from whatever trains PRIM happens to
announce at config time. In practice the picker often lists a single
terminus (e.g. only "Paris Austerlitz" at Saint-Michel Notre-Dame late in
the evening), and a terminus is the wrong question anyway: the user wants
"I board line C at A and get off at B — show me only trains that actually
serve B".

This change delivers:

1. **A→B trips**: a tracked stop can carry an optional arrival stop on the
   same line; only trains calling at A and then at B are shown.
2. **Easy return trip**: one tap adds the B→A trip.
3. **Mission code** (SORO, SARA, KOBE...) shown next to each departure.
4. **PRIM call guard**: after N calls within W minutes, no PRIM call is
   made for P minutes. N/W/P are configurable in the config page.

Out of scope: metro/tram (a platform is already one direction), traffic
alerts, `gabbro`.

## Verified data (real PRIM payloads, 2026-10-15)

Captured with the user's key (`stop-monitoring`, stop area
`STIF:StopArea:SP:44877:` = Saint-Michel Notre-Dame, line
`STIF:Line::C01727:` = RER C). Fields present on SNCF visits, beyond what
`docs/idfm-api-reference.md` already documents:

| Field (under `MonitoredVehicleJourney`)            | Example                                                        | Use                       |
| -------------------------------------------------- | -------------------------------------------------------------- | ------------------------- |
| `JourneyNote[0].value`                             | `"ZEBA"`                                                       | mission code              |
| `FramedVehicleJourneyRef.DatedVehicleJourneyRef`   | `"SNCF_MAGENTA_PRD:VehicleJourney::033d0888-...:LOC"` (string) | join key between A and B  |
| `VehicleJourneyName[0].value` / `TrainNumbers.TrainNumberRef[0].value` | `"147491"`                               | fallback join key         |
| `MonitoredCall.Order`                              | `14`                                                           | stop sequence in the trip |

**Not yet verified**: that the same train carries the same
`DatedVehicleJourneyRef` in the A and B responses, and that `Order` grows
along the trip. The capture happened at 23:19 with no RER C running
between the two stations (B's response was empty). The first
implementation step closes this gap (see Implementation order).

Open-data ids used for testing: Saint-Michel Notre-Dame
`IDFM:monomodalStopPlace:44877`, Issy - Val de Seine
`IDFM:monomodalStopPlace:462357`, RER C `IDFM:C01727`.

Rejected alternative: PRIM's Navitia `journeys` endpoint (works with this
key, filters A→B natively, `display_informations.headsign` = mission code)
— 30-140 KB responses, a different stop id namespace (multimodal
`stop_area:IDFM:73620`), separate quota, unverified SNCF real-time
quality. Kept as a fallback if the join above turns out unreliable.

## 1. Config page (`config/index.html`, mirrored in `CONFIG_HTML`)

- Selecting a stop-area result (RER/Transilien) no longer opens the
  terminus picker. It opens an **"Arrival stop (optional)"** search box,
  restricted to the same line: same `arrets-lignes` dataset, `where`
  clause `id = "<line id>" and stop_name like "<query>"`.
  - Picking a result sets the arrival; the arrival must differ from A.
  - A "Skip — all trains" button adds the row with no arrival (same
    behaviour as today's "nothing checked").
- Stored row shape gains `destStopRef` (PRIM stop ref, via the existing
  `idfmIdToStif`) and `destStopName`. The `destinations` field and its
  picker (`fetchDestinations`, `openDirectionPicker`) are removed.
- Row label: `C — Saint-Michel Notre-Dame → Issy - Val de Seine`.
- Rows with an arrival get a **"⇄ Add return"** button that adds the
  reversed row (A/B swapped, same line and colors). The duplicate check
  and the 8-item limit apply as for any row.
- Duplicate check key becomes `stopRef + lineRef + destStopRef`.
- **Legacy rows** (saved with `destinations`, no `destStopRef`) load as
  "all trains"; the user re-adds them to set an arrival. No migration.
- **New "PRIM call guard" fieldset**: three number inputs — max calls
  (N, default 40, 0 = disabled), window in minutes (W, default 10), pause
  in minutes (P, default 15). Saved as `callGuard: {maxCalls,
  windowMinutes, pauseMinutes}`. Missing in an older config → defaults.
- New fr/en strings for all of the above.

## 2. pkjs (`src/pkjs/index.js`)

### Refresh flow

`handleRefreshStop(request)` now receives `destStopRef` too (may be
empty) and looks up nothing else from the config for filtering.

- **No arrival**: unchanged single request on A, minus the removed
  terminus filter.
- **With arrival**: two `stop-monitoring` requests fired in parallel (A
  and B, both with `LineRef`). When both complete:
  - If either failed, reply with the most actionable failure state, in
    this priority: `rateLimited` > `quotaExceeded` > `invalidKey` >
    `invalidStop` > `network`.
  - Otherwise, keep each A visit for which a B visit exists with the same
    join key (`DatedVehicleJourneyRef`, falling back to the train number
    when absent) **and** B's `Order` > A's `Order` — or, when either
    `Order` is missing, B's best time field later than A's.
  - Then the existing pipeline: drop visits without a usable time, sort
    (running before cancelled, at-stop first, then minutes), reply `ok`
    or `noRealtimeData`.
- The join/filter is a pure function (`filterVisitsServingStop(visitsA,
  visitsB)`) so it can be exercised from a Node script against captured
  payloads.
- **Known limit**: PRIM only announces a limited horizon (~1h). A train
  leaving A soon but reaching a distant B beyond B's horizon is dropped.
  Acceptable for commuting distances.

### Reply payload (`departureUpdate`)

Adds `destStopRef` (echoed back, part of the watch's key), `mission`
(first departure's `JourneyNote`, omitted if absent) and `mission2`
(second departure's, omitted if absent or no second departure).

### Call guard

- One persisted record in `localStorage` (`stroycommuteCallGuard`): the
  timestamps of recent PRIM calls (trimmed to the window) and
  `pausedUntil`.
- `primCallAllowed(count)` is checked before firing a refresh's
  request(s) (`count` = 1 or 2, so an A→B refresh is all-or-nothing). If
  `pausedUntil` is in the future → refuse. Else if
  `recentCalls + count > maxCalls` (and `maxCalls > 0`) → set
  `pausedUntil = now + P`, refuse. Else record `count` timestamps, allow.
- Refused → reply `state: "rateLimited"`, `minutes` = whole minutes left
  in the pause (rounded up). No request is made, so nothing is counted
  against the daily quota counter.
- Applies to every refresh (timer, screen switch, Select). Config-page
  calls (key validation, metro direction lookup) run in the webview and
  are not counted.
- Daily quota counter (`recordPrimRequestAndGetQuotaRemaining`) is called
  once per actual request — twice for an A→B refresh.

## 3. Watch (`src/embeddedjs/main.js`) — memory first

The watch has hit hard memory crashes before (fixed chunk pool, Skin/Style
churn). Constraints for this change:

- **No new Skin, Style, screen or timer.** Reuse `bodyStyle`,
  `titleStyle`, `errorStyle`, `boardTitleStyle()`.
- **4 new AppMessage keys**, appended at the end of
  `package.json`'s `pebble.messageKeys` **and** `ALL_MESSAGE_KEYS` (same
  order, append-only so existing codes don't move): `destStopRef`,
  `destStopName`, `mission`, `mission2`.
- `configStop` items carry `destStopRef` and `destStopName` (empty string
  when no arrival). Each tracked stop stores 2 more short strings.
- `refreshStop` sends `destStopRef`; `departureUpdate` echoes it.
- `departureKey()` becomes `stopRef|lineRef|destStopRef`.
- `departures` entries gain `mission` and `mission2`.
- New state `rateLimited`: one line, `errorStyle`, "Paused (quota guard),
  back in {n} min" / "Pause anti-quota, reprise dans {n} min".
  `rateLimited` is **not** a permanent error state: the 45s timer keeps
  asking, pkjs keeps refusing cheaply until the pause ends.

Layout (Emery 200×228, existing offsets kept):

```
top 0-44   banner, Text (was Label) so it can wrap to 2 lines:
           "C  Saint-Michel Notre-Dame → Issy - Val de Seine"
top 60     Text: "SICA · To Saint-Quentin en Yvelines" (mission omitted
           when absent, as today)
top 110    "4 min" / "At platform" / "Cancelled" + spinner
top 150    "Then 12 min · KOBE" (mission2 omitted when absent)
top 200    "Up / Down to switch"
```

## Error handling summary

| Situation                                | Watch state       |
| ---------------------------------------- | ----------------- |
| Guard pause active                       | `rateLimited`     |
| HTTP 429 on A or B                       | `quotaExceeded`   |
| HTTP 401/403 on A or B                   | `invalidKey`      |
| HTTP 400/404 on A or B                   | `invalidStop`     |
| Transport error / bad body on A or B     | `network`         |
| Both OK, no train serving A then B       | `noRealtimeData`  |

## Testing

- **Node script** (scratch, not shipped): run `filterVisitsServingStop`
  and the call guard logic against the captured daytime payloads and a
  few hand-edited variants (missing `Order`, missing
  `DatedVehicleJourneyRef`, train going B→A).
- **Emulator** (`pebble install --emulator emery`): config flow (arrival
  search, skip, add return, guard fieldset), watch layout with long
  names, `rateLimited` screen (set N very low).
- **Real watch** (`pebble install --phone`, build from the WSL-native
  copy): daytime A→B and B→A on RER C, check against the SNCF app's
  missions; watch for memory crashes while cycling screens for a few
  minutes.

## Implementation order

1. **Verify the join (gate).** During RER C service hours, capture A and
   B `stop-monitoring` responses (~4 calls). Confirm shared
   `DatedVehicleJourneyRef` and increasing `Order`. Add a trimmed real
   example and the new fields to `docs/idfm-api-reference.md`. If the
   join does not hold, stop and revisit (Navitia fallback above).
2. pkjs: join/filter + mission + call guard.
3. Config page (both copies kept in sync).
4. Watch: keys, key format, layout, `rateLimited`.
5. Docs: `docs/pebble-idfm-prim/SKILL.md` (protocol, states),
   `CLAUDE.md` if any rule wording changes.
