import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const publicDir = join(root, "public");
const port = Number(process.env.PORT || 4184);
const host = process.env.HOST || "127.0.0.1";
const serverVersion = "0.2.0";
const serverStartedAt = new Date().toISOString();

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
