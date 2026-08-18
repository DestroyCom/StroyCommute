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

## Before generating code

1. Check whether `docs/pebble-api-reference.md` already covers the API in
   question.
2. If the API isn't there and there's doubt between C and JS/Alloy, say so
   explicitly ("not sure this API exists in Alloy, needs checking") rather
   than inventing a plausible-looking signature.
3. Never suggest an npm dependency on the embeddedjs side without checking
   compatibility (embedded environment, no classic npm install on the
   watch side).
