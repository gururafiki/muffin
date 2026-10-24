# The statement key, precedence between SEC and Yahoo, and fiscal periods

Created 2026-10-10 · Due with Phase 5 (the SEC family) · Status: decided 2026-10-24, building

**Decided 2026-10-24** ([the Phase 5 spec](../specs/2026-10-24-sec-family.md), decisions 6 and 7):
the provider joins the key, `(security_id, source_code, statement, period_ending, period_type)`,
and serving views pick by `source_priority`. A `fiscal_calendar` and a `fiscal_period` table label
statement and metric rows. Steps 2 and 3 below are rollout step 2a; the key switch is 2b.

## Why it is deferred

Phase 4 decided (umbrella `docs/specs/2026-10-10-yahoo-company-data.md`, decisions 6 and 11):
- the Yahoo statement writer never replaces a SEC row; the key and the precedence are revisited
  with fiscal periods in Phase 5;
- no `market.fiscal_period` yet, because SEC carries fiscal year and period natively and Yahoo does
  not. The summary's fiscal-year-end fields stay in raw for it.

`security_statement` is keyed `(security_id, statement, period_ending, period_type)`, so one
company's period from two providers is one row, and whichever wrote last owns it unless a writer
guards. Phase 4's writer guards; the edge's SEC writer does not need to, because SEC is preferred.

**Found while building step 5, and left for this phase:** 2,259 SEC rows in 59 securities carry
`period_type = 'FY'` (written 2026-08-20..21 by an earlier version of the edge's statements code),
where every other annual row says `annual`. `derive_security_metrics` maps `fy` to `annual`, so the
metrics are right. But `security_statement_current` shows both spellings, and 3 of those rows
duplicate an `annual` row for the same period, so the app can show one year twice.

## What to do

In Phase 5's planning:
1. Decide the key and the precedence with the fiscal-period dimension: whether a provider becomes
   part of the key, or one row per period with a precedence rule.
2. Normalise `FY` to `annual`. Where both exist, keep the newer row, and re-derive.
3. Assert one vocabulary for `period_type` (`annual`, `quarter`, `half`) with a check constraint.

## Done when

`security_statement.period_type` holds only the three values, no period appears twice, and the key
decision is recorded in the Phase 5 spec.
