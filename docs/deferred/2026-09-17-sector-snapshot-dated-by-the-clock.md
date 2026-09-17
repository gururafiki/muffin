# The nightly sector snapshot is stamped with the next day

Created 2026-09-17 · **Check 2026-10-01** · Status: open, small, needs a decision

## Why it is deferred

The correct date for a finviz snapshot depends on a market calendar the lane does not hold. Choosing
where that date comes from is a modelling decision.

## Context

- `muffin-ingest/src/muffin_ingest_dagster/assets/indices.py::raw_sector_performance` sets
  `taken = date.today()`, and `index_return` writes it as the 77 sector rows' `as_of`. Its comment
  says `as_of` "comes from the DATA", but finviz sends no date, so it comes from the clock.
- `daily_indices` fires at 00:00 UTC. **Measured 2026-09-17:** the snapshot taken at 00:00:34 UTC
  describes the US 09-16 session and is stored as `as_of = 2026-09-17`, beside 549 country and group
  rows correctly dated 09-16.
- Every nightly run therefore files the US session under the following calendar day. Any snapshot
  taken between 00:00 UTC and the next US open does the same.

## What to do

1. Decide with the user. Options to present:
   - **A. Stamp with the newest completed US session**, taken from the data already held: the newest
     `price_bar`/`index_return` date for a US proxy such as `IVV`, read in stage 2.
   - **B. Stamp with a market calendar** (`exchange_calendars` or pandas-market-calendars): the most
     recent NYSE session closed at `taken`. A new dependency.
   - **C. Keep the clock and document it**, and have the UI show the snapshot time rather than a
     session date.
2. Add a test that runs the snapshot at 00:30 UTC and asserts the session date.

## Done when

The sector rows and the country rows from the same night carry the same `as_of`.
