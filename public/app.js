const webVersion = "0.4.0";

const defaults = {
  windSpeed: 40,
  tidalStream: 1.0,
  loa: 10.1,
  draft: 1.8,
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
  chainWeight: 1.4,
  ropeWeight: 0.12,
  anchorWeight: 15,
  anchorUhc: 420,
  windageFactor: 0.34,
  underwaterDragFactor: 0.35
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
let diagramMode = "now";
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
  deletedSecondaryPortIds: []
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

function currentInputs() {
  const input = Object.fromEntries(ids.map((id) => [id, number(id)]));
  const tide = activeTideValues();
  input.hwHeight = tide.hwHeight;
  input.lwHeight = tide.lwHeight;
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
    deletedSecondaryPortIds: Array.isArray(state.deletedSecondaryPortIds) ? state.deletedSecondaryPortIds : []
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
  return {
    hwTime: document.getElementById("hwTime").value || "00:00",
    lwTime: document.getElementById("lwTime").value || "00:00",
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
  return Math.max(0, Math.min(1, (height - neapHeight) / range));
}

function lowWaterSpringFactor(height, neapHeight, springHeight) {
  const range = neapHeight - springHeight;
  if (!Number.isFinite(range) || Math.abs(range) < 0.01) return 0;
  return Math.max(0, Math.min(1, (neapHeight - height) / range));
}

function interpolateOffset(neapOffset, springOffset, factor) {
  return Number(neapOffset || 0) + (Number(springOffset || 0) - Number(neapOffset || 0)) * factor;
}

function secondaryTideValues(port = selectedSecondaryPort(), oban = serverState.tide.oban) {
  if (!port) return { ...oban };
  const reference = serverState.tide.obanReferenceLevels;
  const hwFactor = springFactor(Number(oban.hwHeight || 0), Number(reference.mhwn || 0), Number(reference.mhws || 0));
  const lwFactor = lowWaterSpringFactor(Number(oban.lwHeight || 0), Number(reference.mlwn || 0), Number(reference.mlws || 0));
  const hwTimeOffset = port.hwTimeMode === "levels"
    ? interpolateOffset(port.hwNeapOffset, port.hwSpringOffset, hwFactor)
    : Number(port.hwTimeOffset || 0);
  const lwTimeOffset = port.lwTimeMode === "levels"
    ? interpolateOffset(port.lwNeapOffset, port.lwSpringOffset, lwFactor)
    : Number(port.lwTimeOffset || 0);
  if (port.heightMode === "levels") {
    return {
      hwTime: minutesToTime(timeToMinutes(oban.hwTime) + hwTimeOffset),
      lwTime: minutesToTime(timeToMinutes(oban.lwTime) + lwTimeOffset),
      hwHeight: round(Number(port.mhwn || 0) + hwFactor * (Number(port.mhws || 0) - Number(port.mhwn || 0)), 1),
      lwHeight: round(Number(port.mlwn || 0) - lwFactor * (Number(port.mlwn || 0) - Number(port.mlws || 0)), 1)
    };
  }
  return {
    hwTime: minutesToTime(timeToMinutes(oban.hwTime) + hwTimeOffset),
    lwTime: minutesToTime(timeToMinutes(oban.lwTime) + lwTimeOffset),
    hwHeight: round(Number(oban.hwHeight || 0) + Number(port.hwHeightOffset || 0), 1),
    lwHeight: round(Number(oban.lwHeight || 0) + Number(port.lwHeightOffset || 0), 1)
  };
}

function activeTideValues() {
  if (serverState.tide.source === "secondary") return secondaryTideValues();
  return { ...serverState.tide.oban };
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

function chartedDepthFor(input, tideHeight = input.tideHeight) {
  if (depthSource === "sounder") return Math.max(0, sounderDepthNow(input) - tideHeight);
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

function calculateDiagramResult(mode = diagramMode) {
  const input = currentInputs();
  const tideHeight = mode === "lw" ? input.lwHeight : mode === "hw" ? input.hwHeight : input.tideHeight;
  return calculateForDepth({ ...input, tideHeight }, chartedDepthFor(input));
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

  const idealLength = desired * verticalDrop;
  const recommended = round(Math.min(idealLength, totalRode), 0);
  const result = calculateForDepth({ ...input, rodeLength: recommended, tideHeight: input.hwHeight }, depthLw);
  const notes = [];

  notes.push(`${fmt(wind, 0, " kn")} wind plus ${fmt(input.tidalStream, 1, " kn")} tidal stream gives an equivalent load of about ${fmt(equivalentWind, 0, " kn")} wind.`);
  notes.push(`That sets the HW recommendation at ${fmt(desired, 1, ":1")}.`);
  if (idealLength > totalRode) notes.push(`Available rode caps this at ${fmt(totalRode, 1, " m")}.`);
  if (result.highWaterChainOnSeabed < 5) {
    notes.push(`At HW, estimated catenary leaves only ${fmt(result.highWaterChainOnSeabed, 1, " m")} of chain on the seabed.`);
  } else {
    notes.push(`Keeps about ${fmt(result.highWaterChainOnSeabed, 1, " m")} of chain on the seabed at HW with these settings.`);
  }

  return {
    rodeLength: recommended,
    scope: result.scopeRatio,
    shortfall: result.shortfall,
    ropeOnSeabed: result.ropeOnSeabed,
    highWaterChainOnSeabed: result.highWaterChainOnSeabed,
    notes
  };
}

function showIdealRodeRecommendation(recommendation) {
  const panel = document.getElementById("scopeRecommendation");
  panel.classList.add("hasRecommendation");
  panel.querySelector("strong").textContent = fmt(recommendation.rodeLength, 1, " m");
  panel.querySelector("p").textContent = `${recommendation.notes.join(" ")} HW scope: ${fmt(recommendation.scope, 1, ":1")}.`;
}

function clearIdealRodeRecommendation() {
  const panel = document.getElementById("scopeRecommendation");
  panel.classList.remove("hasRecommendation");
  panel.querySelector("strong").textContent = "-";
  panel.querySelector("p").textContent = "Use the button to calculate a recommendation from the conditions now and boat settings.";
}

function applyServerStateToTideFields() {
  const oban = serverState.tide.oban;
  document.getElementById("hwTime").value = oban.hwTime || "15:00";
  document.getElementById("lwTime").value = oban.lwTime || "09:00";
  document.getElementById("hwHeight").value = oban.hwHeight ?? 4;
  document.getElementById("lwHeight").value = oban.lwHeight ?? 1;
  document.getElementById("secondaryPortSelect").value = serverState.tide.selectedPortId || "";
  document.querySelectorAll(".tideSourceButton").forEach((button) => {
    button.classList.toggle("active", button.dataset.tideSource === serverState.tide.source);
  });
  renderSecondaryTidePreview();
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
  const secondary = secondaryTideValues(port);
  document.getElementById("secondaryHwTime").textContent = port ? secondary.hwTime : "-";
  document.getElementById("secondaryLwTime").textContent = port ? secondary.lwTime : "-";
  document.getElementById("secondaryHwHeight").textContent = port ? fmt(secondary.hwHeight, 1, " m") : "-";
  document.getElementById("secondaryLwHeight").textContent = port ? fmt(secondary.lwHeight, 1, " m") : "-";
  document.getElementById("calculateSecondaryTide").disabled = !port;
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
      const hwTime = port.hwTimeMode === "levels"
        ? `Sp ${fmtOffset(port.hwSpringOffset)} / Np ${fmtOffset(port.hwNeapOffset)}`
        : fmtOffset(port.hwTimeOffset);
      const lwTime = port.lwTimeMode === "levels"
        ? `Sp ${fmtOffset(port.lwSpringOffset)} / Np ${fmtOffset(port.lwNeapOffset)}`
        : fmtOffset(port.lwTimeOffset);
      const heights = port.heightMode === "levels"
        ? `MHWS ${fmt(Number(port.mhws || 0), 1, " m")} / MHWN ${fmt(Number(port.mhwn || 0), 1, " m")} / MLWN ${fmt(Number(port.mlwn || 0), 1, " m")} / MLWS ${fmt(Number(port.mlws || 0), 1, " m")}`
        : `HW ${fmt(Number(port.hwHeightOffset || 0), 1, " m")} / LW ${fmt(Number(port.lwHeightOffset || 0), 1, " m")}`;
      return `
      <tr>
        <td>${escapeHtml(port.name)}</td>
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
  document.getElementById("secondaryHwTimeMode").value = "fixed";
  document.getElementById("secondaryHwOffset").value = "0";
  document.getElementById("secondaryHwSpringOffset").value = "0";
  document.getElementById("secondaryHwNeapOffset").value = "0";
  document.getElementById("secondaryLwTimeMode").value = "fixed";
  document.getElementById("secondaryLwOffset").value = "0";
  document.getElementById("secondaryLwSpringOffset").value = "0";
  document.getElementById("secondaryLwNeapOffset").value = "0";
  document.getElementById("secondaryHeightMode").value = "levels";
  document.getElementById("secondaryMhws").value = "0";
  document.getElementById("secondaryMhwn").value = "0";
  document.getElementById("secondaryMlwn").value = "0";
  document.getElementById("secondaryMlws").value = "0";
  document.getElementById("secondaryHwHeightOffset").value = "0";
  document.getElementById("secondaryLwHeightOffset").value = "0";
  document.getElementById("secondaryPortNotes").value = "";
  document.getElementById("saveSecondaryPort").textContent = "Add secondary port";
}

function renderSecondaryPortManager() {
  renderSecondaryPortOptions();
  renderSecondaryTidePreview();
  renderSecondaryPortsTable();
}

function persistTideStateFromFields() {
  serverState.tide.oban = obanTideFromFields();
  saveServerStateSoon();
}

function formatClock(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function interpolateTwelfths(progress) {
  const clamped = Math.max(0, Math.min(1, progress));
  const segment = Math.min(5, Math.floor(clamped * 6));
  const segmentStart = segment / 6;
  const segmentProgress = (clamped - segmentStart) * 6;
  const twelfths = [0, 1, 3, 6, 9, 11, 12];
  return (twelfths[segment] + (twelfths[segment + 1] - twelfths[segment]) * segmentProgress) / 12;
}

function currentTide() {
  const input = currentInputs();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const hw = timeMinutes("hwTime");
  const lw = timeMinutes("lwTime");
  const halfCycleMinutes = 12 * 60 + 25;
  const baseEvents = [
    { type: "HW", minute: hw, height: input.hwHeight },
    { type: "LW", minute: lw, height: input.lwHeight }
  ];
  const events = [];
  for (const shift of [-2, -1, 0, 1, 2]) {
    for (const event of baseEvents) events.push({ ...event, minute: event.minute + shift * halfCycleMinutes });
  }
  events.sort((a, b) => a.minute - b.minute);
  let before = events[0];
  let after = events[1];
  for (let index = 0; index < events.length - 1; index += 1) {
    if (events[index].minute <= nowMinutes && nowMinutes <= events[index + 1].minute && events[index].type !== events[index + 1].type) {
      before = events[index];
      after = events[index + 1];
      break;
    }
  }
  const duration = Math.max(1, after.minute - before.minute);
  const progress = (nowMinutes - before.minute) / duration;
  const fraction = interpolateTwelfths(progress);
  const rising = before.type === "LW" && after.type === "HW";
  const height = rising
    ? before.height + (after.height - before.height) * fraction
    : before.height - (before.height - after.height) * fraction;
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
  const tide = currentTide();
  const tideSourceLabel = serverState.tide.source === "secondary" && selectedSecondaryPort()
    ? selectedSecondaryPort().name
    : "Oban";
  document.getElementById("tideHeight").value = round(tide.height, 1);
  document.getElementById("currentTimeLabel").textContent = formatClock(tide.now);
  document.getElementById("currentRiseLabel").textContent = `${fmt(tide.height, 1, " m")} ${tide.phase.toLowerCase()}`;
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

function statusText(result) {
  if (result.lowWaterClearance < 0) {
    return {
      level: "danger",
      text: `Grounding risk: low-water depth is ${fmt(Math.abs(result.lowWaterClearance), 1, " m")} less than draft.`
    };
  }
  if (result.clearanceMargin < 0) {
    return {
      level: "warning",
      text: `Low-water clearance is ${fmt(result.lowWaterClearance, 1, " m")}, below the ${fmt(number("minClearance"), 1, " m")} minimum.`
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
      text: `Anchor drag risk at high water: estimated holding is ${fmt(result.effectiveAnchorHolding, 0, " kgf")} against ${fmt(result.horizontalLoad, 0, " kgf")} load.`
    };
  }
  if (result.anchorHoldingMargin < result.horizontalLoad * 0.25) {
    return {
      level: "warning",
      text: `Anchor holding margin is low at high water: about ${fmt(result.anchorHoldingMargin, 0, " kgf")} after pull-angle allowance.`
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
      text: `Estimated catenary leaves only ${fmt(result.highWaterChainOnSeabed, 1, " m")} of chain on the seabed at high water.`
    };
  }
  return {
    level: "good",
    text: `Rode length is within available rode, with about ${fmt(result.highWaterChainOnSeabed, 1, " m")} of chain on the seabed at high water.`
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

function renderDiagram(result, mode = diagramMode) {
  const input = currentInputs();
  const target = document.getElementById("rodeDiagram");
  target.innerHTML = "";
  const modeLabel = mode === "lw" ? "LW" : mode === "hw" ? "HW" : "Now";

  const width = 860;
  const height = 300;
  const seabedY = 222;
  const verticalDrop = Math.max(0.1, result.depthHw + input.bowHeight);
  const horizontalReach = result.horizontalReach;
  const hwResult = calculateDiagramResult("hw");
  const lwResult = calculateDiagramResult("lw");
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
    ...(mode !== "hw" ? [
      svg("line", { x1: hwBowX, y1: seabedY + 16, x2: bowX, y2: seabedY + 16, stroke: "#7a6a45", "stroke-width": 2, "stroke-dasharray": "5 5" }),
      svg("text", { x: Math.min(hwBowX, bowX) + 8, y: seabedY + 44, fill: "#5f4b2c", "font-size": 12 }, [document.createTextNode(`${fmt(Math.abs(moveFromHw), 1, " m")} from HW set position`)])
    ] : []),
    svg("path", { d: `M${boatSternX} ${sternDeckY} L${bowX - 10} ${bowDeckY} L${bowX} ${bowPointY} L${bowX - 14} ${waterY + draftPx * 0.08} L${boatSternX + 22} ${hullBottomY} Z`, fill: "#ffffff", stroke: "#17212b", "stroke-width": 2 }),
    svg("path", { d: `M${keelCenterX - keelHalfWidth} ${keelTopY} L${keelCenterX + keelHalfWidth} ${keelTopY} L${keelCenterX + keelHalfWidth * 0.55} ${keelBottomY} L${keelCenterX - keelHalfWidth * 0.55} ${keelBottomY} Z`, fill: keelHitsBottom ? "#d76c6c" : "#6f7f8a", stroke: "#17212b", "stroke-width": 2, opacity: 0.95 }),
    svg("line", { x1: keelClearanceLineX, y1: keelBottomY, x2: keelClearanceLineX, y2: seabedY, stroke: keelClearanceColor, "stroke-width": 2 }),
    svg("line", { x1: keelClearanceLineX - 6, y1: keelBottomY, x2: keelClearanceLineX + 6, y2: keelBottomY, stroke: keelClearanceColor, "stroke-width": 2 }),
    svg("line", { x1: keelClearanceLineX - 6, y1: seabedY, x2: keelClearanceLineX + 6, y2: seabedY, stroke: keelClearanceColor, "stroke-width": 2 }),
    svg("text", { x: keelClearanceLineX + 10, y: Math.min(seabedY - 8, Math.max(waterY + 16, keelClearanceMidY + 4)), fill: keelClearanceColor, "font-size": 12, "font-weight": 700 }, [document.createTextNode(`${modeLabel} ${fmt(result.keelClearance, 1, " m")}`)]),
    svg("circle", { cx: bowX, cy: bowPointY, r: 5, fill: "#17212b" }),
    ...(result.chainLifted > 0.05 ? [svg("path", { d: chainPath, fill: "none", stroke: "#2f3b44", "stroke-width": 6, "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": "3 7" })] : []),
    ...(hasRopeLifted ? [svg("path", { d: ropePath, fill: "none", stroke: "#c77a16", "stroke-width": 5, "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": "10 7" })] : []),
    ...(result.ropeOnSeabed > 0.05 ? [svg("line", { x1: liftedStartX, y1: seabedY + 8, x2: chainSeabedEndX, y2: seabedY + 8, stroke: "#c77a16", "stroke-width": 6, "stroke-linecap": "round", "stroke-dasharray": "10 7", opacity: 0.9 })] : []),
    ...(result.chainOnSeabed > 0.05 ? [svg("line", { x1: chainSeabedEndX, y1: seabedY + 4, x2: anchorX, y2: seabedY + 4, stroke: "#2f3b44", "stroke-width": 7, "stroke-linecap": "round", "stroke-dasharray": "3 7", opacity: 0.9 })] : []),
    svg("path", { d: `M${anchorX - 20} ${anchorY - 18} L${anchorX} ${anchorY} L${anchorX + 24} ${anchorY - 12} M${anchorX} ${anchorY} L${anchorX + 2} ${anchorY - 34}`, stroke: "#17212b", "stroke-width": 5, fill: "none", "stroke-linecap": "round" }),
    svg("text", { x: labelX, y: rodeMidY, fill: "#17212b", "font-size": 14, "font-weight": 700 }, [document.createTextNode(`Rode ${fmt(result.rodeLength, 1, " m")} / scope ${fmt(result.scopeRatio, 1, ":1")}`)]),
    svg("text", { x: labelX, y: rodeMidY + 18, fill: "#5f6c76", "font-size": 12 }, [document.createTextNode(catenaryLabel)]),
    svg("line", { x1: 588, y1: 34, x2: 636, y2: 34, stroke: "#2f3b44", "stroke-width": 6, "stroke-linecap": "round", "stroke-dasharray": "3 7" }),
    svg("text", { x: 644, y: 38, fill: "#17212b", "font-size": 12 }, [document.createTextNode(`chain ${fmt(Math.min(input.chainLength, result.rodeLength), 1, " m")}`)]),
    svg("line", { x1: 588, y1: 54, x2: 636, y2: 54, stroke: "#c77a16", "stroke-width": 5, "stroke-linecap": "round", "stroke-dasharray": "10 7" }),
    svg("text", { x: 644, y: 58, fill: "#17212b", "font-size": 12 }, [document.createTextNode(`rope ${fmt(ropeDeployed, 1, " m")}`)]),
    svg("text", { x: Math.max(bowX + 10, lowWaterTouchX + 10), y: seabedY + 28, fill: "#17212b", "font-size": 13 }, [document.createTextNode(`${fmt(result.chainOnSeabed, 1, " m")} chain on seabed at ${modeLabel}`)]),
    svg("line", { x1: distanceStartX, y1: distanceY, x2: anchorX, y2: distanceY, stroke: "#7a6a45", "stroke-width": 2 }),
    svg("line", { x1: distanceStartX, y1: distanceY - 5, x2: distanceStartX, y2: distanceY + 5, stroke: "#7a6a45", "stroke-width": 2 }),
    svg("line", { x1: anchorX, y1: distanceY - 5, x2: anchorX, y2: distanceY + 5, stroke: "#7a6a45", "stroke-width": 2 }),
    svg("text", { x: Math.max(18, Math.min(anchorX - 190, distanceStartX + 12)), y: distanceY - 8, fill: "#5f4b2c", "font-size": 13 }, [document.createTextNode(`anchor to stern ${fmt(sternDistance, 1, " m")}`)])
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

function renderScopeTable(result) {
  const input = currentInputs();
  const rows = Array.from({ length: 19 }, (_, index) => {
    const depth = index + 1;
    const rowResult = calculateForDepth(input, depth);
    return [
      fmt(depth, 0, " m"),
      fmt(depth + input.lwHeight, 1, " m"),
      fmt(rowResult.keelClearance, 1, " m"),
      fmt(rowResult.rodeLength, 1, " m"),
      fmt(rowResult.chainOnSeabed, 1, " m"),
      fmt(rowResult.ropeOnSeabed, 1, " m"),
      fmt(rowResult.liftWeight, 1, " kg")
    ];
  });
  renderTable("scopeTable", ["Charted depth", "Depth @ LW", "Keel clearance now", "Rode length", "Chain on seabed now", "Rope on seabed LW", "Weight to lift"], rows, (_, index) => index + 1 === Math.round(result.chartedDepth));
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

function renderRodeTable() {
  const input = currentInputs();
  renderTable("rodeTable", ["Type", "Diameter", "Weight kg/m", "Total weight", "Typical WLL", "Typical break"], [
    ["G40 Chain", "8mm", fmt(input.chainWeight, 1), fmt(input.chainLength * input.chainWeight, 1, " kg"), "800 kgf", "4030 kgf"],
    ["Anchorplait", "14mm", fmt(input.ropeWeight, 2), fmt(input.ropeLength * input.ropeWeight, 1, " kg"), "-", "-"]
  ]);
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
    svg("text", { x: left, y: 22, fill: "#17212b", "font-size": 14, "font-weight": 700 }, [document.createTextNode(`Load curve for ${fmt(input.loa, 1, " m")} LOA`)])
  );
  points.forEach((point) => {
    const x = left + ((point.speed - 20) / 50) * width;
    const y = bottom - (point.force / maxForce) * height;
    target.append(
      svg("circle", { cx: x, cy: y, r: 5, fill: "#1f6f8b" }),
      svg("text", { x: x - 18, y: bottom + 24, fill: "#5f6c76", "font-size": 12 }, [document.createTextNode(point.speed)]),
      svg("text", { x: x - 20, y: y - 10, fill: "#17212b", "font-size": 12 }, [document.createTextNode(fmt(point.force, 0))])
    );
  });
}

function renderAll() {
  renderSecondaryTidePreview();
  updateTideSummary();
  updateDepthComparison();
  const result = calculate();
  updateSummary(result);
  renderDiagram(calculateDiagramResult(), diagramMode);
  renderScopeTable(result);
  renderForceTable();
  renderRodeTable();
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

document.querySelectorAll(".diagramTab").forEach((button) => {
  button.addEventListener("click", () => {
    diagramMode = button.dataset.diagram;
    document.querySelectorAll(".diagramTab").forEach((item) => item.classList.toggle("active", item === button));
    renderDiagram(calculateDiagramResult(), diagramMode);
  });
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

document.getElementById("calculateIdealRode").addEventListener("click", () => {
  idealRode = calculateIdealRode();
  showIdealRodeRecommendation(idealRode);
});

document.getElementById("applyIdealRode").addEventListener("click", () => {
  if (!idealRode) idealRode = calculateIdealRode();
  document.getElementById("rodeLength").value = idealRode.rodeLength;
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

document.getElementById("calculateSecondaryTide").addEventListener("click", () => {
  persistTideStateFromFields();
  renderSecondaryTidePreview();
  if (serverState.tide.source === "secondary") renderAll();
});

document.getElementById("saveSecondaryPort").addEventListener("click", () => {
  const name = document.getElementById("secondaryPortName").value.trim();
  if (!name) return;
  const port = {
    id: editingSecondaryPortId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    hwTimeMode: document.getElementById("secondaryHwTimeMode").value,
    hwTimeOffset: Number(document.getElementById("secondaryHwOffset").value) || 0,
    hwSpringOffset: Number(document.getElementById("secondaryHwSpringOffset").value) || 0,
    hwNeapOffset: Number(document.getElementById("secondaryHwNeapOffset").value) || 0,
    lwTimeMode: document.getElementById("secondaryLwTimeMode").value,
    lwTimeOffset: Number(document.getElementById("secondaryLwOffset").value) || 0,
    lwSpringOffset: Number(document.getElementById("secondaryLwSpringOffset").value) || 0,
    lwNeapOffset: Number(document.getElementById("secondaryLwNeapOffset").value) || 0,
    heightMode: document.getElementById("secondaryHeightMode").value,
    mhws: Number(document.getElementById("secondaryMhws").value) || 0,
    mhwn: Number(document.getElementById("secondaryMhwn").value) || 0,
    mlwn: Number(document.getElementById("secondaryMlwn").value) || 0,
    mlws: Number(document.getElementById("secondaryMlws").value) || 0,
    hwHeightOffset: Number(document.getElementById("secondaryHwHeightOffset").value) || 0,
    lwHeightOffset: Number(document.getElementById("secondaryLwHeightOffset").value) || 0,
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

document.getElementById("secondaryPortsTable").addEventListener("click", (event) => {
  const editId = event.target.dataset.editSecondary;
  const deleteId = event.target.dataset.deleteSecondary;
  if (editId) {
    const port = serverState.secondaryPorts.find((item) => item.id === editId);
    if (!port) return;
    editingSecondaryPortId = port.id;
    document.getElementById("secondaryPortName").value = port.name;
    document.getElementById("secondaryHwTimeMode").value = port.hwTimeMode || "fixed";
    document.getElementById("secondaryHwOffset").value = port.hwTimeOffset || 0;
    document.getElementById("secondaryHwSpringOffset").value = port.hwSpringOffset || 0;
    document.getElementById("secondaryHwNeapOffset").value = port.hwNeapOffset || 0;
    document.getElementById("secondaryLwTimeMode").value = port.lwTimeMode || "fixed";
    document.getElementById("secondaryLwOffset").value = port.lwTimeOffset || 0;
    document.getElementById("secondaryLwSpringOffset").value = port.lwSpringOffset || 0;
    document.getElementById("secondaryLwNeapOffset").value = port.lwNeapOffset || 0;
    document.getElementById("secondaryHeightMode").value = port.heightMode || "fixed";
    document.getElementById("secondaryMhws").value = port.mhws || 0;
    document.getElementById("secondaryMhwn").value = port.mhwn || 0;
    document.getElementById("secondaryMlwn").value = port.mlwn || 0;
    document.getElementById("secondaryMlws").value = port.mlws || 0;
    document.getElementById("secondaryHwHeightOffset").value = port.hwHeightOffset || 0;
    document.getElementById("secondaryLwHeightOffset").value = port.lwHeightOffset || 0;
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

document.getElementById("stopServer").addEventListener("click", async () => {
  try {
    await fetch("/api/stop", { method: "POST" });
  } finally {
    document.body.innerHTML = "<main><h1>Anchor Force Planner stopped</h1><p>You can close this tab.</p></main>";
  }
});

async function init() {
  applySettings(savedSettings() || {});
  await loadServerState();
  applyServerStateToTideFields();
  renderSecondaryPortManager();
  renderAll();
  renderAbout();
  setInterval(renderAll, 60 * 1000);
}

init();
