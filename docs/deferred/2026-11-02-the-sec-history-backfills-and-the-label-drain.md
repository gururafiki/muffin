# The SEC history backfills and the label drain

Created 2026-11-02 · Phase 5 step 8, which the plan says not to wait on (implementation rule 8:
start the backfill, do not wait for the drain) · Status: open; the backfills run in the next
11:00-20:00 UTC windows

## What step 8 has done

- **The CIK grid**: 3,726 of 3,726 filers collected (10-31..11-02), re-parsed twice under the
  calendar fixes, every derivation after it drained (spec *Step 8*).
- **Form 4 days 2026-08-01..10-26**: 89 runs, then the eight short days re-asked; the daily index
  has kept up since (todos, Phase 5 step 7).

## What is left

1. **The insider data sets, every quarter since 2006** (decision 10). SEC's quarterly zips,
   ~82 requests, measured at ~8 M rows over all quarters (spec *Step 3*). It waited for disk:
   `/mnt/data` was at 78-80% until the 11-01 volume cleanup and is at 64% now, and the history
   adds ~5 GB (projected ~70%). `sec_insider_datasets` asks only the newest published quarter, so
   history is a backfill of `raw_sec_insider_dataset` then `sec_insider_trade`, quarters oldest
   first, reading `/mnt/data` by the disk alert's own measure between batches (stop at 76%).
2. **Form 4 days 2026-04-01..07-31**, the start of the `sec_days` grid. Days inside a quarter whose
   data set is already held are skipped by the lane, so run this after item 1: it then asks only
   what the data sets do not yet hold (2026q2 is not published as of 11-02).
3. **The Yahoo label drain** finishes with the company rotation, ~11-06
   ([note](2026-11-02-a-yahoo-calendar-is-observed-not-stated.md)).
4. **After the drain**, read COST's quarterly statement table: one column per quarter. On 10-25,
   SEC's and Yahoo's dates for one quarter sat 13-20 days apart and each showed twice.
5. **The edge's own `sec-xbrl` metrics** still unlabelled once the filer lane has derived every
   period are listed for step 11 (Vodafone's 55 quarterly balance-sheet metrics on 10-30).

## Done when

- `insider_quarters_are_held` passes from 2006q1 to the newest published quarter.
- `form4_days_are_complete` passes from 04-01, and the summary's 90-day counts are re-read.
- Yahoo statements unlabelled are only those the calendar note explains.
- COST's quarterly table shows one column per quarter.

## Context

- The SEC spec's *Step 8*; `todos.md`, Phase 5 steps 7-8 and 11.
- `muffin-ingest/projects/muffin-ingest/src/muffin_ingest_dagster/defs/sec/` (`raw.py`, `core.py`,
  `automation.py`).
