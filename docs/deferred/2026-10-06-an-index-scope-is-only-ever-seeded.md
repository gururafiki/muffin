# An index scope is only ever seeded, so a new country ETF gets no returns

## Why

`market.index_scope` tells the Dagster indices lane what to compute (`PROXIED_SCOPES` in
`muffin_ingest/facets/indices.py`). Nothing keeps it current:

- Migration `20260910220000` seeded it once, from the scopes the old `market.performance` table had
  measured. Its comment says "the assets re-assert them". They do not; the lane only reads it.
- Migration `20261006220000` (muffin-deployment#422) seeds the same 73 from the control tables, so a
  rebuilt database has them. It also runs once.

So if a country gains a proxy ETF in `market.countries.etf_symbol`, or a classification group gains
one in `classification_groups.etf`, no scope appears and no index return is ever computed. Nothing
reports it.

Measured 2026-10-06: the derivation and production agree exactly, 73 rows (45 country, 17 group,
11 sector), so nothing is missing today.

## Options

1. **The lane derives its scopes** (recommended). `PROXIED_SCOPES` reads the countries and groups
   directly and keeps `index_scope` only as the place for an override or a disable
   (`proxy_symbol`, `enabled`). One source for "which countries have an ETF", which is the
   same-fact-in-two-places rule.
2. **A view over the control tables**, with the override columns in a small side table.
3. **Leave it**: adding a scope stays a migration, and the next one copies 20261006220000's
   derivation.

## Done when

Adding an ETF to a country or a group produces that scope's returns on the next nightly run, with no
migration.
