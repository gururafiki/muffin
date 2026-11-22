# CNINFO reads only the newest search page

Created 2026-11-15 · Planned in [the Phase 6 spec](../specs/2026-11-09-segments-and-regulators.md),
step 4 · Status: **decided 2026-11-23 (the user): build the older readers, then walk page 2.**
Measured the same day: page 2 holds ~8 full reports a filer, and the current reader reads none
of them (a widening: decision 2, ported as-is, widened later, measured)

## Why

The lane asks CNINFO's announcement search for page 1 of each filer's annual-report category, 30
announcements, as the edge did. The category also holds summaries, English editions and
`主要财务指标` data files, so page 1 reaches back about a decade of full reports. Measured on
长江电力's captured search (2026-11-15): `totalAnnouncement` 61, `totalpages` 2, `hasMore` true, and
page 1 holds 13 full reports, 2015-04-30 to 2026-04-30. The reports on page 2 (2001–2014 here) were
never filed by the edge and are not filed by the lane.

## Context

- `providers/cninfo.py::announcements_form` (`pageSize` 30, `pageNum`), and
  `facets/cninfo.py::newest_list`, which keeps only page 1.
- Each further page is one more search request per filer per visit, on a provider whose throttling
  is unmeasured beyond 24 requests (2026-11-15: all answered at 1 s and at 0.25 s spacing).
- Pre-2015 reports may predate the mandated table's current form; whether the reader finds the
  heading in them is unmeasured.

## What to do

1. Take 20 filers with `hasMore` true. Fetch page 2 once for each, and count the full reports it
   adds and the years they cover.
2. Read five of those reports with the current reader and count tables found. If old reports
   rarely carry the table, close this note as not worth the requests.
3. Otherwise walk every page once per filer (a backfill), and keep reading page 1 on the floor.
   New reports always appear on page 1.

## Measured (2026-11-23)

From the node, through http-cache, with the production image.

- **How many filers have more than page 1:** of the 2,173 stored searches, 1,418 (65%) carry
  `hasMore`. CNINFO's `totalpages` reads 1 for 689 of them although `totalAnnouncement` is 38-57,
  so it is no guide; `totalAnnouncement` above 30 is.
- **Page 2 for 20 sampled filers** (one request each, paced 1 s, all HTTP 200): **162 full reports
  page 1 does not list**, 3 to 12 a filer (8.1 on average). They cover 2003 to 2019, almost all
  before 2015; page 1 reaches back to 2014-2016 (300001 to 2019). Scaled, the history is ~11,500
  reports.
- **Five of them read with the current reader** (600210 FY2005, 600050 FY2008, 002145 FY2010,
  300001 FY2011, 601601 FY2013): **0 facts in all five.** Two had a heading page found and nothing
  read from it, and three had no heading found.
- **The reports do state a split, in older forms:**
  - FY2005 (600210): separate `主营业务分产品情况表`, `主营业务分行业情况表` and
    `主营业务分地区情况表` tables, with columns `主营业务收入`, `主营业务成本` and `主营业务利润率`,
    not `营业收入`/`营业成本`.
  - FY2008 (600050): one combined `主营业务分行业、产品情况表`, its first column `分行业或分产品`,
    with `分行业` and `分产品` as group rows.
  - FY2011 (300001): `分产品 营业收入 营业成本 毛利率`, close to today's columns, under a heading
    the reader does not find.

So walking history now would fetch ~11,500 PDFs (~3 MB each, pruned from raw after 30 days) that
read into no rows. It is worth the requests only after the reader handles the older forms, gated
the way step 4 was.

## Decided (2026-11-23)

The user chose to build the older readers. The plan follows the Shenzhen variant's gating:

1. Read a sample of pre-2015 reports across years and exchanges, and classify every layout found.
2. Teach `cn_pdf` each layout, with a fixture per layout.
3. Gate over every old report downloaded and the 782 current reports held on the node: no current
   report may change, and every old split must reconcile or be explained.
4. Teach stage 1 to walk pages 2..N once per filer, and stage 2 to file every stored page.
5. Ship, run a live subset, then backfill the walk.

## Done when

The page-2 yield is measured, and either history is walked once or the note is closed with that
measurement.
