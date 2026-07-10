// POST /api/rescan — live re-scan of ONE service at ONE location, bounded.
// Powers the "Refresh these times" button. Read-only against Meevo, placeholder
// guests, and rate limited.
//
// Body: { key, serviceId, couples: bool, days?: number (<=35) }
// Reply: { ok, scannedAt, serviceId, slots: { "YYYY-MM-DD": [[s,e,price,who]...] } }

const { MeevoClient } = require("../src/meevoClient");
const { buildScanPayload } = require("../src/payload");
const { parseLocalDate, addDays, toDateOnly } = require("../src/date");
const { getLocation, BASE_URL } = require("./_lib/locations");

const hits = new Map(); // naive per-instance rate limit
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 8;
}

function minutesOf(isoLike) {
  const m = String(isoLike || "").match(/T(\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 5000) { req.destroy(); reject(new Error("too large")); } });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(new Error("bad json")); } });
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  const send = (code, obj) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(obj)); };
  if (req.method !== "POST") return send(405, { ok: false, error: "POST only" });
  const ip = String(req.headers["x-forwarded-for"] || "?").split(",")[0].trim();
  if (limited(ip)) return send(429, { ok: false, error: "Too many refreshes — try again in a minute." });

  let body;
  try { body = await readBody(req); } catch (e) { return send(400, { ok: false, error: e.message }); }
  const loc = getLocation(body.key);
  if (!loc) return send(400, { ok: false, error: "Unknown location" });
  if (!/^[0-9a-f-]{36}$/i.test(String(body.serviceId || ""))) return send(400, { ok: false, error: "Bad serviceId" });
  const couples = !!body.couples;
  const days = Math.min(35, Math.max(7, Number(body.days) || 28));

  try {
    const client = new MeevoClient({ baseUrl: BASE_URL, tenantId: loc.tenantId, locationId: loc.locationId });
    const session = await client.initialize();
    const chunk = Number(session.locationSettings?.onlineBookingSettings?.numberOfDaysSearchableInACustomDateRange) || 14;
    const start = parseLocalDate(null);
    const windows = [];
    for (let off = 0; off < days; off += chunk) {
      windows.push({ startDate: toDateOnly(addDays(start, off)), days: Math.min(chunk, days - off) });
    }
    const G = ["male", "female"];
    const combos = couples ? G.flatMap((a) => G.map((b) => [a, b])) : G.map((g) => [g]);

    const providers = [];
    const provIdx = new Map();
    const intern = (name, ge) => {
      const g = ge === 92 ? "M" : ge === 93 ? "F" : "?";
      const k = `${(name || "?").toUpperCase()}|${g}`;
      if (!provIdx.has(k)) { provIdx.set(k, providers.length); providers.push({ n: name || "?", g }); }
      return provIdx.get(k);
    };
    const byDate = new Map();

    const tasks = [];
    for (const genders of combos) for (const w of windows) tasks.push({ genders, w });
    let cursor = 0;
    async function worker() {
      while (cursor < tasks.length) {
        const { genders, w } = tasks[cursor++];
        const people = genders.map(() => ({ firstName: "Guest" }));
        const payload = buildScanPayload({
          config: { people }, service: { id: body.serviceId }, session,
          options: { startDate: w.startDate, days: w.days, people, providerGenderPreferences: genders, sameStart: true, sameRoom: false }
        });
        const groups = await client.scanOpenings(payload);
        if (!Array.isArray(groups)) continue;
        for (const g of groups) {
          const ops = g && g.serviceOpenings;
          if (!Array.isArray(ops) || !ops.length) continue;
          const first = ops[0];
          const date = String(first.date || first.startTime || "").slice(0, 10);
          const s = minutesOf(first.startTime);
          if (!date || s == null) continue;
          const price = ops.reduce((acc, o) => acc + Number(o.employeePrice || o.serviceBasePrice || 0), 0);
          const provs = ops.map((o) => intern(o.employeeDisplayName || o.employeeName, o.employeeGender));
          if (!byDate.has(date)) byDate.set(date, new Map());
          const bySlot = byDate.get(date);
          if (!bySlot.has(s)) bySlot.set(s, { s, e: minutesOf(first.endTime), p: price, solo: new Set(), pairs: new Set() });
          const row = bySlot.get(s);
          if (couples) row.pairs.add(provs.slice(0, 2).sort((a, b) => a - b).join(","));
          else provs.forEach((p) => row.solo.add(p));
        }
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker));

    const slots = {};
    for (const [date, bySlot] of [...byDate.entries()].sort()) {
      slots[date] = [...bySlot.values()].sort((a, b) => a.s - b.s).map((r) => [
        r.s, r.e, Math.round(r.p),
        couples ? [...r.pairs].map((pp) => pp.split(",").map(Number)) : [...r.solo].sort((a, b) => a - b)
      ]);
    }
    return send(200, { ok: true, scannedAt: new Date().toISOString(), serviceId: body.serviceId, days, providers, slots });
  } catch (e) {
    return send(502, { ok: false, error: String(e.message || e).slice(0, 200) });
  }
};
