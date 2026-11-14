# Alert screens: readable, ordered, and a choice of screens

Date: 2026-11-14. Branch `ccr-45b067c3-qsxdvl` (PR #3, traffic alerts not released yet).

## Why

Found while testing on a Pebble Time 2: a line's traffic-info screen is a
grey block of 14 px text under the bare line name, and it doesn't show
everything. pkjs caps each message at 280 characters, then joins all of a
line's messages and cuts the result at 360 characters with no ellipsis
(RER B, 4 messages: the 3rd stops at "les 14 et 15/", the 4th never
arrives), and the watch has no way to show more than about 11 lines.

The user wants to read the disruptions of every watched line, most
important first, in full, and to choose in the settings which screens the
watch shows.

## Goals

- Every message of a watched line can be read in full on the watch.
- Most important message first.
- The alert screen looks like the stop screens (line-coloured banner).
- A setting chooses the screens in the Up/Down cycle: stops and alerts
  (default, today's behaviour), stops only, alerts only.

## Non-goals

- No change to notifications, timeline pins, or how often alerts are
  checked.
- No free scrolling of a long text.

## Anti-goals

- A watch-side change that brings back "memory full" crashes. Every
  watch-side step is checked on the real watch, one at a time.

## Constraints

- Watch memory: no new `Style` objects (reuse the banner and the existing
  14 px body style); keep the per-line text bounded.
- One AppMessage per line (`alertUpdate`), flattened, no nested JSON. A new
  config field needs a new `messageKeys` entry, appended at the end of
  package.json's list and of `ALL_MESSAGE_KEYS` in the same order.
- PRIM gives no severity. Available: `InfoChannelRef` ("Perturbation",
  "Information", "Commercial"), `RecordedAtTime`, `ValidUntilTime`.
- Up/Down cycle the screens; Select refreshes a stop and is free on alert
  screens.

## Approaches

- A. One screen per message in the Up/Down cycle: simple, but the cycle
  grows fast (RER B + RER A = 7 more screens between the stops).
- **B. One screen per line, Select shows the next message (chosen).** Short
  cycle, each message whole on its own page, reuses existing UI pieces.
- C. One screen per line with scrolling text: more watch code (memory
  risk), messages cut across pages.

## Design (B)

**Order** (pkjs): "Perturbation" first, then "Information", then the rest;
within a channel, the message ending soonest first (`ValidUntilTime`; none
= last), usually the incident happening now rather than works announced
weeks ahead.

**Phone → watch**: `alertUpdate` carries the line's messages in that order,
each whole (280 characters at most each, as today), separated by `\n` (the
texts are flattened to one line already), with no 360-character cut. A cap
on the number of messages per line keeps the message bounded (builder's
call, e.g. 6). `lineColor`/`lineTextColor` are added (existing keys), from
the colours known for that line (a tracked stop of the same line, else the
alerts-section line if it has one, else the default grey).

**Watch, alert screen**:

```
┌──────────────────────┐
│▓▓ RER B        1/4 ▓▓│  line-coloured banner, page counter
│ Du 21 au 22 novembre │
│ inclus, le trafic    │  one whole message, 14 px
│ sera interrompu ...  │
│                      │
│  Select : suivante   │  only when there are 2+ messages
└──────────────────────┘
```

- Select shows the next message, wrapping after the last; the page goes
  back to 1/N when the screen is left or the line's messages change.
- One message: no counter, no hint. No message: "Pas de perturbation", as
  today.
- Round screen (Gabbro): same, within the existing round layout.

**Setting "Écrans sur la montre"** (config page, alerts section; FR/EN):
"Arrêts et alertes" (default) / "Arrêts seulement" / "Alertes seulement".
Sent in `configMeta`. Stops only: no alert screens, "Info trafic : N" stays
on the stop screens. Alerts only: only the line screens (alert checks run
as today). "Réglages" stays last in every case; with nothing to show, the
existing "nothing configured" screen. A missing value (older config) means
both.

## Left to the builder

- The message cap per line and the exact separator handling.
- Wording of the "next" hint and the counter's place in the banner.
- Tests: pkjs ordering and full texts (test/alerts.test.js,
  test/phone.test.js), watch paging and the setting (test/watch.test.js).
- CHANGELOG: refine the existing "Alertes trafic" entry (not released yet),
  add one for the new setting.
