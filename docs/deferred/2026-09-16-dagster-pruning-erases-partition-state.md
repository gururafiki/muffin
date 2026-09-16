# Dagster run pruning erases the partition state the pipeline relies on

Created 2026-09-16 · **Due 2026-11-15** (first affected materializations age out 2026-12-10) · Status: open

## Why it is deferred

Found while researching the `dagster-ingestion-best-practices` skill; nothing is broken **yet**. The
nightly `prune_dagster_storage` job deletes runs older than 90 days, and the oldest partition
materializations that matter (the price-history load, 2026-09-11 and 12) cross that line on
2026-12-10.

## Context

- **The mechanism, verified in Dagster 1.12.22's installed source:**
  - `instance.delete_run(run_id)` → `event_log_storage.delete_events(run_id)` →
    `delete_events_for_run` deletes **every** `event_logs` row for the run, including
    `ASSET_MATERIALIZATION` and `ASSET_OBSERVATION`, plus their `asset_event_tags`
    (`dagster/_core/storage/event_log/sql_event_log.py`).
  - `get_materialized_partitions(asset_key)` selects `ASSET_MATERIALIZATION` rows from `event_logs`
    grouped by partition (same file). A partition whose only materialization was in a pruned run
    therefore reads as **never materialized**.
- **Who relies on it:**
  - Lane B, the per-security history (`raw_price_history`, `price_bar_history`): materialized once per
    security by design.
  - Phase 3's rule that "per-subject state is the partition grid"
    (`docs/superpowers/specs/2026-09-12-universe-dagster-design.md` §2.3): `raw_figi_ticker`,
    `raw_figi_local_symbol`, `raw_yahoo_symbol`, `raw_nport_filing`, `raw_exchange_sweep`.
  - Sensors that add partitions only for subjects not yet materialized, and backfills over "missing".
- **Code:** `muffin-ingest` `src/muffin_ingest_dagster/retention.py` (`KEEP_DAYS = 90`,
  `MAX_PER_RUN = 2000`); after the workspace refactor, `defs/platform/`.
- **Unconfirmed:** whether the UI's asset status cache (`asset_keys.cached_status_data`) also forgets —
  it is updated incrementally and may keep the partitions until it is rebuilt.
- **Rule it bears on:** `dagster-ingestion-best-practices` › `references/dagster-native.md` ›
  *Dagster state has a retention period*.

## What to do

1. **Baseline now:** count materialized partitions for each asset above
   (GraphQL `assetNodes { partitionStats { numMaterialized } }`, or `event_logs` grouped by
   `asset_key` on the node — see `muffin-reach-deployed-services`).
2. **Confirm the effect** without waiting 90 days: in a throwaway instance, materialize a partition,
   delete its run with `instance.delete_run`, then read `get_materialized_partitions` and the UI's
   partition status.
3. **Choose a fix with the user** — options to present:
   - never prune a run holding the **latest** materialization of any partition (keeps state, bounds
     growth by partitions × assets);
   - exclude runs that materialized partitioned assets from pruning altogether;
   - keep pruning, and make every "is it done?" question read a durable store instead (the raw file on
     disk, or a table);
   - raise `KEEP_DAYS` — only moves the cliff.
4. Implement it in the pruning job; prove it with a test that fails today.

## Done when

A test shows a partition materialized more than `KEEP_DAYS` ago still counts as materialized after the
pruning job runs, and the production counts from step 1 are unchanged across a pruning night.
