const defaults = {
  windSpeed: 40,
  loa: 10.1,
  draft: 1.8,
  minClearance: 0.5,
  depthLw: 5,
  sounderLw: 3.8,
  tideHeight: 3,
  hwHeight: 4,
  lwHeight: 1,
  scopeRatio: 4,
  bowHeight: 1,
  sounderOffset: 1.2,
  chainLength: 50,
  ropeLength: 50,
  chainWeight: 1.4,
  anchorWeight: 15
};

const timeDefaults = {
  hwTime: "15:00",
  lwTime: "09:00"
};

const ids = Object.keys(defaults);
const allInputIds = [...ids, ...Object.keys(timeDefaults)];
let lastDepthSource = "depth";
let syncingDepthFields = false;
let idealScope = null;
let diagramMode = "now";

function number(id) {
  const value = Number(document.getElementById(id).value);
  return Number.isFinite(value) ? value : 0;
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

function currentInputs() {
  return Object.fromEntries(ids.map((id) => [id, number(id)]));
}

function timeMinutes(id) {
  const [hours, minutes] = (document.getElementById(id).value || "00:00").split(":").map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

function calculateForDepth(input, depthLw) {
  const lowWaterDepth = depthLw + input.lwHeight;
  const depthHw = depthLw + input.tideHeight;
  const rodeLength = (depthHw + input.bowHeight) * input.scopeRatio;
  const totalRode = input.chainLength + input.ropeLength;
  const amountOnSeabed = Math.max(0, rodeLength - lowWaterDepth - input.bowHeight);
  const ropeOnSeabed = Math.max(0, amountOnSeabed - input.chainLength);
  const chainLifted = Math.min(input.bowHeight + depthHw, input.chainLength);
  const liftWeight = input.anchorWeight + chainLifted * input.chainWeight;
  const windForce = (1 / 500) * input.loa * input.loa * input.windSpeed * input.windSpeed;
  const shortfall = Math.max(0, rodeLength - totalRode);
  const lowWaterClearance = lowWaterDepth - input.draft;
  const clearanceMargin = lowWaterClearance - input.minClearance;

  return {
    chartedDepth: depthLw,
    depthLw: lowWaterDepth,
    sounderLw: lowWaterDepth - input.sounderOffset,
    depthHw,
    rodeLength,
    totalRode,
    amountOnSeabed,
    ropeOnSeabed,
    chainLifted,
    liftWeight,
    windForce,
    shortfall,
    lowWaterClearance,
    clearanceMargin
  };
}

function calculate() {
  const input = currentInputs();
  return calculateForDepth(input, Math.max(0, input.depthLw));
}

function calculateDiagramResult(mode = diagramMode) {
  const input = currentInputs();
  const tideHeight = mode === "lw" ? input.lwHeight : mode === "hw" ? input.hwHeight : input.tideHeight;
  return calculateForDepth({ ...input, tideHeight }, Math.max(0, input.depthLw));
}

function calculateIdealScope(input = currentInputs()) {
  const depthLw = Math.max(0, input.depthLw);
  const depthHw = depthLw + input.tideHeight;
  const verticalDrop = Math.max(0.1, depthHw + input.bowHeight);
  const totalRode = input.chainLength + input.ropeLength;
  const availableMax = totalRode / verticalDrop;
  const chainFriendlyMax = (input.chainLength + depthLw + input.lwHeight + input.bowHeight) / verticalDrop;
  const wind = input.windSpeed;
  let desired = 3;

  if (wind > 15) desired = 4;
  if (wind > 25) desired = 5;
  if (wind > 35) desired = 6;
  if (wind > 45) desired = 7;
  if (wind > 55) desired = 8;
  if (wind > 65) desired = 9;
  if (input.tideHeight >= 4 || depthHw >= 10) desired += 0.5;

  const capped = Math.max(1, Math.min(desired, availableMax, 10));
  const recommended = round(capped * 2, 0) / 2;
  const result = calculateForDepth({ ...input, scopeRatio: recommended }, depthLw);
  const notes = [];

  notes.push(`${fmt(wind, 0, " kn")} wind starts the recommendation at ${fmt(desired, 1, ":1")}.`);
  if (availableMax < desired) notes.push(`Available rode caps this at ${fmt(availableMax, 1, ":1")}.`);
  if (recommended > chainFriendlyMax && input.ropeLength > 0) {
    notes.push(`This may put about ${fmt(result.ropeOnSeabed, 1, " m")} of rope on the seabed at low water.`);
  } else {
    notes.push("Keeps the seabed section on chain at low water with the current settings.");
  }
  if (recommended < 3) notes.push("This is below a usual minimum because the available rode is tight for the depth.");

  return {
    scope: recommended,
    rodeLength: result.rodeLength,
    shortfall: result.shortfall,
    ropeOnSeabed: result.ropeOnSeabed,
    notes
  };
}

function showIdealScopeRecommendation(recommendation) {
  const panel = document.getElementById("scopeRecommendation");
  panel.classList.add("hasRecommendation");
  panel.querySelector("strong").textContent = fmt(recommendation.scope, 1, ":1");
  panel.querySelector("p").textContent = `${recommendation.notes.join(" ")} Rode needed: ${fmt(recommendation.rodeLength, 1, " m")}.`;
}

function clearIdealScopeRecommendation() {
  const panel = document.getElementById("scopeRecommendation");
  panel.classList.remove("hasRecommendation");
  panel.querySelector("strong").textContent = "-";
  panel.querySelector("p").textContent = "Use the button to calculate a recommendation from the current conditions and boat settings.";
}

function syncDepth(source) {
  if (syncingDepthFields) return;
  syncingDepthFields = true;
  const offset = number("sounderOffset");
  if (source === "depth") {
    document.getElementById("sounderLw").value = round(number("depthLw") + number("lwHeight") - offset, 1);
  } else {
    document.getElementById("depthLw").value = round(number("sounderLw") + offset - number("lwHeight"), 1);
  }
  syncingDepthFields = false;
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
  const currentDepth = input.depthLw + height;
  const lowWaterDepth = input.depthLw + input.lwHeight;
  const lowWaterClearance = lowWaterDepth - input.draft;
  return {
    height,
    currentDepth,
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
  document.getElementById("tideHeight").value = round(tide.height, 1);
  document.getElementById("currentTimeLabel").textContent = formatClock(tide.now);
  document.getElementById("currentRiseLabel").textContent = `${fmt(tide.height, 1, " m")} ${tide.phase.toLowerCase()}`;
  document.getElementById("currentDepthLabel").textContent = fmt(tide.currentDepth, 1, " m");
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
    status.textContent = `Low-water clearance is ${fmt(tide.lowWaterClearance, 1, " m")} using the entered LW height.`;
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
      text: `Rode is short by ${fmt(result.shortfall, 1, " m")} for ${fmt(number("scopeRatio"), 1, ":1")} scope at the current tide height.`
    };
  }
  if (result.ropeOnSeabed > 0) {
    return {
      level: "warning",
      text: `${fmt(result.ropeOnSeabed, 1, " m")} of rope is on the seabed at low water. Check abrasion and chafe risk.`
    };
  }
  if (result.amountOnSeabed < 10) {
    return {
      level: "warning",
      text: `Only ${fmt(result.amountOnSeabed, 1, " m")} of rode is lying on the seabed at low water.`
    };
  }
  return {
    level: "good",
    text: `Rode length is within available rode, with ${fmt(result.amountOnSeabed, 1, " m")} lying on the seabed at low water.`
  };
}

function updateSummary(result) {
  document.getElementById("windForce").textContent = fmt(result.windForce, 0, " kg");
  document.getElementById("rodeNeeded").textContent = fmt(result.rodeLength, 1, " m");
  document.getElementById("rodeAvailable").textContent = fmt(result.totalRode, 1, " m");
  document.getElementById("seabedLength").textContent = fmt(result.amountOnSeabed, 1, " m");
  document.getElementById("liftWeight").textContent = fmt(result.liftWeight, 1, " kg");
  document.getElementById("ropeSeabed").textContent = fmt(result.ropeOnSeabed, 1, " m");

  const status = statusText(result);
  const banner = document.getElementById("statusBanner");
  banner.className = `statusBanner ${status.level === "good" ? "" : status.level}`;
  banner.textContent = status.text;
}

function svg(tag, attrs = {}, children = []) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  children.forEach((child) => el.appendChild(child));
  return el;
}

function renderDiagram(result, mode = diagramMode) {
  const input = currentInputs();
  const target = document.getElementById("rodeDiagram");
  target.innerHTML = "";
  const modeLabel = mode === "lw" ? "LW" : mode === "hw" ? "HW" : "Now";

  const width = 860;
  const height = 300;
  const seabedY = 222;
  const bowX = 120;
  const verticalDrop = Math.max(0.1, result.depthHw + input.bowHeight);
  const horizontalReach = Math.sqrt(Math.max(0, result.rodeLength ** 2 - verticalDrop ** 2));
  const visibleRun = Math.max(horizontalReach, result.amountOnSeabed, input.loa, 10);
  const scale = Math.min(650 / visibleRun, 156 / verticalDrop);
  const waterY = seabedY - result.depthHw * scale;
  const lowWaterY = seabedY - result.depthLw * scale;
  const bowPointY = seabedY - verticalDrop * scale;
  const anchorX = bowX + horizontalReach * scale;
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
  const boatTotalHeight = input.bowHeight + input.draft;
  const labelX = Math.min(anchorX - 170, Math.max(bowX + 120, bowX + horizontalReach * scale * 0.48));
  const rodeMidY = (bowPointY + anchorY) / 2 - 10;
  const ropeDeployed = Math.max(0, result.rodeLength - input.chainLength);
  const chainDeployed = Math.min(result.rodeLength, input.chainLength);
  const chainStartRatio = result.rodeLength > 0 ? ropeDeployed / result.rodeLength : 0;
  const chainStartX = bowX + (anchorX - bowX) * chainStartRatio;
  const chainStartY = bowPointY + (anchorY - bowPointY) * chainStartRatio;
  const chainOnSeabed = Math.min(result.amountOnSeabed, input.chainLength);
  const ropeOnSeabedStartX = anchorX - result.amountOnSeabed * scale;
  const chainOnSeabedStartX = anchorX - chainOnSeabed * scale;
  const hasRopeDeployed = ropeDeployed > 0.05;
  const hasRopeOnSeabed = result.ropeOnSeabed > 0.05;

  target.append(
    svg("rect", { x: 0, y: waterY, width, height: seabedY - waterY, fill: "#dbeef7" }),
    svg("rect", { x: 0, y: seabedY, width, height: height - seabedY, fill: "#d7c4a3" }),
    svg("line", { x1: 0, y1: waterY, x2: width, y2: waterY, stroke: "#1f6f8b", "stroke-width": 3 }),
    svg("line", { x1: 0, y1: lowWaterY, x2: width, y2: lowWaterY, stroke: "#5aa5c9", "stroke-width": 2, "stroke-dasharray": "7 6" }),
    svg("line", { x1: bowX - 36, y1: waterY, x2: bowX - 36, y2: seabedY, stroke: "#1f6f8b", "stroke-width": 2 }),
    svg("line", { x1: bowX - 43, y1: waterY, x2: bowX - 29, y2: waterY, stroke: "#1f6f8b", "stroke-width": 2 }),
    svg("line", { x1: bowX - 43, y1: seabedY, x2: bowX - 29, y2: seabedY, stroke: "#1f6f8b", "stroke-width": 2 }),
    svg("text", { x: 18, y: Math.max(18, waterY - 10), fill: "#5f6c76", "font-size": 13 }, [document.createTextNode(`${modeLabel} depth ${fmt(result.depthHw, 1, " m")}`)]),
    svg("text", { x: 18, y: lowWaterY - 8, fill: "#4f7f99", "font-size": 12 }, [document.createTextNode(`LW depth ${fmt(result.depthLw, 1, " m")}`)]),
    svg("text", { x: bowX - 26, y: (waterY + seabedY) / 2, fill: "#1f6f8b", "font-size": 12, transform: `rotate(-90 ${bowX - 26} ${(waterY + seabedY) / 2})` }, [document.createTextNode(fmt(result.depthHw, 1, " m"))]),
    svg("path", { d: `M${boatSternX} ${sternDeckY} L${bowX - 6} ${bowDeckY} L${bowX + 22} ${bowPointY} L${bowX - 10} ${waterY + draftPx * 0.08} L${boatSternX + 22} ${hullBottomY} Z`, fill: "#ffffff", stroke: "#17212b", "stroke-width": 2 }),
    svg("path", { d: `M${keelCenterX - keelHalfWidth} ${keelTopY} L${keelCenterX + keelHalfWidth} ${keelTopY} L${keelCenterX + keelHalfWidth * 0.55} ${keelBottomY} L${keelCenterX - keelHalfWidth * 0.55} ${keelBottomY} Z`, fill: keelHitsBottom ? "#d76c6c" : "#6f7f8a", stroke: "#17212b", "stroke-width": 2, opacity: 0.95 }),
    svg("line", { x1: keelCenterX + keelHalfWidth + 12, y1: waterY, x2: keelCenterX + keelHalfWidth + 12, y2: keelBottomY, stroke: keelHitsBottom ? "#b44444" : "#5f6c76", "stroke-width": 2 }),
    svg("line", { x1: keelCenterX + keelHalfWidth + 6, y1: waterY, x2: keelCenterX + keelHalfWidth + 18, y2: waterY, stroke: keelHitsBottom ? "#b44444" : "#5f6c76", "stroke-width": 2 }),
    svg("line", { x1: keelCenterX + keelHalfWidth + 6, y1: keelBottomY, x2: keelCenterX + keelHalfWidth + 18, y2: keelBottomY, stroke: keelHitsBottom ? "#b44444" : "#5f6c76", "stroke-width": 2 }),
    svg("circle", { cx: bowX, cy: bowPointY, r: 5, fill: "#17212b" }),
    ...(hasRopeDeployed ? [svg("line", { x1: bowX, y1: bowPointY, x2: chainStartX, y2: chainStartY, stroke: "#c77a16", "stroke-width": 5, "stroke-linecap": "round", "stroke-dasharray": "10 7" })] : []),
    ...(chainDeployed > 0 ? [svg("line", { x1: chainStartX, y1: chainStartY, x2: anchorX, y2: anchorY, stroke: "#2f3b44", "stroke-width": 6, "stroke-linecap": "round", "stroke-dasharray": "3 7" })] : []),
    ...(hasRopeOnSeabed ? [svg("line", { x1: ropeOnSeabedStartX, y1: seabedY + 4, x2: chainOnSeabedStartX, y2: seabedY + 4, stroke: "#c77a16", "stroke-width": 7, "stroke-linecap": "round", "stroke-dasharray": "10 7", opacity: 0.9 })] : []),
    svg("line", { x1: chainOnSeabedStartX, y1: seabedY + 4, x2: anchorX, y2: seabedY + 4, stroke: "#2f3b44", "stroke-width": 7, "stroke-linecap": "round", "stroke-dasharray": "3 7", opacity: 0.9 }),
    svg("path", { d: `M${anchorX - 20} ${anchorY - 18} L${anchorX} ${anchorY} L${anchorX + 24} ${anchorY - 12} M${anchorX} ${anchorY} L${anchorX + 2} ${anchorY - 34}`, stroke: "#17212b", "stroke-width": 5, fill: "none", "stroke-linecap": "round" }),
    svg("text", { x: Math.max(160, bowX + 28), y: waterY - 28, fill: "#17212b", "font-size": 13, "font-weight": 700 }, [document.createTextNode(`${modeLabel}: bow ${fmt(input.bowHeight, 1, " m")} + draft ${fmt(input.draft, 1, " m")}`)]),
    svg("text", { x: keelCenterX + keelHalfWidth + 20, y: Math.min(keelBottomY + 16, seabedY - 8), fill: keelHitsBottom ? "#8f2222" : "#17212b", "font-size": 12 }, [document.createTextNode(`draft ${fmt(input.draft, 1, " m")}`)]),
    svg("text", { x: Math.max(160, bowX + 28), y: waterY - 12, fill: "#5f6c76", "font-size": 12 }, [document.createTextNode(`boat height approx ${fmt(boatTotalHeight, 1, " m")}`)]),
    svg("text", { x: labelX, y: rodeMidY, fill: "#17212b", "font-size": 14, "font-weight": 700 }, [document.createTextNode(`Rode ${fmt(result.rodeLength, 1, " m")} at ${fmt(input.scopeRatio, 1, ":1")}`)]),
    svg("line", { x1: 588, y1: 34, x2: 636, y2: 34, stroke: "#2f3b44", "stroke-width": 6, "stroke-linecap": "round", "stroke-dasharray": "3 7" }),
    svg("text", { x: 644, y: 38, fill: "#17212b", "font-size": 12 }, [document.createTextNode(`chain ${fmt(Math.min(input.chainLength, result.rodeLength), 1, " m")}`)]),
    svg("line", { x1: 588, y1: 54, x2: 636, y2: 54, stroke: "#c77a16", "stroke-width": 5, "stroke-linecap": "round", "stroke-dasharray": "10 7" }),
    svg("text", { x: 644, y: 58, fill: "#17212b", "font-size": 12 }, [document.createTextNode(`rope ${fmt(ropeDeployed, 1, " m")}`)]),
    svg("text", { x: Math.max(bowX + 10, lowWaterTouchX + 10), y: seabedY + 28, fill: "#17212b", "font-size": 13 }, [document.createTextNode(`${fmt(result.amountOnSeabed, 1, " m")} on seabed at LW`)]),
    svg("text", { x: 18, y: seabedY + 56, fill: "#5f4b2c", "font-size": 13 }, [document.createTextNode(`Available: ${fmt(result.totalRode, 1, " m")} (${fmt(input.chainLength, 0, " m")} chain + ${fmt(input.ropeLength, 0, " m")} rope)`)]) 
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
      fmt(rowResult.depthHw, 1, " m"),
      fmt(rowResult.rodeLength, 1, " m"),
      fmt(rowResult.amountOnSeabed, 1, " m"),
      fmt(rowResult.ropeOnSeabed, 1, " m"),
      fmt(rowResult.liftWeight, 1, " kg")
    ];
  });
  renderTable("scopeTable", ["Charted depth", "Depth @ LW", "Current depth", "Rode length", "On seabed @ LW", "Rope on seabed", "Weight to lift"], rows, (_, index) => index + 1 === Math.round(result.chartedDepth));
}

function renderForceTable() {
  const input = currentInputs();
  const speeds = [20, 30, 40, 50, 60, 70];
  const rows = speeds.map((speed) => [
    `${speed} kn`,
    fmt(input.loa, 1, " m"),
    fmt((1 / 500) * input.loa * input.loa * speed * speed, 0, " kg")
  ]);
  renderTable("forceTable", ["Wind speed", "LOA", "Force"], rows, (row) => row[0] === `${Math.round(input.windSpeed / 10) * 10} kn`);
}

function renderRodeTable() {
  const input = currentInputs();
  renderTable("rodeTable", ["Type", "Diameter", "Weight kg/m", "Total weight", "Typical WLL", "Typical break"], [
    ["G40 Chain", "8mm", fmt(input.chainWeight, 1), fmt(input.chainLength * input.chainWeight, 1, " kg"), "800 kgf", "4030 kgf"],
    ["Anchorplait", "14mm", "-", "-", "-", "-"]
  ]);
}

function renderForceChart() {
  const input = currentInputs();
  const target = document.getElementById("forceChart");
  target.innerHTML = "";
  const points = [20, 30, 40, 50, 60, 70].map((speed) => ({
    speed,
    force: (1 / 500) * input.loa * input.loa * speed * speed
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
  updateTideSummary();
  const result = calculate();
  updateSummary(result);
  renderDiagram(calculateDiagramResult(), diagramMode);
  renderScopeTable(result);
  renderForceTable();
  renderRodeTable();
  renderForceChart();
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

allInputIds.forEach((id) => {
  document.getElementById(id).addEventListener("input", () => {
    if (id === "depthLw") {
      lastDepthSource = "depth";
      syncDepth("depth");
    }
    if (id === "sounderLw") {
      lastDepthSource = "sounder";
      syncDepth("sounder");
    }
    if (id === "sounderOffset" || id === "lwHeight") syncDepth(lastDepthSource);
    idealScope = null;
    clearIdealScopeRecommendation();
    renderAll();
  });
});

document.getElementById("calculateIdealScope").addEventListener("click", () => {
  idealScope = calculateIdealScope();
  showIdealScopeRecommendation(idealScope);
});

document.getElementById("applyIdealScope").addEventListener("click", () => {
  if (!idealScope) idealScope = calculateIdealScope();
  document.getElementById("scopeRatio").value = idealScope.scope;
  renderAll();
  showIdealScopeRecommendation(idealScope);
});

document.getElementById("resetDefaults").addEventListener("click", () => {
  Object.entries(defaults).forEach(([id, value]) => {
    document.getElementById(id).value = value;
  });
  Object.entries(timeDefaults).forEach(([id, value]) => {
    document.getElementById(id).value = value;
  });
  lastDepthSource = "depth";
  idealScope = null;
  clearIdealScopeRecommendation();
  syncDepth("depth");
  renderAll();
});

document.getElementById("stopServer").addEventListener("click", async () => {
  try {
    await fetch("/api/stop", { method: "POST" });
  } finally {
    document.body.innerHTML = "<main><h1>Anchor Force Planner stopped</h1><p>You can close this tab.</p></main>";
  }
});

syncDepth("depth");
renderAll();
setInterval(renderAll, 60 * 1000);
