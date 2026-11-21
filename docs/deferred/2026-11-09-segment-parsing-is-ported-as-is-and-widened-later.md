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

## Measured 2026-11-21

**Item 1, amendments and transition reports.** 30 filings, picked by `md5(accession)` among XBRL
filings of securities that already have SEC segments, fetched through http-cache and parsed with
the current partitioner in a read-only container on the node (the probe is
`amend_probe.py` in that session's scratchpad; nothing written). A filing "carries segments" when
the parser places at least one fact:

| Form | XBRL, never asked | Sampled | Carry segments | Differ from what is stored | Add keys |
|---|---|---|---|---|---|
| 10-K/A | 1,727 | 8 | **0** | 0 | 0 |
| 40-F/A | 31 | 2 | **0** | 0 | 0 |
| 10-Q/A | 1,537 | 6 | 2 | 1 | 1 |
| 20-F/A | 211 | 4 | 2 | 1 | 2 |
| 10-KT | 55 | 6 | 4 | 2 | 1 |
| 10-QT | 19 | 4 | 1 | 1 | 1 |

- **Every 10-K/A sampled was a Part III or exhibit amendment.** Six of the eight instances are under
  40 KB: cover page and nothing else.
- **An amendment that carries segments is a full re-filing of the period:**
  - a 10-Q/A placed 84 facts, 72 equal to what is stored, and 12 correcting a sign the original
    filed wrong (`AlaskaCollectionMember` revenue −25,932,000 stored, +25,932,000 restated);
  - a 20-F/A for 2017 is the only XBRL for its year: 55 keys nothing else holds.
- **A transition report's odd-length period is dropped by the parser.** Only 84–98 and 358–372 days
  are typed. What a 10-KT places is its full-year and quarter comparatives, mostly equal to what is
  stored (47 of 47, 18 of 18, 92 of 93).
- **Ownership is already right for a restatement.** `segment_tables.file_filing` lets a newer filing
  keep its rows (`kept_by_newer`), so an amendment takes the period from its original, and a later
  report restating the period again takes it from the amendment.

**Item 2** moved to its own note,
[2026-11-16-a-fifth-of-china-s-reports-state-their-split-as-revenue-composition.md](2026-11-16-a-fifth-of-china-s-reports-state-their-split-as-revenue-composition.md).
The composition reader has been built and live since 2026-11-20, and that note closes when its
re-queue drains.

## Done when

Each form's `carries_segments` is set from a measurement, and the CNINFO `noTable` count is
explained by heading.

## Context

- `muffin-deployment/stack/supabase/functions/market-refresh/cn-pdf.ts` (`CN_TABLES`) until Phase 6
  ports it.
- `todos.md`, Phase 6.
