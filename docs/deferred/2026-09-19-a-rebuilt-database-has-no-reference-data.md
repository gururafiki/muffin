# A database rebuilt from what is committed is schema-correct and reference-empty

Created 2026-09-19 · **Due 2026-09-26** (with its sibling) · Status: **reproduced under Docker**,
fix not chosen

Sibling of `2026-09-19-a-rebuilt-database-has-no-ingest-or-metrics-role.md` and found the same
afternoon, by the first real use of the local Dagster harness rather than by reading. The roles note
is the smaller half of one problem: **the baseline captured the schema and dropped everything the
retired migrations had INSERTED.**

## Measured, 2026-09-19

`migrations/20260910000000_baseline.sql` contains **zero** `INSERT` and **zero** `COPY` statements —
it is schema-only. Against a `postgres:17-alpine` container holding only the Supabase image's own
roles plus `ingest_rw`/`metrics_ro`, all eleven committed migrations apply cleanly, and then:

| lookup table | rebuilt from what is committed | production | what it is |
|---|---|---|---|
| `market.data_source` | **0** | 24 | authored reference — `yfinance`, `sec`, `finviz`, … |
| `market.index_scope` | **0** | 73 | authored reference — the country/sector/group scopes |
| `market.return_period` | 10 | 10 | seeded by a COMMITTED migration |
| `ingest.facet` | 1 | 1 | seeded by a committed migration |
| `ingest.provider_budget` | 1 | 1 | seeded by a committed migration |
| `market.currency` | 0 | 43 | learned by the ingest at runtime — correctly absent |
| `market.security` | 0 | 27,893 | ingested from filings — correctly absent |

So the pattern is **inconsistent rather than absent**: three control tables are seeded by files that
survived the cutover and two are not, which is precisely why nothing has noticed.

## What it costs

The FIRST WRITE of any lane fails, with the schema perfect and every migration green:

```
psycopg.errors.ForeignKeyViolation: insert or update on table "fx_rate"
  violates foreign key constraint "fx_rate_source_code_fkey"
DETAIL:  Key (source_code)=(yfinance) is not present in table "data_source".
```

`price_bar`, `security_return` and `index_return` all carry the same `data_source` foreign key, so
this is every lane, not one. And `index_scope` being empty means the indices lane would publish
nothing while succeeding — the quieter half, because an empty answer is not an error.

This repo has already recorded the shape twice: *"a resource that writes a new `source_code` must
seed it in the SAME migration, and nothing downstream can catch the omission"* (migration 88's
production failure), and *"`market.currency` is populated by the ingest at runtime, so a fresh
database has none and a test passes for the wrong reason"*. Both are about one row; this is about
the baseline losing 97 of them at once.

## Why nothing reports it

The CI equivalence proof dumps `--no-owner --no-privileges` **and compares SCHEMA**, so data is
outside what it asserts by construction. Every other job runs against a database where the legacy
set has already inserted these rows. It is only visible on a database built from what is committed —
which is exactly what a node replacement produces, and this repo has already had a deploy replace
the VM and wipe every database.

## What to do

1. Decide where authored reference data lives — the options:
   - **A dedicated seed file re-applied every deploy** (recommended), beside `always/`: one
     `insert … on conflict do nothing` per control table, so it is self-healing and a new row is a
     one-line change rather than a migration. It must NOT `do update`, or a Studio correction is
     reverted on every deploy — the rule this schema already follows for memberships.
   - **Extend the baseline** with the `COPY` blocks `pg_dump --data-only` produces for these tables.
     Honest for a rebuild and inert afterwards, but a new source then needs a migration again.
   - **Leave it and document** that a rebuild needs a data restore first. Cheapest, and it makes the
     restore a step nobody has written down — which is how the roles gap happened.
2. Whichever is chosen, **derive the list rather than typing it**: the tables to cover are those
   reachable as a foreign-key TARGET from anything the pipeline writes (the query is in the harness),
   not a hand-kept list that the next control table will not join.
3. Add the fresh-database apply to CI — `baseline + migrations` against a container with only the
   Supabase roles, then one tiny write per lane. Both this and the roles gap fail it today.

## Done when

A database built only from what is committed accepts `fx_rate`, `price_bar`, `index_return` and
`security_return` writes without a hand-inserted row, and `index_scope` is populated.
