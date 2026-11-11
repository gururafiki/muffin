# 3,094 half-years sit in `security_statement` as quarters

Created 2026-10-10 · Due after the edge's `security-quarters` retires (Phase 4 step 9, done
2026-10-18) · Status: open, **measured 2026-11-11, waiting on the user's choice of fix** (below).

**The measurement changed what this note is about.** Of 12,679 flagged rows, 73% are quarters
Yahoo does not carry (the rows around the hole are right), 14% are balance sheets at half-year
ends (right under either label), and 13% are the edge's duplicates this note was written for.
Almost none is a six-month flow shown as three months: 32 income and cash rows.

## Measured 2026-11-11 ~19:40 UTC, read-only

12,679 yfinance `quarter` rows (8,446 periods, 5,900 securities) sit 170-195 days after the previous
row of the same statement. It was 12,848 over 5,983 on 11-09. Split by the security's own series:

| Class | Securities | Flagged rows | What it is |
|---|---|---|---|
| **C.** Quarterly series with a 180-day gap | 4,253 | 9,229 | **A quarter Yahoo does not carry.** The rows either side are three-month rows |
| **B.** Only half-year gaps, no `half` row | 849 | 1,745 (1,684 balance) | Balance sheets at half-year ends, filed `quarter` by the lane |
| **A1.** `half` rows filed, no 90-day gap | 806 | 1,699 | The edge's `quarter` rows beside the lane's `half` rows |
| **A2.** `half` rows filed, and 90-day gaps | 11 | 6 | Quarterly reporters the lane once filed as half-yearly |

**Class C is Yahoo's own hole, not a gap between two windows.**
- 7,565 of the 9,229 rows are the step 2025-06-30 -> 2025-12-31: the third quarter of 2025 is
  missing. 2,268 of those securities are Chinese, then India 250, Taiwan 127, Sweden 122.
- 600011.SS's stored Yahoo document lists 2025-03-31, 06-30, 12-31, 2026-03-31 and 06-30, and no
  2025-09-30 at all. Its 2025-12-31 row is three months: revenue 56.31 bn of a 229.29 bn year
  (60.33 + 51.70 + 56.31, which leaves 60.95 bn for the missing quarter).
- Another source holds the missing quarter for 172 of the 9,229 rows.
- **These rows are right and need no repair.** What the hole costs is the TTM: four quarters
  within 240-300 days cannot form across it, so those companies' ratios stand on the fiscal year.

**Class B is how Yahoo serves a half-year reporter.** G.MI (Generali) and 1860.HK: the quarterly
document holds full balance sheets at 06-30 and 12-31 (52-58 lines), and at 03-31 and 09-30 a
four-line income stub (basic and diluted EPS, the two share counts). The union of period ends is
quarterly, so `cadence` says `quarter`. No six-month flow is involved: these companies have no
quarterly income row at the half-year ends at all. A balance sheet is an instant, so its values
are right under either label.

**Class A1 is the defect this note was written for.**
- 2,542 `quarter` rows in 806 securities (2,510 balance, 28 income, 4 cash). NESN.SW and CBA.AX
  are among them.
- 2,002 have a `half` twin at the same key. The other 540 are periods older than Yahoo's window,
  which the lane never re-filed.
- 17,724 yfinance and 1,902 derived `quarter` metrics hang off these securities. Since
  muffin-deployment#499, deleting a statement removes the metrics derived from it.
- **The cadence flips between visits and neither write retracts the other.** In 26 of these
  securities the lane itself wrote both rows of a pair: the `half` row later in 30 pairs, the
  `quarter` row later in 24.

**Class A2 is the same flip, the other way.** 1419.T's first document (10-20) listed three period
ends 180 days apart, so the lane filed `half`. A week later Yahoo listed seven, 90 days apart, and
the lane filed `quarter`. 35 wrong `half` rows remain beside the right `quarter` rows in 11
securities.

955 further `half` rows belong to securities with no yfinance `quarter` row at all. Those are
clean.

## The fix, with options (for the user)

1. **Repair the duplicates (classes A1 and A2).**
   - **Convert or delete (recommended).** A one-shot that, for a security whose series is
     half-yearly, deletes each yfinance `quarter` row with a `half` twin (2,002) and re-labels
     the 540 without one as `half`, so the older balance sheets are kept. For A2, delete the 35
     `half` rows that have a `quarter` twin.
   - **Delete all 2,542**, as this note first planned. Simpler, and it drops 540 older balance
     sheets nothing will re-fetch.
2. **Stop the flip from leaving two rows (the lane).**
   - **Retract the twin (recommended).** When stage 2 files a period under one type, it retracts
     the yfinance row of the other type at the same security, statement and period end. One row
     per period whichever way the cadence reads. Without this, repair 1 is undone at the next
     flip.
   - **Judge the cadence from stored history** instead of the current document. Stable, and a
     wrong first reading then never corrects itself.
3. **Class B: leave as it is (recommended).** The values are right. Filing those balance sheets
   as `half` would need a per-statement cadence that ignores stub periods, for a label only.
4. **Class C: optional, and a new derivation.** Derive the one missing quarter of a fiscal year
   as the year less its three quarters, as `derived-q4` already does for SEC's fourth quarter.
   It would give ~2,000 Chinese companies a TTM across 2025. To be measured and decided with the
   derived family (Phase 7).

## Why it was deferred (2026-10-10)

The edge's `security-quarters` asked openbb for `period=quarter`, and Yahoo labels a half-year `3M`,
so semi-annual reporters were filed as quarters. Measured 2026-10-10: 3,094 yfinance `quarter`
periods in 2,192 securities sit 170–195 days after the previous one (VOD.L, NESN.SW and BHP.AX
among them). The app shows them in the quarterly tables as if they were three months.

`derive_ttm` is not fooled: four of them span about 18 months, past its 370-day window, so no TTM is
formed from them. The damage is the quarterly table, and the metrics derived from those rows.

The company lane (Phase 4 step 6, muffin-ingest#107) files a half as `period_type = 'half'`, told
from a quarter by the CADENCE of the company's quarterly series. That is half-yearly only if every
gap between period ends is 170–195 days. It does NOT retract the edge's `quarter` row, which sits
beside the `half` row for the same period until this repair runs. That leaves two problems a one-shot
has to finish:
- the edge's `security-quarters` would re-queue a company whose quarter rows disappear and write them
  back, which is why `pending_quarters` now also counts `half` rows (migration
  `20261010220000_sec_depth_is_asked_of_every_cik_holder`), and why the repair waits for the
  resource to retire;
- periods older than the window Yahoo now returns are never re-filed, so the lane cannot retract them.

## What to do (as planned 2026-10-10; superseded by the options above)

After `security-quarters` is retired (410, no `refresh_run` rows):
1. A `market.one_shot` migration that deletes the yfinance `quarter` statement rows of every
   security the lane has filed a `half` row for (its cadence is half-yearly), plus the
   `security_metric` rows derived from them (`period_type = 'quarter'`, the same security and
   `as_of`, sources `yfinance` and `derived`).
   **Not by the gap of each row.** Corrected 2026-10-11: 2,210 securities have a 170–195-day gap
   in their Yahoo quarter series, and 1,451 of them also have 90-day gaps. They are quarterly
   reporters missing a quarter (600011.SS 2025-12-31, 184 days after 2025-06-30, a three-month
   income statement), and a per-row rule would delete their real quarters.
   TTMs need no repair: since muffin-deployment#428 a TTM needs four quarters within 240–300 days,
   which half-year spacing never meets, and a re-evaluation retracts any that remain.
2. Count before and after, and name five securities to check on the stock page.

## Done when

No yfinance statement period is held as both `quarter` and `half`, and the quarterly tables of
NESN.SW and CBA.AX show halves under their own label or nothing. (Reworded 2026-11-11: "no
`quarter` row 170-195 days after its predecessor" cannot be met, because 9,229 such rows are
correct quarters either side of a quarter Yahoo does not carry.)
