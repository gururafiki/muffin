# CNINFO reports filed under the wrong year

Created 2026-11-23 · Found while gating the older-forms reader (muffin-ingest, branch
`cninfo-older-forms-and-history`) · Status: **closed 2026-11-26** (one residual, below)

## Why

The CNINFO reader dates a report from its own cover: the year before `年度报告`. The rule matched
only digits set solid (`2025年年度报告`). Some covers letter-space the title (`2010 年 年 度 报 告`)
or write the year in Chinese numerals (`二零二五年年度报告`, `二○一○年度报告`). The rule then
skipped the cover and took the first year it met later in the report, usually a mention of last
year's report. So the report's segments were filed a year or more early.

Example: 紫光股份 (000938)'s FY2025 report reads `二零二五年年度报告` on every page header. It was
read as FY2024.

`security_segment`'s key omits the accession, so a report filed under the wrong year **overwrote
the company's real rows for that year**. The real report for that year is still marked read.

## Measured (2026-11-23, production)

CNINFO annual reports by filing year minus the year of the period they are stored under:

| Lag (years) | Reports | Securities |
|---|---|---|
| 1 (correct) | 18,568 | 2,036 |
| 2 | 143 | 128 |
| 3 | 51 | 49 |
| 4 | 20 | 20 |
| 5 | 11 | 11 |
| 6 | 8 | 8 |
| 22 | 1 | 1 |

234 reports with a lag of 2 or more, across about 200 securities. A lag of 2 can be honest (a
report filed more than a year late), but these are almost all the cover rule.

## The fix

`cn_pdf.fiscal_year_end_from` now reads the year letter-spaced and in Chinese numerals (`〇○零`
for zero), taking the earliest match in the text. That is the same branch as the older forms
(muffin-ingest, `cninfo-older-forms-and-history`).

## What to do, after the reader rolls

1. A one-shot migration:
   - **deletes the rows the misdated reports own**: the rows of every CNINFO filing stored two or
     more years before its filing year;
   - **re-queues** (`segments_parser_version = 0`, keeping `segments_parsed_at`) those filings
     and every other CNINFO full report of the same securities, so the years they overwrote are
     written again.

   Deleting first is load-bearing. The shared writer (`segment_tables.write_filing`) never
   overwrites a key a NEWER filing holds (`_held_by_newer`). Re-read first, the real FY2024
   report would find its keys held by the misdated FY2025 one and be marked read, its rows
   still missing. Deleting is what the misdated report's own re-read would retract (per
   accession), so the order of the drain stops mattering. A report that was honestly filed late
   is simply read again into the same rows.
2. Drain by backfill, then re-run the measuring query: the lag-2+ rows should leave only reports
   filed late.

## Context

- The measuring query: `security_segment` (source `cninfo`, annual) joined to `security_filing` on
  security and accession, grouped by `extract(year from report_date) - extract(year from
  period_ending)`.
- [The CNINFO page-2 note](2026-11-15-cninfo-reads-only-the-newest-search-page.md), whose reader
  change carries this fix.

## Done when

No CNINFO report's stored period lags its filing year by two or more, unless the report was filed
late.

## Closed (2026-11-26)

muffin-ingest#199 and #201 rolled, muffin-deployment#539 and #543 repaired and re-queued, and CNINFO
passes 7 and 8 re-read. The measuring query, by distinct (security, report, lag) on 2026-11-26:

| Lag (filing year − period year) | Reports |
|---|---|
| 0 | 1 |
| 1 | 24,339 |
| 2 | 182 |
| 3-7 | 95 |
| 21-22 | 3 |

The lag-2+ reports were classified on 11-25 as reports CNINFO published again years later, which
the rule cannot tell from a late filing and should not try to.

**The residual is the filer's cover.** Hongbaoli (002165) prints `二○一二年年度报告` on the cover of
its FY2011 report (filed 2012-04-25), while page 2 and its contents read `2011年年度报告`, so the
report's rows sit at 2012-12-31. Fixing it would mean passing the publication date into the reader
("a report's year cannot follow its publication", then take the next year stated). One report of
~24,900 does not justify that now; the lag query names it whenever it is re-run.
