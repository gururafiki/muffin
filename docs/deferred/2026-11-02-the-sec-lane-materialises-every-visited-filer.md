# The SEC lane materialises every filer it visits

Created 2026-11-02 · Planned in [the SEC spec](../specs/2026-10-24-sec-family.md) (*Deferred
notes*, *Risks*) · Status: open, **the user decides**; not urgent

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
