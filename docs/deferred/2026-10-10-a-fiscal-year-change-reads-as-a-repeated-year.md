# A fiscal-year change reads as the same year reported twice

Created 2026-10-10 · Due with Phase 5 (SEC and the fiscal-period model) · Status: open, tripwired

## Why it is deferred

`check_one_period_one_point.py` (market-verify) fails on annual revenue rows 8-299 days apart for
one security. It read a rotating sixteenth of the universe, so it went red or green with the day's
digit on unchanged data: red 2026-10-06, 10-08, 10-09 and 10-10. Counted over the whole table on
2026-10-10, there are **113 such pairs in 56 securities**, out of 75,018 annual revenue rows for
12,002 securities. They are not one fiscal year reported twice. Read row by row, they are company
events the model cannot express yet:

| Security | Rows | What it is |
|---|---|---|
| Greif | sec-xbrl FY 2024-10-31 and 2024-09-30, then 2025-09-30 | fiscal year moved from October to September; a recast twelve months beside the old year |
| Mistras Group | sec-xbrl 2016-05-31, then 2016-12-31 | fiscal year moved from May to December; a seven-month transition period |
| Bristow Group | sec-xbrl alternating 03-31 and 12-31 from 2018 | the Era Group merger: one CIK carries both companies' calendars |
| ESCO Technologies | sec-xbrl "annual" 2019-07-02 of $37M | a mis-tagged fact (an acquired business's revenue) |
| TIC Solutions | yfinance 2023-11-30 of 0 | a zero from Yahoo |

Fixing them needs a fiscal-period dimension (which period a row is, not just where it ends), which
the user deferred to Phase 5 on 2026-10-10.

## Context

- The check: `muffin-deployment/.github/scripts/check_one_period_one_point.py`. Its raw half now
  pages the whole table and fails only above `KNOWN_DRIFTED_PAIRS = 113`.
- Phase 4 spec: [2026-10-10-yahoo-company-data.md](../specs/2026-10-10-yahoo-company-data.md)
  (decision 6, the fiscal period deferred).
- The query, ~270 ms on the node:

  ```sql
  with r as (
    select security_id, as_of, lag(as_of) over (partition by security_id order by as_of) prev
    from market.security_metric where metric_code = 'revenue' and period_type = 'annual')
  select count(*) filter (where as_of - prev > 7 and as_of - prev < 300) drifted_pairs,
         count(distinct security_id) filter (where as_of - prev > 7 and as_of - prev < 300)
  from r;
  ```

## What to do

1. In Phase 5, model the fiscal period (fiscal year, period, transition periods) for SEC and Yahoo
   rows, and key the check on it rather than on the gap between period ends.
2. Drop or exclude the mis-tagged and zero rows at their writers.
3. Lower `KNOWN_DRIFTED_PAIRS` as pairs are fixed; the check prints a notice when the count falls.

## Done when

`KNOWN_DRIFTED_PAIRS` is 0, or the check keys on the fiscal period and finds no repeated period.
