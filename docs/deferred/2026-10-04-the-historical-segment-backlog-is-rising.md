# The historical segment backlog is rising, and some splits are accepted against no revenue

Created 2026-10-04 · Status: open, belongs to the segments family (Phase 6).

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

## Done when

The cause of the rise is named. No served revenue split has a non-positive `reconciled_to`. The
historical tripwire is set from the per-year measurement, not from one reading.
