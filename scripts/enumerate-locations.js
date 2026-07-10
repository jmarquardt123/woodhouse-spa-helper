#!/usr/bin/env node
// Build the location registry: every Woodhouse location that Meevo reports as
// online-bookable. One initialize call returns all sibling locations of the
// tenant. Output: config/locations.json (committed) — the single source the
// scanner, the API functions, and the site's location chooser all read.
//
//   node scripts/enumerate-locations.js [--verify]
//
// --verify additionally initializes each bookable location (politely, a few
// at a time) and drops any that fail or expose zero bookable services.

const fs = require("fs");
const path = require("path");
const { MeevoClient } = require("../src/meevoClient");

const ROOT = path.resolve(__dirname, "..");
const TENANT = 200426;
const SEED_LOCATION = 201386; // Grand Rapids — any bookable location works as the seed
const BASE = "https://na1.meevo.com";

function slugify(s) {
  return String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function prettyPhone(p) {
  const d = String(p || "").replace(/\D/g, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || "");
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

(async () => {
  const verify = process.argv.includes("--verify");
  const seed = new MeevoClient({ baseUrl: BASE, tenantId: TENANT, locationId: SEED_LOCATION });
  const session = await seed.initialize();
  const all = session.locations || [];
  const bookable = all.filter((l) => l.isOnlineBookingEnabled);
  console.log(`tenant ${TENANT}: ${all.length} locations, ${bookable.length} online-bookable`);

  const seen = new Set();
  let entries = bookable.map((l) => {
    let key = slugify(`${l.city}-${l.state}`);
    while (seen.has(key)) key += "-2";
    seen.add(key);
    return {
      key,
      locationId: l.locationId || l.id,
      tenantId: TENANT,
      label: l.storeName || `Woodhouse — ${l.city}`,
      city: l.city,
      state: l.state,
      address: [l.address1, l.city, l.state, l.zipCode].filter(Boolean).join(", "),
      phone: prettyPhone(l.phoneNumber),
      lat: l.latitude,
      lng: l.longitude,
      bookingUrl: `${BASE}/CustomerPortal/onlinebooking?tenantId=${TENANT}&LocationId=${l.locationId || l.id}`
    };
  }).sort((a, b) => a.state.localeCompare(b.state) || a.city.localeCompare(b.city));

  if (verify) {
    console.log("verifying each location initializes and has bookable services…");
    const results = await mapLimit(entries, 4, async (e) => {
      try {
        const c = new MeevoClient({ baseUrl: BASE, tenantId: TENANT, locationId: e.locationId });
        await c.initialize();
        const services = await c.services(null);
        return { key: e.key, ok: true, services: services.length };
      } catch (err) {
        return { key: e.key, ok: false, error: String(err.message).slice(0, 120) };
      }
    });
    const bad = results.filter((r) => !r.ok || r.services === 0);
    for (const b of bad) console.log(`  DROP ${b.key}: ${b.error || "0 bookable services"}`);
    const badKeys = new Set(bad.map((b) => b.key));
    const svcCount = Object.fromEntries(results.filter((r) => r.ok).map((r) => [r.key, r.services]));
    entries = entries.filter((e) => !badKeys.has(e.key)).map((e) => ({ ...e, serviceCount: svcCount[e.key] }));
    console.log(`verified: ${entries.length} locations remain`);
  }

  const outPath = path.join(ROOT, "config", "locations.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), tenantId: TENANT, locations: entries }, null, 1));
  console.log(`wrote ${outPath} (${entries.length} locations)`);
})().catch((e) => { console.error("enumerate failed:", e.message); process.exit(1); });
