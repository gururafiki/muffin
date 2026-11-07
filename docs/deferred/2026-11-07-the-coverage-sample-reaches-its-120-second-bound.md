# The coverage sample reaches its 120-second bound

Created 2026-11-07, from reading `coverage_current` after the insider history · Status: open; options
for the user

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

## Done when

The user has chosen. The 05:23 and 17:23 runs then finish well under their bound for a week, read
from `cron.job_run_details`.

## Context

- `muffin-deployment/stack/supabase/schemas/0110-coverage_current.sql`;
  `stack/supabase/migrations/20261003170000_the_coverage_and_quality_samples_run_from_pg_cron.sql`.
- `todos.md`, Phase 5 step 8 (the 11-07 check-in); the SEC spec's *Step 8: the insider data sets'
  history, done*.
