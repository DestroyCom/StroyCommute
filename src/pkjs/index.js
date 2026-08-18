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
  body { font-family: sans-serif; margin: 0; padding: 12px; font-size: 16px; color: #222; }
  h2 { margin: 4px 0 16px; }
  fieldset { border: 1px solid #ddd; border-radius: 8px; margin-bottom: 16px; padding: 12px; }
  legend { font-weight: bold; padding: 0 4px; }
  input[type="text"], input[type="time"] { width: 100%; font-size: 16px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; margin-top: 4px; }
  button { font-size: 15px; padding: 10px 14px; border: none; border-radius: 4px; background: #4444ff; color: white; }
  button.remove { background: #cc4444; padding: 8px 12px; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; padding: 10px; background: #f2f2f6; border-radius: 6px; }
  .rowLabel { flex: 1; font-size: 15px; }
  .searchResults { border: 1px solid #ccc; border-radius: 4px; max-height: 220px; overflow-y: auto; margin-top: 4px; }
  .searchResultItem { padding: 10px; border-bottom: 1px solid #eee; }
  .searchResultItem:last-child { border-bottom: none; }
  .searchResultItem:active { background: #e8e8f8; }
  .searchStatus { padding: 8px; font-size: 0.9em; color: #666; }
  .dayRow { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-bottom: 8px; }
  .dayRow label { display: inline-flex; align-items: center; gap: 4px; }
  .timeRow { display: flex; gap: 16px; flex-wrap: wrap; }
  .timeRow label { display: flex; flex-direction: column; font-size: 0.9em; flex: 1; min-width: 120px; }
  #itemCount { font-size: 0.9em; color: #666; }
</style>
</head>
<body>
  <h2>StroyCommute</h2>

  <fieldset>
    <legend>Clé API PRIM</legend>
    <input type="text" id="apiKey" placeholder="Clé API" autocorrect="off" autocapitalize="off" autocomplete="off" spellcheck="false">
  </fieldset>

  <fieldset>
    <legend>Arrêts suivis (départs)</legend>
    <div id="stopsList"></div>
    <input type="text" id="stopSearchInput" placeholder="Rechercher un arrêt (ex: Châtelet)" autocorrect="off" autocapitalize="off" autocomplete="off" spellcheck="false" oninput="debounceSearch('stop')">
    <div id="stopSearchResults" class="searchResults"></div>
  </fieldset>

  <fieldset>
    <legend>Lignes suivies (alertes trafic)</legend>
    <div id="linesList"></div>
    <input type="text" id="lineSearchInput" placeholder="Rechercher une ligne (ex: 4, RER A)" autocorrect="off" autocapitalize="off" autocomplete="off" spellcheck="false" oninput="debounceSearch('line')">
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
  var searchTimers = {};

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
  function idfmIdToStif(rawId, kind) {
    var suffix = rawId.split(":")[1] || "";
    return kind === "line" ? "STIF:Line::" + suffix + ":" : "STIF:StopPoint:Q:" + suffix + ":";
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // Debounced so a live search fires roughly once per pause in typing, not
  // once per keystroke -- this hits a real network API on every call.
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
    results.forEach((r) => {
      var div = document.createElement("div");
      div.className = "searchResultItem";
      div.textContent = kind === "stop"
        ? r.stop_name + " — ligne " + r.route_long_name + " (" + r.mode + ", " + r.nom_commune + ")"
        : "Ligne " + r.route_long_name + " (" + r.mode + ", " + r.operatorname + ")";
      div.onclick = () => {
        if (kind === "stop") {
          addStopRow({
            stopRef: idfmIdToStif(r.stop_id, "stop"),
            stopName: r.stop_name,
            lineRef: idfmIdToStif(r.id, "line"),
            lineName: r.route_long_name
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
  function addStopRow(values) {
    var div = document.createElement("div");
    div.className = "row stopRow";
    div.dataset.stopRef = values.stopRef;
    div.dataset.stopName = values.stopName;
    div.dataset.lineRef = values.lineRef;
    div.dataset.lineName = values.lineName;
    div.innerHTML =
      '<span class="rowLabel">' + escapeHtml(values.lineName + " — " + values.stopName) + '</span>' +
      '<button type="button" class="remove" onclick="this.parentElement.remove(); updateCount();">x</button>';
    document.getElementById("stopsList").appendChild(div);
    updateCount();
  }

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

  function updateCount() {
    var count = document.querySelectorAll(".stopRow").length + document.querySelectorAll(".lineRow").length;
    document.getElementById("itemCount").textContent = count + " / " + MAX_ITEMS + " éléments suivis";
  }

  function collectStops() {
    var rows = document.querySelectorAll(".stopRow");
    var result = [];
    rows.forEach((row, i) => {
      result.push({
        id: "stop" + i,
        stopRef: row.dataset.stopRef,
        stopName: row.dataset.stopName,
        lineRef: row.dataset.lineRef,
        lineName: row.dataset.lineName
      });
    });
    return result;
  }

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
</script>
</body>
</html>
`;
// Node's Buffer isn't available in this pkjs runtime either (confirmed by
// emulator testing — see CONFIG_HTML comment above), so base64-encode by
// hand: UTF-8 encode the string to bytes, then standard base64 those bytes.
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

const CONFIG_DATA_URI = `data:text/html;charset=utf-8;base64,${utf8ToBase64(CONFIG_HTML)}`;

const moddableProxy = require("@moddable/pebbleproxy");

// Shared by the initial "ready" send and the Task 8b configResendRequest
// handler below -- both just need "resend whatever's currently persisted,
// if anything".
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
	Pebble.openURL(CONFIG_DATA_URI);
});

Pebble.addEventListener("webviewclosed", (e) => {
	if (!e.response) return;
	const config = JSON.parse(decodeURIComponent(e.response));
	localStorage.setItem("stroycommuteConfig", JSON.stringify(config));
	sendConfigToWatch(config);
});

function timeStringToMinutes(hhmm) {
	const [h, m] = hhmm.split(":").map(Number);
	return h * 60 + m;
}

function daysToBitmask(days) {
	let mask = 0;
	for (const d of days) mask |= 1 << d;
	return mask;
}

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

function handleRefreshStop(request) {
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

			const visit = visits[0];
			const journey = visit.MonitoredVehicleJourney;
			const call = journey.MonitoredCall;

			const cancelled = call.DepartureStatus === "cancelled";
			const atStop = call.VehicleAtStop === true;
			let minutes;
			if (atStop) {
				minutes = -1;
			} else {
				// pkjs has full Date support — this is why the conversion
				// lives here, not in embeddedjs (see idfm-api-reference.md's
				// UTC gotcha).
				const expected = new Date(call.ExpectedArrivalTime);
				minutes = Math.round((expected.getTime() - Date.now()) / 60000);
			}

			sendDepartureUpdate(request.stopRef, "ok", {
				lineName: request.lineName,
				destination: call.DestinationDisplay
					? call.DestinationDisplay[0].value
					: "",
				minutes: minutes,
				atStop: atStop,
				cancelled: cancelled,
			});
		} catch (error) {
			console.log("departureUpdate parse error: " + error);
			sendDepartureUpdate(request.stopRef, "network");
		}
	};
	xhr.onerror = () => {
		sendDepartureUpdate(request.stopRef, "network");
	};
	xhr.send();
}

function sendDepartureUpdate(stopRef, state, extra) {
	const payload = Object.assign(
		{
			itemType: "departureUpdate",
			stopRef: stopRef,
			state: state,
		},
		extra || {}
	);
	Pebble.sendAppMessage(payload);
}
