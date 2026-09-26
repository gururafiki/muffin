# Finishing the universe family

Status: APPROVED 2026-09-26. The remainder of Phase 3 of the ingestion rework
(`docs/superpowers/specs/2026-09-09-ingestion-rework-design.md`). It extends
`docs/superpowers/specs/2026-09-12-universe-dagster-design.md` §4 and supersedes it where they
differ: the surrogate key on `security_identifier` is dropped (Decision 1).

## Context

The rework moves ingestion off the 7,925-line `market-refresh` edge function onto Dagster, and
normalises the model where it is wrong. The long-term aim is data on every listed stock worldwide,
at financecharts.com depth: 20 years of prices, statements, valuation ratios and dividends.

Phase 3's lanes are live:
- the N-PORT discovery and the OpenFIGI venue sweep since 2026-09-21;
- the symbology ladder since 09-24;
- the CIK and NSE registries since 09-21.

Three things remain:
1. **Identity consolidation.** Step 6's second half.
2. **Retiring the edge resources those lanes replaced.** Step 7.
3. **Phase 2's step (g).** Deleting the price handlers.

## Current state, measured 2026-09-26

| Finding | Consequence |
|---|---|
| `security_ratio_series`, `coverage_current`, `security_facet_status`, `data_defect` and `sample_universe` still read `market.security_price`. Nothing has written it since the 09-12 cutover; its newest bar is 09-11. | The P/E, P/S, P/B and P/FCF charts have been frozen for 15 days, and securities added since have none. Price-freshness facets are decaying to zero. |
| Dagster's symbology adoption never calls `market.clear_symbol_caches`, which the edge resources called by hand at two sites. | 409 of 826 adopted securities are still excluded from other families' backlogs by marks set under the old spelling. |
| `exchange-listings` runs hourly beside the Dagster sweep: 110,322 rows a week into `exchange_listing`, which has no reader. | It spends the OpenFIGI filter allowance the sweep needs. |
| `security-local-symbols` failed 67 of 67 runs on `(provider_code, symbol)`. | It is dead weight. |
| 99,459 directory listings collapse into 54,332 share classes. 23,849 trade on more than one venue, and 838 (share class, venue) pairs have more than one line (e.g. Argentina's BMA, BMA/C and BMAD). | A listing is a FIGI, not `(security_id, exch_code)`. |
| Only 1,395 tracked share classes are known. Even so, 5,946 of the 84,201 `untracked_listing` rows already belong to them. | The search calls tracked companies untracked, and a promotion wave would mint duplicates. |
| `market.listing` (12,482 rows, `figi` null everywhere) is written only by edge resources, and its `currency_code` supplies 11,547 securities' currency. | Retiring those writers without a Dagster owner orphans it. |
| Edge `fund-holdings` writes debt terms (`set_debt_terms`), `tracked_fund.last_report_date`, and learns lookup codes (FK targets). Dagster does none of these. | Retiring it stops bond terms, and a new code would fail a Dagster write on a foreign key. |
| The `ingest` ledger has one user, the price lane: 55 absent, 414 backoff. Its only inserter runs in the stopped day lane. | Dead symbols of securities added since 09-19 are re-asked every pass, and `mark_absent` can raise and fail a run. |
| `run_monitoring` is not configured. | A run whose process dies stays `STARTED` and holds its pool. |

## Decisions (the user, 2026-09-26)

1. **An equity's identity is its OpenFIGI share class.** One security per `shareClassFIGI`, stored as identifier kind `share_class_figi`. `security_identifier` keeps its `(kind_code, value)` key, which already means "one value names one security". The four-company collapse the surrogate key was meant to prevent came from a placeholder CUSIP, now refused at ingest. Listings are keyed by their own FIGI and derived from `venue_listing`.
2. **The universe grows by capped weekly waves.** Venues opt in (`exchange.promotion_enabled`), home markets go first, and the cap keeps a full nightly price pass within 7 nights: `SWEEP_SLICE` 2,500 × 7 − 12,268 askable ≈ 5,000 more today. The cap is a control-table value.
3. **Also in this phase:**
   - classification as an eager asset;
   - the symbol map refreshed by Dagster;
   - a database rebuilt from the repo that works.
4. **No backup at deploy time.** The 03:00 UTC nightly backup is the backup.

Not in scope: a Dagster runs dashboard (step 3b), and the Phase 4-8 families.

## Data model

**Identity, the target:**
- `security` is one share class.
- `security_identifier (kind_code, value) → security_id` holds identifiers that name one security: ISIN, CUSIP, `share_class_figi`, composite `figi`, N-PORT `other`. Tickers stay there for now (about 30 readers across unmigrated families); moving them is Phase 7 serving work.
- `venue_listing (figi PK)` is the directory, with `share_class_figi` added (re-parsed from stored raw).
- New `security_listing (figi PK → venue_listing, security_id, is_primary, currency_code, first_seen_at, last_seen_at)` holds the tracked subset. Venue attributes stay in `venue_listing` (3NF).
- `market.listing` becomes a compatibility view with the legacy columns. During the transition it unions the legacy rows for securities with no derived listing yet.

**Symbol observations.** `identifier_probe` gains yfinance's own verdict: an isolated dead symbol becomes `miss`, an answered one `hit`. It replaces the price lane's `ingest.task` exclusion.

**Price spans.** New `security_price_span (security_id PK, first_date, last_date, bars)` replaces the retired `price_history_from`/`daily_history_from` columns.

**Promotion.** New `promotion_policy` (one row: `max_pass_nights`, `wave_size`, `paused`) and a service function `promote_share_classes(p_limit)`.

**Retired**, contracted about 2026-10-12 after a backup window:
- the ten Phase 2/3 `pending_*` views;
- the ten `%_missing_at`/cursor columns of these families;
- `security_price`, `market.prices`, `exchange_listing`, `exchange_cursor` and `exchange_sweep_*`;
- the `ingest` schema.

## Architecture (Dagster)

| asset | stage | partitions | pool | automation | writes | checks |
|---|---|---|---|---|---|---|
| `venue_listing` (changed) | 2 | exchange_sweep | sql | none | + `share_class_figi` | — |
| `raw_figi_local_symbol` (population widened) | 1 | symbology_subject | openfigi_mapping | missing \| ReAskAfter (code-location sensor) | raw | — |
| `security_symbology` (changed) | 2 | symbology_subject | sql | eager (Yahoo rung ignored) | + `share_class_figi` identifiers; may replace a dead symbol | `one_security_per_share_class` |
| `security_listing` | 3 | none | sql | eager, without `any_deps_missing` | `security_listing` | `listing_covers_legacy` (transitional) |
| `symbol_security` | serving | none | sql | eager \| `cron_tick_passed("*/10 * * * *")` | matview refresh | — |
| `security_price_span` | 3 | none | sql | eager on `price_bar_history` | `security_price_span` | — |
| `promotion_wave` | 3 | none | sql | weekly schedule (Mon 06:17 UTC) | via `promote_share_classes` | `promotion_stays_within_the_sweep` (ERROR) |
| `security_classification` | 3 | none | sql | eager on `fund_holding` \| `cron_tick_passed("44 5 * * *")` | taxonomy, country | — |
| `heartbeat` (replaces `ledger_health`) | platform | none | none | hourly schedule | nothing | — |

**Removed:**
- the stopped day lane: `raw_price_bars`, day `price_bar`, the `daily_prices` job and schedule, and `every_askable_security_was_asked`;
- `ledger_health`, `ledger_heartbeat` and `every_symbol_keyed_facet_retracts`.

**Dead runs.** `run_monitoring` is enabled. Verified in the installed 1.13.22: `check_run_timeout` runs for every launcher and terminates through `DefaultRunLauncher.terminate`; only worker health checks need launcher support. Each scheduled job carries a `dagster/max_runtime` tag.

## Low-level design, per stage

The delivery order and gates are in the table under Rollout.

- **0a.**
  - An `AFTER INSERT OR UPDATE OF symbol` trigger on `security_provider_symbol` calls `clear_symbol_caches`. It does nothing when the value is unchanged, and it is SECURITY DEFINER.
  - A one-shot repair clears, per column, marks older than the adopted symbol. The column list comes from `symbol_cache_classification`.
  - The redundant index `security_provider_symbol_one_per_security` is dropped.
- **0b.** The five readers are swapped to `price_bar`. The ratio view keeps `grain`: a daily arm over 400 days and a weekly arm with the last bar of each week. `quote_currency` is unchanged.
- **0c.** The Ansible post-deploy backup task is removed.
- **1a (parity first).** `discovered_security` learns lookup codes (`insert … on conflict do nothing`) and calls `set_debt_terms`. The "funds ingested" readers move to `fund_holding_current`.
- **1b.**
  - `-- RETIRES:` markers for the ten resources, the `RETIRED` map (410 before the admin gate), the `cron_resource` rows disabled, and `cron.unschedule('muffin-promote')`.
  - `resource_health.scheduled` also counts a resource fired by its own `cron.job`.
- **1c.** Delete the twenty handlers and their guards; drop the ten views; prune the price columns from `clear_symbol_caches`. `deno check` and `logic-check` prove nothing live used them.
- **1d.** `security_price_span` plus its asset, with a one-off bootstrap.
- **2.**
  - Stage 2 re-parses `share_class_figi` from the stored raw. The ISIN rung (already `exchCode`-free) is asked for every equity lacking a share class: ~125 keyed requests, one operator backfill over the grid.
  - `security_listing` is derived by SQL. `is_primary` goes to the line matching the adopted yfinance symbol, else the home venue by `exchange.preference`. Currency carries over from the legacy primary.
  - The swap happens after the parity check. `untracked_listing` moves to share-class grain with the same columns.
- **3.**
  - The price lane writes `identifier_probe` for isolated dead and answered subjects. This is a stage-1 bookkeeping write, like the ledger's today; verdict rows inside a bar file would mix row types.
  - `askable_subjects` excludes a recent miss only while `asked_with` equals the current symbol, so a corrected symbol re-enters by construction.
  - `NEEDS_SYMBOL` includes a dead current symbol, and adoption may replace a dead symbol, never a live one.
  - The ledger calls go.
- **4.** `promote_share_classes` ranks by `promotion_tier`, then `preference`, then the share class's listing count, then name. The listing count is a free prominence proxy, since the directory carries no size. `promote_listing(figi)` resolves by share class.
- **5.** One asset calls the three `derive_*` functions.
- **6.**
  - `roles.sql` runs before `supabase db push`.
  - `always/` gains table grants (from `relacl`), `reference.sql` (FK targets of pipeline-written tables, `on conflict do nothing`) and the remaining pg_cron jobs.
  - A new CI job `fresh-database`.

## Validation

Each lane change is proven on a tiny subset locally, then live, reading every counter. SQL tests are mutation-proven in CI; local Docker is unavailable.

Numbers each stage must reproduce:
- the 409 → 0;
- AAPL's newest P/E point = newest `price_bar` date;
- AGG's `debt_terms_as_of` advances;
- share class on ≥ 95% of equities with an ISIN;
- parity: derived listings cover the legacy rows' securities, and primaries agree;
- a promotion wave ≤ its capacity, with the next sweep still `throttled 0`.

## Dependencies and isolation

No new libraries. OpenFIGI spend is about 125 keyed requests. Yahoo spend stays under the in-flight sample's measurement (`docs/deferred/2026-09-24-the-yahoo-rung-is-an-operator-backfill.md`).

## UI impact

None to the code:
- `use-security-search.ts` keeps its columns, which now come at share-class grain.
- The Track button's RPC resolves by share class.
- The valuation chart un-freezes.

## Observability

- New Grafana universe panels: share-class coverage, listings per security, untracked share classes, and promotion per wave.
- Retired backlogs leave the dashboards on their own, because `backlogs_to_sample()` is catalogue-derived.
- Every alert rule's query is re-read verbatim after each stage.

## Rollout

| # | Repo | Change | Gate |
|---|---|---|---|
| 1 | umbrella | this spec | — |
| 2 | deployment | 0a + 0c | 409 → 0 |
| 3 | deployment | 0b | P/E newest = `price_bar`, latency green |
| 4 | ingest | 1a | AGG terms live |
| 5 | deployment | 1b + 1d schema | 410s live, no `refresh_run` rows |
| 6 | ingest | 1d asset | depth facets move |
| 7 | deployment | 1c | `deno check` + logic-check + dashboards render |
| 8 | deployment → ingest | 2a → 2b + backfill | ≥ 95% share classes |
| 9 | deployment | 2c | parity + browser |
| 10 | ingest | 2d + 3 | a night with misses recorded and 0 ledger writes |
| 11 | deployment | run_monitoring | a short `max_runtime` terminates a test run |
| 12 | deployment → ingest | 4 (paused), then opt-in | wave ≤ capacity, sweep clean |
| 13 | ingest + deployment | 5 | counts match the edge run |
| 14 | deployment | 6 | `fresh-database` green |
| 15 | umbrella | docs, skills, notes | — |

## Risks and rollback

- **The listing swap:** rollback recreates the view over `listing_legacy`.
- **Dead-symbol replacement could loop:** it is bounded by the 30-day re-ask, and a live symbol is never replaced.
- **Promotion** ships paused. Its cap is enforced in code and by an ERROR check.
- **A retirement** is undone by re-enabling its `cron_resource` row and removing the `RETIRED` entry, until 1c deletes the code. 1c therefore waits for 1b to run clean for three days.

## Deferred

- Drop the contracted objects (about 2026-10-12).
- Listing currency for promoted securities (Phase 4).
- `pending_in_history` is FLAT at 381 and the FLAT alert is firing (Phase 6).
- Tickers out of `security_identifier` (Phase 7).

## Open questions

- **Which venues to opt in first.** Asked at stage 4's switch-on; the recommendation is tier-1 home markets.
