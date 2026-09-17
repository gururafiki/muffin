# A throttled daily price run still materialises its partition

Created 2026-09-17 · **Check 2026-09-24** · Status: counter fixed in muffin-ingest#40; **pacing
decided and shipped 2026-09-17** (muffin-ingest#42) — watch three nights

## Decision (2026-09-17)

Option **B**, pace to the measured rate: `Yfinance.min_seconds_between_calls` 1.0 → 4.0 (~15
calls/min; the 09-17 recovery ran at that rate with `throttled=0`). Shipped in muffin-ingest#42
(rolled 11:42 UTC). The check stays WARN. Options A and C return only if nights still throttle.

## Why it is deferred

muffin-ingest#40 makes the run honest: the refused batch and everything after it count as
`unasked`, so `every_askable_security_was_asked` goes red. What the run should *do* when refused is a
trade between provider budget, freshness and how the partition grid reads, so it is the user's call.

## Context

- **Measured on the 2026-09-16 partition (run `715014c3`, 00:01–00:08 UTC 09-17):** 329 calls in
  467 s (~42 calls/min, batches of 20). yfinance refused call 329, so 5,437 of 12,017 securities
  were never asked, and `price_bar` held 5,974 bars for the day. The run succeeded and the partition
  materialised.
- The four-day backfill `xawjhtlx` on 09-16 made 601 calls in 2,564 s (~14/min) and was never
  throttled. Its responses were larger, so each call took longer. The pace that matters is calls
  per minute, not calls per run.
- `Yfinance.min_seconds_between_calls` is the only pacing. The check is `WARN` and non-blocking, so
  even after #40 a throttled night materialises with a red check and a half-empty day.
- **The 2026-09-11 partition was never materialised**, because no run covered it. The schedule's
  first tick was 2026-09-13 00:00, for 09-12, and those ticks failed until 09-16. The 4,808 bars
  `price_bar` held for 09-11 came from other runs (history lane or hand-runs; not attributed).
  Recovered by `hsctpnih` (09-11..09-16).

## What to do

1. Decide with the user. Options to present:
   - **A. Fail the partition on a throttle.** Raise `dg.RetryRequested(max_retries=…,
     seconds_to_wait=…)` so Dagster retries later. Honest grid; the retry re-asks every subject,
     roughly doubling that night's calls.
   - **B. Pace to the measured limit.** Set `min_seconds_between_calls` so a night stays under ~14
     calls/min (~43 min for 601 calls), and keep A as the fallback.
   - **C. Materialise, but raise the check to `ERROR`** and add a "re-ask only the unasked" path via
     the ledger. Cheapest in calls, and the most code.
2. After the choice, prove it with a test where the fake provider refuses mid-run.
3. After #40 rolls, watch the next three nights' `unasked` and `throttled` metadata on
   `raw_price_bars`.

## Done when

A night the provider refuses either retries to completion or leaves the partition visibly incomplete,
and three consecutive nights show `unasked=0` with full bar counts.
