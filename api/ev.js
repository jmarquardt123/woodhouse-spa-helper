// POST /api/ev — first-party event beacon. The client BATCHES events and sends
// them as {events:[{type,key?,meta?,t?}, ...]}; the server geo-stamps the batch
// and stores it as ONE blob (see _lib/events.logEvents). The legacy single-event
// body {type,key?,meta?} is still accepted for cached clients. Bots are dropped.
// Never blocks the user: always returns 204 fast.

const { logEvents, geoOf } = require("./_lib/events");

const BOT = /bot|crawl|spider|slurp|bingpreview|headless|preview|monitor|curl|wget|python-requests|axios|node-fetch/i;

// batched payloads carry many events; allow more bytes than the old single-event cap
function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 24000) req.destroy(); });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

const TYPES = new Set(["visit", "location", "filter", "card", "recheck", "booking", "alert_start", "alert_confirm", "spa_page"]);
const MAX_BATCH = 50;

// Validate + trim one client event into a stored record; null if unusable.
function cleanEvent(raw, geo) {
  if (!raw || typeof raw !== "object") return null;
  const type = String(raw.type || "");
  if (!TYPES.has(type)) return null;
  let meta = {};
  try {
    if (raw.meta && typeof raw.meta === "object") {
      meta = JSON.parse(JSON.stringify(raw.meta).slice(0, 500));
    }
  } catch (e) { meta = {}; } // truncated/oversized meta must not drop the event
  return {
    t: typeof raw.t === "string" ? raw.t.slice(0, 30) : new Date().toISOString(),
    type,
    key: typeof raw.key === "string" ? raw.key.slice(0, 40) : "",
    meta,
    sid: typeof raw.sid === "string" ? raw.sid.slice(0, 24) : "",
    path: typeof raw.path === "string" ? raw.path.slice(0, 120) : "",
    ...geo
  };
}

module.exports = async (req, res) => {
  const done = () => { res.statusCode = 204; res.end(); };
  if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
  const geo = geoOf(req);
  if (BOT.test(geo.ua)) return done(); // don't log crawlers as visitors
  let body;
  try { body = await readBody(req); } catch (e) { return done(); }

  // New batched shape {events:[...]}, or legacy single {type,...}.
  const rawEvents = Array.isArray(body.events) ? body.events.slice(0, MAX_BATCH) : [body];
  const records = [];
  for (const raw of rawEvents) {
    const rec = cleanEvent(raw, geo);
    if (rec) records.push(rec);
  }

  if (records.length) {
    try { await logEvents(records); } catch (e) { /* analytics must never break UX */ }
  }
  done();
};
