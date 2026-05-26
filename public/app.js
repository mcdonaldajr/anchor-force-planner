const webVersion = "0.5.15";
const halfCycleMinutes = 12 * 60 + 25;

const defaults = {
  windSpeed: 20,
  tidalStream: 1.0,
  loa: 10.1,
  draft: 1.2,
  minClearance: 0.5,
  depthLw: 5,
  echoBelowKeel: 6.2,
  tideHeight: 3,
  hwHeight: 4,
  lwHeight: 1,
  rodeLength: 40,
  bowHeight: 1,
  chainLength: 50,
  ropeLength: 50,
  chainDiameter: 8,
  chainWeight: 1.4,
  chainWll: 800,
  chainBreak: 4030,
  ropeDiameter: 14,
  ropeWeight: 0.16,
  ropeBreak: 3700,
  anchorWeight: 15,
  anchorUhc: 420,
  windageFactor: 0.34,
  underwaterDragFactor: 0.40
};

const timeDefaults = {
  hwTime: "15:00",
  lwTime: "09:00"
};

const savedSettingsKey = "anchorForcePlanner.settings.v1";
const ids = Object.keys(defaults);
const allInputIds = [...ids, ...Object.keys(timeDefaults)];
const checkboxIds = ["echoMeasuresBelowKeel"];
let depthSource = "chart";
let idealRode = null;
let selectedTideViewKey = "now";
let saveSettingsTimer = null;
let serverState = {
  tide: {
    source: "oban",
    selectedPortId: "",
    obanReferenceLevels: {
      mhws: 4.0,
      mhwn: 2.9,
      mlwn: 1.8,
      mlws: 0.7
    },
    oban: {
      hwTime: "15:00",
      lwTime: "09:00",
      hwHeight: 4,
      lwHeight: 1
    }
  },
  secondaryPorts: [],
  deletedSecondaryPortIds: [],
  tideData: {
    stationName: "Oban",
    stationId: "0372",
    timeStandard: "UT",
    displayTimeMode: "local",
    ukhoAccountEmail: "",
    ukhoApiKeySet: false,
    events: [],
    cache: null
  }
};
let saveServerStateTimer = null;
let editingSecondaryPortId = null;

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

function number(id) {
  const value = Number(document.getElementById(id).value);
  return Number.isFinite(value) ? value : 0;
}

function timeToMinutes(value = "00:00") {
  const [hours, minutes] = String(value || "00:00").split(":").map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

function minutesToTime(totalMinutes) {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function fmt(value, digits = 1, suffix = "") {
  if (!Number.isFinite(value)) return "-";
  return `${round(value, digits).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}${suffix}`;
}

function fmtOffset(value) {
  const minutes = Math.round(Number(value || 0));
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}${String(absolute % 60).padStart(2, "0")}`;
}

function fmtDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function displayTimeMode() {
  return serverState.tideData.displayTimeMode === "local" ? "local" : "ut";
}

function timeBasisLabel() {
  return displayTimeMode() === "local" ? "local" : "UT";
}

function datePartsForLocal(date) {
  return {
    year: date.getFullYear(),
    month: String(date.getMonth() + 1).padStart(2, "0"),
    day: String(date.getDate()).padStart(2, "0")
  };
}

function todayIsoDateForMode() {
  const now = new Date();
  if (displayTimeMode() === "ut") return now.toISOString().slice(0, 10);
  const parts = datePartsForLocal(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function obanDate() {
  return serverState.tide.oban.date || todayIsoDateForMode();
}

function timeFromUtcForDisplay(utTime, date = obanDate()) {
  if (displayTimeMode() !== "local") return utTime || "00:00";
  const parsed = new Date(`${date}T${utTime || "00:00"}:00Z`);
  if (Number.isNaN(parsed.getTime())) return utTime || "00:00";
  return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
}

function timeFromDisplayToUtc(displayTime, date = obanDate()) {
  if (displayTimeMode() !== "local") return displayTime || "00:00";
  const [hours, minutes] = String(displayTime || "00:00").split(":").map(Number);
  const [year, month, day] = String(date || todayIsoDateForMode()).split("-").map(Number);
  const parsed = new Date(
    Number.isFinite(year) ? year : new Date().getFullYear(),
    (Number.isFinite(month) ? month : 1) - 1,
    Number.isFinite(day) ? day : 1,
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0,
    0
  );
  return `${String(parsed.getUTCHours()).padStart(2, "0")}:${String(parsed.getUTCMinutes()).padStart(2, "0")}`;
}

function eventDisplayParts(event) {
  const rawDate = eventDate(event);
  const rawTime = eventTime(event);
  if (displayTimeMode() !== "local") return { date: rawDate, time: rawTime, label: "UT" };
  const parsed = new Date(`${rawDate}T${rawTime}:00Z`);
  if (Number.isNaN(parsed.getTime())) return { date: rawDate, time: rawTime, label: "local" };
  const parts = datePartsForLocal(parsed);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`,
    label: "local"
  };
}

function nowMinutesForDisplayMode(date = new Date()) {
  return displayTimeMode() === "ut"
    ? date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60
    : date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

function displayDayStart(date = new Date()) {
  if (displayTimeMode() === "ut") {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function eventUtcDate(event) {
  const value = String(event.DateTime || "");
  const parsed = new Date(`${value.slice(0, 19)}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function eventTimestamp(event) {
  return eventUtcDate(event)?.getTime() ?? Number.NaN;
}

function eventTypeShort(event) {
  return event.EventType === "HighWater" ? "HW" : "LW";
}

function eventHeight(event) {
  return Number(event.Height);
}

function baseInputs(tideDate = new Date()) {
  const input = Object.fromEntries(ids.map((id) => [id, number(id)]));
  const tide = activeTideValues(tideDate);
  input.hwHeight = tide.hwHeight;
  input.lwHeight = tide.lwHeight;
  return input;
}

function tideBracketForDate(input, date = new Date()) {
  let nowMinutes = nowMinutesForDisplayMode(date);
  const pair = bracketingActiveTideEvents(date);
  let before = pair?.before;
  let after = pair?.after;

  if (pair) {
    nowMinutes = pair.nowMinute;
  } else {
    const tide = activeTideValues(date);
    const hw = timeToMinutes(tide.hwTime);
    const lw = timeToMinutes(tide.lwTime);
    const baseEvents = [
      { type: "HW", minute: hw, height: input.hwHeight },
      { type: "LW", minute: lw, height: input.lwHeight }
    ];
    const events = [];
    for (const shift of [-2, -1, 0, 1, 2]) {
      for (const event of baseEvents) events.push({ ...event, minute: event.minute + shift * halfCycleMinutes });
    }
    events.sort((a, b) => a.minute - b.minute);
    before = events[0];
    after = events[1];
    for (let index = 0; index < events.length - 1; index += 1) {
      if (events[index].minute <= nowMinutes && nowMinutes <= events[index + 1].minute && events[index].type !== events[index + 1].type) {
        before = events[index];
        after = events[index + 1];
        break;
      }
    }
  }

  return { before, after, nowMinutes };
}

function tideHeightForDate(input, date = new Date()) {
  const bracket = tideBracketForDate(input, date);
  return tideHeightBetween(bracket.before, bracket.after, bracket.nowMinutes);
}

function nextTideEvent(type, now = new Date()) {
  const timeline = plannerTideTimeline(now);
  const nowMinute = (now.getTime() - displayDayStart(now)) / 60000;
  return timeline.find((event) => event.type === type && event.minute > nowMinute);
}

function safetyTideHeights(selectedView = null, now = new Date()) {
  const fallback = activeTideValues(now);
  const safetyGroup = selectedView?.group && selectedView.group !== "Now" ? selectedView.group : "Next";
  const views = plannerTideViews(now);
  const groupHighWater = views.find((view) => view.group === safetyGroup && view.type === "HW");
  const groupLowWater = views.find((view) => view.group === safetyGroup && view.type === "LW");
  const nextHighWater = groupHighWater || nextTideEvent("HW", now);
  const nextLowWater = groupLowWater || nextTideEvent("LW", now);
  return {
    hwHeight: Number(nextHighWater?.height ?? fallback.hwHeight ?? 0),
    lwHeight: Number(nextLowWater?.height ?? fallback.lwHeight ?? 0),
    nextHighWater,
    nextLowWater
  };
}

function currentInputs() {
  const view = selectedPlannerTideView();
  const input = baseInputs(view.date);
  const safety = safetyTideHeights(view);
  input.hwHeight = safety.hwHeight;
  input.lwHeight = safety.lwHeight;
  input.tideHeight = view.height;
  return input;
}

function currentSettings() {
  return {
    inputs: Object.fromEntries(ids.map((id) => [id, document.getElementById(id).value])),
    checkboxes: Object.fromEntries(checkboxIds.map((id) => [id, document.getElementById(id).checked])),
    times: Object.fromEntries(Object.keys(timeDefaults).map((id) => [id, document.getElementById(id).value])),
    depthSource
  };
}

function savedSettings() {
  try {
    const raw = localStorage.getItem(savedSettingsKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function applySettings(settings = {}) {
  Object.entries({ ...defaults, ...(settings.inputs || {}) }).forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (input) input.value = value;
  });
  Object.entries({ ...timeDefaults, ...(settings.times || {}) }).forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (input) input.value = value;
  });
  document.getElementById("echoMeasuresBelowKeel").checked = settings.checkboxes?.echoMeasuresBelowKeel ?? true;
  depthSource = settings.depthSource === "sounder" ? "sounder" : "chart";
  document.querySelectorAll(".depthSourceButton").forEach((item) => item.classList.toggle("active", item.dataset.depthSource === depthSource));
}

function mergeServerState(state = {}) {
  return {
    tide: {
      ...serverState.tide,
      ...(state.tide || {}),
      obanReferenceLevels: {
        ...serverState.tide.obanReferenceLevels,
        ...(state.tide?.obanReferenceLevels || {})
      },
      oban: {
        ...serverState.tide.oban,
        ...(state.tide?.oban || {})
      }
    },
    secondaryPorts: Array.isArray(state.secondaryPorts) ? state.secondaryPorts : [],
    deletedSecondaryPortIds: Array.isArray(state.deletedSecondaryPortIds) ? state.deletedSecondaryPortIds : [],
    tideData: {
      ...serverState.tideData,
      ...(state.tideData || {})
    }
  };
}

async function loadServerState() {
  try {
    const response = await fetch("/api/state");
    if (!response.ok) throw new Error("State endpoint failed");
    serverState = mergeServerState(await response.json());
  } catch {
    serverState = mergeServerState();
  }
}

function saveServerStateSoon() {
  clearTimeout(saveServerStateTimer);
  saveServerStateTimer = setTimeout(async () => {
    try {
      await fetch("/api/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(serverState)
      });
    } catch {
      // The About tab makes stale or unavailable server state visible.
    }
  }, 350);
}

function obanTideFromFields() {
  const date = obanDate();
  return {
    date,
    hwTime: timeFromDisplayToUtc(document.getElementById("hwTime").value || "00:00", date),
    lwTime: timeFromDisplayToUtc(document.getElementById("lwTime").value || "00:00", date),
    hwHeight: number("hwHeight"),
    lwHeight: number("lwHeight")
  };
}

function selectedSecondaryPort() {
  return serverState.secondaryPorts.find((port) => port.id === serverState.tide.selectedPortId) || null;
}

function springFactor(height, neapHeight, springHeight) {
  const range = springHeight - neapHeight;
  if (!Number.isFinite(range) || Math.abs(range) < 0.01) return 0;
  return (height - neapHeight) / range;
}

function lowWaterSpringFactor(height, neapHeight, springHeight) {
  const range = neapHeight - springHeight;
  if (!Number.isFinite(range) || Math.abs(range) < 0.01) return 0;
  return (neapHeight - height) / range;
}

function interpolateOffset(neapOffset, springOffset, factor) {
  return Number(neapOffset || 0) + (Number(springOffset || 0) - Number(neapOffset || 0)) * factor;
}

function offsetKey(hour) {
  return `t${String(hour).padStart(4, "0")}`;
}

function legacyOffsets(port, type) {
  if (type === "hw") {
    const spring = Number(port.hwSpringOffset ?? port.hwTimeOffset ?? 0);
    const neap = Number(port.hwNeapOffset ?? port.hwTimeOffset ?? 0);
    return { t0000: spring, t0600: neap, t1200: spring, t1800: neap };
  }
  const spring = Number(port.lwSpringOffset ?? port.lwTimeOffset ?? 0);
  const neap = Number(port.lwNeapOffset ?? port.lwTimeOffset ?? 0);
  return { t0000: spring, t0600: neap, t1200: spring, t1800: neap };
}

function portOffsets(port, type) {
  const source = type === "hw" ? port.hwOffsets : port.lwOffsets;
  return { ...legacyOffsets(port, type), ...(source || {}) };
}

function portHeightDiffs(port) {
  if (port.heightDiffs) return port.heightDiffs;
  const reference = serverState.tide.obanReferenceLevels;
  return {
    mhws: Number(port.mhws || 0) - Number(reference.mhws || 0),
    mhwn: Number(port.mhwn || 0) - Number(reference.mhwn || 0),
    mlwn: Number(port.mlwn || 0) - Number(reference.mlwn || 0),
    mlws: Number(port.mlws || 0) - Number(reference.mlws || 0)
  };
}

function portStandardPort(port) {
  return port.standardPort || "Oban";
}

function portReferenceLevels(port) {
  return port.standardReferenceLevels || serverState.tide.obanReferenceLevels;
}

function interpolateTimeOffset(offsets, minutes) {
  const points = [
    { minute: 0, value: Number(offsets.t0000 || 0) },
    { minute: 360, value: Number(offsets.t0600 || 0) },
    { minute: 720, value: Number(offsets.t1200 || 0) },
    { minute: 1080, value: Number(offsets.t1800 || 0) },
    { minute: 1440, value: Number(offsets.t0000 || 0) }
  ];
  const normalized = ((minutes % 1440) + 1440) % 1440;
  let before = points[0];
  let after = points[points.length - 1];
  for (let index = 0; index < points.length - 1; index += 1) {
    if (points[index].minute <= normalized && normalized <= points[index + 1].minute) {
      before = points[index];
      after = points[index + 1];
      break;
    }
  }
  const span = Math.max(1, after.minute - before.minute);
  return before.value + ((after.value - before.value) * (normalized - before.minute)) / span;
}

function secondaryTideValues(port = selectedSecondaryPort(), oban = serverState.tide.oban) {
  if (!port) return { ...oban };
  const reference = serverState.tide.obanReferenceLevels;
  const hwFactor = springFactor(Number(oban.hwHeight || 0), Number(reference.mhwn || 0), Number(reference.mhws || 0));
  const lwFactor = lowWaterSpringFactor(Number(oban.lwHeight || 0), Number(reference.mlwn || 0), Number(reference.mlws || 0));
  const hwTimeOffset = interpolateTimeOffset(portOffsets(port, "hw"), timeToMinutes(oban.hwTime));
  const lwTimeOffset = interpolateTimeOffset(portOffsets(port, "lw"), timeToMinutes(oban.lwTime));
  const heightDiffs = portHeightDiffs(port);
  const hwHeightDiff = interpolateOffset(heightDiffs.mhwn, heightDiffs.mhws, hwFactor);
  const lwHeightDiff = interpolateOffset(heightDiffs.mlwn, heightDiffs.mlws, lwFactor);
  const date = oban.date || obanDate();
  const hwTimeUtc = minutesToTime(timeToMinutes(oban.hwTime) + hwTimeOffset);
  const lwTimeUtc = minutesToTime(timeToMinutes(oban.lwTime) + lwTimeOffset);
  return {
    date,
    hwTime: timeFromUtcForDisplay(hwTimeUtc, date),
    lwTime: timeFromUtcForDisplay(lwTimeUtc, date),
    hwHeight: round(Number(oban.hwHeight || 0) + hwHeightDiff, 1),
    lwHeight: round(Number(oban.lwHeight || 0) + lwHeightDiff, 1)
  };
}

function downloadedObanCycle(now = new Date()) {
  const nowMs = now.getTime();
  const events = sortedTideEvents()
    .filter((event) => Number.isFinite(eventTimestamp(event)) && Number.isFinite(eventHeight(event)));
  if (events.length < 2) return null;

  const pairs = [];
  for (let index = 0; index < events.length - 1; index += 1) {
    const before = events[index];
    const after = events[index + 1];
    if (before.EventType !== after.EventType) {
      const hw = before.EventType === "HighWater" ? before : after;
      const lw = before.EventType === "LowWater" ? before : after;
      pairs.push({ before, after, hw, lw, range: Math.abs(eventHeight(hw) - eventHeight(lw)) });
    }
  }
  if (!pairs.length) return null;

  const activeIndex = pairs.findIndex((pair) => eventTimestamp(pair.before) <= nowMs && nowMs <= eventTimestamp(pair.after));
  if (activeIndex >= 0) return pairs[activeIndex];

  const nearestPairIndex = pairs.reduce((best, pair, index) => {
    const midpoint = (eventTimestamp(pair.before) + eventTimestamp(pair.after)) / 2;
    const distance = Math.abs(midpoint - nowMs);
    return distance < best.distance ? { index, distance } : best;
  }, { index: 0, distance: Infinity }).index;
  return pairs[nearestPairIndex];
}

function obanTideValuesForNow(now = new Date()) {
  const cycle = downloadedObanCycle(now);
  if (!cycle) return { ...serverState.tide.oban, downloaded: false };
  return {
    date: eventDate(cycle.hw),
    hwTime: eventTime(cycle.hw),
    lwTime: eventTime(cycle.lw),
    hwHeight: round(eventHeight(cycle.hw), 1),
    lwHeight: round(eventHeight(cycle.lw), 1),
    downloaded: true,
    cycle
  };
}

function activeTideValues(now = new Date()) {
  const oban = obanTideValuesForNow(now);
  if (serverState.tide.source === "secondary") return secondaryTideValues(selectedSecondaryPort(), oban);
  const date = oban.date || obanDate();
  return {
    ...oban,
    date,
    hwTime: timeFromUtcForDisplay(oban.hwTime, date),
    lwTime: timeFromUtcForDisplay(oban.lwTime, date)
  };
}

function springPercentFromRange(range) {
  const reference = serverState.tide.obanReferenceLevels;
  const springRange = Number(reference.mhws || 0) - Number(reference.mlws || 0);
  const neapRange = Number(reference.mhwn || 0) - Number(reference.mlwn || 0);
  const spread = springRange - neapRange;
  if (![range, springRange, neapRange, spread].every(Number.isFinite) || Math.abs(spread) < 0.01) return Number.NaN;
  return ((range - neapRange) / spread) * 100;
}

function springPercentageForNow() {
  const oban = obanTideValuesForNow();
  const range = oban.cycle?.range ?? Math.abs(Number(oban.hwHeight || 0) - Number(oban.lwHeight || 0));
  return springPercentFromRange(range);
}

function saveCurrentSettings() {
  localStorage.setItem(savedSettingsKey, JSON.stringify(currentSettings()));
  const button = document.getElementById("saveDefaults");
  button.textContent = "Saved";
  clearTimeout(saveSettingsTimer);
  saveSettingsTimer = setTimeout(() => {
    button.textContent = "Save settings";
  }, 1600);
}

function chartDepthNow(input) {
  return input.depthLw + input.tideHeight;
}

function sounderDepthNow(input) {
  return input.echoBelowKeel + (document.getElementById("echoMeasuresBelowKeel").checked ? input.draft : 0);
}

function presentTideHeightForDepthSource() {
  const now = new Date();
  const presentInput = baseInputs(now);
  return tideHeightForDate(presentInput, now);
}

function chartedDepthFor(input, tideHeight = input.tideHeight) {
  if (depthSource === "sounder") return Math.max(0, sounderDepthNow(input) - presentTideHeightForDepthSource());
  return Math.max(0, input.depthLw);
}

function calculateTidalForce(input) {
  const underwaterArea = Math.max(0, input.loa * input.draft * input.underwaterDragFactor);
  return 13.2 * underwaterArea * input.tidalStream ** 2;
}

function calculateWindForce(input, windSpeed = input.windSpeed) {
  const projectedWindageArea = Math.max(0, input.loa * input.loa * input.windageFactor);
  return 0.0165 * projectedWindageArea * windSpeed ** 2;
}

function anchorAngleHoldingFactor(angleRadians) {
  const angleDegrees = Math.abs(angleRadians * 180 / Math.PI);
  const angleLoss = Math.max(0.15, 1 - angleDegrees / 45);
  return Math.max(0.15, Math.min(1, Math.cos(angleRadians) ** 2 * angleLoss));
}

function catenarySegment(weight, length, horizontalLoad, startingVerticalLoad = 0, samples = 14) {
  const w = Math.max(0.01, weight);
  const h = Math.max(0.01, horizontalLoad);
  const a = h / w;
  const q0 = startingVerticalLoad / w;
  const base = Math.sqrt(q0 ** 2 + a ** 2);
  const baseAsinh = Math.asinh(q0 / a);
  const vertical = Math.sqrt((q0 + length) ** 2 + a ** 2) - base;
  const horizontal = a * (Math.asinh((q0 + length) / a) - baseAsinh);
  const points = Array.from({ length: samples }, (_, index) => {
    const s = length * (index / Math.max(1, samples - 1));
    return {
      x: a * (Math.asinh((q0 + s) / a) - baseAsinh),
      y: Math.sqrt((q0 + s) ** 2 + a ** 2) - base
    };
  });

  return { a, horizontal, vertical, points };
}

function combinedVerticalRise(input, chainLifted, ropeDeployed, horizontalLoad, startingVerticalLoad = 0) {
  const chain = catenarySegment(input.chainWeight, chainLifted, horizontalLoad, startingVerticalLoad, 2);
  const rope = catenarySegment(input.ropeWeight, ropeDeployed, horizontalLoad, startingVerticalLoad + chainLifted * input.chainWeight, 2);
  return chain.vertical + rope.vertical;
}

function calculateCatenary(input, verticalDrop, chainDeployed, ropeDeployed, horizontalLoad) {
  const maxChainLifted = Math.max(0, chainDeployed);
  const maxRopeLifted = Math.max(0, ropeDeployed);

  if (horizontalLoad < 1) {
    if (maxRopeLifted > 0) {
      const chainLifted = Math.min(maxChainLifted, Math.max(0, verticalDrop - maxRopeLifted));
      const chainOnSeabed = Math.max(0, maxChainLifted - chainLifted);
      const remainingDrop = Math.max(0, verticalDrop - chainLifted);
      const ropeLifted = Math.min(maxRopeLifted, remainingDrop);
      const ropeOnSeabed = Math.max(0, maxRopeLifted - ropeLifted);
      const ropeHorizontal = Math.sqrt(Math.max(0, ropeLifted ** 2 - remainingDrop ** 2));
      return {
        chainA: Infinity,
        ropeA: Infinity,
        chainLifted,
        chainOnSeabed,
        ropeDeployed: maxRopeLifted,
        ropeLifted,
        ropeOnSeabed,
        rodeOnSeabed: chainOnSeabed + ropeOnSeabed,
        anchorAngle: 0,
        horizontalReach: chainOnSeabed + ropeOnSeabed + ropeHorizontal,
        liftedPoints: [
          { x: 0, y: 0 },
          { x: 0, y: chainLifted },
          { x: ropeHorizontal, y: verticalDrop }
        ],
        spliceIndex: 1,
        liftWeight: input.anchorWeight + ropeLifted * input.ropeWeight,
        reachesBow: chainLifted + ropeLifted >= verticalDrop,
        lowLoad: true
      };
    }

    const chainLifted = Math.min(maxChainLifted, verticalDrop);
    const chainOnSeabed = Math.max(0, maxChainLifted - chainLifted);
    return {
      chainA: Infinity,
      ropeA: Infinity,
      chainLifted,
      chainOnSeabed,
      ropeDeployed: 0,
      ropeLifted: 0,
      ropeOnSeabed: 0,
      rodeOnSeabed: chainOnSeabed,
      anchorAngle: Math.PI / 2,
      horizontalReach: chainOnSeabed,
      liftedPoints: [
        { x: 0, y: 0 },
        { x: 0, y: chainLifted }
      ],
      spliceIndex: 1,
      liftWeight: input.anchorWeight + chainLifted * input.chainWeight,
      reachesBow: chainLifted >= verticalDrop,
      lowLoad: true
    };
  }

  let low = 0;
  let high = maxChainLifted;
  let ropeLifted = maxRopeLifted;
  let startingVerticalLoad = 0;
  const ropeOnlyRise = combinedVerticalRise(input, 0, maxRopeLifted, horizontalLoad);
  const fullRise = combinedVerticalRise(input, maxChainLifted, maxRopeLifted, horizontalLoad);

  if (maxRopeLifted > 0 && ropeOnlyRise >= verticalDrop) {
    high = 0;
    let ropeLow = 0;
    let ropeHigh = maxRopeLifted;
    for (let index = 0; index < 36; index += 1) {
      const mid = (ropeLow + ropeHigh) / 2;
      if (combinedVerticalRise(input, 0, mid, horizontalLoad) < verticalDrop) ropeLow = mid;
      else ropeHigh = mid;
    }
    ropeLifted = ropeHigh;
  } else if (fullRise < verticalDrop) {
    low = maxChainLifted;
    high = maxChainLifted;
    let loadLow = 0;
    let loadHigh = Math.max(1, horizontalLoad);
    while (combinedVerticalRise(input, maxChainLifted, maxRopeLifted, horizontalLoad, loadHigh) < verticalDrop && loadHigh < horizontalLoad * 1000) {
      loadHigh *= 2;
    }
    for (let index = 0; index < 40; index += 1) {
      const mid = (loadLow + loadHigh) / 2;
      if (combinedVerticalRise(input, maxChainLifted, maxRopeLifted, horizontalLoad, mid) < verticalDrop) loadLow = mid;
      else loadHigh = mid;
    }
    startingVerticalLoad = loadHigh;
  } else {
    for (let index = 0; index < 36; index += 1) {
      const mid = (low + high) / 2;
      if (combinedVerticalRise(input, mid, maxRopeLifted, horizontalLoad) < verticalDrop) low = mid;
      else high = mid;
    }
  }

  const chainLifted = Math.min(maxChainLifted, high);
  const chainOnSeabed = Math.max(0, maxChainLifted - chainLifted);
  const ropeOnSeabed = Math.max(0, maxRopeLifted - ropeLifted);
  const rodeOnSeabed = chainOnSeabed + ropeOnSeabed;
  const chain = catenarySegment(input.chainWeight, chainLifted, horizontalLoad, startingVerticalLoad, 18);
  const rope = catenarySegment(input.ropeWeight, ropeLifted, horizontalLoad, startingVerticalLoad + chainLifted * input.chainWeight, 18);
  const ropePoints = rope.points.map((point) => ({
    x: chain.horizontal + point.x,
    y: chain.vertical + point.y
  }));
  const liftedPoints = [
    ...chain.points,
    ...ropePoints.slice(ropeLifted > 0 ? 1 : ropePoints.length)
  ];
  const horizontalReach = rodeOnSeabed + chain.horizontal + rope.horizontal;
  const liftWeight = input.anchorWeight + chainLifted * input.chainWeight + ropeLifted * input.ropeWeight;

  return {
    chainA: chain.a,
    ropeA: rope.a,
    chainLifted,
    chainOnSeabed,
    ropeDeployed: maxRopeLifted,
    ropeLifted,
    ropeOnSeabed,
    rodeOnSeabed,
    anchorAngle: Math.atan2(startingVerticalLoad, Math.max(0.01, horizontalLoad)),
    horizontalReach,
    liftedPoints,
    spliceIndex: Math.max(0, chain.points.length - 1),
    liftWeight,
    reachesBow: fullRise >= verticalDrop,
    lowLoad: false
  };
}

function anchorMarginAtHighWaterLoad(input, depthLw, horizontalLoad) {
  const highWaterDepth = depthLw + input.hwHeight;
  const highWaterVerticalDrop = highWaterDepth + input.bowHeight;
  const deployedRode = Math.min(input.rodeLength, input.chainLength + input.ropeLength);
  const chainDeployed = Math.min(deployedRode, input.chainLength);
  const ropeDeployed = Math.min(input.ropeLength, Math.max(0, deployedRode - input.chainLength));
  const highWaterCatenary = calculateCatenary(input, highWaterVerticalDrop, chainDeployed, ropeDeployed, horizontalLoad);
  const holdingFactor = anchorAngleHoldingFactor(highWaterCatenary.anchorAngle);

  return input.anchorUhc * holdingFactor - horizontalLoad;
}

function calculateWindDragLimit(input, depthLw) {
  const tidalForce = calculateTidalForce(input);
  const windForceNow = calculateWindForce(input);

  if (anchorMarginAtHighWaterLoad(input, depthLw, tidalForce) <= 0) {
    return {
      maxWindForceBeforeDrag: 0,
      maxWindSpeedBeforeDrag: 0,
      windForceMarginBeforeDrag: -windForceNow
    };
  }

  let low = 0;
  let high = Math.max(50, windForceNow, input.anchorUhc);
  while (anchorMarginAtHighWaterLoad(input, depthLw, tidalForce + high) > 0 && high < 100000) {
    high *= 2;
  }

  for (let index = 0; index < 48; index += 1) {
    const mid = (low + high) / 2;
    if (anchorMarginAtHighWaterLoad(input, depthLw, tidalForce + mid) > 0) low = mid;
    else high = mid;
  }

  return {
    maxWindForceBeforeDrag: low,
    maxWindSpeedBeforeDrag: Math.sqrt(low / Math.max(0.001, 0.0165 * input.loa * input.loa * input.windageFactor)),
    windForceMarginBeforeDrag: low - windForceNow
  };
}

function timeMinutes(id) {
  const tide = activeTideValues();
  if (id === "hwTime") return timeToMinutes(tide.hwTime);
  if (id === "lwTime") return timeToMinutes(tide.lwTime);
  return timeToMinutes(document.getElementById(id).value || "00:00");
}

function calculateForDepth(input, depthLw) {
  const lowWaterDepth = depthLw + input.lwHeight;
  const highWaterDepth = depthLw + input.hwHeight;
  const currentDepth = depthLw + input.tideHeight;
  const rodeLength = input.rodeLength;
  const totalRode = input.chainLength + input.ropeLength;
  const deployedRode = Math.min(rodeLength, totalRode);
  const verticalDrop = currentDepth + input.bowHeight;
  const lowWaterVerticalDrop = lowWaterDepth + input.bowHeight;
  const highWaterVerticalDrop = highWaterDepth + input.bowHeight;
  const amountOnSeabed = Math.max(0, deployedRode - verticalDrop);
  const lowWaterAmountOnSeabed = Math.max(0, deployedRode - lowWaterVerticalDrop);
  const windForce = calculateWindForce(input);
  const tidalForce = calculateTidalForce(input);
  const horizontalLoad = windForce + tidalForce;
  const chainDeployed = Math.min(deployedRode, input.chainLength);
  const ropeDeployed = Math.min(input.ropeLength, Math.max(0, deployedRode - input.chainLength));
  const catenary = calculateCatenary(input, verticalDrop, chainDeployed, ropeDeployed, horizontalLoad);
  const lowWaterCatenary = calculateCatenary(input, lowWaterVerticalDrop, chainDeployed, ropeDeployed, horizontalLoad);
  const highWaterCatenary = calculateCatenary(input, highWaterVerticalDrop, chainDeployed, ropeDeployed, horizontalLoad);
  const highWaterAnchorAngle = highWaterCatenary.anchorAngle;
  const anchorHoldingFactor = anchorAngleHoldingFactor(highWaterAnchorAngle);
  const effectiveAnchorHolding = input.anchorUhc * anchorHoldingFactor;
  const anchorHoldingMargin = effectiveAnchorHolding - horizontalLoad;
  const windDragLimit = calculateWindDragLimit(input, depthLw);
  const shortfall = Math.max(0, rodeLength - totalRode);
  const lowWaterClearance = lowWaterDepth - input.draft;
  const keelClearance = currentDepth - input.draft;
  const clearanceMargin = lowWaterClearance - input.minClearance;

  return {
    chartedDepth: depthLw,
    depthLw: lowWaterDepth,
    depthHw: currentDepth,
    verticalDrop,
    horizontalReach: catenary.horizontalReach,
    scopeRatio: verticalDrop > 0 ? rodeLength / verticalDrop : 0,
    rodeLength,
    deployedRode,
    totalRode,
    amountOnSeabed,
    lowWaterAmountOnSeabed,
    ropeOnSeabed: catenary.ropeOnSeabed,
    lowWaterRopeOnSeabed: lowWaterCatenary.ropeOnSeabed,
    chainLifted: catenary.chainLifted,
    chainOnSeabed: catenary.chainOnSeabed,
    ropeDeployed: catenary.ropeDeployed,
    ropeLifted: catenary.ropeLifted,
    rodeOnSeabed: catenary.rodeOnSeabed,
    lowWaterChainLifted: lowWaterCatenary.chainLifted,
    lowWaterChainOnSeabed: lowWaterCatenary.chainOnSeabed,
    highWaterChainLifted: highWaterCatenary.chainLifted,
    highWaterChainOnSeabed: highWaterCatenary.chainOnSeabed,
    highWaterAnchorAngle,
    anchorHoldingFactor,
    effectiveAnchorHolding,
    anchorHoldingMargin,
    ...windDragLimit,
    liftWeight: catenary.liftWeight,
    windForce,
    tidalForce,
    horizontalLoad,
    catenaryPoints: catenary.liftedPoints,
    catenarySpliceIndex: catenary.spliceIndex,
    anchorAngle: catenary.anchorAngle,
    lowLoadCatenary: catenary.lowLoad,
    chainA: catenary.chainA,
    ropeA: catenary.ropeA,
    shortfall,
    keelClearance,
    lowWaterClearance,
    clearanceMargin
  };
}

function calculate() {
  const input = currentInputs();
  return calculateForDepth(input, chartedDepthFor(input));
}

function calculateScenarioResult(tideHeight) {
  const input = currentInputs();
  return calculateForDepth({ ...input, tideHeight }, chartedDepthFor(input));
}

function calculateDiagramResult() {
  return calculate();
}

function calculateIdealRode(input = currentInputs()) {
  const depthLw = chartedDepthFor(input);
  const hwDepth = depthLw + input.hwHeight;
  const verticalDrop = Math.max(0.1, hwDepth + input.bowHeight);
  const totalRode = input.chainLength + input.ropeLength;
  const wind = input.windSpeed;
  const windForce = calculateWindForce(input, wind);
  const tidalForce = calculateTidalForce(input);
  const horizontalLoad = windForce + tidalForce;
  const equivalentWind = Math.sqrt(horizontalLoad / Math.max(0.001, 0.0165 * input.loa * input.loa * input.windageFactor));
  let desired = 3;

  if (equivalentWind > 15) desired = 4;
  if (equivalentWind > 25) desired = 5;
  if (equivalentWind > 35) desired = 6;
  if (equivalentWind > 45) desired = 7;
  if (equivalentWind > 55) desired = 8;
  if (equivalentWind > 65) desired = 9;
  if (input.hwHeight >= 4 || hwDepth >= 10) desired += 0.5;

  const minimumLength = desired * verticalDrop;
  const minimumRode = round(Math.min(minimumLength, totalRode), 0);
  const minimumResult = calculateForDepth({ ...input, rodeLength: minimumRode, tideHeight: input.hwHeight }, depthLw);
  const optimalTarget = 1;
  const totalResult = calculateForDepth({ ...input, rodeLength: totalRode, tideHeight: input.hwHeight }, depthLw);
  let optimalRode = totalRode;
  let optimalCapped = totalResult.highWaterChainOnSeabed < optimalTarget;

  if (!optimalCapped && minimumResult.highWaterChainOnSeabed >= optimalTarget) {
    optimalRode = minimumRode;
  } else if (!optimalCapped) {
    let low = minimumRode;
    let high = totalRode;
    for (let index = 0; index < 42; index += 1) {
      const mid = (low + high) / 2;
      const result = calculateForDepth({ ...input, rodeLength: mid, tideHeight: input.hwHeight }, depthLw);
      if (result.highWaterChainOnSeabed >= optimalTarget) high = mid;
      else low = mid;
    }
    optimalRode = Math.ceil(high);
  }

  const optimalResult = calculateForDepth({ ...input, rodeLength: optimalRode, tideHeight: input.hwHeight }, depthLw);
  const notes = [];

  notes.push(`${fmt(wind, 0, " kn")} wind plus ${fmt(input.tidalStream, 1, " kn")} tidal stream gives an equivalent load of about ${fmt(equivalentWind, 0, " kn")} wind.`);
  notes.push(`Minimum uses ${fmt(desired, 1, ":1")} selected-HW scope from the load table.`);
  if (minimumLength > totalRode) notes.push(`Available rode caps the minimum at ${fmt(totalRode, 1, " m")}.`);
  if (optimalCapped) {
    notes.push(`Optimal would need more than the carried ${fmt(totalRode, 1, " m")} to keep ${fmt(optimalTarget, 1, " m")} of chain on the seabed at selected HW.`);
  } else {
    notes.push(`Optimal is the shortest rode that keeps at least ${fmt(optimalTarget, 1, " m")} of chain on the seabed at selected HW.`);
  }

  return {
    rodeLength: optimalRode,
    minimumRode,
    optimalRode,
    minimumScope: minimumResult.scopeRatio,
    optimalScope: optimalResult.scopeRatio,
    scope: optimalResult.scopeRatio,
    shortfall: optimalResult.shortfall,
    ropeOnSeabed: optimalResult.ropeOnSeabed,
    minimumHighWaterChainOnSeabed: minimumResult.highWaterChainOnSeabed,
    highWaterChainOnSeabed: optimalResult.highWaterChainOnSeabed,
    optimalCapped,
    notes
  };
}

function showIdealRodeRecommendation(recommendation) {
  const panel = document.getElementById("scopeRecommendation");
  panel.classList.add("hasRecommendation");
  document.getElementById("minimumRodeRecommendation").textContent = fmt(recommendation.minimumRode, 0, " m");
  document.getElementById("optimalRodeRecommendation").textContent = recommendation.optimalCapped ? `${fmt(recommendation.optimalRode, 0, " m")} max` : fmt(recommendation.optimalRode, 0, " m");
  panel.querySelector("p").textContent = `${recommendation.notes.join(" ")} Minimum selected-HW scope: ${fmt(recommendation.minimumScope, 1, ":1")}. Optimal selected-HW scope: ${fmt(recommendation.optimalScope, 1, ":1")}.`;
}

function clearIdealRodeRecommendation() {
  const panel = document.getElementById("scopeRecommendation");
  panel.classList.remove("hasRecommendation");
  document.getElementById("minimumRodeRecommendation").textContent = "-";
  document.getElementById("optimalRodeRecommendation").textContent = "-";
  panel.querySelector("p").textContent = "Use the button to calculate minimum and optimal rode recommendations from the conditions now and boat settings.";
}

function applyServerStateToTideFields() {
  const oban = obanTideValuesForNow();
  const reference = serverState.tide.obanReferenceLevels;
  const date = oban.date || obanDate();
  document.getElementById("hwTime").value = timeFromUtcForDisplay(oban.hwTime || "15:00", date);
  document.getElementById("lwTime").value = timeFromUtcForDisplay(oban.lwTime || "09:00", date);
  document.getElementById("hwHeight").value = oban.hwHeight ?? 4;
  document.getElementById("lwHeight").value = oban.lwHeight ?? 1;
  document.getElementById("hwTimeUnit").textContent = timeBasisLabel();
  document.getElementById("lwTimeUnit").textContent = timeBasisLabel();
  document.getElementById("obanMhws").value = reference.mhws ?? 4.0;
  document.getElementById("obanMhwn").value = reference.mhwn ?? 2.9;
  document.getElementById("obanMlwn").value = reference.mlwn ?? 1.8;
  document.getElementById("obanMlws").value = reference.mlws ?? 0.7;
  renderObanReferenceLabels();
  document.getElementById("secondaryPortSelect").value = serverState.tide.selectedPortId || "";
  document.querySelectorAll(".tideSourceButton").forEach((button) => {
    button.classList.toggle("active", button.dataset.tideSource === serverState.tide.source);
  });
  renderSecondaryTidePreview();
}

function obanReferenceFromFields() {
  return {
    mhws: number("obanMhws"),
    mhwn: number("obanMhwn"),
    mlwn: number("obanMlwn"),
    mlws: number("obanMlws")
  };
}

function renderObanReferenceLabels() {
  const reference = serverState.tide.obanReferenceLevels;
  document.getElementById("obanMhwsLabel").textContent = fmt(Number(reference.mhws || 0), 1, "");
  document.getElementById("obanMhwnLabel").textContent = fmt(Number(reference.mhwn || 0), 1, "");
  document.getElementById("obanMlwnLabel").textContent = fmt(Number(reference.mlwn || 0), 1, "");
  document.getElementById("obanMlwsLabel").textContent = fmt(Number(reference.mlws || 0), 1, "");
}

function renderSecondaryPortOptions() {
  const select = document.getElementById("secondaryPortSelect");
  select.innerHTML = [
    `<option value="">No secondary port selected</option>`,
    ...serverState.secondaryPorts
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((port) => `<option value="${escapeHtml(port.id)}">${escapeHtml(port.name)}</option>`)
  ].join("");
  select.value = serverState.tide.selectedPortId || "";
}

function renderSecondaryTidePreview() {
  const port = selectedSecondaryPort();
  if (!port && serverState.tide.source === "secondary") serverState.tide.source = "oban";
  const showSecondary = Boolean(port && serverState.tide.source === "secondary");
  const secondary = secondaryTideValues(port);
  document.getElementById("secondaryHwTime").textContent = showSecondary ? secondary.hwTime : "-";
  document.getElementById("secondaryLwTime").textContent = showSecondary ? secondary.lwTime : "-";
  document.getElementById("secondaryHwHeight").textContent = showSecondary ? fmt(secondary.hwHeight, 1, " m") : "-";
  document.getElementById("secondaryLwHeight").textContent = showSecondary ? fmt(secondary.lwHeight, 1, " m") : "-";
  document.querySelector('[data-tide-source="secondary"]').disabled = !port;
  document.querySelectorAll(".tideSourceButton").forEach((button) => {
    button.classList.toggle("active", button.dataset.tideSource === serverState.tide.source);
  });
}

function renderSecondaryPortsTable() {
  const tbody = document.querySelector("#secondaryPortsTable tbody");
  if (!serverState.secondaryPorts.length) {
    tbody.innerHTML = `<tr><td colspan="6">No secondary ports saved yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = serverState.secondaryPorts
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((port) => {
      const hwOffsets = portOffsets(port, "hw");
      const lwOffsets = portOffsets(port, "lw");
      const heightDiffs = portHeightDiffs(port);
      const hwTime = `0000 ${fmtOffset(hwOffsets.t0000)} / 0600 ${fmtOffset(hwOffsets.t0600)} / 1200 ${fmtOffset(hwOffsets.t1200)} / 1800 ${fmtOffset(hwOffsets.t1800)}`;
      const lwTime = `0000 ${fmtOffset(lwOffsets.t0000)} / 0600 ${fmtOffset(lwOffsets.t0600)} / 1200 ${fmtOffset(lwOffsets.t1200)} / 1800 ${fmtOffset(lwOffsets.t1800)}`;
      const reference = portReferenceLevels(port);
      const heights = `MHWS ${fmt(Number(reference.mhws || 0), 1, "")} ${fmt(Number(heightDiffs.mhws || 0), 1, " m")} / MHWN ${fmt(Number(reference.mhwn || 0), 1, "")} ${fmt(Number(heightDiffs.mhwn || 0), 1, " m")} / MLWN ${fmt(Number(reference.mlwn || 0), 1, "")} ${fmt(Number(heightDiffs.mlwn || 0), 1, " m")} / MLWS ${fmt(Number(reference.mlws || 0), 1, "")} ${fmt(Number(heightDiffs.mlws || 0), 1, " m")}`;
      return `
      <tr>
        <td>${escapeHtml(port.name)}<span class="tableSubtext">${escapeHtml(portStandardPort(port))}</span></td>
        <td>${escapeHtml(hwTime)}</td>
        <td>${escapeHtml(lwTime)}</td>
        <td>${escapeHtml(heights)}</td>
        <td>${escapeHtml(port.notes || "")}</td>
        <td class="tableActions">
          <button type="button" data-edit-secondary="${escapeHtml(port.id)}">Edit</button>
          <button type="button" class="dangerButton" data-delete-secondary="${escapeHtml(port.id)}">Delete</button>
        </td>
      </tr>
    `;
    }).join("");
}

function clearSecondaryPortForm() {
  editingSecondaryPortId = null;
  document.getElementById("secondaryPortName").value = "";
  ["0000", "0600", "1200", "1800"].forEach((time) => {
    document.getElementById(`secondaryHw${time}`).value = "0";
    document.getElementById(`secondaryLw${time}`).value = "0";
  });
  document.getElementById("secondaryDiffMhws").value = "0";
  document.getElementById("secondaryDiffMhwn").value = "0";
  document.getElementById("secondaryDiffMlwn").value = "0";
  document.getElementById("secondaryDiffMlws").value = "0";
  document.getElementById("secondaryPortNotes").value = "";
  document.getElementById("saveSecondaryPort").textContent = "Add secondary port";
}

function renderSecondaryPortManager() {
  renderSecondaryPortOptions();
  renderSecondaryTidePreview();
  renderSecondaryPortsTable();
}

function sortedTideEvents() {
  return Array.isArray(serverState.tideData.events)
    ? serverState.tideData.events
      .filter((event) => event.EventType === "HighWater" || event.EventType === "LowWater")
      .slice()
      .sort((a, b) => eventTimestamp(a) - eventTimestamp(b))
    : [];
}

function eventLabel(event) {
  return event.EventType === "HighWater" ? "HW" : "LW";
}

function eventDate(event) {
  return String(event.DateTime || "").slice(0, 10);
}

function eventTime(event) {
  return String(event.DateTime || "").slice(11, 16);
}

function pairedTideRange(events, index) {
  const event = events[index];
  const previous = events.slice(0, index).reverse().find((candidate) => candidate.EventType !== event.EventType);
  const next = events.slice(index + 1).find((candidate) => candidate.EventType !== event.EventType);
  const paired = [previous, next]
    .filter(Boolean)
    .sort((a, b) => Math.abs(eventTimestamp(a) - eventTimestamp(event)) - Math.abs(eventTimestamp(b) - eventTimestamp(event)))[0];
  return paired ? Math.abs(eventHeight(event) - eventHeight(paired)) : Number.NaN;
}

function applyTideDataFields() {
  const tideData = serverState.tideData;
  document.getElementById("tideDataStationName").value = tideData.stationName || "Oban";
  document.getElementById("tideDataStationId").value = tideData.stationId || "0372";
  document.getElementById("tideDataTimeStandard").value = tideData.timeStandard || "UT";
  document.getElementById("tideDataDisplayMode").value = displayTimeMode();
  document.getElementById("tideDataAccountEmail").value = tideData.ukhoAccountEmail || "";
}

function renderTideDataManager() {
  const tideData = serverState.tideData;
  const events = sortedTideEvents();
  if (document.activeElement?.id !== "tideDataStationName") document.getElementById("tideDataStationName").value = tideData.stationName || "Oban";
  if (document.activeElement?.id !== "tideDataStationId") document.getElementById("tideDataStationId").value = tideData.stationId || "0372";
  if (document.activeElement?.id !== "tideDataTimeStandard") document.getElementById("tideDataTimeStandard").value = tideData.timeStandard || "UT";
  if (document.activeElement?.id !== "tideDataDisplayMode") document.getElementById("tideDataDisplayMode").value = displayTimeMode();
  if (document.activeElement?.id !== "tideDataAccountEmail") document.getElementById("tideDataAccountEmail").value = tideData.ukhoAccountEmail || "";
  document.getElementById("tideDataStationLabel").textContent = `${tideData.stationName || "Oban"} ${tideData.stationId || "0372"} (${timeBasisLabel()})`;
  document.getElementById("tideDataKeyLabel").textContent = tideData.ukhoApiKeySet ? "Set" : "Not set";
  document.getElementById("tideDataFetchedLabel").textContent = fmtDateTime(tideData.cache?.fetchedAt);
  document.getElementById("tideDataCountLabel").textContent = String(events.length);
  document.getElementById("tideDataStatusLabel").textContent = tideData.cache?.offlineFallback
    ? "Using stored offline tide data"
    : tideData.cache?.stale
      ? "Using stale cache"
      : tideData.cache?.hit
        ? "Using cache"
        : tideData.cache?.fetchedAt
          ? "Fresh fetch"
          : "No tide data loaded";
  const tbody = document.querySelector("#tideDataTable tbody");
  if (!events.length) {
    tbody.innerHTML = `<tr><td colspan="5">No fetched tide events yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = events.map((event, index) => {
    const range = pairedTideRange(events, index);
    const spring = springPercentFromRange(range);
    const display = eventDisplayParts(event);
    return `
      <tr>
        <td>${escapeHtml(display.date)}</td>
        <td>${eventLabel(event)}</td>
        <td>${escapeHtml(display.time)} ${escapeHtml(display.label)}</td>
        <td>${fmt(Number(event.Height), 2, " m")}</td>
        <td>${Number.isFinite(spring) ? fmt(spring, 0, "%") : "-"}</td>
      </tr>
    `;
  }).join("");
}

function persistTideStateFromFields() {
  serverState.tide.oban = obanTideFromFields();
  saveServerStateSoon();
}

function persistObanReferenceFromFields() {
  serverState.tide.obanReferenceLevels = obanReferenceFromFields();
  renderObanReferenceLabels();
  saveServerStateSoon();
}

function formatClock(date) {
  if (displayTimeMode() === "ut") {
    return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UT`;
  }
  return `${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} local`;
}

function interpolateTwelfths(progress) {
  const clamped = Math.max(0, Math.min(1, progress));
  const segment = Math.min(5, Math.floor(clamped * 6));
  const segmentStart = segment / 6;
  const segmentProgress = (clamped - segmentStart) * 6;
  const twelfths = [0, 1, 3, 6, 9, 11, 12];
  return (twelfths[segment] + (twelfths[segment + 1] - twelfths[segment]) * segmentProgress) / 12;
}

function tideHeightBetween(before, after, minute) {
  const duration = Math.max(1, after.minute - before.minute);
  const progress = (minute - before.minute) / duration;
  const fraction = interpolateTwelfths(progress);
  if (before.type === "LW" && after.type === "HW") return before.height + (after.height - before.height) * fraction;
  return before.height - (before.height - after.height) * fraction;
}

function secondaryEventFromObanEvent(port, event) {
  const type = eventTypeShort(event);
  const height = eventHeight(event);
  const reference = serverState.tide.obanReferenceLevels;
  const heightDiffs = portHeightDiffs(port);
  if (type === "HW") {
    const factor = springFactor(height, Number(reference.mhwn || 0), Number(reference.mhws || 0));
    return {
      type,
      timestamp: eventTimestamp(event) + interpolateTimeOffset(portOffsets(port, "hw"), timeToMinutes(eventTime(event))) * 60000,
      height: height + interpolateOffset(heightDiffs.mhwn, heightDiffs.mhws, factor)
    };
  }
  const factor = lowWaterSpringFactor(height, Number(reference.mlwn || 0), Number(reference.mlws || 0));
  return {
    type,
    timestamp: eventTimestamp(event) + interpolateTimeOffset(portOffsets(port, "lw"), timeToMinutes(eventTime(event))) * 60000,
    height: height + interpolateOffset(heightDiffs.mlwn, heightDiffs.mlws, factor)
  };
}

function activeTideTimeline(date = new Date()) {
  const events = sortedTideEvents().filter((event) => Number.isFinite(eventTimestamp(event)) && Number.isFinite(eventHeight(event)));
  if (events.length < 2) return null;
  const port = serverState.tide.source === "secondary" ? selectedSecondaryPort() : null;
  const dayStart = displayDayStart(date);
  const timeline = events
    .map((event) => {
      const corrected = port ? secondaryEventFromObanEvent(port, event) : {
        type: eventTypeShort(event),
        timestamp: eventTimestamp(event),
        height: eventHeight(event)
      };
      return {
        ...corrected,
        minute: (corrected.timestamp - dayStart) / 60000
      };
    })
    .filter((event) => event.minute >= -1500 && event.minute <= 3300)
    .sort((a, b) => a.minute - b.minute);
  return timeline.length >= 2 ? timeline : null;
}

function fallbackTideTimeline(date = new Date()) {
  const tide = activeTideValues(date);
  const dayStart = displayDayStart(date);
  return tideEventsForRange(tide, -1500, 3300).map((event) => ({
    ...event,
    timestamp: dayStart + event.minute * 60000
  }));
}

function plannerTideTimeline(date = new Date()) {
  return activeTideTimeline(date) || fallbackTideTimeline(date);
}

function tideBracketFromTimeline(timeline, date = new Date()) {
  const nowMinute = (date.getTime() - displayDayStart(date)) / 60000;
  for (let index = 0; index < timeline.length - 1; index += 1) {
    if (
      timeline[index].minute <= nowMinute
      && nowMinute <= timeline[index + 1].minute
      && timeline[index].type !== timeline[index + 1].type
    ) {
      return { before: timeline[index], after: timeline[index + 1], nowMinute, beforeIndex: index, afterIndex: index + 1 };
    }
  }
  return null;
}

function bracketingActiveTideEvents(now = new Date()) {
  const timeline = activeTideTimeline(now);
  return timeline ? tideBracketFromTimeline(timeline, now) : null;
}

function tideEventsForRange(tide, startMinute, endMinute) {
  const baseEvents = [
    { type: "HW", minute: timeToMinutes(tide.hwTime), height: Number(tide.hwHeight || 0) },
    { type: "LW", minute: timeToMinutes(tide.lwTime), height: Number(tide.lwHeight || 0) }
  ];
  const events = [];
  for (const shift of [-3, -2, -1, 0, 1, 2, 3]) {
    for (const event of baseEvents) events.push({ ...event, minute: event.minute + shift * halfCycleMinutes });
  }
  return events
    .filter((event) => event.minute >= startMinute - halfCycleMinutes && event.minute <= endMinute + halfCycleMinutes)
    .sort((a, b) => a.minute - b.minute);
}

function tideAtMinute(tide, minute, timeline = null) {
  const events = timeline || tideEventsForRange(tide, minute - 800, minute + 800);
  for (let index = 0; index < events.length - 1; index += 1) {
    if (events[index].minute <= minute && minute <= events[index + 1].minute && events[index].type !== events[index + 1].type) {
      return tideHeightBetween(events[index], events[index + 1], minute);
    }
  }
  return Number(tide.lwHeight || 0);
}

function tideViewEventKey(event) {
  return `event-${event.type}-${Math.round(Number(event.timestamp || 0))}`;
}

function tideViewTime(event) {
  if (Number.isFinite(event.timestamp)) {
    const date = new Date(event.timestamp);
    return displayTimeMode() === "ut"
      ? `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`
      : `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return minutesToTime(event.minute);
}

function tideViewDate(event) {
  return Number.isFinite(event.timestamp)
    ? new Date(event.timestamp)
    : new Date(displayDayStart(new Date()) + event.minute * 60000);
}

function tideEventView(event, groupLabel) {
  const time = tideViewTime(event);
  return {
    key: tideViewEventKey(event),
    label: `${groupLabel} ${event.type}`,
    group: groupLabel,
    time,
    height: Number(event.height || 0),
    type: event.type,
    date: tideViewDate(event),
    title: `Show the planner at ${groupLabel.toLowerCase()} ${event.type}: ${time} ${timeBasisLabel()}, tide height ${fmt(Number(event.height || 0), 1, " m")}. Safety checks use the ${groupLabel.toLowerCase()} HW/LW pair.`
  };
}

function plannerTideViews(now = new Date()) {
  const timeline = plannerTideTimeline(now);
  const bracket = tideBracketFromTimeline(timeline, now);
  if (!bracket) {
    const input = baseInputs(now);
    return [{
      key: "now",
      label: "Now",
      group: "Now",
      time: formatClock(now),
      height: tideHeightForDate(input, now),
      type: "Now",
      date: now,
      title: `Show the planner at the present time, ${formatClock(now)}. Safety checks use the next HW/LW pair.`
    }];
  }

  const { beforeIndex, afterIndex, before, after, nowMinute } = bracket;
  const nowHeight = tideHeightBetween(before, after, nowMinute);
  const previousEvents = timeline.slice(Math.max(0, beforeIndex - 1), beforeIndex + 1);
  const nextEvents = timeline.slice(afterIndex, afterIndex + 2);
  const subsequentEvents = timeline.slice(afterIndex + 2, afterIndex + 4);

  return [
    ...previousEvents.map((event) => tideEventView(event, "Previous")),
    {
      key: "now",
      label: "Now",
      group: "Now",
      time: formatClock(now),
      height: nowHeight,
      type: "Now",
      date: now,
      title: `Show the planner at the present time, ${formatClock(now)}, tide height ${fmt(nowHeight, 1, " m")}. Safety checks use the next HW/LW pair.`
    },
    ...nextEvents.map((event) => tideEventView(event, "Next")),
    ...subsequentEvents.map((event) => tideEventView(event, "Subsequent"))
  ];
}

function selectedPlannerTideView() {
  const views = plannerTideViews();
  return views.find((view) => view.key === selectedTideViewKey) || views.find((view) => view.key === "now") || views[0];
}

function currentTide(now = new Date()) {
  const input = baseInputs(now);
  const { before, after, nowMinutes } = tideBracketForDate(input, now);

  const rising = before.type === "LW" && after.type === "HW";
  const height = tideHeightBetween(before, after, nowMinutes);
  const chartedDepth = chartedDepthFor({ ...input, tideHeight: height }, height);
  const currentDepth = chartedDepth + height;
  const lowWaterDepth = chartedDepth + input.lwHeight;
  const keelClearance = currentDepth - input.draft;
  const lowWaterClearance = lowWaterDepth - input.draft;
  return {
    height,
    currentDepth,
    keelClearance,
    lowWaterDepth,
    lowWaterClearance,
    clearanceMargin: lowWaterClearance - input.minClearance,
    phase: rising ? "Rising" : "Falling",
    from: before,
    to: after,
    now
  };
}

function updateTideSummary() {
  const tide = currentTide(new Date());
  const spring = springPercentageForNow();
  const tideSourceLabel = serverState.tide.source === "secondary" && selectedSecondaryPort()
    ? selectedSecondaryPort().name
    : "Oban";
  document.getElementById("tideHeight").value = round(tide.height, 1);
  document.getElementById("currentTimeLabel").textContent = formatClock(tide.now);
  document.getElementById("currentRiseLabel").textContent = `${fmt(tide.height, 1, " m")} ${tide.phase.toLowerCase()}`;
  document.getElementById("springPercentLabel").textContent = Number.isFinite(spring) ? fmt(spring, 0, "%") : "-";
  document.getElementById("currentDepthLabel").textContent = fmt(tide.keelClearance, 1, " m");
  document.getElementById("lowWaterClearanceLabel").textContent = fmt(tide.lowWaterClearance, 1, " m");

  const status = document.getElementById("tideStatus");
  status.className = "statusBanner";
  if (tide.lowWaterClearance < 0) {
    status.classList.add("danger");
    status.textContent = `Grounding risk at low water: predicted depth is ${fmt(Math.abs(tide.lowWaterClearance), 1, " m")} below draft.`;
  } else if (tide.clearanceMargin < 0) {
    status.classList.add("warning");
    status.textContent = `Low-water clearance is ${fmt(tide.lowWaterClearance, 1, " m")}, below the ${fmt(number("minClearance"), 1, " m")} minimum.`;
  } else {
    status.textContent = `Low-water clearance is ${fmt(tide.lowWaterClearance, 1, " m")} using ${tideSourceLabel} tide values.`;
  }
  return tide;
}

function updatePlannerTideControl() {
  const views = plannerTideViews();
  const selected = views.find((view) => view.key === selectedTideViewKey) || views.find((view) => view.key === "now") || views[0];
  selectedTideViewKey = selected.key;
  document.getElementById("tideHeight").value = round(selected.height, 1);
  const tabs = document.getElementById("diagramTabs");
  tabs.innerHTML = views.map((view) => `
    <button class="diagramTab${view.key === selected.key ? " active" : ""}" type="button" data-tide-view="${escapeHtml(view.key)}" title="${escapeHtml(view.title)}">
      <span>${escapeHtml(view.label)}</span>
      <small>${escapeHtml(view.time)} ${escapeHtml(fmt(view.height, 1, " m"))}</small>
    </button>
  `).join("");
  return selected;
}

function statusText(result) {
  if (result.lowWaterClearance < 0) {
    return {
      level: "danger",
      text: `Grounding risk at selected low water: predicted depth is ${fmt(Math.abs(result.lowWaterClearance), 1, " m")} less than draft.`
    };
  }
  if (result.clearanceMargin < 0) {
    return {
      level: "warning",
      text: `Selected low-water clearance is ${fmt(result.lowWaterClearance, 1, " m")}, below the ${fmt(number("minClearance"), 1, " m")} minimum.`
    };
  }
  if (result.shortfall > 0) {
    return {
      level: "danger",
      text: `Rode is longer than available rode by ${fmt(result.shortfall, 1, " m")}.`
    };
  }
  if (result.anchorHoldingMargin < 0) {
    return {
      level: "danger",
      text: `Anchor drag risk at selected high water: estimated holding is ${fmt(result.effectiveAnchorHolding, 0, " kgf")} against ${fmt(result.horizontalLoad, 0, " kgf")} load.`
    };
  }
  if (result.anchorHoldingMargin < result.horizontalLoad * 0.25) {
    return {
      level: "warning",
      text: `Anchor holding margin is low at selected high water: about ${fmt(result.anchorHoldingMargin, 0, " kgf")} after pull-angle allowance.`
    };
  }
  if (result.lowWaterRopeOnSeabed > 0) {
    return {
      level: "warning",
      text: `${fmt(result.lowWaterRopeOnSeabed, 1, " m")} of rope is on the seabed at low water. Check abrasion and chafe risk.`
    };
  }
  if (result.highWaterChainOnSeabed < 5) {
    return {
      level: "warning",
      text: `Estimated catenary leaves only ${fmt(result.highWaterChainOnSeabed, 1, " m")} of chain on the seabed at selected high water.`
    };
  }
  return {
    level: "good",
    text: `Rode length is within available rode, with about ${fmt(result.highWaterChainOnSeabed, 1, " m")} of chain on the seabed at selected high water.`
  };
}

function updateSummary(result) {
  document.getElementById("windForce").textContent = fmt(result.windForce, 0, " kg");
  document.getElementById("tidalForce").textContent = fmt(result.tidalForce, 0, " kg");
  document.getElementById("rodeNeeded").textContent = fmt(result.rodeLength, 1, " m");
  document.getElementById("clearanceNow").textContent = fmt(result.keelClearance, 1, " m");
  document.getElementById("scopeNow").textContent = fmt(result.scopeRatio, 1, ":1");
  document.getElementById("seabedLength").textContent = fmt(result.highWaterChainOnSeabed, 1, " m");
  document.getElementById("liftWeight").textContent = fmt(result.liftWeight, 1, " kg");
  document.getElementById("ropeSeabed").textContent = fmt(result.ropeOnSeabed, 1, " m");
  document.getElementById("chainSeabed").textContent = fmt(result.chainOnSeabed, 1, " m");
  document.getElementById("anchorMargin").textContent = fmt(result.anchorHoldingMargin, 0, " kgf");
  document.getElementById("windDragLimit").textContent = `${fmt(result.maxWindSpeedBeforeDrag, 0, " kn")} / ${fmt(result.maxWindForceBeforeDrag, 0, " kgf")}`;

  const status = statusText(result);
  const banner = document.getElementById("statusBanner");
  banner.className = `statusBanner ${status.level === "good" ? "" : status.level}`;
  banner.textContent = status.text;
  banner.title = "Overall planning warning. Grounding uses the selected low-water event; anchor holding and catenary margin use the selected high-water event.";
}

function updateDepthComparison() {
  const input = currentInputs();
  const echoIsBelowKeel = document.getElementById("echoMeasuresBelowKeel").checked;
  const chartDepth = chartDepthNow(input);
  const measuredDepth = sounderDepthNow(input);
  const difference = measuredDepth - chartDepth;

  const label = document.getElementById("echoDepthLabel");
  label.childNodes[0].nodeValue = echoIsBelowKeel ? "Echo below keel now\n                " : "Echo water depth now\n                ";
  label.title = echoIsBelowKeel
    ? "Echo sounder reading now as depth beneath the keel. The app adds draft to get water depth."
    : "Echo sounder reading now as actual water depth from the surface. Draft is not added.";
  document.getElementById("chartDepthNow").textContent = fmt(chartDepth, 1, " m");
  document.getElementById("sounderDepthNow").textContent = fmt(measuredDepth, 1, " m");
  document.getElementById("depthDifference").textContent = `${difference >= 0 ? "+" : ""}${fmt(difference, 1, " m")}`;
}

function svg(tag, attrs = {}, children = []) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  children.forEach((child) => el.appendChild(child));
  return el;
}

function pathFromPhysicalPoints(points, anchorX, seabedY, scale, seabedOffset, start = 0, end = points.length) {
  return points.slice(start, end).map((point, index) => {
    const x = anchorX - (seabedOffset + point.x) * scale;
    const y = seabedY - point.y * scale;
    return `${index === 0 ? "M" : "L"}${round(x, 2)} ${round(y, 2)}`;
  }).join(" ");
}

function renderDiagram(result, view = selectedPlannerTideView()) {
  const input = currentInputs();
  const target = document.getElementById("rodeDiagram");
  target.innerHTML = "";
  const modeLabel = view.label || "Now";

  const width = 860;
  const height = 300;
  const seabedY = 222;
  const verticalDrop = Math.max(0.1, result.depthHw + input.bowHeight);
  const horizontalReach = result.horizontalReach;
  const hwResult = calculateScenarioResult(input.hwHeight);
  const lwResult = calculateScenarioResult(input.lwHeight);
  const moveFromHw = horizontalReach - hwResult.horizontalReach;
  const visibleRun = Math.max(horizontalReach, hwResult.horizontalReach, lwResult.horizontalReach, result.amountOnSeabed, input.loa, 10);
  const maxVerticalDrop = Math.max(verticalDrop, hwResult.verticalDrop, lwResult.verticalDrop);
  const scale = Math.min(650 / visibleRun, 156 / maxVerticalDrop);
  const anchorX = 790;
  const bowX = anchorX - horizontalReach * scale;
  const waterY = seabedY - result.depthHw * scale;
  const lowWaterY = seabedY - result.depthLw * scale;
  const bowPointY = seabedY - verticalDrop * scale;
  const anchorY = seabedY;
  const lowWaterTouchX = Math.max(bowX, anchorX - result.amountOnSeabed * scale);
  const boatLengthPx = Math.max(72, Math.min(150, input.loa * scale));
  const bowHeightPx = input.bowHeight * scale;
  const draftPx = input.draft * scale;
  const sternDeckY = waterY - bowHeightPx * 0.35;
  const bowDeckY = waterY - bowHeightPx;
  const hullBottomY = waterY + draftPx * 0.16;
  const boatSternX = bowX - boatLengthPx;
  const keelCenterX = boatSternX + boatLengthPx * 0.52;
  const keelTopY = hullBottomY - 1;
  const keelBottomY = waterY + draftPx;
  const keelHalfWidth = Math.max(8, Math.min(20, boatLengthPx * 0.11));
  const keelHitsBottom = keelBottomY >= seabedY;
  const keelClearanceLineX = keelCenterX + keelHalfWidth + 14;
  const keelClearanceMidY = (keelBottomY + seabedY) / 2;
  const keelClearanceColor = result.keelClearance < 0 ? "#b44444" : "#1f6f8b";
  const labelX = Math.min(anchorX - 170, Math.max(bowX + 120, bowX + horizontalReach * scale * 0.48));
  const rodeMidY = (bowPointY + anchorY) / 2 - 10;
  const ropeDeployed = result.ropeDeployed;
  const ropeLifted = result.ropeLifted || 0;
  const chainDeployed = Math.min(result.deployedRode, input.chainLength);
  const chainSeabedEndX = anchorX - result.chainOnSeabed * scale;
  const liftedStartOffset = result.chainOnSeabed + result.ropeOnSeabed;
  const liftedStartX = anchorX - liftedStartOffset * scale;
  const hwBowX = anchorX - hwResult.horizontalReach * scale;
  const hasRopeLifted = ropeLifted > 0.05;
  const chainPath = pathFromPhysicalPoints(result.catenaryPoints, anchorX, seabedY, scale, result.chainOnSeabed, 0, result.catenarySpliceIndex + 1);
  const ropePath = pathFromPhysicalPoints(result.catenaryPoints, anchorX, seabedY, scale, liftedStartOffset, result.catenarySpliceIndex, result.catenaryPoints.length);
  const anchorAngleDeg = Math.abs(result.anchorAngle * 180 / Math.PI);
  const catenaryLabel = result.lowLoadCatenary
    ? `${modeLabel}: calm layout, rope drawn straight`
    : result.chainOnSeabed > 0.05
    ? `${modeLabel} catenary: ${fmt(result.chainLifted, 1, " m")} chain lifted`
    : `${modeLabel} catenary: chain fully lifted, anchor angle ${fmt(anchorAngleDeg, 0, " deg")}`;
  const sternDistance = horizontalReach + input.loa;
  const distanceY = seabedY + 60;
  const distanceStartX = Math.max(18, boatSternX);

  target.append(
    svg("rect", { x: 0, y: waterY, width, height: seabedY - waterY, fill: "#dbeef7" }),
    svg("rect", { x: 0, y: seabedY, width, height: height - seabedY, fill: "#d7c4a3" }),
    svg("line", { x1: 0, y1: waterY, x2: width, y2: waterY, stroke: "#1f6f8b", "stroke-width": 3 }),
    svg("line", { x1: 0, y1: lowWaterY, x2: width, y2: lowWaterY, stroke: "#5aa5c9", "stroke-width": 2, "stroke-dasharray": "7 6" }),
    ...(view.type !== "HW" ? [
      svg("line", { x1: hwBowX, y1: seabedY + 16, x2: bowX, y2: seabedY + 16, stroke: "#7a6a45", "stroke-width": 2, "stroke-dasharray": "5 5" }),
      svg("text", { x: Math.min(hwBowX, bowX) + 8, y: seabedY + 44, fill: "#17212b", "font-size": 15 }, [document.createTextNode(`${fmt(Math.abs(moveFromHw), 1, " m")} from HW set position`)])
    ] : []),
    svg("path", { d: `M${boatSternX} ${sternDeckY} L${bowX - 10} ${bowDeckY} L${bowX} ${bowPointY} L${bowX - 14} ${waterY + draftPx * 0.08} L${boatSternX + 22} ${hullBottomY} Z`, fill: "#ffffff", stroke: "#17212b", "stroke-width": 2 }),
    svg("path", { d: `M${keelCenterX - keelHalfWidth} ${keelTopY} L${keelCenterX + keelHalfWidth} ${keelTopY} L${keelCenterX + keelHalfWidth * 0.55} ${keelBottomY} L${keelCenterX - keelHalfWidth * 0.55} ${keelBottomY} Z`, fill: keelHitsBottom ? "#d76c6c" : "#6f7f8a", stroke: "#17212b", "stroke-width": 2, opacity: 0.95 }),
    svg("line", { x1: keelClearanceLineX, y1: keelBottomY, x2: keelClearanceLineX, y2: seabedY, stroke: keelClearanceColor, "stroke-width": 2 }),
    svg("line", { x1: keelClearanceLineX - 6, y1: keelBottomY, x2: keelClearanceLineX + 6, y2: keelBottomY, stroke: keelClearanceColor, "stroke-width": 2 }),
    svg("line", { x1: keelClearanceLineX - 6, y1: seabedY, x2: keelClearanceLineX + 6, y2: seabedY, stroke: keelClearanceColor, "stroke-width": 2 }),
    svg("text", { x: keelClearanceLineX + 10, y: Math.min(seabedY - 8, Math.max(waterY + 16, keelClearanceMidY + 4)), fill: keelClearanceColor, "font-size": 15, "font-weight": 700 }, [document.createTextNode(`${modeLabel} ${fmt(result.keelClearance, 1, " m")}`)]),
    svg("circle", { cx: bowX, cy: bowPointY, r: 5, fill: "#17212b" }),
    ...(result.chainLifted > 0.05 ? [svg("path", { d: chainPath, fill: "none", stroke: "#2f3b44", "stroke-width": 6, "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": "3 7" })] : []),
    ...(hasRopeLifted ? [svg("path", { d: ropePath, fill: "none", stroke: "#c77a16", "stroke-width": 5, "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": "10 7" })] : []),
    ...(result.ropeOnSeabed > 0.05 ? [svg("line", { x1: liftedStartX, y1: seabedY + 8, x2: chainSeabedEndX, y2: seabedY + 8, stroke: "#c77a16", "stroke-width": 6, "stroke-linecap": "round", "stroke-dasharray": "10 7", opacity: 0.9 })] : []),
    ...(result.chainOnSeabed > 0.05 ? [svg("line", { x1: chainSeabedEndX, y1: seabedY + 4, x2: anchorX, y2: seabedY + 4, stroke: "#2f3b44", "stroke-width": 7, "stroke-linecap": "round", "stroke-dasharray": "3 7", opacity: 0.9 })] : []),
    svg("path", { d: `M${anchorX - 20} ${anchorY - 18} L${anchorX} ${anchorY} L${anchorX + 24} ${anchorY - 12} M${anchorX} ${anchorY} L${anchorX + 2} ${anchorY - 34}`, stroke: "#17212b", "stroke-width": 5, fill: "none", "stroke-linecap": "round" }),
    svg("text", { x: labelX, y: rodeMidY, fill: "#17212b", "font-size": 16, "font-weight": 700 }, [document.createTextNode(`Rode ${fmt(result.rodeLength, 1, " m")} / scope ${fmt(result.scopeRatio, 1, ":1")}`)]),
    svg("text", { x: labelX, y: rodeMidY + 18, fill: "#17212b", "font-size": 15 }, [document.createTextNode(catenaryLabel)]),
    svg("line", { x1: 588, y1: 34, x2: 636, y2: 34, stroke: "#2f3b44", "stroke-width": 6, "stroke-linecap": "round", "stroke-dasharray": "3 7" }),
    svg("text", { x: 644, y: 38, fill: "#17212b", "font-size": 15 }, [document.createTextNode(`chain ${fmt(Math.min(input.chainLength, result.rodeLength), 1, " m")}`)]),
    svg("line", { x1: 588, y1: 54, x2: 636, y2: 54, stroke: "#c77a16", "stroke-width": 5, "stroke-linecap": "round", "stroke-dasharray": "10 7" }),
    svg("text", { x: 644, y: 58, fill: "#17212b", "font-size": 15 }, [document.createTextNode(`rope ${fmt(ropeDeployed, 1, " m")}`)]),
    svg("text", { x: Math.max(bowX + 10, lowWaterTouchX + 10), y: seabedY + 28, fill: "#17212b", "font-size": 16 }, [document.createTextNode(`${fmt(result.chainOnSeabed, 1, " m")} chain on seabed at ${modeLabel}`)]),
    svg("line", { x1: distanceStartX, y1: distanceY, x2: anchorX, y2: distanceY, stroke: "#7a6a45", "stroke-width": 2 }),
    svg("line", { x1: distanceStartX, y1: distanceY - 5, x2: distanceStartX, y2: distanceY + 5, stroke: "#7a6a45", "stroke-width": 2 }),
    svg("line", { x1: anchorX, y1: distanceY - 5, x2: anchorX, y2: distanceY + 5, stroke: "#7a6a45", "stroke-width": 2 }),
    svg("text", { x: Math.max(18, Math.min(anchorX - 190, distanceStartX + 12)), y: distanceY - 8, fill: "#17212b", "font-size": 16 }, [document.createTextNode(`anchor to stern ${fmt(sternDistance, 1, " m")}`)])
  );
}

function renderTable(tableId, headers, rows, highlightPredicate = () => false) {
  const table = document.getElementById(tableId);
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  thead.innerHTML = `<tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr>`;
  tbody.innerHTML = rows.map((row, index) => {
    const cells = row.map((cell) => `<td>${cell}</td>`).join("");
    return `<tr class="${highlightPredicate(row, index) ? "highlight" : ""}">${cells}</tr>`;
  }).join("");
}

function renderForceTable() {
  const input = currentInputs();
  const speeds = [20, 30, 40, 50, 60, 70];
  const rows = speeds.map((speed) => [
    `${speed} kn`,
    fmt(input.loa, 1, " m"),
    fmt(calculateWindForce(input, speed), 0, " kg")
  ]);
  renderTable("forceTable", ["Wind speed", "LOA", "Force"], rows, (row) => row[0] === `${Math.round(input.windSpeed / 10) * 10} kn`);
}

function renderForceChart() {
  const input = currentInputs();
  const target = document.getElementById("forceChart");
  target.innerHTML = "";
  const points = [20, 30, 40, 50, 60, 70].map((speed) => ({
    speed,
    force: calculateWindForce(input, speed)
  }));
  const maxForce = Math.max(...points.map((point) => point.force), 1);
  const left = 64;
  const bottom = 270;
  const width = 700;
  const height = 220;
  const path = points.map((point, index) => {
    const x = left + ((point.speed - 20) / 50) * width;
    const y = bottom - (point.force / maxForce) * height;
    return `${index === 0 ? "M" : "L"}${x} ${y}`;
  }).join(" ");
  target.append(
    svg("line", { x1: left, y1: 36, x2: left, y2: bottom, stroke: "#9aa8b3" }),
    svg("line", { x1: left, y1: bottom, x2: left + width + 18, y2: bottom, stroke: "#9aa8b3" }),
    svg("path", { d: path, fill: "none", stroke: "#1f6f8b", "stroke-width": 4, "stroke-linecap": "round", "stroke-linejoin": "round" }),
    svg("text", { x: left, y: 22, fill: "#17212b", "font-size": 16, "font-weight": 700 }, [document.createTextNode(`Load curve for ${fmt(input.loa, 1, " m")} LOA`)])
  );
  points.forEach((point) => {
    const x = left + ((point.speed - 20) / 50) * width;
    const y = bottom - (point.force / maxForce) * height;
    target.append(
      svg("circle", { cx: x, cy: y, r: 5, fill: "#1f6f8b" }),
      svg("text", { x: x - 18, y: bottom + 24, fill: "#17212b", "font-size": 15 }, [document.createTextNode(point.speed)]),
      svg("text", { x: x - 20, y: y - 10, fill: "#17212b", "font-size": 15 }, [document.createTextNode(fmt(point.force, 0))])
    );
  });
}

function renderTideCurve() {
  const target = document.getElementById("tideCurve");
  if (!target) return;
  target.innerHTML = "";
  const tide = activeTideValues();
  const tideSourceLabel = serverState.tide.source === "secondary" && selectedSecondaryPort()
    ? selectedSecondaryPort().name
    : "Oban";
  const now = new Date();
  const timeline = activeTideTimeline(now);
  const nowMinutes = nowMinutesForDisplayMode(now);
  const width = 680;
  const height = 170;
  const left = 76;
  const top = 42;
  const bottom = top + height;
  const samples = [];
  for (let minute = 0; minute <= 1440; minute += 15) {
    samples.push({ minute, height: tideAtMinute(tide, minute, timeline) });
  }
  const visibleEvents = (timeline || tideEventsForRange(tide, 0, 1440))
    .filter((event) => event.minute >= 0 && event.minute <= 1440)
    .map((event) => ({
      ...event,
      height: Number(event.height)
    }));
  const eventHeights = visibleEvents.map((event) => event.height);
  const heights = [...samples.map((sample) => sample.height), ...eventHeights];
  const minHeight = Math.min(...heights);
  const maxHeight = Math.max(...heights);
  const pad = Math.max(0.2, (maxHeight - minHeight) * 0.12);
  const yMin = minHeight - pad;
  const yMax = maxHeight + pad;
  const xFor = (minute) => left + (minute / 1440) * width;
  const yFor = (value) => bottom - ((value - yMin) / Math.max(0.1, yMax - yMin)) * height;
  const path = samples.map((sample, index) => `${index === 0 ? "M" : "L"}${xFor(sample.minute)} ${yFor(sample.height)}`).join(" ");
  target.append(
    svg("rect", { x: 0, y: 0, width: 820, height: 280, fill: "#ffffff" }),
    svg("text", { x: left, y: 24, fill: "#17212b", "font-size": 16, "font-weight": 700 }, [document.createTextNode(`24 hour tide curve: ${tideSourceLabel} (${timeBasisLabel()})`)]),
    svg("line", { x1: left, y1: top, x2: left, y2: bottom, stroke: "#9aa8b3" }),
    svg("line", { x1: left, y1: bottom, x2: left + width, y2: bottom, stroke: "#9aa8b3" }),
    svg("path", { d: path, fill: "none", stroke: "#1f6f8b", "stroke-width": 4, "stroke-linecap": "round", "stroke-linejoin": "round" })
  );
  [0, 360, 720, 1080, 1440].forEach((minute) => {
    const x = xFor(minute);
    target.append(
      svg("line", { x1: x, y1: top, x2: x, y2: bottom, stroke: "#e2e8ee", "stroke-width": 1 }),
      svg("text", { x: x - 14, y: bottom + 22, fill: "#17212b", "font-size": 15 }, [document.createTextNode(minute === 1440 ? "24:00" : minutesToTime(minute))])
    );
  });
  [minHeight, maxHeight].forEach((value) => {
    const y = yFor(value);
    target.append(
      svg("line", { x1: left - 5, y1: y, x2: left + width, y2: y, stroke: "#eef2f5", "stroke-width": 1 }),
      svg("text", { x: 18, y: y + 4, fill: "#17212b", "font-size": 15 }, [document.createTextNode(fmt(value, 1, " m"))])
    );
  });
  visibleEvents
    .forEach((event) => {
      const x = xFor(event.minute);
      const y = yFor(event.height);
      target.append(
        svg("circle", { cx: x, cy: y, r: 5, fill: event.type === "HW" ? "#1f6f8b" : "#6a8a3a" }),
        svg("text", { x: x + 7, y: y - 8, fill: "#17212b", "font-size": 15 }, [document.createTextNode(`${event.type} ${minutesToTime(event.minute)} ${fmt(event.height, 1, " m")}`)])
      );
    });
  const nowX = xFor(Math.max(0, Math.min(1440, nowMinutes)));
  target.append(
    svg("line", { x1: nowX, y1: top, x2: nowX, y2: bottom, stroke: "#b44444", "stroke-width": 2, "stroke-dasharray": "5 5" }),
    svg("text", { x: Math.min(nowX + 6, left + width - 42), y: top + 14, fill: "#b44444", "font-size": 15, "font-weight": 700 }, [document.createTextNode("now")])
  );
}

function renderAll() {
  renderSecondaryTidePreview();
  renderTideDataManager();
  updateTideSummary();
  updatePlannerTideControl();
  renderTideCurve();
  updateDepthComparison();
  const result = calculate();
  updateSummary(result);
  renderDiagram(calculateDiagramResult(), selectedPlannerTideView());
  renderForceTable();
  renderForceChart();
}

async function renderAbout() {
  document.getElementById("webVersion").textContent = webVersion;
  try {
    const response = await fetch("/api/version");
    if (!response.ok) throw new Error("Version endpoint failed");
    const data = await response.json();
    document.getElementById("serverVersion").textContent = data.serverVersion || "-";
    document.getElementById("serverAddress").textContent = `${data.host || location.hostname}:${data.port || location.port || "4184"}`;
    document.getElementById("serverStarted").textContent = fmtDateTime(data.startedAt);
  } catch {
    document.getElementById("serverVersion").textContent = "Needs server restart";
    document.getElementById("serverAddress").textContent = location.host || "-";
    document.getElementById("serverStarted").textContent = "Open the Lubuntu launcher again";
  }
}

document.querySelectorAll(".tabButton").forEach((button) => {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab;
    document.querySelectorAll(".tabButton").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".tabPanel").forEach((panel) => panel.classList.toggle("active", panel.id === `${tab}Panel`));
  });
});

document.getElementById("diagramTabs").addEventListener("click", (event) => {
  const button = event.target.closest(".diagramTab");
  if (!button) return;
  selectedTideViewKey = button.dataset.tideView || "now";
  idealRode = null;
  clearIdealRodeRecommendation();
  renderAll();
});

document.querySelectorAll(".depthSourceButton").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.classList.contains("tideSourceButton")) return;
    depthSource = button.dataset.depthSource;
    document.querySelectorAll(".depthSourceButton").forEach((item) => item.classList.toggle("active", item === button));
    idealRode = null;
    clearIdealRodeRecommendation();
    renderAll();
  });
});

allInputIds.forEach((id) => {
  document.getElementById(id).addEventListener("input", () => {
    if (["hwTime", "lwTime", "hwHeight", "lwHeight"].includes(id)) {
      persistTideStateFromFields();
    }
    idealRode = null;
    clearIdealRodeRecommendation();
    renderAll();
  });
});

checkboxIds.forEach((id) => {
  document.getElementById(id).addEventListener("change", () => {
    idealRode = null;
    clearIdealRodeRecommendation();
    renderAll();
  });
});

["obanMhws", "obanMhwn", "obanMlwn", "obanMlws"].forEach((id) => {
  document.getElementById(id).addEventListener("input", () => {
    persistObanReferenceFromFields();
    idealRode = null;
    clearIdealRodeRecommendation();
    renderSecondaryPortManager();
    renderAll();
  });
});

document.getElementById("calculateIdealRode").addEventListener("click", () => {
  idealRode = calculateIdealRode();
  showIdealRodeRecommendation(idealRode);
});

document.getElementById("applyMinimumRode").addEventListener("click", () => {
  if (!idealRode) idealRode = calculateIdealRode();
  document.getElementById("rodeLength").value = Math.round(idealRode.minimumRode);
  renderAll();
  showIdealRodeRecommendation(idealRode);
});

document.getElementById("applyOptimalRode").addEventListener("click", () => {
  if (!idealRode) idealRode = calculateIdealRode();
  document.getElementById("rodeLength").value = Math.round(idealRode.optimalRode);
  renderAll();
  showIdealRodeRecommendation(idealRode);
});

document.getElementById("saveDefaults").addEventListener("click", () => {
  saveCurrentSettings();
});

document.getElementById("resetDefaults").addEventListener("click", () => {
  applySettings(savedSettings() || {});
  idealRode = null;
  clearIdealRodeRecommendation();
  renderAll();
});

document.querySelectorAll(".tideSourceButton").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.tideSource === "secondary" && !selectedSecondaryPort()) return;
    serverState.tide.source = button.dataset.tideSource;
    document.querySelectorAll(".tideSourceButton").forEach((item) => item.classList.toggle("active", item === button));
    idealRode = null;
    clearIdealRodeRecommendation();
    saveServerStateSoon();
    renderAll();
  });
});

document.getElementById("secondaryPortSelect").addEventListener("change", (event) => {
  serverState.tide.selectedPortId = event.target.value;
  if (!selectedSecondaryPort() && serverState.tide.source === "secondary") serverState.tide.source = "oban";
  idealRode = null;
  clearIdealRodeRecommendation();
  saveServerStateSoon();
  applyServerStateToTideFields();
  renderAll();
});

document.getElementById("saveSecondaryPort").addEventListener("click", () => {
  const name = document.getElementById("secondaryPortName").value.trim();
  if (!name) return;
  const port = {
    id: editingSecondaryPortId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    hwOffsets: {
      t0000: Number(document.getElementById("secondaryHw0000").value) || 0,
      t0600: Number(document.getElementById("secondaryHw0600").value) || 0,
      t1200: Number(document.getElementById("secondaryHw1200").value) || 0,
      t1800: Number(document.getElementById("secondaryHw1800").value) || 0
    },
    lwOffsets: {
      t0000: Number(document.getElementById("secondaryLw0000").value) || 0,
      t0600: Number(document.getElementById("secondaryLw0600").value) || 0,
      t1200: Number(document.getElementById("secondaryLw1200").value) || 0,
      t1800: Number(document.getElementById("secondaryLw1800").value) || 0
    },
    heightDiffs: {
      mhws: Number(document.getElementById("secondaryDiffMhws").value) || 0,
      mhwn: Number(document.getElementById("secondaryDiffMhwn").value) || 0,
      mlwn: Number(document.getElementById("secondaryDiffMlwn").value) || 0,
      mlws: Number(document.getElementById("secondaryDiffMlws").value) || 0
    },
    notes: document.getElementById("secondaryPortNotes").value.trim()
  };
  const existingIndex = serverState.secondaryPorts.findIndex((item) => item.id === port.id);
  if (existingIndex >= 0) serverState.secondaryPorts[existingIndex] = port;
  else serverState.secondaryPorts.push(port);
  serverState.deletedSecondaryPortIds = serverState.deletedSecondaryPortIds.filter((id) => id !== port.id);
  serverState.tide.selectedPortId = port.id;
  clearSecondaryPortForm();
  renderSecondaryPortManager();
  saveServerStateSoon();
  renderAll();
});

document.getElementById("clearSecondaryPort").addEventListener("click", () => {
  clearSecondaryPortForm();
});

document.getElementById("saveTideDataSettings").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/tide-data/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stationName: document.getElementById("tideDataStationName").value.trim(),
        stationId: document.getElementById("tideDataStationId").value.trim(),
        timeStandard: document.getElementById("tideDataTimeStandard").value.trim(),
        displayTimeMode: document.getElementById("tideDataDisplayMode").value,
        ukhoAccountEmail: document.getElementById("tideDataAccountEmail").value.trim(),
        ukhoApiKey: document.getElementById("tideDataApiKey").value.trim()
      })
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `server returned ${response.status}`);
    serverState.tideData = await response.json();
    document.getElementById("tideDataApiKey").value = "";
    renderTideDataManager();
  } catch (error) {
    document.getElementById("tideDataStatusLabel").textContent = `Save failed: ${error.message}`;
  }
});

document.getElementById("clearTideDataKey").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/tide-data/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stationName: document.getElementById("tideDataStationName").value.trim(),
        stationId: document.getElementById("tideDataStationId").value.trim(),
        timeStandard: document.getElementById("tideDataTimeStandard").value.trim(),
        displayTimeMode: document.getElementById("tideDataDisplayMode").value,
        ukhoAccountEmail: document.getElementById("tideDataAccountEmail").value.trim(),
        clearUkhoApiKey: true
      })
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `server returned ${response.status}`);
    serverState.tideData = await response.json();
    document.getElementById("tideDataApiKey").value = "";
    renderTideDataManager();
  } catch (error) {
    document.getElementById("tideDataStatusLabel").textContent = `Clear failed: ${error.message}`;
  }
});

document.getElementById("refreshTideData").addEventListener("click", async () => {
  try {
    document.getElementById("tideDataStatusLabel").textContent = "Fetching...";
    const response = await fetch("/api/tide-data/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stationName: document.getElementById("tideDataStationName").value.trim(),
        stationId: document.getElementById("tideDataStationId").value.trim(),
        timeStandard: document.getElementById("tideDataTimeStandard").value.trim(),
        displayTimeMode: document.getElementById("tideDataDisplayMode").value
      })
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `provider returned ${response.status}`);
    serverState.tideData = await response.json();
    renderTideDataManager();
  } catch (error) {
    document.getElementById("tideDataStatusLabel").textContent = `Fetch failed: ${error.message}`;
  }
});

document.getElementById("tideDataDisplayMode").addEventListener("change", async (event) => {
  const previousMode = displayTimeMode();
  serverState.tideData.displayTimeMode = event.target.value === "local" ? "local" : "ut";
  try {
    const response = await fetch("/api/tide-data/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stationName: document.getElementById("tideDataStationName").value.trim(),
        stationId: document.getElementById("tideDataStationId").value.trim(),
        timeStandard: document.getElementById("tideDataTimeStandard").value.trim(),
        displayTimeMode: serverState.tideData.displayTimeMode,
        ukhoAccountEmail: document.getElementById("tideDataAccountEmail").value.trim()
      })
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `server returned ${response.status}`);
    serverState.tideData = await response.json();
  } catch (error) {
    serverState.tideData.displayTimeMode = previousMode;
    document.getElementById("tideDataStatusLabel").textContent = `Time display save failed: ${error.message}`;
  }
  applyServerStateToTideFields();
  renderAll();
});

document.getElementById("secondaryPortsTable").addEventListener("click", (event) => {
  const editId = event.target.dataset.editSecondary;
  const deleteId = event.target.dataset.deleteSecondary;
  if (editId) {
    const port = serverState.secondaryPorts.find((item) => item.id === editId);
    if (!port) return;
    editingSecondaryPortId = port.id;
    document.getElementById("secondaryPortName").value = port.name;
    const hwOffsets = portOffsets(port, "hw");
    const lwOffsets = portOffsets(port, "lw");
    document.getElementById("secondaryHw0000").value = hwOffsets.t0000 || 0;
    document.getElementById("secondaryHw0600").value = hwOffsets.t0600 || 0;
    document.getElementById("secondaryHw1200").value = hwOffsets.t1200 || 0;
    document.getElementById("secondaryHw1800").value = hwOffsets.t1800 || 0;
    document.getElementById("secondaryLw0000").value = lwOffsets.t0000 || 0;
    document.getElementById("secondaryLw0600").value = lwOffsets.t0600 || 0;
    document.getElementById("secondaryLw1200").value = lwOffsets.t1200 || 0;
    document.getElementById("secondaryLw1800").value = lwOffsets.t1800 || 0;
    const heightDiffs = portHeightDiffs(port);
    document.getElementById("secondaryDiffMhws").value = heightDiffs.mhws || 0;
    document.getElementById("secondaryDiffMhwn").value = heightDiffs.mhwn || 0;
    document.getElementById("secondaryDiffMlwn").value = heightDiffs.mlwn || 0;
    document.getElementById("secondaryDiffMlws").value = heightDiffs.mlws || 0;
    document.getElementById("secondaryPortNotes").value = port.notes || "";
    document.getElementById("saveSecondaryPort").textContent = "Update secondary port";
  }
  if (deleteId) {
    serverState.secondaryPorts = serverState.secondaryPorts.filter((item) => item.id !== deleteId);
    if (!serverState.deletedSecondaryPortIds.includes(deleteId)) serverState.deletedSecondaryPortIds.push(deleteId);
    if (serverState.tide.selectedPortId === deleteId) {
      serverState.tide.selectedPortId = "";
      serverState.tide.source = "oban";
    }
    clearSecondaryPortForm();
    renderSecondaryPortManager();
    saveServerStateSoon();
    renderAll();
  }
});

async function init() {
  applySettings(savedSettings() || {});
  await loadServerState();
  applyServerStateToTideFields();
  applyTideDataFields();
  renderSecondaryPortManager();
  renderTideDataManager();
  renderAll();
  renderAbout();
  setInterval(renderAll, 60 * 1000);
}

init();
