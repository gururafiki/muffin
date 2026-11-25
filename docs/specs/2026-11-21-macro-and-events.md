# Phase 6b: macro and events on Dagster

Planned 2026-11-21 · Status: **steps 0-1 done 2026-11-21; step 2 (schema) next.**
Follows [Phase 6](2026-11-09-segments-and-regulators.md). Rework table:
[the ingestion rework design](../superpowers/specs/2026-09-09-ingestion-rework-design.md), row 6b.

Governing skills:
- `dagster-ingestion-best-practices` (the nine planning stages, rules 1–10);
- `dagster-expert`;
- `dagster-pipeline-local-test`;
- `muffin-schema-change`;
- `muffin-deploy`;
- `muffin-dagster-operations`.

## Context

Four `market-refresh` edge resources remain outside the segment work: `macro-indicators`,
`earnings-calendar`, `earnings-history` and `security-news`. Moving them to Dagster lets Phase 8
retire the edge function. Measuring them on 2026-11-21 found two of them broken while reporting
success:

- **Company news is dead since 2026-10-01.** openbb's yfinance news route answers **204** for AAPL,
  and the edge stamps `news_fetched_at` whether or not anything came back, so every run reports
  `remaining: 0`. The newest of 21,673 stored articles is from 10-01, and the 90-day prune is now
  emptying the stock page's news panel.
- **`earnings-history` is stalled on one window since 2026-09-06** (2016-06-28..30). Nasdaq answers
  `data: null` for those days; openbb dereferences the null (`AttributeError`); the edge never
  advances the cursor, and reports `ok` 52 times a day. Nasdaq does serve the earlier days
  (2016-05-04: 232 rows; 2015-02-03: 92).
- **The global earnings data is already held.** The company lane requests `calendarEvents`,
  `earnings`, `earningsHistory` and `earningsTrend` from Yahoo weekly for ~13,850 securities, and
  stores them in `raw_yahoo_summary`. Nothing parses them. Read from disk: Toyota, SAP and Apple
  each carry a next earnings date and four quarters of actual vs estimated EPS. Today the app's
  earnings are US-only (nasdaq).
- **Macro is healthy.** 49 catalogued series (38 enabled) run every 6 h, ~35 s, from openbb's fred,
  oecd, federal_reserve and yfinance providers. It is a port.

**Intended outcome:**
- news flows again, globally;
- earnings dates and surprises cover global companies;
- the stock page shows recent quarters' surprises;
- macro runs on Dagster;
- the four edge resources retire.

## Decisions (the user, 2026-11-21)

| # | Topic | Decided | Rejected |
|---|---|---|---|
| 1 | News source | **Yahoo RSS per company** (`feeds.finance.yahoo.com/rss/2.0/headline?s=`), no key. Measured: 16–18 current headlines with summaries for AAPL, SAP.DE, 7203.T; one request per company, since a multi-symbol feed merges items with no symbol on them | Yahoo search endpoint (noisy, no summary, SAP.DE empty); drop news |
| 2 | News cadence | **Weekly, riding the company lane's daily seventh of the grid** (~1,800 requests a day) | daily for big holdings; daily for all |
| 3 | Earnings sources | **Both**: parse Yahoo's stored answers (global, no new requests) and keep nasdaq (daily-fresh US dates, history to 2012); every row names its provider and the views pick per company | nasdaq only; Yahoo only |
| 4 | Stock page | **Show recent quarters' surprises** from the stored history (global where Yahoo covers the company) | same panel from a global source; no UI change |

**Design choices in this plan, open to objection:**
- **Nasdaq is asked directly, not through openbb.** openbb crashes on nasdaq's `data: null`, the
  answer for a day with no reports. When the wrapper hides the field that carries the meaning, go
  around it (CLAUDE.md). One request per DATE is nasdaq's own grain, so the lane has **daily
  partitions**.
- **One nasdaq lane serves both the calendar and the history.** A day's answer lists the companies
  reporting that day: forecasts for future days, actuals and surprises for past ones. The edge's two
  resources asked the same endpoint over different ranges.
- **Macro is a port as-is**, partitioned per catalogued series (the provider's grain), run daily,
  through openbb in-process (the library already ships the fred, oecd and federal_reserve providers,
  and `FRED_API_KEY` is already in the ingest services' environment).

## Current state (measured 2026-11-21)

| Resource | Runs / 14 d | Failed | Avg | Note |
|---|---|---|---|---|
| macro-indicators | 723 (671 skipped by TTL) | 0 | 34.9 s | 37 of 38 answered; `jp-cpi` "no data" (retired FRED id) |
| earnings-calendar | 724 (653 skipped) | 0 | 0.7 s | 781 rows fetched, 312 matched to tracked companies |
| earnings-history | 723 | 0 | 0.2 s | stalled at 2016-06-30 (`failed: 1`, `ok`) |
| security-news | 723 | 0 | 1.7 s | articles stopped 10-01; `pending_news` reads 0 |

**Tables:**
- `macro_indicator`: 49 rows, a control table. `macro_observation`: 3,397 rows.
- `earnings_calendar`: 8,168 rows, key `(symbol, report_date)`, `security_id` nullable, pruned at 90
  days.
- `security_eps_history`: nasdaq 100,930 rows over 2,934 securities (periods 2012-03 to 2026-07),
  plus alpha-vantage 4,835. Key `(security_id, period_ending)`.
- `news_article` (url pk) 21,673 rows / 39 MB; `news_security` 31,360 rows / 27 MB, over 4,153
  securities.
- `earnings_history_cursor`: one row. `security.news_fetched_at` is the news cursor.

**Readers:**
- muffin-ui:
  - `macro_current` (country page panel);
  - `security_news` (stock page);
  - `security_next_earnings` and `security_earnings_surprise` (stock page: one surprise, from
    nasdaq consensus plus our quarterly EPS, so US-only and 90 days).
- `security_eps_history` has **no app reader**, only `coverage_current` and `security_facet_status`.
- market-verify's retention check watches `earnings_calendar` and `security_news`.

## Architecture

Names are state and are frozen once shipped.

| Asset | Stage | Partitions | Pool | Trigger | Writes |
|---|---|---|---|---|---|
| `raw_nasdaq_earnings` | 1 | daily, from 2012-01-01 (`nasdaq_day`) | `nasdaq` | schedule `nasdaq_earnings_window` daily ~07:10 UTC: days [today−7, today+21]; history by backfill | nasdaq's JSON for one date, whole, through a new http-cache location |
| `nasdaq_earnings` | 2 | `nasdaq_day` | `sql` | eager | `earnings_calendar` (source `nasdaq`, report dates within 90 days only), `security_eps_history` (source `nasdaq`, reported rows) |
| `yahoo_earnings` | 2 | `security` (company grid) | `sql` | eager on `raw_yahoo_summary` | `earnings_calendar` (source Yahoo, from `calendarEvents`), `security_eps_history` (source Yahoo, from `earningsHistory`) |
| `raw_yahoo_news` | 1 | `security` | `yfinance` (in the company job) | added to `yahoo_companies` | the RSS document per company, whole; the newest replaces the previous |
| `company_news` | 2 | `security` | `sql` | eager | `news_article`, `news_security` (source `yahoo-rss`); prunes 90 days |
| `raw_macro_series` | 1 | dynamic `macro_indicator` (codes of enabled rows; sensor adds keys) | `openbb` | schedule `macro_daily` ~06:40 UTC, one run over the grid | openbb's `Data` rows per series (`model_dump`, as the index lane) |
| `macro_observation` | 2 | `macro_indicator` | `sql` | eager | `macro_observation` |
| checks | | | | | `news_is_current` (WARN): newest article written for the visited partitions < 7 days old; `nasdaq_window_covered` (ERROR): every weekday in [today−7, today+21] materialized today; `macro_series_fresh` (WARN): each enabled series' newest point inside its frequency's window; `every_nasdaq_day_answered` (WARN, history gaps as metadata) |

**Why these shapes:**
- News rides `yahoo_companies` because decision 2 ties it to the company rotation. A refusal fails
  only the news step, never the company assets, and the next week re-asks that company.
- The Yahoo earnings stage replays all ~13,850 stored answers with **no request** (one stage-2
  backfill over the grid). After that, each weekly visit adds its four quarters, so history
  accumulates.

## Data model (expand/contract; rows name their provider)

- **`earnings_calendar`:** key `(symbol, report_date)` → `(source_code, symbol, report_date)`.
  - Yahoo rows carry the asked provider symbol and always a `security_id`.
  - New nullable columns from `calendarEvents`: `report_date_end` (Yahoo gives a range),
    `is_date_estimate`, `eps_low`, `eps_high`, `revenue_consensus`.
- **`security_eps_history`:** key `(security_id, period_ending)` →
  `(security_id, period_ending, source_code)`.
  - Yahoo's quarter is month-end normalised, as nasdaq's is (Apple's 2026-09-26 quarter is
    2026-09-30 in both).
  - Yahoo's `surprisePercent` is a FRACTION (Toyota 0.303); it is stored as percent, the fifth
    instance of that trap.
- **`data_source` rows:** `yahoo-rss` (news), and Yahoo earnings under the company lane's existing
  Yahoo source code; priorities set so US companies prefer nasdaq, which is fresher daily.
- **Serving views** pick one row per company and period, by `source_priority()`:
  - `security_next_earnings` (rewritten);
  - new `security_earnings_history` (period, actual, estimate, surprise, surprise_pct, beat,
    source), which the stock page reads.

  `security_earnings_surprise` stays until the UI moves, then contracts.
- **Contract, with a drop date:** `pending_news`, `earnings_history_cursor`,
  `security.news_fetched_at`, `security_earnings_surprise`.

## Low-level design

**Library (`muffin_ingest`, no Dagster):**
- `providers/nasdaq.py`:
  - one GET of `api.nasdaq.com/api/calendar/earnings?date=` through `documents._get` with an
    explicit provider label;
  - outcomes `answered | empty (data null or rows []) | refused | transport`;
  - forward-window days send `X-Muffin-Cache-Bypass`, and past days may be cached.
- `providers/yahoo_rss.py`: one GET per symbol; `answered | empty | refused | transport`; the
  unknown-symbol wording is measured in validation, never assumed.
- `facets/earnings.py`:
  - `parse_nasdaq(day_doc)`: calendar rows, plus history rows where `eps` is present;
  - `parse_yahoo(summary_doc)`: calendar from `calendarEvents`, history from `earningsHistory`.
  Units are converted at the boundary. The month-end period rule is shared.
- `facets/news.py`: RSS → article rows (url, published_at, title, source, summary) plus links to the
  asked security; dedupe by url.
- `facets/macro.py`:
  - an explicit dispatch of the catalogue's 10 routes to typed `obb.*` calls;
  - an unknown route is a check failure, never a `getattr` walk (`providers/openbb.py`'s rule);
  - `extractMacroPoints` is ported as is.

**Writers:** `writers.upsert` with `compare=` on the value columns, so `fetched_at`/`as_of` never
decide an update. Each stage 2 retracts only within its own source and scope (a nasdaq day's rows,
a company's Yahoo rows), never on a throw.

**Run width:**
- nasdaq: the forward window is 29 requests a day; the backfill is ~5,400 days once, paced (rate
  measured in validation).
- RSS: ~100 per company run, pacing measured.
- macro: 38 a day.

## Validation (rollout step 1, before code)

Capture whole bodies as fixtures, with a re-capture note.

- **nasdaq:**
  - a past day (eps plus surprise present);
  - today, and a future day (forecast only);
  - a `data: null` day (2016-06-29);
  - the shape of `fiscalQuarterEnding`, `time` and `surprise`;
  - its rate behaviour over 50 paced requests.
- **RSS:**
  - AAPL, SAP.DE, 7203.T, a dead symbol, a symbol with no news;
  - 100 paced requests for the throttle signature;
  - **URL overlap across 100 companies, to project `news_article` at 90 days.** Worst case is ~2.9 M
    links. If the projection exceeds ~1 GB, the retention window comes back to the user.
- **Yahoo earnings, from stored raw (no requests):**
  - 20 securities, including NESN.SW (semi-annual: empty history), a non-reporter, and a company
    whose next date is past (SAP on 11-19);
  - confirm the `earningsHistory.quarter` month-end rule against nasdaq for ~200 US companies.
- **macro:** each of the 10 routes in-process with the environment's FRED key; parity of every
  enabled series' points against `macro_observation`.

Any finding that changes a decision goes back to the user before it is built.

## UI (muffin-ui)

- `use-next-earnings.ts` reads `security_earnings_history` (latest N quarters, e.g. 8);
  `next-earnings.tsx` shows actual vs estimate and beat/miss per quarter, with the source.
- The next-date block reads the rewritten `security_next_earnings` (global).
- A section with no rows renders nothing.
- Checked offline (`smoke-market.mjs`, with a fixture where nasdaq and Yahoo disagree), then
  rendered live for AAPL, SAP.DE and 7203.T after the deploy.

## Observability

- **Dagster:** the Pipeline row picks up the new jobs and checks by itself. The ingest exporter
  labels `nasdaq` and `yahoo-rss` requests explicitly (providers.json).
- **market-verify:** gains `news is current` (newest article < 3 days old). This guard would have
  caught the seven-week outage.
- **Existing coverage:** the retention check still covers `earnings_calendar` and `security_news`;
  the pg_cron headroom alert is unaffected.
- **http-cache:** two new locations (`nasdaq`, `yahoo-rss`), wired in all three places (nginx, the
  ingest's `CACHE_LOCATIONS`, and the coverage guard), with RSS cache-off.

## Rollout (each step ends live)

| # | Repo | Change | Gate |
|---|---|---|---|
| 0 | umbrella | spec, todos (Phase 6b steps), deferred notes, rework table | — |
| 1 | ops | validation and fixtures (above), recorded in the spec | findings back to the user if any decision moves |
| 2 | deployment | schema: earnings keys gain the provider, new columns, `data_source` rows, `security_earnings_history`, `security_next_earnings` picks per company; nginx `nasdaq` + `yahoo-rss` locations; guard tests whose fixtures make the sources disagree; node replay with mutations; production dry run rolled back | replay clean; the app's reads re-timed as anon |
| 3 | ingest | library + `defs/earnings` (nasdaq lane), company-lane additions (`raw_yahoo_news`, `company_news`, `yahoo_earnings`), `defs/macro`; tests over fixtures; local tiny run | counters sum |
| 4 | ingest + deployment | PRs → roll → live tiny subset → parity (nasdaq days against stored rows; macro against `macro_observation`) → retire the four edge resources (`RETIRES`, 410, rotation rows disabled) → schedules on → backfills (nasdaq history from 2012, Yahoo earnings replay over the grid; news fills over the first rotation week) | 0 failed; news articles dated today |
| 5 | ui | stock page shows recent quarters; render check | rendered on 3 companies |
| 6 | deployment | market-verify `news is current`; Grafana panels as needed | replay every panel query |
| 7 | deployment | delete the four handlers after 3 clean days; contract with a drop date | logic-check, proving queries |
| 8 | all | docs (CLAUDE.md, README, data-ingestion), skills (`market-diagnose`, `muffin-dagster-operations`, `market-refresh-routine`), memory | — |

## Risks and rollback

- **RSS throttling on a keyless host.** It is measured before the lane ships. A refusal stops that
  run's news step, counted as `unasked`, and the week re-asks.
- **News table growth:** measured in validation, and the retention window comes back to the user if
  needed.
- **Nasdaq archive gaps** (2016-06-28..30 is null): a day answered `empty` is complete, not failed,
  and the check reports gaps as metadata.
- **Key changes on two tables:** expand/contract. The old rows are kept (nasdaq rows gain
  `source_code` in the key, values unchanged). Until step 7, rollback re-enables an edge row and
  removes its `RETIRED` entry.

## Deferred notes to write

- The news retention window, if the measurement says so.
- `earningsTrend` (forward estimates, revisions) is stored and unread: a later feature.
- The contract drops (step 7) with their date.

## Verification

- **Library:** pytest over captured fixtures, with mutations where the candidate rules disagree.
  Cases: nasdaq vs Yahoo on one quarter; a fraction vs a percent; a null day; an RSS item linked to
  two companies.
- **Local:** a tiny run on a database built from the migrations (`dagster-pipeline-local-test`),
  or the read-only production harness (`branch_on_node.sh`) when Docker is wedged.
- **Live:**
  - per lane, a tiny subset whose counters sum to `requested`;
  - parity before each edge retirement;
  - `check_anon_read_latency.py` with probes for the new view;
  - the stock page read in a browser for AAPL, SAP.DE and 7203.T;
  - market-verify green with the news check;
  - Grafana panel queries replayed.

## Open questions

None for the design. Validation (news volume, rate limits) can reopen decisions 1–2; any such
finding goes back to the user.

## Steps as built

### Step 1: validation (2026-11-21)

Captured on the node, read-only. The bodies are fixtures for step 3. **No decision moved.**

**nasdaq** (`api.nasdaq.com/api/calendar/earnings?date=`, asked directly):

| Day | Answer |
|---|---|
| 2026-10-30, past | 66 rows: `eps "$4.23"`, `surprise "8.46"`, `epsForecast "$3.90"`, `noOfEsts "6"`, `fiscalQuarterEnding "Sep/2026"`, `time "time-not-supplied"` |
| 2026-11-24, future | 52 rows: forecast, `lastYearRptDt "11/25/2025"`, `lastYearEPS "$2.35"`, no `eps`/`surprise` |
| 2016-06-29 | `data: null`, `bCodeMessage [{code: 1002, "Earnings Calendar: No record found."}]`: an EMPTY day |
| 2026-11-21, Saturday | `data` with no rows and no headers: an empty day |
| 2015-02-03 | 92 rows; `"N/A"` and `""` for missing values |

- **Units:** `surprise` is a **percent string** (8.46 = 8.46%), unlike openbb's fraction. Money
  arrives as `"$4.23"` strings, and missing values as `"N/A"` or `""`.
- **Rate:** 50 history days at 0.5 s spacing all answered 200. The server itself is slow (p50
  2.25 s, max 4.84 s), so the history backfill from 2012 is about 4 hours, paced by the server.

**Yahoo RSS** (`feeds.finance.yahoo.com/rss/2.0/headline?s=`):
- **Items:** `title`, `link`, `description`, `pubDate`, `guid`. AAPL 18 items, SAP.DE 18,
  7203.T 16, PTSB.IR 1.
- **A dead symbol is distinguishable:** ZZQQXX and BDMS-F.BK answer **200 with an empty channel**
  (description "Latest Financial News for " with no symbol, no channel title). A real company
  with no news keeps its title ("Yahoo! Finance: PTSB.IR News").
- **No throttling:** 100 random equities at 1 s spacing all answered 200 (p50 0.22 s).
- **Volume:** 7.8 items per company, 43 of 100 with none, 773 unique links in 778 items.
  **0.97 new items per company per week** (97 of 833 within 7 days; median age 25 days).
  Only 1 company in 100 publishes faster than a weekly visit can capture (the feed holds ~20).
- **Size at 90 days:** ~100–160 k articles, ~200–300 MB at the stored table's 1.8 KB per article.
  Well under the 1 GB threshold, so **retention stays 90 days**.

**Yahoo earnings** (2,000 stored `raw_yahoo_summary` answers, no requests):
- **History:** 63% have quarterly history (4,119 quarters). Every quarter is a month-end date.
  `surprisePercent` is a **fraction** in 3,361 of 3,361 checked; estimates are missing on 15%.
- **Next date:** 45% have one, and **61% of those were already past at fetch time**. Yahoo's
  "next" date often names the last report, so nasdaq's daily calendar stays the source for US
  dates.
- **Against nasdaq,** on 1,097 quarters both hold: actual EPS agrees on **65%**, estimates on 50%.
  The differences include exact factors of 10 (ADR ratios: 0.885 vs 8.85) and different adjusted
  bases (1.14 vs 0.67). **The serving views therefore choose ONE source per company, never per
  row**, the analyst-actions rule (muffin-deployment#505); mixing would put two EPS bases in one
  series.

**macro** (openbb in-process, one series per route): all 10 routes answer.
- `FRED_API_KEY` is picked up from the environment, and values match what is served.
- **One served point is no longer published:** `us-unemployment` 2026-10-01 (0.039, written
  11-12). Today's OECD answer, edge and in-process alike, ends at 09-01, and the edge's upsert
  cannot retract. **The port retracts within each series' window.**

### Steps 2-4: schema, lanes, cutover (2026-11-21)

**Shipped:**
- muffin-deployment#531: the schema (new columns, `security_earnings_history`, the next date picked
  per company, the `yahoo-rss` and `nasdaq` cache locations).
- muffin-ingest#187 and #188: the news and earnings lanes.
- muffin-deployment#532: the cutover. The earnings keys carry the provider, `security_news` joins
  `symbol_security`, and `earnings-calendar`, `earnings-history` and `security-news` answer 410.
- muffin-ingest#189: news and Yahoo earnings join `yahoo_companies`, and the nasdaq window runs.
- muffin-ingest#190: the macro lane.

**What the live runs found:**
- **News** (`rcgqmyup`, five companies): every counter sums, 16-19 articles a company,
  `news_is_current` passes. The first run pruned 18 articles older than 90 days.
- **The nasdaq window** (`ppetexuz`, 11-14..12-12): 29 days asked, 21 answered and 8 empty
  (weekends). It retracted **344** calendar rows, exactly the stale rows the parity found the edge
  never retracted, and wrote 128 quarters of history.
- **Anon reads after the cutover:** the news read went from 234-259 ms to 112-152 ms; the next
  date 55 ms; the earnings history 82 ms.
- **Macro, read-only parity on production before shipping** (`branch_on_node.sh`, stage 1 for
  real): 37 of 38 enabled series answered (`jp-cpi` never has), and 2,146 of 2,147 points match
  the edge's (the other is that day's bitcoin). No inserts. 18 retractions: weekend and Labor Day
  gold and oil bars that Yahoo no longer returns, some repeating Friday's close.
- **OECD's newest month can come and go.** `us-unemployment` 2026-10-01 was absent from OECD's
  answer in the afternoon and present again by 22:00. Retracting within the window therefore makes
  the newest point disappear on a day OECD omits it and return when it is back. That is honest to
  the provider. The edge kept a point for ever once it had seen it.

**Design points settled while building:**
- **Macro raw merges, so an empty answer replaces nothing.** A replacing manager writes its
  "collected nothing" marker over a partition that got no rows.
- **A snapshot route retracts only within its own dates.** A 400-day window on the yield curve
  would delete every earlier curve.
- **A provider's exception can quote the URL it asked for, and FRED's carries `api_key=`.** Every
  logged error passes through `openbb.redacted()`, and the test reads the run's whole event log,
  since a run result's events hold no log lines.

### Steps 5-7: the stock page, the guard, the contract (2026-11-21..25)

- **Step 5** shipped in muffin-ui#144 (deployed 11-21 22:22): the stock page shows the last eight
  quarters' EPS against the estimate, read from `security_earnings_history`.
- **Step 6** shipped in muffin-deployment#534 (deployed 11-22 11:29): market-verify counts news
  links published in the last 3 days, floor 100.
- **Step 7, readiness read 2026-11-25:**
  - all `yahoo_companies` (82), `nasdaq_earnings_window` (4) and `macro_daily` (3) runs since 11-22
    SUCCESS, with the news and earnings counters summing;
  - `news_is_current` and `nasdaq_window_is_current` pass, and market-verify's news count read 905;
  - no alert from these lanes fired.
- **Shipped in muffin-deployment#542:**
  - the four handlers leave `market-refresh` (1,377 → 898 lines), with what only they used
    (`symbolList`, `fetchWithIsolation`, `openbbFetcher`, `extractMacroPoints`, two constants,
    and `isolation-check.ts`);
  - their `RETIRED` entries stay, so each still answers 410 naming its lane;
  - `20261125100000` drops `pending_news`, `security_earnings_surprise`,
    `earnings_history_cursor` and `security.news_fetched_at`.
- **What the readiness read found:**
  - **The share answered falls through the rotation, and that is the population.** News went from
    80% of companies answered (11-22) to 27% (11-25), and Yahoo earnings dates from 68% to 13%.
    The 11-24 and 11-25 slices walk the grid's tail (positions 9,026-13,125 of 14,348): 3-11% US
    and newly promoted listings, whose stored news and calendar shares (21%, 12-15%) match the
    answer rates. Throttling would show as refusals, and there were 2-3 a day.
  - **`macro_series_fresh` (WARN) fails every day on `jp-cpi` alone**, the retired FRED id the
    parity already named. A check that fails for a known reason is one nobody reads: the series
    is to be replaced or disabled (a decision for the user).
  - **A `PLANNED` asset-check execution per partition** remains for every range run of the
    nasdaq window (29 a run), beside the one evaluation Dagster records. That is how Dagster 1.13
    plans a check over a partition range, not a check that never ran.
  - **The edge no longer calls openbb-api.** muffin-ingest imports openbb in-process and
    muffin-agent uses openbb-mcp, so whether the REST service still has a consumer is a question
    for Phase 8.
- **Deployed 2026-11-25 11:33** (with #541's autovacuum thresholds). Proving queries:
  - `20261125100000` is in `schema_migrations`;
  - `to_regclass` is null for `pending_news`, `security_earnings_surprise` and
    `earnings_history_cursor`, and `security.news_fetched_at` is gone;
  - `earnings-calendar`, `earnings-history`, `security-news` and `macro-indicators` answer 410
    naming their lanes;
  - the three Dagster containers kept their 10:46 start, so the deploy touched no run.

  The six backlogs that never had a `backlog_negative_cache` row have all left with their
  resources. The four `pending_%` views that remain all have one.
