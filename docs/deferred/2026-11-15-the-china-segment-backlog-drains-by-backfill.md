# The China segment backlog drains by backfill

Created 2026-11-15 · Planned in [the Phase 6 spec](../specs/2026-11-09-segments-and-regulators.md),
step 4 · Status: open until the queue is drained

## Why

The edge read one annual report per run, so on 2026-11-09 it had parsed 1,106 of 32,275 CNINFO
full reports and needed ~650 days to finish. The Dagster lane reads a filer's due reports per run,
but the queue is far larger than the 30-day floor visits. The floor only adds new filings; the
history drains by operator backfills, as the SEC re-read did.

The deployment migration of step 4 also puts the 1,383 reports the edge read back behind the
parser, because the reader is fixed rather than ported (the user's decision of 2026-11-15). So
every China segment row ends up written by one reader.

## Context

- `raw_cninfo_filings` + `cninfo_segment` over `grid:cninfo_filer` (~2,173 filers), pool `cninfo`
  then `sql`. A run is bounded by `budget_seconds` (900), `budget_bytes` (300 MB of reports, median
  ~4 MB, so ~70 a run) and `pace_seconds` (0.5).
- Raw PDFs are pruned 30 days after reading, or sooner once raw holds 5 GB of them (decision 4),
  so the drain does not grow the disk with the backlog.
- Each report is parsed in a child process: ~0.6 s median, 40–60 MB peak on the 15 largest
  (measured 2026-11-15).

## What to do

1. After the roll and the deploy, launch a backfill of `raw_cninfo_filings,cninfo_segment` over
   `grid:cninfo_filer` at `--priority -1`, outside the 00:00 and 03:00 windows.
2. Read each pass's counters: stage 1's `reports_named`, `report_answered`, `report_unasked`,
   `report_too_large`; stage 2's `read`, `no_table`, `unreadable`, `rows`, `retracted`. Check the
   raw size against the 5 GB cap (`cninfo_reports_within_cap`). Launch the next pass while
   `report_unasked` is not 0.
3. Record each pass in this note.

## Done when

`every_cninfo_report_was_read` reports no report behind the parser, and the passes are recorded
here.
