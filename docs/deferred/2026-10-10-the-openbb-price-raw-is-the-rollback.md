# The openbb price raw is the rollback, until it is dropped

Created 2026-10-10 · Due on or after 2026-10-24 · Status: open

## Why it is deferred

Since muffin-ingest#104 (rolled 2026-10-10 19:52 UTC), the nightly price lane asks Yahoo's chart
directly (`raw_price_chart`) and `price_bar_history` reads those documents. The openbb lane it
replaced, `raw_price_history`, is still defined in the code location and is no longer scheduled.
Its Parquet files, **1.6 GB over 12,328 partitions** measured 2026-10-10, remain on the raw volume.

They are the rollback for the first rotations. Re-rolling the previous image restores the old lane,
which reads them as they are. Dropping them before the new lane has proved itself would make the
rollback a re-fetch of every history.

## Context

- Spec: [the price lane reads the quote currency](../specs/2026-10-06-the-price-lane-reads-the-quote-currency.md),
  decision 1 (a new `raw_price_chart`) and decision 2 (a first visit is a full load).
- The sweep reaches each security about every five nights (`SWEEP_SLICE = 2500`), so every security
  has a chart history after one rotation, around 2026-10-15.
- Code that cites this note: `defs/prices/automation.py` (the job) and `defs/prices/__init__.py`.

## What to do

1. After two clean rotations (from about 2026-10-20), confirm that every scheduled `nightly_prices`
   run succeeded. Confirm that `no_security_is_far_behind_the_sweep` and
   `a_bar_s_label_is_its_listing_s` pass. Confirm that `raw_price_chart` has a file for every askable
   security that answered.
2. Delete `raw_price_history` and its helpers from `defs/prices/raw.py`. Delete their tests and the
   openbb price helpers only they use (`prices.raw_rows`, `prices.provider_rows_by_symbol` stay while
   the indices lane uses them). Accept the snapshot diff, whose removal of a name is the point.
3. Delete `/var/lib/muffin-ingest/raw/raw_price_history` on the node through a maintenance action,
   never by hand.

## Done when

The asset is gone from the code location, its directory is gone from the raw volume, and the price
nights since have stayed clean.
