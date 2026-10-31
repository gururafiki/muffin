# The cache hit-ratio alert measures the traffic mix, not the cache

Recorded 2026-10-31. Open: the fix is a choice (below).

## Why

`muffin-cache-hit-ratio-collapsed` ("The provider cache has stopped serving hits") has fired since
2026-10-31 07:00 UTC. It alerts when HIT is under 5% of HIT, MISS, EXPIRED and STALE for six hours.

**The cache is working.** Measured at 09:56: the same SEC archive URL asked twice through http-cache
logged `MISS ... 0.132s`, then `HIT ... 0.000s`. Deployed nginx honours both muffin headers.

**What changed is the traffic.** HITs per six hours, by provider:

| Ending | `sec` | `sec-fts` | all HITs | ratio |
|---|---|---|---|---|
| 10-29 16:00 | 144 | 74 | 220 | 27% |
| 10-30 16:00 | 110 | 74 | 184 | 22% |
| 10-31 04:00 | 0 | 74 | 75 | ~2% (price night: `yahoo` 2,471 MISS) |
| 10-31 10:00 | 0 | 0 (56 MISS) | 0 | 0% |

- The hits were a few callers that repeat a question within a cache TTL: `sec` (the edge's
  segment and filing readers re-reading index files of new filings) and `sec-fts`
  (`new_nport_filings` asking full-text search for the same 74 funds).
- 10-31 is a Saturday. No new filings means no repeated `sec` reads, and the `sec-fts` entries
  expired and were re-fetched as MISS.
- The rework moved most traffic onto lanes that never repeat a question. The price lane asks each
  security once a night. The SEC lanes send `X-Muffin-Cache-Bypass` and `-No-Store`.
  `yahoo-summary` and `yahoo-timeseries` are cache-off (`NONE`, 3,052 in six hours), which the rule
  correctly leaves out.

So the ratio has become a measure of how much repeat traffic there is, and the rule fires on a
quiet day with the cache healthy. It will likely clear on Monday's filings and fire again on the
next quiet weekend.

## What to do (a choice)

1. **Replace it with a canary that tests what it guards.** Every hour, ask one fixed, cacheable
   URL twice and alert if the second answer is not a HIT. This is the measurement above, made
   standing. It cannot cry wolf on a quiet day, and it catches what the ratio was meant to catch: a
   changed key, a full cache directory, a `proxy_cache` lost in a config edit. Recommended.
2. **Keep the ratio, restricted to providers whose callers repeat** (`openbb:*`, `sec-data`), and
   only above a minimum volume. This is cheaper, but it moves the guess rather than removing it,
   and the list drifts as lanes retire.
3. **Demote it to a gauge** on the provider dashboard, with no alert.

## Done when

- The rule no longer fires on a day the cache is shown to work, and something still fails when the
  cache stops storing.
- Context: `muffin-deployment/stack/observability/grafana/provisioning/alerting/rules.yml`
  (`muffin-cache-hit-ratio-collapsed`), `stack/proxy/nginx.conf` (the two muffin headers).
