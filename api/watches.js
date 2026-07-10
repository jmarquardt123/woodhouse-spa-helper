// Email alert watches. No accounts: create -> confirmation email (double
// opt-in) -> hourly checks email you when a matching time appears. Every
// email carries an unsubscribe link that deletes the watch.
//
// POST {action:"create", email, key, filters, label}
// POST {action:"mine", ids:[]}          -> device's watches (masked emails)
// GET  ?action=status                    -> { emailReady }
// GET  ?action=confirm&id=&sig=          -> HTML page
// GET  ?action=unsub&id=&sig=            -> HTML page

const crypto = require("crypto");
const store = require("./_lib/watchstore");
const { sendMail, emailReady, shell } = require("./_lib/mail");
const { getLocation } = require("./_lib/locations");

const hits = new Map();
function limited(ip, n) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 3600000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > (n || 10);
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 8000) { req.destroy(); reject(new Error("too large")); } });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(new Error("bad json")); } });
    req.on("error", reject);
  });
}

function siteUrl(req) {
  return process.env.SITE_URL || ("https://" + (req.headers["x-forwarded-host"] || req.headers.host));
}
function maskEmail(e) {
  const [a, b] = String(e).split("@");
  return (a || "").slice(0, 2) + "…@" + (b || "");
}
function page(res, title, body) {
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(shell(title, body));
}

module.exports = async (req, res) => {
  const send = (code, obj) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(obj)); };
  const url = new URL(req.url, "http://x");
  const action = url.searchParams.get("action") || null;
  const ip = String(req.headers["x-forwarded-for"] || "?").split(",")[0].trim();

  try {
    if (req.method === "GET" && action === "status") {
      return send(200, { ok: true, emailReady: emailReady() });
    }

    if (req.method === "GET" && (action === "confirm" || action === "unsub")) {
      const id = url.searchParams.get("id") || "";
      const sig = url.searchParams.get("sig") || "";
      if (!store.verify(action + ":" + id, sig)) return page(res, "That link didn’t work", "<p>The link looks incomplete. Open the email again and tap the button once more.</p>");
      const s = await store.load();
      const w = s.watches.find((x) => x.id === id);
      if (!w) return page(res, "Already gone", "<p>This alert was already removed. Nothing more to do.</p>");
      if (action === "confirm") {
        w.confirmed = true;
        await store.save(s);
        return page(res, "You’re all set", `<p>We’re watching <b>${w.label}</b> at ${w.locLabel}. The moment a matching time appears, you get one email with a link to it.</p><p style="color:#75685A;font-size:13px">Every email has an unsubscribe link.</p>`);
      }
      s.watches = s.watches.filter((x) => x.id !== id);
      await store.save(s);
      return page(res, "Alert removed", "<p>That watch is deleted, along with your email for it. You can set a new one on the site any time.</p>");
    }

    if (req.method === "POST") {
      const body = await readBody(req);

      if (body.action === "mine") {
        const ids = Array.isArray(body.ids) ? body.ids.slice(0, 20).map(String) : [];
        if (!ids.length) return send(200, { ok: true, watches: [] });
        const s = await store.load();
        return send(200, {
          ok: true,
          watches: s.watches.filter((w) => ids.includes(w.id)).map((w) => ({
            id: w.id, label: w.label, locLabel: w.locLabel, confirmed: w.confirmed,
            email: maskEmail(store.decEmail(w.emailEnc)),
            unsub: "/api/watches?action=unsub&id=" + w.id + "&sig=" + store.sign("unsub:" + w.id)
          }))
        });
      }

      if (body.action === "create") {
        if (!emailReady()) return send(503, { ok: false, error: "Alerts aren’t live quite yet." });
        if (limited(ip, 10)) return send(429, { ok: false, error: "Too many requests — try again later." });
        const email = String(body.email || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) return send(400, { ok: false, error: "That email doesn’t look right." });
        const loc = getLocation(body.key);
        if (!loc) return send(400, { ok: false, error: "Unknown location." });
        const f = body.filters || {};
        const label = String(body.label || "").slice(0, 140) || "your search";
        const s = await store.load();
        const eh = store.emailHash(email);
        if (s.watches.filter((w) => w.emailHash === eh).length >= 5) {
          return send(400, { ok: false, error: "That email already has 5 alerts. Remove one first (link in any alert email)." });
        }
        const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
        const w = {
          id, emailEnc: store.encEmail(email), emailHash: eh,
          key: loc.key, locLabel: loc.city + ", " + loc.state,
          filters: {
            who: f.who === "two" ? "two" : "me",
            g1: ["either", "woman", "man"].includes(f.g1) ? f.g1 : "either",
            g2: ["either", "woman", "man"].includes(f.g2) ? f.g2 : "either",
            fam: String(f.fam || "").slice(0, 80),
            len: Number(f.len) || 0,
            days: (Array.isArray(f.days) ? f.days : []).map(Number).filter((x) => x >= 0 && x <= 6).slice(0, 7),
            t1: Math.max(0, Math.min(1439, Number(f.t1) || 0)),
            t2: Math.max(0, Math.min(1439, Number(f.t2) || 1439))
          },
          label, confirmed: false, seen: [], created: new Date().toISOString()
        };
        s.watches.push(w);
        await store.save(s);
        const base = siteUrl(req);
        const confirmUrl = base + "/api/watches?action=confirm&id=" + id + "&sig=" + store.sign("confirm:" + id);
        await sendMail({
          to: email,
          subject: "Confirm your Woodhouse alert",
          html: shell("One tap to turn on your alert",
            `<p>You asked to be emailed when <b>${w.label}</b> opens up at ${w.locLabel}.</p>` +
            `<p style="margin:22px 0"><a href="${confirmUrl}" style="background:#722F44;color:#fff;text-decoration:none;padding:14px 26px;border-radius:12px;font-weight:bold">Turn on this alert</a></p>` +
            `<p style="color:#75685A;font-size:13px">Didn’t ask for this? Ignore this email and nothing happens.</p>`)
        });
        return send(200, { ok: true, id });
      }
      return send(400, { ok: false, error: "Unknown action." });
    }
    return send(405, { ok: false, error: "Unsupported method." });
  } catch (e) {
    return send(500, { ok: false, error: String(e.message || e).slice(0, 160) });
  }
};
