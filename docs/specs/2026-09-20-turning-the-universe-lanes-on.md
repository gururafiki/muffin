# The universe and symbology lanes — turning them on

Status: APPROVED 2026-09-20. Extends `docs/specs/2026-09-12-universe-dagster-design.md`; applies
the partitioning rule set in `docs/specs/2026-09-19-partitioning-to-the-provider-grain.md`.

## Context

Phase 3's steps 4, 5 and the first half of step 6 were built, merged and deployed between
2026-09-12 and 2026-09-13 — and never switched on. Every standard sensor in the code location ships
`STOPPED`, so the discovery and symbology lanes have **zero materializations**, while migration
`20260913100000` re-pointed a serving view onto a table only those lanes can fill.

The result was a live, unreported regression plus four defects that existed only because nothing
had ever driven the code. This spec records what was measured, the four decisions taken with the
user, and what shipped.

## Current state, measured 2026-09-20 (production)

```
dagster event_logs   raw_nport_filing · raw_exchange_sweep · raw_figi_ticker
                     raw_figi_local_symbol · raw_yahoo_symbol · venue_listing
                     discovered_security · fund_holding · security_symbology
                     = 0 ASSET_MATERIALIZATION, 0 partitions
                     raw_fund_directory = 4 materializations (its schedule runs)
                     raw_sec_cik_map    = 1 planned, 0 materialized — the 09-14 tick died in
                                          the exporter incident; next tick Monday 09-21

sensors              new_nport_filings · new_exchange_sweeps · new_symbols_needed
                     new_securities_need_history · new_currencies_need_history = STOPPED
                     default_automation_condition_sensor                       = RUNNING

market.venue_listing       0        market.exchange_listing   148,782
market.identifier_probe    0        market.security            27,893
market.untracked_listing   0   ← the regression
market.security_identifier 60,251   market.fund_holding        48,177

exchanges enabled 59 · tracked funds enabled 74 · equities 12,598
equities with an ISIN 12,496 — of those, no ticker 5,697 · no provider symbol 1,618
securities with is_tradeable = false 23,506 of 27,893 (15,159 are bonds)
```

**Readers of the affected surfaces:** `muffin-ui/src/features/markets/api/use-security-search.ts`
reads `market.untracked_listing`; `track-listing-button.tsx` calls `market.promote_listing`, which
reads `market.venue_listing`. Both are live — the UI change merged 2026-09-13 and deployed 09-17.

## What was already right

Every lane's partition grain satisfies rule 6 as written, checked against the skill's own table.
`raw_fund_directory` is unpartitioned (one whole file); `raw_nport_filing` is per accession (one
document); `raw_exchange_sweep` is per venue with the cursor in the file (a collection sweep); the
three symbology rungs are per security with `multi_run(200)` over a ten-jobs-per-request API, which
the skill names as *the model*. None of that needed redesigning, and none of it was changed.

## Decisions

### 1. `untracked_listing` stays on `venue_listing`; the sweep is what closes the regression

Rejected: re-pointing the view back to `exchange_listing` and switching once the sweep had filled
the new base (the expand/contract order), and a union of both bases.

Accepted cost: the Markets search stays empty until the sweep has covered the enabled venues —
59 venues, 100 rows a page, `SWEEP_PACING = 2.5 s` against an anonymous limit of 25/min;
`exchange_listing`'s 148,782 rows imply ~1,488 pages ≈ ~62 minutes of provider time across runs.

### 2. The venue sweep resumes by backfill, and says which venues need one

Resuming was already the design — `new_exchange_sweeps` only adds venues and its own comment says
*"re-materialising them is an operator's call"*. What was missing was visibility: a venue that
stopped on page 40 or on a 429 is an ordinary materialized partition, and its freshness policy is
satisfied the moment it stops.

`venue_sweep_reached_its_last_page` (WARN, non-blocking) fails when the newest page still carries a
cursor and **names** the venues, so the check result is the backfill selection. Rejected:
`any_checks_match(check_failed())` on top of it — revisit if several loads need hand-driving.

### 3. A re-materialisation of a finished venue is a new walk, and replaces

OpenFIGI has no as-of, so a directory can only be refreshed by walking it again, and a partition
that accumulated every walk would grow without bound and could not say which listings are current.
A run starting from `cursor=None` marks the partition `partitioned.Complete` and the manager
replaces; a run resuming mid-walk merges. Same machinery the price lane proved live on 2026-09-20.

### 4. Symbology gets its own grid, and its own population

Rejected: keeping one shared grid without the delete. The ladder's population is not the price
lane's, so sharing would widen the nightly sweep whatever the re-ask does.

Population, per rung: equities missing that rung's evidence — 5,697 for the ticker rung, 1,618 for
the local-symbol and Yahoo rungs. Rejected: every security with an ISIN (27,652), and every equity
with an ISIN regardless of what we hold (12,496).

## Defects found and closed

| | evidence | closed by |
|---|---|---|
| A resumed venue sweep replaced its own file, keeping the tail and losing every page before it — while `_last_cursor`'s docstring claimed the opposite | code; `venue_listing` upserts, so only raw could show it | muffin-ingest#58 — `merge_on=["exch_code", "cursor_from"]` |
| Nothing distinguished a finished venue from a stalled one | the freshness policy is satisfied the moment a sweep stops | #58 — `venue_sweep_reached_its_last_page` |
| The symbology sensor deleted partitions from the PRICE lane's grid | `security_partitions` imported by `defs/symbology` | muffin-ingest#59 — `symbology_subject` |
| The rungs asked about `is_tradeable = false` — 23,341 securities, 15,159 bonds | measured against production | #59 — per-rung `not exists` populations |
| Two raw assets hand-rolled the partition seam; an empty mapping raised `IndexError` and a key with no answer vanished | code | #58, #59 — `partitioned.by_partition` |
| Three Grafana alerts shared `muffin-backlog-stalled`'s summary, including "market-verify has not run" | `rules.yml` | muffin-deployment#383 |

The `rules.yml` GAUGES drift carried by the previous plan **was already fixed** and is not re-fixed.

## Validation

Measured against Dagster 1.13.22 before being designed on:

- **A custom `AutomationCondition` works.** `evaluate()` is called, `context.candidate_subset` is an
  `EntitySubset` with `compute_intersection_with_partition_keys`, and the intended partition is
  requested. Its identity is its class name (`get_node_unique_id` hashes `self.name`), so renaming
  it is a state change.
- **`on_missing()` is the wrong rule for a lane being switched on.** It requested **0 of 2**
  partitions already in the grid at the first tick and 2 of 2 added between ticks. `missing()`
  requests both.
- **A sensor cannot express the re-ask affordably.** It can request a partition or a contiguous
  range; a stale-miss set is scattered, so it becomes one run per subject — ten jobs per OpenFIGI
  request becoming one.

## Rollout

1. **#58 — the discovery lane, fixed.** Merged 2026-09-20 (`65a7af7`). Not yet rolled.
2. **#59 — the symbology lane, fixed.** Open.
3. **Local tiny subset** per `dagster-pipeline-local-test`: one small venue, two N-PORT accessions.
4. **Roll, then a live tiny subset** — one venue partition and a handful of accessions, counters
   read — then sensors RUNNING in code, one lane at a time, then backfill the rest.
5. Deferred note for the drain; docs, memory, skill.

**Out of scope, gated on these lanes producing data:** step 6's second half (the
`security_identifier` surrogate key, `listing`, the `symbol_resolution` matview, anon-latency
re-measurement) and step 7 (retiring the universe/symbology handlers, the `pending_*` views, the
twelve `%_missing_at`/cursor columns, the ledger in `prices.py`).

## Risks and rollback

- The search stays empty while the sweep runs; the deferred note is what stops that being forgotten
  a second time.
- OpenFIGI anonymous is 25/min and the measured 429 arrived on request 21. `openfigi_filter` and
  `openfigi_mapping` are separate pools at limit 1 but the same upstream allowance — stage the
  sweep and the ladder rather than starting both in one night.
- Rollback is stopping a sensor: no schema change, no deploy. The discovery schema is already
  additive and deployed.

## Open questions

None outstanding.
