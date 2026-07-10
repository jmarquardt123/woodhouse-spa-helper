// POST /api/ev — first-party event beacon. Client sends {type, key?, meta?};
// server stamps geo/IP/referrer and stores it. Bots and prefetches are
// dropped. Never blocks the user: always returns 204 fast.

const { logEvent, geoOf } = require("./_lib/events");

const BOT = /bot|crawl|spider|slurp|bingpreview|headless|preview|monitor|curl|wget|python-requests|axios|node-fetch/i;

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 4000) req.destroy(); });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

const TYPES = new Set(["visit", "location", "filter", "card", "recheck", "booking", "alert_start", "alert_confirm", "spa_page"]);

module.exports = async (req, res) => {
  const done = () => { res.statusCode = 204; res.end(); };
  if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
  const geo = geoOf(req);
  if (BOT.test(geo.ua)) return done(); // don't log crawlers as visitors
  let body;
  try { body = await readBody(req); } catch (e) { return done(); }
  const type = String(body.type || "");
  if (!TYPES.has(type)) return done();
  try {
    await logEvent({
      type,
      key: typeof body.key === "string" ? body.key.slice(0, 40) : "",
      meta: body.meta && typeof body.meta === "object" ? JSON.parse(JSON.stringify(body.meta).slice(0, 500)) : {},
      sid: typeof body.sid === "string" ? body.sid.slice(0, 24) : "",
      path: typeof body.path === "string" ? body.path.slice(0, 120) : "",
      ...geo
    });
  } catch (e) { /* analytics must never break UX */ }
  done();
};
