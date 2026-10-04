# Bars before a raw history's first date are kept, unjudged

## Why

muffin-ingest#99 makes `price_bar` mirror the raw history within the range that history covers.
`prices.RETRACT_BARS_ABSENT_FROM_RAW` deletes a bar on a date inside the raw range that the raw
history lacks. It deliberately leaves alone the bars **before** the raw history's first date.

Measured 2026-10-04 on production, comparing every security's `price_bar` dates with the dates in
its `raw_price_history` partition:

| Bars absent from raw | Securities | Bars | Treatment in #99 |
|---|---|---|---|
| inside the raw range | 95 | 5,097 | retracted |
| before the raw range | (not split per security) | 37,123 | **kept** |
| after the raw range | — | 26 | kept |

The bars before the raw range are two different things, and the bars alone cannot tell them apart:

- **A history the provider stopped returning, on the same listing.** AREN's 7,457 run continuously
  into its raw history: 1.05 on 07-16, 1.00 on 07-17. Deleting them deletes real history.
- **Another listing's leftovers.** #99 reloads a history asked with another symbol: the 69 mixed
  partitions, e.g. `GELYF` → `0175.HK`. When the old line's history starts earlier than the new
  one's, the reload replaces the raw file but the old line's bars before the new first date stay in
  `price_bar`, in another currency, under a chart's longest range.

## Context

- muffin-ingest#99 and the comment above `RETRACT_BARS_ABSENT_FROM_RAW`.
- The 69 mixed partitions: securities priced through the ticker fallback
  (`coalesce(provider symbol, ticker)`) until symbology adopted a home line.
- Stage 3b (the provider repairs dead symbols) will produce more symbol changes, and each one
  restarts a history the same way.

## What to do

1. Once #99 is rolled and the 69 have reloaded, re-measure. They reload as the nightly sweep reaches
   them (about a week), or sooner by a targeted backfill. Measure per security: bars before the raw
   history's first date, and the close ratio across the boundary (the last bar before the range
   against the first raw close).
2. Split the population on that ratio. A continuous series (AREN) is the same listing. A step in
   price or currency is another listing's.
3. Decide with the user. Options:
   - retract pre-range bars only where the boundary is discontinuous;
   - retract pre-range bars only for securities whose raw history restarted on a symbol change.
     This needs the restart recorded somewhere stage 2 can read it, because `price_bar` carries no
     symbol;
   - keep them, and have the chart start at the raw history's first date.
4. Whatever is chosen, add a check that counts discontinuous boundaries, so a new instance is visible.

## Done when

Every pre-range bar is either the same listing's history (continuous at the boundary) or gone, and a
check reports any new discontinuity.
