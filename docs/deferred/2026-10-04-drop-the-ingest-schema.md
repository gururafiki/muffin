# Drop the `ingest` schema once nothing has touched it for 14 days

Created 2026-10-04 · Do on or after 2026-10-18 · Status: waiting out the contract window.

## Why

Stage 3a of [the universe-family spec](../specs/2026-09-26-finishing-the-universe-family.md)
retired the task ledger (`ingest.task`, `ingest.attempt`, `ingest.facet`, `ingest.provider_budget`
and their functions). Its one user, the price lane, now records a dead symbol as a `miss` in
`market.identifier_probe`:

- muffin-ingest#95, rolled 2026-10-04 18:12 UTC;
- muffin-deployment#416 carried the ledger's 274 live absences across, each expiring when the
  ledger said.

The schema stays for 14 days as the backup, expand/contract style. Rollback within that window is
re-rolling the image before #95 and nothing else: the ledger's rows are untouched.

## What to do

1. Prove nothing reads or writes it. Run on the node, `statement_timeout` set:
   - `select relname, seq_scan, idx_scan, n_tup_ins, n_tup_upd from pg_stat_user_tables where schemaname = 'ingest'`
     must equal its reading taken three seconds after the roll (2026-10-04 18:11:40 UTC):

     | table | seq_scan | idx_scan | n_tup_ins | n_tup_upd |
     |---|---|---|---|---|
     | `attempt` | 81 | 9,912 | 8,903 | 9,175 |
     | `facet` | 1,019 | 148,396 | 8 | 4 |
     | `provider_budget` | 41 | 24 | 7 | 4 |
     | `task` | 2,992 | 240,679 | 48,318 | 101,677 |
   - `select count(*) from ingest.attempt where started_at > timestamptz '2026-10-04 18:12+00'` must
     be 0.
   - `grep -rn "ingest\." muffin-ingest/libs muffin-ingest/projects --include=*.py` must name nothing
     but docstrings. The price test's fake cursor already refuses any query naming `ingest.`.
2. A muffin-deployment migration: `drop schema ingest cascade`. It is guarded by nothing, since it
   must work on a rebuilt database too, so use `if exists`.
   - Re-extract the repeatable bundle: `schemas/` holds the ledger's functions and grants, and CI's
     artifact regenerates them.
   - `20261004160000_the_ledger_s_absences_become_observations.sql` is already guarded on
     `to_regclass('ingest.task')`, so it stays valid after the drop.
   - The legacy migrations keep creating the schema. That is fine: they are the reference the
     baseline is checked against, not what a deploy applies.
3. The tests that exercise the ledger (`an-absence-expires.sql`, `the-ledger-refuses-to-guess.sql`,
   `a-queue-is-filled-breadth-first-and-the-worker-cannot-forge-it.sql` and any others naming
   `ingest.`) go in the same change.
4. Ansible: `ingest_rw` keeps its login and its `market` grants. Only its grants on the dropped
   schema disappear, by cascade.

## Done when

`ingest` does not exist on the node, `quality.yml` is green, and the first night after the drop
shows the price lane's counters summing to `requested` as before.
