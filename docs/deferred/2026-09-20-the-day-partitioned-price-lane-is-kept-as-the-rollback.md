# The day-partitioned price lane is still defined, as the rollback

Created 2026-09-20 · **Check 2026-09-27** (after a week of sweeps) · Status: deliberately kept

## Why it is deferred

Expand/contract. `nightly_prices` replaced `daily_prices` on 2026-09-20 and the old lane was NOT
deleted: `raw_price_bars`, the day-partitioned `price_bar` asset, `daily_prices_schedule` (defined
and **STOPPED**) and `every_askable_security_was_asked` all still exist, so reverting is starting
one schedule and stopping the other — no deploy, no roll, no code change.

That is worth keeping until the new lane has proven itself across several nights against a provider
whose allowance moved from ~600 calls to ~138 between two consecutive days. It is not worth keeping
for ever: two lanes asking the same provider about the same securities is the one thing the
migration order exists to prevent, and a stopped schedule is one click from spending twice.

## Context

- Design and migration order: `docs/specs/2026-09-19-partitioning-to-the-provider-grain.md`
  § Migration, step 3 — "re-point `price_bar`, then retire the old asset, keeping its Parquet as
  the backup".
- muffin-ingest#56 made the cutover and documented the rollback; verified live 2026-09-20:
  `nightly_prices` RUNNING (next tick 2026-09-21 00:00 UTC), `daily_prices_schedule` STOPPED with
  no next tick.
- **Deleting it is not free.** An earlier attempt broke **28 tests** — the offline replay suite
  drives captured provider bytes through the day lane — which is why the cutover became
  expand/contract rather than a deletion. Those tests assert real rules and must be ported to the
  security lane, not dropped with it.
- This item previously lived as one clause inside the "BUILD: partition raw to the provider's
  request grain" todo. It has its own note now because that item closes with the build, and a
  retirement buried inside a completed item is how the old path survives for a year.

## What to do

1. Wait for the sweep to be proven: several consecutive nights where the counters sum to
   `subjects`, and `market.price_bar` reaches a full day's bar count across runs.
2. Port the 28 offline-replay tests to the security lane, one at a time, checking each still fails
   for its own reason (a test that passes because the thing it tested is gone proves nothing).
3. Delete `raw_price_bars`, the day-partitioned `price_bar` asset, `daily_prices_schedule`, the
   `daily_prices` job and `every_askable_security_was_asked`.
4. Keep the day lane's Parquet on disk as the backup; note here when it is deleted, separately.
5. Names are state — deleting an asset orphans its materialization history, so the definitions
   snapshot test will fail loudly. That is the point; update it in the same change.

## Done when

The day lane is gone from the definitions, the 28 tests exercise the security lane, the definitions
snapshot records the removal deliberately, and nothing in the repo can start a second lane against
the same provider.
