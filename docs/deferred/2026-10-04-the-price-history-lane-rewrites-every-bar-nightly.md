# The price history lane rewrites every bar it holds, every night

Created 2026-10-04 · Status: **closed 2026-10-07**, superseded by
[the 2026-10-06 note](2026-10-06-every-night-rewrites-millions-of-unchanged-bars.md) (the same
defect, found again two days later). See "Resolved" at the end.

## What happens

`nightly_prices` extends 2,500 securities a night from their own watermark. Stage 1 is cheap:
- On 2026-10-04 it fetched **28,127 rows** in 316 calls.
- `requested` 2,500 = answered 2,415 + dead 27 + not askable 58.
- Nothing was throttled and nothing was left unasked.

Stage 2 is not. `price_bar_history` (muffin-ingest `defs/prices/core.py`):
- reads each partition's **merged** raw file, the security's whole history;
- normalises all of it;
- returns every row to `postgres_io`.

The writer's upsert is `on conflict (security_id, trade_date) do update set …` with no `where`, so
Postgres writes a new tuple for every row, changed or not. Measured from the run metadata and
`pg_stat_user_tables`:

| | |
|---|---|
| rows published by stage 2 on 2026-10-04 | **13,797,563**, for ~28k new or re-read bars (≈99.8% unchanged) |
| updates on the `price_bar` partitions since stats reset (2026-07-20) | **178,565,349**, of which 6,546,126 were HOT |
| autovacuum | sweeps each yearly partition every night, 01:15–01:42 UTC |
| stage 2 time per run / per night | **16.6 s / 27.7 min**, against 16.5 s / 27.5 min for the fetch |
| the whole night's price runs | 00:00–01:41 UTC, holding the `sql` pool throughout |

Nothing is wrong in the data. This is cost: write amplification, WAL, vacuum load, and a pool
held for half an hour longer than the work needs, on one Always-Free node.

## Why it was built this way

Stage 2 re-derives from raw, which is the two-stage rule: a fix to `prices.normalise` costs a
re-parse and no provider call, so stage 2 must be able to publish everything. The defect is that
it publishes everything **every night**, not only when asked to.

## Options

1. **The writer skips unchanged rows**: `do update set … where (t.a, t.b, …) is distinct from
   (excluded.a, excluded.b, …)`. This is generic, since `venue_listing` and every other upsert gain
   it, and it keeps the re-parse semantics. It removes the heap writes, WAL and dead tuples. It does
   not remove the reading, normalising and sending of 13.8M rows, or the index lookups.
2. **Stage 2 publishes only the rows its own run fetched.** Raw rows carry their `run_id`, so the
   newest run's rows are the extension plus its re-read window. A full re-parse becomes an explicit
   config flag (`republish: true`) on a backfill. Stage 2 drops to ~280 rows a run. The risk: a
   republish must be remembered when `normalise` changes, which is the kind of rule this codebase
   has watched rot.
3. **Both.** Option 2 for the nightly cost; option 1 so the explicit republish, and every other
   lane, writes only what changed.

Recommendation: **3**, option 1 first. It is a one-function change in `writers.upsert`, testable
against real Postgres (a re-run must leave `n_tup_upd` unchanged), and it makes option 2's republish
cheap whenever someone does remember it.

## Done when

- A night's `price_bar` `n_tup_upd` delta is within a few multiples of the rows actually new or
  re-read, not ~14M.
- The night's price runs end well before 01:41 UTC.
- The `raw` and stage-2 counters still sum as they do today.

## Resolved (2026-10-07)

Decided 2026-10-06, in the later note: **option 1 only**. muffin-ingest#101 adds the guard to
`writers.upsert`; it was rolled 2026-10-06 21:12 UTC. Option 2, publishing only the run's own rows,
was presented there too and was not chosen.

The first night against this note's "Done when":

- **`n_tup_upd` over the night: 48,599**, against 121,990 rows fetched. It used to be every row sent,
  ~11 M. Met.
- **The night ended at 01:32 UTC**, against 01:42 on 10-04 and 01:38 on 10-06. Not "well before
  01:41". `price_bar_history` took 1,352 s against 1,558 s: stage 2 still reads, normalises and sends
  11.1 M rows, which, as this note said, only option 2 removes.
- **The counters still sum:** stage 1 `requested` 2,500 = answered 2,446 + empty 1 + dead 2 + not
  askable 51. Stage 2's new `changed` (98,226) equals the night's inserts plus updates exactly.
  Met.
