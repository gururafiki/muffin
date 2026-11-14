# A parser bump re-reads a history that raw does not hold

Created 2026-11-14 · Phase 6 step 3 ([spec](../specs/2026-11-09-segments-and-regulators.md),
*As built*) · Status: open, **a decision for the user before the first `segment_parser.version`
bump on Dagster.** Nothing is broken today.

## Why

Raising `market.segment_parser.version` makes every filing read at an older version due again. The
edge re-fetched each instance from SEC every time; the Dagster lane keeps what it fetches in raw, so
a re-read costs no request for a filing raw holds. But raw holds only the filings the lane itself
fetched, starting 2026-11-14. Everything the edge read before that (76,589 SEC filings with segment
rows, and the ~148,000 accounts filings carrying XBRL that the edge marked) is not in raw.

So the first bump after the cutover is a history fetch:
- **Requests:** two or three per filing (`index.json`, sometimes the HTML index, the instance), so
  ~300,000-450,000 at the shared 5 a second: 17-25 hours of the `sec` pool, which the filer lane
  and the Form 4 lane also use.
- **Disk:** instances compress ~20-25x under zstd (0.96 MB to 38 KB; 9 MB to 439 KB, measured
  2026-11-09), and the whole history kept whole is roughly **25 GB**. `/mnt/data` was at 72%
  (29 GB free) on 2026-11-11.

The sensor refuses a queue over 2,000 filings (`MAX_DUE_PER_TICK`), so a bump never starts this by
itself: it waits for an operator backfill.

## Options

1. **Keep every instance whole (recommended only with more disk).** Each later bump is free. Needs
   ~25 GB, which the block volume does not have spare; a paid volume is ~$0.0425 per GB-month.
2. **Fetch on the bump, keep only recent instances.** The backfill fetches each filing and stage 2
   reads it; a retention job drops instance bodies older than N years after they are read, as
   decision 4 does for CNINFO PDFs. A later bump re-fetches the old ones again.
3. **Re-read only recent filings on a bump.** A version bump marks only filings since a date as
   due; older ones keep rows from the older parser. Cheapest, and it leaves two parser versions
   in the served history.

## Ownership is not a problem (checked 2026-11-14)

A row's key leaves the accession out, so the last filing written for a period owns it. Within one
run the lane writes a filer's filings oldest first, and the grid is per filer, so all of a filer's
due filings are in the same run. The newest filing therefore owns a period both state, whatever
order the backfill visits filers in.

## Done when

The user has chosen an option, and it is recorded beside `MAX_DUE_PER_TICK`.

## Context

- muffin-ingest `defs/segments/automation.py` (`MAX_DUE_PER_TICK`), `defs/segments/raw.py`.
- [Segment parsing is ported as-is and widened later](2026-11-09-segment-parsing-is-ported-as-is-and-widened-later.md).
