// Local preview server for the built app.js/index.html — always no-cache,
// always the same port, prints both the localhost and LAN URL so there's
// nothing to look up or remember. Run via `npm run dev` (which rebuilds
// first) rather than directly, unless you specifically want to serve
// without rebuilding.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { networkInterfaces } from "node:os";

const ROOT = import.meta.dirname;
const PORT = 8080;
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".map": "application/json",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

function lanAddress(){
  for (const ifaces of Object.values(networkInterfaces())){
    for (const iface of ifaces || []){
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    const rel = urlPath === "/" ? "/index.html" : urlPath;
    const full = normalize(join(ROOT, rel));
    if (!full.startsWith(normalize(ROOT))) { res.writeHead(403); res.end("forbidden"); return; }
    const data = await readFile(full);
    // Always sent, unconditionally — the whole point is never having to
    // remember a flag or a browser dev-tools setting to see current code.
    res.writeHead(200, {
      "Content-Type": TYPES[extname(full)] || "application/octet-stream",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Cache-Control": "no-store" }); res.end("not found");
  }
});

// Fails loudly instead of a second silent server on the same port — this
// project has accumulated stray preview servers more than once.
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${PORT} is already in use — a preview server is probably already running.`);
    console.error(`Check first:  netstat -ano | findstr :${PORT}`);
    console.error(`If it's stale, stop it:  powershell -Command "Stop-Process -Id <pid> -Force"\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, "0.0.0.0", () => {
  const lan = lanAddress();
  console.log(`Fantasy Eggy preview — no-cache, port ${PORT}`);
  console.log(`  Local: http://localhost:${PORT}/`);
  if (lan) console.log(`  LAN:   http://${lan}:${PORT}/`);
  console.log(`Ctrl+C to stop.`);
});
