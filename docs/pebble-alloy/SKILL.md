---
name: pebble-alloy
description: >
  Use this skill for any Pebble project using the Alloy framework
  (embeddedjs + pkjs), including initial scaffolding, adding features
  (AppMessage, timeline, sensors), debugging (pebble logs, pebble build) and
  packaging. Triggers on any mention of "watchapp", "watchface", "Pebble",
  "Alloy", "pebble build", or any file in src/embeddedjs or src/pkjs.
---

# Pebble Alloy — development guide

## Technical context (do not confuse the two)

Pebble has two radically different dev stacks:

1. **Native C (legacy SDK)** — `Window`, `Layer`, `AppMessage` C API.
   90% of the docs and GitHub examples live in this world. **This is NOT
   what this project uses.**
2. **Alloy (modern JS, based on the Moddable SDK)** — the one used here.
   Two separate JS environments:
   - `src/embeddedjs/` : runs ON the watch. Limited embedded-JS-style API,
     no DOM, no full Node APIs.
   - `src/pkjs/` : runs ON the companion phone. Used for networking, geoloc,
     and relaying to external services. Close to a regular Node environment
     **for syntax**, but NOT for built-in modules: confirmed on this
     project's SDK (pebble-tool v5.0.39 / SDK v4.33.1) that `require("fs")`,
     `require("path")`, and the global `Buffer` are all unavailable and
     fatal (no thrown error surfaces in `pebble logs` — the script just
     silently stops executing right after the `require()` call, no
     listeners ever register). Root cause: the generated pkjs build uses
     webpack 1 with a `ProvidePlugin`-injected restricted `require()` shim
     (`_message_key_wrapper.js`, shipped in the SDK) that only recognizes
     `"message_keys"` and throws for anything else — real npm packages
     (e.g. `@moddable/pebbleproxy`) are unaffected since webpack fully
     bundles their source instead of routing through this shim. Practical
     consequence: never load a file at runtime via `fs.readFileSync()` in
     `src/pkjs/` — inline the content as a JS string/template literal
     instead — and never use `Buffer`; hand-roll any base64/binary encoding
     needed.

**Hard rule**: if you (Claude) are tempted to suggest C code (`.c`, `Window*`,
`text_layer_create`, etc.) or a full Node API on the watch side (`fs`, native
`http`, etc.), STOP — this is likely a hallucination pulled from the legacy
C docs. Check against `docs/pebble-api-reference.md` first, otherwise ask
for confirmation.

## Standard project structure

```
my-app/
  src/
    embeddedjs/main.js   # watch code
    pkjs/index.js        # phone code (networking, geoloc)
    c/mdbl.c              # generated C entry point, don't touch unless needed
  resources/              # images, fonts
  package.json            # manifest + "pebble": {...} block
```

`package.json` contains a `"pebble"` block with `uuid`, `sdkVersion`,
`targetPlatforms`, `watchapp.watchface`, `messageKeys`. The `uuid` field is
NEVER edited by hand after generation (`uuidgen` once).

## CLI reference

```bash
pebble new-project <name> --javascript   # scaffold Alloy
pebble build                             # compile
pebble install --emulator basalt         # install on emulator (Pebble Time = basalt)
pebble install --cloudpebble             # install on physical watch via mobile app
pebble logs                              # live logs (both embeddedjs AND pkjs)
```

Useful target platform: `basalt` (Pebble Time / Time 2, 144x168 color
rectangular display).

## AppMessage — watch <-> phone protocol

Always define keys in package.json's `messageKeys` BEFORE using them in
code (otherwise silent build failure or a key gets converted to an
unexpected string). `docs/pebble-api-reference.md` referenced here in an
earlier draft was never actually created in this repo — the two gotchas
below are the concrete, on-device-confirmed reference until/unless that
file exists.

**embeddedjs's `pebble/message` `Message` class — key-code gotcha
(confirmed on-device, Task 7/8).** Passing `keys` as a plain array (e.g.
`new Message({ keys: ["itemType", "stopRef", ...] })`) does NOT use
package.json's `pebble.messageKeys` numbering. Per the SDK's
`pebble-appmessage.js`, an array gets remapped to `10000 + arrayIndex`
locally — a DIFFERENT numbering than the `10000 + index-in-package.json`
scheme pkjs and the wire protocol actually use (confirmed via the SDK's
`process_message_keys.py` waf task). A `Message` instance whose local
array isn't an exact ordered prefix of package.json's array silently
decodes every field under the wrong key name — no error, no crash, items
just don't reach the right handler (or reach the wrong one and get
filtered out). **Always build `keys` as an explicit `Map<string, number>`**
using package.json's real order (`10000 + globalIndex`), never a bare
array, whenever a `Message` instance's key subset or order differs from
package.json's — see `src/embeddedjs/main.js`'s `ALL_MESSAGE_KEYS`/
`MESSAGE_KEY_CODES`/`messageKeyMap()` for the pattern. Two `Message`
instances in the same file (e.g. one for config, one for departures) DO
coexist and receive correctly once this is fixed — an earlier hypothesis
that they couldn't coexist at all was wrong; the symptom (total silence
on the older instance) was actually 100% explained by this key-code bug.

**embeddedjs's `Message.write()` — back-to-back sends throw, don't
silently drop (confirmed on-device, Task 8).** Calling `.write()` more
than once in a tight synchronous loop (e.g. one per tracked stop) throws
`Error: not writable` on the second call and crashes the app (`fxAbort`)
if uncaught — the watch-side mirror of the known phone-side
back-to-back-`sendAppMessage`-drops-messages issue (see Task 5), but a
hard crash here instead of a silent drop. `onWritable` is
**edge-triggered, not a poll-first capacity gate** — it does NOT fire
proactively when idle, so a design that only calls `write()` from inside
`onWritable` (gated on a count it reports) never sends anything at all.
The correct pattern is try-then-retry: call `write()` speculatively,
`catch` the throw if the single outbound slot is busy and queue the item,
then let `onWritable` firing (once the slot frees up) drive the retry —
see `src/embeddedjs/main.js`'s `tryWriteRefreshStop`/`flushRefreshQueue`.

## Debugging — common pitfalls

- `pebble logs` shows NOTHING if the watchapp isn't running in the
  foreground on the emulator/watch.
- Silent build errors → check missing `messageKeys` first.
- pkjs has a different lifecycle than embeddedjs: it restarts on Bluetooth
  reconnection, no guaranteed persistent state between sessions.
- **Individual AppMessage items can still vanish even with ack-chained
  sends — root-caused and fixed (Task 8b).** Task 5 already found that
  firing `Pebble.sendAppMessage()` back-to-back without waiting for acks
  drops messages, and fixed it by chaining each send through its
  success/fail callback (`sendItemsSequentially` in `src/pkjs/index.js`).
  That chaining reduces but does not eliminate the problem: in repeated
  Task 7/8 emulator runs, a single item out of a 4-item ack-chained
  config send was silently lost roughly 1 in 3 runs — pkjs's own ack
  fired successfully (it believes the send succeeded), but the watch's
  corresponding `Message`'s `onReadable` simply never fired for that
  item, no error either side. Root cause (Task 8b, instrumented logging
  on both sides): pkjs's `onAck` for item N can fire and trigger item
  N+1's `sendAppMessage` within single-digit milliseconds — faster than
  the watch's embeddedjs side can drain one AppMessage inbox item via
  `onReadable`/`read()` before the next write lands, silently
  overwriting a single-slot inbound buffer (the receive-side mirror of
  the already-documented single-slot *outbound* constraint above).
  Fixed with two layers, both in place: (1) `CONFIG_SEND_GAP_MS = 200`
  in `sendItemsSequentially` — a short delay between an item's ack and
  the next item's send, closing the race in practice (2/10 losses on a
  clean baseline vs. 0/10 with the gap, contamination-checked
  methodology, see `.superpowers/sdd/2026-08-17-stroycommute-scaffold/
  task-8b-report.md`); (2) a watch-side `configResendRequest`
  reconciliation safety net (`src/embeddedjs/main.js`) as defense in
  depth for whatever the timing fix still misses — armed only during a
  session's first config load, 4000ms timeout, capped at 3 attempts,
  reuses the existing `itemType` field (no new messageKey). A first
  version of the reconciliation logic had its own blind spot (fixed in
  the same task's review fix-round): the original completion check only
  verified the *last* item by index had arrived, not that *every* item
  had — so a lost *middle* item could still silently produce an
  incomplete `stops`/`alertLines` with no resend triggered. Fixed by
  tracking a `Set` of received item indices and completing only when
  its size matches the expected count. Any future `Message` instance in
  this file with a similar "did the whole batch arrive" completion
  check should use the same received-set pattern, not a
  last-index-arrived shortcut. Known minor residual (deferred, not yet
  seen in practice): the same duplicate-delivery race that motivated
  this fix could in principle still push a duplicate entry into
  `pendingStops`/`pendingLines` (the Set protects the completion count,
  not the underlying arrays) or, if it strikes after a batch has
  already completed, could theoretically re-fire `onConfigReady()` —
  both narrow and non-crashing, worth a dedup pass if ever observed on
  real hardware (all testing so far is emulator-only).

## Config page (showConfiguration) — three real, confirmed gotchas

All three found via real phone+watch testing (Task 4/5's code had never
been exercised through the actual Pebble mobile app before this — every
prior test used a hardcoded-trigger fallback specifically because no phone
was available to those dispatches):

1. **`package.json`'s `pebble` block needs `"capabilities": ["configurable"]`**
   for the phone app to show the settings gear/icon for the watchapp at
   all — confirmed against the official docs
   (`developer.repebble.com/guides/user-interfaces/app-configuration/`),
   which state this is the only requirement. Without it, `showConfiguration`/
   `webviewclosed` are simply unreachable from the real app, even though
   the code itself is correct. (A full app delete + reinstall on the phone
   was also needed once, in this project's case, for the gear to actually
   appear after adding the field — plain metadata caching, not a separate
   bug.)
2. **The config page must close via `document.location = "pebblejs://close#" + data`,
   not `"pebble://close#"`.** Confirmed via primary source: Clay (the
   standard config framework for the modern Rebble/CloudPebble ecosystem,
   `github.com/pebble-dev/clay/blob/main/src/scripts/config-page.js:11`)
   uses `window.returnTo || 'pebblejs://close#'` as its default. The wrong
   scheme doesn't error inside `webviewclosed` — it fails one layer up: the
   phone's webview never recognizes the navigation as a close signal, so it
   falls through to the real network stack, which doesn't know the
   `pebble://` scheme (`net::ERR_UNKNOWN_URL_SCHEME`).
3. **Mobile keyboards can silently corrupt free-typed ID-shaped fields.**
   iOS smart punctuation / Android predictive text can insert a space
   after `:` while typing an identifier like `STIF:StopPoint:Q:463158:`,
   with no visual indication anything changed. `autocorrect="off"
   autocapitalize="off" autocomplete="off" spellcheck="false"` on the
   input reduces this but isn't a guarantee across every keyboard —
   strip all whitespace from any such field's value at save time
   regardless (`value.replace(/\s+/g, "")`). Better still (this project's
   eventual fix): don't let users free-type IDs at all — resolve them from
   a live search/select instead, e.g. against IDFM's public open-data
   catalog (see `docs/idfm-api-reference.md` if it exists, or this
   project's `config/index.html` for a working example).

## Piu navigation and hardware buttons — real Behavior, not pebble/button's Button

**Confirmed on real hardware (Task 9/10 follow-up) and against a real, working
multi-screen Piu app** (`Moddable-OpenSource/pebble-examples`,
`piu/apps/words`, specifically `modules/piuView.js`'s `ViewBehavior`): in a
Piu-based screen (anything using `Application`/`Container`/`Skin`/`Style`
etc.), hardware button presses are routed to the **focused container's
`Behavior`**, via methods named `onPressSelect`/`onPressUp`/`onPressDown`/
`onPressBack` (and their `onRelease*` counterparts) — NOT through the
separate, lower-level `pebble/button` module's `Button` class
(`new Button({types: [...], onPush(down, type) {...}})`).

A standalone `Button` instance **does** still receive presses in a Piu app
(confirmed via on-device logging — `onPush` fires correctly, with the
correct `type` and `down` value) — but it runs *alongside* Piu's own native
button routing rather than replacing or suppressing it. Concretely: even
with `"back"` included in the `Button`'s `types` (which
`developer.repebble.com/guides/alloy/sensors-and-input/` documents as
sufficient to disable the OS's automatic exit-on-back, replaced by
press-and-hold instead), a Piu app still exits to the watch's app launcher
on a single back press, regardless of what the `Button`'s `onPush` callback
does — the documented override only applies to the non-Piu code path.

**The correct pattern**, confirmed working:
```javascript
class MainBehavior extends Behavior {
  onPressSelect() {
    // ... handle select ...
    return true; // handled — stops here
  }
  onPressBack() {
    if (/* nothing to go back to */) return; // falls through — OS exits as usual
    // ... navigate back ...
    return true; // handled — consumes the press, OS does not exit
  }
}

const application = new Application(null, {
  /* ...skin, contents, etc... */
  Behavior: MainBehavior,
});
application.focus(); // REQUIRED — Piu only routes button presses to a focused container
```
Returning a truthy value from an `onPress*` method means "handled, stop
here"; returning nothing/falsy lets the platform's default behavior apply
— for `onPressBack` specifically, that default is app exit, which is
exactly what you want at your app's root/home screen. Only intercept (and
return `true` from) `onPressBack` on screens that have somewhere to
navigate back *to*.

`Behavior` needs no import — like `Skin`/`Style`/`Container`/`Application`,
it's injected as a global by the SDK's pebble host (see the
`import {} from "piu/MC"` note above). `application.focus()` is required
once, after construction; without it, none of `MainBehavior`'s `onPress*`
methods ever fire (a container with no explicit `.focus()` call never
becomes the input target).

This project's original list/detail screens (Tasks 9/10) used the
`Button` class and had this exact bug — back exited to the launcher
instead of returning to the list. Fixed by migrating to this `Behavior`
pattern; no other screen logic needed to change (`buildListScreen()`/
`buildDetailScreen()`/`renderCurrentScreen()` are unaffected — only the
input-handling plumbing changed). Any future screen/button work in this
project should use `Behavior`'s `onPress*` methods from the start, never
`pebble/button`'s `Button` class, for anything built on Piu.

## Watch-side memory ceiling and Piu Skin/Style/font constraints (real, confirmed 2026-08-18)

This target has an extremely tight, largely fixed XS "chunk" memory pool
(see the PRIM-fetch finding in the project CLAUDE.md — a real ~150-char URL
+ 32-char API key in one embeddedjs `fetch()` already came within ~16-40
bytes of this ceiling). Adding a visual badge/board feature to
`src/embeddedjs/main.js` hit this ceiling twice more, confirmed via real
device crashes (not guessed):

1. A batch of new module-scope `Skin`/`Style`/`Container` objects (line
   badges, a station-board panel, minute-display boxes — roughly +3.5KB of
   compiled code) crashed on first launch with `fxAbort memory full`,
   before any config had even loaded — the crash is in constructing the
   objects at module top-level, not in any network/data path. Deferring
   construction to first-use (lazy singletons instead of eager `const`s)
   did **not** fix it — the real cost is the compiled code itself, not
   *when* it allocates.
2. A much smaller-looking follow-up change (a text `Label` on the badge,
   ~260 bytes, **combined with** bumping list-row font size from 18px to
   24px Gothic in the same build) caused an even worse failure: a full
   **watch freeze/hang**, not just an app crash — required a hardware
   reset (hold the back button ~10s) to recover, not just a relaunch.
3. Re-tested the badge-text `Label` alone (no font-size change this time,
   confirmed-valid "bold 14px Gothic"), isolating it as the only change —
   **still crashed** with `fxAbort memory full`. This ruled out
   "compiled-size delta" as the operative variable (this change was only
   ~260 bytes) and pointed at *runtime allocation churn* instead:
   `buildListScreen()` constructed a fresh `new Style({...})` for the badge
   text on every single render (up to 3 visible rows, and it re-renders on
   every button press and every 45s refresh). **Fix, confirmed working on
   real hardware**: cache the `Style` object per distinct color instead of
   constructing it fresh each render (a `Map<color, Style>`, built lazily,
   reused after that) — same pattern as the pre-existing `whiteSkin`/
   `rowStyle`-style module-level constants, just keyed dynamically since the
   color isn't known until config loads. The badge's `Skin` (also
   constructed fresh per render) was *not* changed and has never crashed
   across many tests — so the churn cost is specific to `Style`/font
   resolution, not `Skin`/color fills in general (plausibly because
   resolving a font is a heavier operation than a flat color fill).
   **Any new per-row/per-render UI element with its own `Style` should be
   cached the same way from the start**, not added as a bare `new Style()`
   inside the render loop.
4. Immediately after that fix, added a station-board `Container` (a `Skin`
   + `Style` pair) to the *detail* screen — also as lazy singletons, same
   caching pattern that just fixed #3, and *never even called* until the
   user navigates to the detail screen. **Still crashed**, again with
   `fxAbort memory full`, again very early (confirmed via `pebble logs`:
   within ~1s of "Hello, Watchface.", before config had loaded) — this
   *cannot* be the runtime-churn cost from #3 (the functions were never
   invoked), so it points back to compiled code size/module-load cost
   after all, for this specific addition. Total cumulative size at this
   point (18.76KB) was still well under the very first crash's size
   (20.9KB from item #1), so the safe ceiling is evidently **not a stable,
   predictable byte count** — plausibly state-dependent on ambient watch
   memory fragmentation from whatever ran before this app (a real,
   unrelated watchapp, "UV Guard", was observed actively running/syncing
   Timeline pins immediately before one of these crashes). Reverted the
   board entirely; not yet re-attempted.

**Practical implication**: there is no reliable formula for "how much new
watch-side code is safe" on this target — only real-hardware confirmation.
Budget real device-testing time for *any* embeddedjs UI addition, however
small it looks on paper, and treat every addition as a genuine risk of a
crash or full watch freeze until proven otherwise on the actual watch.

**Rules that follow from this:**

- Change **one thing at a time** on the watch side and get it confirmed
  stable on real hardware before adding the next. Combining two changes in
  one build makes it impossible to tell which one broke it without
  reverting both.
- `pebble build`'s printed "Total size of resources" is a rough signal,
  not a safety guarantee — a small delta is not proof a change is safe,
  it only rules out the *large*, obviously-reckless case. Also: **run
  `pebble clean` before trusting that number on anything but a from-scratch
  build** — confirmed the incremental build can silently reprint a stale
  number even after Moddable's own `mcrun` step recompiled `main.js` (the
  waf packaging/report step doesn't always notice the recompiled `mc.xsa`
  changed).
- If a crash or freeze happens, revert to the last hardware-confirmed-good
  state immediately rather than debugging forward from a crashed device.
- Comments (including JSDoc) are free — confirmed zero compiled-size
  impact on a clean rebuild. Freely document watch-side code.
- **Piu's `Skin` without a `texture` only draws plain axis-aligned
  rectangles** (confirmed reading the SDK's `piuSkin.c` — the no-texture
  draw path is a flat `fillColor` plus an optional plain rectangular
  border via `borders`, there is no corner-radius/rounding support at
  all). A circle or rounded-rect badge needs a texture asset, and this
  project has not yet confirmed a working path to add one: Moddable's own
  asset pipeline (a `manifest.json` with image resources, auto-tinted via
  `Skin({texture, color})` per `PiuSkinCreate`'s `piuSkinColorized` path)
  is not exposed through Alloy's `package.json`-driven build for a
  `"projectType": "moddable"` project — `pebble.resources.media` is the
  **classic C-SDK** resource pipeline (`.pbi`/pbpack), effectively
  bypassed for moddable projects (just an auto-injected opaque `mc.xsa`
  blob). Adding a real texture asset is an unstarted spike, not a known
  quantity.
- **Gothic bitmap font sizes are fixed, confirmed via the SDK's
  `pebble_fonts.h`: 9, 14, 18, 24, 28 (bold: 14, 18, 24, 28 only — no bold
  9).** Any other size (e.g. "16px Gothic", "20px Gothic") does not error
  at build time — it fails at runtime with a `URIError: font not found
  gothic-bold-16.fnt` (or similar), discovered only on real hardware.
  Always pick a font size from this exact list.

### Root cause and applied fix (2026-08-19)

Investigated the memory-ceiling mechanism directly in the Moddable SDK
toolchain source (`~/Library/Application Support/Pebble SDK/SDKs/4.33.1/toolchain/moddable`)
rather than guessing further from symptoms:

- The pebble target's **base** Moddable manifest
  (`build/devices/pebble/manifest.json`) sets XS engine `creation` values:
  `static: 32768`, `chunk.initial: 8192` (matches the ~8KB figure seen in
  real crash logs), `heap.initial: 512` slots, `stack: 384`. This
  project's own `src/embeddedjs/manifest.json` did not override any of
  it — inherited as-is, silently.
- Growth beyond `chunk.initial` (default `chunk.incremental` = 1024, not
  disabled) falls back to `fxGrowChunks` -> `fxAllocateChunks` ->
  `c_malloc`, which on the pebble platform
  (`xs/platforms/pebble/xsHost.h:227`) is `#define c_malloc(a)
  app_malloc(a)` — the real Pebble OS per-app heap allocator.
- Official Moddable docs
  (`documentation/tools/manifest.md`) recommend, for constrained/embedded
  targets, disabling `static` (0) or, if kept nonzero, disabling
  `chunk.incremental`/`heap.incremental` (0) for a strictly bounded
  budget. The pebble base manifest does neither, so growth is silently
  enabled by default.
- **Corroborating upstream evidence**: an open, unresolved GitHub issue
  (Moddable-OpenSource/moddable#1647, filed 2026-06-30) confirms that on
  this exact Pebble/Alloy port, the XS "static" machine can land in the
  **kernel (privileged) heap** rather than an isolated per-app heap,
  causing MPU faults. The filed repro is FFI-specific (this project uses
  no custom FFI), so it's not proven identical, but it's strong evidence
  that XS memory here isn't reliably isolated from kernel/ambient-state
  pressure — which fits the observed non-determinism (crashes not tied to
  a stable byte threshold, one crash coincident with another app's
  Timeline sync).

**First fix attempt was a dead end**: `src/embeddedjs/manifest.json`'s
`creation` field looked like the right lever (it's the documented XS
manifest mechanism) and passed clean on the emulator (`pebble install
--emulator emery`, stress-tested with `pebble emu-button`) — but it had
**zero effect on the real device build**. Traced why: Alloy's `pebble
build` pipeline produces the shipped `mc.xsa` via `mcrun`
(`run_moddable_prebuild` in pebble-tool's `build.py`), and `mcrun`'s own
generated makefile
(`build/mods/emery/mcrun/tmp/pebble/debug/embeddedjs/makefile`) invokes
`xsl -a ...` with **no `-c`/creation flag at all** — `mc.xsa` is just a
preloaded-module archive (`-a`), not a standalone machine. The manifest's
`"creation"` object only matters for `mcconfig`-driven standalone/simulator
builds, never for the actual Alloy-on-Pebble deployment path. Confirmed on
real hardware: this build still crashed identically
(`fxAbort memory full`, "Chunk allocation: failed for 24 bytes") after
saving a few tracked stops in config — proof the override never took
effect. **Don't use `src/embeddedjs/manifest.json`'s `"creation"` field to
tune memory for this project — it's inert for the real device build.**

**Real fix, found and confirmed on real hardware (2026-08-19)**: the
actual lever is `ModdableCreationRecord` passed to `moddable_createMachine()`
in `src/c/mdbl.c` (declared in the Pebble SDK's own `pebble.h`, distinct
from anything in the Moddable manifest system):
```c
typedef struct {
    uint32_t recordSize;
    uint32_t stack;   // Stack size in bytes (0 for default)
    uint32_t slot;    // Slot heap size in bytes (0 for default)
    uint32_t chunk;   // Chunk heap size in bytes (0 for default)
    uint32_t flags;
    void *fxBuildFFI;
} ModdableCreationRecord;
```
The original `mdbl.c` left `.stack`/`.slot`/`.chunk` all at 0 (library
defaults) — those defaults are what were exhausting during config load.
Two bad attempts before landing on the fix, both instructive:
1. `.chunk = 65536, .slot = 32768` (98KB total, `.stack` left at 0) —
   **the app no longer launched at all**, not even far enough to show
   "no stop configured." Too large a jump, and/or `.stack` needs to be
   set explicitly once chunk/slot are non-default (unconfirmed exact
   mechanism, but empirically true).
2. `.chunk = 16384` alone (modest, `.slot`/`.stack` still 0) — user
   reported this "didn't work" (not tested to a clean pass/fail before
   moving on).
3. **Working values**, found by researching other real Alloy/Pebble
   projects rather than guessing further:
   `.stack = 6144, .slot = 32768, .chunk = 32768` (70KB total). These
   match another public Alloy/Pebble project
   (camr0/SimpleRoundWatchFace) that hit the identical crash
   ("Firmware-managed defaults exhaust the chunk heap") and fixed it with
   these exact numbers. **Confirmed working on this project's real Pebble
   Time 2 hardware**: added a new tracked stop and saved config — no
   crash (previously reproduced the crash every time on this exact
   repro).

```c
ModdableCreationRecord cr = {
    .recordSize = sizeof(cr),
    .stack = 6144,
    .slot = 32768,
    .chunk = 32768,
#ifdef PBL_DEBUG
    .flags = kModdableCreationFlagDebug,
#endif
};
moddable_createMachine(&cr);
```

**Lesson for next time**: when a fix's own first attempt fails in a new,
worse way (app won't even launch), that's the "3+ fixes failed, question
the approach" signal arriving early — stop guessing at values and go find
a real, working reference (another project hitting the same error) rather
than iterating blindly on hardware. The `mdbl.c` fix above is the
project's second attempt at this in one session; the first (manifest.json)
wasted an emulator-validated but real-hardware-inert round trip because
its point of effect was never verified against the actual build pipeline
before declaring it fixed.

### Optional chaining (`?.`) is broken on this XS engine (found 2026-08-19)

`item?.type !== "stop"` inside `requestRefresh()` built and installed
without error, but crashed on real hardware at runtime with `call: not a
function` inside a `Message`'s `onReadable` handler (the call stack that
happened to reach the broken line). Reverting to the explicit
`!item || item.type !== "stop"` form fixed it immediately, with no other
change. Biome's `useOptionalChain` lint rule will keep suggesting `?.` --
the fix carries a `biome-ignore` comment; don't "clean it up" back to `?.`.
No other `?.` usage has been tested on this target; treat any new one as
unverified until confirmed on real hardware, not just a clean build.

## Before generating code

1. Check whether `docs/pebble-api-reference.md` already covers the API in
   question.
2. If the API isn't there and there's doubt between C and JS/Alloy, say so
   explicitly ("not sure this API exists in Alloy, needs checking") rather
   than inventing a plausible-looking signature.
3. Never suggest an npm dependency on the embeddedjs side without checking
   compatibility (embedded environment, no classic npm install on the
   watch side).
