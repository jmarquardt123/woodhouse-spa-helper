/* Woodhouse Spa Helper — viewer + handoff. Never books anything.
   Data: /data/index.json + /data/locations/<key>.json (Vercel Blob). */

(function () {
  "use strict";

  var app = document.getElementById("app");
  var toastEl = document.getElementById("toast");
  var IDX = null;  // location index
  var D = null;    // current location dataset (v2)
  var FAMS = null; // service families derived from D

  /* ---------------- utils ---------------- */
  var DOWS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  var MONS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function clock(min){ var h=Math.floor(min/60),m=min%60,ap=h>=12?"PM":"AM"; return ((h%12)||12)+":"+String(m).padStart(2,"0")+" "+ap; }
  function part(min){ return min<12*60?"Morning":(min<17*60?"Afternoon":"Evening"); }
  function plural(n,w,sfx){ return n+" "+w+(n===1?"":(sfx||"s")); }
  function todayIso(){ var n=new Date(); return n.getFullYear()+"-"+String(n.getMonth()+1).padStart(2,"0")+"-"+String(n.getDate()).padStart(2,"0"); }
  function nowMin(){ var n=new Date(); return n.getHours()*60+n.getMinutes(); }
  function iso(y,m,d){ return y+"-"+String(m+1).padStart(2,"0")+"-"+String(d).padStart(2,"0"); }
  function dow(y,m,d){ return new Date(y,m,d).getDay(); }
  function agoLabel(isoStr){
    if(!isoStr) return "unknown";
    var mins=Math.max(0,Math.round((Date.now()-new Date(isoStr).getTime())/60000));
    if(mins<2) return "just now";
    if(mins<60) return mins+" min ago";
    var h=Math.round(mins/60);
    if(h<48) return plural(h,"hour")+" ago";
    return plural(Math.round(h/24),"day")+" ago";
  }
  var toastTimer=null;
  function toast(m){ toastEl.textContent=m; toastEl.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(function(){toastEl.classList.remove("show");},1900); }
  function store(k,v){ try{
    if(v===undefined) return JSON.parse(localStorage.getItem(k));
    if(v===null) localStorage.removeItem(k); else localStorage.setItem(k,JSON.stringify(v));
  }catch(e){ return null; } return v; }
  function titleCase(s){ return String(s).toLowerCase().replace(/(^|[ '\-\/+])[a-z]/g,function(c){return c.toUpperCase();}); }

  function icon(name,size){
    size=size||17;
    var paths={
      pin:'<path d="M12 21s-7-6.3-7-11a7 7 0 1 1 14 0c0 4.7-7 11-7 11Z"/><circle cx="12" cy="10" r="2.6"/>',
      sliders:'<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1.5 14h5M9.5 8h5M17.5 16h5"/>',
      pencil:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
      info:'<circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
      phone:'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c1 .3 2 .5 3 .6a2 2 0 0 1 1.6 2Z"/>'
    };
    return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;vertical-align:-2px">'+paths[name]+'</svg>';
  }
  function pin(){ return icon("pin",14); }

  /* ---------------- state ---------------- */
  var S = {
    view:"home",
    locKey: store("wsh-loc") || null,
    who: "me", g1:"either", g2:"either",
    cat:null, fam:null, len:null,
    ym:null,               // [year, monthIndex]
    selBy:{},              // iso(ym) month key -> day number
    time:null, timeRow:null, steps:{}, terms: store("wsh-terms")===true,
    strip:false, stripInfo:null,
    returnTo:null,
    profile: store("wsh-profile") || {name:"",email:""},
    locSearch:""
  };
  var saved = store("wsh-filters");
  if(saved){ ["who","g1","g2","cat","fam","len"].forEach(function(k){ if(saved[k]!==undefined) S[k]=saved[k]; }); }

  /* ---------------- families over dataset ---------------- */
  function buildFams(){
    var map=new Map();
    D.services.forEach(function(s,si){
      var m=s.name.match(/^(.*?)\s+(\d+)\s*Min$/i);
      var base=m?m[1]:s.name, len=m?Number(m[2]):(s.dur||0);
      if(!map.has(base)) map.set(base,{ name:base, cat:D.categories[s.cat], couples:!!s.couples, lengths:{}, addons:s.addons||[] });
      var f=map.get(base);
      f.lengths[len]={ price:s.minPrice, si:si };
      if((s.addons||[]).length && !f.addons.length) f.addons=s.addons;
    });
    FAMS=[...map.values()];
  }
  function famsFor(){ return FAMS.filter(function(f){ return S.who==="two"?f.couples:!f.couples; }); }
  function catsFor(){
    var order=["MASSAGE","FACIALS","ADVANCED FACIALS","BODY TREATMENTS","NAILS"];
    var cats=[]; famsFor().forEach(function(f){ if(cats.indexOf(f.cat)<0) cats.push(f.cat); });
    cats.sort(function(a,b){ var ia=order.indexOf(a.toUpperCase()), ib=order.indexOf(b.toUpperCase()); return (ia<0?99:ia)-(ib<0?99:ib); });
    return cats;
  }
  function ensureSelection(){
    var fams=famsFor();
    if(!fams.length) return;
    var f=fams.find(function(x){ return x.name===S.fam; });
    if(!f){
      var cats=catsFor();
      if(!S.cat||cats.indexOf(S.cat)<0) S.cat=cats[0];
      // friendliest default: a Swedish massage if the spa has one
      f=fams.find(function(x){ return /swedish/i.test(x.name)&&x.cat===S.cat; })
        ||fams.find(function(x){ return x.cat===S.cat; })||fams[0];
      S.fam=f.name; S.cat=f.cat;
    } else S.cat=f.cat;
    var lens=Object.keys(f.lengths).map(Number).sort(function(a,b){return a-b;});
    if(lens.indexOf(S.len)<0) S.len=lens.indexOf(80)>=0?80:lens[0];
  }
  function fam(){ ensureSelection(); return famsFor().find(function(f){ return f.name===S.fam; }); }
  function famLens(f){ return Object.keys(f.lengths).map(Number).sort(function(a,b){return a-b;}); }
  function famPriceFrom(f){ var ps=Object.values(f.lengths).map(function(l){return l.price;}).filter(function(x){return x!=null;}); if(!ps.length) return ""; var lo=Math.min.apply(null,ps); return f.couples?("from $"+lo*2+" for two"):("from $"+lo); }
  function curService(){ var f=fam(); return f?f.lengths[S.len]:null; }
  function provG(i){ return (D.providers[i]||{}).g||"?"; }
  function provN(i){ return titleCase((D.providers[i]||{}).n||"?"); }
  function wantG(p){ return p==="woman"?"F":p==="man"?"M":null; }
  function pairOk(pair){
    var a=provG(pair[0]), b=provG(pair[1]);
    var g1=wantG(S.g1), g2=wantG(S.g2);
    function fits(x,need){ return !need||x===need; }
    return (fits(a,g1)&&fits(b,g2))||(fits(b,g1)&&fits(a,g2));
  }
  function rowOk(row,couples){
    if(couples) return (row[3]||[]).some(pairOk);
    var g1=wantG(S.g1);
    if(!g1) return true;
    return (row[3]||[]).some(function(p){ return provG(p)===g1; });
  }
  function rowsFor(dateIso){
    var svc=curService(); if(!svc) return [];
    var byDate=D.slots[svc.si]||{};
    var rows=(byDate[dateIso]||[]).filter(function(r){ return rowOk(r,fam().couples); });
    var t=todayIso();
    if(dateIso===t){ var nm=nowMin(); rows=rows.filter(function(r){ return r[0]>nm; }); }
    return rows;
  }
  function countFor(y,m,d){ return rowsFor(iso(y,m,d)).length; }
  function slotPrice(row){ return Math.round(row?row[2]:(curService()?curService().price*(fam().couples?2:1):0)); }

  /* ---------------- months / selection ---------------- */
  function monthList(){
    var t=new Date(), from=[t.getFullYear(),t.getMonth()];
    var toIso=(D.dateRange&&D.dateRange.to)||todayIso();
    var to=[Number(toIso.slice(0,4)),Number(toIso.slice(5,7))-1];
    var list=[], y=from[0], m=from[1];
    while(y<to[0]||(y===to[0]&&m<=to[1])){ list.push([y,m]); m++; if(m>11){m=0;y++;} }
    return list.length?list:[from];
  }
  function ym(){ var ms=monthList(); if(!S.ym||!ms.some(function(x){return x[0]===S.ym[0]&&x[1]===S.ym[1];})) S.ym=ms[0]; return S.ym; }
  function ymKey(){ var x=ym(); return x[0]+"-"+x[1]; }
  function daysInYm(){ var x=ym(); return new Date(x[0],x[1]+1,0).getDate(); }
  function firstDay(){ var x=ym(); var t=new Date(); return (x[0]===t.getFullYear()&&x[1]===t.getMonth())?t.getDate():1; }
  function sel(){
    var k=ymKey();
    if(S.selBy[k]==null){
      var x=ym(), d=firstDay();
      while(d<=daysInYm()&&!countFor(x[0],x[1],d)) d++;
      S.selBy[k]=Math.min(d,daysInYm());
    }
    return S.selBy[k];
  }
  function ymShift(dir){
    var ms=monthList(), x=ym();
    var i=ms.findIndex(function(v){return v[0]===x[0]&&v[1]===x[1];});
    var ni=Math.min(ms.length-1,Math.max(0,i+dir));
    S.ym=ms[ni];
  }
  function atFirstMonth(){ var ms=monthList(),x=ym(); return x[0]===ms[0][0]&&x[1]===ms[0][1]; }
  function atLastMonth(){ var ms=monthList(),x=ym(); var l=ms[ms.length-1]; return x[0]===l[0]&&x[1]===l[1]; }

  function sentence(){
    var f=fam(); if(!f) return "";
    var who=S.who==="me"?"Just me":"Two of us";
    var g=S.who==="me"
      ? (S.g1==="either"?"Any therapist":"A "+S.g1)
      : ("You "+(S.g1==="either"?"either":"a "+S.g1)+" · Guest "+(S.g2==="either"?"either":"a "+S.g2));
    return f.name+" · "+S.len+" min · "+g+" · "+who;
  }

  /* ---------------- freshness ---------------- */
  function freshInfo(){
    var hrs=D&&D.scannedAt?(Date.now()-new Date(D.scannedAt).getTime())/3600000:Infinity;
    return { hrs:hrs, stale:hrs>9||!(D&&D.canary&&D.canary.ok) };
  }
  function freshPill(){
    var f=freshInfo();
    return '<span class="freshpill '+(f.stale?"old":"ok")+'">Checked '+agoLabel(D.scannedAt)+'</span>';
  }
  function staleBanner(){
    var f=freshInfo();
    if(!f.stale) return "";
    var why=(D.canary&&!D.canary.ok)
      ? "Our last check of this spa hit a problem, so some times may be off."
      : "These times were checked "+agoLabel(D.scannedAt)+".";
    return '<div class="stale"><div><b>Times may be out of date.</b> <span>'+why+' The final word is always Woodhouse’s own site.</span></div></div>';
  }

  /* ---------------- shared html ---------------- */
  function go(v){ S.view=v; render(); }
  function subhead(title,sub,extra){
    return '<div class="subhead"><button class="back" data-go="home" aria-label="Back">‹</button><span class="t"><span class="v">'+esc(title)+'</span>'+(sub?'<span class="s">'+esc(sub)+'</span>':'')+'</span><span class="right">'+(extra||"")+'</span></div>';
  }
  function brandHtml(){
    return '<div class="brandrow"><span class="wm"><span class="house">WOODHOUSE SPA</span><span class="helper">Helper</span></span><button class="gear" data-go="settings" aria-label="Settings">'+icon("sliders",17)+'</button></div>'+
      '<div class="locline"><button data-go="location">'+pin()+' <b>'+esc(D.city)+'</b>&nbsp;· '+esc(D.state)+' · Change</button></div>';
  }
  function monthTools(withCal){
    return '<span class="tools">'+
      '<button data-act="prevm"'+(atFirstMonth()?" disabled":"")+' aria-label="Previous month">‹</button>'+
      (withCal?'<button class="calbtn" data-act="monthview">Calendar</button>':"")+
      '<button data-act="nextm"'+(atLastMonth()?" disabled":"")+' aria-label="Next month">›</button></span>';
  }
  function monthHeader(withCal){
    var x=ym();
    return '<div class="monthrow"><span class="m serif">'+MONS[x[1]]+'</span><span class="y serif">'+x[0]+'</span>'+monthTools(withCal)+'</div>';
  }
  function choiceHtml(){
    return '<div class="choice"><button data-act="editfilters"><span class="cw"><span class="cl">Your visit</span><span class="cs">'+esc(sentence())+'</span></span><span class="ar">›</span></button></div>';
  }
  function dayHead(list){
    var x=ym();
    return '<p class="sheetlbl" style="margin-top:16px"><b>'+DOWS[dow(x[0],x[1],sel())]+', '+MONS[x[1]]+' '+sel()+'</b></p>'+
      '<div class="sheethead" style="margin-top:2px"><p class="sheetlbl" style="margin:0;flex:1">'+plural(list.length,"open time")+'</p>'+freshPill()+'</div>';
  }
  function monthGrid(){
    var x=ym(), first=dow(x[0],x[1],1), t=new Date();
    var isCur=x[0]===t.getFullYear()&&x[1]===t.getMonth();
    var h='<div class="gridwrap"><div class="dowrow"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div><div class="mgrid">';
    for(var i=0;i<first;i++) h+='<span></span>';
    for(var d=1;d<=daysInYm();d++){
      var past=isCur&&d<t.getDate();
      var n=past?0:countFor(x[0],x[1],d);
      var dots=n===0?0:(n<5?1:(n<14?2:3));
      h+='<button class="mday'+(n?"":" none")+'"'+(past?" disabled":"")+' data-pick="'+d+'">'+
        (sel()===d?'<svg class="ring" viewBox="0 0 44 48" preserveAspectRatio="none"><ellipse cx="22" cy="24" rx="17" ry="17" transform="rotate(-4 22 24)"/></svg>':"")+
        d+'<span class="mark">'+("<i></i>").repeat(dots)+'</span></button>';
    }
    h+='</div></div><div class="legend"><i></i> A few &nbsp; <i></i><i></i> Some &nbsp; <i></i><i></i><i></i> Plenty</div>';
    if(atLastMonth()) h+='<p class="horizon" style="text-align:center">Woodhouse’s calendar opens about this far ahead.</p>';
    return h;
  }
  function emptyDay(){
    var x=ym(), d=sel(), near=[];
    for(var a=d-1;a>=firstDay()&&near.length<1;a--) if(countFor(x[0],x[1],a)) near.push(a);
    for(var b=d+1;b<=daysInYm()&&near.length<2;b++) if(countFor(x[0],x[1],b)) near.push(b);
    near.sort(function(p,q){return p-q;});
    return '<div class="emptyday"><div class="serif">Nothing open '+DOWS[dow(x[0],x[1],d)]+' the '+d+'</div><p>Times open when someone cancels — check back, or try a nearby day.</p>'+
      (near.length?'<div class="near">'+near.map(function(k){return '<button data-day="'+k+'">'+DOWS[dow(x[0],x[1],k)].slice(0,3)+' '+k+' · '+plural(countFor(x[0],x[1],k),"time")+'</button>';}).join("")+'</div>':"")+'</div>';
  }
  function bandsHtml(list,wide){
    var g={Morning:[],Afternoon:[],Evening:[]};
    list.forEach(function(r){ g[part(r[0])].push(r); });
    var h="";
    ["Morning","Afternoon","Evening"].forEach(function(p){
      if(!g[p].length) return;
      h+='<div class="band"><div class="bandlbl"><span>'+p+'</span></div>';
      if(wide){
        h+='<div class="wtgrid">'+g[p].map(function(r){ return '<button class="wtime" data-time="'+r[0]+'"><span class="t">'+clock(r[0])+'</span><span class="p num">$'+slotPrice(r)+'</span></button>'; }).join("")+'</div>';
      } else {
        h+='<div class="group">'+g[p].map(function(r){ return '<button class="trow" data-time="'+r[0]+'"><span class="tt">'+clock(r[0])+'</span><span class="lead"></span><span class="tp num">$'+slotPrice(r)+'</span><span class="ch">›</span></button>'; }).join("")+'</div>';
      }
      h+='</div>';
    });
    return h;
  }
  function footerHtml(){ return '<div class="tinyfoot"><span data-go="about">About this helper</span></div>'; }

  /* ---------------- views ---------------- */
  var VIEWS={};

  VIEWS.home=function(){
    var list=rowsFor(iso(ym()[0],ym()[1],sel()));
    // phone layout
    var h='<div class="pad homepad">'+brandHtml()+monthHeader(true)+staleBanner()+choiceHtml()+'<div class="ribbon">';
    var x=ym();
    for(var d=firstDay();d<=daysInYm();d++){
      var n=countFor(x[0],x[1],d);
      h+='<button class="dcard'+(sel()===d?" on":"")+(n?"":" none")+'" data-day="'+d+'"><span class="dw">'+DOWS[dow(x[0],x[1],d)].slice(0,3)+'</span><span class="dn">'+d+'</span><span class="dc">'+(n?plural(n,"time"):"·")+'</span></button>';
    }
    h+='</div>';
    h+= list.length ? (dayHead(list)+bandsHtml(list,false)) : emptyDay();
    h+=footerHtml()+'</div>';
    // wide layout
    h+='<div class="webhome"><aside>'+brandHtml()+monthHeader(false)+monthGrid()+'</aside><main>'+choiceHtml()+staleBanner()+
      (list.length?(dayHead(list)+bandsHtml(list,true)):emptyDay())+'</main>'+footerHtml()+'</div>';
    return h;
  };

  VIEWS.month=function(){
    var x=ym();
    return '<div class="pad">'+subhead(MONS[x[1]]+" "+x[0],null,monthTools(false))+monthGrid()+'<p class="legend">Tap a day to see its times</p></div>';
  };

  VIEWS.filters=function(){
    var f=fam();
    var h='<div class="pad">'+subhead("What are you looking for?",null);
    h+='<div class="q"><div class="ql">Who’s going?</div><div class="opts">'+
      '<button class="opt'+(S.who==="me"?" on":"")+'" data-set="who:me">Just me</button>'+
      '<button class="opt'+(S.who==="two"?" on":"")+'" data-set="who:two">Two of us</button></div>'+
      (S.who==="two"?'<div class="qs" style="margin-top:8px">Two-person visits use Woodhouse’s couples services, side by side in one room.</div>':"")+'</div>';
    h+='<div class="q"><div class="ql">Who should do it?</div>';
    var gopts=function(cur,key){ return ["either","woman","man"].map(function(g){ return '<button class="opt'+(cur===g?" on":"")+'" data-set="'+key+':'+g+'">'+(g==="either"?"Either":"A "+g)+'</button>'; }).join(""); };
    if(S.who==="me") h+='<div class="opts">'+gopts(S.g1,"g1")+'</div>';
    else h+='<div class="whorow"><span class="wl">For you</span><div class="opts">'+gopts(S.g1,"g1")+'</div></div>'+
            '<div class="whorow"><span class="wl">Your guest</span><div class="opts">'+gopts(S.g2,"g2")+'</div></div>';
    h+='</div>';
    if(S.who==="two"){
      h+='<div class="q"><div class="ql">Which couples service?</div>';
      famsFor().forEach(function(f2){
        h+='<button class="svcrow'+(S.fam===f2.name?" on":"")+'" data-set="fam:'+esc(f2.name)+'"><span class="sn">'+esc(f2.name)+'</span><span class="lead"></span><span class="sp">'+famPriceFrom(f2)+'</span></button>';
      });
      h+='</div>';
    } else {
      var cats=catsFor();
      h+='<div class="q"><div class="ql">What treatment?</div><div class="selectwrap" style="margin-bottom:10px"><select id="catSel">'+
        cats.map(function(c){ return '<option value="'+esc(c)+'"'+(S.cat===c?" selected":"")+'>'+esc(titleCase(c))+'</option>'; }).join("")+'</select></div>';
      famsFor().forEach(function(f2){
        if(f2.cat!==S.cat) return;
        h+='<button class="svcrow'+(S.fam===f2.name?" on":"")+'" data-set="fam:'+esc(f2.name)+'"><span class="sn">'+esc(f2.name)+'</span><span class="lead"></span><span class="sp">'+famPriceFrom(f2)+'</span></button>';
      });
      h+='</div>';
    }
    h+='<div class="q"><div class="ql">How long?</div><div class="opts">'+
      famLens(f).map(function(l){
        var p=f.lengths[l].price; var pr=p!=null?("$"+p*(f.couples?2:1)):"";
        return '<button class="opt'+(S.len===l?" on":"")+'" data-set="len:'+l+'">'+l+' min'+(pr?'<small class="num">'+pr+'</small>':"")+'</button>';
      }).join("")+'</div></div>';
    h+='<div class="applywrap"><button class="cta" data-act="apply">Show these times</button></div></div>';
    return h;
  };

  VIEWS.card=function(){
    var f=fam(), row=S.timeRow, x=ym();
    var h='<div class="pad">'+subhead("Finish at Woodhouse",null,'<button data-act="minimize" title="Minimize" aria-label="Minimize">▾</button>');
    var fr=freshInfo();
    h+='<div class="verify'+(fr.stale?" warn":"")+'"><span class="pip"></span><span class="vt"><b>From the last check</b> <span>· '+agoLabel(D.scannedAt)+'. Woodhouse’s site has the final word.</span></span></div>';
    h+='<div class="svcname"><h2>'+esc(f.name)+'</h2><span class="pill num">'+S.len+' min</span></div>';
    h+='<div class="whenblock"><span class="wt">'+(S.time!=null?clock(S.time):"")+'</span><span class="wd">'+DOWS[dow(x[0],x[1],sel())]+', '+MONS[x[1]]+' '+sel()+'</span><span class="wp num">$'+slotPrice(row)+(f.couples?" for two":"")+'</span></div>';
    h+='<div class="addr">'+pin()+'<span>'+esc(D.label)+' · '+esc(D.address)+' · <a href="https://maps.apple.com/?q='+encodeURIComponent(D.address)+'" target="_blank" rel="noopener">directions</a></span></div>';
    var provs=row?row[3]:[];
    if(f.couples){
      var pairs=(provs||[]).filter(pairOk);
      var best=pairs[0]||provs[0]||null;
      function pd(i){ return provN(i)+' · '+(provG(i)==="M"?"a man":"a woman"); }
      h+='<div class="provcard"><span class="who">For you</span><span class="pref"><i></i>'+(best?pd(best[0]):"Assigned at the spa")+'</span></div>';
      h+='<div class="provcard"><span class="who">Your guest</span><span class="pref"><i></i>'+(best?pd(best[1]):"Assigned at the spa")+'</span></div>';
      if(pairs.length>1) h+='<p class="finehint">'+plural(pairs.length-1,"other therapist pairing")+' also fits this time.</p>';
    } else {
      var g1=wantG(S.g1);
      var names=(provs||[]).filter(function(p){return !g1||provG(p)===g1;}).map(provN);
      if(!names.length) names=(provs||[]).map(provN);
      h+='<div class="provcard"><span class="who">Your therapist</span><span class="pref"><i></i>'+
        (names.length?esc(names.join(" or "))+' · '+(S.g1==="either"?"either is fine":"a "+S.g1):"Named on Woodhouse’s site")+'</span></div>';
    }
    var ao=f.addons||[];
    if(ao.length){
      h+='<div class="sect"><span>Add-ons at the spa</span></div>';
      h+='<p class="qs" style="margin:0 2px 8px">Picked on Woodhouse’s site. Adding one can change which times fit, so a time that’s open without it may not work with it.</p>';
      ao.forEach(function(a){
        h+='<div class="addon"><span class="an">'+esc(a[0])+'</span><span class="lead"></span><span class="ap num">'+(a[1]!=null?"$"+a[1]:"")+(f.couples?" each":"")+(a[2]?" · +"+a[2]+" min":"")+'</span></div>';
      });
    }
    h+='<div class="sect"><span>Your details</span><button class="x" data-go="details">Edit</button></div>';
    var p=S.profile;
    if(p.name||p.email){
      [["Name",p.name],["Email",p.email]].forEach(function(it){
        if(!it[1]) return;
        h+='<button class="chip" data-copy="'+esc(it[1])+'"><span class="txt"><span class="lbl">'+it[0]+'</span><span class="val">'+esc(it[1])+'</span></span><span class="cp">Copy</span></button>';
      });
    } else {
      h+='<button class="chip" data-go="details"><span class="txt"><span class="lbl">One-time setup</span><span class="val">Add your name and email. They stay on this device.</span></span><span class="cp">Add</span></button>';
    }
    h+='<div class="sect"><span>On Woodhouse’s site, you’ll tap</span></div>';
    var provLine=f.couples
      ? (S.g1==="either"&&S.g2==="either"?"Either therapist for each of you":("For you a "+S.g1+", for your guest a "+S.g2).replace(/a either/g,"either"))
      : (S.g1==="either"?"Either therapist":"A "+S.g1+" as your therapist");
    var steps=[[f.name+" · "+S.len+" min","under "+titleCase(f.cat)],["Any add-ons you’d like",null],[provLine,null],[DOWS[dow(x[0],x[1],sel())].slice(0,3)+" "+MONS[x[1]]+" "+sel()+", "+(S.time!=null?clock(S.time):""),null],["Your details as a guest · paste from above",null]];
    steps.forEach(function(s,i){
      h+='<div class="step'+(S.steps[i]?" done":"")+'" data-step="'+i+'"><span class="n">'+(i+1)+'</span><span class="st"><b>'+esc(s[0])+'</b>'+(s[1]?'<span class="sub">'+esc(s[1])+'</span>':"")+'</span></div>';
    });
    h+='<div class="terms"><input type="checkbox" id="agree"'+(S.terms?" checked":"")+'><label for="agree">I’ll confirm the booking on Woodhouse’s own site. This helper can’t hold a spot.</label></div>';
    h+='<button class="cta" id="openWh"'+(S.terms?"":" disabled")+'>Open Woodhouse booking →</button>';
    if(D.phone) h+='<a class="ghostbtn" style="margin-top:9px;text-decoration:none" href="tel:'+esc(D.phone.replace(/\D/g,""))+'">'+icon("phone",15)+'Or call the spa · '+esc(D.phone)+'</a>';
    h+='<div style="height:8px"></div></div>';
    return h;
  };

  VIEWS.details=function(){
    var p=S.profile;
    return '<div class="pad">'+subhead("Your details","Stays on this device")+
      '<p class="lede" style="margin-top:14px">Save your name and email once. Paste them into Woodhouse’s form with one tap. They stay on this device.</p>'+
      '<div class="field"><label>Name</label><input id="pfName" value="'+esc(p.name||"")+'" placeholder="First and last name"></div>'+
      '<div class="field"><label>Email</label><input id="pfEmail" value="'+esc(p.email||"")+'" placeholder="you@example.com" inputmode="email"></div>'+
      '<div class="applywrap"><button class="cta" data-act="savepf">Save on this device</button></div></div>';
  };

  VIEWS.settings=function(){
    return '<div class="pad">'+subhead("Settings",null)+
      '<div style="height:14px"></div>'+
      '<button class="setrow" data-go="location"><span class="si">'+pin()+'</span><span class="sl"><b>My spa</b><span>'+esc(D?D.label:"Choose a spa")+'</span></span><span class="ch">›</span></button>'+
      '<button class="setrow" data-go="details"><span class="si">'+icon("pencil",16)+'</span><span class="sl"><b>Your details</b><span>'+esc(S.profile.name||"Not set · stays on this device")+'</span></span><span class="ch">›</span></button>'+
      '<div class="statehdr">Appearance</div><div class="seg3" id="themeSeg">'+
        ["light","auto","dark"].map(function(t){
          var cur; try{ cur=localStorage.getItem("wsh-theme")||"auto"; }catch(e){ cur="auto"; }
          return '<button data-thm="'+t+'"'+(cur===t?' class="on"':"")+'>'+titleCase(t==="auto"?"Automatic":t)+'</button>';
        }).join("")+'</div>'+
      '<div class="statehdr">The data</div>'+
      '<button class="setrow" data-go="about"><span class="si">'+icon("info",16)+'</span><span class="sl"><b>About this helper</b><span>How it works · privacy</span></span><span class="ch">›</span></button></div>';
  };

  VIEWS.location=function(){
    var q=(S.locSearch||"").toLowerCase();
    var list=(IDX?IDX.locations:[]).filter(function(l){
      return !q||(l.city+" "+l.state+" "+l.label).toLowerCase().includes(q);
    });
    var h='<div class="pad">'+subhead("Which Woodhouse do you go to?",null)+
      '<div class="search"><input placeholder="Search city or state" id="locSearch" value="'+esc(S.locSearch||"")+'"></div><div style="height:14px"></div>';
    if(!list.length) h+='<p class="lede">No spas match that search.</p>';
    list.forEach(function(l){
      h+='<button class="locrow'+(l.key===S.locKey?" on":"")+'" data-loc="'+esc(l.key)+'"><span class="ln"><b>'+esc(l.city)+', '+esc(l.state)+'</b><span>'+esc(l.label)+(l.phone?' · '+esc(l.phone):"")+'</span></span><span class="mark">✓</span></button>';
    });
    h+='<p class="finehint">'+plural((IDX?IDX.locations.length:0),"Woodhouse location")+' · your pick is remembered on this device.</p></div>';
    return h;
  };

  VIEWS.about=function(){
    return '<div class="pad">'+subhead("About this helper",null)+
      '<div style="height:14px"></div>'+
      '<div class="aboutcard"><h3>How it works</h3><p>We check Woodhouse’s booking system for open times, all day, every day. Pick a time and we send you to Woodhouse’s site to book it. Booking always happens there, never here.</p></div>'+
      '<div class="aboutcard"><h3>Privacy</h3><p>Nothing about you is stored on our side. The name and email under Your details never leave this device.</p></div>'+
      '<div class="aboutcard"><h3>Accuracy</h3><p>Times can change between checks, and add-ons chosen at booking can change which times fit. When in doubt, the final word is Woodhouse’s own site.</p></div>'+
      footerless()+'</div>';
    function footerless(){ return '<p class="finehint" style="text-align:center">Not affiliated with Woodhouse Spas.</p>'.replace(/Not affiliated with Woodhouse Spas\./,""); }
  };

  /* ---------------- render + wire ---------------- */
  function render(){
    if(!D&&S.view!=="location"){ S.view="location"; }
    app.innerHTML=VIEWS[S.view]();
    if(S.strip&&S.view==="home"&&S.stripInfo){
      var si=S.stripInfo;
      app.insertAdjacentHTML("beforeend",
        '<button class="stripbtn" id="strip"><span class="sw"><span class="a">'+esc(si.when)+'</span><span class="b">'+esc(si.what)+'</span></span><span class="badge">Saved</span><span class="x" id="stripX">✕</span></button>');
    }
    wire();
    window.scrollTo(0,0);
  }

  function saveFilters(){ store("wsh-filters",{who:S.who,g1:S.g1,g2:S.g2,cat:S.cat,fam:S.fam,len:S.len}); }

  function wire(){
    app.querySelectorAll("[data-go]").forEach(function(b){ b.addEventListener("click",function(e){ e.stopPropagation(); go(b.getAttribute("data-go")); }); });
    app.querySelectorAll("[data-day]").forEach(function(b){ b.addEventListener("click",function(){ S.selBy[ymKey()]=Number(b.getAttribute("data-day")); render(); }); });
    app.querySelectorAll("[data-pick]").forEach(function(b){ b.addEventListener("click",function(){ S.selBy[ymKey()]=Number(b.getAttribute("data-pick")); go("home"); }); });
    app.querySelectorAll("[data-time]").forEach(function(b){ b.addEventListener("click",function(){
      var t=Number(b.getAttribute("data-time"));
      S.time=t;
      S.timeRow=rowsFor(iso(ym()[0],ym()[1],sel())).find(function(r){return r[0]===t;})||null;
      S.steps={};
      go("card");
    }); });
    app.querySelectorAll("[data-set]").forEach(function(b){ b.addEventListener("click",function(){
      var kv=b.getAttribute("data-set"), i=kv.indexOf(":"), k=kv.slice(0,i), v=kv.slice(i+1);
      if(k==="who"){ S.who=v; S.fam=null; }
      else if(k==="fam"){ S.fam=v; }
      else if(k==="len"){ S.len=Number(v); }
      else S[k]=v;
      ensureSelection(); saveFilters(); render();
    }); });
    var catSel=document.getElementById("catSel");
    if(catSel) catSel.addEventListener("change",function(){ S.cat=catSel.value; S.fam=null; ensureSelection(); saveFilters(); render(); });
    app.querySelectorAll("[data-copy]").forEach(function(b){ b.addEventListener("click",function(){
      var v=b.getAttribute("data-copy");
      var done=function(){ b.classList.add("copied"); b.querySelector(".cp").textContent="✓ Copied"; toast("Copied · "+v);
        setTimeout(function(){ b.classList.remove("copied"); b.querySelector(".cp").textContent="Copy"; },1500); };
      if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done,done); else done();
    }); });
    app.querySelectorAll("[data-step]").forEach(function(b){ b.addEventListener("click",function(){ var i=b.getAttribute("data-step"); S.steps[i]=!S.steps[i]; render(); }); });
    app.querySelectorAll("[data-loc]").forEach(function(b){ b.addEventListener("click",function(){ chooseLocation(b.getAttribute("data-loc")); }); });
    var locSearch=document.getElementById("locSearch");
    if(locSearch){ locSearch.addEventListener("input",function(){ S.locSearch=locSearch.value;
      clearTimeout(locSearch._t); locSearch._t=setTimeout(function(){ var pos=locSearch.selectionStart; render(); var el=document.getElementById("locSearch"); if(el){ el.focus(); el.setSelectionRange(pos,pos); } },220);
    }); }
    app.querySelectorAll("[data-act]").forEach(function(b){ b.addEventListener("click",function(){
      var a=b.getAttribute("data-act");
      if(a==="monthview") go("month");
      if(a==="prevm"){ ymShift(-1); render(); }
      if(a==="nextm"){ ymShift(1); render(); }
      if(a==="editfilters"){ S.returnTo="home"; go("filters"); }
      if(a==="apply"){ var back=S.returnTo||"home"; S.returnTo=null; go(back); toast("Showing "+sentence()); }
      if(a==="savepf"){
        S.profile={ name:(val("pfName")||"").slice(0,80), email:(val("pfEmail")||"").slice(0,120) };
        store("wsh-profile",S.profile); toast("Saved on this device"); go(S.time!=null?"card":"settings");
      }
      if(a==="minimize"){
        var x=ym();
        S.strip=true;
        S.stripInfo={ when:clock(S.time)+" · "+DOWS[dow(x[0],x[1],sel())].slice(0,3)+" "+MONS[x[1]].slice(0,3)+" "+sel(), what:fam().name+" · "+S.len+" min · $"+slotPrice(S.timeRow) };
        go("home");
      }
    }); });
    var agree=document.getElementById("agree");
    if(agree) agree.addEventListener("change",function(){ S.terms=agree.checked; store("wsh-terms",S.terms); render(); });
    var openWh=document.getElementById("openWh");
    if(openWh) openWh.addEventListener("click",function(){ if(!openWh.disabled){ window.open(D.bookingUrl,"_blank","noopener"); toast("Opening Woodhouse · finish the booking there"); } });
    var strip=document.getElementById("strip");
    if(strip) strip.addEventListener("click",function(e){
      if(e.target.id==="stripX"){ S.strip=false; render(); toast("Saved time dismissed"); }
      else go("card");
    });
    var seg=document.getElementById("themeSeg");
    if(seg) seg.querySelectorAll("[data-thm]").forEach(function(b){ b.addEventListener("click",function(){
      seg.querySelectorAll("button").forEach(function(x){x.classList.remove("on");}); b.classList.add("on");
      var t=b.getAttribute("data-thm");
      try{
        if(t==="auto"){ localStorage.removeItem("wsh-theme"); delete document.documentElement.dataset.theme; }
        else { localStorage.setItem("wsh-theme",t); document.documentElement.dataset.theme=t; }
      }catch(e){}
    }); });
    // mouse users can drag the date row
    var rib=app.querySelector(".ribbon");
    if(rib){
      var down=false,sx=0,sl=0;
      rib.addEventListener("mousedown",function(e){ down=true; sx=e.pageX; sl=rib.scrollLeft; });
      window.addEventListener("mousemove",function(e){ if(down) rib.scrollLeft=sl-(e.pageX-sx); });
      window.addEventListener("mouseup",function(){ down=false; });
      rib.addEventListener("wheel",function(e){ if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){ rib.scrollLeft+=e.deltaY; e.preventDefault(); } },{passive:false});
      // center selected day
      var on=rib.querySelector(".dcard.on");
      if(on) rib.scrollLeft=Math.max(0,on.offsetLeft-rib.clientWidth/2+34);
    }
  }
  function val(id){ var e=document.getElementById(id); return e?e.value.trim():""; }

  /* ---------------- data loading ---------------- */
  function fetchJson(u){ return fetch(u,{cache:"no-cache"}).then(function(r){ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); }); }
  function loadError(msg){
    app.innerHTML='<div class="pad"><div class="emptyday" style="margin-top:30vh"><div class="serif">Couldn’t load open times</div><p>'+esc(msg)+' · <span style="text-decoration:underline;cursor:pointer" onclick="location.reload()">try again</span></p></div></div>';
  }
  function chooseLocation(key){
    S.locKey=key; store("wsh-loc",key);
    D=null; FAMS=null; S.ym=null; S.selBy={}; S.time=null; S.strip=false;
    app.innerHTML='<div class="boot"><div class="boot-pip"></div><p>Loading open times…</p></div>';
    fetchJson("/data/locations/"+encodeURIComponent(key)+".json").then(function(data){
      D=data; buildFams(); ensureSelection(); go("home");
    }).catch(function(e){ loadError("This spa’s times aren’t available right now ("+e.message+")"); });
  }

  window.addEventListener("resize",function(){ clearTimeout(window._rz); window._rz=setTimeout(function(){ if(S.view==="home") render(); },150); });

  fetchJson("/data/index.json").then(function(idx){
    IDX=idx;
    var keys=new Set(idx.locations.map(function(l){return l.key;}));
    if(S.locKey&&keys.has(S.locKey)) chooseLocation(S.locKey);
    else { S.view="location"; render(); }
  }).catch(function(e){ loadError(e.message); });
})();
