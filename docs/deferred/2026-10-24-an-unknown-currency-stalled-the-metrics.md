# An unknown currency stalled the metric derivation for every company

Created 2026-10-24 · Status: **done 2026-10-24** (Phase 5 rollout 0a–0c)

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

- **0a, muffin-deployment#459** (merged 2026-10-24): `derive_security_metrics` withholds a code
  `market.currency` does not hold, and the requeue trigger also fires on a currency change.
  Rolled back on production's rows, three pages of 2,000 derived 42,289 metric rows where every
  live run had failed.
  **Not yet live.** Two deploys on 2026-10-24 (17:00 and 18:33 UTC) spent their hour in the
  compute-log prune loop. The Ansible provider killed each one at 60 minutes, before the
  migrations. muffin-deployment#460 makes the prune one command; the next deploy carries both.
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

## As done, 2026-10-24

- **0a live at the third deploy** (40127848893, 20:00–20:18 UTC), after muffin-deployment#460
  unblocked the deploys. The 20:17 `derived_security_metrics` run (`6a66013b`), the first to
  succeed since 10-21, read `metrics_backlog_before=161001`. It wrote 945,414 metric rows in 81
  pages, then 108,824 TTM rows from a TTM backlog of 7,674. Both backlogs reached 0, and the run
  succeeded at 20:25:15.
- **0b rolled at 20:28** (muffin-ingest#123, image 37c12b8). The roll read `LOADED`, moved all three
  services, and pinned them.
- **0c, backfill `sfyakdqq`**, 4 of 4 partitions succeeded, with no Yahoo call. **Four companies,
  not three**: Katilimevim Tasarruf Finansman had gained four `TRL` statements from a company day
  since the 10-21 count. Afterwards:
  - unknown currency codes: 0;
  - all 129 of the four companies' yfinance rows are TRY, with none left underived;
  - Aksigorta's annual revenue reads 7,227,436,471 / 12,629,198,332 / 18,669,869,486 /
    20,022,804,825 TRY for 2022–2025.
- **The scheduled runs after it:** `ad77355b` (20:31, 23 s) and `0cef3906` (20:47, 7 s) both
  succeeded. Read at 22:55: 0 underived statements, 0 unknown currency codes, and Aksigorta's 2022
  revenue metric at 7,227,436,471 TRY. Every "done when" above holds.
