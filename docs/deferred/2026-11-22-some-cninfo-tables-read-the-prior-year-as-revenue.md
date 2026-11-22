# Some CNINFO tables read the prior year as revenue

Created 2026-11-22 · Found while checking the segment reconcile rule on production · Status:
**decided 2026-11-22 (read them correctly); reader in muffin-ingest#196, re-queue in
muffin-deployment#537**

## Why

22 CNINFO reports (20 companies, FY2015 to FY2023) stored a member whose name carries a money
figure. A member looks like `cninfo:其他业务16,327,089.580.36%`: the name, then this year's amount
and share.

In 16 of them, the reader took LAST year's amount as the revenue. The split still reconciled,
because the reader took last year's total as its target too, and it was stored under the report's
own year. Examples, measured 2026-11-22:

| Report | Figures fused into the names (this year) | Values stored | Stored against |
|---|---|---|---|
| 002755.SZ FY2019 | 16.3 m + 116.9 m + 1,019.2 m + 3,366.2 m = 4.52 bn | 3.93 bn | 3,931,881,726.83 |
| 000758.SZ FY2020 | 4,302 m + 1,873 m + 279 m + 332 m = 6.79 bn | 11.08 bn | 11,077,988,721.23 |
| 000888.SZ FY2017 | 1,079 m | 1,041.6 m | 1,041,579,179.44 |

One of the 22 was a currently served split; the other 21 are history.

## What it was: five shapes

Each was measured on the stored PDF before a rule was written.

| Shape | Reports | Cause |
|---|---|---|
| This year's `金额` letter-spaced (`金` and `额` as two items), last year's as one | 16 | the composition header matched the label by its exact text, so the first amount column found was last year's |
| This year's `金额` 3.3 pt below the line holding last year's (舒泰神 300204 FY2023) | 1 | the label was taken from the line met first |
| A note after a composition table, with its figures in the amount column (华大基因 300676 FY2020, 翰宇药业 300199 FY2017 and FY2018) | 3 | nothing ended the table before the note |
| A two-up page: two portrait pages side by side (上海家化 600315 FY2017) | 1 | the other page's text joined the member names, and a `说明` there ended the product table before its first row and the region table after its second |
| A mandated table in 千元 printing whole numbers, two of them wrapped (`1,095,921,7` over `52`) (中国中铁 601390 FY2022, FY2023) | 2 | a whole number was a figure only in the composition table, so the table yielded nothing and prose after it was read |

China Eastern's FY2020 report read its change column as revenue, so every table summed below zero
and a split was placed against a negative total. muffin-ingest#195 stops placing a split against a
total of zero or less.

## What was done

- **muffin-ingest#196**, one rule per shape in `cn_pdf.parse_segment_page`:
  - header labels are found glyph by glyph, and the amount label is the leftmost in the header
    block;
  - CJK text past the amount column ends a composition table;
  - prose set from the name column across to the cost label ends a mandated table;
  - text ending left of the name column, or starting 100 pt past the cost label, is another page's;
  - a line of figures alone is no name;
  - a whole figure counts in any table at 千元 or above, judged with what its column already holds.

  Gated on the 782 reports held on the node: 716 golden, 44 Shenzhen and the 22. The first
  composition prose rule (any CJK text past the share label) cut two golden reports short: a page
  footer `第 15 页 / 共 202 页`, and a column header repeated on the next page. One rule now serves
  both tables: prose starts in the name column and runs across to the next label.
- **The whole-number rule recovers more than 中国中铁.** 8 of the 35 golden reports that read into no
  facts now read reconciling splits (中国神华, 中国国航, 工业富联).
- **muffin-deployment#537** re-queues the 22, China Eastern, and every full report read into no
  rows: 4,198 reports over 1,381 filers, counted by a production dry run.

## Also found, not yet classified

About 35 more reports carry a member that is a fragment of prose: `[注]：1.增值电信…`,
`1）清洁能源设备2012年度，润率为-56.65%`. Full-width punctuation alone does not identify them,
since real names carry it (`中国大陆，香港及台湾地区`, long product lists). The two prose rules of
#196 may have removed some of them, and the rest need review against their PDFs before any rule.

## Context

- `muffin-ingest/libs/muffin-ingest-lib/src/muffin_ingest/facets/cn_pdf.py`.
- The measuring query: members matching `[0-9]{1,3}(,[0-9]{3})+\.[0-9]{2}` in
  `market.security_segment` where `source_code = 'cninfo'`.
- [The China drain](2026-11-15-the-china-segment-backlog-drains-by-backfill.md).

## Done when

The 23 re-queued reports have been re-read, no stored CNINFO member name carries a money figure, and
no CNINFO revenue split is placed against a total of zero or less.
