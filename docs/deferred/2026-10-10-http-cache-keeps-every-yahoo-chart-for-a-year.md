# http-cache keeps every Yahoo chart response for a year, and the price lane now sends it 2,500 a night

Created 2026-10-10 · Due when Phase 4's company lane is built (step 5's nginx changes) · Status: **built,
waiting on the deploy and the roll** (2026-10-14)

## Why it is deferred

The cache zone evicts by last access with `inactive=365d`, and the `/yahoo/v8/finance/chart`
location stores every 200 for an hour. Since muffin-ingest#104 the price lane asks that location
for each security's chart, through the cache. Its URLs carry a per-security date window, so no
request is asked twice and nothing ever hits. Each body stays on disk until the 40 GB LRU or a year
passes.

- **Size:** AAPL's full history measured 1.3 MB of JSON on 2026-10-10, served gzip-encoded. A first
  rotation of full loads is ESTIMATED at 1–2 GB of entries over about five nights, from that size and
  the universe's history lengths; it has not been measured. After it, an extension is a few KB a night.
- **The cache stood at 29 of its 40 GB that day, on a `/mnt/data` at 67%.** The entries are harmless
  data, and they push useful entries out first.

Phase 4's company lane needs nginx changes in the same file anyway: bigger proxy buffers for the
timeseries endpoint, a 16 KB request-line limit, and no caching for quoteSummary. So this joins that
change, step 5 of the Phase 4 plan, rather than costing a deploy of its own while the Cloudflare
token blocks every deploy.

## What to do

1. In muffin-deployment's `stack/proxy/nginx.conf`, add a request header the lanes can send to skip
   STORING, mapped to `proxy_no_cache`. It is the opposite of the existing `X-Muffin-Cache-Bypass`,
   which skips the read and stores. Send it from the price lane, whose chart URLs are never repeated,
   and from quoteSummary.
2. Leave the FX lane cached: its URLs repeat within the hour by design.
3. Measure the cache size before and after one rotation (`muffin-cache-size.sh` metrics on the Cache
   dashboard).

## Built (2026-10-14)

- **nginx:** `proxy_no_cache $http_x_muffin_cache_no_store` in muffin-deployment#428, merged and
  waiting on the deploy (the Cloudflare token).
- **The lane:** muffin-ingest#110 (commit `046f7d2`). `yahoo_chart.fetch(store=False)` sends
  `X-Muffin-Cache-No-Store: 1`. The price lane passes it, and the FX lane passes `store=True`. Each
  rule is mutation-proven. It had been missed when #110 was first built: the note named the price
  lane, and nothing tracked that half.
- **The size before:** 31.4 GB on 2026-10-13 (`muffin_volume_bytes`), up from 29 GB on 10-10, with
  `/mnt/data` at 71% (from 67%).

## Done when

A rotation of the price lane no longer grows the cache, and the size panel shows it.
