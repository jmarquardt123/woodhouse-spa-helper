// Watch storage on Vercel Blob. Emails are AES-256-GCM encrypted at rest with
// a key derived from WATCH_SECRET, so the (public-but-unguessable) blob never
// contains readable PII. Low write volume; optimistic write with one retry.

const crypto = require("crypto");
const { put } = require("@vercel/blob");

const PATH = "data/_watches.json";
const BASE = "https://cfrjzkgnoil4u5ks.public.blob.vercel-storage.com/";

function keyOf() {
  const secret = process.env.WATCH_SECRET;
  if (!secret) throw new Error("WATCH_SECRET is not set");
  return crypto.createHash("sha256").update("watch-email:" + secret).digest();
}
function encEmail(email) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyOf(), iv);
  const ct = Buffer.concat([c.update(String(email), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
function decEmail(blob) {
  const raw = Buffer.from(String(blob), "base64");
  const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), ct = raw.subarray(28);
  const d = crypto.createDecipheriv("aes-256-gcm", keyOf(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
function emailHash(email) {
  return crypto.createHash("sha256").update("watch-addr:" + String(email).trim().toLowerCase()).digest("hex").slice(0, 24);
}
function sign(payload) {
  return crypto.createHmac("sha256", "watch-link:" + process.env.WATCH_SECRET).update(payload).digest("hex").slice(0, 32);
}
function verify(payload, sig) {
  const want = sign(payload);
  return sig && want && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(sig).padEnd(want.length).slice(0, want.length)));
}

async function load() {
  try {
    const r = await fetch(BASE + PATH + "?cb=" + Date.now(), { cache: "no-store" });
    if (r.status === 404) return { watches: [] };
    if (!r.ok) throw new Error("store fetch " + r.status);
    return await r.json();
  } catch (e) {
    if (String(e.message).includes("404")) return { watches: [] };
    throw e;
  }
}
async function save(store) {
  store.updatedAt = new Date().toISOString();
  await put(PATH, JSON.stringify(store), {
    access: "public", addRandomSuffix: false, allowOverwrite: true,
    contentType: "application/json", cacheControlMaxAge: 0
  });
}

module.exports = { load, save, encEmail, decEmail, emailHash, sign, verify };
