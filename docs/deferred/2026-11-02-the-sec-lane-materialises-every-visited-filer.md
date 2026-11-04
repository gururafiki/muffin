# The SEC lane materialises every filer it visits

Created 2026-11-02 · Planned in [the SEC spec](../specs/2026-10-24-sec-family.md) (*Deferred
notes*, *Risks*) · Status: **Decided 2026-11-04 (the user):** option 1, skippable outputs, after checking Dagster 1.13.22. **The check came back against it (2026-11-04, below); back to the user before anything is built.**

## Checked 2026-11-04: a skippable output skips a whole chunk, never a filer

Dagster 1.13.22 records a yielded output's materializations in `_get_output_asset_events`
(`_core/execution/plan/execute_step.py`). It emits one event for **every** key in
`output_context.asset_partition_keys`, which is the run's whole range. A `skippable=True` spec can
therefore be left out for all 50 filers of a chunk or for none. Nothing in the output path names a
subset of the range.

Measured over the 2026-11-04 weekday tick (75 runs × 7 outputs = 525 output-runs), an output
produced nothing for its whole chunk in **12** of them: `raw_sec_companyfacts` 6, each of the six
others 1. Skipping those saves ~600 of the ~26,000 materializations a day, **about 2%**. Option 1 as
worded does not deliver what it was chosen for.

What would:

1. **Skippable outputs plus per-filer events.** The lane writes its own files and yields
   `AssetMaterialization(partition=k)` for each filer it wrote, leaving the output unyielded. A
   not-due filer then writes nothing. It replaces the I/O manager's write path for seven specs, and
   the planned events stay (Dagster plans the whole range), so it halves the growth at most.
2. **Prune** materializations beyond the newest per (asset, partition) (option 2 below).
3. **Accept it** and chart `event_logs` against a threshold (option 3).

## Why

`sec_filers_due` requests one run per 50-filer chunk that holds a due filer, because Dagster
batches only contiguous partition keys (CLAUDE.md, "Dagster batches only contiguous partition
keys"). Every filer in the chunk is visited, and each visited partition writes an
`ASSET_MATERIALIZATION` for each of the seven specs (`raw_sec_companyfacts`, `raw_sec_submissions`,
`sec_filing`, `filer_profile`, `security_former_name`, `sec_fiscal_calendar`, `sec_statement`),
plus an `ASSET_MATERIALIZATION_PLANNED` each, even when nothing was due and the I/O manager
skipped the write (`Unchanged`).

Measured 2026-11-02:
- The first tick asked 115 filers and visited 3,026: **61 runs, 0 SEC requests**, and about
  21,000 materializations plus as many planned events.
- Over the last 24 hours `event_logs` gained 54,940 materializations (average row 1,214 bytes) and
  54,944 planned events (982 bytes); each SEC spec accounts for 4,152 of them.
- `event_logs` holds 2,239,750 rows, 2,317 MB of heap, 3,231 MB with indexes.

At ~60 runs a day the floor alone adds ~21,000 of each, ~45 MB a day before indexes, ~16 GB a
year. CLAUDE.md's earlier estimate for the whole instance was ~11 GB a year, revisited past ~20 GB.

**Measured on the first two weekdays (11-03, 11-04): it is the whole grid, every weekday.** The
filers one day's index names fall in every 50-filer chunk, so each weekday tick launched all **75
runs** and visited all 3,726 filers: ~26,000 materializations plus as many planned events a day,
and ~65 minutes of `sec` and `sql` (11:08-12:15). Of those 3,726, 289-415 were asked for their
submissions and 79-185 for company facts. So the estimate above is a floor: closer to ~55 MB a day
before indexes, ~20 GB a year from this lane alone. Option 1 below removes most of it, because a
visited filer that was not asked writes nothing.

**The floor also fetches nothing for a month.** The grid collected every filer between 10-30 and
11-02, so until ~12-01 no stored answer is past 30 days (submissions) or 90 (company facts), and
each floor visit is `not_due`. The ~60 runs hold `sec` and then `sql` for ~40 minutes a day for
nothing. From December the floor becomes the refresh itself, spread over the month. Filers named in
a new index day are asked at once either way.

## Options

1. **Skippable outputs**: declare the seven specs `skippable=True` (to check in Dagster 1.13.22) and yield only what a filer
   produced. A not-due filer then writes no materialization. The planned events stay, since Dagster
   plans every partition in a run's range, so this halves the growth. Partition status is unaffected
   for filers already materialised, and `sec_filers_due` reads "never collected" from it.
2. **Prune** materialization events beyond the newest per (asset, partition), the rule CLAUDE.md
   prefers over an age cut because status needs exactly one row per partition.
3. **Accept it**: `/mnt/data` is at 64% after the volume cleanup, and the growth is visible on the
   Postgres panels.

Recommended: 1 now, 2 if the table passes ~20 GB.

## Done when

The user has chosen, and a day of `sec_filers_due` with no due filer adds no materialization (for
option 1), or `event_logs` growth is charted against a threshold (for 3).

## Context

- `muffin-ingest/projects/muffin-ingest/src/muffin_ingest_dagster/defs/sec/automation.py`
  (`filers_due`, `FILERS_PER_RUN`).
- The SEC spec's *Step 7b*; `todos.md`, Phase 5.
