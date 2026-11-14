# Changelog

StroyCommute's user-visible changes, version by version. Add each change
under `[Unreleased]`, as one sentence written for users, under the right
heading (New, Improvements, Fixes). The Release workflow moves this section
under the new version number and turns it into the GitHub release notes,
with a plain-text version to paste into the store.

## [Unreleased]

### New

- "Watch screens" setting: stops and alerts, stops only, or alerts only.
- "Lift the pause and refresh everything" button in the settings: ends the anti-quota pause and asks again for every time and alert right away.
- Traffic alerts: disruptions on the lines of your stops (and on lines you add) show on the watch, with one screen per disrupted line and a reminder on the stop's screen. Every disruption can be read in full, the most urgent first.
- Watch notification when a new disruption appears during your commute window (adjustable), as long as the app is open (the option to open it automatically when the window starts takes care of that), and disruptions and their end added to the timeline (option), including those already under way when you turn it on; the settings remind you to allow the timeline for the app in the Pebble app.
- Option to open the app automatically when your commute window starts.
- Your next departures can show on watchfaces that support Pebble plugins (preview to turn on in the Pebble app), with limited quota use. "Watchfaces" setting to turn it off.
- Pebble Round 2 support: layout adapted to the round screen.
- Vibration as the train approaches, from 1 to 10 minutes before departure ("Vibration" setting, off by default).
- The watch shows when the phone is disconnected, while keeping the last departure times on screen.
- **Diagnostics** section in the settings: errors the app runs into are recorded and can be copied to send to the developer.

### Improvements

- An unexpected error no longer closes the app: it is recorded and the app keeps working.
- Works with the latest versions of the Pebble app: network access to PRIM and to the IDFM stop search is declared.
- Lighter display on the watch: the screen is no longer fully redrawn on every update, which saves memory and battery.
- Fewer PRIM API calls: the same request made several times within a few seconds now costs only one call from your quota.
- The minutes until departure update by themselves every minute, and the next train takes over once the first has left.
- When the next departure is more than 10 minutes away, times are refreshed every 3 minutes instead of every minute: less battery and quota used.
- Line colours adjusted to the watch's screen, with text that is always readable on the banner.
- The PRIM quota shown on the watch is now the one PRIM reports, no longer an estimate.
- Trips with an arrival stop fit in the banner thanks to smaller text when it is long.

### Fixes

- Correcting the API key in the settings now updates the times, even if a request with the old key was under way.
- The line search in the settings finds "RER A", "Métro 4" or "Tram 3a", and accepts a single letter or digit ("A", "4"); each result shows the kind of line (RER, Transilien, Metro, Tram, Bus).
- The traffic alert screen of a line added without a stop shows the line's colour.
- Requests that fail because the phone has no connection no longer count towards the PRIM call limit, so being offline can't trigger the anti-quota pause.
- Opened while the phone is out of reach, the app says so instead of loading forever, and loads as soon as the phone is back.
- A train at the platform now shows before a train whose departure time has just passed.
- A train that has left no longer stays shown "at the platform" for two more minutes: the next one takes over a minute after its departure time.
- A stuck transfer between the watch and the phone can no longer freeze refreshes.
- A PRIM request that doesn't answer shows a network error after 10 seconds instead of hanging.
- Times received by the watch are sent again if it was busy, instead of being lost until the next refresh.
- Settings saved by an older version, or damaged, no longer stop the app from starting.
- With no stop configured, the watch says so and explains where to add one, instead of showing the Settings screen.

## [1.0.0]

- Première version publiée sur le store.
