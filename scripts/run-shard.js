#!/usr/bin/env node
// CI entry: pull every location in this shard (sequentially, politely), then
// upload the results. Shard N of SHARDS takes keys where hash(key)%SHARDS==N.
// ONLY=<key> restricts to a single location regardless of shard (shard 0 runs it).

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "locations.json"), "utf8"));
const SHARD = Number(process.env.SHARD || 0);
const SHARDS = Number(process.env.SHARDS || 1);
const ONLY = (process.env.ONLY || "").trim();

function bucket(key) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % SHARDS;
}

let keys;
if (ONLY) keys = SHARD === 0 ? [ONLY] : [];
else keys = registry.locations.map((l) => l.key).filter((k) => bucket(k) === SHARD);

console.log(`shard ${SHARD}/${SHARDS}: ${keys.length} location(s): ${keys.join(", ") || "(none)"}`);
let failures = 0;
for (const key of keys) {
  try {
    execFileSync("node", [path.join(ROOT, "scripts", "pull-location.js"), "--key", key, "--days", "90", "--concurrency", "5"], { stdio: "inherit" });
  } catch (e) {
    failures++;
    console.error(`pull ${key} exited nonzero (canary issues or failure) — continuing`);
  }
  try {
    execFileSync("node", [path.join(ROOT, "scripts", "upload-blob.js"), "--only", key], { stdio: "inherit" });
  } catch (e) {
    failures++;
    console.error(`upload ${key} failed — continuing`);
  }
}
// last shard also refreshes the index (each pull updates its own local index,
// but only this job's slice — merge remotely instead)
try {
  execFileSync("node", [path.join(ROOT, "scripts", "merge-index.js")], { stdio: "inherit" });
} catch (e) {
  console.error("index merge failed:", e.message);
}
process.exit(failures > 0 ? 1 : 0);
