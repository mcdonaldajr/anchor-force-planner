import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const publicDir = join(root, "public");
const dataDir = join(root, "data");
const stateFile = join(dataDir, "anchor-force-state.json");
const port = Number(process.env.PORT || 4184);
const host = process.env.HOST || "127.0.0.1";
const serverVersion = "0.4.1";
const serverStartedAt = new Date().toISOString();

const obanReferenceLevels = {
  mhws: 4.0,
  mhwn: 2.9,
  mlwn: 1.8,
  mlws: 0.7
};

const defaultSecondaryPorts = [
  {
    id: "tobermory",
    name: "Tobermory",
    hwTimeMode: "fixed",
    hwTimeOffset: 20,
    lwTimeMode: "fixed",
    lwTimeOffset: 20,
    heightMode: "levels",
    mhws: 4.5,
    mhwn: 3.5,
    mlwn: 1.9,
    mlws: 0.9,
    notes: "HW Oban +0020. LW time assumed +0020 until checked against your almanac."
  },
  {
    id: "port-ellen",
    name: "Port Ellen",
    hwTimeMode: "levels",
    hwSpringOffset: -330,
    hwNeapOffset: -50,
    lwTimeMode: "fixed",
    lwTimeOffset: 0,
    heightMode: "levels",
    mhws: 0.9,
    mhwn: 0.8,
    mlwn: 0.5,
    mlws: 0.3,
    notes: "HW Oban -0530 at springs, -0050 at neaps. LW time not supplied."
  },
  {
    id: "loch-melfort",
    name: "Loch Melfort",
    hwTimeMode: "fixed",
    hwTimeOffset: -45,
    lwTimeMode: "fixed",
    lwTimeOffset: -45,
    heightMode: "levels",
    mhws: 2.8,
    mhwn: 2.1,
    mlwn: 1.3,
    mlws: 0.6,
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
  deletedSecondaryPortIds: []
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
    deletedSecondaryPortIds
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
    send(res, 200, JSON.stringify(await readState()), "application/json; charset=utf-8");
    return;
  }

  if (pathname === "/api/state" && req.method === "PUT") {
    try {
      send(res, 200, JSON.stringify(await writeState(await readRequestJson(req))), "application/json; charset=utf-8");
    } catch {
      send(res, 400, JSON.stringify({ error: "Invalid state" }), "application/json; charset=utf-8");
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
