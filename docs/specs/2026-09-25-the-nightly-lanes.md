# The nightly lanes: where the sweep resumes, who goes first, what is re-read

2026-09-25 · Status: approved by the user 2026-09-25 ("go ahead with what you propose") ·
§1-3 shipped in muffin-ingest#78 (rolled 20:34 UTC) · §4's prerequisite in muffin-ingest#79
(rolled 20:48 UTC) · live checks from the 2026-09-26 night

Three defects were measured in the 00:00 UTC lanes during the week they went live, plus one
experiment that follows from the symbology lane. This spec records what was measured, the options,
and what was decided. Each decision was checked against `dagster-ingestion-best-practices`.

## 1. The price sweep's position moved whenever the universe grew

**Measured.** `nightly_prices` started each night at `(day * SWEEP_SLICE) % len(keys)`.

```
night   grid     slice            overlap with earlier nights
09-23   12,267   [871, 3371)      —
09-24   12,267   [3371, 5871)     none
09-25   12,268   [2300, 4800)     1,071 + 1,429 = the whole slice
```

On 09-25, 6,056 securities were 8-14 days stale while the night re-swept keys covered the two
nights before. Detail: `docs/deferred/2026-09-25-the-price-sweep-rotation-jumps-when-the-universe-grows.md`.

**Options.**

| | how | cost |
|---|---|---|
| A. fixed slots | `slot = day % ceil(N / 2500)` | still jumps each time N crosses a multiple of 2,500; switching costs a partial night |
| **B. resume after the last key requested** | read the previous tick's runs back from run storage | more code; no discontinuity at all |
| stalest-first | ask the oldest securities first | a RunRequest names one contiguous range, so a scattered set is hundreds of runs |

**Decided: B.**
- **Where the position lives.** Every run carries `muffin/sweep_night` and `muffin/sweep_last`. The
  next tick reads the newest night strictly before its own (`get_runs` filtered by
  `dagster/schedule_name`) and resumes after that night's last key.
  - Schedules have no cursor, but their runs are durable, and nothing prunes them since 2026-09-19.
  - Dynamic partitions list in insertion order, so growth appends and never moves the anchor.
- **Retried tick.** Tonight is excluded, so a retried tick yields identical run keys.
- **Failed night.** It still advances; retrying a failed slice would stop the rotation.
- **Fallbacks.** The highest range end of an untagged night (the 09-26 transition), then the old
  date rule, never zero.
- **Wrapping.** Slices wrap past the end of the grid, so every night asks for 2,500 keys; no run
  straddles the end.

**Skill check.**
- Rule 1 (Dagster-native): the state is Dagster's own run storage, and nothing of ours is kept
  beside it. A sensor cursor was rejected: it trades a cron for a polling interval on a job that
  runs once a night.
- Rule 6: unchanged. The partition stays the provider's grain, and extension is untouched.

## 2. The short daily lanes queued behind the whole sweep

**Measured.** At 00:00 the FX and index lanes queue beside ~100 price runs, all needing the `sql`
pool at limit 1, and the coordinator dequeued in creation order:

| night | `daily_indices` wait | `daily_fx` wait |
|---|---|---|
| 09-23 | 6,185 s | — |
| 09-24 | — | 6,069 s |
| 09-25 | none | none |

**Options.** Priority tag · a separate pool per lane · move the lanes to another hour · change pool
granularity to op (the open question in
`docs/deferred/2026-09-16-sql-pool-run-granularity-blocks-every-lane.md`).

**Decided: `dagster/priority: 1` on both jobs' `run_tags`.** `QueuedRunCoordinator` sorts by it
before checking pools (`_priority_sort`, dagster 1.13.22), so each lane waits at most one price run.
This is rule 1 again: a documented Dagster feature, one tag. The pool-granularity question stays
open in its own note. This change removes the symptom without deciding it.

## 3. A day Yahoo fills late was re-read only by accident

**Measured.** Yahoo's 09-22 bar was still `null` two days later for KO, CZR, EMBC and PRAA while
MSFT, SPY and JPM had it. An extension started at its cohort's oldest watermark, so such a day was
re-read only if a cohort-mate happened to be behind it.

**Decided: re-read a trailing week** (`REREAD = timedelta(days=7)` behind the oldest watermark).
- It costs bytes, not requests: the vendor is asked once per ticker whatever the range.
- The sweep reaches each security every ~5 nights, so a gap near the watermark gets a second look.
- The raw merge and the core upsert both let the new bar supersede the old one.
- Rule 6 holds: still an extension from what raw holds, never a re-fetch of the history.

## 4. The Yahoo rung, measured on a sample

This is the plan in `docs/deferred/2026-09-24-the-yahoo-rung-is-an-operator-backfill.md`, unchanged:
1. Backfill ~50 `NEEDS_SYMBOL` partitions of `raw_yahoo_symbol` + `security_symbology`, well away
   from the sweep.
2. Read the rung's counters and adoption.
3. Read the next night's `throttled` / `unasked`.

**The symbol probes must first say which provider answered.** `plan_symbols` labels every symbol
probe `openfigi`, including a hit that came from Yahoo's search. The probe key is
`(security_id, scheme, provider)`, so a Yahoo miss would also overwrite the OpenFIGI local rung's
miss. The rule applied is rule 5 (failed ≠ empty ≠ throttled ≠ dead): an observation must name who
was asked. This lands as its own PR before the sample runs.

## Verification

- **Before the PR.** The new schedule code was evaluated read-only against production's run
  storage:
  - tonight resumes at 4800, as 100 runs of 25;
  - re-evaluating 09-25 resumes at 5871, where the old rule chose 2300.
- **Mutation proof.** 13 mutations, each caught. Two fixtures first passed with their rule deleted:
  over a constant grid the date rule lands on the same keys. Both now grow the grid between nights.
- **Live, still to do.**
  - The first scheduled night: its runs carry the new tags, it starts at 4800, and the FX and
    index lanes wait at most one price run.
  - A week of nights: no night re-sweeps the previous one.
  - The first extension of a security with a gap re-reads it.

## Out of scope

- Pool granularity (the deferred note above).
- Stalest-first ordering.
- Anything about how many securities a night asks for. `SWEEP_SLICE` is unchanged.
