# The historical segment backlog is rising, and some splits are accepted against no revenue

Created 2026-10-04 · Status: open, belongs to the segments family (Phase 6). **Planned 2026-11-09:** the restored
`segments_reconcile` check measures it (spec step 7); changing the parser rule is decided after.

## Why

`check_segments_reconcile.py` (muffin-deployment, market-verify step 9b) re-checks each sampled
split against `reconciled_to`, the figure the parser accepted it against. It splits the
disagreements in two:

- **served**: the newest period a reader is shown;
- **historical**: older periods, not served.

From 2026-10-04 both are tripwires on a RATE over the splits re-checked, because the denominator
moves sixfold with the sample. Measured over fifteen runs:

| runs | splits re-checked | served rate | historical rate |
|---|---|---|---|
| 09-08 | 3,628 | 0.41% | 4.1% |
| 09-09 to 09-26 (13 runs) | 880 to 3,895 | 0.27% to 0.91% | 9.2% to 15.6% |
| 10-04 | 5,245 | 0.69% | **20.7%** |

The parser has been version 20 since 2026-09-06, so every run measured the same code. The served
rate is flat. The historical rate has risen every week. The likely reading is that the drain
(~5,000 filings parsed a day) has reached older filings, whose dimensional tagging is messier.
That is **unconfirmed**: the sample is the 80 most recently written securities, so a mix shift
and a regression look the same in one number.

The 10-04 sample also showed a served defect that is not a mix effect. Some splits are accepted
against a target that is not a revenue at all:

- Capital One (`2bc6f097`), annual 2023-12-31 and quarter 2026-06-30: `accepted against=0`;
- Blackstone (`3f789840`), annual 2018-12-31: split 3,036,452,000 `accepted against=-89,468,000`.

A revenue split reconciled to zero or to a negative figure was not reconciled. The parser should
not have accepted it.

## Context

- muffin-deployment#420 (this change): the rates and their thresholds (served 1.25%,
  historical 25%).
- CLAUDE.md, "THE REMAINING 32 ARE A WRONG RECONCILIATION TARGET, NOT A WRONG SPLIT" (GE Vernova:
  $30.1bn against a recorded $487m), the class these belong to.
- `segments.ts` `assignPartitions` and the derived-target candidates (the 2026-09-05 Southern
  Copper note), where a target is chosen.

## What to do

1. Run the check once deep, with `SEGMENT_SAMPLE_SECURITIES=400`, and group the historical
   disagreements by the period's year. A rate flat within each year, with the mix moving to older
   years, means it is the drain. A rate rising within a year means a regression.
2. Count, over the whole served table, the revenue splits whose `reconciled_to` is `<= 0`. Then
   find where the parser accepts such a target, and refuse it. A non-positive revenue cannot be the
   total of a split.
3. Re-derive the historical tripwire from step 1's per-year rates.

## Measured and built, 2026-11-21

**Step 1: the cause is the input mix, not a regression.** Over the whole table (revenue, partition 1,
flat), rather than an 80-security sample:

| Period year | Over its target | Non-positive | Under its target |
|---|---|---|---|
| before 2016 | 2.12% | 3.94% | 16.76% |
| 2016–19 | 1.36% | 2.26% | 7.56% |
| 2020–23 | 1.07% | 2.83% | 9.82% |
| 2024 onward | 0.96% | 2.88% | 6.97% |
| served | 0.95% | 1.56% | 1.73% |

- The parser was one deterministic function at one version, so a filing's result could not change.
- Older filings disagree more, and the check's sample (the most recently written securities)
  followed the edge's drain to older filings.
- Within each band, rows Dagster wrote disagree 2.8–4.2% of the time against 10.6–22% for rows the
  edge wrote. These are different populations of filings, not different code.
- On 11-21 the same sample read **0 of 6,367**, because it was all Chinese companies from that day's
  CNINFO drain. The sample measured whichever lane wrote last.
- **85% of what the check called disagreements were partial splits:** a bucket inherits its
  partition from the bucket placing the most members, or a filer discloses part of itself. Those
  are served on purpose, and the UI names the remainder.

**Step 2: non-positive targets are refused.**
- muffin-ingest#185 (merged 2026-11-21) refuses a revenue target of zero or less and unplaces an
  inherited revenue split totalling zero or less. Segment operating income is untouched, since it
  legitimately reconciles to a loss.
- muffin-deployment#526 re-queues the filings holding one: 6,593 (SEC 6,550, DART 37, NSE 6). In a
  rolled-back dry run, all 4,752 such splits in `security_segment_latest` became stale.

**Step 3: tripwires per year band**, in #526's `check_segments_reconcile.py`:
- it samples 80 securities per regulator;
- it fails on any current-parser non-positive split;
- it fails on over-coverage served above 2.5%, or historical above 4% / 3% / 2.5% / 2.5% by band
  (about twice the measured rates);
- it reports under-coverage and never fails on it.

## Done when

The cause of the rise is named. No served revenue split has a non-positive `reconciled_to`. The
historical tripwire is set from the per-year measurement, not from one reading.
