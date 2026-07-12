#!/usr/bin/env node
// Upload condensed location datasets + index to Vercel Blob at stable paths.
// The site fetches these directly — data refreshes never redeploy the site.
//
//   BLOB_READ_WRITE_TOKEN=… node scripts/upload-blob.js [--only <key>]
//
// Uploads out/locations/*.json -> data/locations/<key>.json and
// out/index.json -> data/index.json.
//
// HASH-CHECKED: a data/manifest.json blob records the sha256 of every uploaded
// file. On each run we read the manifest (a plain public GET — not a Blob
// "advanced operation"), skip files whose content is unchanged, and rewrite the
// manifest only when something actually uploaded. An unchanged deploy costs 0
// advanced operations instead of one put per file.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { put } = require("@vercel/blob");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "out");
const MANIFEST_REMOTE = "data/manifest.json";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// Public base URL of the Blob store, read from vercel.json's /data rewrite so
// the constant lives in exactly one place. Env override wins.
function blobPublicBase() {
  if (process.env.BLOB_PUBLIC_BASE) return process.env.BLOB_PUBLIC_BASE.replace(/\/$/, "");
  try {
    const vj = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
    for (const r of vj.rewrites || []) {
      const m = String(r.destination || "").match(/^(https:\/\/[^/]+)/);
      if (m && /blob\.vercel-storage\.com/.test(r.destination)) return m[1];
    }
  } catch (e) { /* fall through */ }
  return "";
}

async function loadManifest(base) {
  if (!base) return {};
  try {
    const r = await fetch(`${base}/${MANIFEST_REMOTE}?cb=${Date.now()}`);
    if (r.ok) {
      const j = await r.json();
      return j && typeof j === "object" ? j : {};
    }
  } catch (e) { /* first run / unreachable — treat as empty */ }
  return {};
}

// Pure planner (unit-tested): decide what to upload given current file hashes
// and the last manifest. Returns { toUpload:[remote...], nextManifest }.
function planSync(fileHashes, manifest) {
  const next = { ...manifest };
  const toUpload = [];
  for (const { remote, hash } of fileHashes) {
    if (manifest[remote] !== hash) {
      toUpload.push(remote);
      next[remote] = hash;
    }
  }
  return { toUpload, nextManifest: next };
}

async function main() {
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

  const bodies = new Map();
  const fileHashes = files.map((f) => {
    const body = fs.readFileSync(f.local);
    bodies.set(f.remote, body);
    return { remote: f.remote, hash: sha256(body) };
  });

  const base = blobPublicBase();
  const manifest = await loadManifest(base);
  const { toUpload, nextManifest } = planSync(fileHashes, manifest);

  const upSet = new Set(toUpload);
  let uploaded = 0, skipped = 0;
  for (const f of files) {
    if (!upSet.has(f.remote)) { skipped++; continue; }
    const body = bodies.get(f.remote);
    const res = await put(f.remote, body, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 300
    });
    uploaded++;
    console.log(`uploaded ${f.remote} (${(body.length / 1024).toFixed(0)} KB) -> ${res.url}`);
  }

  if (uploaded > 0) {
    await put(MANIFEST_REMOTE, JSON.stringify(nextManifest), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 0 // manifest is mutable — must not be cached stale
    });
  }
  console.log(`done: ${uploaded} uploaded, ${skipped} unchanged`);
}

module.exports = { planSync, sha256 };

if (require.main === module) {
  main().catch((e) => { console.error("upload failed:", e.message); process.exit(1); });
}
