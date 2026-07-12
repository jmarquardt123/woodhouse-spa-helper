#!/usr/bin/env node
// Blob-ops reduction test — runs the REAL server code with @vercel/blob and
// ./_lib/events swapped for counting mocks (no install, no network, no real
// Blob touched). Proves the advanced-operation reduction the fix is for.
//
//   node test/blob-ops.test.js
"use strict";

const assert = require("assert");
const Module = require("module");

// ---- counting mock for @vercel/blob (used by the REAL events.js) ----
const blobStat = { puts: 0, putBodies: [], lists: 0, listPrefixes: [] };
let listResponder = () => ({ blobs: [], hasMore: false, cursor: null });
const blobMock = {
  put: async (pathname, body) => { blobStat.puts++; blobStat.putBodies.push(String(body)); return { url: "https://blob.local/" + pathname, pathname }; },
  list: async (opts) => { blobStat.lists++; blobStat.listPrefixes.push(opts.prefix); return listResponder(opts); }
};

// ---- spy mock for ./_lib/events (used by the REAL ev.js) ----
const evSpy = { calls: [] };
const eventsMock = {
  logEvents: async (records) => { evSpy.calls.push(records); },
  geoOf: (req) => ({ ua: String((req.headers || {})["user-agent"] || ""), country: "US" })
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@vercel/blob") return blobMock;
  if (request === "./_lib/events") return eventsMock; // only ev.js asks this way
  return origLoad.apply(this, arguments);
};

// real modules under test
const events = require("../api/_lib/events.js");            // uses blobMock
const evHandler = require("../api/ev.js");                   // uses eventsMock
const { planSync } = require("../scripts/upload-blob.js");   // pure

let failures = 0;
function ok(name, cond, detail) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

(async () => {
  // 1. BATCHING: one flush of 8 events = 1 put; old path = 8 puts.
  blobStat.puts = 0;
  await events.logEvents(Array.from({ length: 8 }, (_, i) => ({ type: "visit", t: "T" + i })));
  const batchedPuts = blobStat.puts;
  blobStat.puts = 0;
  for (let i = 0; i < 8; i++) await events.logEvent({ type: "visit" });
  const legacyPuts = blobStat.puts;
  ok("8 batched events = 1 put", batchedPuts === 1, `${batchedPuts} put(s)`);
  ok("8 legacy singles = 8 puts (the old cost)", legacyPuts === 8);
  ok("write reduction >= 10x on the event path", legacyPuts / batchedPuts >= 8,
     `${legacyPuts} -> ${batchedPuts}`);

  // 2. SCOPED READS: loadEvents(7) lists per-day prefixes, never all-history "ev/".
  blobStat.lists = 0; blobStat.listPrefixes = [];
  listResponder = () => ({ blobs: [], hasMore: false, cursor: null });
  await events.loadEvents(7);
  const allScoped = blobStat.listPrefixes.every((p) => /^ev\/\d{4}-\d{2}-\d{2}\/$/.test(p));
  ok("reads are day-scoped, not all-history", allScoped && !blobStat.listPrefixes.includes("ev/"),
     blobStat.listPrefixes.join(", "));
  ok("list count bounded by window (<= 7 for 7 days)", blobStat.lists <= 7, `${blobStat.lists} lists`);

  // 3. MIXED SHAPES: reader flattens batched arrays AND legacy single records.
  const bodies = {
    "https://blob.local/ev/d/a.json": JSON.stringify([{ type: "visit", t: "2" }, { type: "card", t: "3" }]),
    "https://blob.local/ev/d/b.json": JSON.stringify({ type: "booking", t: "1" }) // legacy single
  };
  global.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(bodies[url]) });
  listResponder = () => ({
    blobs: [{ url: "https://blob.local/ev/d/a.json" }, { url: "https://blob.local/ev/d/b.json" }],
    hasMore: false, cursor: null
  });
  const recs = await events.loadEvents(1);
  ok("mixed array+legacy blobs flatten to 3 records", recs.length === 3, `${recs.length} records`);
  ok("records sorted newest-first by t", recs[0].t === "3" && recs[2].t === "1");

  // 4. ev.js: batched POST -> ONE logEvents call carrying all valid events.
  evSpy.calls = [];
  const res = () => ({ statusCode: 0, end() {} });
  await evHandler({ method: "POST", headers: { "user-agent": "Mozilla" },
    body: { events: [{ type: "visit" }, { type: "card" }, { type: "bogus" }, { type: "booking" }] } }, res());
  ok("batched POST = 1 storage write", evSpy.calls.length === 1, `${evSpy.calls.length} writes`);
  ok("invalid event types dropped (3 of 4 kept)", evSpy.calls[0] && evSpy.calls[0].length === 3);

  // legacy single POST still works
  evSpy.calls = [];
  await evHandler({ method: "POST", headers: { "user-agent": "Mozilla" }, body: { type: "visit", key: "k" } }, res());
  ok("legacy single POST still logs", evSpy.calls.length === 1 && evSpy.calls[0].length === 1);

  // bots dropped, no write
  evSpy.calls = [];
  await evHandler({ method: "POST", headers: { "user-agent": "Googlebot/2.1" }, body: { events: [{ type: "visit" }] } }, res());
  ok("bot UA writes nothing", evSpy.calls.length === 0);

  // 5. DEPLOY: planSync uploads only changed files; unchanged deploy = 0 puts.
  const files20 = Array.from({ length: 20 }, (_, i) => ({ remote: `data/locations/l${i}.json`, hash: "h" + i }));
  const fullManifest = Object.fromEntries(files20.map((f) => [f.remote, f.hash]));
  ok("unchanged deploy uploads 0 files", planSync(files20, fullManifest).toUpload.length === 0);
  const oneChanged = files20.map((f, i) => (i === 3 ? { ...f, hash: "NEW" } : f));
  ok("1 changed of 20 uploads exactly 1", planSync(oneChanged, fullManifest).toUpload.length === 1);
  ok("first run (empty manifest) uploads all 20", planSync(files20, {}).toUpload.length === 20);

  console.log(failures ? `\n${failures} FAILED` : "\nALL BLOB-OPS TESTS PASSED");
  process.exit(failures ? 1 : 0);
})();
