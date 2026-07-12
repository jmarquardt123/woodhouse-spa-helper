#!/usr/bin/env node
// MANUAL, OPTIONAL retention tool — delete event blobs older than N days so the
// per-day list cost never regrows unbounded. Not wired to any schedule; run it
// by hand when you feel like tidying.
//
//   BLOB_READ_WRITE_TOKEN=… node scripts/prune-events.js [--days 90] [--dry]

const { list, del } = require("@vercel/blob");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

(async () => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("BLOB_READ_WRITE_TOKEN is not set.");
    process.exit(1);
  }
  const days = parseInt(arg("days", "90"), 10);
  const dry = process.argv.includes("--dry");
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const stale = [];
  let cursor;
  do {
    const page = await list({ prefix: "ev/", cursor, limit: 1000 });
    for (const b of page.blobs) {
      const m = b.pathname.match(/^ev\/(\d{4}-\d{2}-\d{2})\//);
      if (m && m[1] < cutoff) stale.push(b.url);
    }
    cursor = page.hasMore ? page.cursor : null;
  } while (cursor);

  console.log(`${stale.length} event blob(s) older than ${cutoff}${dry ? " (dry run)" : ""}`);
  if (dry || !stale.length) return;
  for (let i = 0; i < stale.length; i += 100) {
    await del(stale.slice(i, i + 100));
  }
  console.log(`deleted ${stale.length}`);
})().catch((e) => { console.error("prune failed:", e.message); process.exit(1); });
