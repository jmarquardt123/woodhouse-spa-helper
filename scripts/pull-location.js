#!/usr/bin/env node
// Pull one location's full availability and write its condensed dataset.
//
//   node scripts/pull-location.js --key grand-rapids-mi [--days 90]
//     [--concurrency 6] [--outdir out]
//
// What it scans, honestly:
//   - every solo service twice (man / woman provider) — merged per slot so the
//     therapist filter is exact
//   - every couples service in all four provider pairings (MM/MF/FM/FF) —
//     merged per slot with the set of available pairs so "Either" is exact
//   - every service's add-on list (name, price, extra minutes)
// Placeholder guests only: no personal data is ever sent to Meevo.
// READ-ONLY: never books, pays, waitlists, or opts in.

const fs = require("fs");
const path = require("path");
const { MeevoClient } = require("../src/meevoClient");
const { buildScanPayload } = require("../src/payload");
const { parseLocalDate, addDays, toDateOnly } = require("../src/date");

const ROOT = path.resolve(__dirname, "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function loadRegistry() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "config", "locations.json"), "utf8"));
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); }
      catch (e) { out[idx] = { __error: e.message || String(e) }; }
    }
  }));
  return out;
}

function windows(startDate, totalDays, chunk) {
  const start = parseLocalDate(startDate || null);
  const size = Math.max(1, chunk || 14);
  const list = [];
  for (let off = 0; off < totalDays; off += size) {
    list.push({ startDate: toDateOnly(addDays(start, off)), days: Math.min(size, totalDays - off) });
  }
  return list;
}

function durOf(raw) {
  const named = String(raw.displayName || "").match(/(\d+)\s*Min/i);
  if (named) return Number(named[1]);
  if (raw.defaultServiceTime) return raw.defaultServiceTime;
  const step = (raw.serviceSteps || []).find((x) => x.minutes > 0);
  return step ? step.minutes : null;
}

function minutesOf(isoLike) {
  const m = String(isoLike || "").match(/T(\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

(async () => {
  const key = arg("key");
  const days = Number(arg("days", 90));
  const concurrency = Number(arg("concurrency", 6));
  const outdir = path.resolve(ROOT, arg("outdir", "out"));
  const registry = loadRegistry();
  const loc = registry.locations.find((l) => l.key === key);
  if (!loc) { console.error(`Unknown location key: ${key}`); process.exit(1); }

  const started = Date.now();
  const issues = [];
  const client = new MeevoClient({ baseUrl: "https://na1.meevo.com", tenantId: loc.tenantId, locationId: loc.locationId });
  const session = await client.initialize();
  const chunk = Number(session.locationSettings?.onlineBookingSettings?.numberOfDaysSearchableInACustomDateRange) || 14;

  // ---- catalog ----
  const [categoriesRaw, servicesRaw] = await Promise.all([client.serviceCategories(), client.services(null)]);
  const catName = new Map(categoriesRaw.map((c) => [c.id, c.displayName || ""]));
  const categories = [];
  const catIdx = new Map();
  const services = servicesRaw.map((raw) => {
    const cn = raw.serviceCategoryDisplayName || catName.get(raw.serviceCategoryId) || "OTHER";
    if (!catIdx.has(cn)) { catIdx.set(cn, categories.length); categories.push(cn); }
    return {
      id: raw.id,
      name: raw.displayName || "",
      cat: catIdx.get(cn),
      dur: durOf(raw),
      minPrice: raw.minPrice ?? null,
      maxPrice: raw.maxPrice ?? null,
      couples: String(cn).toUpperCase().includes("COUPLES"),
      addons: []
    };
  });
  if (!services.length) issues.push("no bookable services returned");
  console.log(`${loc.key}: ${services.length} services, ${categories.length} categories, chunk ${chunk}d`);

  // ---- add-ons (per service) ----
  const addonResults = await mapLimit(services, concurrency, async (svc) => {
    const res = await client.onlineBooking(`/ob/service/${svc.id}/AddOns`, { method: "POST", body: {} });
    return (res && Array.isArray(res.addOnServices) ? res.addOnServices : []).map((a) => [
      a.displayName || "", a.minPrice ?? null, a.extendedByStepMinutes || 0
    ]);
  });
  addonResults.forEach((r, i) => {
    if (r && r.__error) issues.push(`addons(${services[i].name}): ${r.__error}`);
    else services[i].addons = r;
  });

  // ---- availability scans ----
  const wins = windows(null, days, chunk);
  const G = ["male", "female"];
  const tasks = [];
  for (let si = 0; si < services.length; si++) {
    const svc = services[si];
    if (svc.couples) {
      for (const g1 of G) for (const g2 of G) for (const w of wins) tasks.push({ si, genders: [g1, g2], w });
    } else {
      for (const g of G) for (const w of wins) tasks.push({ si, genders: [g], w });
    }
  }
  console.log(`${tasks.length} scan calls (solo M/F + couples 4 pairings × ${wins.length} windows)…`);

  const providers = [];
  const provIdx = new Map();
  const intern = (name, genderEnum) => {
    const g = genderEnum === 92 ? "M" : genderEnum === 93 ? "F" : "?";
    const k = `${(name || "?").toUpperCase()}|${g}`;
    if (!provIdx.has(k)) { provIdx.set(k, providers.length); providers.push({ n: name || "?", g }); }
    return provIdx.get(k);
  };

  // slotsBy[si] = Map(date -> Map(startMin -> row))
  const slotsBy = services.map(() => new Map());
  let badGroups = 0;

  const scanned = await mapLimit(tasks, concurrency, async ({ si, genders, w }) => {
    const svc = services[si];
    const people = genders.map(() => ({ firstName: "Guest" }));
    const payload = buildScanPayload({
      config: { people },
      service: { id: svc.id },
      session,
      options: { startDate: w.startDate, days: w.days, people, providerGenderPreferences: genders, sameStart: true, sameRoom: false }
    });
    const groups = await client.scanOpenings(payload);
    if (!Array.isArray(groups)) { badGroups++; return 0; }
    let count = 0;
    for (const g of groups) {
      const ops = g && g.serviceOpenings;
      if (!Array.isArray(ops) || !ops.length) { badGroups++; continue; }
      const first = ops[0];
      const date = String(first.date || first.startTime || "").slice(0, 10);
      const start = minutesOf(first.startTime);
      const end = minutesOf(first.endTime);
      if (!date || start == null) { badGroups++; continue; }
      const price = ops.reduce((s2, o) => s2 + Number(o.employeePrice || o.serviceBasePrice || 0), 0);
      const provs = ops.map((o) => intern(o.employeeDisplayName || o.employeeName, o.employeeGender));
      const byDate = slotsBy[si];
      if (!byDate.has(date)) byDate.set(date, new Map());
      const bySlot = byDate.get(date);
      if (!bySlot.has(start)) bySlot.set(start, { s: start, e: end, p: price, solo: new Set(), pairs: new Set() });
      const row = bySlot.get(start);
      if (svc.couples) row.pairs.add(provs.slice(0, 2).sort((a, b) => a - b).join(","));
      else provs.forEach((p2) => row.solo.add(p2));
      count++;
    }
    return count;
  });
  scanned.forEach((r, i) => { if (r && r.__error) issues.push(`scan(${services[tasks[i].si].name} ${tasks[i].genders.join("+")} @${tasks[i].w.startDate}): ${String(r.__error).slice(0, 100)}`); });
  if (badGroups) issues.push(`${badGroups} scan group(s) had unexpected shape and were dropped`);

  // ---- pack ----
  let openingCount = 0, minD = null, maxD = null;
  const slots = slotsBy.map((byDate, si) => {
    const packed = {};
    for (const [date, bySlot] of [...byDate.entries()].sort()) {
      const rows = [...bySlot.values()].sort((a, b) => a.s - b.s).map((r) => {
        const who = services[si].couples
          ? [...r.pairs].map((pp) => pp.split(",").map(Number))
          : [...r.solo].sort((a, b) => a - b);
        return [r.s, r.e, Math.round(r.p), who];
      });
      packed[date] = rows;
      openingCount += rows.length;
      if (!minD || date < minD) minD = date;
      if (!maxD || date > maxD) maxD = date;
    }
    return packed;
  });
  if (openingCount === 0) issues.push("zero openings for entire location");
  // dedupe scan errors down to a few examples
  const scanErrs = issues.filter((x) => x.startsWith("scan("));
  if (scanErrs.length > 3) {
    const keep = issues.filter((x) => !x.startsWith("scan("));
    keep.push(`${scanErrs.length} scan call(s) failed, e.g. ${scanErrs[0]}`);
    issues.length = 0; issues.push(...keep);
  }

  const bundle = {
    v: 2,
    key: loc.key,
    locationId: loc.locationId,
    label: loc.label, city: loc.city, state: loc.state,
    address: loc.address, phone: loc.phone, bookingUrl: loc.bookingUrl,
    scannedAt: new Date().toISOString(),
    days,
    dateRange: { from: minD, to: maxD },
    openingCount,
    canary: { ok: issues.length === 0, issues },
    categories, services, providers, slots
  };

  fs.mkdirSync(path.join(outdir, "locations"), { recursive: true });
  const outFile = path.join(outdir, "locations", `${loc.key}.json`);
  fs.writeFileSync(outFile, JSON.stringify(bundle));

  // ---- index (read-modify-write; concurrent-shard safe enough per-run) ----
  const idxFile = path.join(outdir, "index.json");
  let index = { locations: [] };
  try { index = JSON.parse(fs.readFileSync(idxFile, "utf8")); } catch (e) {}
  index.locations = (index.locations || []).filter((l) => l.key !== loc.key);
  index.locations.push({ key: loc.key, label: loc.label, city: loc.city, state: loc.state, phone: loc.phone, scannedAt: bundle.scannedAt, openingCount, canaryOk: bundle.canary.ok });
  index.locations.sort((a, b) => a.state.localeCompare(b.state) || a.city.localeCompare(b.city));
  index.generatedAt = new Date().toISOString();
  fs.writeFileSync(idxFile, JSON.stringify(index, null, 1));

  const mb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2);
  console.log(`${loc.key}: ${openingCount.toLocaleString()} openings · ${minD} → ${maxD} · ${providers.length} providers · ${mb} MB · ${((Date.now() - started) / 1000).toFixed(0)}s`);
  console.log(`canary: ${issues.length ? issues.join(" | ") : "OK"}`);
  if (issues.length) process.exitCode = 2;
})().catch((e) => { console.error("pull failed:", e.message); process.exit(1); });
