# Yahoo company data on Dagster (Phase 4) — design

Status: APPROVED 2026-10-10 (scope, fetch, cadence, history and nine further decisions below).
Validated from the node the same day (transport, currencies, units, statement shape); the items under
*Still to measure* close during the live tiny subset. Extends
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
   labels: VOD.L EUR, 0992.HK USD, CSU.TO USD. **Confirmed the same day** against `openbb-api`
   itself (see *Validation*).
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
| 14 | Quote currency's writer (asked while building step 5) | **The price lane**: `derive_security_price_span` records the newest bar's label, `security_currency` prefers it, and the company lane's `price.currency` is only a cross-check | a company-lane table from quoteSummary; readers probing the newest bar live |
| 15 | Semi-annual reporters' ratios | First **a TTM from two halves**. Measured afterwards: Yahoo gives these companies no interim flows, so there is nothing to sum. Re-decided: **the ratio view falls back to the fiscal year, per security and metric, labelled `eps_basis`** | no earnings ratios for them; decide later |
| 16 | The TTM defect found in step 5 | **Derive SEC's fiscal Q4 and require four consecutive quarters**, retracting what the rule no longer produces | consecutive only (SEC filers lose TTM ratios until Phase 5); leave for Phase 5 |
| 17 | The chart lane's pace (asked 2026-10-11, after its first night) | **Keep 1.4 s between requests**, amending the quote-currency spec's decision 5. That figure was derived from the whole night, not the fetch step, and is ~45% of the old rate: the night ends ~02:15 instead of ~01:40, and the company lane gets headroom for its ~2,400 requests a day | back to the old ~0.65 s |
| 18 | A symbol containing `/` (18 Bloomberg spellings) | **Encode it as `%2F` and have http-cache forward the path undecoded**, so Yahoo states the absence and the lane marks a miss like any other | refuse it as not askable; leave it |
| 19 | Deploys rolling the ingest image | **Pin the digest**: only `roll-ingest` changes the ingest image, writing the same `…:latest@sha256:` string the deploy renders, so a deploy never restarts Dagster | the deploy fails what it killed; an operating rule only |
| 20 | The price chart's currency (asked 2026-10-17, after #137's render check) | **The bars it draws**: `price_series` carries each bar's `currency_code`, and the page labels the title and dividends from the newest row. A bar with no label gives an unlabelled title | observed-only `security_current`/`instrument_current` (labels fill in over a rotation); merging #137 as is (~1,000 wrong titles for days, the ADRs for good) |
| 21 | One quarter, two dates (asked 2026-10-17, after step 7's parity) | **Align in the view**: `security_metric_series` clusters dates across all of a period's metrics and reports every metric at the cluster's highest-priority date | no Yahoo quarters for SEC filers (loses quarterly R&D and gross profit); grouping columns in the UI (other readers still see two dates) |

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
- **Half-years.** `security_statement.period_type` gains the value `half`. The column is free text,
  and nothing reads `half` until the app asks for it.
  - A `market.one_shot` repair deletes the 3,090 yfinance `quarter` rows that are half-years, and
    the `quarter` metrics derived from them. The lane re-writes them as `half` on its first visit.
  - The rule is the CADENCE of a company's quarterly series: it is half-yearly only if EVERY gap
    between period ends is 170–195 days. *Corrected 2026-10-11:* a single 170–195-day gap is not
    enough. 2,210 securities have one, and 1,451 of them also have 90-day gaps: they are quarterly
    reporters missing a quarter (600011.SS 2025-12-31, 184 days after 2025-06-30, carries a
    three-month income statement).
- **http-cache (`stack/proxy/nginx.conf`):**
  - `proxy_buffer_size 16k` and `proxy_buffers 8 16k` on the `yahoo` locations;
  - `large_client_header_buffers 4 16k` for the 12 KB statement URLs;
  - a quoteSummary location with `proxy_no_cache 1`.

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
  - statements are due when never fetched, after 90 days, when forced, or when the summary fetched in
    the same visit names a newer period than any stored document holds. *Changed 2026-10-11, see
    Validation:* `defaultKeyStatistics.mostRecentQuarter`/`lastFiscalYearEnd` replace the earnings
    date, and a named period gets at most three asks.

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
| fundamentals-timeseries: all three statements, one request per frequency (measured: 375 types answer, 750 do not) | 2 | ≤ ~280 (≈139 reporting a day + the 90-day floor) | ≤ ~560 |
| cookie and crumb | per run | ~20 runs | ~40 |

That is about 2,400 a day at most. The edge resources it retires spend an *estimated* ~10,000 Yahoo
URLs a day (news excluded). The estimate comes from openbb's per-call URL count and was not measured
on the wire. The ~2,500-request price night is unchanged.

**quoteSummary modules:** every module stage 2 reads, plus those a later phase may adopt, since they
cost bytes and no requests. That means assetProfile, price, quoteType, summaryDetail,
defaultKeyStatistics, financialData, calendarEvents, majorHoldersBreakdown, earnings,
earningsHistory, earningsTrend, recommendationTrend, upgradeDowngradeHistory, insiderHolders,
insiderTransactions, netSharePurchaseActivity, institutionOwnership, fundOwnership,
majorDirectHolders and secFilings. Not esgScores (absent for every symbol measured), and not
summaryProfile (assetProfile without the officers). Not the gutted `*StatementHistory*` modules, the
trends or `futuresChain`. *To measure:* body size, and whether any module fails the request for a
non-US symbol.

**Pacing:**
- No faster per request than the price lane: 1.4 s between requests (decision 17).
- Stop the run on a throttle and count the rest `unasked`.
- Never run inside 00:00–02:00 UTC, the price night.

### Transport (decided by the measurements below)

- **Our own httpx client, with a cookie-and-crumb session for quoteSummary.** The session is
  `fc.yahoo.com` for the `A3` cookie, then `getcrumb`, once per run. Timeseries needs no crumb.
- **Through http-cache's `yahoo` location**, once the three nginx changes below ship with the
  schema. Direct is the measured fallback. yfinance's `YfData` session is not needed.
- **The crumb is redacted from the stored `url`.** That closes
  [the raw-credentials note](../deferred/2026-09-16-raw-request-credentials.md).
- **The worker's Prometheus counter counts Yahoo URLs per endpoint**, not openbb calls.

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
  - Industry nodes `<sector>--<slug(label)>` are created on discovery, under **Yahoo's own sector**.
    The edge hung them under whatever sector the security was already served under, minting
    `industrials--software-application` for Uber. Measured 2026-10-11: the two sectors differ for
    23 of 11,939 securities with a Yahoo sector, and those now show no industry rather than one
    from another sector.
  - HQ country resolves through `countries` and `country_alias`, and unresolved names are counted
    and named.
- **Statements merge per line.** Yahoo's window rolls per LINE, not per period: Samsung's
  2025-03-31 keeps ten of the ~180 lines the edge stored in August. So stage 2 takes the newest
  value any document carries for each (period, line), and the writer merges into the stored jsonb
  (`merge_json`): a narrower answer never erases a stored line, and a restated one wins.
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

### Measured 2026-10-10, from the node

Throwaway containers of the deployed muffin-ingest image on `muffin-net`; ~90 requests paced
1.5 s, midday UTC; no refusal.

**Transport.**

| Endpoint | Without crumb | With cookie + crumb |
|---|---|---|
| quoteSummary | **401** `Invalid Crumb`, through http-cache and direct | **200** through http-cache (the `Cookie` header passes) and direct with plain httpx; no TLS fingerprinting met |
| fundamentals-timeseries | **200**, direct and through http-cache | not needed |
| chart | 200 (the FX lane already uses it) | — |

- **The session:** `GET https://fc.yahoo.com` answers 404 and still sets the `A3` cookie;
  `GET https://query1.finance.yahoo.com/v1/test/getcrumb` with it returns an 11-character crumb.
  That is two requests per session.
- **yfinance's `YfData` session also works, but is not needed.**
- **http-cache needs three changes before it can carry this family:**
  - **`upstream sent too big header`:** a 502 on a 103-type timeseries request, every time,
    while the same request direct returns 200. This is the NSE defect of 2026-10-03, now on the
    `yahoo` locations, so they need `proxy_buffer_size 16k` and `proxy_buffers 8 16k`.
  - **`414 Request-URI Too Large`** from nginx itself above 8 KB, under the default
    `large_client_header_buffers`. The statement requests below are 12 KB, so the server needs
    `large_client_header_buffers 4 16k`.
  - **`proxy_no_cache`** on quoteSummary. The crumb makes every URL a new key, and the generic
    `/yahoo/` location keeps bodies until LRU eviction against the 40 GB cap.
- **The pick: our own httpx client, through http-cache once those three ship.** Direct is the
  fallback, and it was measured working.

**quoteSummary, 22 modules in one request.**

| Measure | Result |
|---|---|
| Body size | 20–68 KB for most equities, **294 KB for AAPL** (971 analyst actions, SEC filings); 4 KB for SPY |
| Latency | 30–80 ms |
| Missing modules | never fail the request. `esgScores` is absent for every symbol, so it is dropped from the list. Non-US symbols lack `upgradeDowngradeHistory` and `secFilings`; `fundProfile` is ETF-only |
| SPY (ETF) | answers `price`, `summaryDetail` and `defaultKeyStatistics` only; the lane asks equities only |
| BDMS-F.BK (dead) | **404** `Quote not found for symbol: BDMS-F.BK`, an absence that names the symbol |
| ASMLF (OTC line) | answers: financial currency EUR, quote USD |

**Currencies.**

| Listing | `price.currency` | `financialCurrency` |
|---|---|---|
| AAPL | USD | USD |
| SAP.DE | EUR | EUR |
| 7203.T | JPY | JPY |
| 005930.KS | KRW | KRW |
| BHP.AX | AUD | **USD** |
| SHEL.L | GBp | **USD** |
| VOD.L | GBp | **EUR** |
| NESN.SW | CHF | CHF |
| 0992.HK | HKD | **USD** |
| CSU.TO | CAD | **USD** |

- **`marketCap` for a pence listing is in pounds**: VOD.L 27,418,447,872 against a 118.35p price.
  So the cap's currency is the quote currency's parent. *ZAc and ILA still to measure.*
- **The `writeCurrencyFor` hypothesis is CONFIRMED.** `openbb-api`'s
  `equity/fundamental/metrics.currency` is `financialCurrency`: VOD.L EUR, 0992.HK USD, CSU.TO USD.
  That is the value the edge writes into `listing.currency_code` and `security.currency_code`, and
  it explains the currency spec's wrong labels.

**Units against today's rows** (same securities, `security_fundamentals`):

| Field | Yahoo sends | Stored today | Rule |
|---|---|---|---|
| margins, ROE | fraction | fraction (identical) | as sent |
| `debtToEquity` | percent-like (SAP 21.966) | 21.966 | as sent |
| `dividendYield` | fraction (SAP 0.0133) | percent (1.39) | ×100 |
| `fiveYearAvgDividendYield` | percent | — | stays in raw only |
| `priceToBook` | price as quoted ÷ `bookValue` in the quote's major unit | August rows plausible (SHEL.L 1.46, VOD.L 0.62) | ÷ the subunit factor |

**CORRECTED 2026-10-11. The first version of this table said Yahoo's P/B was wrong whenever the
quote and reporting currencies differ, and called BHP.AX, 0992.HK and CSU.TO wrong. They are
right.** Comparing `bookValue` with equity per share from the balance sheet shows Yahoo converts the
book to the QUOTE currency's major unit: BHP.AX 14.40 against 9.73 USD (AUD), 0992.HK 4.21 against
0.55 USD (HKD), VOD.L 1.88 against 2.19 EUR (GBP). So the only error is a price in a subunit:

| Listing | Quote / reports | Yahoo's P/B | Right |
|---|---|---|---|
| BHP.AX | AUD / USD | 4.23 | 4.23 |
| 0992.HK | HKD / USD | 7.79 | 7.79 |
| CSU.TO | CAD / USD | 11.0 | 11.0 |
| VOD.L | GBp / EUR | 62.9 | 0.63 |
| BARC.L | GBp / GBP | 88.2 | 0.88 |
| NPN.JO | ZAc / USD | 144.4 | 1.44 |
| AZRG.TA | ILA / ILS | 167.2 | 1.67 |
| NBK.KW | KWF / KWD | 1,664 | 1.66 |

**Stage-2 rule:** `priceToBook` divided by the quote's subunit factor (`fx.SUBUNITS`), and as sent
otherwise. No FX rate is needed.

**P/E, measured the same way:** `summaryDetail.trailingPE` and `forwardPE` divide the major-unit price
by EPS that Yahoo has converted to the same unit. SHEL.L's trailing EPS of 3.38 is its 4.53 USD
in pounds; NPN.JO's 106.34 is 6.11 USD in rand. They are right everywhere measured.
`defaultKeyStatistics.forwardPE` is not: it divides the price as quoted by EPS in the reporting
currency (VOD.L 1,001, BHP.AX 23.5, where 11.8 and 16.3 are right). It is used only as a fallback,
and only where the two currencies are spelled identically. BARC.L shows why identity matters:
`GBp` and `GBP` share a major unit, and a rule comparing major units would take 665.7.

**Market cap, subunits measured 2026-10-11:** cap / (price × shares) is 0.01 for ZAc (NPN.JO,
SBK.JO) and ILA (AZRG.TA), and **0.001** for KWF (NBK.KW). So a cap is in the major unit of every
quote.

**fundamentals-timeseries.**

| Measure | Result |
|---|---|
| One request | all three statements of one frequency: 375 types, 12 KB URL, 126–167 KB answer, 0.2–0.35 s |
| 750 types (annual + quarterly) | **400** from Yahoo, so a statements visit is **2 requests** |
| `currencyCode` | on every point, the reporting currency (VOD.L EUR, 0992.HK USD, BHP.AX USD). This closes the no-currency defect at the source |
| Annual | 4–5 fiscal years, `periodType` `12M` |
| Quarterly | up to 6 periods, `periodType` `3M` |

- **Semi-annual reporters come back as half-years labelled `3M`:** VOD.L 2025-03-31, 2025-09-30,
  2026-03-31; NESN.SW and BHP.AX likewise.
- **The edge stored them as quarters.** Production holds **3,090 yfinance "quarter" periods in
  2,188 securities that sit 170–195 days after the previous one.** That is a live mislabel: a half-year
  served in the quarterly tables.
- **Stage-2 rule:** a period's type comes from the gap to the previous period end, not the label;
  half-years are written as `period_type = 'half'` (the column is free text).
- **Gaps happen:** 0992.HK skips its fiscal Q4, which is reported in the annual.

**Fixtures** were captured from these runs (13 quoteSummary bodies, 16 timeseries bodies). They go
to `libs/muffin-ingest-lib/tests/fixtures/yahoo/` with the implementation, with a re-capture note.

**When statements are due, measured 2026-10-11.** `defaultKeyStatistics.mostRecentQuarter` equals
the newest period in the stored timeseries for all 17 listings, half-yearly reporters included
(VOD.L and NPN.JO state 2026-03-31, their half-year). AAPL's 2026-06-27 is filed by the timeseries
under 2026-06-30, so the comparison allows 20 days. The earnings date cannot serve:
`calendarEvents.earnings.earningsDate` names the NEXT report, so once a company has reported, the
date that would have said "fetch" is gone from the newest summary. A period the summary names and
the timeseries never serves gets three asks, then waits for the 90-day refresh.

### Still to measure

- A bounded pace probe of ~200 requests at the chosen pace, during the live tiny subset.
- The crumb's lifetime across a ~20-minute run.

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
| 3 | ingest → deployment | Stage 0, the quote-currency spec. **Ingest live 2026-10-10** (muffin-ingest#104); `GBX` is muffin-deployment#426, awaiting a deploy. As built: [§11 there](2026-10-06-the-price-lane-reads-the-quote-currency.md#11-as-built--2026-10-10) | one clean night; the 13 sampled labels right |
| 4 | ingest | validation from the node; fixtures | *Measured* complete; transport chosen |
| 5 | deployment | schema (above), plus the TTM fix, the fiscal-year fallback and the observed quote currency (decisions 14–16). **muffin-deployment#428, built and verified 2026-10-10**, waiting on a deploy. As built: *As built* below | deploy green |
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
  ([note](../deferred/2026-09-26-a-deploy-rolls-the-ingest-image.md)). Taken 2026-10-11: pin the
  digest (decision 19). Until it is built and deployed, no deploy inside 00:00–02:15 or 03:30–05:30
  UTC.

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

## As built

### Step 5, the schema (muffin-deployment#428, 2026-10-10)

Three migrations and an http-cache change, verified on the node before the PR.

| Migration | What it does | What measuring changed |
|---|---|---|
| `20261010200000_a_market_cap_carries_its_currency` | `security_fundamentals.market_cap` + `market_cap_currency` (FK, stored only together); `security_market_cap_usd` converts by them and falls back to the legacy pair only before the lane's first visit, appending `cap_source`; `security_current` and `instrument_current` take the same cap and append `market_cap_currency` | The stock page's "Market cap" reads `security_current`/`instrument_current`, not the USD view, so leaving those would have shown the August cap beside a fresh one. `sector_constituents` waits for the contract ([note](../deferred/2026-10-10-the-native-cap-readers-left-on-the-legacy-column.md)) |
| `20261010210000_the_worker_derives_metrics_and_a_ttm_backlog_drains` | EXECUTE for `ingest_rw` on both derive functions **and `source_priority`**; `market.ttm_derivation`, a marker `derive_ttm` writes for every security it evaluates; `pending_ttm` asks whether a quarter arrived after it, seeded so the backlog is unchanged at cutover | `source_priority` was found by reading the function bodies. Of 4,094 pending, 656 can never form a TTM, so the old backlog had a floor it could never drain below |
| `20261010220000_sec_depth_is_asked_of_every_cik_holder` | `pending_statements`' SEC half becomes `no_sec` (no SEC row) with a partial index; `pending_quarters` counts `half` rows; `period_type` documented | Today both populations are the same (863 CIK holders with SEC rows, 33 without, 30 marked), so nothing changes until the lane writes Yahoo rows with a currency |

- **The one-shot clean-up of the edge's half-years moved from step 5 to after step 9.** Deleting them
  now would re-queue those companies in `pending_quarters`, and the edge would write them back
  ([note](../deferred/2026-10-10-the-edge-s-half-years-filed-as-quarters.md)).
- **The statements source guard is not schema.** It is the `writers.upsert` option in step 6.
- **http-cache.**
  - `X-Muffin-Cache-No-Store` maps to `proxy_no_cache`.
  - quoteSummary, timeseries and getcrumb each get a location with caching off.
  - `large_client_header_buffers 4 16k`.
  - A `cache_path` log format keeps the crumb out of the log.
- **What the node showed, in the http-cache image on the new config:**
  - The 12,107-byte timeseries URL answers 200, where today's answers 414.
  - Yahoo's response header is 618 bytes. The "too big header" 502 was nginx writing the 12 KB
    cache KEY into the 4 KB buffer, so caching off is the fix, not bigger buffers.
  - A chart request with the header is not stored, and one without it is.
- **Verification.** CI's migration job, replayed on the node, passes every behaviour test. The
  bundle differs in exactly the seven redefined objects. Nine mutations, each confirmed applied,
  are all caught.

**Added the same day, after three decisions (14–16 above), in the same PR:**

| Migration | What it does | What measuring changed |
|---|---|---|
| `20261010210000_a_ttm_is_four_consecutive_quarters` (replaces the marker-only version) | The fiscal Q4 derived as the year less its three quarters (source `derived-q4`); a TTM needs four consecutive quarters (240–300 days); TTMs and Q4s no longer produced are retracted; the marker starts empty so every security is re-evaluated once; the grants | **81,515 TTM revenue rows in 3,439 securities summed Q1+Q2+Q3+next Q1**, because SEC's XBRL writes Q1–Q3 and the old window allowed 370 days. Apple 2025-12-27: 457.45bn stored, 435.62bn true. 28,220 SEC fiscal years can have Q4 derived; 806 give a negative remainder from non-negative inputs and are skipped. Yahoo's own quarterly series already carries Q4 (Apple 2025-09-30 = 102.466bn = FY − Q1–Q3) |
| `20261010213000_ratios_fall_back_to_the_fiscal_year` | Flows take the TTM where the security has one for that metric, else the fiscal year, never both in one series; `eps_basis` appended; a margin only across one basis; stocks take quarter or half | Yahoo's quarterly series for VOD.L, NESN.SW and BHP.AX carry balance-sheet items only at the half-year dates: no revenue, earnings or cash flow |
| `20261010230000_the_stock_page_says_which_currency` | `security_price_span.quote_currency` from the newest bar; `security_currency` prefers it; `security_current` and `instrument_current` append `quote_currency` and `market_cap_currency` | No backfill from bars written before 2026-10-10: their labels are the old lane's guesses, a hundred times out for Tel Aviv and Johannesburg |

Timings on production, read-only:
- the new `pending_ttm`: 0.6 s;
- a `derive_ttm` page of 100: under 1 s (the edge's ceiling is 8 s);
- a page of 1,000: about 5 s (the worker's ceiling is 120 s).

The first pass writes about 7,500 `derived-q4` rows per 100 securities, roughly 0.9M in all. It replaces the wrong TTMs as it goes, starting with the edge's `muffin-metrics` the day this deploys.

**Two rules for step 6 that the node found:**
- **Send the cookie as a `Cookie` header.** A cookie jar is scoped to `.yahoo.com`, and the cache is
  `http-cache:8080`, so an httpx client sends no cookie there and getcrumb answers 401
  `Invalid Cookie`. The `A3` cookie comes from `fc.yahoo.com` directly (no location), and the crumb
  and data go through the cache. query2 serves getcrumb as query1 does (measured).
- **Never log a URL carrying the crumb.** Redact it in raw (`Document.url`) and in any log line.

### Step 6, the library (muffin-ingest#107, 2026-10-11)

Providers `yahoo_session`, `yahoo_summary` and `yahoo_timeseries`; facets `company`, `statements` and
`actions`; three writer options. Nothing calls them until the defs PR.

| Decision | As built |
|---|---|
| quoteSummary request | 20 modules, `formatted=false` as yfinance asks: numbers arrive bare and the body is smaller. Officers' pay stays wrapped either way, so the reader takes both shapes |
| P/B, P/E, cap | as corrected under *Validation*: P/B ÷ the subunit factor, `summaryDetail` P/Es as sent, the `defaultKeyStatistics.forwardPE` fallback only where the two currencies are spelled identically, the cap in the quote's major unit and withheld with its currency when that code is unknown |
| Estimates | labelled with the quote's own code (`GBX` for VOD.L, whose targets are pence). The edge upper-cased `GBp` and filed London targets as pounds |
| Officers | replaced per company only when the document has an `assetProfile`; Yahoo's doubled spaces collapsed; pay of 0 and years before 1900 are null |
| Statements | openbb's spelling. Samsung's 2025 income row equals the edge's stored row key for key and value for value, now with `KRW`. Of 69 stored rows compared, every difference is Yahoo's data (restatements, the rolling window, lines added since) or a half-year relabel |
| Statement writer | `only_replacing={"source_code": "yfinance"}` keeps SEC's rows; `merge_json=["data"]` keeps a stored line a narrower answer omits |
| Corporate actions | from the chart documents (`events=div,split`, Stage 0). Dividends are split-adjusted (AAPL's 1987 $0.12 is 0.000536) and in the quote currency; splits are ratios. A retraction deletes only Yahoo's rows inside the covered span |
| `security` columns | `writers.update_existing`, which never inserts and never erases (`coalesce(offered, stored)`) |
| No jsonb cast | psycopg 3.3.6 sends a `str` untyped (its `StrDumperUnknown` is registered last), and `INSERT … VALUES` coerces it to the target column. Only `UPDATE … FROM (VALUES …)` needs casts, so `update_existing` casts every value |

Found while building it:
- `yahoo_chart.fetch` and `documents._get` raised refusals inside `metrics.request`, so every
  refusal was counted as `transport`. The chart's refusal text also named the symbol, which
  `vocab.throttled` reads (`HTTP 404 for 4290.T` matches `429`). Both are fixed for every Yahoo
  provider: refusals are named by status.
- The writer SQL ran on a throwaway `postgres:17-alpine` on the node, through the production image's
  psycopg, because Docker Desktop is still wedged locally. Ten checks passed.
- A new image check compares the copied yfinance keys and openbb aliases with the installed ones. A
  one-line mutation fails it.

### Step 6, the defs (muffin-ingest#110, 2026-10-13)

`defs/companies/` plus one asset in the prices family. **Merges only after #428 deploys**: it writes
`security_fundamentals.market_cap` and needs #428's grants.

| Asset | As built |
|---|---|
| `raw_yahoo_company` | one multi-asset step for `raw_yahoo_summary` and `raw_yahoo_statements`, because whether statements are due is read off the summary fetched a moment earlier. Pool `yfinance`, `multi_run(100)`, paced at 1.4 s through `lib/pacing.py` (shared with the chart lane) |
| `company_facts` | one step, one transaction, an asset per table: `security_profile` (also `security.provider_country_iso2`), `security_officer`, `security_fundamentals` (also `security.reporting_currency`), `security_share_stats`, `security_estimate`, `yahoo_classification` |
| `yahoo_statement` | through `postgres_io`, with `only_replacing` and `merge_json` read from asset metadata |
| `derived_security_metrics` | pages `derive_security_metrics(2000)` then `derive_ttm(null, 1000)`, one transaction per call (both functions build `on commit drop` temporary tables), stopping when a page does not shrink its backlog |
| `yahoo_corporate_action` | in `nightly_prices`, `multi_run(25)`, from the chart documents; `security_return` depends on it |

Decided while building it:
- **The quote currency is not this lane's.** The spec left open how `security_listing.currency_code`
  would take the summary's `price.currency`. Step 5 resolved it: `security_price_span.quote_currency`
  comes from the newest price bar, which the chart lane labels with `meta.currency`, and
  `security_currency` prefers it. Nothing in this lane writes a quote currency.
- **A snapshot table takes the newest document whole, nulls included**, so a P/E Yahoo withdraws when
  earnings turn negative does not survive from last week. `security` columns are set only where the
  document states one (`update_existing`).
- **Officers** are retracted only for a company whose document has an `assetProfile`; a profile
  listing none retracts all of them.
- **Classification** is replaced per company when its profile names a sector muffin maps, or none (a
  fund). A label muffin does not map keeps the stored rows and is counted and named, so a vocabulary
  change upstream cannot read as Yahoo withdrawing every sector.
- **An answered summary replaces the stored one; an absence or an unreadable body is filed beside
  it.** Stage 2 reads the newest, so an absence writes nothing and the answer stays for the day
  Yahoo answers again.
- **The outcomes partition the companies twice:** `summary_{answered, empty, absent, unreadable,
  transport, not_due, unasked}` and `statements_{fetched, partial, failed, not_due, skipped,
  unasked}` each sum to `requested` with `not_askable`. A throttle or a refused session stops the
  run; a stop after one frequency was filed counts that company `partial`.
- **`yahoo_companies`** runs at 03:30 UTC over `ceil(grid / 7)` keys in runs of 100, resumed after
  the previous day's last key (`lib/rotation.py`, extracted from `nightly_prices`), with a 30-minute
  `dagster/max_runtime`. It ships STOPPED.
- **Checks:** `no_company_is_far_behind_the_rotation` (14 days, WARN to 10%, ERROR past 20%; red
  until the first rotation ends, because the edge fetched most fundamentals once, in August),
  `statements_carry_a_currency` (the run's own rows, by `as_of` after the run started), and
  `fundamental_units_are_conventional` (the medians, over the lane's own rows, from 50 values).
- **`company_facts` cannot tolerate a missing raw partition**: a multi-asset built from specs may
  give an input nothing but its key. The job always writes every partition, so only a hand-launched
  re-parse can meet one.

Verified:
- 363 library tests, 197 project tests, 13 mutations each caught by the test meant for it.
- **Run on the node over AAPL, 7203.T, VOD.L, 005930.KS and SAP.DE**, as `ingest_rw` against a
  database built from muffin-deployment's migrations, asking Yahoo directly:
  - 16 requests; every outcome counter sums to 5;
  - Vodafone: cap £27.3bn, P/B 0.634, targets in `GBX` (121.68), reporting EUR, half-year rows for
    the balance sheet only;
  - 140 statement rows, every one with a currency; 1,103 metrics and 130 TTMs, each backlog drained
    in one page, every metric labelled with its currency;
  - 315 corporate actions matching known history: Samsung's 50-for-1 (2018), Toyota's 5-for-1
    (2021), Apple's five splits, Vodafone's consolidations of 2006 (0.875) and 2014 (6 for 11);
  - a second visit asked nothing and changed no row.

Left for later: stage 2 re-reads every stored statements document on every visit
([note](../deferred/2026-10-13-stage-2-re-reads-every-statements-document.md)).

### Step 7, the live subset and parity (2026-10-17)

**Rolled** 2026-10-17 14:29 UTC: muffin-ingest#110 and #112, image `df0ed5…`, all three services
pinned. The `yahoo_companies` schedule ships STOPPED.

**The subset:** `yahoo_companies` for 005930.KS, 7203.T, AAPL, SAP.DE and VOD.L, one run each,
launched 15:18 UTC. All five succeeded in ~28 s each, serialised on the `yfinance` pool.
- **Fetch.** Each company took 3 calls (cookie, crumb, summary) plus its 2 timeseries documents.
  Summaries were 271–548 KB, with `throttled=0`, `crumb_rejected=0` and every outcome counter
  summing to `requested`.
- **Statements.** 18–32 rows per company, every one with a currency, and `unknown_keys=0`. Fewer
  rows changed for Toyota (19 of 30) and Vodafone (6 of 18), because SEC holds those periods and
  the Yahoo writer never replaces SEC.

**Parity against the edge's rows**, snapshotted before the runs:

| Table | Result |
|---|---|
| SEC statement rows | 159 before, 159 after, every one byte-identical |
| `security_taxonomy` | identical: the same sector and industry nodes |
| `security_officer` | the same people. The edge stored Yahoo's double spaces in names ("Mr. Hark-Kyu  Park"); stage 2 collapses them. Apple's list really changed: Joswiak out, Ternus in |
| `security_fundamentals` | two months of drift, in the same units (margins as fractions, `dividend_yield` in percent). New: `market_cap` with its own currency. **VOD.L reads £28.28bn in GBP**: the stock page's €27.58bn was a GBP figure the edge labelled with the reporting currency |
| Yahoo statement rows | a currency on every row, and more history: SAP 32 rows where the edge had none, Toyota 16 quarters where it had 3 annual rows. No re-written row lost a field (45 compared) |
| `security.provider_country_iso2` | set for all five (empty before) |
| share stats, estimates | one row appended each, as a time series should |
| Apple FY2025 from Yahoo | revenue $416.161bn, net income $112.01bn, diluted EPS 7.46: SEC's figures |

**Found: a quarter two sources report was counted twice, and the TTM refused the year**
(muffin-deployment#439):
- **The cause.** SEC dates a quarter by its last day and Yahoo by the month end, so a 52/53-week
  filer's quarters arrived twice, days apart.
- **The effect.** `derive_ttm` refused every window as "the same quarter twice" and retracted the
  TTMs that had been right. Apple's P/E went from 39.15 to 51.74, on a TTM EPS from mid-2025.
- **Not only Apple.** ATROB, WOLF and MMED had been frozen the same way since 2025 by the edge's own
  Yahoo quarters.
- **The fix.** Within ten days, the higher-priority source's quarter stands for the quarter. The
  probe compares priorities only for cross-source pairs, so the cost is unchanged (1.05 s against
  1.17 s per 1,000 securities). Deployed 2026-10-17 16:06 UTC. The 16:17 derivation drained
  `pending_ttm` to 0: Apple's TTM EPS is 8.72 at 2026-06-27, its P/E is 39.10 again, and ATROB
  (35.88) and WOLF have their TTMs back through mid-2026.
- **Why the local subset missed it.** It ran on a throwaway database with no SEC quarters.

**Not yet measured:**
- corporate actions from chart events, after the first night (2026-10-18);
- the pace probe of ~200 requests (the subset made 25);
- the crumb's lifetime.

## Open questions

Closed by the 2026-10-10 measurements:
- the transport;
- the units of `dividend_yield` and `debt_to_equity`;
- `marketCap`'s currency for pence listings;
- the timeseries key-list limit (2 requests per company).

Closed by the 2026-10-11 measurements:
- ZAc, ILA and KWF cap currencies;
- `trailingPE`/`forwardPE` across currencies;
- what decides that statements are due.

Still open (see *Still to measure*):
- run width W: 100 is the starting value; the first scheduled days give the measurement;
- the crumb's lifetime: a run renews a refused session once, and counts `crumb_rejected`.
