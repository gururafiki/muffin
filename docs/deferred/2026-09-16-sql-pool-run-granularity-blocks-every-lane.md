# One long run holds the shared `sql` pool and queues every other lane behind it

Created 2026-09-16 · **Check 2026-09-23** · Status: the heartbeat fix is **verified 2026-09-19**
(waits 111 s -> 3-7 s); pool granularity stays open

## Verified (2026-09-19)

The canary is out of the queue. Heartbeat `wait_s` over the two nights runs **3–7 s** across 48
hourly runs, including the midnights when all three daily lanes start at once — against **111 s**
on 09-17, when it sat on `sql` behind `daily_prices`. The 09-18 night is the strong case: the price
run held the pool for 2,447 s and the 00:07 heartbeat still waited 7 s.

The rest stays open, and the same two nights re-measured it: `daily_indices` waited 38–39 s and
`daily_prices` 62–64 s behind `daily_fx` at every midnight, so the lanes are still serialised by
`granularity: run` — tolerable at 25 s of FX, and the thing to revisit if a lane's runtime grows.

## Decision (2026-09-17)

- muffin-ingest#42 (rolled 11:42 UTC): `ledger_health` takes no pool, so the canary no longer
  queues behind the work it watches.
- Still open: `granularity: op`, or narrower `sql` usage, once a long run's effect on the lanes is
  measured again.

## Why it is deferred

Found while recovering from the exporter incident. Changing pool granularity or the pool layout
changes how every lane is paced, so it wants its own measurement and decision.

## Context

- `muffin-deployment/stack/dagster/dagster.yaml`: `concurrency.pools.default_limit: 1`,
  `granularity: run` — a run holds **every** pool its assets name for its **whole** duration.
- Every lane's stage-2 asset uses `pool="sql"` (`price_bar`, `fx_rate`, `index_return`, …), and so
  does the hourly `ledger_health` heartbeat.
- **Measured 2026-09-16:** the prices backfill run (`xawjhtlx`) held the slot from 12:12:28 to
  12:55:12, 43 minutes and not the hours estimated. The indices backfill waited **2,601 s** and the
  FX retry **2,422 s**, then ran for 24 s and 25 s. The 13:07 heartbeat did not overlap it.
- **Confirmed 2026-09-17 00:00 UTC, with `max_concurrent_runs: 3`** (so only a pool can serialise):
  - `daily_fx` ran 00:00:03–00:00:28;
  - `daily_indices` waited until 00:00:34 and ran to 00:00:54;
  - `daily_prices` waited until 00:01:00 and ran to 00:08:47;
  - **the `ledger_heartbeat` created at 00:07:00 started at 00:08:51**, 111 s late and 4 s after
    prices ended.
  
  The heartbeat names `pool="sql"` (`definitions.py`), so any `sql` run longer than its 3-hour
  freshness window turns the canary red and reads as a dead daemon.

## What to do

1. ~~Confirm from `dagster.runs` whether scheduled runs, the heartbeat included, queue behind a
   long run.~~ Done 2026-09-17, above.
2. Decide with the user — options to present:
   - `granularity: op`, so a pool is held only while the step using it runs (verify the other
     pools still serialize provider access the way the rate rules assume);
   - no pool on light SQL assets (the heartbeat, small writers), keeping `sql` for heavy writes;
   - `multi_run` widths small enough that no single run holds `sql` for hours.
3. Record the decision in `dagster-ingestion-best-practices` › `references/dagster-native.md` ›
   *Pools and rates*.

## Done when

A multi-hour backfill in one lane no longer delays another lane's schedule or the heartbeat, shown by
run timestamps.
