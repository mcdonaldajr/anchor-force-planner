import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const publicDir = join(root, "public");
const dataDir = join(root, "data");
const cacheDir = join(dataDir, "cache");
const stateFile = join(dataDir, "anchor-force-state.json");
const port = Number(process.env.PORT || 4184);
const host = process.env.HOST || "127.0.0.1";
const serverVersion = "0.5.1";
const serverStartedAt = new Date().toISOString();

const obanReferenceLevels = {
  mhws: 4.0,
  mhwn: 2.9,
  mlwn: 1.8,
  mlws: 0.7
};

const defaultSecondaryPorts = [
  {
    id: "bucklers-hard",
    name: "Bucklers Hard",
    standardPort: "Portsmouth",
    standardReferenceLevels: { mhws: 4.7, mhwn: 3.8, mlwn: 1.5, mlws: 0.8 },
    hwOffsets: { t0000: -40, t0600: -10, t1200: 0, t1800: -10 },
    lwOffsets: { t0000: 50, t0600: 110, t1200: 70, t1800: 110 },
    heightDiffs: { mhws: -1.0, mhwn: -0.8, mlwn: -0.3, mlws: -0.3 },
    notes: "Example from almanac image. Standard port Portsmouth."
  },
  {
    id: "tobermory",
    name: "Tobermory",
    hwOffsets: { t0000: 20, t0600: 20, t1200: 20, t1800: 20 },
    lwOffsets: { t0000: 20, t0600: 20, t1200: 20, t1800: 20 },
    heightDiffs: { mhws: 0.5, mhwn: 0.6, mlwn: 0.1, mlws: 0.2 },
    notes: "HW Oban +0020. LW assumed +0020 until checked."
  },
  {
    id: "port-ellen",
    name: "Port Ellen",
    hwOffsets: { t0000: -330, t0600: -50, t1200: -330, t1800: -50 },
    lwOffsets: { t0000: 0, t0600: 0, t1200: 0, t1800: 0 },
    heightDiffs: { mhws: -3.1, mhwn: -2.1, mlwn: -1.3, mlws: -0.4 },
    notes: "HW Oban -0530 at springs, -0050 at neaps. LW not supplied."
  },
  {
    id: "loch-melfort",
    name: "Loch Melfort",
    hwOffsets: { t0000: -45, t0600: -45, t1200: -45, t1800: -45 },
    lwOffsets: { t0000: -45, t0600: -45, t1200: -45, t1800: -45 },
    heightDiffs: { mhws: -1.2, mhwn: -0.8, mlwn: -0.5, mlws: -0.1 },
    notes: "HW approx Oban -0045. Interpreted supplied 2.1 m as MHWN."
  }
];

const defaultState = {
  tide: {
    source: "oban",
    selectedPortId: "",
    obanReferenceLevels,
    oban: {
      hwTime: "15:00",
      lwTime: "09:00",
      hwHeight: 4,
      lwHeight: 1
    }
  },
  secondaryPorts: defaultSecondaryPorts,
  deletedSecondaryPortIds: [],
  tideData: {
    stationName: "Oban",
    stationId: "0372",
    timeStandard: "UT",
    displayTimeMode: "ut",
    ukhoAccountEmail: "",
    ukhoApiKey: "",
    events: [],
    cache: null
  }
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

function cacheName(prefix, key) {
  return join(cacheDir, `${prefix}-${key.replace(/[^a-z0-9._-]+/gi, "_")}.json`);
}

async function readCache(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function readFreshCache(path, maxAgeMs) {
  try {
    const info = await stat(path);
    if (Date.now() - info.mtimeMs > maxAgeMs) return null;
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function writeCache(path, payload) {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function mergeState(state = {}) {
  const statePorts = Array.isArray(state.secondaryPorts) ? state.secondaryPorts : [];
  const deletedSecondaryPortIds = Array.isArray(state.deletedSecondaryPortIds) ? state.deletedSecondaryPortIds : [];
  const mergedPorts = defaultSecondaryPorts.filter((port) => !deletedSecondaryPortIds.includes(port.id));
  statePorts.forEach((port) => {
    const existingIndex = mergedPorts.findIndex((item) => item.id === port.id);
    if (existingIndex >= 0) mergedPorts[existingIndex] = { ...mergedPorts[existingIndex], ...port };
    else mergedPorts.push(port);
  });
  return {
    tide: {
      ...defaultState.tide,
      ...(state.tide || {}),
      obanReferenceLevels: {
        ...defaultState.tide.obanReferenceLevels,
        ...(state.tide?.obanReferenceLevels || {})
      },
      oban: {
        ...defaultState.tide.oban,
        ...(state.tide?.oban || {})
      }
    },
    secondaryPorts: mergedPorts,
    deletedSecondaryPortIds,
    tideData: {
      ...defaultState.tideData,
      ...(state.tideData || {})
    }
  };
}

function publicState(state) {
  return {
    ...state,
    tideData: {
      ...state.tideData,
      ukhoApiKey: undefined,
      ukhoApiKeySet: Boolean(state.tideData?.ukhoApiKey || process.env.UKHO_API_KEY)
    }
  };
}

async function readState() {
  try {
    return mergeState(JSON.parse(await readFile(stateFile, "utf8")));
  } catch {
    return mergeState();
  }
}

async function writeState(state) {
  const merged = mergeState(state);
  await mkdir(dataDir, { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

async function readRequestJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

async function refreshTideData(options = {}) {
  const state = await readState();
  const stationId = String(options.stationId || state.tideData.stationId || "0372").padStart(4, "0");
  const stationName = options.stationName || state.tideData.stationName || "Oban";
  const timeStandard = options.timeStandard || state.tideData.timeStandard || "UT";
  const cachePath = cacheName("tides", `${stationId}_${todayKey()}`);
  const cached = options.force ? null : await readFreshCache(cachePath, 24 * 60 * 60 * 1000);
  if (cached) {
    state.tideData = {
      ...state.tideData,
      stationId,
      stationName,
      timeStandard,
      events: cached.events || [],
      cache: { ...cached.cache, hit: true }
    };
    await writeState(state);
    return publicState(state).tideData;
  }

  const apiKey = process.env.UKHO_API_KEY || state.tideData.ukhoApiKey;
  if (!apiKey) {
    const stale = await readCache(cachePath);
    if (stale) {
      state.tideData = {
        ...state.tideData,
        stationId,
        stationName,
        timeStandard,
        events: stale.events || [],
        cache: { ...stale.cache, hit: true, stale: true }
      };
      await writeState(state);
      return publicState(state).tideData;
    }
    const error = new Error("UKHO_API_KEY is not set and no cached tide data is available");
    error.status = 400;
    throw error;
  }

  const paths = [
    `https://admiraltyapi.azure-api.net/uktidalapi/v1/Stations/${stationId}/TidalEvents`,
    `https://admiraltyapi.azure-api.net/uktidalapi/api/v1/Stations/${stationId}/TidalEvents`
  ];
  let lastError = "No response";
  for (const path of paths) {
    const response = await fetch(path, { headers: { "Ocp-Apim-Subscription-Key": apiKey } });
    if (response.ok) {
      const payload = {
        stationId,
        stationName,
        timeStandard,
        events: await response.json(),
        cache: {
          hit: false,
          fetchedAt: new Date().toISOString(),
          refreshAfter: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          policy: "once per day UKHO tide cache"
        }
      };
      await writeCache(cachePath, payload);
      state.tideData = {
        ...state.tideData,
        stationId,
        stationName,
        timeStandard,
        events: payload.events,
        cache: payload.cache
      };
      await writeState(state);
      return publicState(state).tideData;
    }
    lastError = `${response.status} ${response.statusText}`;
  }
  const error = new Error(lastError);
  error.status = 502;
  throw error;
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;

  if (pathname === "/api/version") {
    send(res, 200, JSON.stringify({
      name: "Anchor Force Planner",
      serverVersion,
      port,
      host,
      startedAt: serverStartedAt
    }), "application/json; charset=utf-8");
    return;
  }

  if (pathname === "/api/state" && req.method === "GET") {
    send(res, 200, JSON.stringify(publicState(await readState())), "application/json; charset=utf-8");
    return;
  }

  if (pathname === "/api/state" && req.method === "PUT") {
    try {
      const body = await readRequestJson(req);
      const existing = await readState();
      body.tideData = {
        ...(body.tideData || {}),
        ukhoApiKey: body.tideData?.ukhoApiKey || existing.tideData.ukhoApiKey
      };
      send(res, 200, JSON.stringify(publicState(await writeState(body))), "application/json; charset=utf-8");
    } catch {
      send(res, 400, JSON.stringify({ error: "Invalid state" }), "application/json; charset=utf-8");
    }
    return;
  }

  if (pathname === "/api/tide-data/settings" && req.method === "PUT") {
    try {
      const body = await readRequestJson(req);
      const state = await readState();
      state.tideData = {
        ...state.tideData,
        stationName: String(body.stationName || state.tideData.stationName || "Oban").trim() || "Oban",
        stationId: String(body.stationId || state.tideData.stationId || "0372").trim().padStart(4, "0"),
        timeStandard: String(body.timeStandard || state.tideData.timeStandard || "UT").trim() || "UT",
        displayTimeMode: body.displayTimeMode === "local" ? "local" : "ut",
        ukhoAccountEmail: String(body.ukhoAccountEmail || "").trim(),
        ukhoApiKey: body.clearUkhoApiKey === true
          ? ""
          : typeof body.ukhoApiKey === "string" && body.ukhoApiKey.trim()
            ? body.ukhoApiKey.trim()
            : state.tideData.ukhoApiKey
      };
      send(res, 200, JSON.stringify(publicState(await writeState(state)).tideData), "application/json; charset=utf-8");
    } catch {
      send(res, 400, JSON.stringify({ error: "Invalid tide data settings" }), "application/json; charset=utf-8");
    }
    return;
  }

  if (pathname === "/api/tide-data/refresh" && req.method === "POST") {
    try {
      const body = await readRequestJson(req).catch(() => ({}));
      const tideData = await refreshTideData({
        force: body.force === true,
        stationId: body.stationId,
        stationName: body.stationName,
        timeStandard: body.timeStandard
      });
      send(res, 200, JSON.stringify(tideData), "application/json; charset=utf-8");
    } catch (error) {
      send(res, error.status || 502, JSON.stringify({ error: error.message || "Tide data refresh failed" }), "application/json; charset=utf-8");
    }
    return;
  }

  if (pathname === "/api/stop" && req.method === "POST") {
    send(res, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8");
    setTimeout(() => process.exit(0), 80);
    return;
  }

  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    send(res, 403, "Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    send(res, 200, body, contentTypes[extname(filePath)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found");
  }
}).listen(port, host, () => {
  console.log(`Anchor Force Planner running at http://${host}:${port}`);
});
