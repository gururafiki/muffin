# The retired families leave columns and tables behind

Created 2026-09-30 · **Drop on or after 2026-10-12** · Status: open; the table half is
muffin-deployment#479 (2026-10-30), deployed 2026-11-01. The SEC family's section was added
2026-11-02, for Phase 5's step 11.

**2026-10-30: the tables first, for the disk.** `/mnt/data` reached 78% (alert at 80%) with
Phase 5's backfills to land, so #479 drops `security_price`, `prices`, `exchange_listing` and
`exchange_cursor` (5,332 MB, measured in a rolled-back transaction on production). The "`exchange_*`
sweep tables" below means those two only: `exchange_label` and `exchange_sweep_*` are live
Dagster control tables. Their last readers went with them: market-verify 7h, and the tests of
legacy repairs 055 and 108. The columns remain for a second migration.

## What is left

Stage 1c of [the spec](../specs/2026-09-26-finishing-the-universe-family.md) deleted the edge
handlers of the price family (retired 2026-09-12, D2) and the universe family (retired 2026-09-26,
1b), and dropped their ten `pending_*` views. It left the objects those handlers wrote. Nothing
writes them any more, and each is either read by nothing or read by something that has its own
replacement step. This is the expand/contract rule: keep the old data as a backup until the new
lanes have run long enough to trust.

| Object | Written by (retired) | Still read by, on 2026-09-30 | Before dropping |
|---|---|---|---|
| `security.prices_missing_at` | `security-prices` | nothing | — |
| `security.performance_missing_at` | `security-performance` | `market.data_defect` (`contradicted_negative_cache`) | remove that gauge from `data_defect` |
| `security.price_history_missing_at` | `security-price-history` | nothing | — |
| `security.daily_history_missing_at` | `security-daily-history` | nothing | — |
| `security.price_history_from` | `security-price-history` | `coverage_current`, `security_facet_status` | Stage 1d: `market.security_price_span` replaces it |
| `security.daily_history_from` | `security-daily-history` | `coverage_current`, `security_facet_status` | Stage 1d, as above |
| `security.figi_missing_at` | `security-tickers` | nothing | — |
| `security.local_symbol_missing_at` | `security-local-symbols` | nothing | — |
| `security.yahoo_symbol_missing_at` | `security-yahoo-symbols` | nothing | — |
| `security.symbol_repair_at` | `security-symbol-repair` | nothing | — |
| `currency.history_missing_at` | `fx-rates` | nothing | — |
| `market.security_price` (5.3 GB) | `security-prices`, `-price-history`, `-daily-history` | check | `price_bar` has served every reader since 0b |
| `market.prices` | `instrument-prices` | check | — |
| `market.exchange_listing`, `exchange_cursor`, `exchange_sweep_*` | `exchange-listings` | check | `venue_listing` replaced them (Phase 3, step 5) |
| `tracked_fund.last_report_date` | `fund-holdings` | `sample_universe` | re-derive from `fund_holding_current` first |

### Added 2026-10-24: the Yahoo company family (Phase 4)

Its ten handlers and eight `pending_*` views left in muffin-deployment#461. These columns have had
no writer since the family retired on 2026-10-18 (#445, and #446 for the yfinance half of
`security-statements`). Measured on production 2026-10-24 inside the rolled-back migration, no view
reads any of them, and the only function that names them is `clear_symbol_caches`.

| Object | Written by (retired) | Still read by | Before dropping |
|---|---|---|---|
| `security.industry_missing_at` | `security-industries` | `clear_symbol_caches` | remove it there and from the classification |
| `security.profile_missing_at` | `security-profiles` | `clear_symbol_caches` | as above |
| `security.provider_country_missing_at` | `security-profiles` | `clear_symbol_caches` | as above |
| `security.profile_detail_missing_at` | `security-profile-detail` | `clear_symbol_caches` | as above |
| `security.fundamentals_missing_at` | `security-fundamentals` | `clear_symbol_caches` | as above |
| `security.statements_missing_at` | `security-statements` (yfinance half) | `clear_symbol_caches` | as above |
| `security.quarters_missing_at` | `security-quarters` | `clear_symbol_caches` | as above |
| `security.dividends_missing_at` | `security-dividends` | `clear_symbol_caches` | as above |
| `security.share_stats_missing_at` | `security-share-stats` | `clear_symbol_caches` | as above |
| `security.estimates_missing_at` | `security-share-stats` | `clear_symbol_caches` | as above |
| `security.management_fetched_at` | `security-management` | nothing | — |

The company lane writes the tables these handlers used to write (`security_profile`,
`security_officer`, `security_fundamentals`, `security_share_stats`, `security_estimate`), so the
tables stay. The edge still writes `statement_currency_missing_at` and `xbrl_missing_at` until
Phase 5 retires the SEC family. Those two join this list at that phase's contract step.

### Added 2026-11-02: the SEC family (Phase 5)

This is the SEC spec's step 11. Its four edge resources (`security-xbrl`, `-filings`,
`-filing-history`, `-insider`) still run until step 9 retires them, and `security-statements` was
retired at step 2b. Their handlers go at step 10, after three clean days. **Drop date: 30 days
after step 9**, so the old rows stay as a backup while the Dagster lanes run alone. Measured on
production 2026-11-02 with the query below:

| Object | Written by | Still read by | Before dropping |
|---|---|---|---|
| view `pending_xbrl` | — | `security-xbrl` only | step 10 deletes the handler |
| view `pending_filings` | — | `security-filings` only | as above |
| view `pending_filing_history` | — | `security-filing-history` only | as above |
| view `pending_insider` | — | `security-insider` only | as above |
| `security.xbrl_fetched_at`, `xbrl_missing_at` | `security-xbrl` | `pending_xbrl` | drop the view; remove `xbrl_missing_at` from `symbol_cache_classification` and its `backlog_negative_cache` row |
| `security.filings_fetched_at` | `security-filings` | `pending_filings` | drop the view |
| `security.filing_history_fetched_at` | `security-filing-history` | `pending_filing_history` | drop the view and its `backlog_negative_cache` row |
| `security.insider_fetched_at` | `security-insider` | `pending_insider` | drop the view |
| `security.statement_currency_missing_at` | `security-statements` (retired at 2b) | nothing | remove its `symbol_cache_classification` row |
| pg_cron `muffin-filing-history`; `cron_resource` rows of the four | — | — | step 9 unschedules; step 11 deletes the rows |
| `security_statement` rows `source_code = 'sec'` (44,542 annual, 255 unlabelled) | `security-statements` | `security_statement_current` (lower priority than `sec-xbrl`) | decision 12: list any period only they hold, then delete |
| `security_metric` rows `source_code = 'sec'` (42,768) | the derivation, from those statements | serving views | go with the statements; check the derivation retracts them |
| `security_metric` `sec-xbrl` rows the edge wrote directly (unlabelled) | `security-xbrl` | serving views | the filer lane re-derives each period; list what it does not reproduce (todos, step 11) |
| `insider_trade` rows with no accession (70,346, `sec-form4`) | `security-insider` | `security_insider_summary` (only on days the lane has not collected) | step 9 re-points the summary; the history backfill covers their quarters |
| `EDGE_WRITES_FLOOR` in `defs/companies/derived.py` | — | the derivation's half-hourly floor | nothing on the edge writes statements or metrics after step 9 |

Found while measuring, from an older family: **`pending_eps_history` and
`security.eps_history_fetched_at`**. `security-eps-history` (alpha_vantage, 25 calls a day) has had
no schedule and no `cron_resource` row since legacy migration 138; `earnings-history` (nasdaq)
replaced it. Its handler is still in `market-refresh/index.ts`, reachable by an admin call and
guarded in `logic-check.ts`, and it is the only reader of the view. Retiring it (a `-- RETIRES:`
marker, 410) lets the handler, the view and the column go with step 10 and 11.

The four price columns are classified `symbol_keyed = false` in `market.symbol_cache_classification`,
so `clear_symbol_caches` no longer clears them. `tests/negative-caches-are-classified.sql` requires
every `%_missing_at` column to be classified, so each drop also removes its row there.

## The query that proves nothing reads a column

Run it on production just before writing the migration. The table name and column list are
parameters; an empty result for a column means no view and no `market` function reads it.

```sql
select a.attname,
       (select string_agg(distinct dep.relname, ',')
          from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class dep on dep.oid = r.ev_class
         where d.refobjid = a.attrelid and d.refobjsubid = a.attnum) as views,
       (select string_agg(p.proname, ',') from pg_proc p
         where p.pronamespace = 'market'::regnamespace and p.prosrc ~ ('\m' || a.attname || '\M')) as functions
  from pg_attribute a
 where a.attrelid = 'market.security'::regclass and a.attname = any (array['prices_missing_at', '…'])
   and not a.attisdropped;
```

For a table, use `pg_depend` on the table's oid for views, and grep `muffin-ui/src` and
`muffin-ingest` for its name.

## What to do

1. Stage 1d first, so `coverage_current` and `security_facet_status` read `security_price_span`.
2. Remove `contradicted_negative_cache` from `data_defect`, and `last_report_date` from
   `sample_universe`.
3. Re-run the query above. Then one migration drops the columns and tables, removes the four
   classification rows, and regenerates `schemas/` from CI's artifact.
4. Take the size back: `security_price` alone is 5.3 GB on a 100 GB data volume.

## Done when

- None of the objects above exists in production.
- `tests/negative-caches-are-classified.sql` passes with the rows removed.
