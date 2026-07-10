#!/usr/bin/env node
// After each near sweep: for every confirmed watch, find matching open times
// in the fresh data and email the watcher about times they haven't been told
// about yet. One email per watch per run, capped list, unsubscribe link in all.
// Env: WATCH_SECRET, BLOB_READ_WRITE_TOKEN, RESEND_API_KEY, SITE_URL.

const store = require("../api/_lib/watchstore");
const { sendMail, emailReady, shell } = require("../api/_lib/mail");

const BASE = "https://cfrjzkgnoil4u5ks.public.blob.vercel-storage.com/";
const SITE = process.env.SITE_URL || "https://woodhouse-spa-helper.vercel.app";

function clock(min) { const h = Math.floor(min / 60), m = min % 60, ap = h >= 12 ? "PM" : "AM"; return ((h % 12) || 12) + ":" + String(m).padStart(2, "0") + " " + ap; }
function wantG(p) { return p === "woman" ? "F" : p === "man" ? "M" : null; }

function matchesFor(bundle, f) {
  // family -> service (name + len)
  const suffix = f.len ? ` ${f.len} Min` : "";
  const si = bundle.services.findIndex((s) => s.name === f.fam + suffix || (!f.len && s.name.startsWith(f.fam)));
  if (si < 0) return [];
  const svc = bundle.services[si];
  const provG = (i) => (bundle.providers[i] || {}).g || "?";
  const g1 = wantG(f.g1), g2 = wantG(f.g2);
  const pairOk = (pair) => {
    const a = provG(pair[0]), b = provG(pair[1]);
    const fits = (x, need) => !need || x === need;
    return (fits(a, g1) && fits(b, g2)) || (fits(b, g1) && fits(a, g2));
  };
  const today = new Date();
  const todayIso = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  const out = [];
  const dates = Object.keys(bundle.slots[si] || {}).sort();
  for (const date of dates) {
    if (date < todayIso) continue;
    if (f.days && f.days.length) {
      const w = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))).getDay();
      if (!f.days.includes(w)) continue;
    }
    for (const r of bundle.slots[si][date]) {
      if (r[0] < f.t1 || r[0] > f.t2) continue;
      const ok = svc.couples ? (r[3] || []).some(pairOk) : (!g1 || (r[3] || []).some((p) => provG(p) === g1));
      if (ok) out.push({ date, min: r[0], price: r[2] });
    }
  }
  return out;
}

(async () => {
  if (!emailReady()) { console.log("RESEND_API_KEY not set — skipping watch checks"); return; }
  const s = await store.load();
  const confirmed = s.watches.filter((w) => w.confirmed);
  console.log(`${s.watches.length} watches (${confirmed.length} confirmed)`);
  if (!confirmed.length) return;

  const bundles = new Map();
  async function bundleFor(key) {
    if (!bundles.has(key)) {
      let b = null;
      for (const suffix of ["-near", ""]) {
        const r = await fetch(`${BASE}data/locations/${key}${suffix}.json?cb=${Date.now()}`);
        if (r.ok) { b = await r.json(); break; }
      }
      bundles.set(key, b);
    }
    return bundles.get(key);
  }

  let sent = 0, dirty = false;
  for (const w of confirmed) {
    const bundle = await bundleFor(w.key);
    if (!bundle) continue;
    const matches = matchesFor(bundle, w.filters);
    const seen = new Set(w.seen || []);
    const fresh = matches.filter((m) => !seen.has(m.date + "|" + m.min));
    if (!fresh.length) continue;
    const top = fresh.slice(0, 6);
    const rows = top.map((m) => {
      const d = new Date(Number(m.date.slice(0, 4)), Number(m.date.slice(5, 7)) - 1, Number(m.date.slice(8, 10)));
      const label = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()] + " " + d.getDate();
      return `<tr><td style="padding:7px 0;font-size:16px"><b>${label}</b> · ${clock(m.min)}</td><td style="text-align:right;color:#75685A">$${m.price}</td></tr>`;
    }).join("");
    const unsub = SITE + "/api/watches?action=unsub&id=" + w.id + "&sig=" + store.sign("unsub:" + w.id);
    try {
      await sendMail({
        to: store.decEmail(w.emailEnc),
        subject: `Open at Woodhouse ${w.locLabel}: ${w.label}`,
        html: shell("A time you wanted just opened",
          `<p><b>${w.label}</b> at Woodhouse ${w.locLabel}:</p>` +
          `<table style="width:100%;border-collapse:collapse;margin:10px 0 18px">${rows}</table>` +
          (fresh.length > top.length ? `<p style="color:#75685A;font-size:13px">And ${fresh.length - top.length} more.</p>` : "") +
          `<p style="margin:20px 0"><a href="${SITE}" style="background:#722F44;color:#fff;text-decoration:none;padding:13px 24px;border-radius:12px;font-weight:bold">See times and book</a></p>` +
          `<p style="color:#75685A;font-size:12px">Booking happens on Woodhouse’s own site. <a href="${unsub}" style="color:#722F44">Unsubscribe</a> any time — it also deletes your email from this alert.</p>`)
      });
      sent++;
      // remember what we've told them about; prune past dates to keep it small
      const today = new Date(), tIso = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
      w.seen = [...seen, ...fresh.map((m) => m.date + "|" + m.min)].filter((x) => x.slice(0, 10) >= tIso).slice(-800);
      dirty = true;
    } catch (e) {
      console.error(`mail failed for watch ${w.id}: ${e.message}`);
    }
  }
  if (dirty) await store.save(s);
  console.log(`sent ${sent} alert email(s)`);
})().catch((e) => { console.error("check-watches failed:", e.message); process.exit(1); });
