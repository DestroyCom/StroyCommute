// CONFIG_HTML is inlined as a template string rather than read from disk
// via fs.readFileSync(). This project's pkjs bundler (webpack 1, bundled
// inside the Pebble SDK's waf build, see build/webpack/pkjs/webpack.config.js)
// treats "fs"/"path" as Node core externals, which at runtime resolve
// through a restricted require() shim (_message_key_wrapper.js) that only
// permits require("message_keys") and throws "Module not found" for
// anything else. Confirmed by instrumenting index.js with checkpoint
// console.log calls in the emulator: execution silently died between
// `require("fs")` and the next line, well before any Pebble.* listener
// ever ran. Keep config/index.html and this constant in sync by hand.
const CONFIG_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StroyCommute Settings</title>
<style>
  * { box-sizing: border-box; }
  html, body { background: #000; }
  body { font-family: sans-serif; margin: 0; padding: 12px; font-size: 16px; color: #eee; }
  h2 { margin: 4px 0 16px; color: #fff; }
  fieldset { border: 1px solid #333; border-radius: 8px; margin-bottom: 16px; padding: 12px; }
  legend { font-weight: bold; padding: 0 4px; color: #fff; }
  input[type="text"], input[type="time"] { width: 100%; font-size: 16px; padding: 8px; border: 1px solid #444; border-radius: 4px; margin-top: 4px; background: #111; color: #eee; }
  button { font-size: 15px; padding: 10px 14px; border: none; border-radius: 4px; background: #5555ff; color: white; }
  button.remove { background: #cc4444; padding: 8px 12px; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; padding: 10px; background: #1c1c22; border-radius: 6px; }
  .rowLabel { flex: 1; font-size: 15px; }
  .searchResults { border: 1px solid #444; border-radius: 4px; max-height: 220px; overflow-y: auto; margin-top: 4px; }
  .searchResultItem { padding: 10px; border-bottom: 1px solid #333; }
  .searchResultItem:last-child { border-bottom: none; }
  .searchResultItem:active { background: #26263a; }
  .searchStatus { padding: 8px; font-size: 0.9em; color: #999; }
  .keyStatus { font-size: 0.9em; margin-top: 6px; color: #999; }
  .lineSwatch { display: inline-block; width: 14px; height: 14px; border-radius: 3px; margin-right: 6px; vertical-align: middle; }
  .dayRow { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-bottom: 8px; }
  .dayRow label { display: inline-flex; align-items: center; gap: 4px; }
  .timeRow { display: flex; gap: 16px; flex-wrap: wrap; }
  .timeRow label { display: flex; flex-direction: column; font-size: 0.9em; flex: 1; min-width: 120px; }
  #itemCount { font-size: 0.9em; color: #999; }
</style>
</head>
<body>
  <h2>StroyCommute</h2>

  <fieldset>
    <legend>Clé API PRIM</legend>
    <input type="text" id="apiKey" placeholder="Clé API" autocorrect="off" autocapitalize="off" autocomplete="off" spellcheck="false" oninput="debounceValidateKey()">
    <div id="apiKeyStatus" class="keyStatus"></div>
  </fieldset>

  <fieldset>
    <legend>Arrêts suivis (départs)</legend>
    <div id="stopsList"></div>
    <input type="text" id="stopSearchInput" placeholder="Rechercher un arrêt (ex: Châtelet)" autocorrect="off" autocapitalize="off" autocomplete="off" spellcheck="false" oninput="debounceSearch('stop')" disabled>
    <div id="stopSearchResults" class="searchResults"></div>
  </fieldset>

  <fieldset>
    <legend>Lignes suivies (alertes trafic)</legend>
    <div id="linesList"></div>
    <input type="text" id="lineSearchInput" placeholder="Rechercher une ligne (ex: 4, RER A)" autocorrect="off" autocapitalize="off" autocomplete="off" spellcheck="false" oninput="debounceSearch('line')" disabled>
    <div id="lineSearchResults" class="searchResults"></div>
  </fieldset>

  <fieldset>
    <legend>Période de réception des alertes</legend>
    <div class="dayRow">
      <label><input type="checkbox" class="dayBox" value="1" checked> Lun</label>
      <label><input type="checkbox" class="dayBox" value="2" checked> Mar</label>
      <label><input type="checkbox" class="dayBox" value="3" checked> Mer</label>
      <label><input type="checkbox" class="dayBox" value="4" checked> Jeu</label>
      <label><input type="checkbox" class="dayBox" value="5" checked> Ven</label>
      <label><input type="checkbox" class="dayBox" value="6"> Sam</label>
      <label><input type="checkbox" class="dayBox" value="0"> Dim</label>
    </div>
    <div class="timeRow">
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
  var SEARCH_API = "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/arrets-lignes/records";
  var STOP_MONITORING_API = "https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring";
  // Châtelet / ligne 4 -- this project's own known-good, already
  // real-hardware-tested PRIM identifiers, reused here purely as a cheap
  // "does this API key actually work" ping (not a real stop lookup).
  var PING_STOP_REF = "STIF:StopPoint:Q:463158:";
  var PING_LINE_REF = "STIF:Line::C01374:";
  var searchTimers = {};
  var apiKeyValidateTimer = null;
  var apiKeyValidated = false;

  // Real IDFM per-line colors (colourweb_hexa/textcolourweb_hexa), keyed by
  // id_line -- fetched once from the "referentiel-des-lignes" open-data
  // dataset and hardcoded here, not fetched live: these never change, and
  // a live fetch per stop selection was an unnecessary network dependency
  // (it doesn't even hit PRIM/count against its quota, but still added
  // latency and a failure mode for no benefit). Covers metro (16), tram
  // (15) and rail/RER/Transilien (27) -- all currently "active" lines in
  // that dataset as of 2026-08-18. Bus lines (2000+, and not meaningfully
  // color-branded) fall back to the default gray/white badge instead.
  var LINE_COLORS = {
    "C01371": ["#ffbe00", "#000000"], // 1 (metro)
    "C01380": ["#dc9600", "#000000"], // 10 (metro)
    "C01381": ["#6e491e", "#ffffff"], // 11 (metro)
    "C01382": ["#00643c", "#ffffff"], // 12 (metro)
    "C01383": ["#82c8e6", "#000000"], // 13 (metro)
    "C01384": ["#640082", "#ffffff"], // 14 (metro)
    "C01372": ["#0055c8", "#ffffff"], // 2 (metro)
    "C01373": ["#6e6e00", "#ffffff"], // 3 (metro)
    "C01386": ["#82c8e6", "#000000"], // 3B (metro)
    "C01374": ["#a0006e", "#ffffff"], // 4 (metro)
    "C01375": ["#ff5a00", "#000000"], // 5 (metro)
    "C01376": ["#82dc73", "#000000"], // 6 (metro)
    "C01377": ["#ff82b4", "#000000"], // 7 (metro)
    "C01387": ["#82dc73", "#000000"], // 7B (metro)
    "C01378": ["#d282be", "#000000"], // 8 (metro)
    "C01379": ["#d2d200", "#000000"], // 9 (metro)
    "C01742": ["#eb2132", "#ffffff"], // A (rail)
    "C01743": ["#5091cb", "#ffffff"], // B (rail)
    "C01727": ["#ffcc30", "#000000"], // C (rail)
    "C00563": ["#5cc5ed", "#ffffff"], // CDG VAL (rail)
    "C01728": ["#008b5b", "#ffffff"], // D (rail)
    "C01729": ["#b94e9a", "#ffffff"], // E (rail)
    "C01737": ["#84653d", "#ffffff"], // H (rail)
    "C01739": ["#cec73d", "#000000"], // J (rail)
    "C01738": ["#9b9842", "#ffffff"], // K (rail)
    "C01740": ["#c4a4cc", "#000000"], // L (rail)
    "C01736": ["#00b297", "#ffffff"], // N (rail)
    "C01388": ["#5ec5ed", "#ffffff"], // ORLYVAL (rail)
    "C01730": ["#f58f53", "#000000"], // P (rail)
    "C01731": ["#f49fb3", "#000000"], // R (rail)
    "C01745": ["#aaaaaa", "#000000"], // TER Bourgogne - Franche-Comté (rail)
    "C02368": ["#aaaaaa", "#000000"], // TER Centre - Val de Loire (rail)
    "C01744": ["#aaaaaa", "#000000"], // TER Centre - Val de Loire (rail)
    "C01857": ["#aaaaaa", "#000000"], // TER Centre - Val-de-Loire (rail)
    "C01747": ["#aaaaaa", "#000000"], // TER Grand-Est (rail)
    "C01746": ["#aaaaaa", "#000000"], // TER Hauts-de-France (rail)
    "C01863": ["#aaaaaa", "#000000"], // TER Hauts-de-France (rail)
    "C02372": ["#aaaaaa", "#000000"], // TER Hauts-de-France (rail)
    "C02370": ["#aaaaaa", "#000000"], // TER Normandie (rail)
    "C02375": ["#aaaaaa", "#000000"], // TER Normandie (rail)
    "C01748": ["#aaaaaa", "#000000"], // TER Normandie (rail)
    "C01741": ["#b6134c", "#ffffff"], // U (rail)
    "C02711": ["#9f9825", "#ffffff"], // V (rail)
    "C01389": ["#0055c8", "#ffffff"], // T1 (tram)
    "C02528": ["#6e6e00", "#ffffff"], // T10 (tram)
    "C01999": ["#ff5a00", "#000000"], // T11 (tram)
    "C02529": ["#a50034", "#ffffff"], // T12 (tram)
    "C02344": ["#8d653d", "#ffffff"], // T13 (tram)
    "C02732": ["#00a092", "#ffffff"], // T14 (tram)
    "C01390": ["#a0006e", "#ffffff"], // T2 (tram)
    "C01391": ["#ff5a00", "#000000"], // T3a (tram)
    "C01679": ["#00643c", "#ffffff"], // T3b (tram)
    "C01843": ["#dc9600", "#000000"], // T4 (tram)
    "C01684": ["#640082", "#ffffff"], // T5 (tram)
    "C01794": ["#ff0000", "#ffffff"], // T6 (tram)
    "C01774": ["#6e491e", "#ffffff"], // T7 (tram)
    "C01795": ["#6e6e00", "#ffffff"], // T8 (tram)
    "C02317": ["#3c91dc", "#ffffff"], // T9 (tram)
  };

  // IDFM's public open-data stop/line search returns ids shaped like
  // "IDFM:C01374" (line) / "IDFM:463158" (stop point) -- a different
  // namespace from the PRIM real-time SIRI API's "STIF:Line::C01374:" /
  // "STIF:StopPoint:Q:463158:" that stop-monitoring actually requires.
  // Confirmed empirically (not guessed) that the numeric/code suffix after
  // the colon is identical between both namespaces for the same real
  // stop/line -- e.g. searching "Châtelet" + line "4" via this API returns
  // id "IDFM:C01374" and stop_id "IDFM:463158", which are exactly this
  // project's known-good, already-tested-on-real-hardware PRIM identifiers
  // once re-wrapped in the STIF format.
  //
  // NOTE: no template literals (backtick strings) anywhere in this file,
  // by necessity, not style -- this HTML is embedded verbatim inside a JS
  // template literal in src/pkjs/index.js (CONFIG_HTML); a literal
  // backtick or dollar-brace here would break out of or corrupt that
  // outer template literal.
  /**
   * @param {string} rawId - IDFM open-data id, e.g. "IDFM:C01374".
   * @param {"line"|"stop"} kind
   * @returns {string} The equivalent PRIM SIRI ref, e.g. "STIF:Line::C01374:".
   */
  function idfmIdToStif(rawId, kind) {
    var suffix = rawId.split(":")[1] || "";
    return kind === "line" ? "STIF:Line::" + suffix + ":" : "STIF:StopPoint:Q:" + suffix + ":";
  }

  /**
   * @param {string} str
   * @returns {string} str with HTML special characters escaped.
   */
  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  /** @param {boolean} enabled */
  function setSearchEnabled(enabled) {
    document.getElementById("stopSearchInput").disabled = !enabled;
    document.getElementById("lineSearchInput").disabled = !enabled;
  }

  // The stop/line search only resolves identifiers -- it can't tell a
  // working API key from a broken one. Gating search behind a real PRIM
  // ping (not just "is the field non-empty") is what lets the direction
  // disambiguation below (also a live PRIM call, see fetchDirection) fail
  // fast with a clear reason instead of every search silently going dark.
  /** Debounces a call to validateApiKey() for the current apiKey field value. */
  function debounceValidateKey() {
    apiKeyValidated = false;
    setSearchEnabled(false);
    clearTimeout(apiKeyValidateTimer);
    var key = document.getElementById("apiKey").value.trim();
    var statusEl = document.getElementById("apiKeyStatus");
    if (!key) {
      statusEl.textContent = "";
      return;
    }
    statusEl.textContent = "Vérification...";
    statusEl.style.color = "#999";
    apiKeyValidateTimer = setTimeout(() => validateApiKey(key), 500);
  }

  // Only a definitively wrong key (401/403) blocks search -- a quota hit
  // (429) or a network hiccup doesn't mean the key is bad, and locking the
  // whole stops/lines editor over a transient, unrelated PRIM condition
  // would make it impossible to fix or even just review your config while
  // waiting for the quota to reset. Search stays (or becomes) usable in
  // every case except a confirmed-invalid key.
  /**
   * Pings PRIM with key and updates the apiKeyStatus line + search
   * enabled/disabled state accordingly.
   * @param {string} key
   */
  function validateApiKey(key) {
    var statusEl = document.getElementById("apiKeyStatus");
    var url = STOP_MONITORING_API + "?MonitoringRef=" + encodeURIComponent(PING_STOP_REF) + "&LineRef=" + encodeURIComponent(PING_LINE_REF);
    fetch(url, { headers: { apiKey: key } })
      .then((res) => {
        // Stale response for a key the user already changed since this
        // request was fired -- ignore it, a newer validateApiKey call (or
        // none, if the field is now empty) already owns the status line.
        if (document.getElementById("apiKey").value.trim() !== key) return;
        if (res.status === 200) {
          apiKeyValidated = true;
          statusEl.textContent = "Clé valide ✓";
          statusEl.style.color = "#4caf50";
          setSearchEnabled(true);
        } else if (res.status === 401 || res.status === 403) {
          statusEl.textContent = "Clé invalide";
          statusEl.style.color = "#cc4444";
          setSearchEnabled(false);
        } else if (res.status === 429) {
          statusEl.textContent = "Quota PRIM atteint -- recherche activée quand même";
          statusEl.style.color = "#cc9944";
          setSearchEnabled(true);
        } else {
          statusEl.textContent = "Vérification impossible -- recherche activée quand même";
          statusEl.style.color = "#cc9944";
          setSearchEnabled(true);
        }
      })
      .catch(() => {
        if (document.getElementById("apiKey").value.trim() !== key) return;
        statusEl.textContent = "Erreur réseau -- recherche activée quand même";
        statusEl.style.color = "#cc9944";
        setSearchEnabled(true);
      });
  }

  // Resolves a line's real IDFM color/text-color for the badge shown on
  // the watch, from the static LINE_COLORS table above -- a plain
  // synchronous lookup, no network call (see LINE_COLORS' comment for why).
  /**
   * @param {string} fullLineId - IDFM open-data line id, e.g. "IDFM:C01374".
   * @returns {{color: string, textColor: string}} Hex colors (default gray
   *   for lines not in LINE_COLORS, e.g. buses).
   */
  function lineStyleFor(fullLineId) {
    var idLine = fullLineId.split(":")[1] || "";
    var entry = LINE_COLORS[idLine];
    return entry ? { color: entry[0], textColor: entry[1] } : { color: "#888888", textColor: "#ffffff" };
  }

  // Live-queries PRIM for the next real destination at one specific
  // stop_id+line -- used only to disambiguate search results that would
  // otherwise be indistinguishable (see groups/needsDirection in
  // renderResults below), not run for every result.
  /**
   * @param {string} apiKey
   * @param {string} stopRef - PRIM SIRI stop ref.
   * @param {string} lineRef - PRIM SIRI line ref.
   * @returns {Promise<string|null>} The next real destination, or null on
   *   any failure (no data, quota, network).
   */
  function fetchDirection(apiKey, stopRef, lineRef) {
    var url = STOP_MONITORING_API + "?MonitoringRef=" + encodeURIComponent(stopRef) + "&LineRef=" + encodeURIComponent(lineRef);
    return fetch(url, { headers: { apiKey: apiKey } })
      .then((res) => (res.status === 200 ? res.json() : null))
      .then((data) => {
        var delivery = data && data.Siri && data.Siri.ServiceDelivery.StopMonitoringDelivery[0];
        var visits = delivery && delivery.MonitoredStopVisit;
        if (!visits || visits.length === 0) return null;
        var dest = visits[0].MonitoredVehicleJourney.MonitoredCall.DestinationDisplay;
        return dest && dest[0] ? dest[0].value : null;
      })
      .catch(() => null);
  }

  // Debounced so a live search fires roughly once per pause in typing, not
  // once per keystroke -- this hits a real network API on every call.
  /** @param {"stop"|"line"} kind */
  function debounceSearch(kind) {
    clearTimeout(searchTimers[kind]);
    var inputEl = document.getElementById(kind + "SearchInput");
    var resultsEl = document.getElementById(kind + "SearchResults");
    var query = inputEl.value.trim();
    if (query.length < 2) {
      resultsEl.innerHTML = "";
      return;
    }
    searchTimers[kind] = setTimeout(() => {
      runSearch(kind, query);
    }, 300);
  }

  /**
   * Queries IDFM's arrets-lignes dataset and renders the results.
   * @param {"stop"|"line"} kind
   * @param {string} query
   */
  function runSearch(kind, query) {
    var resultsEl = document.getElementById(kind + "SearchResults");
    resultsEl.innerHTML = '<div class="searchStatus">Recherche...</div>';
    // Strip quotes from the query before building the API's "where" clause
    // -- avoids breaking the clause's own quoting, not a real injection
    // risk against a read-only public search endpoint, but cheap to do.
    var safeQuery = query.replace(/"/g, "");
    var field = kind === "stop" ? "stop_name" : "route_long_name";
    var url = SEARCH_API + "?where=" + encodeURIComponent(field + ' like "' + safeQuery + '"') + "&limit=" + (kind === "stop" ? 15 : 50);
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        renderResults(kind, data.results || []);
      })
      .catch(() => {
        resultsEl.innerHTML = '<div class="searchStatus">Erreur de recherche (vérifie ta connexion).</div>';
      });
  }

  /**
   * Renders arrets-lignes search results as clickable rows, disambiguating
   * same-name/same-line stop duplicates by direction (see fetchDirection).
   * @param {"stop"|"line"} kind
   * @param {object[]} results - Raw arrets-lignes API records.
   */
  function renderResults(kind, results) {
    var resultsEl = document.getElementById(kind + "SearchResults");
    var seen = {};
    var unique = [];
    if (kind === "line") {
      // Line search matches once per stop a line serves -- dedupe by line
      // id so the same line isn't listed dozens of times.
      results.forEach((r) => {
        if (!seen[r.id]) {
          seen[r.id] = true;
          unique.push(r);
        }
      });
      results = unique.slice(0, 15);
    }
    resultsEl.innerHTML = "";
    if (results.length === 0) {
      resultsEl.innerHTML = '<div class="searchStatus">Aucun résultat.</div>';
      return;
    }
    // A stop can have more than one stop_id for the exact same
    // stop_name+line -- one per physical platform/direction (confirmed
    // empirically: "Châtelet"+"4" returns two distinct stop_id's). Groups
    // of size > 1 are indistinguishable by label alone, so they get a real
    // PRIM-sourced direction appended below instead of guessed.
    var groups = {};
    if (kind === "stop") {
      results.forEach((r) => {
        var groupKey = r.stop_name + "|" + r.id;
        groups[groupKey] = (groups[groupKey] || 0) + 1;
      });
    }
    results.forEach((r) => {
      var div = document.createElement("div");
      div.className = "searchResultItem";
      var baseLabel = kind === "stop"
        ? r.stop_name + " — ligne " + r.route_long_name + " (" + r.mode + ", " + r.nom_commune + ")"
        : "Ligne " + r.route_long_name + " (" + r.mode + ", " + r.operatorname + ")";
      div.textContent = baseLabel;
      if (kind === "stop" && groups[r.stop_name + "|" + r.id] > 1) {
        div.textContent = baseLabel + " …";
        // A failed lookup (quota, network) must not silently fall back to
        // the plain, still-ambiguous baseLabel -- that leaves two
        // identical-looking rows with zero indication anything went wrong,
        // as if direction disambiguation just doesn't work. Say so instead.
        fetchDirection(document.getElementById("apiKey").value.trim(), idfmIdToStif(r.stop_id, "stop"), idfmIdToStif(r.id, "line")).then((destination) => {
          div.textContent = destination ? baseLabel + " → " + destination : baseLabel + " (direction indisponible, réessaie plus tard)";
        });
      }
      div.onclick = () => {
        if (kind === "stop") {
          addStopRow({
            stopRef: idfmIdToStif(r.stop_id, "stop"),
            stopName: r.stop_name,
            lineRef: idfmIdToStif(r.id, "line"),
            lineName: r.route_long_name,
            lineColor: lineStyleFor(r.id).color,
            lineTextColor: lineStyleFor(r.id).textColor
          });
        } else {
          addLineRow({
            lineRef: idfmIdToStif(r.id, "line"),
            lineName: r.route_long_name
          });
        }
        document.getElementById(kind + "SearchInput").value = "";
        resultsEl.innerHTML = "";
      };
      resultsEl.appendChild(div);
    });
  }

  // Values always come from a search result now (never free-typed), stored
  // as data-* attributes on the row rather than editable inputs -- this is
  // what makes a malformed/misspelled stopRef/lineRef structurally
  // impossible instead of merely validated after the fact.
  /**
   * @param {{stopRef: string, stopName: string, lineRef: string,
   *   lineName: string, lineColor?: string, lineTextColor?: string}} values
   */
  function addStopRow(values) {
    var div = document.createElement("div");
    div.className = "row stopRow";
    div.dataset.stopRef = values.stopRef;
    div.dataset.stopName = values.stopName;
    div.dataset.lineRef = values.lineRef;
    div.dataset.lineName = values.lineName;
    div.dataset.lineColor = values.lineColor || "#888888";
    div.dataset.lineTextColor = values.lineTextColor || "#ffffff";
    div.innerHTML =
      '<span class="rowLabel"><span class="lineSwatch" style="background:' + escapeHtml(div.dataset.lineColor) + '"></span>' +
      escapeHtml(values.lineName + " — " + values.stopName) + '</span>' +
      '<button type="button" class="remove" onclick="this.parentElement.remove(); updateCount();">x</button>';
    document.getElementById("stopsList").appendChild(div);
    updateCount();
  }

  /** @param {{lineRef: string, lineName: string}} values */
  function addLineRow(values) {
    var div = document.createElement("div");
    div.className = "row lineRow";
    div.dataset.lineRef = values.lineRef;
    div.dataset.lineName = values.lineName;
    div.innerHTML =
      '<span class="rowLabel">Ligne ' + escapeHtml(values.lineName) + '</span>' +
      '<button type="button" class="remove" onclick="this.parentElement.remove(); updateCount();">x</button>';
    document.getElementById("linesList").appendChild(div);
    updateCount();
  }

  /** Refreshes the "N / MAX_ITEMS éléments suivis" counter text. */
  function updateCount() {
    var count = document.querySelectorAll(".stopRow").length + document.querySelectorAll(".lineRow").length;
    document.getElementById("itemCount").textContent = count + " / " + MAX_ITEMS + " éléments suivis";
  }

  /** @returns {object[]} One entry per .stopRow, read from its dataset. */
  function collectStops() {
    var rows = document.querySelectorAll(".stopRow");
    var result = [];
    rows.forEach((row, i) => {
      result.push({
        id: "stop" + i,
        stopRef: row.dataset.stopRef,
        stopName: row.dataset.stopName,
        lineRef: row.dataset.lineRef,
        lineName: row.dataset.lineName,
        lineColor: row.dataset.lineColor,
        lineTextColor: row.dataset.lineTextColor
      });
    });
    return result;
  }

  /** @returns {object[]} One entry per .lineRow, read from its dataset. */
  function collectLines() {
    var rows = document.querySelectorAll(".lineRow");
    var result = [];
    rows.forEach((row) => {
      result.push({
        lineRef: row.dataset.lineRef,
        lineName: row.dataset.lineName
      });
    });
    return result;
  }

  /** Validates the form, then closes the webview with the config as JSON. */
  function save() {
    var stops = collectStops();
    var lines = collectLines();
    if (stops.length + lines.length === 0) {
      alert("Ajoute au moins un arrêt ou une ligne avant d'enregistrer.");
      return;
    }
    if (stops.length + lines.length > MAX_ITEMS) {
      alert("Maximum " + MAX_ITEMS + " éléments (arrêts + lignes) au total.");
      return;
    }
    if (!document.getElementById("apiKey").value.trim()) {
      alert("La clé API PRIM est requise.");
      return;
    }
    var days = [];
    document.querySelectorAll(".dayBox").forEach((box) => {
      if (box.checked) days.push(parseInt(box.value, 10));
    });
    var config = {
      apiKey: document.getElementById("apiKey").value.trim(),
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
    document.location = "pebblejs://close#" + encodeURIComponent(json);
  }

  // Pre-fill from whatever's already saved, if anything -- pkjs injects
  // this as window.__initialConfig right before this script tag (see
  // buildConfigDataUri() in src/pkjs/index.js). Without this the page
  // always looks empty on reopen even though a previous save worked fine.
  (() => {
    var initial = window.__initialConfig;
    if (!initial) return;
    document.getElementById("apiKey").value = initial.apiKey || "";
    if (initial.apiKey) validateApiKey(initial.apiKey);
    (initial.trackedStops || []).forEach((s) => {
      addStopRow({ stopRef: s.stopRef, stopName: s.stopName, lineRef: s.lineRef, lineName: s.lineName, lineColor: s.lineColor, lineTextColor: s.lineTextColor });
    });
    (initial.trackedLines || []).forEach((l) => {
      addLineRow({ lineRef: l.lineRef, lineName: l.lineName });
    });
    var days = (initial.alertSchedule && initial.alertSchedule.days) || [];
    document.querySelectorAll(".dayBox").forEach((box) => {
      box.checked = days.indexOf(parseInt(box.value, 10)) !== -1;
    });
    if (initial.alertSchedule) {
      document.getElementById("scheduleStart").value = initial.alertSchedule.startTime || "07:00";
      document.getElementById("scheduleEnd").value = initial.alertSchedule.endTime || "19:30";
    }
    document.getElementById("timelineEnabled").checked = !!initial.timelineEnabled;
  })();
</script>
</body>
</html>
`;
// Node's Buffer isn't available in this pkjs runtime either (confirmed by
// emulator testing — see CONFIG_HTML comment above), so base64-encode by
// hand: UTF-8 encode the string to bytes, then standard base64 those bytes.
/**
 * @param {string} str
 * @returns {string} Standard base64 encoding of `str`'s UTF-8 bytes.
 */
function utf8ToBase64(str) {
	const bytes = [];
	for (let i = 0; i < str.length; i++) {
		const code = str.codePointAt(i);
		if (code > 0xffff) i++; // consume the low surrogate too
		if (code < 0x80) {
			bytes.push(code);
		} else if (code < 0x800) {
			bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
		} else if (code < 0x10000) {
			bytes.push(
				0xe0 | (code >> 12),
				0x80 | ((code >> 6) & 0x3f),
				0x80 | (code & 0x3f)
			);
		} else {
			bytes.push(
				0xf0 | (code >> 18),
				0x80 | ((code >> 12) & 0x3f),
				0x80 | ((code >> 6) & 0x3f),
				0x80 | (code & 0x3f)
			);
		}
	}
	const chars =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let output = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i];
		const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
		const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
		output += chars[b0 >> 2];
		output += chars[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
		output +=
			b1 === undefined
				? "="
				: chars[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
		output += b2 === undefined ? "=" : chars[b2 & 63];
	}
	return output;
}

// Built fresh every time the config page opens (not a precomputed constant)
// so the page can be pre-filled with whatever's already saved -- otherwise
// reopening settings always looks empty even though the underlying save
// worked, which is confusing (a config page is not a form with server-side
// state; it has to be told what's already there). Injects a small inline
// script defining window.__initialConfig right after CONFIG_HTML's single
// <script> tag; config/index.html's own script reads that at the bottom to
// pre-populate the stop/line rows, apiKey, schedule, and timeline checkbox.
// `<` is escaped to < so a stop/line name or apiKey containing
// "</script" (astronomically unlikely from real IDFM data, but free to
// guard against) can't break out of the injected script tag.
/**
 * @returns {string} A `data:` URI for the config webview, pre-filled with
 *   whatever config is currently persisted (if any).
 */
function buildConfigDataUri() {
	const stored = localStorage.getItem("stroycommuteConfig");
	const initialConfig = stored ? JSON.parse(stored) : null;
	const injected = JSON.stringify(initialConfig).replace(/</g, "\\u003c");
	const html = CONFIG_HTML.replace(
		"<script>",
		`<script>window.__initialConfig = ${injected};`
	);
	return `data:text/html;charset=utf-8;base64,${utf8ToBase64(html)}`;
}

const moddableProxy = require("@moddable/pebbleproxy");

// Shared by the initial "ready" send and the Task 8b configResendRequest
// handler below -- both just need "resend whatever's currently persisted,
// if anything".
/** Resends whatever config is currently persisted in localStorage, if any. */
function sendStoredConfigToWatch() {
	const stored = localStorage.getItem("stroycommuteConfig");
	if (stored) sendConfigToWatch(JSON.parse(stored));
}

Pebble.addEventListener("ready", moddableProxy.readyReceived);
Pebble.addEventListener("appmessage", (e) => {
	if (moddableProxy.appMessageReceived(e)) return;
	if (e.payload.itemType === "refreshStop") {
		handleRefreshStop(e.payload);
	} else if (e.payload.itemType === "configResendRequest") {
		// Task 8b reconciliation: the watch didn't see a complete config
		// within its timeout and is asking for a fresh full resend. Reuse
		// sendConfigToWatch() as-is -- handleConfigItem already resets
		// pendingStops/pendingLines on a fresh configMeta, so a full resend
		// mid-session is safe.
		sendStoredConfigToWatch();
	}
});

Pebble.addEventListener("showConfiguration", () => {
	Pebble.openURL(buildConfigDataUri());
});

Pebble.addEventListener("webviewclosed", (e) => {
	if (!e.response) return;
	const config = JSON.parse(decodeURIComponent(e.response));
	localStorage.setItem("stroycommuteConfig", JSON.stringify(config));
	sendConfigToWatch(config);
});

/**
 * @param {string} hhmm - Time in "HH:MM" form, e.g. "07:30".
 * @returns {number} Minutes since midnight.
 */
function timeStringToMinutes(hhmm) {
	const [h, m] = hhmm.split(":").map(Number);
	return h * 60 + m;
}

/**
 * @param {number[]} days - Day-of-week numbers, 0 (Sunday) to 6 (Saturday).
 * @returns {number} Bitmask with bit `d` set for each day in `days`.
 */
function daysToBitmask(days) {
	let mask = 0;
	for (const d of days) mask |= 1 << d;
	return mask;
}

/**
 * Sends the full config (schedule + tracked stops/lines) to the watch as a
 * sequence of AppMessage items, one per stop/line plus a leading configMeta.
 * @param {object} config - Parsed stroycommuteConfig (apiKey, trackedStops,
 *   trackedLines, alertSchedule, timelineEnabled).
 */
function sendConfigToWatch(config) {
	const itemCount = 1 + config.trackedStops.length + config.trackedLines.length;

	const items = [
		{
			itemIndex: 0,
			itemCount: itemCount,
			itemType: "configMeta",
			scheduleDaysBitmask: daysToBitmask(config.alertSchedule.days),
			scheduleStartMinutes: timeStringToMinutes(config.alertSchedule.startTime),
			scheduleEndMinutes: timeStringToMinutes(config.alertSchedule.endTime),
			timelineEnabled: config.timelineEnabled ? 1 : 0,
		},
	];

	config.trackedStops.forEach((stop, i) => {
		items.push({
			itemIndex: 1 + i,
			itemCount: itemCount,
			itemType: "configStop",
			stopRef: stop.stopRef,
			lineRef: stop.lineRef,
			lineName: stop.lineName,
			stopName: stop.stopName,
			lineColor: stop.lineColor || "#888888",
			lineTextColor: stop.lineTextColor || "#ffffff",
		});
	});

	config.trackedLines.forEach((line, i) => {
		items.push({
			itemIndex: 1 + config.trackedStops.length + i,
			itemCount: itemCount,
			itemType: "configLine",
			lineRef: line.lineRef,
			lineName: line.lineName,
		});
	});

	// Fired back-to-back with no ack-waiting originally; emulator testing
	// (Task 5 Step 5) showed that drops real messages — the watch received
	// only 1 of 3 sends, and even that one came back with zero decodable
	// keys. Chaining each send's ack callback into the next fixed it.
	sendItemsSequentially(items, 0);
}

const MAX_SEND_RETRIES = 3;

// Task 8b: root-caused via instrumented logging (10-run emulator repro, see
// task-8b-report.md) that pkjs's ack for item N can fire and trigger item
// N+1's sendAppMessage within single-digit milliseconds -- faster than the
// watch's embeddedjs side can drain one AppMessage inbox item via its own
// onReadable/read() cycle before the next write lands. Confirmed cases: the
// watch's onReadable fired twice for the same itemIndex (received item N+1
// but never N) and cases where an item's onReadable simply never fired at
// all while the very next item's did moments later -- both consistent with
// a single-slot inbound buffer silently overwritten by a faster-than-drain
// write, mirroring the already-known single-slot *outbound* constraint
// (Message.write() throwing back-to-back, see docs/pebble-alloy/SKILL.md).
// This delay gives the watch time to fully process one item before pkjs
// fires the next. Verified with 200ms in a clean, contamination-free
// 10-run emulator repro (single "ready" listener, no localStorage
// dependency): 0/10 first-attempt losses, vs. 2/10 in a same-methodology
// 10-run baseline at 0ms -- see task-8b-report.md.
const CONFIG_SEND_GAP_MS = 200;

/**
 * Sends `items[index]` via Pebble.sendAppMessage, then recurses to the next
 * item after a fixed gap once acked (see CONFIG_SEND_GAP_MS), retrying the
 * same item up to MAX_SEND_RETRIES times on failure before giving up on it.
 * @param {object[]} items
 * @param {number} index
 * @param {number} [retriesLeft]
 */
function sendItemsSequentially(items, index, retriesLeft) {
	if (index >= items.length) return;
	if (retriesLeft === undefined) retriesLeft = MAX_SEND_RETRIES;
	Pebble.sendAppMessage(
		items[index],
		() => {
			setTimeout(
				() => sendItemsSequentially(items, index + 1),
				CONFIG_SEND_GAP_MS
			);
		},
		() => {
			if (retriesLeft > 0) {
				sendItemsSequentially(items, index, retriesLeft - 1);
			} else {
				console.log(
					"sendAppMessage: giving up on item " +
						index +
						" after " +
						MAX_SEND_RETRIES +
						" retries"
				);
				sendItemsSequentially(items, index + 1);
			}
		}
	);
}

Pebble.addEventListener("ready", sendStoredConfigToWatch);

// --- Departures — PRIM stop-monitoring fetch/parse/convert ---
//
// Moved here from embeddedjs (originally speced watch-side, proxied by
// @moddable/pebbleproxy): real-hardware testing found combining a real
// ~150-char PRIM query string with a real 32-char API key in one embeddedjs
// fetch() reliably crashed with fxAbort memory full — a fixed, non-growable
// ~8KB XS chunk pool on the pebble/emery Alloy host, confirmed on real
// hardware (see docs/pebble-idfm-prim/SKILL.md and
// .superpowers/sdd/2026-08-17-stroycommute-scaffold/progress.md). pkjs has
// native XMLHttpRequest (same API @moddable/pebbleproxy's own proxy.js uses
// for its phone-side leg) and a much larger memory budget, so the fetch,
// SIRI Lite parsing, and UTC→minutes conversion all live here now. The API
// key is read from localStorage (already persisted by webviewclosed above)
// rather than carried on the wire — the watch never sees it.

// pkjs has full Date support — this is why the UTC->minutes conversion
// lives here, not in embeddedjs (see idfm-api-reference.md's UTC gotcha).
/**
 * @param {object} call - A SIRI MonitoredCall.
 * @returns {number|null} Minutes from now until the call's best available
 *   time field, or null if none of them are usable. Real-hardware evidence
 *   (the "undefined min" bug): `ExpectedArrivalTime` is absent on some real
 *   PRIM calls -- e.g. a bus/tram still at its origin stop, which only
 *   reports a departure time -- which previously produced NaN here. NaN
 *   isn't a valid AppMessage tuple value; pkjs's sendAppMessage silently
 *   dropped the "minutes" key rather than throwing, so the watch decoded a
 *   `state: "ok"` update with no minutes field at all -- rendering the
 *   literal string "undefined min". Falling back across the other SIRI time
 *   fields, and returning null instead of NaN when truly none are present,
 *   fixes it at the source: the caller sends `state: "noRealtimeData"`
 *   instead (an already-handled UI state) rather than a broken "ok".
 */
function callMinutesRemaining(call) {
	const timeField =
		call.ExpectedArrivalTime ||
		call.ExpectedDepartureTime ||
		call.AimedArrivalTime ||
		call.AimedDepartureTime;
	if (!timeField) return null;
	const expected = new Date(timeField);
	const minutes = Math.round((expected.getTime() - Date.now()) / 60000);
	return Number.isNaN(minutes) ? null : minutes;
}

// Dev-only escape hatch: real PRIM calls are quota-limited (a handful of
// requests can exhaust a day's quota), which otherwise blocks all
// front-end/UI iteration whenever the quota's already spent. When true,
// skips the real fetch and replies with plausible fabricated data instead
// -- exercises the exact same refreshStop -> departureUpdate AppMessage
// round-trip the real path uses, just without hitting PRIM. Must be false
// for any real/shipped build.
const DEV_FAKE_DEPARTURES = false;

// Quota tracking, for the watch's settings screen ("Quota PRIM: N
// restant(s)"). PRIM doesn't expose a "remaining calls" endpoint, so this
// is a local count of requests this app itself made -- an approximation,
// not the account's true server-side quota (e.g. a shared key used by
// another app wouldn't be reflected), but the best available without one.
// 1000/day matches docs/idfm-api-reference.md's documented default for
// tokens generated after March 2024 (re-verify at the portal if this ever
// looks wrong for a given key).
const PRIM_DAILY_QUOTA = 1000;
let lastQuotaRemaining = null;

/** @returns {string} Today's date as YYYY-MM-DD (UTC). */
function todayUtc() {
	return new Date().toISOString().slice(0, 10);
}

/**
 * Increments today's persisted PRIM request counter (reset when the UTC
 * date rolls over) and returns the remaining quota.
 * @returns {number} Requests remaining today, floored at 0.
 */
function recordPrimRequestAndGetQuotaRemaining() {
	const today = todayUtc();
	const stored = localStorage.getItem("stroycommuteQuota");
	let state = stored ? JSON.parse(stored) : null;
	if (!state || state.date !== today) state = { date: today, count: 0 };
	state.count += 1;
	localStorage.setItem("stroycommuteQuota", JSON.stringify(state));
	return Math.max(0, PRIM_DAILY_QUOTA - state.count);
}

/**
 * Fabricates a plausible "ok" departureUpdate for `stopRef`, for UI
 * iteration when PRIM's quota is exhausted. See DEV_FAKE_DEPARTURES.
 * @param {string} stopRef
 * @param {string} lineName
 */
function sendFakeDepartureUpdate(stopRef, lineName) {
	const minutes = 1 + Math.floor(Math.random() * 15);
	sendDepartureUpdate(stopRef, "ok", {
		lineName: lineName,
		destination: "Terminus (donnée factice)",
		minutes: minutes,
		minutes2: minutes + 3 + Math.floor(Math.random() * 10),
		atStop: false,
		cancelled: false,
	});
}

/**
 * Handles a watch-sent `refreshStop` request: fetches live PRIM data for
 * one stop+line and replies with a `departureUpdate` AppMessage (or a fake
 * one, see DEV_FAKE_DEPARTURES).
 * @param {{stopRef: string, lineRef: string, lineName: string}} request
 */
function handleRefreshStop(request) {
	if (DEV_FAKE_DEPARTURES) {
		sendFakeDepartureUpdate(request.stopRef, request.lineName);
		return;
	}

	const stored = localStorage.getItem("stroycommuteConfig");
	const apiKey = stored ? JSON.parse(stored).apiKey : "";

	const url =
		"https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring" +
		"?MonitoringRef=" +
		encodeURIComponent(request.stopRef) +
		"&LineRef=" +
		encodeURIComponent(request.lineRef);

	const xhr = new XMLHttpRequest();
	xhr.open("GET", url, true);
	xhr.setRequestHeader("apiKey", apiKey);
	xhr.onload = () => {
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
			const visits =
				json.Siri.ServiceDelivery.StopMonitoringDelivery[0].MonitoredStopVisit;

			if (!visits || visits.length === 0) {
				sendDepartureUpdate(request.stopRef, "noRealtimeData");
				return;
			}

			const call = visits[0].MonitoredVehicleJourney.MonitoredCall;
			const cancelled = call.DepartureStatus === "cancelled";
			const atStop = call.VehicleAtStop === true;
			const minutes = atStop ? -1 : callMinutesRemaining(call);

			// callMinutesRemaining returns null when PRIM gave this call no
			// usable time field at all (see its doc comment) -- send the
			// already-handled "no real-time data" state rather than an "ok"
			// update missing its "minutes" field (the "undefined min" bug).
			if (minutes === null) {
				sendDepartureUpdate(request.stopRef, "noRealtimeData");
				return;
			}

			// visits[] for one specific stop_id+line is a real, direction-stable
			// SIRI stop-monitoring result (a stop_id is one physical
			// platform/direction, see idfmIdToStif in CONFIG_HTML) -- so a
			// second entry is genuinely the following vehicle on the same
			// route+direction, not a different branch. Only sent when PRIM
			// actually returned one (small stops sometimes don't) AND it has a
			// usable time field -- omitted, not sent as null/NaN, when it
			// doesn't (the watch already treats a missing minutes2 as "no
			// following departure known").
			const extra = {
				lineName: request.lineName,
				destination: call.DestinationDisplay
					? call.DestinationDisplay[0].value
					: "",
				minutes: minutes,
				atStop: atStop,
				cancelled: cancelled,
			};
			if (visits.length > 1) {
				const call2 = visits[1].MonitoredVehicleJourney.MonitoredCall;
				const minutes2 =
					call2.VehicleAtStop === true ? -1 : callMinutesRemaining(call2);
				if (minutes2 !== null) extra.minutes2 = minutes2;
			}

			sendDepartureUpdate(request.stopRef, "ok", extra);
		} catch (error) {
			console.log("departureUpdate parse error: " + error);
			sendDepartureUpdate(request.stopRef, "network");
		}
	};
	xhr.onerror = () => {
		sendDepartureUpdate(request.stopRef, "network");
	};
	lastQuotaRemaining = recordPrimRequestAndGetQuotaRemaining();
	xhr.send();
}

/**
 * Sends a `departureUpdate` AppMessage to the watch for one stop.
 * @param {string} stopRef
 * @param {"ok"|"network"|"noRealtimeData"|"quotaExceeded"} state
 * @param {object} [extra] - Extra fields (lineName, destination, minutes,
 *   minutes2, atStop, cancelled) merged in when `state` is "ok".
 */
function sendDepartureUpdate(stopRef, state, extra) {
	const payload = Object.assign(
		{
			itemType: "departureUpdate",
			stopRef: stopRef,
			state: state,
		},
		extra || {}
	);
	// Attached to every reply regardless of state (including error states --
	// a request against the quota was made either way) so the watch's
	// settings screen always reflects the latest known count.
	if (lastQuotaRemaining !== null) payload.quotaRemaining = lastQuotaRemaining;
	Pebble.sendAppMessage(payload);
}
