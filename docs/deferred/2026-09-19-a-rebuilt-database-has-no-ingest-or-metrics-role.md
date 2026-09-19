# Nothing that runs today creates `ingest_rw` or `metrics_ro`

Created 2026-09-19 · **Due 2026-09-26** · Status: **REPRODUCED under Docker 2026-09-19** — and the
same run found a larger sibling, `2026-09-19-a-rebuilt-database-has-no-reference-data.md`

**The reproduction, in full.** A `postgres:17-alpine` container given only the roles the Supabase
image itself creates (`anon`, `authenticated`, `service_role`, `supabase_admin`, `authenticator`,
`supabase_auth_admin`, `supabase_storage_admin`) refuses the FIRST committed migration:

```
20260910000000_baseline.sql                          FAILED
ERROR:  role "metrics_ro" does not exist
```

`create role ingest_rw nologin; create role metrics_ro nologin;` on a clean container, and all
**eleven** committed migrations then apply in order with no other change. So the baseline is the
first failure, not the `alter role ... bypassrls` the note originally named — that one never runs.

**Confirmed 2026-09-19 by reading the files themselves, which needs no database and is therefore
not a claim about anyone's local setup:** `migrations/20260910000000_baseline.sql` names these roles
**13 times**, the first at line 10145 —
`CREATE POLICY backlog_negative_cache_read ON market.backlog_negative_cache FOR SELECT TO anon,
authenticated, metrics_ro` — and `grep -r 'create role' migrations/` matches **zero files**. So the
baseline itself refuses on a database holding only the Supabase image's own roles; the
`alter role ... bypassrls` in the later migration is the SECOND place it fails, not the first.

## What is missing

`create role ingest_rw nologin` exists in exactly one place: `migrations-legacy/206-the-ledger-is-
the-per-item-grain.sql`. `create role metrics_ro nologin` in exactly one: `migrations-legacy/127-a-
run-that-is-not-recorded-cannot-be-observed.sql`. **`migrations-legacy/` is retired** — a deploy runs
`supabase db push`, which applies `migrations/` and records what it applied, and those 204 files are
kept only as the reference the baseline is measured against.

Grepped 2026-09-19 across `stack/supabase/{migrations,schemas,always,db}`, `stack/*.yml` and
`ansible/`: **no other `create role` for either.** Ansible creates the `dagster` role explicitly and
otherwise only says `alter role ingest_rw login password …` / `alter role metrics_ro login password
…`, which require the role to exist.

## Why production is fine and a rebuild is not

Both roles exist on the node because the legacy migrations created them before the Supabase-CLI
cutover. The failure needs a database built from what is committed today:

1. `20260911000500_ingest_rw_can_write.sql` runs `alter role ingest_rw bypassrls` and aborts with
   `role "ingest_rw" does not exist`, taking the migration chain with it.
2. Even past that, `schemas/` carries 266 grants naming these roles, so the grants fail too.
3. The Supabase image's own initdb supplies `anon`, `authenticated`, `service_role` and
   `supabase_admin`, which is why only these two are exposed.

That is not hypothetical here: this repo has already had **a deploy replace the VM and wipe every
database** (CLAUDE.md § deploy node-replacement hazard). After such a rebuild the schema returns and
the pipeline's writer and Grafana's reader do not.

**Nothing can report this.** The CI equivalence proof dumps `--no-owner --no-privileges`, which
excludes roles by construction, and every other job runs against a database where the legacy set has
already created them.

## What to do

1. Prove it in five minutes: apply `migrations/20260910000000_baseline.sql` then the later
   `migrations/*.sql` to a throwaway `postgres:17-alpine` **with only the Supabase roles present**,
   and watch the `alter role` abort. (Blocked here on 2026-09-19 only because Docker Desktop would
   not start; it is the same harness the muffin-ingest local run needs.)
2. Decide where the creation belongs — the options:
   - **`always/`** (recommended): a `do $$ … if not exists … create role … $$` beside the other
     re-applied files. The schema owns permissions and Ansible owns credentials, which is the split
     the existing Ansible comment already describes, and `always/` is asserted idempotent by CI.
   - **Ansible**, beside the `dagster` role it already creates. Keeps role creation in one place
     operationally, but moves a permission fact out of the schema.
   - **A new migration**, which is honest for a fresh database and does nothing for the existing
     one — and cannot be re-run, so it does not self-heal.
3. Whichever is chosen, add the fresh-database apply to CI: today no job applies
   `baseline + migrations` to a database without the legacy history, which is precisely the
   configuration a rebuild produces.

## Done when

A database built only from what is committed — no legacy set, no hand-made roles — applies every
migration, and `ingest_rw` and `metrics_ro` exist with their grants.
