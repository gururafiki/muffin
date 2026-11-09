# Segment parsing is ported as-is, and widened later

Created 2026-11-09 · Planned in [the Phase 6 spec](../specs/2026-11-09-segments-and-regulators.md)
(decision 2) · Status: open, after Phase 6's port

## Why

The user decided on 2026-11-09 that Phase 6 ports the four segment parsers as they are, then
drains: same output, with throughput and reliability as the gain. Two known gaps in what is parsed
were therefore left for later, each to be measured first.

1. **SEC amendments and transition reports were never asked.** `filing_form.carries_segments` is
   true on exactly 10-K, 10-Q, 20-F and 40-F. Measured 2026-11-02, XBRL filings never parsed:
   10-K/A 1,717, 10-Q/A 1,516, 20-F/A 211, 40-F/A 31, 10-KT 55, 10-QT 19. Whether they carry a
   segment note is unmeasured. An amendment may restate the segments, and should then supersede the
   original's rows by accession, or may only add an exhibit
   ([note](2026-11-02-the-segment-queue-reads-the-regulator.md), item 3).
2. **CNINFO publishes the same facts under a second heading.** The parser reads the mandated
   `主营业务分行业/分产品/分地区情况` tables. CATL publishes them under `营业收入构成`, with
   percentage columns instead of cost, which is not read (CLAUDE.md, "PDF is a statement about the
   transport").

## What to do

1. Sample 20 amendments and 10 transition reports from the Dagster SEC lane's raw instances. Count
   the ones whose segment facts differ from their original's, and decide `carries_segments` per
   form from that count.
2. Count CNINFO reports the parser reads with no table found (`noTable`) once the backlog has
   drained. Read a sample for the `营业收入构成` shape before adding it to `CN_TABLES`.
3. Either change bumps `segment_parser.version`, which re-fetches history as a paced backfill
   (Phase 5 decision 3).

## Done when

Each form's `carries_segments` is set from a measurement, and the CNINFO `noTable` count is
explained by heading.

## Context

- `muffin-deployment/stack/supabase/functions/market-refresh/cn-pdf.ts` (`CN_TABLES`) until Phase 6
  ports it.
- `todos.md`, Phase 6.
