# The coverage sample reaches its 120-second bound

Created 2026-11-07, from reading `coverage_current` after the insider history · Status: **decided
2026-11-08 (the user): options 1 and 2, built in muffin-deployment#498.** Open until a week of runs
finishes well under the new bound. Read 2026-11-09 from `cron.job_run_details`: 74.1 s (11-08
17:23) and 102.3 s (11-09 05:23) against 300 s. Read 2026-11-11: six runs since, all succeeded.
The 05:23 run, inside the company lane's window, took 102.3, 121.0 and 130.9 s on 11-09, 11-10
and 11-11; the 17:23 run took 119.3, 76.7 and 98.1 s. Close after 2026-11-15 if it stays there;
the 05:23 figure rose 28 s in two days, so read the trend, not only the maximum.

## Why

`market.sample_coverage()` runs from pg_cron (`muffin-coverage`, 05:23 and 17:23 UTC) as
`set statement_timeout = '120s'; select market.sample_coverage()`, since legacy migration
20261003170000 moved it off the 8-second PostgREST ceiling. It reads `market.coverage_current`
whole. Its durations, from `cron.job_run_details`:

| Run | Seconds |
|---|---|
| 11-05 05:23 | 84 |
| 11-05 17:23 | 43 |
| 11-06 05:23 | 72 |
| 11-06 17:23 | 71 |
| 11-07 05:23 | **119** |
| 11-07 17:23 | 76 |
| 11-08 05:23 | **120, cancelled** (`canceling statement due to statement timeout`) |

On 10-03 the whole sample took 8.6 s cold. It now runs close to its bound, and nothing alerts on the
duration. "An observability sample has stopped arriving" fires only once a sample fails, and every
failure loses that half-day's coverage point.

Measured on 11-07:
- `select count(*) from market.coverage_current` took 25 s at 14:35, 28-42 s twice, and 67.7 s at
  19:04 (the node was otherwise quiet).
- The largest node in the plan is the index-only scan of `insider_trade` behind
  `select distinct security_id from market.insider_trade`, with heap fetches: 33 s summed over three
  parallel workers at 14:35. Next come two CTE scans (12 s and 11 s), a sequential scan of
  `security_metric` (7.9 M rows, 7 s), `security_filing` (5 s) and `security_statement` (5 s).
- **The insider history made the first one much worse.** `insider_trade` went from 0.75 M to 5.41 M
  rows on 11-07. 926,730 rows were inserted after the 14:21 autovacuum, so they have no visibility-map
  bits, and an index-only scan must read the heap for each. Autovacuum's insert trigger is
  1,000 + 0.2 × reltuples, about 1.08 M rows here. The daily Form 4 lane adds about 1,000-2,000 rows,
  so the next autovacuum is months away.
- **It was near the bound before that.** The 05:23 run took 119 s before any of the day's insider
  batches. The grid's tables (`security_filing` 1.17 M rows, `security_statement`, `security_metric`)
  grew through October.

## Options

1. **Raise the bound to 300 s.** One migration re-schedules `muffin-coverage`. The sample is
   observability, read by Grafana from `coverage_sample`, not by the app, so a longer statement costs
   only CPU at 05:23 and 17:23. It removes the limit and leaves the trend.
2. **Let autovacuum keep `insider_trade` visible:** `alter table market.insider_trade set
   (autovacuum_vacuum_insert_scale_factor = 0.01)`. Insert-mostly tables are the case this setting
   exists for. It also helps every other index-only read of the table. On its own it removes the
   largest node, not the trend.
3. **Read cheaper sources in `coverage_current`.** For example, take "has insider trades" from a
   per-security fact that is already maintained, rather than a distinct scan of 5.4 M rows (and
   likewise for `security_metric`, `security_filing` and `security_statement`). This is a schema
   change to a view with a guard (`check_dashboards_can_render.py` parses its columns).
4. **Alert on the duration**, from `cron.job_run_details`, at, say, 80% of the bound.

Recommended: 1 and 2 now, in one migration. Option 3 when coverage is next reworked (Phase 8, derived
and serving). Option 4 if the trend continues after that.

## After the change, 2026-11-08

#498 deployed at ~13:05 UTC. Autovacuum processed `insider_trade` at 13:07:33, so 0 rows were
inserted since the last vacuum. `explain analyze select count(*) from market.coverage_current`:

| | 11-07 14:35 | 11-08, during the grid re-parse | 11-08, quiet |
|---|---|---|---|
| whole read | 24.3 s | 52.6 s | **22.4 s** |
| `insider_trade` index-only scan (summed over 3 workers) | 33.2 s | 41.8 s | **17.6 s** |
| its heap fetches | 820,262 | 23 | 23 |

The reading taken during the re-parse made every node slower, `price_bar` included, so it cannot
show the change. Quiet, the scan halved. It still reads 5.5 M entries of a 121 MB index to find the
distinct securities, which is option 3's work. The sample's own duration is read from
`cron.job_run_details` at the next 05:23 and 17:23 runs.

## Done when

The user has chosen. The 05:23 and 17:23 runs then finish well under their bound for a week, read
from `cron.job_run_details`.

## Context

- `muffin-deployment/stack/supabase/schemas/0110-coverage_current.sql`;
  `stack/supabase/migrations/20261003170000_the_coverage_and_quality_samples_run_from_pg_cron.sql`.
- `todos.md`, Phase 5 step 8 (the 11-07 check-in); the SEC spec's *Step 8: the insider data sets'
  history, done*.
