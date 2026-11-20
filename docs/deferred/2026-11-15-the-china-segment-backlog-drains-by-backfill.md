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

4. Once `every_cninfo_report_was_read` is clean, start `cninfo_filers_floor`. It counts a filer
   never collected as due, so started before the drain, its first tick would ask the whole grid at
   priority 0, ahead of the SEC wave and the company day.

## Passes

| Pass | Backfill | Launched | Runs | Reports read | No table | Rows | Unasked |
|---|---|---|---|---|---|---|---|
| live subset | `ixpuonsh` | 11-16 07:16 | 5 | 56 | 20 | 546 | 0 |
| 1 | `murkjqch` | 11-16 10:19 | 11 of 87, then cancelled | 714 | 643 | 1,232 | 2,773 |

Pass 1 shared the `sql` pool with SEC re-read pass 6 (`utsvbnmw`), both at priority −1. The DART roll
at 10:29 interrupted one pass-1 run, `39fee9a6`, which was re-executed as `d207708d`.

**Pass 1 was cancelled at 11:35, after 11 runs (275 filers, 794 reports fetched, 3.34 GB, 37 over
the 12 MB gate)**, because its counters showed that **0 of 562 Shenzhen reports gave a row** against
61 of 163 Shanghai ones: Shenzhen prints no mandated heading, only `营业收入构成`. Draining on would
have marked every Shenzhen report read with nothing in it. The user decided (2026-11-16) to read
that table first and then drain China once
([note](2026-11-16-a-fifth-of-china-s-reports-state-their-split-as-revenue-composition.md)).
The 757 reports already marked read without a row are put back behind the parser by
muffin-deployment's migration 20261116150000, deployed after the reader rolls.

## Done when

`every_cninfo_report_was_read` reports no report behind the parser, and the passes are recorded
here.
