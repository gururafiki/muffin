# The http-cache is bounded only by a 40 GB cap, on a disk that alerts at 80%

Recorded 2026-11-01. **Decided the same day** (below): the cap stays at 40 GB, and the room comes
from elsewhere.

## Why

`/mnt/data` holds the database, raw Parquet and the http-cache together. It is 100.2 GiB, and
`muffin-disk-filling` fires above 80%. That alert computes `100 - avail / size * 100`, where `size`
includes the ext4 reserved blocks, so it reads about 1.3 points above `df`'s `Use%`.

- **2026-11-01 13:00 UTC:** 75.3% after the contract (muffin-deployment#479) dropped 5.3 GB of
  retired tables. The SEC CIK grid adds ~2.9 GB, which leaves ~1.5 GB of headroom. The insider
  data sets (Phase 5 step 8, ~5 GB) cannot run until there is room.
- **The cache is 29.45 GB in 485,516 files**, the largest single tenant of the disk. It grows
  ~0.13 GB a day (`2026-10-10-http-cache-keeps-every-yahoo-chart-for-a-year.md`).
- **It is configured `inactive=365d max_size=40g`.** At 40 GB the disk would be at ~86% with nothing
  else growing, so the cap cannot keep the disk under its alert.

### `inactive` cannot free anything soon

nginx's cache loader runs at startup and gives every entry it finds on disk a fresh expiry,
`expire = now + inactive` (`ngx_http_file_cache_add`, `src/http/ngx_http_file_cache.c`, read
2026-11-01 on `master`). So `inactive` counts from the last access **or the last restart**,
whichever is later.

- http-cache restarts whenever `nginx.conf` or `openresty.conf` changes (the config-hash label). It
  last started 2026-10-29 19:52.
- Setting `inactive=30d` is itself a config change, so it restarts the cache. The earliest eviction
  is then 30 days after that deploy, and never, if another config change lands first.
- `max_size` acts at once: the cache manager evicts from the tail of the LRU queue until the zone
  fits. Entries untouched since the restart sit behind every entry read since, so what goes first is
  what nothing has asked for.

### What the cache holds

Measured on a 1-in-100 sample (4,855 entries), each classified by its own `KEY:` line and sized by
file. The age is since written. `/mnt/data` is mounted `noatime`, so file times cannot say when an
entry was last read. The cache dates from 2026-08-23, so no entry is older than ~70 days.

| Location | Size | Written >30 days ago | What reads it again |
|---|---|---|---|
| `www.sec.gov` (`sec`) | ~15.0 GB | ~12.1 GB | the edge segment handler, on a parser-version bump (Phase 6 stores instances itself) |
| `openbb-api` (`openbb`) | ~5.2 GB | ~5.0 GB | price targets (1-hour TTL); most callers are retired |
| `static.cninfo.com.cn` | ~3.4 GB (4 sampled files, noisy) | ~0.04 GB | CNINFO segment PDFs |
| `opendart.fss.or.kr` (`dart`) | ~2.1 GB | ~2.1 GB | Korean segments |
| `query2.finance.yahoo.com` (`yahoo`) | ~1.5 GB | ~0.01 GB | FX spot, rewritten in place |
| `api.tiingo.com` | ~1.0 GB | ~0.5 GB | nothing: Tiingo retired 2026-10-25 |
| `data.sec.gov` (`sec-data`) | ~0.8 GB | 0 | the edge XBRL handler until step 9; the Dagster lanes bypass and do not store |
| the rest (NSE, OpenFIGI, CNINFO API, Wikidata, full-text search) | ~0.1 GB | — | |

The working set the cache actually serves is small. HITs ran ~180-220 per six hours before
2026-10-31, from `sec`, `sec-fts` and `openbb` (`2026-10-31-the-cache-hit-ratio-alert-measures-the-traffic-mix.md`).

## What to do (a choice)

1. **Lower `max_size` to a bound the disk can afford.** 10g frees ~19 GB within minutes of the
   deploy, 15g ~14 GB, 20g ~9 GB. Recommended: **15g**. It keeps every location's working set
   several times over, and puts `/mnt/data` near 65% after the grid.
2. **Also shorten `inactive` (for example 30d)** for long-run hygiene. On its own it frees nothing
   until a month without a restart (above).
3. **A one-time purge by write age**, through a `maintenance.yml` action. nginx copes with a missing
   file (a miss), but its size accounting keeps counting the deleted bytes until the next restart,
   so this is weaker than option 1 and is not recommended.

Whichever is chosen, it is one line in `stack/proxy/nginx.conf` plus a deploy. The config hash
restarts http-cache, and the cache manager does the eviction.

## Decided 2026-11-01 (the user)

- **The cap stays at 40 GB, and `inactive` is left alone for now.**
- **The cache stays on the block volume.** Moving it to the boot volume (57.6 GB free) was offered
  and declined: anything an instance replacement would lose belongs on `/mnt/data`.
- **The room comes from elsewhere** (muffin-deployment#482):
  - **Clean the leaked volumes.** 152 anonymous volumes no container used held 11.1 GB: 84
    throwaway Postgres databases from schema replays (`docker rm -f` without `-v`), 30 RabbitMQ data
    directories (one per restart), 4 Redis dumps, 34 empty. `maintenance.yml prune-volumes` removes
    them; the replay scripts now remove with `-v` (also muffin-ingest#157), and RabbitMQ gets one
    named volume with a fixed hostname.
  - **Grow the data volume 100 -> 105 GB**, the last of the free allowance. OCI's own limits for
    this tenancy, read 2026-11-01: `total-free-storage-gb-regional` 200, 195 used, 5 available;
    `total-storage-gb` 61,440 per availability domain. The compute limits (250 A1 cores, 100 E4) are
    a Pay As You Go account's, so paid storage is available (~$0.0425 per GB-month Balanced);
    unconfirmed on the billing page. Buying more was offered at 150, 200 and 300 GB and declined
    for now.
- **Projection after both:** ~64% after the CIK grid, ~69% once the insider history lands, then
  ~2.5 GB a week (database 1.5, cache 0.6, raw 0.4, measured 10-25..11-01 on
  `muffin_volume_bytes`). That reaches 80% in about a month, when buying storage is the next
  decision.

## Done when

- `/mnt/data` reads under ~70% by the alert's own measure, and the http-cache volume
  (`muffin_volume_bytes{volume="muffin_http-cache-data"}`) stays flat under its new cap.
- The insider data-set backfill (Phase 5 step 8) has room to run.
- Context: `muffin-deployment/stack/proxy/nginx.conf` (`proxy_cache_path`),
  `stack/observability/grafana/provisioning/alerting/rules.yml` (`muffin-disk-filling`).
