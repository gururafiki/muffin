# A throttled daily price run still materialises its partition

Created 2026-09-17 · **Due 2026-09-20** · Status: counter fixed and VERIFIED (muffin-ingest#40);
**the pacing decision did NOT hold — measured 2026-09-19, decision reopened**

## Decision (2026-09-17)

Option **B**, pace to the measured rate: `Yfinance.min_seconds_between_calls` 1.0 → 4.0 (~15
calls/min; the 09-17 recovery ran at that rate with `throttled=0`). Shipped in muffin-ingest#42
(rolled 11:42 UTC). The check stays WARN. Options A and C return only if nights still throttle.

## The answer to "what is the most Dagster-native way" (2026-09-19)

Asked by the user, answered from the 1.13.22 source rather than from memory. **Dagster's only
per-item primitive is the partition grid, and it cannot carry this**: securities x days is 12,350 x N
against a practical ceiling near 25,000 partitions, and rule 6 forbids a date x subject grid because
a materialised cell would claim one security's day. There is no Dagster feature that tracks which of
12,350 subjects inside partition 09-18 are done — that gap is why the ledger exists at all. The two
halves AROUND it are native, and today neither is used:

1. **The trigger to come back is an automation condition over the check we already have.**
   `AutomationCondition.any_checks_match(AutomationCondition.check_failed())`
   (`automation_condition.py:467` and `:623`) re-requests exactly the partition whose check failed.
   `every_askable_security_was_asked` is that check; it has to become partition-aware (it reads the
   latest materialization globally today) and rise from WARN to ERROR. Bound it with
   `~in_progress()` and `in_latest_time_window(7 days)` so it chases recent days and never the whole
   history. No sensor, no cursor, no retry loop of ours.
2. **The "already done" set is the ledger, which already records it.** `ledger.record` calls
   `ingest.complete(facet, subject, outcome, ...)` for every subject in every batch, and that
   function already takes a watermark the price lane passes as `null`. The change is to pass the
   window end and add one predicate to `ASKABLE_SUBJECTS`. One argument and one clause, in machinery
   built for this — not a new subsystem.

**The one real cost, and it is the open question.** `ParquetIOManager` REPLACES a partition's file
by design ("appending would make a re-run silently double the data"), so a resumed run that asks
only the remainder would overwrite Friday's 2,320 securities of raw with the remainder. Two ways
out, and the user's call:
- **(a) Union at subject granularity** — the asset reads the existing partition file and writes the
  union, the newer answer winning per SUBJECT instead of per partition. One file per partition
  survives, ~15 lines. Recommended.
- **(b) One file per run inside a partition directory** — append-only, truer to "raw is the
  provider's answer whole", but needs a custom `handle_output`/`load_input` pair and every stage-2
  reader changes.

Net effect: no new state store, Dagster does the re-requesting, and a throttled night leaves a red
check that clears itself over the following runs — which is C and D taken together, with the parts
each of them would have hand-rolled supplied by Dagster and by the ledger.

## What the three nights showed (2026-09-19)

- **09-18 00:00 (partition 09-17): the decision worked.** 602 calls, `answered=11282 empty=739
  throttled=0 unasked=0` against `subjects=12021`, 2,447 s. The counters sum to `subjects` exactly,
  which is muffin-ingest#40 doing its job.
- **09-19 00:00 (partition 09-18): refused at call 138 of ~613.** `answered=2320 empty=420
  throttled=1 unasked=9516` — again summing exactly to `subjects=12256` — and the partition
  materialised with **2,320 bars for a Friday** against ~11.5k on a normal day.
- **The recovery re-run at 10:42 UTC hit the identical wall: `calls=138`, `unasked=9516`, 2,460
  bars.** Same count, ten hours later, at the same 4 s pacing. So this is not the hour, not the
  night's cumulative volume, and not a pace the run controls: between 09-18 and 09-19 the provider's
  tolerance for this node fell from 602 calls to ~138 (~1,650 symbols).
- **A single call still works.** Driven through the deployed container at 12:5x UTC on 09-19, hours
  after the second refusal: `price_history(["AAPL"], 2026-09-18)` returned 1 row, no warnings. So
  this is a volume limit that trips after ~138 calls, not a standing block on the node — which is
  what makes **D** (resume where the refusal happened) a real option rather than a hope. One
  successful call says the door is open, not how wide.
- Consequence: `market.price_bar` holds **2,460 rows for 2026-09-18** against 11,282 for 09-17, and
  `security_return` rebuilt off the partial day. A second recovery was NOT launched: hammering a
  refusing provider drains less, which this repo has already paid for once.

## Why it is deferred

muffin-ingest#40 makes the run honest: the refused batch and everything after it count as
`unasked`, so `every_askable_security_was_asked` goes red. What the run should *do* when refused is a
trade between provider budget, freshness and how the partition grid reads, so it is the user's call.

## Context

- **Measured on the 2026-09-16 partition (run `715014c3`, 00:01–00:08 UTC 09-17):** 329 calls in
  467 s (~42 calls/min, batches of 20). yfinance refused call 329, so 5,437 of 12,017 securities
  were never asked, and `price_bar` held 5,974 bars for the day. The run succeeded and the partition
  materialised.
- The four-day backfill `xawjhtlx` on 09-16 made 601 calls in 2,564 s (~14/min) and was never
  throttled. Its responses were larger, so each call took longer. The pace that matters is calls
  per minute, not calls per run.
- `Yfinance.min_seconds_between_calls` is the only pacing. The check is `WARN` and non-blocking, so
  even after #40 a throttled night materialises with a red check and a half-empty day.
- **The 2026-09-11 partition was never materialised**, because no run covered it. The schedule's
  first tick was 2026-09-13 00:00, for 09-12, and those ticks failed until 09-16. The 4,808 bars
  `price_bar` held for 09-11 came from other runs (history lane or hand-runs; not attributed).
  Recovered by `hsctpnih` (09-11..09-16).

## What to do

1. Decide with the user — the options are now these, with B removed because it was tried:
   - **A. Fail the partition on a throttle.** Raise `dg.RetryRequested(max_retries=…,
     seconds_to_wait=…)` so Dagster retries later. Honest grid; the retry re-asks every subject,
     roughly doubling that night's calls.
   - ~~**B. Pace to the measured limit.**~~ Shipped 09-17 at 4 s/call and **falsified 09-19**: two
     runs ten hours apart both stopped at exactly 138 calls. A rate this side controls cannot buy a
     budget the other side has withdrawn.
   - **D. Resume where the refusal happened.** A cursor over the day's subjects, so the next run —
     scheduled or a retry — asks only the `unasked` remainder instead of restarting at the top of
     the weight order. Needs the ledger rather than a counter, and makes a full day take several
     runs, which is what a shrinking budget implies whatever else is chosen.
   - **C. Materialise, but raise the check to `ERROR`** and add a "re-ask only the unasked" path via
     the ledger. Cheapest in calls, and the most code.
2. After the choice, prove it with a test where the fake provider refuses mid-run.
3. Whatever is chosen, re-measure the provider's actual allowance first: the 602-vs-138 collapse
   between two consecutive nights is the input every option is sized against, and one more
   observation says whether it is a new steady state or a temporary block.

## Done when

A night the provider refuses either retries to completion or leaves the partition visibly incomplete,
and three consecutive nights show `unasked=0` with full bar counts.
