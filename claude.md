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
  `refreshStop` requests, SIRI Lite parsing, UTC→minutes conversion.
  `@moddable/pebbleproxy` is **required** even though the watch makes no
  network request itself: when the first `pebble/message` `Message` is
  created, the watch sends a "ready" message (key 15025) and stays
  unable to write (`write()` throws "not writable") until the phone sends
  something back — the proxy's `readyReceived` is what answers it. Keep
  `Pebble.addEventListener("ready", moddableProxy.readyReceived)` and the
  `appMessageReceived` check (verified in the Moddable sources,
  `build/devices/pebble/modules/message/pebble-appmessage.c`).
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
pebble install --phone <phone-ip>  # physical watch over LAN (Pebble app > Settings > Phone > Connectivity > LAN developer connection)
pebble logs                        # live logs, embeddedjs + pkjs
npm test                           # pkjs unit tests (node:test), run on Windows
npm run sync:config                # copy config/index.html into CONFIG_HTML after editing it
```

Build from a WSL-native copy of the repo (`rsync` to `~/dev/StroyCommute`,
excluding `node_modules`, `build` and `.prim_key`): npm writes corrupted
files under `/mnt/d`.

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
  a `departureUpdate`. Do not move the timer to pkjs: pkjs is started and
  stopped with the watchapp, so it can't run anything while the app is
  closed, and the watch side is what knows which stop is on screen.
  Nothing of this app runs in the background: timeline pins
  (`Pebble.insertTimelinePin`, local pins only — the timeline web API is
  gone) and `Pebble.showSimpleNotificationOnPebble` only work while pkjs
  runs, i.e. while the app is open. To do work at a given time with the app
  closed, schedule a watch wakeup (`pebble/wakeup`), which relaunches the
  app.
  The one exception is the app's plugin (`src/plugin/`, Pebble app plugins
  preview): it runs while a watchface or Index reads its
  `transit/departure` source, possibly all day. It has its own quota
  budget, which must stay at least this strict: shared call guard and
  daily count, one fetch per trip per 2 minutes, 3 trips at most, no fetch
  under 300 calls left for the day, off when `pluginEnabled` is false.
  `src/plugin/plugin.js` is generated (`npm run sync:plugin`, checked in
  CI by `check:config`) from `src/plugin/main.js` and `src/pkjs/trips.js`:
  never edit it by hand.
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
  for the config protocol; the departures protocol is documented in
  `docs/pebble-idfm-prim/SKILL.md`.
- Explicitly handle these states on the watch side: data OK, network
  error, stop with no real-time data available (not an error), quota
  exceeded (HTTP 429).

## Pinned tooling versions

The Pebble SDK and `pebble-tool` versions used by CI and releases are
pinned in `.github/actions/setup-pebble/action.yml` (`sdk-version`,
`pebble-tool-version`), on purpose: an SDK update can change how the app
behaves (SDK 4.44 started requiring `usesPermissions` for phone-side
network access, without which PRIM requests are refused).

Check for updates regularly — at the start of each session, and before
preparing a release:

- `pebble-tool`: latest on PyPI,
  `curl -s https://pypi.org/pypi/pebble-tool/json | jq -r .info.version`.
- SDK: `pebble sdk list` ("Available SDKs"), and the changelogs at
  `https://developer.repebble.com/sdk/changelogs/<version>/`.

When a newer version exists, tell the user (in French) without being
asked: which version, what its changelog says, and your assessment — should
we update now, later, or skip it, and why (fixes or features we'd use,
breaking changes, new requirements on `package.json`, risk for the app on
the watch). Don't update on your own. Once the user agrees: change the
pinned version, run `pebble build` locally with that version and read the
build warnings, run the CI build, and add a `CHANGELOG.md` entry only if
users will notice the difference.

## Changelog

`CHANGELOG.md` is the source of the release notes: the Release workflow
(`scripts/release-notes.js`) moves its `[Unreleased]` section under the new
version and turns it into the GitHub release body and the plain text pasted
into the appstore. Keeping it up to date is Claude's job, not the user's:

- Every time you change something a user of the app can notice (new
  feature, behaviour change, fix, performance, permissions, settings page),
  add one entry under `## [Unreleased]`, in the same change/commit.
- Put it under `### Nouveautés`, `### Améliorations` or `### Corrections`
  (create the heading if missing, in that order).
- Write it in French, as one sentence for app users, not developers: what
  changes for them, not how it was implemented. No file names, function
  names or commit jargon.
- If a change refines an entry already under `[Unreleased]`, update that
  entry instead of adding another.
- Purely internal changes (refactors, tests, CI, docs, tooling) get no
  entry, unless they change something users see.
- Never edit the sections of released versions, and never bump the version
  in `package.json` by hand: the Release workflow does both.

## Code style

- TypeScript/JavaScript, pnpm if dependencies are needed on the pkjs side
- Direct code, no over-explaining, but don't sacrifice readability for
  brevity either
- Code & Comments in English, but speaks with the user with his preferred language like French
