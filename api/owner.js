// GET /api/owner?days=7  (header x-owner-key: <OWNER_KEY>)
// Aggregated first-party analytics for the site owner. Gated by OWNER_KEY.
// Returns funnel, top markets, traffic sources, recent visitors (IP+city),
// alert stats, and (when available) Google Search Console rankings.

const { loadEvents } = require("./_lib/events");
const { registry } = require("./_lib/locations");
const gsc = require("./_lib/gsc");

module.exports = async (req, res) => {
  const send = (code, obj) => { res.statusCode = code; res.setHeader("content-type","application/json"); res.setHeader("cache-control","no-store"); res.end(JSON.stringify(obj)); };
  const url = new URL(req.url, "http://x");
  const key = req.headers["x-owner-key"] || url.searchParams.get("k") || "";
  if (!process.env.OWNER_KEY || key !== process.env.OWNER_KEY) return send(401, { ok:false, error:"unauthorized" });

  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 7));
  let events = [];
  try { events = await loadEvents(days); } catch (e) { return send(500, { ok:false, error:String(e.message).slice(0,120) }); }

  const cityByKey = Object.fromEntries(registry.locations.map(l => [l.key, l.city+", "+l.state]));
  const isBooking = e => e.type === "booking";
  const uniq = new Set();
  const byType = {};
  const byDay = {};
  const byMarket = {};      // key -> {visits, cards, bookings, alerts}
  const bySource = {};
  const byCity = {};
  const funnel = { visit:0, location:0, card:0, booking:0, alert_start:0, alert_confirm:0 };
  const recent = [];

  for (const e of events) {
    byType[e.type] = (byType[e.type]||0)+1;
    if (e.sid) uniq.add(e.sid);
    const day = (e.t||"").slice(0,10);
    byDay[day] = byDay[day] || { visits:0, cards:0, bookings:0 };
    if (funnel[e.type] !== undefined) funnel[e.type]++;
    if (e.type === "visit") { byDay[day].visits++; }
    if (e.type === "card") byDay[day].cards++;
    if (isBooking(e)) byDay[day].bookings++;

    const mk = e.key || (e.meta && e.meta.key) || "";
    if (mk && cityByKey[mk]) {
      const m = byMarket[mk] = byMarket[mk] || { city:cityByKey[mk], visits:0, cards:0, bookings:0, alerts:0 };
      if (e.type==="location"||e.type==="spa_page") m.visits++;
      if (e.type==="card") m.cards++;
      if (isBooking(e)) m.bookings++;
      if (e.type==="alert_confirm") m.alerts++;
    }
    if (e.type === "visit" || e.type === "spa_page") {
      const src = sourceOf(e.ref);
      bySource[src] = (bySource[src]||0)+1;
      const c = e.city ? (e.city+(e.region?", "+e.region:"")) : (e.country||"?");
      byCity[c] = (byCity[c]||0)+1;
    }
    if (recent.length < 60 && (e.type==="visit"||e.type==="spa_page"||e.type==="booking"||e.type==="alert_confirm")) {
      recent.push({ t:e.t, type:e.type, ip:e.ip, city:e.city, region:e.region, country:e.country,
        source:sourceOf(e.ref), ref:e.ref, market:cityByKey[mk]||"", path:e.path, ua:shortUA(e.ua) });
    }
  }

  const topMarkets = Object.entries(byMarket).map(([k,v])=>({key:k,...v}))
    .sort((a,b)=>b.visits-a.visits).slice(0,25);
  const sources = Object.entries(bySource).map(([k,v])=>({source:k,count:v})).sort((a,b)=>b.count-a.count);
  const cities = Object.entries(byCity).map(([k,v])=>({city:k,count:v})).sort((a,b)=>b.count-a.count).slice(0,20);
  const dayRows = Object.entries(byDay).map(([d,v])=>({day:d,...v})).sort((a,b)=>a.day<b.day?1:-1);

  let ranks = null;
  try { ranks = await gsc.summary(days); } catch (e) { ranks = { available:false, note:String(e.message).slice(0,120) }; }

  return send(200, {
    ok:true, days, totalEvents:events.length,
    uniqueVisitors: uniq.size,
    funnel,
    conversion: {
      visitToCard: pct(funnel.card, funnel.visit),
      cardToBooking: pct(funnel.booking, funnel.card),
      visitToAlert: pct(funnel.alert_confirm, funnel.visit)
    },
    byDay: dayRows, topMarkets, sources, cities, recent, byType,
    ranks
  });
};

function pct(a,b){ return b>0 ? Math.round(a/b*1000)/10 : 0; }
function sourceOf(ref){
  if(!ref) return "direct";
  try{ const h=new URL(ref).hostname.replace(/^www\./,"");
    if(/google\./.test(h)) return "google";
    if(/bing\./.test(h)) return "bing";
    if(/duckduckgo/.test(h)) return "duckduckgo";
    if(/reddit/.test(h)) return "reddit";
    if(/facebook|fb\.com|instagram|t\.co|twitter|x\.com/.test(h)) return "social";
    if(/woodhouseopenings\.com/.test(h)) return "internal";
    return h;
  }catch(e){ return "other"; }
}
function shortUA(ua){
  if(!ua) return "";
  if(/iphone|ipad|ios/i.test(ua)) return "iOS";
  if(/android/i.test(ua)) return "Android";
  if(/mac os x/i.test(ua)) return "Mac";
  if(/windows/i.test(ua)) return "Windows";
  return "other";
}
