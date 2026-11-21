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

**Step 4: the re-read, read 2026-11-21 21:00 UTC (not yet closed).**
- `hvohykxa` (SEC, `raw_sec_instance` + `sec_segment` over the grid): 75 of 75 SUCCESS, counters
  summing, 0 failed. 7,899 filings named: 6,491 read, 15 with no instance, 5 too large, and 1,388
  not held (1,378 unasked under the byte budget, 10 refused). **No SEC filing is left behind the
  parser (6,550 to 0).** The unasked ones are other due filings (amendments, the regular waves),
  which `sec_segments_due` reaches.
- `nwrcalhq` (DART, 32 filers) and `yxhkjyms` (NSE, 4 filers) re-read nothing: all 37 and 6
  filings were `not_held`. Raw holds no instance for them, so a stage-2-only re-read cannot reach
  them. DART stage 1 pass 4 (`smfrbgvz`) and an NSE stage 1 + 2 run over the four filers
  (`pfetfdmg`) were launched at 20:55, priority −1.
- `check_segments_reconcile.py` against production: **passes** (exit 0). 9 served splits over
  their target (1.12%, tripwire 2.5%); historical bands at 1.22%, 1.75%, 0.38% and 1.20%.
- Served non-positive revenue splits: **41 behind the parser** (the DART and NSE filings above)
  and **14 not**: SEC filings the current parser re-read this evening (version 20) that still
  serve partition-1 revenue summing to 0 or less:
  - Supernus: a 2021 10-Q states 2020 comparatives of 0 for three products it did not yet own.
    Those rows carry partition 1 and the period's other products belong to the 2020 filing, so
    the newest-filing view serves 0. The split itself, across both filings, reconciles to
    94,976,000.
  - Navient: two 2025 10-Qs, a revenue member of 0 at partition 1 (one with `reconciled_to` 0).
  - 0001610520: two 20-Fs, a one-member negative split against a positive target.

  #185 demotes an inherited revenue split summing to zero or less, so these rows should be at
  partition 0. Why the parser still emits partition 1 for them is being reproduced on the stored
  instances.

**Step 5: why the 14 survive, read 2026-11-21 21:30 UTC.** The current parser never saw them. All
14 rows date from the edge (`as_of` 08-30 to 09-22) and sit on filings the Dagster lane stamped at
version 20 this evening. In both cases below, stage 2 calls `file_filing(facts=None)`, which marks
the filing and writes and retracts nothing (`sec_edgar.fetch_instance`, `segment_tables`).

- **12 are filed under a predecessor CIK** (Supernus 10, Navient 2). `index.json` answers 200 under
  the security's current CIK and names the instance, but the instance itself answers **404**, so
  the outcome is `absent`. Checked directly:
  - Supernus's 2021 Q1 instance: 200 under 1356576, 404 under 1625297;
  - Navient's 2025 Q2 instance: 200 under 1593538, 404 under 2152623.

  `index.json` echoes whatever CIK the path names, so it cannot reveal the right one. The
  securities' CIKs follow SEC's own map. `company_tickers.json` (11-16) lists SUPN **and** INDV
  under 1625297, titled "Supernus, Inc.", and no longer lists 1356576. Navient's 2152623 is its 2025
  holding company.
- **2 are over the 32 MB gate** (UBS 20-Fs for 2017 and 2018). The edge read them on 08-30, two days
  before its own gate existed.

**How many filings this covers.** From every filer's newest raw answer: 116 SEC filings are
unreadable now.

| Kind | Filings | Filers | Filings carrying rows | Segment rows |
|---|---|---|---|---|
| Instance listed, 404 under the current CIK | 42 | 3 (Navient 24, Supernus 14, Real Brokerage 4) | 21 | 321 (304 at a served partition) |
| Too large | 60 | 28 | 2 (UBS) | 8 |
| No instance listed | 14 | 14 | 0 | 0 |

Two defects follow:
- **A 404 at the wrong address is recorded as an absence.** The filing is marked read at the
  current version, so nothing asks again until the version is bumped. This is "a wrong name is not
  a missing security", in a new lane.
- **A filing the lane cannot read keeps whatever the edge wrote.** For 21 of these 23 filings
  that is the filing's genuine content, read by an older parser. 14 of the served splits among them
  are non-positive.

**Decision for the user** (asked 2026-11-21): what happens to rows on filings the lane cannot
read, and whether the lane learns to read a filing under the CIK that filed it.
- (a) Recommended: record the filer CIK per filing and read each filing from it, so a re-read
  rewrites these with the current parser; demote the two UBS splits with a one-shot.
- (b) Keep the rows and demote only the 14 non-positive splits, mirroring #185.
- (c) Retract every row no current read can reproduce: 329 rows on 23 filings.

## Done when

The cause of the rise is named. No served revenue split has a non-positive `reconciled_to`. The
historical tripwire is set from the per-year measurement, not from one reading.
