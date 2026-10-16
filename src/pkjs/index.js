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
<html lang="fr">
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
  select { width: 100%; font-size: 16px; padding: 8px; border: 1px solid #444; border-radius: 4px; background: #111; color: #eee; }
  input[type="text"], input[type="time"] { width: 100%; font-size: 16px; padding: 8px; border: 1px solid #444; border-radius: 4px; margin-top: 4px; background: #111; color: #eee; }
  button { font-size: 15px; padding: 10px 14px; border: none; border-radius: 4px; background: #5555ff; color: white; }
  button.remove { background: #cc4444; padding: 8px 12px; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; padding: 10px; background: #1c1c22; border-radius: 6px; }
  .rowLabel { flex: 1; font-size: 15px; }
  .searchResults { border: 1px solid #444; border-radius: 4px; max-height: 360px; overflow-y: auto; margin-top: 4px; }
  .groupHeader { position: sticky; top: 0; padding: 8px 10px; background: #1c1c22; font-weight: bold; color: #fff; border-bottom: 1px solid #333; }
  .groupTown { font-weight: normal; font-size: 0.85em; color: #999; margin-left: 6px; }
  .resultLine { display: flex; align-items: center; gap: 10px; }
  .lineBadge { flex: none; min-width: 38px; max-width: 84px; padding: 3px 6px; border-radius: 4px; text-align: center; font-weight: bold; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .resultText { flex: 1; min-width: 0; }
  .resultMode { font-size: 0.8em; color: #999; text-transform: uppercase; letter-spacing: 0.04em; }
  .resultDirection { display: block; font-size: 0.95em; color: #ddd; margin-top: 1px; }
  .resultDirection.muted { color: #888; font-size: 0.85em; }
  details.help { margin-top: 10px; font-size: 0.9em; color: #ccc; }
  details.help summary { color: #8aa4ff; padding: 4px 0; }
  details.help ol { margin: 6px 0 0; padding-left: 20px; }
  details.help li { margin-bottom: 6px; }
  details.help a { color: #8aa4ff; }
  .searchResultItem { padding: 10px; border-bottom: 1px solid #333; }
  .searchResultItem:last-child { border-bottom: none; }
  .searchResultItem:active { background: #26263a; }
  .searchStatus { padding: 8px; font-size: 0.9em; color: #999; }
  .directionPicker { border: 1px solid #5555ff; border-radius: 6px; padding: 10px; margin-top: 6px; background: #14141c; }
  .directionPicker .pickerButtons { display: flex; gap: 8px; margin-top: 8px; }
  .rowDirections { display: block; font-size: 0.85em; color: #aaa; margin-top: 2px; }
  .rowWarning { display: block; font-size: 0.85em; color: #cc4444; margin-top: 2px; }
  .keyStatus { font-size: 0.9em; margin-top: 6px; color: #999; }
  .lineSwatch { display: inline-block; width: 14px; height: 14px; border-radius: 3px; margin-right: 6px; vertical-align: middle; }
  .dayRow { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-bottom: 8px; }
  .dayRow label { display: inline-flex; align-items: center; gap: 4px; }
  .timeRow { display: flex; gap: 16px; flex-wrap: wrap; }
  .timeRow label { display: flex; flex-direction: column; font-size: 0.9em; flex: 1; min-width: 120px; }
  #itemCount { font-size: 0.9em; color: #999; }
  input[type="number"] { width: 100%; font-size: 16px; padding: 8px; border: 1px solid #444; border-radius: 4px; margin-top: 4px; background: #111; color: #eee; }
  .returnButton { background: #444; padding: 8px 10px; font-size: 13px; }
</style>
</head>
<body>
  <h2>StroyCommute</h2>

  <fieldset>
    <legend data-i18n="languageLegend">Langue</legend>
    <select id="language" onchange="onLanguageChange()">
      <option value="auto" data-i18n="languageAuto">Automatique (langue de la montre)</option>
      <option value="fr">Français</option>
      <option value="en">English</option>
    </select>
  </fieldset>

  <fieldset>
    <legend data-i18n="apiKeyLegend">Clé API PRIM</legend>
    <input type="text" id="apiKey" data-i18n-placeholder="apiKeyPlaceholder" placeholder="Clé API" autocorrect="off" autocapitalize="off" autocomplete="off" spellcheck="false" oninput="debounceValidateKey()">
    <div id="apiKeyStatus" class="keyStatus"></div>
    <details class="help">
      <summary data-i18n="keyHelpTitle">Comment obtenir une clé API PRIM ?</summary>
      <ol>
        <li data-i18n-html="keyHelp1"></li>
        <li data-i18n-html="keyHelp2"></li>
        <li data-i18n-html="keyHelp3"></li>
        <li data-i18n-html="keyHelp4"></li>
      </ol>
      <div class="searchStatus" data-i18n="keyHelpNote"></div>
    </details>
  </fieldset>

  <fieldset>
    <legend data-i18n="stopsLegend">Arrêts suivis (départs)</legend>
    <div id="stopsList"></div>
    <input type="text" id="stopSearchInput" data-i18n-placeholder="stopSearchPlaceholder" placeholder="Rechercher un arrêt (ex : Châtelet)" autocorrect="off" autocapitalize="off" autocomplete="off" spellcheck="false" oninput="debounceSearch('stop')" disabled>
    <div id="stopSearchResults" class="searchResults"></div>
    <div id="directionPicker"></div>
  </fieldset>

  <!-- Traffic alerts aren't implemented yet (fetchLineAlerts() is a stub on
       the watch) -- hidden until they are, see ALERTS_ENABLED below. -->
  <div id="alertsSection" hidden>
    <fieldset>
      <legend data-i18n="linesLegend">Lignes suivies (alertes trafic)</legend>
      <div id="linesList"></div>
      <input type="text" id="lineSearchInput" data-i18n-placeholder="lineSearchPlaceholder" placeholder="Rechercher une ligne (ex : 4, RER A)" autocorrect="off" autocapitalize="off" autocomplete="off" spellcheck="false" oninput="debounceSearch('line')" disabled>
      <div id="lineSearchResults" class="searchResults"></div>
    </fieldset>

    <fieldset>
      <legend data-i18n="scheduleLegend">Période de réception des alertes</legend>
      <div class="dayRow">
        <label><input type="checkbox" class="dayBox" value="1" checked> <span data-i18n="dayMon">Lun</span></label>
        <label><input type="checkbox" class="dayBox" value="2" checked> <span data-i18n="dayTue">Mar</span></label>
        <label><input type="checkbox" class="dayBox" value="3" checked> <span data-i18n="dayWed">Mer</span></label>
        <label><input type="checkbox" class="dayBox" value="4" checked> <span data-i18n="dayThu">Jeu</span></label>
        <label><input type="checkbox" class="dayBox" value="5" checked> <span data-i18n="dayFri">Ven</span></label>
        <label><input type="checkbox" class="dayBox" value="6"> <span data-i18n="daySat">Sam</span></label>
        <label><input type="checkbox" class="dayBox" value="0"> <span data-i18n="daySun">Dim</span></label>
      </div>
      <div class="timeRow">
        <label><span data-i18n="scheduleStart">Début</span> <input type="time" id="scheduleStart" value="07:00"></label>
        <label><span data-i18n="scheduleEnd">Fin</span> <input type="time" id="scheduleEnd" value="19:30"></label>
      </div>
    </fieldset>

    <fieldset>
      <legend>Timeline</legend>
      <label><input type="checkbox" id="timelineEnabled"> <span data-i18n="timelineLabel">Ajouter les infos IDFM (ex : fin d'incident) à la timeline</span></label>
    </fieldset>
  </div>

  <fieldset>
    <legend data-i18n="guardLegend">Garde-fou appels PRIM</legend>
    <div class="searchStatus" data-i18n="guardHint">Après N appels en W minutes, plus aucun appel pendant P minutes. N = 0 : désactivé.</div>
    <div class="timeRow">
      <label><span data-i18n="guardMaxCalls">N (appels max)</span> <input type="number" id="guardMaxCalls" min="0" step="1" value="40"></label>
      <label><span data-i18n="guardWindow">W (minutes)</span> <input type="number" id="guardWindow" min="1" step="1" value="10"></label>
      <label><span data-i18n="guardPause">P (pause, minutes)</span> <input type="number" id="guardPause" min="1" step="1" value="15"></label>
    </div>
  </fieldset>

  <p id="itemCount"></p>
  <button type="button" onclick="save()" data-i18n="save">Enregistrer</button>

<script>
  var MAX_ITEMS = 8;
  // Traffic alerts (followed lines, schedule, timeline) aren't implemented
  // on the watch yet: their section stays hidden and no line is saved.
  var ALERTS_ENABLED = false;

  // UI strings. Keep the language list in sync with SUPPORTED_LANGUAGES in
  // src/pkjs/index.js and STRINGS in src/embeddedjs/main.js. "{name}"
  // placeholders are filled by tf() -- never "$" + "{...}", see the
  // no-template-literal note further down.
  var I18N = {
    fr: {
      languageLegend: "Langue",
      languageAuto: "Automatique (langue de la montre)",
      apiKeyLegend: "Clé API PRIM",
      apiKeyPlaceholder: "Clé API",
      keyHelpTitle: "Comment obtenir une clé API PRIM ?",
      keyHelp1: 'Crée un compte gratuit sur <a href="https://prim.iledefrance-mobilites.fr" target="_blank" rel="noopener">prim.iledefrance-mobilites.fr</a> (Île-de-France Mobilités) et confirme ton adresse e-mail.',
      keyHelp2: "Connecte-toi, ouvre le catalogue d'APIs et choisis « Prochains passages » (à un arrêt ou sur une ligne).",
      keyHelp3: "Souscris à cette API : c'est gratuit, aucun paiement n'est demandé.",
      keyHelp4: "Dans les paramètres de ton compte, génère ta clé API (jeton), copie-la et colle-la dans le champ ci-dessus.",
      keyHelpNote: "La clé reste sur ton téléphone : elle n'est jamais envoyée à la montre. Une nouvelle clé est limitée à environ 1 000 requêtes par jour. Les libellés du portail PRIM peuvent changer.",
      modeRapidTransit: "RER",
      modeLocalTrain: "Transilien",
      modeMetro: "Métro",
      modeTramway: "Tram",
      modeBus: "Bus",
      directionLoading: "direction…",
      pickArrivalHint: "tu choisiras ton arrêt d'arrivée ensuite",
      stopsLegend: "Arrêts suivis (départs)",
      stopSearchPlaceholder: "Rechercher un arrêt (ex : Châtelet)",
      linesLegend: "Lignes suivies (alertes trafic)",
      lineSearchPlaceholder: "Rechercher une ligne (ex : 4, RER A)",
      scheduleLegend: "Période de réception des alertes",
      dayMon: "Lun", dayTue: "Mar", dayWed: "Mer", dayThu: "Jeu", dayFri: "Ven", daySat: "Sam", daySun: "Dim",
      scheduleStart: "Début",
      scheduleEnd: "Fin",
      timelineLabel: "Ajouter les infos IDFM (ex : fin d'incident) à la timeline",
      save: "Enregistrer",
      keyChecking: "Vérification...",
      keyValid: "Clé valide ✓",
      keyInvalid: "Clé invalide",
      keyQuota: "Quota PRIM atteint -- recherche activée quand même",
      keyUnverified: "Vérification impossible -- recherche activée quand même",
      keyNetwork: "Erreur réseau -- recherche activée quand même",
      arrivalQuestion: "{line} — {stop} : arrêt d'arrivée ? (optionnel)",
      arrivalPlaceholder: "Rechercher l'arrêt d'arrivée (ex : Issy)",
      arrivalSkip: "Passer -- tous les trains",
      arrivalSame: "L'arrêt d'arrivée doit être différent de l'arrêt de départ.",
      addReturn: "⇄ Ajouter le retour",
      allTrains: "tous les trains",
      guardLegend: "Garde-fou appels PRIM",
      guardHint: "Après N appels en W minutes, plus aucun appel pendant P minutes. N = 0 : désactivé.",
      guardMaxCalls: "N (appels max)",
      guardWindow: "W (minutes)",
      guardPause: "P (pause, minutes)",
      guardInvalid: "Garde-fou : N doit être 0 ou au moins 2, W et P au moins 1.",
      add: "Ajouter",
      cancel: "Annuler",
      searching: "Recherche...",
      searchError: "Erreur de recherche (vérifie ta connexion).",
      noResults: "Aucun résultat.",
      lineResult: "Ligne {line} ({mode}, {operator})",
      directionUnavailable: "(direction indisponible, réessaie plus tard)",
      alreadyTracked: "Ce trajet est déjà suivi.",
      brokenRow: "Arrêt invalide (ancienne version) -- supprime-le et ré-ajoute-le",
      lineRow: "Ligne {line}",
      itemCount: "{count} / {max} éléments suivis",
      needItem: "Ajoute au moins un arrêt avant d'enregistrer.",
      tooMany: "{max} éléments maximum au total.",
      keyRequired: "La clé API PRIM est requise."
    },
    en: {
      languageLegend: "Language",
      languageAuto: "Automatic (watch language)",
      apiKeyLegend: "PRIM API key",
      apiKeyPlaceholder: "API key",
      keyHelpTitle: "How do I get a PRIM API key?",
      keyHelp1: 'Create a free account on <a href="https://prim.iledefrance-mobilites.fr" target="_blank" rel="noopener">prim.iledefrance-mobilites.fr</a> (Île-de-France Mobilités) and confirm your e-mail address.',
      keyHelp2: "Sign in, open the API catalog and pick \"Prochains passages\" (next departures at a stop or on a line).",
      keyHelp3: "Subscribe to that API: it is free, no payment is asked.",
      keyHelp4: "In your account settings, generate your API key (token), copy it and paste it in the field above.",
      keyHelpNote: "The key stays on your phone: it is never sent to the watch. A new key is limited to about 1,000 requests per day. PRIM portal labels may change.",
      modeRapidTransit: "RER",
      modeLocalTrain: "Transilien",
      modeMetro: "Metro",
      modeTramway: "Tram",
      modeBus: "Bus",
      directionLoading: "direction…",
      pickArrivalHint: "you will pick your arrival stop next",
      stopsLegend: "Followed stops (departures)",
      stopSearchPlaceholder: "Search a stop (e.g. Châtelet)",
      linesLegend: "Followed lines (traffic alerts)",
      lineSearchPlaceholder: "Search a line (e.g. 4, RER A)",
      scheduleLegend: "Alert schedule",
      dayMon: "Mon", dayTue: "Tue", dayWed: "Wed", dayThu: "Thu", dayFri: "Fri", daySat: "Sat", daySun: "Sun",
      scheduleStart: "Start",
      scheduleEnd: "End",
      timelineLabel: "Add IDFM notices (e.g. end of disruption) to the timeline",
      save: "Save",
      keyChecking: "Checking...",
      keyValid: "Valid key ✓",
      keyInvalid: "Invalid key",
      keyQuota: "PRIM quota reached -- search enabled anyway",
      keyUnverified: "Couldn't check the key -- search enabled anyway",
      keyNetwork: "Network error -- search enabled anyway",
      arrivalQuestion: "{line} — {stop}: arrival stop? (optional)",
      arrivalPlaceholder: "Search the arrival stop (e.g. Issy)",
      arrivalSkip: "Skip -- all trains",
      arrivalSame: "The arrival stop must differ from the boarding stop.",
      addReturn: "⇄ Add return",
      allTrains: "all trains",
      guardLegend: "PRIM call guard",
      guardHint: "After N calls within W minutes, no call for P minutes. N = 0: disabled.",
      guardMaxCalls: "N (max calls)",
      guardWindow: "W (minutes)",
      guardPause: "P (pause, minutes)",
      guardInvalid: "Call guard: N must be 0 or at least 2, W and P at least 1.",
      add: "Add",
      cancel: "Cancel",
      searching: "Searching...",
      searchError: "Search failed (check your connection).",
      noResults: "No results.",
      lineResult: "Line {line} ({mode}, {operator})",
      directionUnavailable: "(direction unavailable, try again later)",
      alreadyTracked: "This trip is already followed.",
      brokenRow: "Invalid stop (older version) -- remove it and add it again",
      lineRow: "Line {line}",
      itemCount: "{count} / {max} items followed",
      needItem: "Add at least one stop before saving.",
      tooMany: "{max} items maximum in total.",
      keyRequired: "The PRIM API key is required."
    }
  };
  var lang = "en";

  /**
   * @param {string} key - An I18N entry.
   * @returns {string} The string in the current language.
   */
  function t(key) {
    return I18N[lang][key] || I18N.en[key] || key;
  }

  /**
   * @param {string} key - An I18N entry with "{name}" placeholders.
   * @param {Object<string, string|number>} vars
   * @returns {string}
   */
  function tf(key, vars) {
    return t(key).replace(/[{]([a-zA-Z]+)[}]/g, (match, name) => (name in vars ? String(vars[name]) : match));
  }

  /**
   * @param {string} choice - The language select's value ("auto", "fr", "en").
   * @returns {string} An I18N language code. "auto" follows the watch's
   *   language as resolved by pkjs (window.__watchLanguage), then the
   *   webview's own.
   */
  function resolveLanguage(choice) {
    if (I18N[choice]) return choice;
    var locale = window.__watchLanguage || navigator.language || "";
    var code = locale.slice(0, 2).toLowerCase();
    return I18N[code] ? code : "en";
  }

  /** Translates every static [data-i18n] / [data-i18n-placeholder] element. */
  function applyStaticTranslations() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    // Trusted static strings only (they may carry a link) -- never user data.
    document.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
  }

  /** Re-renders the whole page (static text and rows) in the selected language. */
  function onLanguageChange() {
    lang = resolveLanguage(document.getElementById("language").value);
    applyStaticTranslations();
    var stops = collectStops();
    var lines = collectLines();
    document.getElementById("stopsList").innerHTML = "";
    document.getElementById("linesList").innerHTML = "";
    stops.forEach(addStopRow);
    lines.forEach(addLineRow);
    updateCount();
    if (keyStatus) setKeyStatus(keyStatus.key, keyStatus.color);
  }

  // Last API key status shown, so a language switch can re-translate it
  // without spending another PRIM request on re-validating the key.
  var keyStatus = null;

  /**
   * @param {string} key - An I18N entry, or "" to clear the status line.
   * @param {string} [color]
   */
  function setKeyStatus(key, color) {
    var statusEl = document.getElementById("apiKeyStatus");
    keyStatus = key ? { key: key, color: color } : null;
    statusEl.textContent = key ? t(key) : "";
    statusEl.style.color = color || "#999";
  }
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
  // Exception: SNCF-operated rail stops (RER, Transilien) aren't exposed
  // per platform in this dataset but per stop area, with ids shaped like
  // "IDFM:monomodalStopPlace:43135" (documented by IDFM: RER/Transilien
  // stops are "zones d'arrêt", every other mode uses "arrêts de
  // référence"). PRIM wants those as "STIF:StopArea:SP:43135:" -- which is
  // also what PRIM's own docs recommend for SNCF stops anyway, since SNCF
  // only feeds a fictitious platform standing for the whole station.
  // Taking parts[1] blindly here used to produce
  // "STIF:StopPoint:Q:monomodalStopPlace:", which PRIM rejects -- every RER
  // stop showed "Erreur réseau" on the watch.
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
    var parts = rawId.split(":");
    var suffix = parts[parts.length - 1] || "";
    if (kind === "line") return "STIF:Line::" + suffix + ":";
    if (parts[1] === "monomodalStopPlace") return "STIF:StopArea:SP:" + suffix + ":";
    return "STIF:StopPoint:Q:" + suffix + ":";
  }

  /**
   * @param {string} stopRef - PRIM SIRI stop ref.
   * @returns {boolean} True for a stop area (both directions mixed in one
   *   PRIM reply), false for a single platform/direction.
   */
  function isStopArea(stopRef) {
    return stopRef.indexOf("STIF:StopArea:") === 0;
  }

  // Configs saved before the monomodalStopPlace fix above carry this
  // unrecoverable ref (the numeric id was dropped at conversion time).
  /** @param {string} stopRef */
  function isBrokenStopRef(stopRef) {
    return /:monomodalStopPlace:$/.test(stopRef);
  }

  /**
   * @param {object} journey - A SIRI MonitoredVehicleJourney.
   * @returns {string} Best available destination label, "" if none.
   */
  function journeyDestinationName(journey) {
    var candidates = [journey.MonitoredCall && journey.MonitoredCall.DestinationDisplay, journey.DestinationName, journey.DirectionName];
    for (let i = 0; i < candidates.length; i++) {
      const list = candidates[i];
      if (list && list[0] && list[0].value) return list[0].value;
    }
    return "";
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
    if (!key) {
      setKeyStatus("");
      return;
    }
    setKeyStatus("keyChecking", "#999");
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
    var url = STOP_MONITORING_API + "?MonitoringRef=" + encodeURIComponent(PING_STOP_REF) + "&LineRef=" + encodeURIComponent(PING_LINE_REF);
    fetch(url, { headers: { apiKey: key } })
      .then((res) => {
        // Stale response for a key the user already changed since this
        // request was fired -- ignore it, a newer validateApiKey call (or
        // none, if the field is now empty) already owns the status line.
        if (document.getElementById("apiKey").value.trim() !== key) return;
        if (res.status === 200) {
          apiKeyValidated = true;
          setKeyStatus("keyValid", "#4caf50");
          setSearchEnabled(true);
        } else if (res.status === 401 || res.status === 403) {
          setKeyStatus("keyInvalid", "#cc4444");
          setSearchEnabled(false);
        } else if (res.status === 429) {
          setKeyStatus("keyQuota", "#cc9944");
          setSearchEnabled(true);
        } else {
          setKeyStatus("keyUnverified", "#cc9944");
          setSearchEnabled(true);
        }
      })
      .catch(() => {
        if (document.getElementById("apiKey").value.trim() !== key) return;
        setKeyStatus("keyNetwork", "#cc9944");
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
        return journeyDestinationName(visits[0].MonitoredVehicleJourney) || null;
      })
      .catch(() => null);
  }

  // A stop area (RER/Transilien) returns every train of the line, both
  // directions mixed -- the user picks the stop they get off at, and pkjs
  // keeps only trains calling at A then B (see filterVisitsServingStop in
  // src/pkjs/trips.js). Search is restricted to the same line.
  /**
   * Shows the arrival-stop search for a stop area result, then adds the row.
   * @param {object} values - Same shape as addStopRow's argument, plus
   *   rawLineId (open-data line id, e.g. "IDFM:C01727").
   */
  function openArrivalPicker(values) {
    var pickerEl = document.getElementById("directionPicker");
    var box = document.createElement("div");
    box.className = "directionPicker";
    var title = document.createElement("div");
    title.textContent = tf("arrivalQuestion", { line: values.lineName, stop: values.stopName });
    box.appendChild(title);
    var input = document.createElement("input");
    input.type = "text";
    input.placeholder = t("arrivalPlaceholder");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocomplete", "off");
    input.spellcheck = false;
    box.appendChild(input);
    var results = document.createElement("div");
    results.className = "searchResults";
    box.appendChild(results);
    var timer = null;
    input.oninput = () => {
      clearTimeout(timer);
      var query = input.value.trim();
      if (query.length < 2) {
        results.innerHTML = "";
        return;
      }
      timer = setTimeout(() => searchArrival(values, query, results, pickerEl), 300);
    };
    var buttons = document.createElement("div");
    buttons.className = "pickerButtons";
    var skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.textContent = t("arrivalSkip");
    skipBtn.onclick = () => {
      finishStopRow(values, "", "", pickerEl);
    };
    var cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "remove";
    cancelBtn.textContent = t("cancel");
    cancelBtn.onclick = () => {
      pickerEl.innerHTML = "";
    };
    buttons.appendChild(skipBtn);
    buttons.appendChild(cancelBtn);
    box.appendChild(buttons);
    pickerEl.innerHTML = "";
    pickerEl.appendChild(box);
    input.focus();
  }

  /**
   * Searches stops of values.rawLineId matching query and renders them
   * into resultsEl; picking one finishes the row.
   * @param {object} values
   * @param {string} query
   * @param {Element} resultsEl
   * @param {Element} pickerEl
   */
  function searchArrival(values, query, resultsEl, pickerEl) {
    resultsEl.innerHTML = '<div class="searchStatus">' + escapeHtml(t("searching")) + '</div>';
    var safeQuery = query.replace(/"/g, "");
    var where = 'id = "' + values.rawLineId.replace(/"/g, "") + '" and stop_name like "' + safeQuery + '"';
    fetch(SEARCH_API + "?where=" + encodeURIComponent(where) + "&limit=15")
      .then((res) => res.json())
      .then((data) => {
        var seen = {};
        var stops = (data.results || []).filter((r) => {
          if (seen[r.stop_id]) return false;
          seen[r.stop_id] = true;
          return true;
        });
        resultsEl.innerHTML = "";
        if (stops.length === 0) {
          resultsEl.innerHTML = '<div class="searchStatus">' + escapeHtml(t("noResults")) + '</div>';
          return;
        }
        stops.forEach((r) => {
          var div = document.createElement("div");
          div.className = "searchResultItem";
          div.textContent = r.stop_name + " (" + r.nom_commune + ")";
          div.onclick = () => {
            var destStopRef = idfmIdToStif(r.stop_id, "stop");
            if (destStopRef === values.stopRef) {
              alert(t("arrivalSame"));
              return;
            }
            finishStopRow(values, destStopRef, r.stop_name, pickerEl);
          };
          resultsEl.appendChild(div);
        });
      })
      .catch(() => {
        resultsEl.innerHTML = '<div class="searchStatus">' + escapeHtml(t("searchError")) + '</div>';
      });
  }

  /**
   * Adds the row with its arrival (or none), unless already tracked.
   * @param {object} values
   * @param {string} destStopRef - "" for all trains.
   * @param {string} destStopName - "" for all trains.
   * @param {Element} pickerEl
   */
  function finishStopRow(values, destStopRef, destStopName, pickerEl) {
    if (findStopRow(values.stopRef, values.lineRef, destStopRef)) {
      alert(t("alreadyTracked"));
      return;
    }
    values.destStopRef = destStopRef;
    values.destStopName = destStopName;
    addStopRow(values);
    pickerEl.innerHTML = "";
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
    resultsEl.innerHTML = '<div class="searchStatus">' + escapeHtml(t("searching")) + '</div>';
    // Strip quotes from the query before building the API's "where" clause
    // -- avoids breaking the clause's own quoting, not a real injection
    // risk against a read-only public search endpoint, but cheap to do.
    var safeQuery = query.replace(/"/g, "");
    var field = kind === "stop" ? "stop_name" : "route_long_name";
    var url = SEARCH_API + "?where=" + encodeURIComponent(field + ' like "' + safeQuery + '"') + "&limit=" + (kind === "stop" ? STOP_RESULTS_FETCHED : 50);
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        renderResults(kind, data.results || []);
      })
      .catch(() => {
        resultsEl.innerHTML = '<div class="searchStatus">' + escapeHtml(t("searchError")) + '</div>';
      });
  }

  // A big interchange matches dozens of stop+line records, mostly buses
  // (Denfert-Rochereau: 46, RER B only 22nd) -- fetch them all and list
  // rail first so RER/metro never fall past the visible cut.
  var STOP_RESULTS_FETCHED = 100;
  var STOP_RESULTS_SHOWN = 20;
  var MODE_RANK = { RapidTransit: 0, LocalTrain: 0, Metro: 1, Tramway: 2 };

  /**
   * @param {object[]} results - Raw arrets-lignes stop records.
   * @returns {object[]} Same records, rail first, then metro, tram, the
   *   rest (bus...); API order kept within a mode.
   */
  function sortStopResults(results) {
    var rank = (r) => (r.mode in MODE_RANK ? MODE_RANK[r.mode] : 3);
    return results
      .map((r, i) => ({ r: r, i: i }))
      .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
      .map((x) => x.r);
  }

  // Direction (next real destination) per stop platform + line, from PRIM.
  // Cached for the page's lifetime: a platform's direction doesn't change,
  // and every miss costs one PRIM request. Failures aren't cached so a later
  // render can retry.
  var directionCache = {};
  var directionPending = {};

  /**
   * @param {string} stopRef - PRIM SIRI stop ref.
   * @param {string} lineRef - PRIM SIRI line ref.
   * @returns {Promise<string|null>} The platform's direction, null if unknown.
   */
  function getDirection(stopRef, lineRef) {
    var key = stopRef + "|" + lineRef;
    if (directionCache[key]) return Promise.resolve(directionCache[key]);
    var apiKey = document.getElementById("apiKey").value.trim();
    if (!directionPending[key]) {
      directionPending[key] = fetchDirection(apiKey, stopRef, lineRef).then((destination) => {
        delete directionPending[key];
        if (destination) directionCache[key] = destination;
        return destination;
      });
    }
    return directionPending[key];
  }

  /**
   * @param {string} mode - arrets-lignes "mode" (Metro, Tramway, Bus...).
   * @returns {string} Human label, falling back to the raw mode.
   */
  function modeLabel(mode) {
    var key = "mode" + mode;
    return I18N[lang][key] || I18N.en[key] || mode || "";
  }

  // Result rows get their direction lazily, when scrolled into view: a
  // search can match 20+ platforms and every lookup is a PRIM request.
  var directionObserver = null;

  /**
   * Fills a result row's direction line once the row is (about to be)
   * visible.
   * @param {Element} row
   * @param {Element} directionEl
   * @param {string} stopRef
   * @param {string} lineRef
   */
  function loadDirectionWhenVisible(row, directionEl, stopRef, lineRef) {
    var load = () => {
      getDirection(stopRef, lineRef).then((destination) => {
        if (destination) {
          directionEl.textContent = "→ " + destination;
          directionEl.className = "resultDirection";
        } else {
          directionEl.textContent = t("directionUnavailable");
        }
      });
    };
    if (directionObserver) {
      row.__loadDirection = load;
      directionObserver.observe(row);
    } else {
      load();
    }
  }

  /**
   * @param {object[]} results - Raw arrets-lignes stop records, in display order.
   * @returns {{key: string, stop: string, town: string, items: object[]}[]}
   *   The records grouped by stop name + town, first appearance first.
   */
  function groupStopResults(results) {
    var order = [];
    var byKey = {};
    results.forEach((r) => {
      var key = r.stop_name + "|" + (r.nom_commune || "");
      if (!byKey[key]) {
        byKey[key] = { key: key, stop: r.stop_name, town: r.nom_commune || "", items: [] };
        order.push(byKey[key]);
      }
      byKey[key].items.push(r);
    });
    return order;
  }

  /**
   * Turns a stop result into the values addStopRow() takes.
   * @param {object} r - Raw arrets-lignes record.
   */
  function stopValuesFromResult(r) {
    var style = lineStyleFor(r.id);
    return {
      stopRef: idfmIdToStif(r.stop_id, "stop"),
      stopName: r.stop_name,
      lineRef: idfmIdToStif(r.id, "line"),
      lineName: r.route_long_name,
      lineColor: style.color,
      lineTextColor: style.textColor,
      rawLineId: r.id
    };
  }

  /** @param {object} r - Called when a stop result row is tapped. */
  function onStopResultPicked(r) {
    var values = stopValuesFromResult(r);
    if (isStopArea(values.stopRef)) {
      openArrivalPicker(values);
    } else if (findStopRow(values.stopRef, values.lineRef, "")) {
      // The watch keys departures by stop+line+arrival, so a duplicate row
      // would just show the same board twice.
      alert(t("alreadyTracked"));
    } else {
      addStopRow(values);
    }
    document.getElementById("stopSearchInput").value = "";
    document.getElementById("stopSearchResults").innerHTML = "";
  }

  /**
   * One stop result: coloured line badge, mode, and the direction (metro and
   * tram platforms are only told apart by where they go).
   * @param {object} r - Raw arrets-lignes record.
   * @returns {Element}
   */
  function buildStopResultRow(r) {
    var style = lineStyleFor(r.id);
    var stopRef = idfmIdToStif(r.stop_id, "stop");
    var div = document.createElement("div");
    div.className = "searchResultItem resultLine";
    var badge = document.createElement("span");
    badge.className = "lineBadge";
    badge.textContent = r.route_long_name;
    badge.title = r.route_long_name;
    badge.style.background = style.color;
    badge.style.color = style.textColor;
    var text = document.createElement("span");
    text.className = "resultText";
    var mode = document.createElement("span");
    mode.className = "resultMode";
    mode.textContent = modeLabel(r.mode);
    var directionEl = document.createElement("span");
    directionEl.className = "resultDirection muted";
    text.appendChild(mode);
    text.appendChild(directionEl);
    div.appendChild(badge);
    div.appendChild(text);
    if (isStopArea(stopRef)) {
      directionEl.textContent = t("pickArrivalHint");
    } else if (r.mode === "Metro" || r.mode === "Tramway") {
      directionEl.textContent = t("directionLoading");
      loadDirectionWhenVisible(div, directionEl, stopRef, idfmIdToStif(r.id, "line"));
    }
    div.onclick = () => onStopResultPicked(r);
    return div;
  }

  /**
   * Renders arrets-lignes search results, stops grouped by name.
   * @param {"stop"|"line"} kind
   * @param {object[]} results - Raw arrets-lignes API records.
   */
  function renderResults(kind, results) {
    var resultsEl = document.getElementById(kind + "SearchResults");
    if (directionObserver) directionObserver.disconnect();
    directionObserver = null;
    if (kind === "stop" && "IntersectionObserver" in window) {
      directionObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            directionObserver.unobserve(entry.target);
            if (entry.target.__loadDirection) entry.target.__loadDirection();
          });
        },
        { root: resultsEl }
      );
    }
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
    } else {
      results = sortStopResults(results).slice(0, STOP_RESULTS_SHOWN);
    }
    resultsEl.innerHTML = "";
    if (results.length === 0) {
      resultsEl.innerHTML = '<div class="searchStatus">' + escapeHtml(t("noResults")) + '</div>';
      return;
    }
    if (kind === "stop") {
      groupStopResults(results).forEach((group) => {
        var header = document.createElement("div");
        header.className = "groupHeader";
        header.appendChild(document.createTextNode(group.stop));
        if (group.town) {
          const town = document.createElement("span");
          town.className = "groupTown";
          town.textContent = group.town;
          header.appendChild(town);
        }
        resultsEl.appendChild(header);
        group.items.forEach((r) => {
          resultsEl.appendChild(buildStopResultRow(r));
        });
      });
      return;
    }
    results.forEach((r) => {
      var div = document.createElement("div");
      div.className = "searchResultItem";
      div.textContent = tf("lineResult", { line: r.route_long_name, mode: r.mode, operator: r.operatorname });
      div.onclick = () => {
        addLineRow({
          lineRef: idfmIdToStif(r.id, "line"),
          lineName: r.route_long_name
        });
        document.getElementById("lineSearchInput").value = "";
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
   * @param {string} stopRef
   * @param {string} lineRef
   * @param {string} destStopRef - "" for a row without arrival.
   * @returns {Element|null} The existing .stopRow for this trip, if any.
   */
  function findStopRow(stopRef, lineRef, destStopRef) {
    var rows = document.querySelectorAll(".stopRow");
    for (let i = 0; i < rows.length; i++) {
      const d = rows[i].dataset;
      if (d.stopRef === stopRef && d.lineRef === lineRef && (d.destStopRef || "") === destStopRef) return rows[i];
    }
    return null;
  }

  /**
   * @param {{stopRef: string, stopName: string, lineRef: string,
   *   lineName: string, lineColor?: string, lineTextColor?: string,
   *   destStopRef?: string, destStopName?: string}} values
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
    div.dataset.destStopRef = values.destStopRef || "";
    div.dataset.destStopName = values.destStopName || "";
    div.dataset.directionName = values.directionName || "";
    var detail = "";
    var needsDirection = false;
    if (isBrokenStopRef(values.stopRef)) {
      detail = '<span class="rowWarning">' + escapeHtml(t("brokenRow")) + '</span>';
    } else if (isStopArea(values.stopRef)) {
      detail = '<span class="rowDirections">→ ' + escapeHtml(div.dataset.destStopName || t("allTrains")) + '</span>';
    } else {
      // Metro/tram/bus platform: the direction is what tells two platforms of
      // the same stop apart, same role as the arrival stop for RER rows.
      detail = '<span class="rowDirections directionLine">' + (div.dataset.directionName ? "→ " + escapeHtml(div.dataset.directionName) : "") + '</span>';
      needsDirection = !div.dataset.directionName;
    }
    var returnButton = div.dataset.destStopRef
      ? '<button type="button" class="returnButton" onclick="addReturnRow(this.parentElement)">' + escapeHtml(t("addReturn")) + '</button>'
      : "";
    div.innerHTML =
      '<span class="rowLabel"><span class="lineSwatch" style="background:' + escapeHtml(div.dataset.lineColor) + '"></span>' +
      escapeHtml(values.lineName + " — " + values.stopName) + detail + '</span>' + returnButton +
      '<button type="button" class="remove" onclick="this.parentElement.remove(); updateCount();">x</button>';
    document.getElementById("stopsList").appendChild(div);
    updateCount();
    if (needsDirection) fillRowDirection(div);
  }

  /**
   * Looks the platform's direction up (one PRIM request, cached) and shows
   * it on the row; stored in the row so it is saved with the config and
   * older saved rows get it filled in the next time the page is opened.
   * @param {Element} row - A .stopRow without a direction.
   */
  function fillRowDirection(row) {
    getDirection(row.dataset.stopRef, row.dataset.lineRef).then((destination) => {
      if (!destination || !row.isConnected) return;
      row.dataset.directionName = destination;
      var el = row.querySelector(".directionLine");
      if (el) el.textContent = "→ " + destination;
    });
  }

  /**
   * Adds the reversed trip (arrival becomes boarding) of an existing row.
   * @param {Element} row - A .stopRow with a destStopRef.
   */
  function addReturnRow(row) {
    var d = row.dataset;
    if (collectStops().length + collectLines().length >= MAX_ITEMS) {
      alert(tf("tooMany", { max: MAX_ITEMS }));
      return;
    }
    if (findStopRow(d.destStopRef, d.lineRef, d.stopRef)) {
      alert(t("alreadyTracked"));
      return;
    }
    addStopRow({
      stopRef: d.destStopRef,
      stopName: d.destStopName,
      lineRef: d.lineRef,
      lineName: d.lineName,
      lineColor: d.lineColor,
      lineTextColor: d.lineTextColor,
      destStopRef: d.stopRef,
      destStopName: d.stopName
    });
  }

  /** @param {{lineRef: string, lineName: string}} values */
  function addLineRow(values) {
    var div = document.createElement("div");
    div.className = "row lineRow";
    div.dataset.lineRef = values.lineRef;
    div.dataset.lineName = values.lineName;
    div.innerHTML =
      '<span class="rowLabel">' + escapeHtml(tf("lineRow", { line: values.lineName })) + '</span>' +
      '<button type="button" class="remove" onclick="this.parentElement.remove(); updateCount();">x</button>';
    document.getElementById("linesList").appendChild(div);
    updateCount();
  }

  /** Refreshes the "N / MAX_ITEMS items followed" counter text. */
  function updateCount() {
    var count = collectStops().length + collectLines().length;
    document.getElementById("itemCount").textContent = tf("itemCount", { count: count, max: MAX_ITEMS });
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
        lineTextColor: row.dataset.lineTextColor,
        destStopRef: row.dataset.destStopRef || "",
        destStopName: row.dataset.destStopName || "",
        directionName: row.dataset.directionName || ""
      });
    });
    return result;
  }

  /**
   * @returns {object[]} One entry per .lineRow, read from its dataset --
   *   always empty while ALERTS_ENABLED is false, so lines saved by an
   *   older version are dropped on the next save.
   */
  function collectLines() {
    var rows = ALERTS_ENABLED ? document.querySelectorAll(".lineRow") : [];
    var result = [];
    rows.forEach((row) => {
      result.push({
        lineRef: row.dataset.lineRef,
        lineName: row.dataset.lineName
      });
    });
    return result;
  }

  /** @returns {{maxCalls: number, windowMinutes: number, pauseMinutes: number}|null} null if invalid. */
  function collectCallGuard() {
    var maxCalls = parseInt(document.getElementById("guardMaxCalls").value, 10);
    var windowMinutes = parseInt(document.getElementById("guardWindow").value, 10);
    var pauseMinutes = parseInt(document.getElementById("guardPause").value, 10);
    var maxOk = maxCalls === 0 || maxCalls >= 2;
    if (!maxOk || !(windowMinutes >= 1) || !(pauseMinutes >= 1)) return null;
    return { maxCalls: maxCalls, windowMinutes: windowMinutes, pauseMinutes: pauseMinutes };
  }

  /** Validates the form, then closes the webview with the config as JSON. */
  function save() {
    var stops = collectStops();
    var lines = collectLines();
    if (stops.length + lines.length === 0) {
      alert(t("needItem"));
      return;
    }
    if (stops.length + lines.length > MAX_ITEMS) {
      alert(tf("tooMany", { max: MAX_ITEMS }));
      return;
    }
    if (!document.getElementById("apiKey").value.trim()) {
      alert(t("keyRequired"));
      return;
    }
    var callGuard = collectCallGuard();
    if (!callGuard) {
      alert(t("guardInvalid"));
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
      timelineEnabled: document.getElementById("timelineEnabled").checked,
      callGuard: callGuard,
      language: document.getElementById("language").value
    };
    var json = JSON.stringify(config);
    document.location = "pebblejs://close#" + encodeURIComponent(json);
  }

  // Pre-fill from whatever's already saved, if anything -- pkjs injects
  // this as window.__initialConfig right before this script tag (see
  // buildConfigDataUri() in src/pkjs/index.js). Without this the page
  // always looks empty on reopen even though a previous save worked fine.
  (() => {
    document.getElementById("alertsSection").hidden = !ALERTS_ENABLED;
    var initial = window.__initialConfig;
    var choice = (initial && initial.language) || "auto";
    document.getElementById("language").value = choice;
    lang = resolveLanguage(choice);
    applyStaticTranslations();
    updateCount();
    if (!initial) return;
    document.getElementById("apiKey").value = initial.apiKey || "";
    if (initial.apiKey) validateApiKey(initial.apiKey);
    (initial.trackedStops || []).forEach((s) => {
      addStopRow({ stopRef: s.stopRef, stopName: s.stopName, lineRef: s.lineRef, lineName: s.lineName, lineColor: s.lineColor, lineTextColor: s.lineTextColor, destStopRef: s.destStopRef, destStopName: s.destStopName, directionName: s.directionName });
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
    var guard = initial.callGuard || {};
    if (typeof guard.maxCalls === "number") document.getElementById("guardMaxCalls").value = guard.maxCalls;
    if (typeof guard.windowMinutes === "number") document.getElementById("guardWindow").value = guard.windowMinutes;
    if (typeof guard.pauseMinutes === "number") document.getElementById("guardPause").value = guard.pauseMinutes;
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
	// Resolved here rather than from the webview's navigator.language so the
	// page's "auto" matches what the watch shows (see resolveLanguage).
	const watchLanguage = JSON.stringify(resolveLanguage("auto"));
	const html = CONFIG_HTML.replace(
		"<script>",
		`<script>window.__initialConfig = ${injected}; window.__watchLanguage = ${watchLanguage};`
	);
	return `data:text/html;charset=utf-8;base64,${utf8ToBase64(html)}`;
}

const moddableProxy = require("@moddable/pebbleproxy");
const {
	filterVisitsServingStop,
	journeyMission,
	decideCallGuard,
	callGuardSettingsChanged,
} = require("./trips");

// Shared by the initial "ready" send and the Task 8b configResendRequest
// handler below -- both just need "resend whatever's currently persisted,
// if anything".
// Languages the watch and config page have strings for -- keep in sync with
// STRINGS in src/embeddedjs/main.js and I18N in config/index.html.
const SUPPORTED_LANGUAGES = ["en", "fr"];

/**
 * @param {string} [choice] - The config page's language setting: "auto"
 *   (default) or a SUPPORTED_LANGUAGES code.
 * @returns {string} The SUPPORTED_LANGUAGES code to use. "auto" follows the
 *   watch's own language ("fr_FR" -> "fr"), then the phone's, then English.
 */
function resolveLanguage(choice) {
	if (SUPPORTED_LANGUAGES.includes(choice)) return choice;
	let locale = "";
	try {
		const info = Pebble.getActiveWatchInfo();
		// biome-ignore lint/complexity/useOptionalChain: no `?.` in pkjs (webpack 1, see journeyDestinationName)
		locale = (info && info.language) || "";
	} catch (_error) {
		// Not available on every firmware/app version -- fall through.
	}
	if (!locale && typeof navigator !== "undefined") {
		locale = navigator.language || "";
	}
	const code = locale.slice(0, 2).toLowerCase();
	return SUPPORTED_LANGUAGES.includes(code) ? code : "en";
}

/**
 * Resends whatever config is currently persisted in localStorage. With
 * nothing saved yet, still sends a lone configMeta: it carries the language
 * and lets the watch leave "Loading..." for its "no stop configured" screen
 * instead of waiting on a config that will never come.
 */
function sendStoredConfigToWatch() {
	const stored = localStorage.getItem("stroycommuteConfig");
	if (stored) {
		sendConfigToWatch(JSON.parse(stored));
		return;
	}
	sendItemsSequentially(
		[
			{
				itemIndex: 0,
				itemCount: 1,
				itemType: "configMeta",
				scheduleDaysBitmask: 0,
				scheduleStartMinutes: 0,
				scheduleEndMinutes: 0,
				timelineEnabled: 0,
				language: resolveLanguage("auto"),
			},
		],
		0
	);
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
	const previous = localStorage.getItem("stroycommuteConfig");
	const previousGuard = previous ? JSON.parse(previous).callGuard : undefined;
	// New guard settings apply right away: a pause started under the old
	// ones would otherwise keep running (see callGuardSettingsChanged).
	if (callGuardSettingsChanged(previousGuard, config.callGuard)) {
		localStorage.removeItem("stroycommuteCallGuard");
	}
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

// Mirrors ALERTS_ENABLED in CONFIG_HTML -- flip both together.
const ALERTS_ENABLED = false;

/**
 * Sends the full config (schedule + tracked stops/lines) to the watch as a
 * sequence of AppMessage items, one per stop/line plus a leading configMeta.
 * @param {object} config - Parsed stroycommuteConfig (apiKey, trackedStops,
 *   trackedLines, alertSchedule, timelineEnabled).
 */
function sendConfigToWatch(config) {
	// Traffic alerts aren't implemented yet (see ALERTS_ENABLED in
	// CONFIG_HTML): lines saved by an older version would only show
	// "coming soon" screens on the watch.
	const trackedLines = ALERTS_ENABLED ? config.trackedLines : [];
	const itemCount = 1 + config.trackedStops.length + trackedLines.length;

	const items = [
		{
			itemIndex: 0,
			itemCount: itemCount,
			itemType: "configMeta",
			scheduleDaysBitmask: daysToBitmask(config.alertSchedule.days),
			scheduleStartMinutes: timeStringToMinutes(config.alertSchedule.startTime),
			scheduleEndMinutes: timeStringToMinutes(config.alertSchedule.endTime),
			timelineEnabled: config.timelineEnabled ? 1 : 0,
			language: resolveLanguage(config.language),
		},
	];

	config.trackedStops.forEach((stop, i) => {
		const item = {
			itemIndex: 1 + i,
			itemCount: itemCount,
			itemType: "configStop",
			stopRef: stop.stopRef,
			lineRef: stop.lineRef,
			lineName: stop.lineName,
			stopName: stop.stopName,
			lineColor: stop.lineColor || "#888888",
			lineTextColor: stop.lineTextColor || "#ffffff",
		};
		// Optional strings are omitted rather than sent empty (see
		// docs/pebble-idfm-prim/SKILL.md, AppMessage format).
		if (stop.destStopRef) {
			item.destStopRef = stop.destStopRef;
			item.destStopName = stop.destStopName || "";
		}
		items.push(item);
	});

	trackedLines.forEach((line, i) => {
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
 * @param {object} journey - A SIRI MonitoredVehicleJourney.
 * @returns {string} Best available destination label, "" if none. SNCF
 *   (RER/Transilien) journeys don't always carry DestinationDisplay, and an
 *   empty array there used to throw inside the parse below -- surfacing as
 *   a bogus "network" error.
 */
function journeyDestinationName(journey) {
	const candidates = [
		// biome-ignore lint/complexity/useOptionalChain: no `?.` in pkjs -- the SDK's webpack 1 bundler predates ES2020 syntax
		(journey.MonitoredCall || {}).DestinationDisplay,
		journey.DestinationName,
		journey.DirectionName,
	];
	for (const list of candidates) {
		const first = (list || [])[0] || {};
		if (first.value) return first.value;
	}
	return "";
}

const STOP_MONITORING_URL =
	"https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring";

/** @returns {object|null} The persisted config, if any. */
function storedConfig() {
	const stored = localStorage.getItem("stroycommuteConfig");
	return stored ? JSON.parse(stored) : null;
}

/**
 * Runs the PRIM call guard (see decideCallGuard in ./trips) for a refresh
 * needing `count` calls, persisting its state.
 * @param {object|null} config
 * @param {number} count
 * @returns {{allowed: boolean, minutesLeft: number}}
 */
function checkCallGuard(config, count) {
	const stored = localStorage.getItem("stroycommuteCallGuard");
	const decision = decideCallGuard(
		stored ? JSON.parse(stored) : null,
		config ? config.callGuard : undefined,
		Date.now(),
		count
	);
	localStorage.setItem("stroycommuteCallGuard", JSON.stringify(decision.state));
	return decision;
}

/**
 * Fetches one stop's visits for a line and calls `done(state, visits)`:
 * state "ok" with the MonitoredStopVisit list, or a failure state
 * ("quotaExceeded", "invalidKey", "invalidStop", "network") with no visits.
 * @param {string} apiKey
 * @param {string} stopRef
 * @param {string} lineRef
 * @param {function(string, object[]=): void} done
 */
function fetchStopVisits(apiKey, stopRef, lineRef, done) {
	const url =
		STOP_MONITORING_URL +
		"?MonitoringRef=" +
		encodeURIComponent(stopRef) +
		"&LineRef=" +
		encodeURIComponent(lineRef);
	const xhr = new XMLHttpRequest();
	xhr.open("GET", url, true);
	xhr.setRequestHeader("apiKey", apiKey);
	xhr.onload = () => {
		if (xhr.status === 429) return done("quotaExceeded");
		if (xhr.status === 401 || xhr.status === 403) return done("invalidKey");
		if (xhr.status === 400 || xhr.status === 404) {
			console.log(`stop-monitoring ${xhr.status} for ${stopRef}`);
			return done("invalidStop");
		}
		if (xhr.status < 200 || xhr.status >= 300) return done("network");
		let visits;
		try {
			visits =
				JSON.parse(xhr.responseText).Siri.ServiceDelivery
					.StopMonitoringDelivery[0].MonitoredStopVisit || [];
		} catch (error) {
			console.log("stop-monitoring parse error: " + error);
			return done("network");
		}
		done("ok", visits);
	};
	xhr.onerror = () => done("network");
	lastQuotaRemaining = recordPrimRequestAndGetQuotaRemaining();
	xhr.send();
}

// When A and B both fail differently, the one the user can act on wins.
const FAILURE_PRIORITY = [
	"quotaExceeded",
	"invalidKey",
	"invalidStop",
	"network",
];

/**
 * @param {string[]} states - One per request.
 * @returns {string} The highest-priority failure state, or "ok".
 */
function worstState(states) {
	for (const state of FAILURE_PRIORITY) {
		if (states.includes(state)) return state;
	}
	return "ok";
}

/**
 * Turns already-filtered visits into the watch's "ok"/"noRealtimeData"
 * reply: drops visits without a usable time (the "undefined min" bug, see
 * callMinutesRemaining), sorts running trains first then at-stop first
 * then by minutes, and attaches the first two departures' mission codes.
 * @param {object[]} visits - MonitoredStopVisit list.
 * @param {string} lineName
 * @param {function(string, object=): void} reply
 */
function replyWithDepartures(visits, lineName, reply) {
	const departures = visits
		.map((visit) => visit.MonitoredVehicleJourney)
		.filter((journey) => journey && journey.MonitoredCall)
		.map((journey) => {
			const call = journey.MonitoredCall;
			const atStop = call.VehicleAtStop === true;
			const minutes = callMinutesRemaining(call);
			return {
				journey: journey,
				atStop: atStop,
				cancelled: call.DepartureStatus === "cancelled",
				// ExpectedArrivalTime can be slightly in the past before
				// VehicleAtStop flips (real-hardware evidence) -- floor at 0.
				minutes: minutes === null ? null : Math.max(0, minutes),
				rank: atStop ? -1 : minutes,
			};
		})
		.filter((d) => d.atStop || d.minutes !== null)
		// Running trains first: a cancelled one is only shown when nothing
		// else is announced, so it can't hide the real next departure.
		.sort(
			(a, b) => Number(a.cancelled) - Number(b.cancelled) || a.rank - b.rank
		);

	if (departures.length === 0) {
		reply("noRealtimeData");
		return;
	}

	const first = departures[0];
	const extra = {
		lineName: lineName,
		destination: journeyDestinationName(first.journey),
		// -1 when atStop is a sentinel the watch ignores in favor of atStop.
		minutes: first.atStop ? -1 : first.minutes,
		atStop: first.atStop,
		cancelled: first.cancelled,
	};
	const mission = journeyMission(first.journey);
	if (mission) extra.mission = mission;
	// The watch prints minutes2 as-is (no at-stop flag for it), hence 0
	// rather than -1. Omitted when there's no running following departure.
	if (departures.length > 1 && !departures[1].cancelled) {
		const second = departures[1];
		extra.minutes2 = second.atStop ? 0 : second.minutes;
		const mission2 = journeyMission(second.journey);
		if (mission2) extra.mission2 = mission2;
	}
	reply("ok", extra);
}

/**
 * Handles a watch-sent `refreshStop`: one stop-monitoring request on A, or
 * two in parallel (A and B) for an A->B trip, kept to trains serving A then
 * B (filterVisitsServingStop). Replies with one `departureUpdate`.
 * @param {{stopRef: string, lineRef: string, lineName: string,
 *   destStopRef?: string}} request
 */
function handleRefreshStop(request) {
	const destStopRef = request.destStopRef || "";
	const reply = (state, extra) =>
		sendDepartureUpdate(
			request.stopRef,
			request.lineRef,
			destStopRef,
			state,
			extra
		);

	if (DEV_FAKE_DEPARTURES) {
		const minutes = 1 + Math.floor(Math.random() * 15);
		reply("ok", {
			lineName: request.lineName,
			destination: "Terminus (donnée factice)",
			minutes: minutes,
			minutes2: minutes + 3 + Math.floor(Math.random() * 10),
			atStop: false,
			cancelled: false,
			mission: "FAKE",
			mission2: "TEST",
		});
		return;
	}

	const refs = destStopRef ? [request.stopRef, destStopRef] : [request.stopRef];
	// Configs saved before the monomodalStopPlace fix (see idfmIdToStif in
	// CONFIG_HTML) carry a ref with no numeric id -- PRIM can only reject it.
	if (refs.some((ref) => /:monomodalStopPlace:$/.test(ref))) {
		reply("invalidStop");
		return;
	}

	const config = storedConfig();
	const guard = checkCallGuard(config, refs.length);
	if (!guard.allowed) {
		reply("rateLimited", { minutes: guard.minutesLeft });
		return;
	}

	const apiKey = config ? config.apiKey : "";
	const results = [];
	let pending = refs.length;
	refs.forEach((ref, i) => {
		fetchStopVisits(apiKey, ref, request.lineRef, (state, visits) => {
			results[i] = { state: state, visits: visits };
			pending -= 1;
			if (pending > 0) return;
			const failure = worstState(results.map((r) => r.state));
			if (failure !== "ok") {
				reply(failure);
				return;
			}
			try {
				const kept = destStopRef
					? filterVisitsServingStop(results[0].visits, results[1].visits)
					: results[0].visits;
				replyWithDepartures(kept, request.lineName, reply);
			} catch (error) {
				console.log("departureUpdate build error: " + error);
				reply("network");
			}
		});
	});
}

/**
 * Sends a `departureUpdate` AppMessage for one tracked trip. stopRef,
 * lineRef and destStopRef are echoed back: together they are the watch's
 * key (a stop area is shared by several lines, and one stop+line can be
 * tracked towards several arrivals).
 * @param {string} stopRef
 * @param {string} lineRef
 * @param {string} destStopRef - "" when the trip has no arrival (omitted).
 * @param {"ok"|"network"|"noRealtimeData"|"quotaExceeded"|"invalidKey"|"invalidStop"|"rateLimited"} state
 * @param {object} [extra] - lineName, destination, minutes, minutes2,
 *   atStop, cancelled, mission, mission2 for "ok"; minutes for "rateLimited".
 */
function sendDepartureUpdate(stopRef, lineRef, destStopRef, state, extra) {
	const payload = Object.assign(
		{
			itemType: "departureUpdate",
			stopRef: stopRef,
			lineRef: lineRef,
			state: state,
		},
		extra || {}
	);
	if (destStopRef) payload.destStopRef = destStopRef;
	// Attached to every reply regardless of state so the watch's settings
	// screen always reflects the latest known count.
	if (lastQuotaRemaining !== null) payload.quotaRemaining = lastQuotaRemaining;
	Pebble.sendAppMessage(payload);
}
