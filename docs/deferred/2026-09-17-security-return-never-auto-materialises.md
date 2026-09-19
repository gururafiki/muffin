# `security_return` has never been materialised by its automation condition

Created 2026-09-17 · Status: **CLOSED 2026-09-19** — it rebuilt itself unaided on both nights

## Verified (2026-09-19)

Both nights rebuilt it with no hand-run, and the run that did it is an `__ASSET_JOB` launched by the
automation sensor rather than by a schedule:

- **09-18 00:42**, run `b21560a1`, 313 s — `daily_prices` ended at 00:41 after 2,447 s, and the
  rebuild followed it by one minute: `securities=11756 with_returns=11712 periods=103028`.
- **09-19 00:10**, run `c3b53619`, 283 s — `securities=11760 with_returns=11716 periods=103052`.

So ignoring the history lane is what made it fire: `price_bar_history` still has unfilled `security`
partitions, which is exactly the state that held it before. Note the 09-19 rebuild ran off a
**partial** price day (the provider refused that night), so its newest `as_of` is honest about what
was collected rather than about what the market did — see
`2026-09-17-a-throttled-day-partition-still-materialises.md`.

## Decision (2026-09-17)

Automatic and decoupled rather than coupled into the price job: `AutomationCondition.eager().without(~AutomationCondition.any_deps_missing()).ignore(AssetSelection.assets(price_bar_history))`.
Ignoring the history lane keeps a multi-day history backfill, which counts as in progress for its
whole length, from holding the nightly rebuild. Shipped in muffin-ingest#42 (rolled 11:42 UTC). The
daemon evaluated the new tree at 11:42 with no `any_deps_missing` branch. Its first automatic rebuild
is expected after the 2026-09-18 `daily_prices`; 2026-09-17's returns came from a hand-run
(`374da72e`, 310 s).

## Why it is deferred

The fix changes when a derived table rebuilds, and there are three reasonable triggers with
different costs. That choice is the user's.

## Context

- `muffin-ingest/src/muffin_ingest_dagster/assets/prices.py`: `security_return` declares
  `deps=[price_bar, price_bar_history]` and `automation_condition=AutomationCondition.eager()`.
  `definitions.py` declares `default_automation_condition_sensor` as `RUNNING`, which fixed "the
  sensor ships stopped" on 2026-09-11 and did not make the condition fire.
- **All three materialisations ever recorded were launched by hand** (09-11 11:53, 09-11 15:53,
  09-12 06:10). Each is an `__ASSET_JOB` run with no automation tag. `market.security_return` last
  moved on 2026-09-12.
- **Measured 2026-09-17, from `dagster.asset_daemon_asset_evaluations` id 13** (00:09:39, right
  after `daily_prices` landed 09-16):
  - `SinceCondition` (deps updated since last handled): **true**.
  - `~any_deps_missing`: **false**, for both deps.
  - `price_bar` is missing exactly one daily partition, **2026-09-11**. The recovery backfill of
    09-16 covered 09-12..09-15; the 2026-09-17 recovery `hsctpnih` covers 09-11..09-16.
  - `price_bar_history` is missing a range of `security` partitions. Its sensor
    `new_securities_need_history` ADDS keys and requests nothing, by design (12,028 keys on
    09-17), so this half stays true for as long as the universe grows.
- An unpartitioned asset downstream of partitioned ones depends on **every** upstream partition, so
  `eager()` waits for a state Lane B deliberately never reaches. Filling 2026-09-11 removes only the
  first blocker.
- Its `FreshnessPolicy.time_window(36h)` has been failing since ~09-13, but Dagster OSS freshness
  policies raise no alert, so the UI showed it and nothing else did.

## What to do

1. Interim, each morning until fixed: materialise `security_return` by hand once `daily_prices` has
   succeeded (`muffin-dagster-operations`).
2. Decide with the user. Options to present:
   - **A. A custom condition without the missing-deps gate:**
     `AutomationCondition.any_deps_updated().since_last_handled() & ~AutomationCondition.any_deps_in_progress() & ~AutomationCondition.in_progress()`.
     It rebuilds whenever any bars land, from either lane. Risk: several rebuilds a day during a
     history backfill. Each run reads all bars for about 11k securities; measure its duration first
     (the 09-12 hand-run is the baseline).
   - **B. Add `security_return` to the `daily_prices` job selection.** One rebuild per night, right
     after `price_bar`, with no automation. History backfills are reflected the following night.
   - **C. Keep eager, but drop `price_bar_history` from `deps`.** The asset reads the table, not
     the asset. This hides a real dependency from lineage, so it is presented only to be rejected.
   - Whichever is chosen, verify it by reading the next evaluation or run, never the definition.
3. Add an alert or check that fires when the latest `security_return` materialisation is older than
   the newest `price_bar` partition by more than a day. A `FreshnessPolicy` alone reports to nobody.
4. Record the rule in `dagster-ingestion-best-practices` › `references/dagster-native.md`: an
   unpartitioned asset depending on a partition set that is never complete cannot use `eager()`.

## Done when

`security_return.as_of` advances to the newest trading day on two consecutive nights with no hand-run.
