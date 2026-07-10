#!/usr/bin/env node
// Upload condensed location datasets + index to Vercel Blob at stable paths.
// The site fetches these directly — data refreshes never redeploy the site.
//
//   BLOB_READ_WRITE_TOKEN=… node scripts/upload-blob.js [--only <key>]
//
// Uploads out/locations/*.json -> data/locations/<key>.json and
// out/index.json -> data/index.json.

const fs = require("fs");
const path = require("path");
const { put } = require("@vercel/blob");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "out");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

(async () => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("BLOB_READ_WRITE_TOKEN is not set.");
    process.exit(1);
  }
  const only = arg("only", null);
  const files = [];
  const locDir = path.join(OUT, "locations");
  if (fs.existsSync(locDir)) {
    for (const f of fs.readdirSync(locDir)) {
      if (!f.endsWith(".json")) continue;
      if (only && f !== `${only}.json`) continue;
      files.push({ local: path.join(locDir, f), remote: `data/locations/${f}` });
    }
  }
  const idx = path.join(OUT, "index.json");
  if (fs.existsSync(idx) && !only) files.push({ local: idx, remote: "data/index.json" });
  if (!files.length) { console.error("nothing to upload (run pull-location first)"); process.exit(1); }

  for (const f of files) {
    const body = fs.readFileSync(f.local);
    const res = await put(f.remote, body, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 300
    });
    console.log(`uploaded ${f.remote} (${(body.length / 1024).toFixed(0)} KB) -> ${res.url}`);
  }
})().catch((e) => { console.error("upload failed:", e.message); process.exit(1); });
