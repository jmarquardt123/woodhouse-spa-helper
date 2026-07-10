#!/usr/bin/env node
// Rebuild data/index.json on Blob from the committed registry joined with the
// Blob listing (which datasets exist + when each was uploaded). Race-free
// across parallel CI shards: no shard-local state involved.

const fs = require("fs");
const path = require("path");
const { list, put } = require("@vercel/blob");

const ROOT = path.resolve(__dirname, "..");

(async () => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("BLOB_READ_WRITE_TOKEN is not set.");
    process.exit(1);
  }
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "locations.json"), "utf8"));
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix: "data/locations/", cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : null;
  } while (cursor);
  const byKey = new Map(blobs
    .filter((b) => !b.pathname.endsWith("-near.json"))
    .map((b) => [path.basename(b.pathname, ".json"), b]));

  const locations = registry.locations
    .filter((l) => byKey.has(l.key))
    .map((l) => ({
      key: l.key,
      label: l.label,
      city: l.city,
      state: l.state,
      phone: l.phone,
      lat: l.lat,
      lng: l.lng,
      scannedAt: byKey.get(l.key).uploadedAt,
      bytes: byKey.get(l.key).size
    }));

  const index = { generatedAt: new Date().toISOString(), count: locations.length, locations };
  const res = await put("data/index.json", JSON.stringify(index), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 300
  });
  console.log(`index: ${locations.length} locations with data -> ${res.url}`);
})().catch((e) => { console.error("merge-index failed:", e.message); process.exit(1); });
