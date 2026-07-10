#!/usr/bin/env node
// Local preview: serves web/ and proxies /data/* to Vercel Blob the way the
// deployed rewrites do.
//   node scripts/dev-web.js [--port 4890]

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const WEB = path.resolve(__dirname, "..", "web");

const BLOB = "https://cfrjzkgnoil4u5ks.public.blob.vercel-storage.com";
const PORT = Number(process.argv[process.argv.indexOf("--port") + 1]) || 4890;

const types = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json; charset=utf-8", ".txt": "text/plain; charset=utf-8"
};

http.createServer((req, res) => {
  const url = new URL(req.url, `http://x`);
  if (url.pathname === "/api/watches") {
    require("../api/watches.js")(req, res).catch((e) => { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message })); });
    return;
  }
  if (url.pathname === "/api/rescan") {
    require("../api/rescan.js")(req, res).catch((e) => { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message })); });
    return;
  }
  if (url.pathname.startsWith("/data/")) {
    https.get(BLOB + url.pathname, (up) => {
      res.writeHead(up.statusCode, { "content-type": up.headers["content-type"] || "application/json", "cache-control": "no-store" });
      up.pipe(res);
    }).on("error", () => { res.writeHead(502); res.end("upstream error"); });
    return;
  }
  const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const file = path.resolve(WEB, rel);
  if (!file.startsWith(WEB + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("Not found"); return;
  }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, "127.0.0.1", () => console.log(`Woodhouse Spa Openings dev: http://127.0.0.1:${PORT}`));
