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

// TEMPORARY DEV DEFAULT (2026-08-18) — no way to reach the config page on
// real hardware yet: capabilities: ["configurable"] is declared correctly
// per the official docs (developer.repebble.com), confirmed present in the
// built appinfo.json, and the app was fully deleted + reinstalled on the
// phone — the settings gear still doesn't appear. Root cause not yet
// found (docs explicitly don't cover CloudPebble-sideload behavior; see
// progress.md's real-hardware finding entry). Seeds one real test stop so
// list/detail screen navigation (Tasks 9/10) can be exercised without the
// config flow. Deliberately no apiKey here — it must never be hardcoded;
// PRIM fetches will come back as state "network" until a real key reaches
// the phone through the config page (or another legitimate channel) is
// found. Remove this function and the wrapper below once that's resolved.
function seedDevDefaultConfigIfMissing() {
	if (localStorage.getItem("stroycommuteConfig")) return;
	console.log(
		"DEV DEFAULT: no stored config found, seeding one test stop (no apiKey)"
	);
	localStorage.setItem(
		"stroycommuteConfig",
		JSON.stringify({
			apiKey: "",
			trackedStops: [
				{
					stopRef: "STIF:StopPoint:Q:463158:",
					lineRef: "STIF:Line::C01374:",
					lineName: "4",
					stopName: "Châtelet",
				},
			],
			trackedLines: [],
			alertSchedule: {
				days: [1, 2, 3, 4, 5],
				startTime: "07:00",
				endTime: "20:00",
			},
			timelineEnabled: false,
		})
	);
}

Pebble.addEventListener("ready", () => {
	seedDevDefaultConfigIfMissing();
	sendStoredConfigToWatch();
});

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
