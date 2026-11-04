# The company lane waits for the stale-miss re-ask

Created 2026-11-02, from the Monday promotion check-in · Status: **Decided 2026-11-04 (the user):** option 1, a `dagster/priority` on `yahoo_companies`. **Built in muffin-ingest#162** (rolled 2026-11-04 22:18 UTC; done when the 11-05 03:30 runs start at once): the lane takes priority 1 and the short lanes move from 1 to 2, so they still outrank everything.

## Why

Since 2026-10-27 the 03:00 UTC tick of the symbology re-ask (each stale miss due on its own day
of a 30-day cycle, muffin-ingest#102) launches 170-205 one-subject symbology runs, ~30 s each.
They hold the `sql` pool from 03:01 until 04:35-04:49, and the company lane (`yahoo_companies`,
scheduled 03:30) queues behind them:

- the lane now runs ~04:50 to 05:49-06:19, where it used to end ~04:45;
- on Mondays the promotion probe follows it (06:17-06:51 on 11-02).

Nothing fails and nothing is throttled. Two costs: the run windows in `muffin-deploy` and
CLAUDE.md still say 03:30-~06:00, so a roll at 06:00 could kill a company run; and a later
company lane leaves less room before the 11:00 SEC lanes if it ever runs long.

The re-ask is one run per subject because Dagster batches only contiguous partition keys
([note](2026-10-06-a-scattered-re-ask-is-one-run-per-subject.md)).

## Options

1. **Give `yahoo_companies` a `dagster/priority` above the re-ask**, so the queue lets it through
   at 03:30. One tag in the job's `run_tags`. The re-ask then waits for the lane and runs
   ~05:50-07:20, beside Monday's promotion probe.
2. **Move the re-ask** to a quieter hour (after the company lane, before 11:00).
3. **Accept the later window** and update the run windows in `muffin-deploy` and CLAUDE.md to
   03:00-~06:20 (07:00 on Mondays).

Recommended: 1; it restores the documented window without moving anything else.

## Done when

The user has chosen, and a night's company lane starts within a minute of 03:30 (for 1 or 2), or
the documented windows match what runs (for 3).

## Context

- `todos.md`, Phase 3 Stage 4 (the 2026-11-02 promotion check-in).
- `muffin-ingest/projects/muffin-ingest/src/muffin_ingest_dagster/defs/symbology/` (the re-ask),
  `defs/companies/` (`yahoo_companies`).
