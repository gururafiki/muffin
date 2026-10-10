# Yahoo company data on Dagster (Phase 4) — design

Status: APPROVED 2026-10-10 (scope, fetch, cadence, history and nine further decisions below).
Validation from the node and the low-level details marked *to measure* are still open; they close in
step 4 of the rollout, before any lane code is written. Extends
[the ingestion rework design](../superpowers/specs/2026-09-09-ingestion-rework-design.md) §8 (Phase 4)
and takes [the quote-currency spec](2026-10-06-the-price-lane-reads-the-quote-currency.md) as its
Stage 0.

## Context

The rework moves ingestion off the `market-refresh` edge function onto Dagster, one family at a time.
The design names Phase 4 "yfinance backlogs": profiles, profile detail, industries, fundamentals,
quarterly statements, share stats, news, management, dividends and the per-stock refresh. Its retire
list (§12.1) adds instrument-profile, Tiingo corporate actions and Wikidata industries, and §8 adds a
`market.fiscal_period` dimension.

Measuring production on 2026-10-10 showed this family is not just due for migration. Most of it was
fetched once and has never been refreshed, its statements carry no currency, and the job that turns
its statements into metrics fails a third of the time. The outcome wanted:

- every equity's company facts refreshed weekly;
- statements re-read within one visit of each earnings report, and labelled with their currency;
- TTM derivation run off PostgREST's 8 s ceiling;
- correct quote and reporting currencies;
- the edge family retired, while asking Yahoo for less than it does today.

## Current state, measured 2026-10-10

### What the edge resources do

Each runs ~13.7 times a day from the 5-minute rotation (21 enabled rows), through `openbb-api`.

| Resource | Upstream call | Writes | Refresh rule (its `pending_*` view) | State |
|---|---|---|---|---|
| `security-profiles` | `equity/profile`, 20 symbols | `security_taxonomy` level 1 (yfinance), `security.market_cap`, `provider_country_iso2` | until a yfinance sector exists | drained, never re-asks |
| `security-industries` | `equity/profile` | `security_taxonomy` level 2 (node created per sector + industry label), `market_cap`, `security.currency_code` | until an industry exists | drained |
| `security-profile-detail` | `equity/profile` | `security_profile` (description, employees, website, HQ, beta) | until a row exists | drained |
| `security-fundamentals` | `equity/fundamental/metrics`, 10 symbols | `security_fundamentals` (+ `raw`), `market_cap`, `writeCurrencyFor` → `listing.currency_code` and `security.currency_code` | until a row exists | drained |
| `security-share-stats` | `equity/ownership/share_statistics` + `equity/estimates/consensus`, 40 symbols | `security_share_stats`, `security_estimate` (time series) | 7 days | ~1,637 + ~1,238 securities a day |
| `security-management` | `equity/fundamental/management`, 1 symbol | `security_officer` (upsert, never retracts) | 180 days, holdings ≥ 0.5% | 1,807 companies |
| `security-quarters` | income/balance/cash `period=quarter`, 1 symbol | `security_statement` quarter rows; then derives metrics and TTM | until any quarter row exists | 3,785 pending; 62 securities a day |
| `security-statements` | SEC income/balance/cash (US ticker), then yfinance annual | `security_statement` annual rows | until any statement, or no currency for a SEC filer | 7 pending |
| `security-dividends` | `equity/fundamental/dividends` | `security_corporate_action` dividends | 30 days | 280 a day |
| `security-news` | `news/company`, 20 symbols | `news_article`, `news_security` | 7 days | ~1,800 a day |
| `security-corporate-actions` | Tiingo (keyed) | `security_corporate_action` dividends and splits | 30 days | 368 securities; 1,412 pending |
| `instrument-profile` | `equity/profile` | `market.instruments` (curated overlay) | weekly | 35 rows |
| `security-wikidata-industries` | Wikidata SPARQL | `security_taxonomy` (wikidata) | once | idle; 9,661 marked absent |
| `security-refresh` | profile + metrics + statements for one symbol | as above | admin button | **0 calls in 44 days** |
| `security-metrics` (pg_cron `muffin-metrics`, :24 and :54) | none — `derive_security_metrics`, `derive_ttm` | `security_metric` | every 30 min | **101 of 334 runs failed in 7 days**, 90% at 00–01 UTC, `derive_ttm` cancelled at 8 s; `pending_ttm` 4,082 |

### How old and how complete the data is

| Table (source) | Rows | Securities | as_of min / median / max |
|---|---|---|---|
| equities | | 12,660 | |
| `security_fundamentals` (yfinance) | 11,879 | 11,879 | 08-11 / **08-13** / 10-03 |
| `security.market_cap` | | 11,929 | 08-11 / **08-13** / 10-10 |
| `security_profile` | 12,112 | 12,112 | 08-21 / **08-23** / 10-03 |
| `security_taxonomy` (yfinance) | 23,813 | 11,936 | 08-10 / 08-13 / 10-10 |
| `security_share_stats` | 72,112 | 11,904 | p50 09-12 / max 10-10 |
| `security_estimate` | 64,972 | 9,470 | p50 09-13 / max 10-10 |
| `security_officer` (yfinance-profile) | 16,062 | 1,807 | 08-22 / 08-30 / 09-30 |
| statements, annual (yfinance) | 107,016 | 11,019 | 08-11 / **08-14** / 10-10 |
| statements, quarter (yfinance) | 47,613 | 4,576 | 08-21 / 09-13 / 10-10 |
| statements, annual (sec) | 42,283 | 1,162 | 08-21 / 09-08 / 10-06 |
| dividends (yfinance) | 313,528 | 9,755 | p50 09-22 |
| dividends + splits (tiingo) | 6,799 | 368 | |
| news links (yfinance) | 63,234 | 6,010 | articles to 10-08 |

- **Currency.** 154,629 of 154,629 yfinance statement rows have `currency` null, and so do all
  ~1.03 M yfinance metric rows. P/E for a non-US filer falls back on `security.reporting_currency`.
- **Negative caches set on equities:** profile 834, industry 3,234, fundamentals 472, quarters 28,
  share stats 1,515, dividends 2,247, provider country 198, statements 306, statement currency 119,
  Tiingo 2, Wikidata 9,661.

### What it costs

The family makes about 5,600 provider calls a day: share stats and estimates ~2,900, news ~1,800,
statements ~500, dividends 280. In the installed stack (yfinance 1.7.0, openbb_yfinance 1.6.3),
`get_info()` is **3 Yahoo URLs**: quoteSummary with five modules, `v7/finance/quote`, and a
`trailingPegRatio` timeseries. Profile, metrics, consensus, management and quote each call it for
the same company, and share statistics adds a second quoteSummary for holders. Statements are one
URL per statement type per frequency. No family run was throttled in the 7 days measured. The price
sweep was clean every night: 2,500 keys, ~310 calls, `throttled 0`.

### Defects found while measuring

1. **Most facts are fetched once and never refreshed.** Fundamentals, profiles, industries, quarterly
   and annual yfinance statements all leave their backlog for good once a row exists. So a non-SEC
   company's TTM EPS never gains a quarter, and the P/E chart divides today's price by a stale
   denominator.
2. **`writeCurrencyFor` writes the metrics response's `currency` into `listing.currency_code` and
   `security.currency_code`.** In openbb_yfinance 1.6.3, `KeyMetrics.currency` is an alias of Yahoo's
   `financialCurrency`, the *reporting* currency. That would explain the quote currency spec's wrong
   labels: VOD.L EUR, 0992.HK USD, CSU.TO USD. **Unconfirmed**: `openbb-api` runs an unversioned
   `openbb[all]`, so the alias must be measured there.
3. **`security_market_cap_usd`** multiplies an August cap by the FX rate of `security.currency_code`.
   It feeds cap bands, style, peers and the cap-weighted aggregates.
4. **Dividends are already held.** `raw_price_history` rows carry `dividend` and `split_ratio`
   (openbb's `include_actions` defaults to true). Dagster's `security_return` meanwhile reads
   dividends from `security_corporate_action`, which only the edge writes.
5. **`earnings-history` (Phase 6) has failed every run for 7 days**, stuck at 2016-06-30 on
   `openbb 500 … 'NoneType' object has no attribute 'get'`.
6. **`/mnt/data` is 67% full**: `supabase-db-data` 23 GB, `http-cache-data` 29 GB of its 40 GB cap.

### Readers

| Reader | Reads | Filters |
|---|---|---|
| `use-fundamentals.ts` | `security_fundamentals_current`: `pe_ratio, forward_pe, price_to_book, profit_margin, operating_margin, return_on_equity, revenue_growth, debt_to_equity, dividend_yield, beta, as_of` | `symbol`, limit 1 |
| `use-security-profile.ts` | `security_profile`: `description, employees, website, hq_city, hq_state, hq_country, beta, as_of` | `security_id` |
| `use-leadership.ts` | `security_leadership`: `name, title, pay, age, fiscal_year, is_ceo, pay_currency` | `security_id`, order `is_ceo`, `pay` |
| `use-market-stats.ts` | latest `security_share_stats` and `security_estimate` row | `security_id`, order `as_of` |
| `use-security-actions.ts` | `security_corporate_action`: `ex_date, kind, value, source_code` | `security_id`, limit 200 |
| `use-statements.ts` | `security_statement_current`: `period_ending, reporting_currency, data` | statement, symbol |
| `use-statement-table.ts`, `use-security-metrics.ts` | `security_metric_series` | symbol, period type, category or metric |
| `use-ratio-series.ts` | `security_ratio_series` | symbol, grain |
| `use-security-news.ts` | `security_news` | symbol (unchanged by this phase) |
| `security-refresh-button.tsx`, `refresh-button.tsx` | `triggerRefresh('security-refresh' / 'instrument-profile')` | admin only |

Views over the tables: `coverage_current`, `security_facet_status`, `security_style` (book-to-price
and USD cap), `security_fundamentals_current`, `security_statement_current`, `security_leadership`,
`security_news` and the family's `pending_*` views. Guards: `check_fundamental_units.py` (median
bands), `check_derived_metrics.py`, `check_anon_read_latency.py`. Grafana: `coverage.json`,
`pipeline.json`, `rules.yml`.

### Everything still on the edge, by phase

- **4 (this spec):** the table above, except `security-news` (→ 6) and
  `security-wikidata-industries` (→ 7).
- **5 (SEC):** `security-statements` (made SEC-only here), `-xbrl`, `-filings`, `-insider`,
  `-filing-history`, `-segments`.
- **6:** the KR, IN and CN filings and segments, `macro-indicators`, `earnings-calendar`,
  `earnings-history`, `security-price-targets`, `security-eps-history` (unscheduled), `security-news`.
- **7:** `facets-refresh`, `observability-sample`, the pg_cron samples, Wikidata.

## Decisions (the user, 2026-10-10)

| # | Topic | Chosen | Rejected |
|---|---|---|---|
| 1 | Scope | **Yahoo company data**: the nine yfinance resources (profiles, profile detail, industries, fundamentals, share stats and estimates, management, quarters, dividends, security-refresh), the yfinance half of annual statements, and the metric/TTM derivation pulled from Phase 7 | as designed (the ten, plus instrument-profile, Tiingo and Wikidata, metrics in Phase 7); stale facts only |
| 2 | Fetch | **Own the requests**: one quoteSummary document per company plus the fundamentals-timeseries documents, each stored whole; transport chosen by measurement | openbb routes in-process, one per facet |
| 3 | Cadence | **Summary every 7 days; statements on the first visit after an earnings date, else every 90 days** | every 14 days; daily for the ~2,500 heaviest, monthly for the rest |
| 4 | History | **Raw appends every statements document**; the summary keeps its latest; core tables latest-only; share stats and estimates stay time series | point in time in core (observed_at/superseded_at); raw keeps everything; latest only |
| 5 | Quote-currency spec | **Phase 4's Stage 0**, its five recommendations taken as decided | separate before; after |
| 6 | Fiscal period | **Deferred to Phase 5** (SEC carries fiscal year and period natively) | now |
| 7 | News | **Stays on the edge until Phase 6** | move; narrow and move; drop |
| 8 | Refresh button | **The edge handler becomes the GraphQL shim**, launching the stock's partitions in Dagster | remove the button |
| 9 | Tiingo | **Retire after a Yahoo parity check** over its 368 securities | second source with source in the key; leave it |
| 10 | Promotion waves | **Phase 4's last stage**, with the cap from the measured per-company Yahoo spend | in Phase 3 now with the price-only cap; after Phase 5 |
| 11 | Statement key | **The Yahoo writer never replaces a SEC row**; key and precedence revisited with fiscal periods in Phase 5 | source in the key; skip SEC filers |
| 12 | Market cap | **In `security_fundamentals` with its own currency**; `security_market_cap_usd` re-pointed; `security.market_cap` kept until contract | a currency column on `security`; also a daily rebased cap |
| 13 | Wikidata | **Stays on the edge until Phase 7** | move now; retire |

Point in time: the 09-09 design decided `observed_at`/`superseded_at` in core for Phase 1, and that
was never built. Decision 4 replaces it for this family. Every statements document stays in raw, so
a restatement is recoverable by re-parsing, without versioned core tables.

## Data model

Declarative `stack/supabase/schemas/` plus generated migrations. Each changed object's `schemas/`
file comes from CI's `repeatable-bundle` artifact.

- **`security_fundamentals`** (grain: one row per security, the latest Yahoo snapshot):
  - add `market_cap numeric` and `market_cap_currency text` (FK `currency`);
  - `security_market_cap_usd` converts by `market_cap_currency`, and falls back to `security.market_cap`
    × `security.currency_code` only while a security has no new row;
  - the columns the app reads keep their units (margins and ROE fractions, `dividend_yield` percent —
    `check_fundamental_units.py`'s contract).
- **Quote currency is observed, and each column has one writer.**
  - The source is the summary's `price.currency` for the asked yfinance symbol, mapped explicitly
    (`GBp → GBX`, `ZAc → ZAC`, `ILA`, `KWF`), never case-folded.
  - `security_listing.currency_code` takes it through the listing derivation. *To decide in the
    low-level design:* a small observation table, or a read of the summary's stage-2 output.
  - Nothing else writes that column. The edge's `writeCurrencyFor` retires with its three callers, so
    Phase 3 Stage 2c's second decision ("how `writeCurrencyFor` updates a listing once
    `market.listing` is a view") disappears.
- **Reporting currency.** `security.reporting_currency` comes from `financialData.financialCurrency`.
  Statement rows carry the timeseries `currencyCode`, so `security_statement.currency` is finally set
  for Yahoo rows, and `derive_security_metrics` already carries it into `security_metric.currency_code`.
- **`security_statement`** (grain unchanged: one row per security, statement, period end and period
  type): no schema change. The Yahoo writer's `do update` adds `stored_row.source_code = 'yfinance'`
  to the existing `is distinct from` guard, so a period SEC holds keeps SEC's row. This needs an
  option on `writers.upsert`.
- **`security_officer`**: replaced per security, so departed officers retract; the edge upserts and
  never retracts. **`security_taxonomy`** yfinance rows: replaced per (security, `yfinance`).
- **Grants and RLS** for `ingest_rw` on every table written, as two independent gates.
  `EXECUTE` on `derive_security_metrics(integer)` and `derive_ttm(uuid, integer)`: false today.
- **`pending_statements`** is re-keyed so the edge's SEC half keeps asking CIK holders with no `sec`
  rows. Today it asks those whose statements lack a currency, and once Yahoo rows carry one, SEC
  depth (18 years against Yahoo's 4) would silently stop before Phase 5.
- **Contract, after retirement:**
  - the family's `pending_*` views;
  - the negative caches `profile_missing_at`, `profile_detail_missing_at`, `industry_missing_at`,
    `fundamentals_missing_at`, `share_stats_missing_at`, `estimates_missing_at`,
    `quarters_missing_at`, `dividends_missing_at`, `provider_country_missing_at`,
    `corporate_actions_missing_at`, `management_fetched_at`, removed from `clear_symbol_caches` and
    `symbol_cache_classification`;
  - `security.market_cap` and `market_cap_at`.

  Each gets a drop date and the query proving nothing reads it.
- No `market.fiscal_period` (decision 6). The summary's fiscal-year-end fields stay in raw for it.

## Architecture (Dagster)

A new family `defs/companies/`. Asset, job, schedule and check names below are proposals; names are
state, so they are fixed in the PR that introduces them and never renamed as a side effect.

| Asset | Stage | Partitions | Backfill | Pool | Trigger | Writes |
|---|---|---|---|---|---|---|
| `raw_yahoo_summary` | 1 | `security` (the price grid) | `multi_run(W)` | `yfinance` | rotation; `on_missing()` for new keys; on demand | latest quoteSummary document per company |
| `raw_yahoo_statements` | 1 | `security` | `multi_run(W)` | `yfinance` | same job; `deps=[raw_yahoo_summary]` | every timeseries document, appended |
| company facts (`@multi_asset`, one output per table) | 2 | `security` | `multi_run(W)` | `sql` | same job | `security_profile`, `security_officer`, `security_fundamentals`, `security_share_stats`, `security_estimate`, Yahoo taxonomy rows, `provider_country_iso2`, `reporting_currency`, observed quote currency |
| `security_statement` (Yahoo writer) | 2 | `security` | `multi_run(W)` | `sql` | same job | yfinance annual and quarter rows, with currency |
| `security_corporate_action` | 2 | `security` | `multi_run(25)` | `sql` | `nightly_prices` job, from chart events (Stage 0) | yfinance dividends and splits |
| derived metrics | 3 | none | — | `sql` | `eager()` on the Yahoo statements, without the missing-deps gate, OR `cron_tick_passed("*/30 * * * *")` for the edge's SEC and XBRL writes | `derive_security_metrics` and `derive_ttm`, paged under `ingest_rw`'s 120 s timeout |
| `security_return` | 3 | none | — | `sql` | eager (existing) | adds `security_corporate_action` as a dep |

- **Job `yahoo_companies`** carries both stage-1 assets and their stage-2 outputs.
  - **Schedule:** daily at 03:30 UTC. The slice is `ceil(grid / 7)` keys (~1,810), cut into runs of
    the measured width W (start at 100). A backfill policy does not apply to a schedule's RunRequest,
    so the schedule reads W from the module that defines it.
  - **Rotation:** `run_key` is day plus offset, and each day resumes after the previous day's last
    key. `_resume_at` and the slicing are extracted from `defs/prices/automation.py` into
    `lib/rotation.py` rather than copied; `nightly_prices` keeps its names and tags.
  - **Run settings:** `dagster/max_runtime` on every run, priority 0. Freshness policies go on the
    scheduled assets only, as the guard test requires. Pools stay within the tested allow-list
    (`yfinance`, `sql`).
- **Due logic, in stage 1, from what raw already holds:**
  - a summary is due after 7 days;
  - statements are due when the stored summary's earnings date has passed since the last statements
    document, after 90 days, or if they were never fetched.

  A visited partition with nothing due writes nothing new, and the merge manager keeps the stored file.
- **On demand:** the edge's `security-refresh` becomes the shim.
  - It keeps the admin check, then calls `launchRun` on `http://dagster-webserver:3000/graphql`
    over the overlay (no Access hop): job `yahoo_companies`, partition = the security, config
    `force: true`.
  - It answers `{ ok, queued: true, runId }`, and the button says "queued".
- **Checks** (WARN unless stated):
  - `no_company_is_far_behind_the_rotation`;
  - `statements_carry_a_currency`;
  - `fundamental_units_are_conventional`, the median bands ported from `check_fundamental_units.py`;
  - `yahoo_family_covers_legacy`, transitional parity;
  - every outcome counter sums to `requested`, asserted in tests.
- **Reuse rather than rebuild:**
  - `ParquetIOManager` merge and `Complete` semantics, and `partitioned.by_partition`;
  - `writers.upsert`, with its `is distinct from` guard and `changed` count;
  - `Document`, and `yahoo_chart`'s absence and live-quote rules;
  - `prices.askable_subjects`;
  - `metrics.request`;
  - `PostgresIOManager.replace_scope` for officers.

## Low-level design

### Requests and budget

| Request | Per company | Companies a day | Yahoo requests a day |
|---|---|---|---|
| quoteSummary | 1 | ~1,810 | ~1,810 |
| fundamentals-timeseries: annual and quarterly income, balance, cash | ≤ 6, fewer if longer key lists validate | ≤ ~280 (≈139 reporting a day + the 90-day floor) | ≤ ~1,700 |
| cookie and crumb | per run | ~20 runs | ~40 |

That is about 3,500 a day at most. The edge resources it retires spend an *estimated* ~10,000 Yahoo
URLs a day (news excluded). The estimate comes from openbb's per-call URL count and was not measured
on the wire. The ~2,500-request price night is unchanged.

**quoteSummary modules:** every module stage 2 reads, plus those a later phase may adopt, since they
cost bytes and no requests. That means assetProfile, price, quoteType, summaryDetail,
defaultKeyStatistics, financialData, calendarEvents, majorHoldersBreakdown, earnings,
earningsHistory, earningsTrend, recommendationTrend, upgradeDowngradeHistory, insiderHolders,
insiderTransactions, netSharePurchaseActivity, institutionOwnership, fundOwnership,
majorDirectHolders, secFilings and esgScores. Not the gutted `*StatementHistory*` modules, the
trends or `futuresChain`. *To measure:* body size, and whether any module fails the request for a
non-US symbol.

**Pacing:**
- No faster per request than the price lane.
- Stop the run on a throttle and count the rest `unasked`.
- Never run inside 00:00–02:00 UTC, the price night.

### Transport (validation decides)

Candidates, in order; the first that answers quoteSummary and timeseries for US and non-US symbols
without refusals wins:

1. plain requests through http-cache's `yahoo` location, with caching off or short for these paths
   so its 29 GB does not grow;
2. a cookie-and-crumb session through the same location;
3. yfinance's `YfData` session (curl_cffi browser impersonation, consent fallback), going direct.

The crumb is redacted from the stored `url`, which closes
[the raw-credentials note](../deferred/2026-09-16-raw-request-credentials.md). The worker's
Prometheus counter counts Yahoo URLs per endpoint, not openbb calls.

### Raw

- **`raw_yahoo_summary`.** One `Document` row per fetch (`body`, `url` with the crumb redacted,
  `sha256`, `content_type`, `fetched_at`, `run_id`) plus `security_id` and `asked_symbol`, under
  raw-layer rule (a). A new fetch replaces the partition, which keeps only the latest document.
- **`raw_yahoo_statements`.** The same Document shape plus the type list asked. It merges on
  `fetched_at`, so every document stays.

### Stage-2 rules

Each rule gets a fixture where the right rule and the wrong one disagree.

- **Field spellings.** Statements reproduce openbb's yfinance names exactly: snake_case plus
  openbb's aliases, as in `total_pre_tax_income`, `diluted_earnings_per_share`,
  `weighted_average_basic_shares_outstanding`. So `metric_source_field`, `derive_security_metrics`,
  `security_statement_current` and the app need no change. The gate is parity against the openbb
  route on captured bodies.
- **Classification.**
  - Sectors go through the edge's sector map.
  - Industry nodes `<sector>--<slug(label)>` are created on discovery, under the sector.
  - HQ country resolves through `countries` and `country_alias`, and unresolved names are counted
    and named.
- **Units and dates.**
  - Units as today's rows hold them, read from validation and never assumed.
  - Officer pay of 0 becomes null.
  - Share stats `as_of` is Yahoo's short-interest date; estimates `as_of` is the fetch date.
  - A currency code is learned (inserted) before it is referenced, because of the FK.
- **Absences.** A quoteSummary absence is a counter, never an `identifier_probe` row: a
  `(symbol, yfinance)` miss hides a security from the price sweep for 30 days and triggers
  symbology repair.
- **Population.** The askable population is `prices.askable_subjects`: equities with a live
  yfinance symbol.

## Validation

To measure from the node before code (rollout step 4), recorded here with dates:

- **Subjects:** quoteSummary and timeseries for AAPL, SAP.DE, 7203.T, 005930.KS, BHP.AX, SHEL.L,
  VOD.L, NESN.SW, 0992.HK, CSU.TO, an ETF, a dead symbol and a thin OTC line (ASMLF).
- **The transport ladder above.** Crumb needed or not, per endpoint.
- **Bodies:** sizes; the units of every column the app reads; `marketCap`'s currency for a pence
  listing; `currencyCode` on timeseries points; how many periods come back; the longest key list
  that still answers.
- **Pace:** a bounded probe of ~200 requests at the chosen pace, away from the price night.
- **The `writeCurrencyFor` hypothesis:** `openbb-api`'s metrics `currency` for VOD.L, 0992.HK and
  CSU.TO.
- **Fixtures** under `libs/muffin-ingest-lib/tests/fixtures/yahoo/`, with a re-capture note.

## Dependencies and isolation

No new dependency is expected. httpx, yfinance and curl_cffi are already in the image through the
hub extra, so isolation stays at rung 1, one environment. If the chosen transport is `YfData`, the
library calls it directly for the session only, and its parsing stays unused.

## UI impact

- No view's column contract changes. Fundamentals, profile, leadership, stats and statements read
  the same views, now fresh.
- Statement currency labels come from the rows themselves, so `reporting_currency` stops being a
  fallback for Yahoo rows.
- The refresh button shows "queued" (muffin-ui PR).
- `refresh-button.tsx` drops `instrument-profile` if that resource retires. It retires only if every
  curated equity in `market.instruments` resolves to a security; otherwise it stays.
- `check_anon_read_latency.py` covers every view redefined (`security_market_cap_usd` and the
  ratio view).

## Observability

- **Prometheus:** Yahoo URLs by endpoint and outcome, from the worker.
- **Grafana:**
  - the providers dashboard gains a Yahoo panel;
  - the pipeline dashboard gains the family's runs and rows written (zeros included);
  - coverage freshness facets move once the family refreshes.
- **Alerts:** the stalled-resource rule loses the retired resources by itself, since they become
  disabled rows.
- Read every alert rule's own query after each step.

## Rollout

| # | Repo | Change | Gate |
|---|---|---|---|
| 1 | umbrella | this spec; the currency spec's §10 recorded; design §8 links here; `todos.md` Phase 4 | — |
| 2 | deployment | market-verify tripwire for the known annual pairs | market-verify green |
| 3 | deployment → ingest | Stage 0, the quote-currency spec | one clean night; the 13 sampled labels right |
| 4 | ingest | validation from the node; fixtures | *Measured* complete; transport chosen |
| 5 | deployment | schema (above) | deploy green |
| 6 | ingest | library, `defs/companies/`, derived metrics, corporate actions, `lib/rotation.py`, checks, tests | local tiny subset |
| 7 | ingest | roll; live tiny subset; parity against the edge tables, every difference explained | parity recorded here |
| 8 | ingest | schedule live; first rotation, with a deferred check note | counters sum; `throttled 0`; price night clean |
| 9 | deployment + ui | retire (RETIRES markers, 410s, cron rows, `muffin-metrics` unscheduled, statements SEC-only, the shim, Tiingo after its parity) | 410s live; `pending_ttm` drains |
| 10 | deployment | delete the handlers after 3 clean days; contract | `deno check`, logic-check, dashboards render |
| 11 | deployment → ingest | promotion waves; cap = min(price capacity, Yahoo family capacity) | first wave ≤ capacity; nights `throttled 0` |
| 12 | all | Grafana, docs, skills | — |

**Prerequisites:**
- **A working deploy.** The Cloudflare token is the user's to replace; #422 deploys first.
- **The ingest-roll decision**
  ([note](../deferred/2026-09-26-a-deploy-rolls-the-ingest-image.md)). Until it is taken, no deploy
  inside 00:00–02:00 or 03:30–05:30 UTC.

## Risks and rollback

- **Yahoo refuses, or fingerprints our TLS:** the transport ladder, stop-on-throttle, and a cooldown.
  The price night keeps its own window.
- **Two writers in the overlap:** the edge and Dagster use the same keys and source on
  `security_statement` and `security_corporate_action`, and the edge's dividends retire at switch-on.
- **Units or spellings drift:** the median-band check and the spelling parity gate.
- **Rollback:**
  - before step 10, re-enable a `cron_resource` row, remove its `RETIRED` entry, and stop the
    `yahoo_companies` schedule;
  - Stage 0 rolls back to `raw_price_history`.

## Deferred

Notes to write as their triggers arrive:
- `earnings-history` stuck at 2016-06-30 (Phase 6);
- http-cache at 29 of 40 GB against `/mnt/data` at 67%;
- the `yahoo` and `yfinance` pools, which are two pools for one provider;
- the statement key and fiscal periods (Phase 5);
- the drop dates for `security.market_cap*` and the negative-cache columns;
- removing the Tiingo token;
- the first rotation's check.

## Open questions

Closed by validation (step 4):
- the transport;
- the units of `dividend_yield` and `debt_to_equity` as Yahoo sends them;
- `marketCap`'s currency for pence listings;
- the timeseries key-list limit;
- run width W.
