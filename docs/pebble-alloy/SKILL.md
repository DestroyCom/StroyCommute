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
unexpected string). See `docs/pebble-api-reference.md#appmessage` for the
exact pattern used in this project.

## Debugging — common pitfalls

- `pebble logs` shows NOTHING if the watchapp isn't running in the
  foreground on the emulator/watch.
- Silent build errors → check missing `messageKeys` first.
- pkjs has a different lifecycle than embeddedjs: it restarts on Bluetooth
  reconnection, no guaranteed persistent state between sessions.

## Before generating code

1. Check whether `docs/pebble-api-reference.md` already covers the API in
   question.
2. If the API isn't there and there's doubt between C and JS/Alloy, say so
   explicitly ("not sure this API exists in Alloy, needs checking") rather
   than inventing a plausible-looking signature.
3. Never suggest an npm dependency on the embeddedjs side without checking
   compatibility (embedded environment, no classic npm install on the
   watch side).
