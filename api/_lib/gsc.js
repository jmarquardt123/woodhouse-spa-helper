// Google Search Console rankings, when a service-account key is configured.
// Env GSC_SA_JSON (service-account JSON) + the property verified in GSC.
// Until that's set up, summary() reports available:false so the dashboard
// simply hides the rankings panel. Uses a JWT->OAuth token, no SDK.

const crypto = require("crypto");

const SITE = "sc-domain:woodhouseopenings.com";

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600, iat: now
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(header + "." + claim);
  const sig = b64url(signer.sign(sa.private_key));
  const jwt = header + "." + claim + "." + sig;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + jwt
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("gsc token: " + JSON.stringify(j).slice(0, 120));
  return j.access_token;
}
function b64url(x) {
  return Buffer.from(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function summary(days) {
  if (!process.env.GSC_SA_JSON) return { available: false, note: "Search Console not connected yet" };
  const sa = JSON.parse(process.env.GSC_SA_JSON);
  const token = await accessToken(sa);
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  async function query(dimensions) {
    const r = await fetch("https://www.googleapis.com/webmasters/v3/sites/" + encodeURIComponent(SITE) + "/searchAnalytics/query", {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ startDate: start, endDate: end, dimensions, rowLimit: 25 })
    });
    const j = await r.json();
    return j.rows || [];
  }
  const [queries, pages, totals] = await Promise.all([query(["query"]), query(["page"]), query([])]);
  const t = totals[0] || {};
  return {
    available: true,
    totals: { clicks: t.clicks || 0, impressions: t.impressions || 0, ctr: t.ctr || 0, position: t.position || 0 },
    topQueries: queries.map((r) => ({ q: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 10) / 10 })),
    topPages: pages.map((r) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: Math.round(r.position * 10) / 10 }))
  };
}

module.exports = { summary };
