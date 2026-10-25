# The openbb price raw is the rollback, until it is dropped

Created 2026-10-10 · Due on or after 2026-10-24 · Status: **removed 2026-10-25**; done once the 2026-10-26 price night reads clean (muffin-ingest#125, muffin-deployment#462)

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

## Progress, 2026-10-25

- **Step 1, read on production.** Every scheduled `nightly_prices` night since the switch
  succeeded: 14 nights, 1,403 runs. `no_security_is_far_behind_the_sweep` passed all 1,403
  evaluations. `a_bar_s_label_is_its_listing_s` failed 13, each naming one of the same five stale
  listings that Yahoo answers with a single point
  ([note](2026-10-25-a-listing-yahoo-answers-with-one-point-keeps-its-openbb-label.md)).
  `raw_price_chart` holds 12,328 partitions, as `raw_price_history` does.
- **Step 2, muffin-ingest#125.**
  - Deleted: the asset, its fetcher and collector, and the two helpers only it used
    (`prices.asked_with_another_symbol`, `prices.dates_by_security`), with its tests and the
    `price_history.json` fixture.
  - Two guards those tests carried had no chart-lane equivalent, and moved to the chart lane:
    `not_askable` summing to `requested`, and a range of one partition. Both were
    mutation-proven there.
  - The snapshot loses only `raw_price_history`'s block.
- **Step 3, muffin-deployment#462.** `maintenance.yml -f action=drop-retired-raw`. It refuses while
  the running image still defines the asset, and it refused against today's image on the node.
  Order: merge and roll #125, then run the action with `confirm=drop`.
- **Done 2026-10-25.**
  - #125 merged as f963624. Its main build passed (image, checks, definitions).
  - `roll-ingest` (run 40177102294, 08:33 UTC): pulled, gRPC SERVING, LOADED. All three services
    moved `37c12b81…` → `730edfde…` and are pinned. No runs were in flight, so none were
    interrupted.
  - `drop-retired-raw`, dry run (40177638963): it asked the deployed image, which no longer
    defines the asset, and reported `raw_price_history: 1.6G in 12328 files`.
  - With `confirm=drop` (40179827081, 09:14 UTC): `removed`. `/mnt/data` went from 71 to 70 GB
    used and from 23 to 24 GB free (77% → 75%); exactly 25,299,980,288 bytes free afterwards. The
    directory is gone on the node.
  - The 09:07 `ledger_heartbeat` after the roll succeeded in 5.6 s.
  - Left: the first night without the lane, 2026-10-26.

## Done when

The asset is gone from the code location, its directory is gone from the raw volume, and the price
nights since have stayed clean.
