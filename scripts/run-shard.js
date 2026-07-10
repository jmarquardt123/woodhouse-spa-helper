#!/usr/bin/env node
// CI entry: pull every location in this shard, upload each, then refresh the
// index. MODE=near scans 14 days into <key>-near.json (fast, hourly);
// MODE=deep scans 90 days into <key>.json (twice daily).

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "locations.json"), "utf8"));
const SHARD = Number(process.env.SHARD || 0);
const SHARDS = Number(process.env.SHARDS || 1);
const ONLY = (process.env.ONLY || "").trim();
const MODE = (process.env.MODE || "deep").trim();
const DAYS = MODE === "near" ? "14" : "90";
const SUFFIX = MODE === "near" ? "-near" : "";

function bucket(key) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % SHARDS;
}

let keys;
if (ONLY) keys = SHARD === 0 ? [ONLY] : [];
else keys = registry.locations.map((l) => l.key).filter((k) => bucket(k) === SHARD);

console.log(`shard ${SHARD}/${SHARDS} mode=${MODE}: ${keys.length} location(s): ${keys.join(", ") || "(none)"}`);
let failures = 0;
for (const key of keys) {
  try {
    execFileSync("node", [path.join(ROOT, "scripts", "pull-location.js"),
      "--key", key, "--days", DAYS, "--concurrency", "8", "--suffix", SUFFIX], { stdio: "inherit" });
  } catch (e) {
    // exit 2 = pulled fine with canary notes (shown in-app); only exit 1 is a real failure
    if (e.status === 2) console.error(`pull ${key}: canary notes recorded — continuing`);
    else { failures++; console.error(`pull ${key} failed — continuing`); }
  }
  try {
    execFileSync("node", [path.join(ROOT, "scripts", "upload-blob.js"), "--only", key + SUFFIX], { stdio: "inherit" });
  } catch (e) {
    failures++;
    console.error(`upload ${key} failed — continuing`);
  }
}
try {
  execFileSync("node", [path.join(ROOT, "scripts", "merge-index.js")], { stdio: "inherit" });
} catch (e) {
  console.error("index merge failed:", e.message);
}
process.exit(failures > 0 ? 1 : 0);
