// First-party event storage on Vercel Blob. Each event is its own small object
// under ev/<YYYY-MM-DD>/<ts>-<rand>.json — no append races, no database.
// The owner dashboard lists a date range and aggregates. Fine for early
// traffic; migrate to a KV/analytics store if volume gets large.

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

async function logEvent(ev) {
  const now = new Date();
  const rec = { t: now.toISOString(), ...ev };
  const path = `ev/${dayKey(now)}/${now.getTime()}-${evId()}.json`;
  await put(path, JSON.stringify(rec), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 31536000
  });
  return rec;
}

// Load all events across the last `days` days. Returns array of records.
async function loadEvents(days) {
  const out = [];
  const today = new Date();
  const wanted = new Set();
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() - i * 86400000);
    wanted.add(dayKey(d));
  }
  let cursor;
  const blobs = [];
  do {
    const page = await list({ prefix: "ev/", cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : null;
  } while (cursor);
  const inRange = blobs.filter((b) => {
    const m = b.pathname.match(/^ev\/(\d{4}-\d{2}-\d{2})\//);
    return m && wanted.has(m[1]);
  });
  // fetch bodies with bounded concurrency
  let i = 0;
  async function worker() {
    while (i < inRange.length) {
      const b = inRange[i++];
      try {
        const r = await fetch(b.url + "?cb=" + Date.now());
        if (r.ok) out.push(await r.json());
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

module.exports = { logEvent, loadEvents, geoOf };
