// GET /spa/<key> (via rewrite) — server-rendered SEO landing page for one
// Woodhouse location, built from the live Blob dataset. Real prices, this
// week's opening counts, top services, FAQ + schema. Crawlable HTML; funnels
// into the app. Cached at the edge so it's fast and cheap.

const { getLocation } = require("./_lib/locations");

const BLOB = "https://cfrjzkgnoil4u5ks.public.blob.vercel-storage.com/";
const MONS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOWS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function clock(min){ var h=Math.floor(min/60),m=min%60,ap=h>=12?"PM":"AM"; return ((h%12)||12)+":"+String(m).padStart(2,"0")+" "+ap; }
function money(n){ return "$"+Math.round(n); }
function todayIso(){ var n=new Date(); return n.toISOString().slice(0,10); }

async function fetchBundle(key){
  for (const sfx of ["-near",""]) {
    try { const r = await fetch(BLOB+"data/locations/"+key+sfx+".json?cb="+Date.now()); if (r.ok) return await r.json(); } catch(e){}
  }
  return null;
}

function summarize(b){
  const today = todayIso();
  const in7 = new Date(Date.now()+7*86400000).toISOString().slice(0,10);
  let weekCount=0, nextSlot=null, minPrice=Infinity, maxPrice=0;
  const svcRows=[];
  b.services.forEach((s,si)=>{
    if (s.minPrice!=null){ minPrice=Math.min(minPrice,s.minPrice); maxPrice=Math.max(maxPrice,s.maxPrice||s.minPrice); }
    let count=0, first=null;
    const dates=b.slots[si]||{};
    for (const d in dates){ if (d<today) continue;
      for (const r of dates[d]){
        if (d>=today && d<=in7) weekCount++;
        if (!first || (d+"-"+r[0]) < (first.d+"-"+first.min)) {}
        if (!nextSlot || d<nextSlot.d || (d===nextSlot.d && r[0]<nextSlot.min)) nextSlot={d:d,min:r[0],svc:s.name};
        count++;
      }
    }
    svcRows.push({name:s.name, price:s.minPrice, couples:s.couples, cat:b.categories[s.cat], count:count});
  });
  svcRows.sort((a,b2)=>b2.count-a.count);
  return { weekCount, nextSlot, minPrice:minPrice===Infinity?null:minPrice, maxPrice, svcRows, openingCount:b.openingCount };
}

function nextText(ns){
  if(!ns) return "Check the calendar for the next opening";
  const d=new Date(ns.d+"T00:00:00");
  return DOWS[d.getDay()]+" "+MONS[d.getMonth()]+" "+d.getDate()+" at "+clock(ns.min);
}

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://x");
  const key = (url.searchParams.get("key") || url.pathname.replace(/^\/spa\//,"")).replace(/[^a-z0-9-]/gi,"");
  const loc = getLocation(key);
  if (!loc) { res.statusCode=404; res.setHeader("content-type","text/html"); return res.end("<h1>Not found</h1><p><a href=\"/\">Woodhouse Spa Openings</a></p>"); }

  const b = await fetchBundle(key);
  const canonical = "https://woodhouseopenings.com/spa/"+key;
  const cityState = loc.city+", "+loc.state;
  let bodyMain="", faqSchema="", localSchema="";

  if (b) {
    const s = summarize(b);
    const priceRange = s.minPrice!=null ? (money(s.minPrice)+"–"+money(s.maxPrice)) : "";
    const top = s.svcRows.filter(r=>r.count>0).slice(0,8);
    const couples = s.svcRows.filter(r=>r.couples && r.count>0)[0];

    bodyMain =
      '<p class="lead">See real open appointment times at <b>Woodhouse Spa '+esc(cityState)+'</b>, updated all day. '+
      s.weekCount.toLocaleString()+' open times in the next 7 days'+(s.minPrice!=null?', prices from '+money(s.minPrice):'')+'. '+
      'Next opening: <b>'+esc(nextText(s.nextSlot))+'</b>.</p>'+
      '<p><a class="cta" href="/?loc='+esc(key)+'">See all open times &rarr;</a></p>'+
      '<h2>Services &amp; prices</h2>'+
      '<table><thead><tr><th>Service</th><th>From</th><th>Open times</th></tr></thead><tbody>'+
      top.map(r=>'<tr><td>'+esc(r.name)+'</td><td>'+(r.price!=null?money(r.couples?r.price*2:r.price)+(r.couples?" (two)":""):"—")+'</td><td>'+r.count.toLocaleString()+'</td></tr>').join("")+
      '</tbody></table>'+
      '<h2>Common questions</h2>'+
      faqBlock(loc, cityState, s, couples);

    const faqs = faqList(loc, cityState, s, couples);
    faqSchema = '<script type="application/ld+json">'+JSON.stringify({
      "@context":"https://schema.org","@type":"FAQPage",
      "mainEntity": faqs.map(f=>({"@type":"Question","name":f.q,"acceptedAnswer":{"@type":"Answer","text":f.a}}))
    })+'</script>';
    localSchema = '<script type="application/ld+json">'+JSON.stringify({
      "@context":"https://schema.org","@type":"DaySpa","name":"Woodhouse Spa "+cityState,
      "address":{"@type":"PostalAddress","streetAddress":loc.address,"addressLocality":loc.city,"addressRegion":loc.state},
      "telephone":loc.phone||undefined,
      "priceRange": priceRange||undefined,
      "url": canonical
    })+'</script>';
  } else {
    bodyMain = '<p class="lead">Open appointment times for <b>Woodhouse Spa '+esc(cityState)+'</b>.</p>'+
      '<p><a class="cta" href="/?loc='+esc(key)+'">See open times &rarr;</a></p>'+
      '<p class="muted">Live times are loading for this location — check the calendar.</p>';
  }

  const title = "Woodhouse Spa "+cityState+" — Prices & Open Appointment Times";
  const desc = "Real open appointment times at Woodhouse Spa "+cityState+", updated all day. See prices, availability by day, and book on Woodhouse's own site.";

  res.statusCode=200;
  res.setHeader("content-type","text/html; charset=utf-8");
  res.setHeader("cache-control","public, s-maxage=1800, stale-while-revalidate=86400");
  res.end(page({ title, desc, canonical, cityState, loc, bodyMain, faqSchema, localSchema, key }));
};

function faqList(loc, cityState, s, couples){
  const out=[];
  out.push({ q:"How do I find open appointment times at Woodhouse Spa "+cityState+"?",
    a:"Woodhouse Spa Openings checks the Woodhouse booking system all day and shows every open time by day and service. There are "+s.weekCount.toLocaleString()+" open times in the next 7 days. Pick one and finish booking on Woodhouse's own site." });
  if (s.minPrice!=null) out.push({ q:"How much does a service at Woodhouse Spa "+cityState+" cost?",
    a:"Prices at Woodhouse Spa "+cityState+" range from "+money(s.minPrice)+" to "+money(s.maxPrice)+", depending on the service and length." });
  if (couples) out.push({ q:"How much is a couples massage at Woodhouse Spa "+cityState+"?",
    a:"The "+couples.name+" starts at "+money(couples.price*2)+" for two people. Availability updates all day on Woodhouse Spa Openings." });
  if (s.nextSlot) out.push({ q:"When is the next opening at Woodhouse Spa "+cityState+"?",
    a:"The next open time is "+nextText(s.nextSlot)+". Openings change through the day as people book and cancel." });
  if (loc.phone) out.push({ q:"What is the phone number for Woodhouse Spa "+cityState+"?",
    a:"Woodhouse Spa "+cityState+" can be reached at "+loc.phone+". You can also see open times online and book on Woodhouse's site." });
  return out;
}
function faqBlock(loc, cityState, s, couples){
  return '<div class="faq">'+faqList(loc,cityState,s,couples).map(f=>'<details><summary>'+esc(f.q)+'</summary><p>'+esc(f.a)+'</p></details>').join("")+'</div>';
}

function page({ title, desc, canonical, cityState, loc, bodyMain, faqSchema, localSchema, key }){
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:url" content="${esc(canonical)}">
<link rel="icon" type="image/png" sizes="64x64" href="/icons/icon-64.png">
${localSchema}${faqSchema}
<style>
:root{--bg:#F6F2E9;--card:#FCFAF4;--ink:#2A2118;--soft:#75685A;--line:#E3DAC8;--wine:#722F44;--onwine:#fff;--live:#47795D}
@media (prefers-color-scheme:dark){:root{--bg:#191411;--card:#221C17;--ink:#EFE6D8;--soft:#A79987;--line:#372E26;--wine:#D08FA1;--onwine:#241318;--live:#8FC8A5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Georgia,'Times New Roman',serif;line-height:1.6;font-size:18px}
.wrap{max-width:760px;margin:0 auto;padding:26px 20px 70px}
header a{color:inherit;text-decoration:none}
.brand{font-size:12px;letter-spacing:.28em;color:var(--soft);text-transform:uppercase}
.brandb{font-size:24px;font-weight:bold;letter-spacing:.01em}
h1{font-size:30px;line-height:1.2;margin:22px 0 6px}
.sub{color:var(--soft);margin:0 0 20px;font-size:16px}
.lead{font-size:19px}
.cta{display:inline-block;background:var(--wine);color:var(--onwine);text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:14px;margin:6px 0 10px}
h2{font-size:22px;margin:30px 0 10px;border-bottom:1px solid var(--line);padding-bottom:8px}
table{width:100%;border-collapse:collapse;font-size:16px}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line)}
th{color:var(--soft);font-size:13px;text-transform:uppercase;letter-spacing:.08em}
td:nth-child(2),td:nth-child(3),th:nth-child(2),th:nth-child(3){text-align:right;white-space:nowrap}
.faq details{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin-bottom:9px}
.faq summary{font-weight:bold;cursor:pointer}
.faq p{margin:8px 0 0;color:var(--soft);font-size:16px}
.muted{color:var(--soft)}
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--line);color:var(--soft);font-size:14px}
footer a{color:var(--wine)}
.addr{color:var(--soft);font-size:15px}
</style></head><body>
<div class="wrap">
<header><a href="/"><span class="brand">WOODHOUSE SPA</span><br><span class="brandb">Openings</span></a></header>
<h1>${esc("Woodhouse Spa "+cityState)}</h1>
<p class="sub">Open appointment times &amp; prices${loc.phone?' · '+esc(loc.phone):''}</p>
${bodyMain}
<p class="addr">${esc(loc.address)}</p>
<p style="margin-top:24px"><a class="cta" href="/?loc=${esc(key)}">See live open times &rarr;</a></p>
<footer>
Woodhouse Spa Openings shows availability from Woodhouse's public booking system and links you there to book. Booking always happens on Woodhouse's own site.
<br><br><a href="/">All Woodhouse locations</a>
</footer>
</div>
<script>
(function(){try{
  fetch('/api/ev',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'spa_page',key:${JSON.stringify(key)},path:location.pathname})});
}catch(e){}})();
</script>
</body></html>`;
}
