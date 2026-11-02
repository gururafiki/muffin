# A quarter is derived from year-to-date facts

Created 2026-11-02 · Planned in [the SEC spec](../specs/2026-10-24-sec-family.md) (*Deferred
notes*) · Status: open, **the user decides where it is built**

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
