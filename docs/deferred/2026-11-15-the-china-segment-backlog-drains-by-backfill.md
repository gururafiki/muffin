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
| 2 | `ypvryzgo` | 11-20 15:45 | 87 of 87 (to 22:16) | 7,665 | 809 | 99,054 | 16,796 |
| 3 | `hqrqmzpi` | 11-21 10:27 | running | | | | |

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

**Pass 2, 2026-11-20.** The composition reader passed its gate and rolled at 15:29
(muffin-ingest#183); #520 deployed at 15:44 and re-queued the 757, leaving **2,001 CNINFO reports
behind the parser** before the pass started. Pass 2 runs both assets over the whole grid at
priority −1 with a 30-minute run limit, so the night's lanes outrank it.

Pass 2 read with the composition reader: **809 of 7,665 reports read had no table (10.6%), against
pass 1's 643 of 714**. 2,173 searches answered; 24,661 reports named, 6,926 fetched, 777 already
held, 162 over the 12 MB gate; 99,054 rows written (95,076 placed, 4,240 unplaced), 1,715
retracted, 262 kept by a newer filing, 0 failed, 0 currency unknown. The re-queue drained:
`every_cninfo_report_was_read` read `behind_the_parser` 1 at the end. It fetched 26.3 GB and
retention held the PDFs at the 5 GB cap throughout (`cninfo_reports_within_cap` 4.7–5.2 GB).
16,796 reports are left unasked because a run's budget is in bytes; at ~7,000 a pass, about three
more passes.

**Pass 3 `hqrqmzpi`, 2026-11-21 10:27 to ~20:50.** 87 of 88 runs SUCCESS. The 12:28 roll killed
one, which was re-executed as `1ddd7cc5` (SUCCESS). 2,173 searches answered; 16,796 reports named,
5,556 fetched and read, 150 over the 12 MB gate, 1 transport. 641 of the 5,556 read had no table
(11.5%), 72,551 rows written (69,982 placed, 4,221 unplaced), 1,652 kept by a newer filing,
0 failed, 0 currency unknown. **11,089 reports were left unasked** by the byte budget (25.6 GB
fetched). Retention held the PDFs at 5.15 GB of the 5 GiB cap (1,650 held). `/mnt/data` was at
69% with 40 GB free.

**Pass 4 `rocvlyrc`, 2026-11-21 20:55 to 11-22 07:51.** 86 of 88 runs succeeded. The 22:05 roll
killed one, whose re-execution `84d25752` is queued behind the earnings backfills at the same
priority. 2,148 searches answered; 10,881 reports named, 5,251 fetched and read, 188 over the
12 MB gate, 0 refused, 0 transport. 737 of the 5,251 read had no table (14.0%). 68,173 rows were
written (65,610 placed, 5,152 unplaced), 2,589 kept by a newer filing, 0 failed, 0 currency
unknown. **5,442 reports were left unasked** by the byte budget (22.2 GB fetched). The raw store
held 4.1 GB at 11-22 10:58; `/mnt/data` was at 69% with 40 GB free.

**Pass 5 `zrndydmg`, 2026-11-22 11:00 to 19:58** (queued behind the SEC wave until 15:12). 87 of 88
runs succeeded; the failed one was re-executed. 2,177 searches answered, 1 refused, 20 unasked;
5,638 reports named, 4,633 fetched, 44 over the gate, **885 unasked**. Stage 2 read 4,627, of which
1,221 had no table; 47,407 rows written (47,546 placed, 3,036 unplaced).

**Pass 6 `pjbieqdr`, launched 2026-11-22 ~22:45 UTC**, same assets, priority −1, on the reader of
muffin-ingest#196. Beside the drain's remainder (8,340 full reports never read) it reads the 5,388
reports muffin-deployment#537 re-queued: the 22 fused-name reports, China Eastern FY2020, and every
full report read into no rows, which includes pass 5's 1,221.

## Done when

`every_cninfo_report_was_read` reports no report behind the parser, and the passes are recorded
here.
