# A report dated days before its filing is not a year end either

**Decided 2026-11-01 (the user): option 1. Built in muffin-ingest#160, rolled 19:26 UTC.** An annual
or transition report dated 14 days or less before its filing, or after it, names no year end. Not
for a 10-Q: measured before building, quarterly reports are filed fast (91 month-end quarter ends
at 8-14 days, 1,647 at 15-21), so a 10-Q keeps the same-day rule. Forward Air joins the fiscal
fixture: one December calendar where a February one stood. The collected grid was re-parsed from
disk the same evening (backfill `cpwohusz`).

**Found 2026-11-01**, checking the CIK grid's re-parse after muffin-ingest#159.

## Why

muffin-ingest#159 stopped the fiscal calendar from reading a `reportDate` equal to the filing date
as a year end. Equinor's seventeen such 20-Fs had built a March calendar and a 25-day year whose
second half ended before it started. The re-parse of the 1,601 collected filers then dropped 640
such reports and wrote 0 inverted periods.

The same defect also comes in a second form: a report date a few days BEFORE the filing date. SEC
records some filings with a date near the filing (a signing date, say) instead of the period end.
The annual reports held in production, by days from report date to filing date:

| Days | Month-end report date | Other report date |
|---|---|---|
| 0 (handled by #159) | 30 | 203 |
| 1-7 | 5 | 107 |
| 8-14 | 1 | 13 |
| 15-21 | 8 | 7 |
| 22-28 | 120 | 42 |
| 29-45 | 3,640 | 333 |
| over 45 | 46,505 | 4,759 |

A company does not file audited annual accounts within two weeks of closing its year, so the 126
reports at 1-14 days are almost all filing-adjacent dates. Non-month-end dates beyond 45 days are
normal: they are 52/53-week years (Apple's Saturdays).

## What they do today

Measured after the re-parse:

- **Reach:** 21 securities, 27 regimes and 157 canonical periods. Every such canonical year ends
  between 2003 and 2014, mostly before XBRL. Examples: Forward Air (February 2008-2009),
  Interface (March 2007-2010), Gildan (February 2004-2005), Alico (November 2005).
- **Labels:** they label exactly one statement row. RCM Technologies' balance sheet at 2011-04-02
  is labelled FY2011 Q1, which is the right label. Its period runs from 2011-02-23, a near-filing
  date, so the period's span is wrong.
- **What else they distort:** `calendar_year_end_changes` (93 in the re-parse) and the regime list,
  which overstate year-end changes.

## Options

1. **Widen #159's rule to a window:** a report filed within 14 days of its date states no period.
   This drops the 126 above. The bucket of 15-21 days is mixed (8 month-end, 7 not), so 14 is the
   last cut the data supports cleanly.
2. **Take the year end from the accession's own facts** where it has an annual span, and use the
   report date only where there are none. This repairs the XBRL years whatever the report date
   says, but leaves the pre-XBRL ones, which is where nearly all of these are.
3. **Leave it.** No served label is wrong today.

## Done when

The user picks an option. For 1 or 2: the rule ships with a fixture that makes the old and new rules
disagree, and stage 2 is re-parsed with `--op-config sec_filer_facts.reparse=true` over the grid,
with no SEC request. Then the query in this note returns 0 regimes.

## Context

- muffin-ingest#159; the SEC spec's *Step 8* (`docs/specs/2026-10-24-sec-family.md`).
- `libs/muffin-ingest-lib/src/muffin_ingest/facets/fiscal.py`, `calendar_from_sec` step 0 and
  `_stray`.
