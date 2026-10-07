# Every night rewrites ~12 million price bars that did not change

**Status: done 2026-10-07.** The first night on the guard changed 98,226 rows where it used to
rewrite ~11 M; see "Measured, the first night" below.

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

## Decision (2026-10-06)

**Option 1: skip unchanged rows in `writers.upsert`**, with a `changed` count beside `written`.

## As built (2026-10-06)

muffin-ingest#101, rolled 2026-10-06 21:12 UTC.

- `upsert` writes `insert into … as stored_row … on conflict … do update set … where
  (stored_row.a, …) is distinct from (excluded.a, …)`.
- `WriteResult.changed` is the statement's rowcount, i.e. inserted plus updated, summed over chunks.
  It is `None` when the driver cannot count. The Postgres I/O manager puts it in metadata as
  `changed` beside `rows`, with -1 for unknown.
- Proven on a throwaway Postgres on the node:
  - an identical second write of 30,000 rows changed **0** row versions, where the old writer
    changed all 30,000;
  - twelve real changes reported `changed` 12;
  - null to value and value to null each count as a change;
  - a single updatable column works (`(stored_row.c) is distinct from (excluded.c)`).
- Five mutations caught.

Baseline for the first night on the new writer, `market.price_bar` summed over its partitions at
2026-10-06 21:13 UTC:

| `n_tup_ins` | `n_tup_upd` | `n_tup_hot_upd` | `n_dead_tup` | `n_live_tup` |
|---|---|---|---|---|
| 59,531,165 | 202,647,006 | 8,038,818 | 3,128,189 | 58,769,434 |

## Measured, the first night (2026-10-07)

All 100 `nightly_prices` runs succeeded, 00:00-01:32 UTC, and so did `daily_fx`, `daily_indices`,
`security_return` and the hourly heartbeats. Stage 1 sums: `requested` 2,500 = answered 2,446 +
empty 1 + dead 2 + not askable 51, `throttled` 0, `unasked` 0, 323 calls, 121,990 rows fetched.

The `price_bar_history` metadata, one materialisation per run (every partition of a run carries the
run's sums):

| Night (UTC) | Rows sent (`rows`) | Rows changed (`changed`) | Step time, summed | Runs' time, summed | Last run ended |
|---|---|---|---|---|---|
| 10-06 00:00, old writer | 11,624,428 | not counted | 1,558 s | 5,060 s | 01:38 |
| 10-07 00:00, guard | 11,110,456 | **98,226** (0.88%) | **1,352 s** | 4,755 s | 01:32 |

No run reported `changed` as -1. `market.price_bar`, summed over its partitions at 05:52 UTC
against the baseline above:

| | Baseline, 10-06 21:13 | 10-07 05:52 | Over the night |
|---|---|---|---|
| `n_tup_ins` | 59,531,165 | 59,580,792 | +49,627 |
| `n_tup_upd` | 202,647,006 | 202,695,605 | **+48,599** |
| `n_tup_hot_upd` | 8,038,818 | 8,043,505 | +4,687 |
| `n_dead_tup` | 3,128,189 | 3,174,072 | +45,883 |

- **`changed` is exact.** 98,226 is the night's inserts plus updates (49,627 + 48,599). Only this
  lane writes `price_bar`, so the identity checks the counter and shows nothing else wrote.
- **The write amplification is gone.** About 48,600 updates where every existing row it sent used to
  be one (~11.5 M). No autovacuum has run on any `price_bar` partition since 10-06 01:38; before,
  it swept every partition every night.
- **The step time fell only 13%**, which option 1 predicted. Stage 2 still reads, normalises and
  sends all 11.1 M rows, and Postgres still probes the primary key for each. The guard removes the
  heap write, the index entries and the WAL, not the reading. Publishing only the run's own rows is
  option 2 here (option 2 of the
  [2026-10-04 note](2026-10-04-the-price-history-lane-rewrites-every-bar-nightly.md) too), which was
  not chosen.

**`price_bar` held 1,189 bars for 10-06, not the ~11.6k the check-in expected, and that is
correct.** A day fills over the rotation (~2,500 securities a night), not in one night. A census of
the night's 2,500 raw partitions for 10-06:

| | Securities |
|---|---|
| A finite close, published | 1,189 (exactly the table's count) |
| The row, with a NaN close | 420 |
| No row; newest raw day 09-30 (China's National Day holiday: 783, plus one Tokyo line) | 784 |
| No row; newest raw day 10-05 | 45 |
| No row; newest raw day 10-01 or older (stale lines) | 8 |
| Not asked (no askable symbol, dead or empty) | 54 |

So 465 of the 1,654 securities whose market traded on 10-06 (28%) came back without a close at
00:00-01:30 UTC. Their companies are in 28 countries, not only the US: 146 US, 96 India, 45 Turkey,
34 UK and 25 Sweden among them. Asked again at 07:27 UTC, Yahoo had the US close (AARD 5.04), while
ANUP.NS, AGESA.IS, EMBRAC-B.ST and AO.L still had 10-06 entirely null, with their 10-07 session
trading. The next visit's 7-day re-read covers both kinds: the 09-22 holes measured in Yahoo on 09-24
(KO, CZR, EMBC, PRAA) all hold a 09-22 bar now.

## Options (as presented)

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
