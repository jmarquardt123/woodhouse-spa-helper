// First-party event storage on Vercel Blob.
//
// Events are now BATCHED: the client queues events and flushes them as one
// beacon, so the server writes ONE blob per flush instead of one per event
// (the old ev/<day>/<ts>-<rand>.json = one put per visitor action, which was
// the main consumer of Blob "advanced operations"). Each blob's body is a
// JSON ARRAY of event records. Legacy single-record blobs are still read.
//
// Reads are scoped per day (list prefix ev/<day>/) instead of listing the
// entire all-time history, so cost is bounded by the requested window, not by
// how long the site has been running.

const { put, list } = require("@vercel/blob");

function dayKey(d) {
  return d.toISOString().slice(0, 10);
}

// deterministic-ish id without Math.random dependence issues in edge/runtime
let seq = 0;
function evId() {
  seq = (seq + 1) % 100000;
  return Date.now().toString(36) + "-" + seq.toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36);
}

// Write a batch of fully-formed event records as ONE blob. Records are already
// geo-stamped and validated by the caller (api/ev.js).
async function logEvents(records) {
  if (!Array.isArray(records) || records.length === 0) return [];
  const now = new Date();
  const path = `ev/${dayKey(now)}/${now.getTime()}-${evId()}.json`;
  await put(path, JSON.stringify(records), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 31536000
  });
  return records;
}

// Back-compat: single-event write (any caller still using the old signature).
async function logEvent(ev) {
  const rec = { t: new Date().toISOString(), ...ev };
  await logEvents([rec]);
  return rec;
}

// Load all events across the last `days` days. Returns array of records.
// Lists are scoped to ev/<day>/ per requested day (bounded), and bodies are
// fetched WITHOUT a cache-buster so the CDN can serve write-once event blobs
// from cache. Each body is a single record (legacy) or an array (batched).
async function loadEvents(days) {
  const out = [];
  const today = new Date();
  const dayKeys = [];
  for (let i = 0; i < days; i++) {
    dayKeys.push(dayKey(new Date(today.getTime() - i * 86400000)));
  }

  const blobs = [];
  for (const dk of dayKeys) {
    let cursor;
    do {
      const page = await list({ prefix: `ev/${dk}/`, cursor, limit: 1000 });
      blobs.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : null;
    } while (cursor);
  }

  // fetch bodies with bounded concurrency (cacheable — no cache-buster)
  let i = 0;
  async function worker() {
    while (i < blobs.length) {
      const b = blobs[i++];
      try {
        const r = await fetch(b.url);
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j)) out.push(...j);
          else out.push(j);
        }
      } catch (e) { /* skip */ }
    }
  }
  await Promise.all(Array.from({ length: 12 }, worker));
  out.sort((a, b) => (a.t < b.t ? 1 : -1));
  return out;
}

function geoOf(req) {
  const h = req.headers;
  return {
    ip: String(h["x-real-ip"] || (h["x-forwarded-for"] || "").split(",")[0] || "").trim(),
    country: h["x-vercel-ip-country"] || "",
    region: h["x-vercel-ip-country-region"] || "",
    city: decodeURIComponent(h["x-vercel-ip-city"] || "").replace(/\+/g, " "),
    ua: String(h["user-agent"] || "").slice(0, 200),
    ref: String(h["referer"] || h["referrer"] || "").slice(0, 300)
  };
}

module.exports = { logEvent, logEvents, loadEvents, geoOf };
