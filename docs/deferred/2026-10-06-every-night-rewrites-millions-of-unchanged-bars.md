# Every night rewrites ~12 million price bars that did not change

## Why

`writers.upsert` updates a conflicting row unconditionally (`on conflict … do update set c =
excluded.c`). Stage 2 of the price lane publishes each partition from its whole raw file, so every
night it upserts every bar of the 2,500 securities it swept. Measured on the 2026-10-06 night:

| | |
|---|---|
| Rows upserted into `market.price_bar` | 11,624,428 |
| Rows actually new | ~167,000 fetched, plus 2,606 retracted |
| `price_bar_history` step time | 1,558 s, a third of the night's 5,060 s |

Measured on `price_bar` since the statistics reset on 2026-09-10:

| | Rows |
|---|---|
| Updates | 202.6 M (only 8.0 M HOT) |
| Inserts | 59.5 M |
| Dead tuples now | 3.1 M |

That is 1,962 autovacuums: each live row rewritten ~3.4 times in 26 days, almost always to identical
values. The previous nights were the same (13.8 M and 12.5 M rows on 10-04 and 10-05), so this
predates #99.

A non-HOT update writes a new heap tuple plus an entry in each index, and WAL for both. On one
Always-Free node that work competes with the app's reads every night.

## Context

- `market.price_bar` is (security_id, trade_date, close, volume, currency_code, source_code). It has
  no timestamp column and no trigger, so an unchanged bar compares equal and can be skipped
  cleanly.
- No `market` or `ingest` table has a `json`, `xml` or geometric column (checked 2026-10-06). So
  `is distinct from` works on every table the writer touches.
- The Postgres I/O manager and the explicit callers (`discovery`, `symbology`, `prices`) all go
  through `writers.upsert`.

## Options (decision for the user)

1. **Skip unchanged rows in `writers.upsert`** (recommended). `insert into … as t … on conflict … do
   update set … where (t.a, t.b, …) is distinct from (excluded.a, excluded.b, …)`, plus a
   `changed` count from the statement's rowcount beside `written`.
   - Every lane gains.
   - A trigger such as `security_provider_symbol_clears_caches` then fires only when the symbol
     actually changes, which is what it means.
   - A table whose rows carry a per-run timestamp (`last_seen_at`) still updates, as it should.
2. **Stage 2 writes only what the night re-read** (the new rows and the 7-day re-read window), and
   the whole file only when it was replaced. It saves the reads too, but it couples stage 2 to how
   stage 1 fetched, which the two-stage design keeps apart.
3. **Leave it.** The night finishes by ~01:40 either way.

## What to do

1. Decide.
2. If 1: the guard and the `changed` count, with a test that an identical second write changes
   nothing, and a mutation that drops the `where`.
3. Measure one night after: `price_bar_history` step time, `n_tup_upd` on `price_bar`, and `changed`
   against `written`.

## Done when

A night's stage 2 changes only the rows that changed, and the step time and update count fall
accordingly.
