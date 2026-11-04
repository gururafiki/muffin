# The segment queues time out on the grid's filings

Recorded 2026-11-02, from the firing `muffin-resource-stalled` alert. **Decided 2026-11-04 (the user):** option 1, retire `security-kr-segments` and `security-in-segments` until Phase 6. **Built in muffin-deployment#489** (deployed 2026-11-04 22:15 UTC; both answer 410, their jobs are gone, and `muffin-resource-stalled` stopped firing): both answer 410 and their pg_cron jobs are removed; the queue views and their three tests stay for Phase 6.

## Why

Two edge resources have failed every run since 2026-11-01, at the PostgREST role's 8 s timeout:

| Resource | Last ok | Since | Error |
|---|---|---|---|
| `security-kr-segments` | 11-01 13:19 | 11-01 13:24, 239 runs | `pending_kr_segments read failed: canceling statement due to statement timeout` |
| `security-in-segments` | 11-01 14:27 | 11-01 14:32, 207 runs | `pending_in_segments read failed: …statement timeout` |
| `security-segments` (SEC) | works | 22 of ~280 runs fail | `pending_segments read failed: …statement timeout` |

`security-cn-segments` is unaffected (28 of 28 ok).

**All three queues are empty.** Measured 2026-11-02 as `postgres`: `pending_kr_segments` 0 rows in
19.5 s, `pending_in_segments` 0 rows in 13.7 s, `pending_segments` 0 rows in 2.5 s. No segment work
is waiting. The two resources fail because they cannot learn there is nothing to do, and each run
holds the database for its 8 s.

## Cause

The Phase 5 CIK grid took `security_filing` from about 250,000 rows to 1,175,000
(`sec-submissions` 1,062,327; the table is 519 MB with indexes). The Korean queue reads only the
6,518 DART filings, but the planner now estimates 15 of them. It therefore joins
`fund_holding_current` by nested loop:
- `Rows Removed by Join Filter: 260,012,566`, which is 6,518 filings × 39,893 holdings;
- a hash join would read the holdings once.

This is the per-row join shape fixed for `sector_constituents` in muffin-deployment#391. The view
did not change; the table's growth moved the estimate.

The failures began at 13:24 on 11-01, as the grid's first 500-filer batch (13:00) was writing.

## Options

Segments move to Dagster in Phase 6. The user's rule (2026-10-25) is to retire an edge resource or fix
it in its Dagster lane, never to patch the edge.

1. **Retire `security-kr-segments` and `security-in-segments` until Phase 6** (recommended): both
   queues are empty, and new filings arrive mostly at annual-report time (Korea in March, India
   May to September). `kr-filings` and `in-filings` keep discovering filings, which wait for the
   Phase 6 lane. Leave `security-segments` (SEC) running, since it succeeds 92% of the time, and
   decide again if it starts failing persistently after the grid's last batches.
2. **Fix the three views in one migration**, aggregating the fund weight per security once in a
   materialized CTE and hash-joining it (the #391 fix). Small, but edge work that Phase 6 discards.
3. **Leave them**, with the alert firing until Phase 6. Not recommended: a gate that stays red hides
   the next true positive.

## Done when

The user picks an option, it is built, and `muffin-resource-stalled` reads 0 for these resources.

## Context

- `muffin-deployment/stack/supabase/schemas/0086-pending_kr_segments.sql`, `0083-pending_in_segments.sql`,
  `0089-pending_segments.sql`.
- The SEC spec's *Step 8* (the grid); `todos.md`, Phase 5.
