# CNINFO reads only the newest search page

Created 2026-11-15 · Planned in [the Phase 6 spec](../specs/2026-11-09-segments-and-regulators.md),
step 4 · Status: open, a widening (decision 2: ported as-is, widened later, measured)

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

## Done when

The page-2 yield is measured, and either history is walked once or the note is closed with that
measurement.
