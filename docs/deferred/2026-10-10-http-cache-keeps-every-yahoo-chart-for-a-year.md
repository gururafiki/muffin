# http-cache keeps every Yahoo chart response for a year, and the price lane now sends it 2,500 a night

Created 2026-10-10 · Due when Phase 4's company lane is built (step 5's nginx changes) · Status: **done
2026-10-25**: a week of price nights stored no price-lane chart (below)

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

## Live (2026-10-17)

The nginx half deployed 2026-10-16 19:06 UTC. The lane half rolled 2026-10-17 14:29 UTC
(muffin-ingest#110, image `df0ed5…`). So the night of 2026-10-18 is the first price night whose
chart answers are not stored.

**The size before, 2026-10-17 14:50 UTC:** `muffin_volume_bytes{volume="muffin_http-cache-data"}`
reads 27.79 GB, with `/mnt/data` at 69%. That is down from 31.4 GB on 10-13: the zone's LRU had
already evicted some entries. Read it again after one rotation (~2026-10-23).

## The first night, read 2026-10-18

**The header works.** Since the 2026-10-17 20:27 UTC roll, http-cache stored 39 new
`/yahoo/v8/finance/chart` entries, read from the entries' own `KEY:` lines.
- All 39 are the FX lane's `range=5d&interval=1d` spot requests at 00:00, one per currency, which
  stay cached by design. Each currency's key is the same every day, so its file is rewritten in place
  and adds no size.
- None of the price lane's 2,440 chart requests that night was stored.

**The size:**
- `muffin_volume_bytes` read **27.92 GB** at 14:05 UTC (`du -sb` 27.89 GB at 07:40), against
  27.79 GB at 10-17 14:50: +0.13 GB in a day.
- The growth came from SEC (4,733 new entries), openbb-api (about 800) and Tiingo (99). None is chart.
- 473,917 files. `/mnt/data` at 71%.

Read it again after the price lane's first full rotation (~2026-10-23). Until then, one night says
the chart lane no longer grows the cache; it does not yet say the size panel shows a flat rotation.

## After a full rotation, read 2026-10-25

**Done.** Every cache entry written since 2026-10-18 03:00, classified by its own `KEY:` line:
16,383 entries.
- **Chart: 39**, all the FX lane's `range=5d` spot requests, rewritten in place. **None** of the
  price lane's roughly 17,000 chart requests over seven nights was stored.
- The rest: openbb-api 5,852; SEC 6,718 (`data.sec.gov` 3,392, `www.sec.gov` 2,734, full-text
  search 592); NSE archives 2,835; Tiingo 496; CNINFO about 100.
- `muffin_volume_bytes{volume="muffin_http-cache-data"}` reads **28.80 GB**, against 27.92 GB on
  10-18: +0.88 GB in seven days, the ~0.13 GB a day the other providers already added. 480,947
  files.
- At that rate the zone reaches its 40 GB LRU in about 85 days. `/mnt/data` is at 75% (24 GB free)
  after `raw_price_history` was dropped the same morning.

## Done when

A rotation of the price lane no longer grows the cache, and the size panel shows it.
