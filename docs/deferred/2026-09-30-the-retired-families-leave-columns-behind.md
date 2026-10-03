# The retired families leave columns and tables behind

Created 2026-09-30 · **Drop on or after 2026-10-12** · Status: open, scheduled.

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
