# Alert Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Readable alert screens (one whole message per page, most important first, Select for the next one, line-coloured banner) and a setting choosing which screens the watch cycles through.

**Architecture:** pkjs orders a line's messages and sends them whole, `\n`-separated, in one `alertUpdate` (plus the line's colours). The watch splits them into pages, shows one per screen under the existing banner, and pages with Select. A new `configMeta` field `screens` filters the watch's item list.

**Tech Stack:** Pebble Alloy (embeddedjs/Piu on the watch, pkjs on the phone), node:test, Biome.

**Spec:** `docs/superpowers/specs/2026-11-14-alert-screens-design.md`

## Global Constraints

- No `?.` / `??` / `**` in `src/pkjs/*` (webpack 1) nor `?.` in `src/embeddedjs/main.js` (breaks on the watch).
- Watch: no new `Style` object; reuse `smallStyle` (14 px), the banner (`applyBanner`), `skinFor`/`bannerStyle`.
- Watch AppMessage input buffer stays 2048 bytes: `alertText` is at most **1500 UTF-8 bytes**.
- Each message is at most 280 characters (`MAX_TEXT` in `src/pkjs/alerts.js`, unchanged); only "Perturbation" messages are kept (unchanged: notifications and pins are out of scope).
- New message key `screens` appended at the end of `package.json` `pebble.messageKeys` **and** of `ALL_MESSAGE_KEYS` in `src/embeddedjs/main.js` (checked by `test/message-keys.test.js`).
- Every watch-side task ends with a build, an install on the real watch (`pebble install --phone <phone-ip>`, from the WSL copy) and the user's check before the next task.
- After editing `config/index.html`: `pnpm sync:config`. Before each commit: `pnpm test`, `pnpm lint` (in the WSL copy, LF), `pnpm check:config`.
- User-visible changes get a French `CHANGELOG.md` entry under `[Unreleased]` (refine the existing "Alertes trafic" one; a new one for the setting).

## Review Focus

- A line whose messages exceed 1500 bytes together: the first message is always sent whole, later ones dropped whole (never cut mid-text) — test in Task 1.
- The messages of the line on screen change while it is shown (a new disruption, or one ends): the page goes back to 1/N, never past the last page — test in Task 2.
- Select on a stop screen still refreshes, on a single-message alert screen does nothing harmful — test in Task 2.
- "Alertes seulement" with no current disruption: the watch must not claim "Aucun arrêt configuré" — every watched line gets a screen ("Pas de perturbation") in that mode — test in Task 3.
- A config saved before this change (no `screens`): behaves as "Arrêts et alertes" — test in Task 3.

---

### Task 1: pkjs — ordered, whole messages and line colours in `alertUpdate`

**Files:**
- Modify: `src/pkjs/alerts.js` (new pure helper, export it)
- Modify: `src/pkjs/index.js` (`afterAlertRefresh`, the `alertUpdate` items; drop `MAX_ALERT_TEXT`)
- Test: `test/alerts.test.js`, `test/phone.test.js`

**Interfaces:**
- Produces: `alerts.alertTextFor(messages: {id, text, validUntil: ?number}[], maxBytes?: number = 1500) -> string` — messages sorted by `validUntil` ascending (`null` last, ties keep their order), texts joined with `"\n"`, whole messages only while the UTF-8 byte length stays ≤ `maxBytes`, the first message always included.
- Produces (wire): `alertUpdate` = `{itemType, lineRef, lineName, alertCount, alertText?, lineColor?, lineTextColor?}`; `alertCount` stays the total number of messages; colours from `watchLineColors(stop.lineColor, stop.lineTextColor)` of the first tracked stop with that `lineRef`, omitted when none.

- [ ] **Step 1: Write the failing tests** in `test/alerts.test.js`:
  - `alertTextFor orders messages ending soonest first, undated last`: input validUntil `[300, null, 100]` with texts `"c"`, `"n"`, `"a"` → `"a\nc\nn"`.
  - `alertTextFor keeps whole messages within the byte budget`: three 280-char messages of `"é"` (560 bytes each), `maxBytes` 1500 → exactly the first two joined (no third, no partial).
  - `alertTextFor always keeps the first message`: one 600-byte message, `maxBytes` 100 → that message whole.
  
  In `test/phone.test.js`: `alerts: the watch gets every message whole, ordered, with the line's colours` — `ALERT_CONFIG` plus a tracked stop on `STIF:Line::C01743:` with `lineColor: "#5291CE"`; answer the 4-message `gm-rer-b.json`; the RER B `alertUpdate` has `alertCount` 4, `alertText.split("\n").length` 4, no text ending in `/` mid-word, and `lineColor` equal to `watchLineColors("#5291CE", ...)`'s colour. Update `alerts: one call per watched line…` if its `alertText` assertion relied on the old order.
- [ ] **Step 2: Run** `node --test test/alerts.test.js test/phone.test.js` — expected: the new tests FAIL (`alertTextFor is not a function`, then 360-char cut).
- [ ] **Step 3: Implement** `alertTextFor` in `src/pkjs/alerts.js` (UTF-8 length via `unescape(encodeURIComponent(s)).length`), export it; in `afterAlertRefresh` build `alertText` with it and add the colours; remove `MAX_ALERT_TEXT`.
- [ ] **Step 4: Run** `pnpm test` — expected: all pass.
- [ ] **Step 5: Commit** — `git commit -m "Alerts: send each line's messages whole, most urgent first, with its colours"` (CHANGELOG: refine the "Alertes trafic" entry — every disruption readable in full, the most urgent first).

### Task 2: watch — paged alert screen with the line banner

**Files:**
- Modify: `src/embeddedjs/main.js` (`STRINGS`, `handleAlertUpdate`, `describeScreen` alert branch, `MainBehavior.onPressSelect`, `step`)
- Test: `test/watch.test.js`

**Interfaces:**
- Consumes: Task 1's `alertUpdate` (`alertText` `\n`-separated, optional `lineColor`/`lineTextColor`).
- Produces: `lineAlerts` entries `{lineName, count, pages: string[], color, textColor}` (`pages = alertText ? alertText.split("\n") : []`, colours default `#888888`/`#ffffff`); module `let alertPage = 0`; string key `nextAlert` = fr `"Select : suivante"`, en `"Select: next"`.

- [ ] **Step 1: Write the failing tests** in `test/watch.test.js` (an `ALERT2` with `alertCount: 2`, `alertText: "Premier message\nSecond message"`, `lineColor: "#5291CE"`):
  - `an alert screen shows one message under the line banner, Select shows the next`: on the line screen `watch.screen()` is `["4  1/2", "Premier message", "Select : suivante"]` and `watch.bannerColor()` is `"#5291CE"`; `press("select")` → `["4  2/2", "Second message", "Select : suivante"]`; again → back to `1/2`.
  - `leaving the screen or new messages bring the alert back to its first page`: on page 2, `press("down")` then `press("up")` → page `1/2`; on page 2, deliver an `alertUpdate` with one message → `["4", "Nouveau"]` (no counter, no hint).
  - `Select still refreshes a stop`: on the stop screen `press("select")` sends a `refreshStop` (as the existing refresh tests check).
  - Update `a line with traffic info gets its own screen, and its stops say so` to the new layout (single message: `["4", ALERT.alertText]` stays valid — keep it passing).
- [ ] **Step 2: Run** `node --test test/watch.test.js` — expected: the new tests FAIL.
- [ ] **Step 3: Implement**: `handleAlertUpdate` stores pages and colours and resets `alertPage` to 0 when the line on screen is this line; `step()` resets `alertPage` to 0; `describeScreen` alert branch sets `model.banner = {color, textColor, text: pages.length > 1 ? \`${lineName}  ${alertPage + 1}/${pages.length}\` : lineName}`, `model.body = pages[Math.min(alertPage, pages.length - 1)]`, `model.footer = pages.length > 1 ? t("nextAlert") : ""`, no `title`; "Pas de perturbation" / "..." cases keep the banner and use `model.line`; `onPressSelect` on an alert item with 2+ pages advances `alertPage` (wrapping) and renders, otherwise `requestRefresh(true)` as today. Body and footer must not overlap on emery or gabbro: adjust `LAYOUT.body` top/height to sit under the 44 px banner and above the footer if needed.
- [ ] **Step 4: Run** `pnpm test` — expected: all pass. Build, install on the watch; user checks the RER B screen (banner colour, 1/4 → 4/4 with Select, full texts) and that stops still refresh with Select. Gabbro: `pebble install --emulator gabbro` + screenshot, no text cut by the circle.
- [ ] **Step 5: Commit** — `git commit -m "Watch: one traffic message per page under the line banner, Select for the next"`.

### Task 3: setting "Écrans sur la montre"

**Files:**
- Modify: `package.json` (`messageKeys` + `"screens"` at the end), `src/embeddedjs/main.js` (`ALL_MESSAGE_KEYS` + `"screens"`, `handleConfigItem`, `buildItemList`), `src/pkjs/index.js` (`normalizeConfig`, `configMeta`), `config/index.html` (select in the alerts section, i18n fr/en, `save()`, init), then `pnpm sync:config`
- Test: `test/watch.test.js`, `test/phone.test.js`, `test/message-keys.test.js` (unchanged, must pass)

**Interfaces:**
- Config JSON: `screens: "both" | "stops" | "alerts"`; `normalizeConfig` keeps `"stops"`/`"alerts"`, anything else → `"both"`.
- Wire: `configMeta.screens` = `0` both, `1` stops only, `2` alerts only. Watch: `let screensMode = 0`, set from `item.screens` (non-number → 0).
- Config page: `<select id="screens">`, label fr "Écrans sur la montre", options fr "Arrêts et alertes" / "Arrêts seulement" / "Alertes seulement" (en "Watch screens": "Stops and alerts" / "Stops only" / "Alerts only").

- [ ] **Step 1: Write the failing tests**:
  - `test/phone.test.js`: `the screens setting reaches the watch` — config `screens: "alerts"` → sent `configMeta.screens === 2`; config without `screens` → `0`.
  - `test/watch.test.js`: `stops only: no alert screen, the stop still says Info trafic` (`configItems([STOP], "fr", 0, {screens: 1})`, deliver `ALERT`: cycle is stop then Réglages, stop shows "Info trafic : 1"); `alerts only: every watched line has a screen, no stop screen` (`{screens: 2}`, no `alertUpdate` yet → first screen is the stop's line `"4"` with `"..."`, then `"Pas de perturbation"` after an `alertUpdate` with `alertCount: 0`; no stop screen in the cycle); `a config without the screens field shows stops and alerts` (existing behaviour).
- [ ] **Step 2: Run** `pnpm test` — expected: new tests FAIL.
- [ ] **Step 3: Implement**: key added to both lists in the same position; `normalizeConfig` + `configMeta.screens`; `buildItemList` skips stops when `screensMode === 2`, skips alert items when `screensMode === 1`, and when `screensMode === 2` adds every tracked stop's line (deduplicated with the alerts-section lines) whether or not it has messages; config page select (default "both"), `save()` field, init from `initial.screens`; `pnpm sync:config`.
- [ ] **Step 4: Run** `pnpm test`, `pnpm check:config`, lint — expected: pass. Build, install; user tries the three choices on the watch.
- [ ] **Step 5: Commit** — `git commit -m "Settings: choose the watch screens (stops, alerts, or both)"` with a CHANGELOG `### Nouveautés` entry: « Réglage « Écrans sur la montre » : arrêts et alertes, arrêts seulement ou alertes seulement. »
