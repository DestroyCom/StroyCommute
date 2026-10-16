# StroyCommute

Real-time next departures for Paris / Île-de-France public transport, right on
your wrist.

StroyCommute is a Pebble watchapp that shows the next metro, tram, RER and
Transilien departures for the stops you follow, using live data from
[PRIM](https://prim.iledefrance-mobilites.fr), the official Île-de-France
Mobilités API.

> StroyCommute is an independent project and is not affiliated with or endorsed
> by Île-de-France Mobilités, RATP or SNCF.

## Features

- **Live departures**: next departure plus the following one, in minutes, with
  "À quai" (at platform) and "Supprimé" (cancelled) states.
- **Metro, tram, RER and Transilien.** For RER/Transilien you can set an
  arrival stop (A → B): the watch then only shows trains that actually stop
  there, with their mission code (e.g. "SCAL"). Add the return trip in one
  tap.
- **Official line colors** on each departure board.
- **Clear error states** on the watch: network error, invalid API key,
  invalid stop, quota exceeded, and stops with no real-time data.
- **Quota-aware**: refreshes only the stop on screen, only while the app is
  open in the foreground, every 60 s (or on demand with Select). Switching
  screens only fetches when the data is over a minute old. A local counter
  shows how many PRIM requests are left today.
- **English and French.** The app follows your watch's language by default;
  you can force one in the settings.
- **Your API key stays on your phone.** It is never sent to the watch.

## Supported hardware

| Platform  | Device          | Status    |
| --------- | --------------- | --------- |
| `emery`   | Pebble Time 2   | Supported |
| `gabbro`  | Pebble Round 2  | Planned   |

## Getting started

### 1. Get a PRIM API key

1. Create a free account on
   [prim.iledefrance-mobilites.fr](https://prim.iledefrance-mobilites.fr).
2. Subscribe to the **"Prochains passages"** (stop-monitoring) API.
3. Generate an API key in your account settings.

New keys are limited to about **1,000 requests per day**, which is plenty for
normal use since the app only refreshes while it is open.

### 2. Configure the app

Open the StroyCommute settings from the Pebble mobile app (gear icon), then:

1. Paste your PRIM API key. It is checked live ("Valid key ✓").
2. Search for a stop (for example "Châtelet") and pick the line you want.
   - Metro/tram: each result is a single platform, so the direction is shown
     next to it.
   - RER/Transilien: search the arrival stop in the picker that appears, or
     tap **Skip** to follow every train.
3. If you set an arrival stop, you can tap **⇄ Add return** on the row to
   add the reverse trip.
4. Tap **Save**. The config is synced to the watch.

You can follow up to 8 items.

> **Upgrading from an earlier version?** RER/Transilien stops saved before
> this version used an identifier PRIM rejects (they always showed "Network
> error"). The settings page flags them in red: remove them and add them
> again.

### 3. On the watch

| Button      | Action                                  |
| ----------- | --------------------------------------- |
| Up / Down   | Switch between followed stops (loops)   |
| Select      | Refresh the current stop now            |
| Back        | Exit                                    |

The last screen shows the remaining PRIM quota for the day.

## How it works

```
┌──────────── Watch (embeddedjs) ────────────┐        ┌────────────── Phone (pkjs) ──────────────┐
│ Piu UI, 60 s foreground-only timer         │        │ Config page (webview), localStorage      │
│                                            │        │                                          │
│  refreshStop {stopRef, lineRef,            │        │  GET PRIM stop-monitoring (API key here) │
│              destStopRef?} ────────────────┼──────► │                                          │
│                                            │        │  parse SIRI Lite, filter, sort,          │
│  ◄─────────── departureUpdate {state,      │ ◄──────┤  UTC → minutes                           │
│               destination, minutes, ...}   │        │                                          │
└────────────────────────────────────────────┘        └──────────────────────────────────────────┘
```

- **Watch (`src/embeddedjs/`)**: an [Alloy](https://developer.repebble.com/guides/alloy/)
  app (Moddable SDK, Piu UI). It owns the refresh timer, since it is the only
  side that knows the app is in the foreground. It never talks to the network
  directly.
- **Phone (`src/pkjs/`)**: serves the config page, stores the config, fetches
  and parses PRIM data, and replies with small, flat AppMessages. Fetching on
  the phone avoids the watch's ~8 KB networking memory ceiling found during
  real-hardware testing.
- **Config page (`config/index.html`)**: stop/line search through the IDFM
  open-data `arrets-lignes` dataset, live API key check, and an arrival-stop
  picker for RER/Transilien stations.

More detail lives in [`docs/`](docs/): the PRIM payload reference, the
AppMessage protocol and Alloy pitfalls.

## Development

### Prerequisites

- [Pebble SDK](https://developer.repebble.com) with Alloy support (`pebble` CLI)
- Node.js ≥ 24 and [pnpm](https://pnpm.io)

### Commands

```bash
pnpm install                       # dev tooling + applies patches/ via patch-package
pnpm lint                          # Biome
pnpm format                        # Biome formatter

pebble build                       # build the .pbw
pebble install --emulator emery    # run in the Pebble Time 2 emulator
pebble install --cloudpebble       # install on a real watch (requires `pebble login`)
pebble logs                        # live logs from watch and phone
```

### Things to know before contributing

- **The config page is duplicated.** The pkjs bundler can't read files at
  runtime, so `config/index.html` is inlined verbatim as `CONFIG_HTML` in
  `src/pkjs/index.js`. Keep both identical, and don't use backticks or `${` in
  the HTML.
- **Message keys are duplicated too.** `pebble.messageKeys` in `package.json`
  and `ALL_MESSAGE_KEYS` in `src/embeddedjs/main.js` must have the same keys
  in the same order.
- **No `?.` in pkjs or embeddedjs.** The pkjs bundler (webpack 1) and the
  watch's XS engine don't reliably support it.
- **Working without spending quota**: set `DEV_FAKE_DEPARTURES = true` in
  `src/pkjs/index.js` to get fake departures. Never ship it enabled.
- **Translations** live in three places: `STRINGS` in
  `src/embeddedjs/main.js` (watch), `I18N` in `config/index.html` (config
  page) and `SUPPORTED_LANGUAGES` in `src/pkjs/index.js`. To add a language,
  add it to all three.
- **Traffic alerts are switched off** with `ALERTS_ENABLED = false`, in both
  `config/index.html` and `src/pkjs/index.js`.
- **Never commit an API key.** It is entered through the config page only.

## Privacy

- Your PRIM API key and your config stay in the Pebble app's storage on your
  phone.
- Network requests only go to `prim.iledefrance-mobilites.fr` (departures, key
  check) and `data.iledefrance-mobilites.fr` (stop/line search).
- No analytics or tracking, and no third-party server.

## Roadmap

- Traffic alerts for followed lines (PRIM `general-message`), with Pebble
  Timeline pins. The settings exist but are hidden until this is done.
- More languages.
- Pebble Round 2 (`gabbro`) support.
- Editing the arrival stop of a trip without re-adding it.

## Data & credits

Real-time and reference data provided by
[Île-de-France Mobilités](https://www.iledefrance-mobilites.fr) through
[PRIM](https://prim.iledefrance-mobilites.fr) and the
[IDFM open-data portal](https://data.iledefrance-mobilites.fr). Line colors
come from the IDFM line reference dataset.

## License

StroyCommute is free software, licensed under the
[GNU General Public License v3.0](LICENSE) (GPL-3.0-only).

You may use, study, modify and share it. If you distribute it or a modified
version, you must release the full source code under the same license and
keep the copyright and license notices.

## Privacy

See [PRIVACY.md](PRIVACY.md).
