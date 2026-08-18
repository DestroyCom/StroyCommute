# StroyCommute Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the StroyCommute Pebble Alloy watchapp — real-time IDFM
metro/tram departures for multiple tracked stops, with a stubbed
traffic-alerts subsystem — for the `emery` (Pebble Time 2) target.

**Architecture:** (revised 2026-08-18 — see Task 7's note below for why)
embeddedjs (`src/embeddedjs/main.js`) runs the 30-60s refresh timer and
renders the Piu UI (button-driven list/detail screens); it does NOT fetch
or parse PRIM data itself — the timer sends a lightweight `refreshStop`
AppMessage request per tracked stop to pkjs instead. pkjs
(`src/pkjs/index.js`) owns: `@moddable/pebbleproxy` wiring (kept for
potential future embeddedjs-side networking, currently unused by this
feature), the config page open/persist/forward flow, Pebble Timeline pin
push, AND (new) the actual PRIM fetch (native `XMLHttpRequest`, no proxy
needed), SIRI Lite parsing, and UTC→minutes conversion — replying to each
`refreshStop` request with a compact `departureUpdate` AppMessage item.
Originally speced with embeddedjs owning the fetch (transparently proxied
by `@moddable/pebbleproxy`); real-hardware testing found that hits a
fixed, effectively unconfigurable ~8KB memory ceiling on the watch once a
real PRIM URL and API key are combined (see Task 7).

**Tech Stack:** Pebble Alloy (Moddable SDK / Piu UI framework), plain JS
(ES modules on the embeddedjs side, CommonJS on the pkjs side), pnpm,
Biome for lint/format, Node's built-in `node --test` for the handful of
pkjs pure functions that are testable outside the Pebble runtime.

**Spec:** `docs/superpowers/specs/2026-08-17-stroycommute-scaffold-design.md`

## Global Constraints

- Target platform: **`emery`** only this pass (`gabbro` later — out of
  scope). Never use `basalt`; it doesn't exist as an Alloy target.
- Single file per environment: `src/embeddedjs/main.js` and
  `src/pkjs/index.js`, organized into commented sections — no
  `require()`/`import` splitting of app logic across multiple local
  files this pass (unconfirmed Alloy bundler behavior).
- Node version floor: **>=24** (`"engines": {"node": ">=24"}` in
  `package.json`), for `node --test` and general tooling.
- Lint/format: **Biome** (`@biomejs/biome`), configured at the repo
  root, covering `src/`, `config/`, and any `.js`/`.json` files.
- **Revised 2026-08-18**: Fetch, SIRI parsing, and UTC→minutes conversion
  live in `src/pkjs/index.js` (native `XMLHttpRequest`, no
  `@moddable/pebbleproxy` needed for this). The refresh timer stays in
  `src/embeddedjs/main.js` (it's the only side that reliably knows the
  app is foregrounded) but no longer fetches directly — it sends a
  `refreshStop` AppMessage request per tracked stop and pkjs replies with
  a `departureUpdate` item. Originally speced the other way around (fetch
  in embeddedjs); reversed after real-hardware testing found a fixed,
  effectively unconfigurable ~8KB chunk-memory ceiling on the watch —
  see Task 7's note and
  `.superpowers/sdd/2026-08-17-stroycommute-scaffold/progress.md` for the
  full investigation.
- AppMessage: flat items only, one `Message.write()` per item, no
  nested JSON. `messageKeys` in `package.json` is the flat-array-of-
  strings form (not the empty-object form seen in one outlier
  example).
- Config page: hand-rolled self-contained HTML/JS/CSS as a `data:` URI,
  opened via `Pebble.openURL()` — not Clay (Clay's schema can't express
  a variable-length list of tracked stops/lines).
- Soft limit: **8 combined tracked items** (stops + alert lines),
  enforced in the config page UI only (not baked into `messageKeys`).
- No `Piu Scroller` — list screen is a hand-rolled 3-row window over a
  `Column`, rebuilt on selection change, driven by the confirmed
  `Button` sensor (`import Button from "pebble/button"`), not by Piu's
  built-in touch/focus emulation (unverified how that maps buttons to
  focus movement).
- Never hardcode the PRIM API key. **Revised 2026-08-18**: it flows
  config page → pkjs `localStorage` → pkjs's own fetch. It never reaches
  the watch (no legitimate use for it there once pkjs owns the fetch).
- Refresh at most every 30-60s, only while the watchapp is foregrounded
  (Alloy apps don't run in the background) — timer stays in embeddedjs
  for this reason even though the fetch moved to pkjs; do not move the
  timer to pkjs, which runs whenever the phone has Bluetooth
  connectivity regardless of whether this watchapp is open.
- Four states to handle explicitly on stop detail screens: data OK,
  `network` (fetch failed/threw), `noRealtimeData` (empty
  `MonitoredStopVisit`, not an error), `quotaExceeded` (HTTP 429 via
  `response.status`) — determined pkjs-side now, sent to the watch as
  the `state` field of a `departureUpdate` item.
- `docs/idfm-api-reference.md`'s "Traffic alerts — TODO" section must
  stay accurate: `fetchLineAlerts()` stays a stub (`[]` + a `TODO`
  `console.log`) this pass — never invent the `general-message` JSON
  shape.
- If Task 3's custom-header spike fails (PRIM auth can't be attached to
  `fetch()` from embeddedjs), STOP and report back — this blocks the
  entire departures feature and needs a decision from the user, not a
  silent workaround.

---

## Task 1: Scaffold the Alloy project into the repo root

**Files:**
- Create: `package.json`, `src/embeddedjs/main.js`, `src/pkjs/index.js`, `src/c/mdbl.c`, `resources/` (all generated by `pebble new-project`)
- Modify: `package.json` (uuid, displayName, targetPlatforms, engines)

**Interfaces:**
- Produces: a `package.json` with `pebble.uuid` set, `pebble.targetPlatforms: ["emery"]`, `pebble.enableMultiJS: true`, top-level `"engines": {"node": ">=24"}` — every later task's `package.json` edits build on this file.

- [ ] **Step 1: Confirm the scaffold CLI flag**

Run: `pebble new-project --help`

Expected: the help text lists a `--alloy` flag. (Two Alloy-specific doc
pages state `pebble new-project --alloy NAME`; the general `pebble-tool`
flag reference doesn't list it, so this is a real inconsistency to
verify — if `--help` does NOT show `--alloy`, stop and report back
rather than guessing an alternate flag.)

- [ ] **Step 2: Scaffold into a temp directory, then move into place**

The repo root (`IDFM Alerts/`) already contains `claude.md`, `docs/`,
`.gitignore`, `AGENTS.md` — `pebble new-project` creates a new
subdirectory, so scaffold into a throwaway location and move the
generated files up:

```bash
cd /tmp
pebble new-project stroycommute-scaffold-tmp --alloy
mv /tmp/stroycommute-scaffold-tmp/package.json "/Users/destcom/Documents/PERSO/PEBBLE/IDFM Alerts/package.json"
mv /tmp/stroycommute-scaffold-tmp/src "/Users/destcom/Documents/PERSO/PEBBLE/IDFM Alerts/src"
mv /tmp/stroycommute-scaffold-tmp/resources "/Users/destcom/Documents/PERSO/PEBBLE/IDFM Alerts/resources"
rm -rf /tmp/stroycommute-scaffold-tmp
```

- [ ] **Step 3: Edit `package.json`**

Generate a real UUID:

```bash
uuidgen
```

Edit `package.json` (the generated file's exact starter shape may vary
slightly — match its existing style, only these fields matter):

```json
{
  "name": "stroycommute",
  "displayName": "StroyCommute",
  "author": "",
  "version": "1.0.0",
  "keywords": ["pebble-app"],
  "private": true,
  "engines": { "node": ">=24" },
  "dependencies": {},
  "pebble": {
    "displayName": "StroyCommute",
    "uuid": "<paste the uuidgen output here>",
    "projectType": "moddable",
    "sdkVersion": "3",
    "enableMultiJS": true,
    "targetPlatforms": ["emery"],
    "watchapp": { "watchface": false },
    "messageKeys": [],
    "resources": { "media": [] }
  }
}
```

- [ ] **Step 4: Verify it builds**

Run: `pebble build`
Expected: build succeeds with no errors (the scaffolded `main.js`/
`index.js` are the generated `console.log`-only starters at this point).

- [ ] **Step 5: Commit**

```bash
git add package.json src resources
git commit -m "Scaffold StroyCommute Alloy project (emery target)"
```

---

## Task 2: Add Biome for lint and format

**Files:**
- Create: `biome.json`
- Modify: `package.json` (devDependencies, scripts)

**Interfaces:**
- Consumes: `package.json` from Task 1.
- Produces: `pnpm run lint` / `pnpm run format` scripts every later task's code must pass before committing.

- [ ] **Step 1: Install Biome**

```bash
pnpm add -D @biomejs/biome
```

- [ ] **Step 2: Initialize config**

```bash
pnpm exec biome init
```

Edit the generated `biome.json` to include `src/`, `config/`, and root
`.js` files, and disable rules that don't make sense for embeddedjs's
non-standard module specifiers (`"pebble/button"`, `"piu/MC"`-style
imports aren't real npm packages — Biome lints syntax, not module
resolution, so this shouldn't need special-casing, but confirm with
Step 4 before assuming).

- [ ] **Step 3: Add scripts to `package.json`**

```json
"scripts": {
  "lint": "biome check .",
  "format": "biome format --write ."
}
```

- [ ] **Step 4: Run lint on the current scaffold**

Run: `pnpm run lint`
Expected: passes (or only trivial formatting diffs) on the Task 1
scaffold files. Fix anything Biome flags.

- [ ] **Step 5: Commit**

```bash
git add biome.json package.json pnpm-lock.yaml
git commit -m "Add Biome for lint and format"
```

---

## Task 3: Spike — verify custom HTTP headers work with embeddedjs fetch()

This is a blocking risk per Global Constraints: no official example or
doc anywhere sets a custom header on embeddedjs's `fetch()`, and PRIM
auth requires an `apiKey` header. Verify before building any real PRIM
fetch code on top of it.

**Files:**
- Modify: `src/pkjs/index.js` (temporary, reverted in Step 4)
- Modify: `src/embeddedjs/main.js` (temporary, reverted in Step 4)
- Modify: `package.json` (add `@moddable/pebbleproxy` dependency, permanent)

**Interfaces:**
- Produces: confirmation (or refutation) that `fetch(url, {headers: {...}})` transmits custom headers from embeddedjs — every later PRIM-fetching task depends on this being true.

- [ ] **Step 1: Add the pebbleproxy dependency**

```json
"dependencies": {
  "@moddable/pebbleproxy": "^0.1.0"
}
```

```bash
pnpm install
```

- [ ] **Step 2: Wire up the proxy in pkjs (temporary spike version)**

`src/pkjs/index.js`:

```javascript
const moddableProxy = require("@moddable/pebbleproxy");

Pebble.addEventListener('ready', moddableProxy.readyReceived);
Pebble.addEventListener('appmessage', function (e) {
  if (moddableProxy.appMessageReceived(e)) return;
});
```

- [ ] **Step 3: Fetch a header-echo endpoint from embeddedjs**

> **RESOLVED, 2026-08-17 — read before implementing Task 6/7.** This
> step's original plain-object sample below is confirmed broken: on
> both the emulator and real emery hardware, `fetch()` never
> resolves or rejects when `headers` is a plain object (100%
> reproducible, ~20/20 real-hardware attempts) — a Moddable SDK core
> bug (`fetch.js` only normalizes `headers` into a `Headers` instance
> for POST/PUT, not GET), not something this project can patch.
> **Always construct a `Headers` instance instead** (`const h = new
> Headers(); h.set("apiKey", value); fetch(url, { headers: h })`).
> That path also hit two real bugs in `@moddable/pebbleproxy`'s
> `proxy.js` (an unfiltered trailing-newline producing an empty
> header name at `setRequestHeader`, and the same pattern crashing
> the response-header parser) — both fixed locally via `patch-package`
> (`patches/@moddable+pebbleproxy+0.1.8.patch`, commit `6f5cd8d`,
> `postinstall: patch-package` wired in `package.json`). Confirmed
> end-to-end on real hardware: `HTTP 200`, `apiKey` echoed back
> correctly. Full narrative in
> `.superpowers/sdd/2026-08-17-stroycommute-scaffold/task-3-report.md`.
> One residual note for Task 6/7: the patched response-header parser
> still truncates any response header *value* that itself contains a
> colon (splits on first `:` only) — pre-existing behavior, not
> introduced by the patch, not yet hit by real PRIM traffic.

`src/embeddedjs/main.js` (temporary — httpbin.org echoes received
headers back in its JSON response body, so this directly answers
whether the header was transmitted):

```javascript
async function spikeCheckCustomHeader() {
  try {
    const h = new Headers();
    h.set("apiKey", "spike-test-value");
    const response = await fetch("https://httpbin.org/get", { headers: h });
    const json = await response.json();
    console.log("SPIKE headers received by server: " + JSON.stringify(json.headers));
  } catch (e) {
    console.log("SPIKE fetch failed: " + e);
  }
}

spikeCheckCustomHeader();
```

- [ ] **Step 4: Build, install, check logs**

```bash
pebble build
pebble install --emulator emery
pebble logs
```

Expected: a `SPIKE headers received by server: {...}` log line whose
JSON includes `"Apikey": "spike-test-value"` (or `"apiKey"` — header
name casing may be normalized by the HTTP layer, that's fine as long as
the value `spike-test-value` appears somewhere in the echoed headers).

If `pebble install --emulator emery` fails (emulator support for emery
unconfirmed), fall back to `pebble install --cloudpebble` on a physical
watch/phone and check `pebble logs` the same way.

**If the header does NOT appear**: STOP. Do not proceed to Task 6/7.
Report back — this blocks PRIM authentication entirely and needs a
decision (e.g. is there a query-param auth alternative on PRIM's side?
Per `docs/idfm-api-reference.md`, PRIM auth is header-only, so this
would be a real architecture blocker, not a minor detail). ~~Resolved
above~~ — kept for historical record of what was originally specified.

- [ ] **Step 5: Revert the spike code, keep the dependency**

Remove `spikeCheckCustomHeader()` and its call from `main.js`. Keep the
`@moddable/pebbleproxy` wiring in `index.js` — Task 5 builds on it
directly, no need to write it twice.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/pkjs/index.js src/embeddedjs/main.js
git commit -m "Verify embeddedjs fetch() supports custom headers; wire up pebbleproxy"
```

---

## Task 4: Config page (data URI HTML/JS/CSS)

**Files:**
- Create: `config/index.html`

**Interfaces:**
- Produces: a self-contained HTML page that, on submit, navigates to `pebble://close#<url-encoded JSON>` matching the data model in the spec (`apiKey`, `trackedStops[]`, `trackedLines[]`, `alertSchedule{days,startTime,endTime}`, `timelineEnabled`). Task 5 loads this file's contents and base64-encodes it into a `data:` URI.

- [ ] **Step 1: Write the config page**

`config/index.html`:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>StroyCommute Settings</title>
<style>
  body { font-family: sans-serif; margin: 0; padding: 16px; }
  fieldset { margin-bottom: 16px; }
  .row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
  .row input, .row select { flex: 1; }
  button.remove { flex: 0; }
  #itemCount { font-size: 0.9em; color: #666; }
</style>
</head>
<body>
  <h2>StroyCommute</h2>

  <fieldset>
    <legend>Clé API PRIM</legend>
    <input type="text" id="apiKey" placeholder="Clé API">
  </fieldset>

  <fieldset>
    <legend>Arrêts suivis (départs)</legend>
    <div id="stopsList"></div>
    <button type="button" onclick="addStopRow()">+ Ajouter un arrêt</button>
  </fieldset>

  <fieldset>
    <legend>Lignes suivies (alertes trafic)</legend>
    <div id="linesList"></div>
    <button type="button" onclick="addLineRow()">+ Ajouter une ligne</button>
  </fieldset>

  <fieldset>
    <legend>Période de réception des alertes</legend>
    <div class="row">
      <label><input type="checkbox" class="dayBox" value="1" checked> Lun</label>
      <label><input type="checkbox" class="dayBox" value="2" checked> Mar</label>
      <label><input type="checkbox" class="dayBox" value="3" checked> Mer</label>
      <label><input type="checkbox" class="dayBox" value="4" checked> Jeu</label>
      <label><input type="checkbox" class="dayBox" value="5" checked> Ven</label>
      <label><input type="checkbox" class="dayBox" value="6"> Sam</label>
      <label><input type="checkbox" class="dayBox" value="0"> Dim</label>
    </div>
    <div class="row">
      <label>Début <input type="time" id="scheduleStart" value="07:00"></label>
      <label>Fin <input type="time" id="scheduleEnd" value="19:30"></label>
    </div>
  </fieldset>

  <fieldset>
    <legend>Timeline</legend>
    <label><input type="checkbox" id="timelineEnabled"> Ajouter les infos IDFM (ex: fin d'incident) à la timeline</label>
  </fieldset>

  <p id="itemCount"></p>
  <button type="button" onclick="save()">Enregistrer</button>

<script>
  var MAX_ITEMS = 8;

  function addStopRow(values) {
    values = values || {};
    var div = document.createElement("div");
    div.className = "row stopRow";
    div.innerHTML =
      '<input type="text" class="stopRef" placeholder="STIF:StopPoint:Q:..." value="' + (values.stopRef || "") + '">' +
      '<input type="text" class="stopName" placeholder="Nom arrêt" value="' + (values.stopName || "") + '">' +
      '<input type="text" class="lineRefStop" placeholder="STIF:Line::..." value="' + (values.lineRef || "") + '">' +
      '<input type="text" class="lineNameStop" placeholder="Ligne" value="' + (values.lineName || "") + '">' +
      '<button type="button" class="remove" onclick="this.parentElement.remove(); updateCount();">x</button>';
    document.getElementById("stopsList").appendChild(div);
    updateCount();
  }

  function addLineRow(values) {
    values = values || {};
    var div = document.createElement("div");
    div.className = "row lineRow";
    div.innerHTML =
      '<input type="text" class="lineRefAlert" placeholder="STIF:Line::..." value="' + (values.lineRef || "") + '">' +
      '<input type="text" class="lineNameAlert" placeholder="Ligne" value="' + (values.lineName || "") + '">' +
      '<button type="button" class="remove" onclick="this.parentElement.remove(); updateCount();">x</button>';
    document.getElementById("linesList").appendChild(div);
    updateCount();
  }

  function updateCount() {
    var count = document.querySelectorAll(".stopRow").length + document.querySelectorAll(".lineRow").length;
    document.getElementById("itemCount").textContent = count + " / " + MAX_ITEMS + " éléments suivis";
  }

  function collectStops() {
    var rows = document.querySelectorAll(".stopRow");
    var result = [];
    rows.forEach(function (row, i) {
      result.push({
        id: "stop" + i,
        stopRef: row.querySelector(".stopRef").value,
        stopName: row.querySelector(".stopName").value,
        lineRef: row.querySelector(".lineRefStop").value,
        lineName: row.querySelector(".lineNameStop").value
      });
    });
    return result;
  }

  function collectLines() {
    var rows = document.querySelectorAll(".lineRow");
    var result = [];
    rows.forEach(function (row) {
      result.push({
        lineRef: row.querySelector(".lineRefAlert").value,
        lineName: row.querySelector(".lineNameAlert").value
      });
    });
    return result;
  }

  function save() {
    var stops = collectStops();
    var lines = collectLines();
    if (stops.length + lines.length > MAX_ITEMS) {
      alert("Maximum " + MAX_ITEMS + " éléments (arrêts + lignes) au total.");
      return;
    }
    var days = [];
    document.querySelectorAll(".dayBox").forEach(function (box) {
      if (box.checked) days.push(parseInt(box.value, 10));
    });
    var config = {
      apiKey: document.getElementById("apiKey").value,
      trackedStops: stops,
      trackedLines: lines,
      alertSchedule: {
        days: days,
        startTime: document.getElementById("scheduleStart").value,
        endTime: document.getElementById("scheduleEnd").value
      },
      timelineEnabled: document.getElementById("timelineEnabled").checked
    };
    var json = JSON.stringify(config);
    document.location = "pebble://close#" + encodeURIComponent(json);
  }

  // start with one empty row of each so the form isn't confusingly blank
  addStopRow();
  addLineRow();
</script>
</body>
</html>
```

- [ ] **Step 2: Sanity-check the HTML in a desktop browser**

Open `config/index.html` directly in a browser, add a stop row and a
line row, click "Enregistrer", and confirm (via browser dev tools
Console, since `document.location` navigation will fail locally to a
`pebble://` scheme — that's expected) that `json` in `save()` — check
by temporarily adding `console.log(json)` before the
`document.location` line, viewing the console, then removing the log —
produces valid JSON matching the data model.

- [ ] **Step 3: Commit**

```bash
git add config/index.html
git commit -m "Add StroyCommute config page"
```

---

## Task 5: pkjs — config load/save and forward to watch

> **Amended 2026-08-18** (after Task 7's fetch-architecture move): the
> `configMeta` item below still includes `apiKey` in this historical
> spec text, but the real implementation (commit history + Task 7's
> revision) stops sending it to the watch — pkjs already has it in
> `localStorage` and now does the fetch itself, so the watch has no
> further use for it. If revisiting this task's code, drop `apiKey` from
> the `configMeta` payload sent here (it stays read from `localStorage`
> inside pkjs, per Task 7).

**Files:**
- Modify: `src/pkjs/index.js`
- Modify: `package.json` (`resources.media` entry for the config HTML file, if needed to bundle it — see Step 1)

**Interfaces:**
- Consumes: `config/index.html` from Task 4; `@moddable/pebbleproxy` wiring from Task 3.
- Produces: `sendConfigToWatch(config)` function — sends one `Message` write per config item (`configMeta`, then one `configStop` per tracked stop, then one `configLine` per tracked line), matching the `itemIndex`/`itemCount`/`itemType` shape in the spec. Task 6 (embeddedjs) is the consumer of this exact wire format.

- [ ] **Step 1: Load the config page HTML as a data URI**

`src/pkjs/index.js`, top of file:

```javascript
const fs = require("fs");
const path = require("path");

const CONFIG_HTML = fs.readFileSync(path.join(__dirname, "../../config/index.html"), "utf8");
const CONFIG_DATA_URI = "data:text/html;charset=utf-8;base64," + Buffer.from(CONFIG_HTML, "utf8").toString("base64");
```

If `fs`/`path`/`__dirname` are unavailable in the pkjs runtime (it's
described as "close to a regular Node environment" but not guaranteed
identical), this step's build/run in Step 5 will surface it —
fall back to inlining the HTML as a JS template string constant in
`index.js` directly if `fs.readFileSync` fails.

- [ ] **Step 2: Show the config page and persist its result**

```javascript
Pebble.addEventListener('showConfiguration', function () {
  Pebble.openURL(CONFIG_DATA_URI);
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e.response) return;
  const config = JSON.parse(decodeURIComponent(e.response));
  localStorage.setItem('stroycommuteConfig', JSON.stringify(config));
  sendConfigToWatch(config);
});
```

- [ ] **Step 3: Encode the schedule and send config items**

```javascript
const DAY_ABBREV_TO_MINUTES = null; // not needed; keeping section self-contained

function timeStringToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function daysToBitmask(days) {
  let mask = 0;
  for (const d of days) mask |= (1 << d);
  return mask;
}

function sendConfigToWatch(config) {
  const itemCount = 1 + config.trackedStops.length + config.trackedLines.length;

  Pebble.sendAppMessage({
    itemIndex: 0,
    itemCount: itemCount,
    itemType: "configMeta",
    apiKey: config.apiKey,
    scheduleDaysBitmask: daysToBitmask(config.alertSchedule.days),
    scheduleStartMinutes: timeStringToMinutes(config.alertSchedule.startTime),
    scheduleEndMinutes: timeStringToMinutes(config.alertSchedule.endTime),
    timelineEnabled: config.timelineEnabled ? 1 : 0
  });

  config.trackedStops.forEach(function (stop, i) {
    Pebble.sendAppMessage({
      itemIndex: 1 + i,
      itemCount: itemCount,
      itemType: "configStop",
      stopRef: stop.stopRef,
      lineRef: stop.lineRef,
      lineName: stop.lineName,
      stopName: stop.stopName
    });
  });

  config.trackedLines.forEach(function (line, i) {
    Pebble.sendAppMessage({
      itemIndex: 1 + config.trackedStops.length + i,
      itemCount: itemCount,
      itemType: "configLine",
      lineRef: line.lineRef,
      lineName: line.lineName
    });
  });
}
```

Per Global Constraints, this fires messages back-to-back without
waiting for each ack — Global Constraints note this needs
callback-based sequencing per the official communication guide. Revise
to chain each `sendAppMessage`'s success callback into the next send
once Task 5's Step 5 emulator test (below) shows whether firing them
back-to-back actually drops messages in practice; don't add
speculative queuing complexity before observing a real problem.

- [ ] **Step 4: Send config on `ready` too (from persisted localStorage)**

```javascript
Pebble.addEventListener('ready', function () {
  const stored = localStorage.getItem('stroycommuteConfig');
  if (stored) sendConfigToWatch(JSON.parse(stored));
});
```

- [ ] **Step 5: Declare the new messageKeys and test end-to-end**

`package.json`, `pebble.messageKeys`:

```json
"messageKeys": [
  "itemIndex", "itemCount", "itemType",
  "apiKey", "scheduleDaysBitmask", "scheduleStartMinutes", "scheduleEndMinutes", "timelineEnabled",
  "stopRef", "lineRef", "lineName", "stopName"
]
```

Run:
```bash
pebble build
pebble install --emulator emery
pebble logs
```

In `main.js`, temporarily add a raw `Message` listener logging every
received item (this is throwaway verification code, not the real
Task 6 implementation):

```javascript
import Message from "pebble/message";
const debugMsg = new Message({
  keys: ["itemIndex","itemCount","itemType","apiKey","scheduleDaysBitmask","scheduleStartMinutes","scheduleEndMinutes","timelineEnabled","stopRef","lineRef","lineName","stopName"],
  onReadable() {
    const msg = this.read();
    const item = {};
    msg.forEach((v, k) => { item[k] = v; });
    console.log("DEBUG config item: " + JSON.stringify(item));
  }
});
```

Open the config page from the Pebble mobile app (or trigger
`showConfiguration` manually if testing without a phone — check
`pebble logs` for `DEBUG config item: ...` lines matching one
`configMeta` + one line per stop/line entered), fill in one stop and
one line, save, and confirm the expected number of `DEBUG config item`
lines appear with correct `itemIndex`/`itemCount` values. Remove the
debug listener once confirmed.

- [ ] **Step 6: Commit**

```bash
git add src/pkjs/index.js package.json
git commit -m "pkjs: config page load/save and forward to watch via AppMessage"
```

---

## Task 6: embeddedjs — receive and store config in memory

> **Amended 2026-08-18** (after Task 7's fetch-architecture move): `apiKey`
> is listed as watch-side state below, matching the original design. The
> revised architecture has pkjs doing the fetch directly, so the watch
> never needs `apiKey` at all — if revisiting this task's code, drop the
> `apiKey` module-level state and stop reading `item.apiKey` in
> `handleConfigItem` (keep everything else: `stops`, `alertLines`,
> schedule fields, `onConfigReady`, all still needed).

**Files:**
- Modify: `src/embeddedjs/main.js`

**Interfaces:**
- Consumes: the `configMeta`/`configStop`/`configLine` wire format from Task 5.
- Produces: module-level state — `let stops = []` (array of `{stopRef, lineRef, lineName, stopName}`), `let alertLines = []` (array of `{lineRef, lineName}`), `let scheduleDaysBitmask/scheduleStartMinutes/scheduleEndMinutes = 0`, `let timelineEnabled = false`, and a callback hook `function onConfigReady() {}` (redefined by Task 9's list screen to trigger a first render) — Tasks 7, 9, 10, 11 all read this state. (`apiKey` dropped — see note above.)

- [ ] **Step 1: Write the config state section**

`src/embeddedjs/main.js`, "Config state" section:

```javascript
import Message from "pebble/message";

let stops = [];
let alertLines = [];
let apiKey = "";
let scheduleDaysBitmask = 0;
let scheduleStartMinutes = 0;
let scheduleEndMinutes = 0;
let timelineEnabled = false;
let configLoaded = false;

let pendingConfigCount = 0;
let pendingStops = [];
let pendingLines = [];

function onConfigReady() {
  // overridden by the UI section (Task 9) once it exists
}

const configMessageKeys = [
  "itemIndex", "itemCount", "itemType",
  "apiKey", "scheduleDaysBitmask", "scheduleStartMinutes", "scheduleEndMinutes", "timelineEnabled",
  "stopRef", "lineRef", "lineName", "stopName"
];

const configMessage = new Message({
  keys: configMessageKeys,
  onReadable() {
    const msg = this.read();
    const item = {};
    msg.forEach((value, key) => { item[key] = value; });
    handleConfigItem(item);
  }
});

function handleConfigItem(item) {
  if (item.itemType === "configMeta") {
    apiKey = item.apiKey;
    scheduleDaysBitmask = item.scheduleDaysBitmask;
    scheduleStartMinutes = item.scheduleStartMinutes;
    scheduleEndMinutes = item.scheduleEndMinutes;
    timelineEnabled = !!item.timelineEnabled;
    pendingConfigCount = item.itemCount;
    pendingStops = [];
    pendingLines = [];
  } else if (item.itemType === "configStop") {
    pendingStops.push({
      stopRef: item.stopRef, lineRef: item.lineRef,
      lineName: item.lineName, stopName: item.stopName
    });
  } else if (item.itemType === "configLine") {
    pendingLines.push({ lineRef: item.lineRef, lineName: item.lineName });
  }

  if (item.itemIndex === pendingConfigCount - 1) {
    stops = pendingStops;
    alertLines = pendingLines;
    configLoaded = true;
    onConfigReady();
  }
}
```

- [ ] **Step 2: Verify with a temporary log**

Temporarily add `console.log("config loaded: " + stops.length + " stops, " + alertLines.length + " lines")` inside `onConfigReady`'s call site (right after `onConfigReady();` in `handleConfigItem`, as a second statement — not replacing the function so Task 9 can still override it). Build, install, trigger a config save from the phone (or Task 5's debug flow), confirm the log line shows the right counts. Remove the temporary log.

- [ ] **Step 3: Lint and commit**

```bash
pnpm run lint
git add src/embeddedjs/main.js
git commit -m "embeddedjs: receive and store config from AppMessage"
```

---

## Task 7: pkjs — PRIM stop-monitoring fetch, parse, convert (revised 2026-08-18)

> **Why this moved from embeddedjs to pkjs.** Originally speced with
> `fetch()` running watch-side (proxied by `@moddable/pebbleproxy`).
> Real-hardware testing (Pebble Time 2 / emery) found this reliably
> crashes with `fxAbort memory full` once a real ~150-char PRIM query
> string and a real 32-char API key are combined in one request — a
> fixed, effectively unconfigurable ~8KB XS chunk-memory ceiling on the
> pebble/emery Alloy host, shared across the whole app. Confirmed not an
> emulator artifact (reproduced identically on real hardware). Tried and
> ruled out: patching the two real `@moddable/pebbleproxy` bugs found
> along the way (necessary but insufficient), tuning the SDK's host
> `manifest.json` chunk/heap pool sizes (no reliable, monotonic effect —
> abandoned), switching to the lower-level streaming `HTTPClient` API
> per `https://developer.repebble.com/guides/alloy/advanced-networking/`
> (real improvement, ~2 orders of magnitude smaller gap, but still
> short by a consistent ~16-40 bytes on real hardware). Full
> investigation: `.superpowers/sdd/2026-08-17-stroycommute-scaffold/progress.md`.
>
> pkjs has native `XMLHttpRequest` (confirmed — it's literally what
> `@moddable/pebbleproxy`'s own `proxy.js` uses for the phone-side leg of
> proxied requests) and a much larger memory budget, so the fetch, SIRI
> parsing, and UTC→minutes conversion all move here. This also aligns
> with `docs/idfm-api-reference.md`'s original note that the UTC
> conversion belongs in pkjs (full `Intl`/`Date` support), which the
> original embeddedjs-side design had been inconsistent with from the
> start.
>
> **Known pkjs runtime constraint** (see `docs/pebble-alloy/SKILL.md`):
> `require("fs")`, `require("path")`, and global `Buffer` are all fatal
> in this pkjs bundler. `XMLHttpRequest`, `JSON.parse`, `Date`, and
> `Map` are all fine — none of this task's code touches the restricted
> Node builtins.

**Files:**
- Modify: `src/pkjs/index.js`
- Modify: `package.json` (`pebble.messageKeys` — add the new departures-protocol keys)

**Interfaces:**
- Consumes: the API key from `localStorage.getItem('stroycommuteConfig')` (persisted by Task 5's `webviewclosed` handler — already has everything needed, no new config plumbing required); `refreshStop` request items sent by Task 8's embeddedjs timer.
- Produces: for each `refreshStop` request received, sends back one `departureUpdate` AppMessage item with `{stopRef, state, lineName, destination, minutes, atStop, cancelled}` where `state` is one of `"ok" | "network" | "noRealtimeData" | "quotaExceeded"` (fields other than `stopRef`/`state` only meaningful when `state === "ok"`). Task 8 (embeddedjs) is the consumer of this exact wire format.

- [ ] **Step 1: Add the new messageKeys**

`package.json`, add to `pebble.messageKeys` (alongside the existing config-protocol keys from Task 5): `"state"`, `"destination"`, `"minutes"`, `"atStop"`, `"cancelled"`. (`itemType`, `stopRef`, `lineRef`, `lineName` already exist and are reused for this protocol too — no `itemIndex`/`itemCount` needed here, each request/response pair is a single self-contained item, not a batch.)

- [ ] **Step 2: Receive `refreshStop` requests**

Add to the existing `appmessage` handler from Task 3/5 (the non-proxy
branch — edit the existing listener in place, do not register a second
`'appmessage'` listener):

```javascript
Pebble.addEventListener('appmessage', function (e) {
  if (moddableProxy.appMessageReceived(e)) return;
  if (e.payload.itemType === "refreshStop") {
    handleRefreshStop(e.payload);
  }
});
```

- [ ] **Step 3: Write the fetch + parse + respond section**

Field mapping is from `docs/idfm-api-reference.md`'s table — read it
alongside this step if anything here looks off, don't re-derive it from
memory. Uses native `XMLHttpRequest` (pkjs has this directly, no proxy
needed — confirmed by reading `@moddable/pebbleproxy`'s own `proxy.js`,
which uses this exact same API for its phone-side leg):

```javascript
function handleRefreshStop(request) {
  const stored = localStorage.getItem('stroycommuteConfig');
  const apiKey = stored ? JSON.parse(stored).apiKey : "";

  const url = "https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring"
    + "?MonitoringRef=" + encodeURIComponent(request.stopRef)
    + "&LineRef=" + encodeURIComponent(request.lineRef);

  const xhr = new XMLHttpRequest();
  xhr.open("GET", url, true);
  xhr.setRequestHeader("apiKey", apiKey);
  xhr.onload = function () {
    if (xhr.status === 429) {
      sendDepartureUpdate(request.stopRef, "quotaExceeded");
      return;
    }
    if (xhr.status < 200 || xhr.status >= 300) {
      sendDepartureUpdate(request.stopRef, "network");
      return;
    }

    try {
      const json = JSON.parse(xhr.responseText);
      const visits = json.Siri.ServiceDelivery.StopMonitoringDelivery[0].MonitoredStopVisit;

      if (!visits || visits.length === 0) {
        sendDepartureUpdate(request.stopRef, "noRealtimeData");
        return;
      }

      const visit = visits[0];
      const journey = visit.MonitoredVehicleJourney;
      const call = journey.MonitoredCall;

      const cancelled = call.DepartureStatus === "cancelled";
      const atStop = call.VehicleAtStop === true;
      let minutes;
      if (atStop) {
        minutes = -1;
      } else {
        // Node has full Date support in pkjs — this is why the
        // conversion lives here, not in embeddedjs.
        const expected = new Date(call.ExpectedArrivalTime);
        minutes = Math.round((expected.getTime() - Date.now()) / 60000);
      }

      sendDepartureUpdate(request.stopRef, "ok", {
        lineName: request.lineName,
        destination: call.DestinationDisplay ? call.DestinationDisplay[0].value : "",
        minutes: minutes,
        atStop: atStop,
        cancelled: cancelled
      });
    } catch (e) {
      sendDepartureUpdate(request.stopRef, "network");
    }
  };
  xhr.onerror = function () {
    sendDepartureUpdate(request.stopRef, "network");
  };
  xhr.send();
}

function sendDepartureUpdate(stopRef, state, extra) {
  const payload = Object.assign({
    itemType: "departureUpdate",
    stopRef: stopRef,
    state: state
  }, extra || {});
  Pebble.sendAppMessage(payload);
}
```

`request.lineName` is echoed back from the `refreshStop` request rather
than re-derived, since pkjs doesn't otherwise need to look it up.

- [ ] **Step 4: Verify against the real payload example**

Cross-check this parsing code line-by-line against the JSON example in
`docs/idfm-api-reference.md` (the `Siri.ServiceDelivery.
StopMonitoringDelivery[0].MonitoredStopVisit[0].MonitoredVehicleJourney.
MonitoredCall` path) — confirm every field accessed here
(`DepartureStatus`, `VehicleAtStop`, `ExpectedArrivalTime`,
`DestinationDisplay[0].value`) exists at that exact path in the
documented example.

- [ ] **Step 5: Manual on-device test**

No automated test for pkjs's network code (Global Constraints /
spec — same as embeddedjs). Verify manually with a real API key (already
in `.env` for this project, `IDFM_API_KEY`) and a real stop/line
(`STIF:StopPoint:Q:463158:` / `STIF:Line::C01374:`, Châtelet, matches
`docs/idfm-api-reference.md`'s own example): this task cannot be fully
exercised standalone since it needs a `refreshStop` request to arrive —
either wait for Task 8's timer to send one for real, or temporarily
inject one via `pebble send-app-message` (established in Task 6's
testing) with `itemType=refreshStop`, a real `stopRef`/`lineRef`. Check
`pebble logs` for the resulting `departureUpdate` — confirm real
departure data (or a correctly-handled error state) comes back, not a
crash. This task has much more memory headroom than the old
embeddedjs-side attempt, but confirm on real hardware if available
(`pebble install --cloudpebble`), not just the emulator.

- [ ] **Step 6: Lint and commit**

```bash
pnpm run lint
git add src/pkjs/index.js package.json
git commit -m "pkjs: fetch, parse, and convert PRIM stop-monitoring data"
```

---

## Task 8: embeddedjs — refresh timer (revised 2026-08-18: sends requests, doesn't fetch)

**Files:**
- Modify: `src/embeddedjs/main.js`

**Interfaces:**
- Consumes: `stops`, `configLoaded`/`onConfigReady` from Task 6; replies from Task 7 (pkjs).
- Produces: `let departures = new Map()` keyed by `stopRef`, values `{state, line, destination, minutes, atStop, cancelled}` (mirrors Task 7's `departureUpdate` shape, `line` renamed from the wire's `lineName` for brevity — Task 9/10's screens read this), a `Message` listener that receives `departureUpdate` items, and a running 45s timer once config is loaded that sends one `refreshStop` request per tracked stop and re-renders the UI after each round (calls `renderCurrentScreen()`, a function Task 9 defines — this task adds a no-op stub for it if Task 9 hasn't run yet, so this task's own verification doesn't depend on Task 9's completion).

- [ ] **Step 1: Add the stub render hook (only if not already defined)**

If Task 9 hasn't been done yet, add a placeholder so this task is
independently testable:

```javascript
if (typeof renderCurrentScreen === "undefined") {
  var renderCurrentScreen = function () {};
}
```

(Once Task 9 exists, delete this stub — its own `renderCurrentScreen`
definition takes over.)

- [ ] **Step 2: Declare the departure-response messageKeys, receive `departureUpdate`**

`package.json`'s `pebble.messageKeys` already has `stopRef`/`lineName`
(Task 5/6) and Task 7 added `state`/`destination`/`minutes`/`atStop`/
`cancelled` — no new keys needed here, just a receiver:

```javascript
const departures = new Map();

const departureMessageKeys = [
  "itemType", "stopRef", "state",
  "lineName", "destination", "minutes", "atStop", "cancelled"
];

const departureMessage = new Message({
  keys: departureMessageKeys,
  onReadable() {
    const msg = this.read();
    const item = {};
    msg.forEach((value, key) => { item[key] = value; });
    if (item.itemType !== "departureUpdate") return;

    departures.set(item.stopRef, {
      state: item.state,
      line: item.lineName,
      destination: item.destination,
      minutes: item.minutes,
      atStop: !!item.atStop,
      cancelled: !!item.cancelled
    });
    renderCurrentScreen();
  }
});
```

Note this is a second `Message` instance alongside Task 6's
`configMessage` — both listen on disjoint key subsets of the same
`messageKeys` pool (a documented watch item from the plan's pre-flight
scan; Task 1's `hellomessage` example only ever showed one instance
whose keys exactly equal the full pool, so this is unverified until this
step's on-device test confirms both instances coexist correctly).

- [ ] **Step 3: Send `refreshStop` requests from the timer**

```javascript
let refreshTimer = null;

function requestRefresh() {
  for (const stop of stops) {
    Pebble.sendAppMessage({
      itemType: "refreshStop",
      stopRef: stop.stopRef,
      lineRef: stop.lineRef,
      lineName: stop.lineName
    });
  }
}

function startRefreshTimer() {
  if (refreshTimer) return;
  refreshTimer = setInterval(requestRefresh, 45000);
}

const previousOnConfigReady = onConfigReady;
onConfigReady = function () {
  previousOnConfigReady();
  requestRefresh();
  startRefreshTimer();
};
```

`Pebble.sendAppMessage` here is the watch-side (embeddedjs) API imported
implicitly as a global, distinct from pkjs's `Pebble.sendAppMessage` used
in Task 7 — confirm the exact watch-side send API name against
`docs/pebble-idfm-prim/SKILL.md` / the confirmed AppMessage pattern
before assuming it matches pkjs's API 1:1; if the watch-side send needs
a different call shape (e.g. via `pebble/message`'s `Message.write()`
rather than a global `Pebble.sendAppMessage`), use that instead and note
the correction here.

- [ ] **Step 4: Manual verification**

Build, install, save config with a real stop, `pebble logs`, confirm
(via the `departureUpdate` log line, or a temporary log inside
`onReadable`) that a `refreshStop` request goes out roughly every 45s
while the app stays foregrounded, and a matching `departureUpdate`
comes back and updates `departures`. Remove any temporary log once
confirmed.

- [ ] **Step 5: Lint and commit**

```bash
pnpm run lint
git add src/embeddedjs/main.js package.json
git commit -m "embeddedjs: 45s refresh timer, request/receive departures via AppMessage"
```

---

## Task 9: embeddedjs — list screen

**Files:**
- Modify: `src/embeddedjs/main.js`

**Interfaces:**
- Consumes: `stops`, `alertLines`, `departures` (Tasks 6/7).
- Produces: `function renderCurrentScreen()` (real implementation, replacing Task 8's stub), `let selectedIndex = 0`, `function buildItemList()` returning `[{type: "stop"|"alert", ...}]` — Task 10 (detail screen) consumes `buildItemList()` and `selectedIndex`.

- [ ] **Step 1: Piu skins/styles + item list helpers**

```javascript
const whiteSkin = new Skin({ fill: "white" });
const highlightSkin = new Skin({ fill: "#4444FF" });
const rowStyle = new Style({ font: "18px Gothic", color: "black" });
const rowStyleSelected = new Style({ font: "18px Gothic", color: "white" });

function buildItemList() {
  const items = [];
  for (const stop of stops) {
    items.push({ type: "stop", stopRef: stop.stopRef, lineName: stop.lineName, stopName: stop.stopName });
  }
  for (const line of alertLines) {
    items.push({ type: "alert", lineRef: line.lineRef, lineName: line.lineName });
  }
  return items;
}

function rowLabel(item) {
  if (item.type === "stop") {
    const dep = departures.get(item.stopRef);
    let status = "...";
    if (dep) {
      if (dep.state === "ok") status = dep.atStop ? "à quai" : (dep.minutes + " min");
      else if (dep.state === "network") status = "erreur réseau";
      else if (dep.state === "noRealtimeData") status = "pas de temps réel";
      else if (dep.state === "quotaExceeded") status = "quota dépassé";
    }
    return item.lineName + "  " + item.stopName + "  " + status;
  }
  return item.lineName + "  alertes (bientôt)";
}
```

- [ ] **Step 2: Build the windowed list container**

```javascript
let selectedIndex = 0;
let currentScreenMode = "list"; // "list" | "detail", read/written by Task 10 too

const application = new Application(null, { left: 0, right: 0, top: 0, bottom: 0, skin: whiteSkin });

function buildListScreen() {
  const items = buildItemList();
  if (items.length === 0) {
    return new Container(null, {
      left: 0, right: 0, top: 0, bottom: 0, skin: whiteSkin,
      contents: [new Label(null, { top: 60, left: 8, right: 8, style: rowStyle, string: "Aucun arrêt configuré" })]
    });
  }

  const windowStart = Math.max(0, Math.min(selectedIndex - 1, items.length - 3));
  const visibleCount = Math.min(3, items.length);
  const rowContents = [];
  for (let i = 0; i < visibleCount; i++) {
    const absoluteIndex = windowStart + i;
    if (absoluteIndex >= items.length) break;
    const item = items[absoluteIndex];
    const selected = absoluteIndex === selectedIndex;
    rowContents.push(new Container(null, {
      left: 0, right: 0, top: i * 50, height: 50,
      skin: selected ? highlightSkin : whiteSkin,
      contents: [
        new Label(null, { left: 8, top: 15, style: selected ? rowStyleSelected : rowStyle, string: rowLabel(item) })
      ]
    }));
  }

  return new Container(null, { left: 0, right: 0, top: 0, bottom: 0, skin: whiteSkin, contents: rowContents });
}

function renderCurrentScreen() {
  application.empty();
  if (currentScreenMode === "list") {
    application.add(buildListScreen());
  } else {
    application.add(buildDetailScreen()); // Task 10
  }
}
```

`application.empty()` is inferred from the confirmed `add`/`remove`/
`insert` container API (Task 1's research) as the way to clear all
contents before re-adding — if `.empty()` isn't a real method, this
build will fail loudly at `pebble build` or on-device; fall back to
manually `remove()`-ing `application.first` in a loop until it's `null`.

- [ ] **Step 3: Button-driven selection**

```javascript
import Button from "pebble/button";

new Button({
  types: ["select", "up", "down", "back"],
  onPush(down, type) {
    if (!down) return; // only act on press, not release
    if (currentScreenMode === "list") {
      const items = buildItemList();
      if (type === "up") selectedIndex = Math.max(0, selectedIndex - 1);
      else if (type === "down") selectedIndex = Math.min(items.length - 1, selectedIndex + 1);
      else if (type === "select") currentScreenMode = "detail"; // Task 10
      renderCurrentScreen();
    } else {
      // detail mode button handling added by Task 10
    }
  }
});
```

- [ ] **Step 4: Initial render**

```javascript
renderCurrentScreen();
```

- [ ] **Step 5: Manual verification**

Build, install, configure 3+ stops via the config page, confirm on the
emulator: list shows rows, up/down moves the highlight and scrolls the
3-row window correctly at both ends (first/last item), select switches
`currentScreenMode` (confirm via a temporary log, since Task 10 hasn't
built the detail screen yet — expect a blank/errored detail render
until Task 10 lands, that's fine for this task's scope).

- [ ] **Step 6: Lint and commit**

```bash
pnpm run lint
git add src/embeddedjs/main.js
git commit -m "embeddedjs: windowed list screen with button navigation"
```

---

## Task 10: embeddedjs — detail screen

**Files:**
- Modify: `src/embeddedjs/main.js`

**Interfaces:**
- Consumes: `buildItemList()`, `selectedIndex`, `departures`, `currentScreenMode` (Task 9).
- Produces: `function buildDetailScreen()`, and completes the `onPush` button handler's `else` branch (detail-mode up/down/back).

- [ ] **Step 1: Build the detail screen**

```javascript
const titleStyle = new Style({ font: "bold 24px Gothic", color: "black" });
const bodyStyle = new Style({ font: "18px Gothic", color: "black" });
const errorStyle = new Style({ font: "18px Gothic", color: "#AA0000" });

function buildDetailScreen() {
  const items = buildItemList();
  const item = items[selectedIndex];
  if (!item) {
    return new Container(null, { left: 0, right: 0, top: 0, bottom: 0, skin: whiteSkin, contents: [] });
  }

  const lines = [];
  if (item.type === "stop") {
    const dep = departures.get(item.stopRef);
    lines.push(new Label(null, { top: 10, left: 8, right: 8, style: titleStyle, string: item.lineName + " — " + item.stopName }));
    if (!dep) {
      lines.push(new Label(null, { top: 60, left: 8, right: 8, style: bodyStyle, string: "Chargement..." }));
    } else if (dep.state === "network") {
      lines.push(new Label(null, { top: 60, left: 8, right: 8, style: errorStyle, string: "Erreur réseau" }));
    } else if (dep.state === "noRealtimeData") {
      lines.push(new Label(null, { top: 60, left: 8, right: 8, style: bodyStyle, string: "Pas de temps réel pour cet arrêt" }));
    } else if (dep.state === "quotaExceeded") {
      lines.push(new Label(null, { top: 60, left: 8, right: 8, style: errorStyle, string: "Quota API dépassé" }));
    } else {
      const status = dep.cancelled ? "Supprimé" : (dep.atStop ? "À quai" : (dep.minutes + " min"));
      lines.push(new Label(null, { top: 60, left: 8, right: 8, style: bodyStyle, string: dep.destination }));
      lines.push(new Label(null, { top: 100, left: 8, right: 8, style: titleStyle, string: status }));
    }
  } else {
    lines.push(new Label(null, { top: 10, left: 8, right: 8, style: titleStyle, string: item.lineName }));
    lines.push(new Label(null, { top: 60, left: 8, right: 8, style: bodyStyle, string: "Alertes trafic bientôt disponibles" }));
  }

  return new Container(null, { left: 0, right: 0, top: 0, bottom: 0, skin: whiteSkin, contents: lines });
}
```

- [ ] **Step 2: Complete button handling for detail mode**

Replace the `else` branch left by Task 9's Step 3:

```javascript
} else {
  const items = buildItemList();
  if (type === "up") selectedIndex = Math.max(0, selectedIndex - 1);
  else if (type === "down") selectedIndex = Math.min(items.length - 1, selectedIndex + 1);
  else if (type === "back") currentScreenMode = "list";
  renderCurrentScreen();
}
```

- [ ] **Step 3: Manual verification**

Build, install, configure at least one real stop + one alert line.
Confirm on-device: selecting a stop row shows its detail screen with
the four states reachable (temporarily force each `departures` entry's
`state` field to test the network/noRealtimeData/quotaExceeded
branches, since triggering them for real requires specific network
conditions), up/down cycles directly between item details without
returning to the list, back returns to the list at the same
`selectedIndex`, and the alert item's detail shows the "coming soon"
message.

- [ ] **Step 4: Lint and commit**

```bash
pnpm run lint
git add src/embeddedjs/main.js
git commit -m "embeddedjs: detail screen with four states and button nav"
```

---

## Task 11: embeddedjs — alerts stub + schedule filter

**Files:**
- Modify: `src/embeddedjs/main.js`
- Modify: `docs/idfm-api-reference.md` (only if this task reveals the TODO section needs wording changes — otherwise no edit needed, it already documents this stub)

**Interfaces:**
- Produces: `async function fetchLineAlerts(lineRefs)` (stub, always resolves `[]`), `function isWithinSchedule(date, daysBitmask, startMinutes, endMinutes)` (real, pure function) — both called from a new `refreshAlerts()` hooked into the same timer as Task 8, but only actually invoked when `isWithinSchedule` returns true.

- [ ] **Step 1: Write the stub fetch function**

```javascript
async function fetchLineAlerts(lineRefs) {
  console.log("TODO: implement PRIM general-message parsing — see docs/idfm-api-reference.md (\"Traffic alerts — TODO\" section)");
  return [];
}
```

- [ ] **Step 2: Write the real schedule filter**

```javascript
function isWithinSchedule(date, daysBitmask, startMinutes, endMinutes) {
  const day = date.getDay(); // 0=Sun..6=Sat, matches the bitmask convention
  if (!(daysBitmask & (1 << day))) return false;
  const nowMinutes = date.getHours() * 60 + date.getMinutes();
  return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
}
```

- [ ] **Step 3: Hook into the refresh cycle**

```javascript
async function refreshAlerts() {
  if (alertLines.length === 0) return;
  if (!isWithinSchedule(new Date(), scheduleDaysBitmask, scheduleStartMinutes, scheduleEndMinutes)) return;
  const alerts = await fetchLineAlerts(alertLines.map(function (l) { return l.lineRef; }));
  // alerts is always [] this pass — nothing to store or render yet
}
```

Add the call into Task 8's timer callback and `onConfigReady`, right
alongside `refreshAllStops()`:

```javascript
refreshTimer = setInterval(async function () {
  await refreshAllStops();
  await refreshAlerts();
  renderCurrentScreen();
}, 45000);
```

(Edit Task 8's existing `setInterval` body in place rather than adding
a second timer.)

- [ ] **Step 4: Manual verification of `isWithinSchedule` only**

Since this function has no Pebble-specific imports at the top of the
file it's declared in — but the file as a whole still does (`import
Button from "pebble/button"`) — it's not independently testable via
`node --test` (Global Constraints / spec's Testing section already
covers this). Verify manually instead: temporarily call and
`console.log` `isWithinSchedule(new Date(), 0b1111110, 420, 1170)` (Mon-
Fri 7:00-19:30) with a couple of hardcoded `Date` values inside and
outside that window, build, install, check `pebble logs`, remove the
temporary calls once confirmed correct.

- [ ] **Step 5: Lint and commit**

```bash
pnpm run lint
git add src/embeddedjs/main.js
git commit -m "embeddedjs: stubbed alert fetch + real schedule filter"
```

---

## Task 12: Timeline push mechanism (pkjs, dormant until alerts are real)

**Files:**
- Modify: `src/pkjs/index.js`
- Modify: `src/embeddedjs/main.js`
- Modify: `package.json` (`messageKeys` additions)

**Interfaces:**
- Consumes: nothing from earlier tasks at runtime this pass (dormant — `fetchLineAlerts` always returns `[]`, so the watch never actually sends an `alertForTimeline` message in production use).
- Produces: `function pushAlertTimelinePin(alert)` in pkjs (real, callable); the watch-side `sendAlertForTimeline(alert)` helper (real, callable) — both exercised only via the manual debug trigger in Step 3, not by any real caller yet.

- [ ] **Step 1: pkjs — timeline pin push**

`src/pkjs/index.js`:

```javascript
function pushAlertTimelinePin(alert) {
  Pebble.insertTimelinePin({
    id: "stroycommute-alert-" + alert.lineRef,
    time: new Date(alert.alertEndTime * 1000).toISOString(),
    layout: {
      type: "genericPin",
      title: "Ligne " + alert.lineName,
      tinyIcon: "system://images/NOTIFICATION_FLAG",
      subtitle: alert.alertSeverity,
      body: alert.alertText
    }
  });
}
```

- [ ] **Step 2: pkjs — receive `alertForTimeline` from the watch**

Add to the existing `appmessage` handler from Task 3/5 (the
non-proxy branch):

```javascript
Pebble.addEventListener('appmessage', function (e) {
  if (moddableProxy.appMessageReceived(e)) return;
  if (e.payload.itemType === "alertForTimeline" && timelineEnabledFromLastConfig) {
    pushAlertTimelinePin(e.payload);
  }
});
```

Track `timelineEnabledFromLastConfig` as a module-level `let`, set
inside `sendConfigToWatch`'s caller (Task 5's `webviewclosed` handler)
right after `localStorage.setItem(...)`:

```javascript
let timelineEnabledFromLastConfig = false;
// inside the webviewclosed handler, after JSON.parse:
timelineEnabledFromLastConfig = config.timelineEnabled;
```

- [ ] **Step 3: embeddedjs — sender + manual debug trigger**

`src/embeddedjs/main.js`:

```javascript
function sendAlertForTimeline(alert) {
  const m = new Map();
  m.set("itemType", "alertForTimeline");
  m.set("lineRef", alert.lineRef);
  m.set("lineName", alert.lineName);
  m.set("alertText", alert.alertText);
  m.set("alertSeverity", alert.alertSeverity);
  m.set("alertEndTime", alert.alertEndTime);
  alertMessage.write(m);
}

const alertMessage = new Message({
  keys: ["itemType", "lineRef", "lineName", "alertText", "alertSeverity", "alertEndTime"],
  onWritable() {} // required by the Message API even with nothing pending by default
});
```

For manual verification only (remove after Step 4 passes), temporarily
call once at startup:

```javascript
sendAlertForTimeline({
  lineRef: "STIF:Line::C01374:", lineName: "4",
  alertText: "Test incident", alertSeverity: "warning",
  alertEndTime: Math.floor(Date.now() / 1000) + 3600
});
```

- [ ] **Step 4: Declare messageKeys and verify end-to-end**

`package.json`, add to `pebble.messageKeys`: `"lineRef"` (if not
already present from Task 5's config items — it is, skip if so),
`"alertText"`, `"alertSeverity"`, `"alertEndTime"`.

Build, install, confirm `timelineEnabled` is checked in the config
page, then check (via the Pebble mobile app's timeline view, or
`pebble logs` if pin insertion logs anything) that the test pin from
Step 3 appears. Remove the temporary `sendAlertForTimeline(...)` call
once confirmed — the real caller arrives whenever `fetchLineAlerts` is
implemented for real, out of scope this pass.

- [ ] **Step 5: Lint and commit**

```bash
pnpm run lint
git add src/pkjs/index.js src/embeddedjs/main.js package.json
git commit -m "Timeline pin push mechanism (dormant until real alerts land)"
```

---

## Task 13: Final docs consistency pass

**Files:**
- Modify: `claude.md`, `docs/pebble-alloy/SKILL.md`, `docs/pebble-idfm-prim/SKILL.md`, `docs/idfm-api-reference.md` (only where Steps 1-2 find drift — most content was already corrected during brainstorming)

**Interfaces:** none — this task only checks prose accuracy against the code just written, no code changes.

- [ ] **Step 1: Diff docs against what was actually built**

Read `claude.md` and both `SKILL.md` files fully. For each concrete
claim (CLI commands, file structure, AppMessage shape, target
platform), confirm it matches what Tasks 1-12 actually produced —
especially: did `pebble new-project --alloy` really work as documented
in Task 1 Step 1, did `pebble install --emulator emery` work or did the
project end up using `--cloudpebble` throughout, is
`application.empty()` the real method name or did Task 9 Step 2's
fallback get used.

- [ ] **Step 2: Fix any drift found**

Edit the relevant doc file(s) directly for anything Step 1 found
inaccurate. If nothing drifted, state that explicitly rather than
skipping the check.

- [ ] **Step 3: Commit**

```bash
git add claude.md docs/
git commit -m "Sync docs with actual scaffold implementation"
```

---

## Self-review notes

- **Spec coverage**: project structure (Task 1), Biome tooling (Task 2,
  user request mid-brainstorm), fetch-header risk (Task 3), config page
  (Task 4), config→watch AppMessage (Task 5/6), PRIM fetch/parse/convert
  (Task 7), refresh timer (Task 8), list/detail UI + button nav (Task
  9/10), alerts stub + schedule filter (Task 11), timeline mechanism
  (Task 12), docs sync (Task 13, matches spec's revision-note
  commitment). No spec section is without a task.
- **Placeholder scan**: every step has real code or a fully-specified
  manual verification procedure; no "TBD"/"handle appropriately"
  remains. Where an API is unverified (`application.empty()`,
  ack/nack callback shape, `insertTimelinePin` callback shape), the
  step says exactly what to do if the assumption is wrong rather than
  silently assuming success.
- **Type/name consistency**: `stops`/`alertLines`/`departures`/
  `selectedIndex`/`currentScreenMode`/`onConfigReady`/
  `renderCurrentScreen`/`buildItemList` are used with the same names
  and shapes across Tasks 6, 7, 8, 9, 10, 11 — checked by re-reading
  each task's Interfaces block against where the symbol is actually
  declared.
