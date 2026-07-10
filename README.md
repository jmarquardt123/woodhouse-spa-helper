# Woodhouse Spa Helper

A free website that shows open appointment times at Woodhouse spas and hands
you off to Woodhouse's own site to book. **Read-only by design: it never
books, pays, joins waitlists, or opts anyone into anything.**

## How data flows

```
GitHub Actions (cron every 4 h, 8 shards)
  scripts/run-shard.js
    -> scripts/pull-location.js   scan one location honestly:
         solo services x man/woman, couples x all four pairings, add-ons
    -> scripts/upload-blob.js     out/locations/<key>.json -> Vercel Blob
    -> scripts/merge-index.js     rebuild data/index.json from Blob listing
Site (Vercel) fetches data/index.json + data/locations/<key>.json from Blob.
```

## Scripts

- `npm run locations` — rebuild `config/locations.json` from Meevo's tenant
  location list (`--verify` initializes each and drops dead ones)
- `npm run pull -- --key grand-rapids-mi` — scan one location
- `npm run upload` — push `out/` to Vercel Blob (`BLOB_READ_WRITE_TOKEN`)

## Honesty rules

- Placeholder guests only; no personal data is ever sent upstream.
- Couples "Either" filters are backed by real scans of all four pairings.
- Add-ons are listed with a warning that choosing them can change which
  times fit.
- If upstream data changes shape, the canary flags it and the site says
  "times may be out of date" instead of guessing.
- Polite pacing; if upstream ever objects, back off the cadence.
