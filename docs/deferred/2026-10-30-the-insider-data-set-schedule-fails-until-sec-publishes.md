# The insider data-set schedule fails a run until SEC publishes, and asks only the newest quarter

**Fixed in muffin-ingest#153 (2026-10-30, rolled 2026-10-31 09:52 UTC), with a third defect found while fixing it:** the run
key was the quarter alone, and Dagster launches a run key once per schedule, so an unpublished
quarter would have been asked on one Monday and never again. The key now carries the tick's
day. Closes when #153 is rolled and its first Monday (2026-11-02 11:45 UTC) asks 2026q2 and
2026q3 without a failed run.

Recorded 2026-10-30, Phase 5 step 7a. The `sec_insider_datasets` schedule stays STOPPED until this
is fixed; every other SEC schedule is on.

## Why

`raw_sec_insider_dataset` raises `dg.Failure` on a 404, which is SEC saying "this quarter is not
published yet". That was decided in step 4 so that a run claims nothing for a quarter it does not
hold. Two consequences only showed when it came to turning the schedule on:

- **It fires "A Dagster run failed" every Monday for months.** The rule
  (`muffin-dagster-run-failed` in muffin-deployment's `rules.yml`) alerts on any failed run for six
  hours. SEC published nothing for 2026q2 four months after the quarter ended (measured 2026-10-26),
  so the weekly schedule would have been red every Monday on correct behaviour, the "permanently red
  gate" this repo has paid for three times.
- **It asks only the newest completed quarter** (`keys[-1]`). From 2026-10-01 that is 2026q3, so
  when SEC publishes 2026q2, nothing asks for it.

Nothing is lost while it is off. The Form 4 lane's `sec_days` grid starts 2026-04-01, so every day
of both unpublished quarters is covered by Form 4s, and a data set replaces a quarter's Form 4 rows
when it lands. History (2006q1-2026q1) is the step 8 backfill.

## What to do

1. **A quarter SEC has not published ends the run without claiming the partition, and the run
   succeeds.** `output_required=False` on the multi-asset, with stage 2 skipped by Dagster when
   stage 1 yields nothing. Log it, and count it somewhere a reader sees (an observation or the
   run's tags), so "not published" stays distinguishable from "never asked".
2. **The schedule asks every completed quarter that is not held**, oldest first, and not only the
   newest.
3. Then turn the schedule on in code, as `sec_daily_index` was.

## Done when

- The schedule is RUNNING in code, a Monday with nothing published produces no failed run, and
  2026q2 is collected without an operator once SEC publishes it.
- Context: [the SEC family spec](../specs/2026-10-24-sec-family.md) (*Step 6*, insider rules),
  `muffin-ingest/projects/muffin-ingest/src/muffin_ingest_dagster/defs/sec/automation.py`.
