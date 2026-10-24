# An unknown currency stalled the metric derivation for every company

Created 2026-10-24 · Status: **fixing** (Phase 5 rollout 0a–0c)

## What happened

From 2026-10-21 03:47 UTC, every `derived_security_metrics` run failed with
`security_metric_currency_code_fkey ... Key (currency_code)=(TRL)`. Found by the 10-21 check-in,
which reads the firing alerts first: `muffin-dagster-run-failed` was firing.

- Yahoo labels five Turkish statements `TRL`, the lira code retired in 2005: three of Aksigorta's
  for 2022, one each of Girisim's and Kaleseramik's for 2021. The values are TRY. Aksigorta's 2022
  revenue is 7.2 bn, beside 12.6 bn in 2023 and 18.7 bn in 2024, all labelled TRY.
- `security_statement.currency` has no foreign key, so the company lane wrote `TRL` without error.
  `security_metric.currency_code` does have one, so the derivation failed when it copied the code.
- The derivation pages by `as_of`. The page holding Aksigorta's rows (written 04:28) failed, and no
  page after it ran. The stall therefore covered every company the lane wrote after that row, not
  only the Turkish ones.
- Underived statements: 25,724 on 10-21, **161,001** on 10-24. P/E and TTM did not move for four
  company days.
- The plan for Phase 5 was approved first, at the user's choice (2026-10-21).

## The fix

- **0a, muffin-deployment#459** (deployed 2026-10-24): `derive_security_metrics` withholds a code
  `market.currency` does not hold, and the requeue trigger also fires on a currency change.
  Rolled back on production's rows, three pages of 2,000 derived 42,289 metric rows where every
  live run had failed.
- **0b, muffin-ingest#123**: `price_chart.YAHOO_REPORTING_CURRENCY = {"TRL": "TRY"}`, applied to
  the statements and to `financialCurrency`, with unknown codes withheld and counted.
- **0c**: replay `yahoo_statement` from raw for the three companies, with no Yahoo call. The rows
  become TRY, the trigger re-queues them, and the metrics are re-derived with TRY.

## Lessons

- **A column with no foreign key can still feed one.** The row was accepted where it was written
  and refused two stages later, where it stopped everything behind it. The writer now checks
  against the same table the downstream key references.
- **One bad row in an ordered page is a head-of-line stall for the whole table.** This is the
  eighth such stall recorded in CLAUDE.md. The derivation now refuses the row's label instead of
  the page.

## Done when

- `derived_security_metrics` succeeds every run.
- The underived backlog has drained to its usual level.
- No `security_statement` row carries a currency `market.currency` lacks.
- Aksigorta's 2022 metrics carry TRY.
