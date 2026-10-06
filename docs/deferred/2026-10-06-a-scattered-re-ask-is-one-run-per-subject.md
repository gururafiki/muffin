# A scattered re-ask is one run per subject, and a wave is due on 2026-10-26

**Decide before 2026-10-25.**

## Why

The symbology rungs re-ask OpenFIGI through `ReAskAfter`, evaluated by the `symbology_rungs` sensor
at 03:00 UTC. A subject is due when:
- its miss is older than 30 days, or
- its held symbol died since OpenFIGI last answered (Stage 3b).

Due subjects are scattered among the 6,984 `symbology_subject` keys, and Dagster cannot put scattered
keys in one run. The sensor emits one backfill, and both backfill policies split it into contiguous
key ranges. Each range becomes at least one run: `_build_run_requests_with_backfill_policy` calls
`partition_subset.get_partition_key_ranges(...)`, and `single_run` does the same per range (Dagster
1.13.22, `_core/definitions/automation_tick_evaluation_context.py`). So `multi_run(200)` never
batches a re-ask, and every due subject costs a run of its own. Each run:
- holds the `sql` pool, at run granularity;
- makes one OpenFIGI request carrying one job, where a batch could carry 100.

**Measured on the first re-ask, 2026-10-06** (dead symbols after #100): 255 subjects became backfill
`rzjlicme`.
- 254 runs, one subject each.
- Each ran ~23 s, and they queued an average 64 minutes behind each other.
- The whole backfill held the pool from 03:02 to 05:14: 2h13m, ~31 s per subject.

That is harmless at 03:00 for 255 subjects. **The 30-day stale-miss re-ask is not.** The first
symbology drain recorded its misses on 2026-09-26, so they all turn 30 days old together. The
schedule, measured 2026-10-06:

| Re-ask due on | Subjects |
|---|---|
| 2026-10-26 | **5,320** |
| 2026-10-30 | 249 |
| 2026-11-02 | 298 |
| 2026-11-05 | 187 |
| Other days | 40 |

At ~31 s each, 10-26 alone is about **46 hours of serialised runs on the `sql` pool**, across the
10-27 and 10-28 price nights. The nightly jobs carry `dagster/priority`, so each would wait behind
one ~23 s run rather than all of them. The lanes would slow, not fail. But that is 5,320 runs of
event-log churn, 5,320 one-job OpenFIGI requests where ~54 batched ones would do, and a Dagster UI
buried in them.

Every bulk event re-creates the wave 30 days later: a drain, a parser re-run, a population change.

## Options (decision for the user)

1. **Spread the re-ask by subject** (recommended). A subject is due only on its own day of a
   30-day cycle, for example `hashtext(security_id) mod 30 = day_number mod 30`. Each subject is
   still re-asked within 60 days of its miss, and no wave can form. The 10-26 wave becomes
   ~180 a day: ~1.5 h of pool time at 03:00.
2. **Cap each tick, oldest first** (for example 300 a day). It is simple, but the wave is only
   delayed and drains over ~18 days. The next bulk event makes another.
3. **Hold `sql` only in the step that writes**, i.e. op-granularity pools
   ([note](2026-09-16-sql-pool-run-granularity-blocks-every-lane.md)). It reduces what the re-ask
   blocks, not the run count. It is worth having either way; it is not this fix.
4. **Do nothing.** The lanes interleave by priority, at the costs above.

Options 1 and 2 are a change to `ReAskAfter`'s due set, on the daily dead-symbol arm as well as the
stale arm. The dead-symbol arm is small today (255 once, then new deaths only), so it may stay
unspread.

## What to do

1. Decide, before 2026-10-25.
2. If 1 or 2: change the due set in `facets/symbology.py`. Test it with a fixture of due subjects
   that the spread splits across days.
3. Watch the 10-26 03:00 tick: count its runs, and its pool time against the nightly lanes.

## Done when

The 10-26 tick re-asks a bounded number of subjects, and no day's re-ask holds the `sql` pool past
06:00 UTC.
