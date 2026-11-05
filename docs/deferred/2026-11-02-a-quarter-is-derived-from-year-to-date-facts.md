# A quarter is derived from year-to-date facts

Created 2026-11-02 · Planned in [the SEC spec](../specs/2026-10-24-sec-family.md) (*Deferred
notes*) · Status: **Decided 2026-11-04 (the user):** option 1, in stage 2 (`sec_facts`), marked as computed. **Built:** muffin-deployment#491 (the source) and muffin-ingest#163 (the rule). Deploy #491 before rolling #163.

## As built, 2026-11-04

- **The rule.** Q2 = H1 - Q1 and Q3 = 9M - H1, for a quarterly filer's money lines, only where no
  three-month figure is stated. Both terms come from one concept.
- **The marker.** Rows carry the source `sec-xbrl-ytd` at priority 45, below a provider's stated
  figure, as `derived-q4` is.
- **ONE VINTAGE, NOT EACH TERM'S LATEST FILING.** The minuend is its latest filing; the subtrahend is
  the figure as it stood at that filing. Pairing a restated Q1 with an unrestated half year put one
  quarter at +7.0m against a restated -0.5m.
- **Measured over 250 production filers** (read-only, the branch's reader):

  | Operating cash flow quarters | Before | After |
  |---|---|---|
  | Q1 | 2,828 | 2,828 |
  | Q2 | 59 | 2,826 |
  | Q3 | 43 | 2,786 |

  - Against Yahoo's stated quarters: 627 of 636 within 1%.
  - Against SEC's own stated quarters: 33,053 agree and 1,501 differ, mostly restatements and
    recasts. Those quarters keep their stated figure.
- **The guard** is the stage-2 comparison wherever a figure is stated (`ytd_agrees`,
  `ytd_disagrees`, in each run's metadata), plus the captured filers' test.
- **Before**, for the TTM comparison: 10,382 TTM free-cash-flow rows over 3,351 SEC filers.

## Live, 2026-11-04 22:19 UTC

Five filers re-parsed from stored raw (backfill `xuzbjufe`, no SEC request), after #491's deploy and
#163's roll:

| Filer | Lines computed | Computed cash quarters written | TTM free cash flow rows |
|---|---|---|---|
| AAPL | 130-154 | 36 | 2 -> 45 (2014-2026) |
| COST | 130-154 | 36 | -> 61 |
| CIK 1367644 | 130-154 | 31 | -> 44 |
| MSFT | 0 | 0 (it states its quarters) | |
| TSM | 0 | 0 (20-F, not a quarterly filer) | |

- Every computed row is labelled and derived, and the TTM derivation drained (`ttm_backlog_after` 0).
- AAPL's computed operating cash flow equals Yahoo's to the dollar for the quarters both hold:
  27.867, 28.702 and 34.369 bn.
- The whole grid is re-parsed in the next SEC window.

## The first weekday tick, 2026-11-05, and a TTM that did not form

- **The tick.** 584 filers parsed under the rule, and 49,098 lines computed. Against stated
  figures, 83,228 agree and 3,630 differ, 4.2% as probed. 13,205 computed rows now cover 530
  securities.
- **The counts for SEC filers:**

  | | Before | After |
  |---|---|---|
  | TTM free cash flow | 10,382 | 21,703 |
  | Quarterly operating cash flow | 55,768 | 67,608 |
  | TTM operating cash flow | 11,746 | 12,372 |

  The last barely moved. AAPL held 45 TTM free-cash-flow rows and 4 of operating cash flow.
- **The cause.** `derive_ttm` derives the fiscal fourth quarter as the year less its three
  quarters, and required the quarters to share the year's source. The year is `sec-xbrl`, while Q2
  and Q3 are now `sec-xbrl-ytd`. Free cash flow escaped only because its quarters and year are all
  `derived`.
- **The fix, muffin-deployment#493.** `data_source.computed_from` (`sec-xbrl-ytd` -> `sec-xbrl`) and
  the fourth quarter accepting either source; the 524 affected filers are re-queued.
- **Rolled back on production:** AAPL's TTM operating cash flow went 4 -> 69 rows (2009-2026), equal
  to the filed annual at every year end; COST 1 -> 61; CIK 1367644 4 -> 52.

**The lesson:** a derivation that groups by source must know which sources are computed from which.
The five-filer subset looked complete because it was read for free cash flow, not operating cash
flow.

## Why

A 10-Q states the cash-flow statement year to date: six months in Q2, nine in Q3. The 10-K
states the year. `facets/sec_facts.py` writes a fact only for a canonical period of the filer's
calendar, so it refuses a year-to-date duration and counts it as `ytd`. That rule is right: a
six-month figure stored as a quarter would be wrong by a factor of two. The cost is that SEC's
quarterly cash flow is mostly Q1. Measured on production 2026-11-02, `sec-xbrl` quarterly
statement rows by fiscal period:

| Statement | Q1 | Q2 | Q3 | Q4 |
|---|---|---|---|---|
| income | 38,328 | 40,065 | 38,446 | 17,784 |
| balance | 37,763 | 39,297 | 37,972 | 46,054 |
| cash | 37,780 | **17,247** | **16,420** | **726** |

Income and balance sheets are complete, because 10-Qs state three months and instants. Cash flow
has a Q2 or Q3 only where the filer also tagged the three-month figure. The CIK grid's runs refused
5,027,674 year-to-date facts in all (summed from the runs' metadata).

The TTM of a cash-flow line needs four consecutive quarters, so a SEC filer's TTM free cash flow
comes from Yahoo's five quarters where they exist. How many TTM rows this costs is not measured.

## What to do

The calendar now gives every filer its period starts and ends, so the difference is safe to take:
Q2 = H1 − Q1, Q3 = 9M − H1, and Q4 = FY − 9M, each within one filing's own facts or across
filings by the same calendar. Two places it could live:

1. **Stage 2, in `sec_facts`** (recommended): the year-to-date facts and the calendar are both
   there, and a derived quarter can carry the filing it came from. It needs a marker that the row
   was computed (a computed row must say so; see CLAUDE.md, "capex sign differs by provider").
2. **The derivation (`derive_security_metrics`)**: only metrics, not statement rows, so the
   statement table would still show the gap.

Either way, `derive_ttm` already derives a missing fiscal Q4 from the year (`derived-q4`), so
only Q2 and Q3 are new.

## Done when

- SEC cash-flow Q2 and Q3 counts are within a few percent of Q1's.
- A guard compares a derived quarter with a filer that tags the three-month figure itself.
- The TTM free-cash-flow count for SEC filers is measured before and after.

## Context

- `muffin-ingest/libs/muffin-ingest-lib/src/muffin_ingest/facets/sec_facts.py` (`_classify`,
  `ytd`).
- The SEC spec's *Step 3* and *Step 8*; `todos.md`, Phase 5.
