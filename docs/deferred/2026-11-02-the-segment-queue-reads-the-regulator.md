# The segment queue reads the regulator

Created 2026-11-02 · Planned in [the SEC spec](../specs/2026-10-24-sec-family.md) (*Deferred
notes*) · **For Phase 6** (segments on Dagster) · Status: open; **planned 2026-11-09** in
[the Phase 6 spec](../specs/2026-11-09-segments-and-regulators.md). Items 1–2 are handled by its
design (per-filer queues keyed on the regulator); item 3 moved to
[the widening note](2026-11-09-segment-parsing-is-ported-as-is-and-widened-later.md) (decision 2)

## Why

Three things Phase 5 changed under the segment parsers, which stay on the edge until Phase 6:

1. **`security_filing` names its regulator.** Phase 5 added `disclosure_source_code` (step 2a,
   written by the filer lane since step 4). `pending_segments` still finds SEC filings through
   `filing_form.source_code`, because `security_filing.source_code` names the WRITER
   (`sec-submissions`, `sec-filings`), and a queue scoped on it to `sec` matches nothing (CLAUDE.md,
   "the same column name can hold two vocabularies"). The column now says it directly.
2. **The table is five times larger.** The CIK grid took `security_filing` from ~250,000 rows to
   1,226,499 (2026-11-02: `sec-submissions` 1,146,727, `sec-filings` 10,880, `cninfo` 55,482,
   `nse` 6,892, `dart` 6,518). The Korean and Indian queues already time out on it, though all
   three are empty
   ([note](2026-11-02-the-segment-queues-time-out-on-the-grid-s-filings.md)).
3. **Amendments and transition reports are in the table.** `filing_form.carries_segments` is true
   on exactly 10-K, 10-Q, 20-F and 40-F, so these were never asked. Measured 2026-11-02, SEC
   filings with XBRL and no segment parse:

   | Form | XBRL filings | Never parsed |
   |---|---|---|
   | 10-K / 10-Q / 20-F / 40-F | 35,020 / 108,405 / 2,883 / 719 | 0 |
   | 10-K/A | 1,717 | 1,717 |
   | 10-Q/A | 1,516 | 1,516 |
   | 20-F/A / 40-F/A | 211 / 31 | 211 / 31 |
   | 10-KT / 10-QT | 55 / 19 | 55 / 19 |

   Whether they carry a segment note is unmeasured. An amendment may restate the segments (then it
   should supersede the original's rows by accession) or only add an exhibit.

## What to do, in Phase 6's planning

- Key the Dagster segment queue on `disclosure_source_code` and on the `sec_filer` partitions the
  filer lane already keeps, rather than a view over the whole filing table.
- Measure 20 amendments and 10 transition reports for segment facts before setting
  `carries_segments` on them.
- Any queue that stays a view is sized for 1.2 M filings: aggregate fund weight once and hash-join
  (the `sector_constituents` fix, muffin-deployment#391).

## Done when

Phase 6's spec records each of the three, and the segment lane's queue reads under a second as
`ingest_rw` at the table's size.

## Context

- `muffin-deployment/stack/supabase/schemas/0089-pending_segments.sql`.
- The SEC spec's *Coexistence with the edge segments handler*.
- `todos.md`, Phases 6-8.
