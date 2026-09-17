# http-cache serves the previous fetch to a lane that fetches once per period

Created 2026-09-16 · **Due 2026-09-18** · Status: **decided and shipped 2026-09-17** — verify on the
2026-09-18 00:00 run

## Decision (2026-09-17)

Option **A + C**. A 23-hour TTL was considered and rejected: the first request after *any* expiry
is still served the old body.

- muffin-deployment#379: `location /yahoo/v8/finance/chart` with no `updating` and
  `proxy_cache_background_update off` (TTL stays 1 h; still stale on errors, 429 and 5xx). Deploy
  dispatched 2026-09-17.
- muffin-ingest#42 (rolled 11:42 UTC): `fx_rate` fails a weekday partition with no rate inside its
  window from bodies that carry rates, naming it. Accepted edge: 25 Dec and 1 Jan fail.

## Why it is deferred

Found while recovering from the exporter incident (muffin-ingest#39). The fix is a design choice
between cache semantics, a client-side bypass and a stage-2 guard, so it is the user's call.

## Context

- **The mechanism, from nginx's documentation and `stack/proxy/nginx.conf`:** the global
  `proxy_cache_use_stale error timeout updating http_429 …` plus `proxy_cache_background_update on`
  make the **first request after an entry expires receive the STALE entry**, while nginx refreshes it
  in the background. The `/yahoo/` location caches `200` for `1h`.
- **Measured 2026-09-16:** the FX spot backfill fetched `EURUSD=X?range=5d&interval=1d` at
  12:12:04Z, and http-cache logged `STALE … -> 200`. The stored body's `regularMarketTime` was
  2026-09-11 21:29Z and its newest bar 09-11 — five days old. `fx_rate` refused every point
  (`outside_window: 760`, `live_points: 152`, `rows: 0`) and **materialized all four partitions
  anyway**, claiming days it holds nothing for.
- **Why it is systematic, not a one-off:** a daily lane asks each URL once a day. The run for
  partition D fires at D+1 00:00 and receives the body cached at D 00:00, which cannot contain D's
  completed bar. Unless something else fetched the URL within the hour, every daily FX spot run
  publishes nothing. `market.fx_rate` stopping at 2026-09-12 is consistent with this; not every
  earlier day has been attributed.
- **Confirmed on the first scheduled night, 2026-09-17 00:00 UTC** (run `269b0751`, partition
  09-16): `fx_rate` `rows=0, outside_window=152`. The raw body was **68,794 bytes, the same size as
  the one fetched at 12:55 the day before**. Re-materialising the same partition at 10:42 (`aefcnkxt`)
  received a 66,640-byte body and wrote 41 rates.
- **Metadata cannot find the empty days.** A `single_run` range attaches the RUN's metadata to every
  partition in it: the retry's four partitions all read `rows=82`, including 09-13, a Sunday with no
  rates. Count rows per `as_of` in `market.fx_rate` instead.
- **Not affected:** price, index and history lanes that go through openbb, which bypasses http-cache.
  Weekly and whole-file registries get a body one period old, which is tolerable but is the same
  shape.
- Rules this bears on: failed ≠ empty (a stale body read as "the provider had nothing"), and a
  materialized partition is a completeness claim.

## What to do

1. Decide with the user — options to present:
   - **A.** A dedicated location for `/yahoo/v8/finance/chart` with no `updating` in
     `proxy_cache_use_stale` and `proxy_cache_background_update off`, so an expired entry is
     refetched synchronously. Keeps the cache; loses nothing a daily partition needs.
   - **B.** The spot fetch sends a header that nginx maps to `proxy_cache_bypass` for
     "must be fresh" requests. Per-caller, but a third wiring point to keep in sync.
   - **C.** A stage-2 guard, wanted with A or B: if a body's `regularMarketTime` predates the
     partition's window end and no point falls inside the window, **fail** the partition instead of
     materializing it empty — a stale answer is not an answer.
2. Implement it: nginx changes ship in muffin-deployment by deploy (the config hash restarts
   http-cache); C ships in muffin-ingest by roll. Add a test that feeds stage 2 a stale body.
3. Re-materialise every `raw_fx_spot` / `fx_rate` partition whose trading day has no rows in
   `market.fx_rate`. Find them with a count per `as_of`, not from metadata, which is run-level for a
   range. Check other daily lanes through the cache for the same signature.

## Done when

A daily FX spot run writes the partition's own day's rates with no human fetch in between, and a
stale body fails its partition instead of materializing it empty.
