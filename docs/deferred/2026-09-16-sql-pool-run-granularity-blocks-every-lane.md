# One long run holds the shared `sql` pool and queues every other lane behind it

Created 2026-09-16 · **Check 2026-09-26** · Status: the heartbeat fix is **verified 2026-09-19**
(waits 111 s -> 3-7 s). The lanes' wait is fixed by `dagster/priority` (muffin-ingest#78, rolled
2026-09-25 20:34 UTC), to be verified on the 2026-09-26 night. Pool granularity stays open.

## Verified (2026-09-19)

The canary is out of the queue. Heartbeat `wait_s` over the two nights runs **3–7 s** across 48
hourly runs, including the midnights when all three daily lanes start at once — against **111 s**
on 09-17, when it sat on `sql` behind `daily_prices`. The 09-18 night is the strong case: the price
run held the pool for 2,447 s and the 00:07 heartbeat still waited 7 s.

The rest stays open, and the same two nights re-measured it: `daily_indices` waited 38–39 s and
`daily_prices` 62–64 s behind `daily_fx` at every midnight, so the lanes are still serialised by
`granularity: run` — tolerable at 25 s of FX, and the thing to revisit if a lane's runtime grows.

## Re-measured 2026-09-24 — the lane's runtime grew, and the wait went from seconds to hours

Since 2026-09-21 the price lane is `nightly_prices`: **100 bounded runs of 25 securities**, each
holding `sql` (and `yahoo`) for its whole ~55 s, ~93 minutes in total. The 100 price runs are
created at 00:00:00 in the same tick as `daily_fx` and `daily_indices`, so whichever daily lane
lands after them in the queue waits for all 100:

| night | lane that waited | wait | runs |
|---|---|---|---|
| 09-23 | `daily_indices` | **6,185 s** | FX 7 s, prices 53-6,125 s |
| 09-24 | `daily_fx` | **6,069 s** | indices 8 s, prices 49-6,010 s |
| 09-25 | neither | FX 8 s, indices 49 s | prices 90-5,744 s |

So FX or index returns publish ~1.7 hours late on any night the tick happens to queue a daily lane
after the sweep: two of the three nights measured. The
heartbeat is unaffected (7-9 s, no pool).

A fourth option, not considered in 2026-09-17: **`dagster/priority`**. `QueuedRunCoordinatorDaemon`
sorts queued runs by that tag, highest first (`_priority_sort`, `queued_run_coordinator_daemon.py`
in 1.13.22). Tagging `daily_fx` and `daily_indices` above the sweep, or the sweep below 0, lets
the two short lanes take the next free `sql` slot. Their wait would then be at most one price run
(~55 s), with the pool layout unchanged. This is the skill's "order by run length" rule, applied
in the scheduler instead of by the operator.

## Decision (2026-09-25) — priority, not granularity

`daily_fx` and `daily_indices` carry `dagster/priority: 1` through their jobs' `run_tags`
(`muffin_ingest_dagster/lib/priority.py`). The scheduler merges a job's `run_tags` into every run it
creates, and the coordinator sorts by priority before checking pools, so each short lane takes the
next free `sql` slot. It should wait at most one price run (~55 s), never the sweep. This removes
the symptom and leaves the pool layout as it is. The granularity question below is still open, and
it is still the only thing that would let a short lane run BESIDE a price run rather than after it.

**Live check, 2026-09-26 00:00 UTC:** both runs carry `dagster/priority=1`, and each waits less than
two minutes.

**Granularity: decided by the user 2026-09-25 — keep run granularity plus the priority tags.** Op
granularity would let a short lane run beside a price run rather than after one, but with priority
the most it waits is one price run (~55 s), and nothing needs more. If the 09-26 waits are under two
minutes, this note closes as decided. If they are not, the decision goes back to the user with the
numbers.

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
