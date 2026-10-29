# The SEC family on Dagster (Phase 5) — design

Status: APPROVED 2026-10-24 (decisions 1–12 below, taken by the user 2026-10-20..24). Production was
measured from the node on 2026-10-20 and 10-24; the items under *Still to measure* close during
rollout step 3. Extends
[the ingestion rework design](../superpowers/specs/2026-09-09-ingestion-rework-design.md) §8
(Phase 5). It closes two Phase 4 notes:
[the statement key and fiscal periods](../deferred/2026-10-10-the-statement-key-and-fiscal-periods.md)
and [a fiscal-year change reads as a repeated year](../deferred/2026-10-10-a-fiscal-year-change-reads-as-a-repeated-year.md).

Names below (assets, jobs, schedules, sensors, tables, columns, checks) are proposals until the PR
that introduces each one; once shipped, names are state.

## Context

Phase 5 moves the SEC family off the `market-refresh` edge function onto Dagster, with two pieces
of model deferred from Phase 4: the fiscal-period dimension and the statement key. Measured on
2026-10-20, the family is overdue for more than migration:

- **Statements** come from openbb's `provider=sec` route. They are annual only and were fetched once,
  never refreshed.
- **Throttling:** five of the six handlers ignore it, and all six report `ok: true` whatever failed.
- **Insider trades** have reached 1,375 of 3,760 filers.
- **Two SEC sources** sit in `security_metric`: `sec` (76 k rows) and `sec-xbrl` (2.52 M).
- **113 annual pairs** read as one year reported twice, because the model only knows where a period
  ends.

The outcome wanted:
- one SEC fetch per company, made when it files;
- quarterly and annual SEC statements for ~3,400 filers, labelled with their fiscal period;
- every provider's statement row kept;
- insider history from SEC's own data sets;
- the edge family retired.

## Before Phase 5: the `TRL` stall

Found by the 2026-10-21 check-in and fixed first:
[note](../deferred/2026-10-24-an-unknown-currency-stalled-the-metrics.md).

- **The failure.** Yahoo labels some Turkish statements `TRL`, the lira code retired in 2005, and
  `market.currency` has no such code. `derive_security_metrics` pages by `as_of`, so the page holding
  them failed on `security_metric_currency_code_fkey` and no page after it ever ran.
- **The damage.** Every `derived_security_metrics` run failed from 2026-10-21 03:47 UTC. By 10-24,
  161,001 statements were underived, and P/E and TTM had frozen for every company the lane had
  visited.
- **The fix:**
  - 0a (muffin-deployment#459): the derivation writes an unknown currency as null, and the requeue
    trigger also fires on a change of currency.
  - 0b (muffin-ingest#123): Yahoo's `TRL` is read as `TRY` through an explicit map, and any code
    `market.currency` lacks is withheld and counted.
  - 0c: stage 2 is replayed from raw for the three companies. No Yahoo call.

## Decisions

| # | Topic | Decided | Rejected, and why |
|---|---|---|---|
| 1 | Scope | **Five resources**: `security-statements` (its SEC half), `-xbrl`, `-filings`, `-filing-history`, `-insider`, plus the fiscal-period dimension and the statement key. `security-segments` moves to Phase 6 with the regulators that share its parser. Wikidata stays in Phase 7. | Segments here as well: they share the parser with DART, NSE and CNINFO, which are Phase 6. |
| 2 | Fetch | **edgartools as the SEC client.** Its own disk cache is off, its URLs go through http-cache, its identity comes from `settings.user_agent()`, and every request is counted. Stage 1 stores bodies whole; stage 2 parses them. | Plain httpx: we would rebuild what edgartools already handles (identity, pacing, both submissions shapes, Form 4 parsing). |
| 3 | Segments raw (Phase 6) | Each new filing's instance is stored whole. Segment history stays as parsed rows; a parser change re-fetches history as a paced backfill. | Re-fetching every instance now: ~191,000 filings for data already parsed. |
| 4 | Insider | **SEC's quarterly Insider Transactions Data Sets** for history, plus each new Form 4 named in the daily index. | openbb per ticker: the current path, at 1,375 of 3,760 filers. |
| 5 | Statements | **Company facts feed both** SEC metrics and SEC statement rows, quarterly and annual. openbb's SEC route retires. | Keeping openbb for statements: annual only, and a second SEC source. |
| 6 | Statement key | **The provider joins the key**: `security_statement (security_id, source_code, statement, period_ending, period_type)`. Serving views pick by `source_priority`, and the Yahoo writer's `only_replacing` guard goes. **A general guideline (the user's words): "keep in the ingested data reference to provider where the data comes from."** `security_metric` keeps its key: it is a stage-3 derivation carrying the winner's `source_code`, and every input now survives in `security_statement`. | One row per period with a precedence rule: whichever provider loses is lost, and the next provider repeats the guard. |
| 7 | Fiscal period | **A `fiscal_calendar` table and a `fiscal_period` table, plus `fiscal_year`/`fiscal_period` labels on statement and metric rows.** Labels come from the calendar, not from company facts' `fy`/`fp`. Measured 2026-10-24, those label the FILING: AAPL's year ending 2022-09-24 carries fy 2022, 2023 and 2024 across three 10-Ks. | Labels from `fy`/`fp`: they repeat years. Labels only, without a calendar: Yahoo rows and year-end changes cannot be labelled. |
| 8 | `TRL` stall | Fixed right after this plan was approved (0a–0c). | — |
| 9 | edgartools' role | **Transport for every SEC request, plus parsing of submissions (`extract_company_filings_table`).** Form 4 is read by our own XML reader (**amended 2026-10-27**, the user, below). Company facts are read by our own reader over `xbrl_concept`, covering both us-gaap and ifrs-full. | edgartools' standardised statements: its concept map has no `ifrs-full` concept, and `EntityFactsParser` swallows every exception. |
| 10 | Insider depth | **Every quarter since 2006** (~82 requests). Rows and bytes are measured as the backfill runs, against the disk headroom. | Newest 8 quarters first and decide later; the last 10 years. |
| 11 | Changed fiscal year | **The newest calendar wins.** The recast or successor period is canonical. The original stays stored, unlabelled and out of series. | The originally reported year; showing both. |
| 12 | Retired `sec` rows | **Deleted after parity.** Frozen at retirement, then deleted at contract with a drop date once company facts cover their periods. Any period only they held is listed first. | Keeping them for ever as that provider's rows. |
| 13 | A filing's regulator | **`security_filing.disclosure_source_code`, written by the Dagster writers only** (the user, 2026-10-25: the edge is neither kept working nor fixed) | on `data_source`, which ties the regulator to the writer; deciding in Phase 6, which needs a backfill then |
| 14 | Concepts the facts reader lacks | **A table only the new reader reads: `market.xbrl_fact_concept`** (the user, 2026-10-27), keyed with the taxonomy and holding only the additions; the edge's readers keep `xbrl_concept` until they retire. | Adding them to `xbrl_concept`: the edge's `security-xbrl` would write them for the universe and its segments parser would start reading segment-tagged `Assets`; leaving them out: US total assets, liabilities, gross profit and R&D would fall back to Yahoo's 4-5 years once `sec` rows go. |
| — | Form 4 attribution | Follows the edge: every equity of the issuer's CIK. | Only the class matching `issuerTradingSymbol`. |

**Decision 9, amended 2026-10-27 (the user).** `Form4.parse_xml` is not pure parsing: for every
reporting owner it fetches `data.sec.gov/submissions/CIK<owner>.json` to decide whether to reverse
the name, retries five times and raises if SEC does not answer. Stage 2 would have made a request per
owner, outside the pool's pacing and the request counters. Its output also rewrote what the data set
states: "Ternus John" became "John Ternus", an empty expiration date came back as the footnote marker
"[F2]", and "See Remarks" titles were replaced by the remarks. Options put: our own XML reader
(chosen), edgartools with its owner lookup stubbed, or edgartools as is.

**Decision 14 (the user, 2026-10-27).** `xbrl_concept`'s key is `(metric_code, concept)` without
the taxonomy, so us-gaap `Assets`, `Liabilities` and `GrossProfit` collide with the ifrs-full rows of
the same names, and the edge kept the table narrow on purpose (anything added is written by
`security-xbrl` for the whole universe). Measured: Apple's 18 years of total assets, total liabilities,
gross profit and R&D exist only in the openbb `sec` rows; `sec-xbrl` holds total assets for 311
securities, mostly IFRS. Seeded in muffin-deployment#475 with nine concepts, each checked against a
filing; ifrs-full `NoncurrentAssets` left out because it means total non-current assets, not
long-lived assets.

The guideline in decision 6 is recorded in `dagster-ingestion-best-practices`'
[data-modelling.md](../../muffin-ingest/.agents/skills/dagster-ingestion-best-practices/references/data-modelling.md).

## Current state (measured 2026-10-20, production)

| Edge resource | Runs / 7 d | Written | p50 s | Queue | Cursor |
|---|---|---|---|---|---|
| `security-xbrl` (companyfacts → `security_metric` `sec-xbrl`) | 117 | 186,645 | 0.1 | 0 | 30 d; median age 28.5 d; 336 negative-cached |
| `security-filings` (openbb, recent 40 forms) | 117 | 133,994 | 50.5 | 19 | 7 d; median 3.4 d |
| `security-insider` (openbb, per ticker) | 116 | 35,765 | 53.1 | 2,601 | 7 d; 1,375 of 3,760 ever fetched |
| `security-statements` (openbb `provider=sec`, annual, fetched once) | 119 | 594 | 14.3 | 0 | — |
| `security-filing-history` (submissions; pg_cron `muffin-filing-history` every 15 min) | 672 | 0 | 0.0 | 0 | 30 d; median 20 d |

- **Tables:**
  - `security_metric` is 2.8 GB.
  - `security_statement` is 528 MB: `sec` holds 42,283 annual rows plus 2,259 `FY` rows; yfinance
    holds 130,743 annual, 92,893 quarter and 1,393 half.
  - `security_filing` holds 395 k rows: `sec-submissions` for accounts history, `sec-filings` for
    recent events.
  - `insider_trade` holds 54,109 rows, `filer_profile` 3,741.
- **3,760 equities carry a CIK** (Dagster's `security_cik`), and 191,000 filings have been parsed for
  segments.
- **SEC, measured from the node:**
  - the daily form index is 0.65 MB and answers in 0.3 s;
  - companyfacts is ~3.8 MB per filer;
  - instance documents are 1.7 MB median and compress 14–23×;
  - insider data sets are 8–13 MB a quarter, from 2006 onward;
  - edgartools' standard statement map has 157 concepts, **0 of them `ifrs-full`**.
- **Disk:** `/mnt/data` has 26 GB free of 98; raw is 6.1 GB.
- **Readers:**
  - the app: `security_statement_current` (the income card), `security_metric_series` (the statement
    table, metric history and income flow), `security_ratio_series`, `security_recent_filings`,
    `security_insider_summary`, `security_facet_status`;
  - Grafana's pipeline, coverage and segments dashboards;
  - market-verify's `check_derived_metrics`, `check_quarter_is_a_quarter` and
    `check_one_period_one_point` (`KNOWN_DRIFTED_PAIRS = 113`);
  - the anon latency probes.

## Facts from the code that shape the design (read 2026-10-24)

| Fact | Where | Consequence |
|---|---|---|
| Importing `edgar.httpclient` builds `HTTP_MGR` with a file cache: it creates `<EDGAR_LOCAL_DATA_DIR>/_tcache` at import, `Hishel-File` is silently remapped to `FileCache`, and `/Archives/edgar/data` is cached for ever. | `edgar/httpclient.py:126-138,242`; `httpxthrottlecache/httpxclientmanager.py:56-76` | edgartools is imported lazily, with `EDGAR_LOCAL_DATA_DIR` pointing at a writable scratch dir, and `HTTP_MGR` is replaced by `get_http_mgr(cache_enabled=False, …)`. |
| `get_identity()` prompts on stdin when `EDGAR_IDENTITY` is unset. The httpx client is built once: after the first call, `http_client()` ignores `bypass_cache` and other kwargs. | `edgar/core.py:235-243`; `httpxclientmanager.py:174-200` | `set_identity(settings.user_agent())` runs before the first request, and the cache headers go on each request, not on the client. |
| The limiter is pyrate's `Limiter(Rate(n, SECOND))`: in-process and blocking. | `httpxthrottlecache/ratelimiter.py` | Pacing is `EDGAR_RATE_LIMIT_PER_SEC`, plus the `sec` pool at 1. |
| `EntityFactsParser.parse_company_facts` catches every exception and returns `None`, and `FinancialFact` drops `frame`. | `edgar/entity/parser.py:69-115,119-224` | It would make a failure look like an empty answer, so it is not used for companyfacts. |
| `parse_entity_submissions` indexes `cjson['addresses']`, which raises on older pages. `extract_company_filings_table(filings_json)` reads both shapes. `Form4.parse_xml` is offline (BeautifulSoup). | `edgar/entity/data.py:63-215`; `edgar/ownership/ownershipforms.py:1906` | Use `extract_company_filings_table` and `Form4.parse_xml`. The profile reader is ported from `xbrl.ts::submissionsFrom`. |
| `/sec-data/` caches a 200 for 7 days, `/sec/` for 30. | `stack/proxy/nginx.conf` | A refresh triggered by a filing would read last week's companyfacts. Every SEC stage-1 request sends `X-Muffin-Cache-Bypass: 1` and `X-Muffin-Cache-No-Store: 1`. Raw is the store. |
| `security_statement`'s key is `(security_id, statement, period_ending, period_type)`, and the Yahoo writer guards with `only_replacing`. `derive_security_metrics` marks `derived_at` on those four columns. `security_statement.currency` has no foreign key; `security_metric.currency_code` does. | baseline; `schemas/0023-…sql`; `defs/companies/core.py` | This is the `TRL` stall. A two-provider key also needs `source_code` in the marking join. |
| `metric_source_field`'s key is `(metric_code, source_code)`. `xbrl_concept` has 62 rows over 27 metrics (24 `ifrs-full`), and every metric it names is a statement line. `metric.is_flow` exists. | baseline | It gives the SEC statement vocabulary. |
| `filing_form` is keyed by the **regulator** (`disclosure_source`: sec, dart, nse, cninfo), while `security_filing.source_code` holds the writing resource. `pending_segments` filters on `filing_form('sec', report_type).carries_segments` and `security_disclosure = 'held'`. | `schemas/0094-pending_segments.sql`; `tests/a-korean-filing-is-not-an-sec-filing.sql` | This is the coexistence surface with the edge segments handler. |
| The edge's `insider_trade.trade_key` is `sha256(security\|date\|owner\|direction\|type\|shares\|price)`, with no accession. `security_insider_summary` counts `Acquisition`/`Disposition` over 90 days. | `index.ts:3831-3861`; `schemas/0062` | New rows need a natural key, and SEC's direction codes mapped to that vocabulary. |
| `ParquetIOManager` with `merge_on` re-reads and **rewrites** the stored file even when the result is empty. `UPathIOManager.load_input` is eager. | `lib/io_managers.py::_merge_with_stored` | Visiting a partition whose multi-MB documents are not due would rewrite gigabytes. This needs an `Unchanged` marker, and stage 2 reads raw through `RawStore`, not through `ins`. |
| edgartools is in the library's `filings` extra (`>=4.14,<5`, locked at 4.35.1). The image installs `hub = [lib[hub,filings]]`; the CI definitions job installs neither. | `libs/muffin-ingest-lib/pyproject.toml`; `projects/muffin-ingest/pyproject.toml` | Definitions must load without edgar: a lazy import, with a test that proves it. |

## Data model (expand, then contract)

### Provider audit (decision 6's guideline)

| Table | Provider column today | Phase 5 |
|---|---|---|
| `security_statement` | `source_code`, not in the key | **in the key**; the `only_replacing` guard goes |
| `security_metric` | `source_code` = the winner | key unchanged (a derivation); labels added |
| `security_filing` | `source_code` = the writing resource | gains `disclosure_source_code` (FK `disclosure_source`), the regulator, filled by a `one_shot`; every SEC row is written as `sec-submissions` |
| `insider_trade` | `source_code` | new sources `sec-form345` and `sec-form4`, and a natural key (below) |
| `filer_profile`, `security_former_name` | `source_code` | unchanged |
| `security.sic`, `sic_description` | **none** | also written to `filer_profile.sic`/`sic_description`, whose row carries a `source_code`; `derive_sic_classification` is re-pointed at contract; `security.sic` stays as the legacy copy |
| `fiscal_calendar`, `fiscal_period` | `source_code` | new |

### DDL sketch (expand)

```sql
-- statements: one vocabulary, labels, the provider key (built beside the key; swapped in 2b)
-- one_shot: delete the 3 'FY' rows that duplicate an 'annual' row (keep the newer as_of), then FY -> annual
alter table market.security_statement
  add constraint security_statement_period_type_check check (period_type in ('annual','quarter','half')),
  add column fiscal_year smallint,
  add column fiscal_period text check (fiscal_period in ('FY','H1','H2','Q1','Q2','Q3','Q4'));
create unique index security_statement_provider_key
  on market.security_statement (security_id, source_code, statement, period_ending, period_type);
alter table market.security_metric add column fiscal_year smallint, add column fiscal_period text;

-- the fiscal dimension. Grain: one regime per security per calendar; one row per security per
-- fiscal period per regime.
create table market.fiscal_calendar (
  security_id uuid not null references market.security on delete cascade,
  regime smallint not null,                       -- 1 = oldest
  source_code text not null references market.data_source(code),  -- 'sec-submissions' | 'yfinance'
  year_end_month smallint not null check (year_end_month between 1 and 12),
  year_end_day smallint,                          -- null when 52/53-week
  is_52_53_week boolean not null,
  week_end_isodow smallint,                       -- 1..7 when 52/53-week
  first_year_end date not null,
  last_year_end date,                             -- null = the current regime
  change_kind text not null check (change_kind in ('initial','year_end_change','successor','observed')),
  as_of timestamptz not null default now(),
  primary key (security_id, regime));
create table market.fiscal_period (
  security_id uuid not null, regime smallint not null,
  fiscal_year smallint not null,
  fiscal_period text not null check (fiscal_period in ('FY','H1','H2','Q1','Q2','Q3','Q4','T')),
  period_start date not null, period_end date not null check (period_end >= period_start),
  is_canonical boolean not null,                  -- false when an overlapping newer-regime period supersedes it
  is_observed boolean not null,                   -- from a filing or fact, vs computed from the year-end rule
  is_recast boolean not null default false,
  source_code text not null references market.data_source(code),
  as_of timestamptz not null default now(),
  primary key (security_id, regime, fiscal_year, fiscal_period),
  foreign key (security_id, regime) references market.fiscal_calendar on delete cascade);
create unique index fiscal_period_canonical
  on market.fiscal_period (security_id, fiscal_year, fiscal_period) where is_canonical;
create index fiscal_period_end on market.fiscal_period (security_id, period_end);

-- forms as a control table
alter table market.filing_form
  add column kind text not null default 'accounts' check (kind in ('accounts','event','proxy','notice')),
  add column is_amendment boolean not null default false,
  add column is_transition boolean not null default false,
  add column kept boolean not null default true,
  add column refreshes_facts boolean not null default false;
-- seeds ('sec'), from the measured `select report_type, count(*) … group by 1`: 10-K, 10-Q, 20-F
-- and 40-F keep carries_segments = true; 10-K/A, 10-KT(/A), 10-Q/A, 10-QT, 20-F/A, 40-F/A, 8-K(/A),
-- 6-K(/A), DEF 14A, NT 10-K, NT 10-Q and NT 20-F are seeded with carries_segments = false.
alter table market.security_filing add column disclosure_source_code text references market.disclosure_source(code);

-- insider: the filing's own identity
alter table market.insider_trade
  add column accession_number text, add column line_key text,   -- 'nd:3' | 'd:1' (table:ordinal in the document)
  add column issuer_cik integer, add column owner_cik integer, add column form_type text,
  add column transaction_code text, add column is_derivative boolean;
create unique index insider_trade_filing_line on market.insider_trade (security_id, accession_number, line_key)
  where accession_number is not null;
create table market.insider_transaction_code (code text primary key, name text not null);  -- SEC's Form 4 instructions
insert into market.data_source (code, name, priority) values ('sec-form345', 'SEC insider transactions data sets', 240);
-- metric_source_field: one row per xbrl_concept metric for 'sec-xbrl' (statement from metric.category; shares -> income)
```

**Grants.** `ingest_rw` holds `BYPASSRLS`, so each new table needs grants, `enable row level
security` and a public read policy. New functions need EXECUTE for `ingest_rw`. `market` still grants
`ingest_rw` DML by default, so a new control table the worker only reads gets an explicit revoke.

### Functions and views (expand, no-ops before data)

- **`market.label_fiscal_periods(p_security_ids uuid[]) returns integer`**, the one labeller, called
  by both lanes' stage 2.
  - A statement row takes the nearest **canonical** `fiscal_period` of its class (`annual`→FY,
    `quarter`→Q1–Q4, `half`→H1/H2) with `abs(period_end − period_ending) ≤ 10` days, the same 10
    days `derive_ttm` uses.
  - Only rows whose label differs are updated; no match writes null.
- **`derive_security_metrics`:**
  - `_src` carries `source_code` and the labels;
  - the `derived_at` marking joins on `source_code` too, or a period held by two providers would be
    marked done with one of them underived;
  - labels are copied into the metrics;
  - an unknown currency is written as null (from 0a), and every `do update` carries its
    `is distinct from`.
- **`derive_ttm`:** a `derived-q4` row takes its annual's year and `Q4`; a TTM row takes the label
  of its last quarter.
- **The `security_statement_requeue` trigger** also requeues on a change of `currency` (from 0a),
  `fiscal_year` or `fiscal_period`.
- **`security_statement_current`** keeps its columns and appends `fiscal_year` and `fiscal_period`.
  - It picks with `DISTINCT ON (sym.symbol, st.security_id, st.statement, st.period_type,
    coalesce(fiscal_year || fiscal_period, period_ending::text))`, ordered by
    `data_source.priority desc, as_of desc`.
  - The key **leads with the symbol**, so PostgREST's filter is pushed into the view, as in
    `security_metric_series`.
- **`security_metric_series`:** a row carrying its predecessor's fiscal label stays in the same
  cluster even when more than 7 days apart; otherwise the 7-day rule applies. Labels are appended.
- **`security_recent_filings`** takes `kind` from `filing_form`, so `40-F` and `10-KT` stop reading
  as events.
- **`security_insider_summary`** adds `where accession_number is not null`, at the switch stage only.

### The fiscal calendar (`facets/fiscal.py`, pure)

Inputs per CIK:
- the submissions filings: form, `reportDate` and accession, for 10-K/20-F/40-F annual reports,
  10-KT transitions and 10-Q interims;
- the current `fiscalYearEnd`;
- companyfacts durations (`start`, `end`, `accn`, `fy`, `fp`).

1. **Year ends** are the `reportDate` of every annual report the registrant filed itself, without
   amendments. Older ends come from 12-month duration facts ending on that regime's anchor.
2. **Regimes:**
   - Each end's anchor month is rounded to the nearest month end; 52/53-week ends fall within 7 days
     of one weekday.
   - A change of anchor starts a new regime.
   - A 10-KT, or a gap shorter than 12 months, is a transition period `T` (Mistras: 7 months).
   - A regime is `is_52_53_week` when its ends are not month ends and share a weekday.
3. **Labels:**
   - `fiscal_year` is the `fy` of the companyfacts fact whose `accn` is the ORIGINAL annual filing
     with that `reportDate`. That fixes AAPL's 2022/2023/2024 triple.
   - Years without such a fact step ±1 from the nearest labelled year in the regime.
   - Without SEC, the year label is the calendar year of the end, and an end on 1–7 January counts
     as the year before.
4. **Canonical:**
   - When two FY periods overlap by more than half, the one in the **newer regime** is canonical and
     the other gets `is_canonical = false` (decision 11). Greif's recast Oct 2023–Sep 2024 beats the
     original Nov 2023–Oct 2024, and Bristow's successor March years beat Era's December years.
   - A newer-regime period ending before that regime's first own year end is `is_recast`.
5. **Quarters:**
   - Within each canonical FY, the Q1–Q3 ends come from 10-Q `reportDate`s, in order, and Q4 ends at
     the year end. COST's 12/12/12/16 weeks and 52/53-week years follow from the order.
   - A filer with no 10-Q (20-F, 40-F) gets computed (`is_observed = false`) Q1–Q3 and H1/H2 at 3,
     6 and 9 months in, so Yahoo's half and quarter rows can still be labelled (BHP, VOD).
6. **Yahoo-only securities** (`calendar_from_periods`):
   - Built from the stored yfinance annual and interim period ends, with Phase 4's `cadence`, and
     `source_code = 'yfinance'`.
   - Written only where no SEC calendar exists; a SEC calendar replaces it.

A fact matching no canonical period is **not written as a statement row**: ESCO's 2019-07-02
"annual", Era's superseded years, transition durations. It is counted (`off_calendar`, `transition`)
and stays in raw.

## Architecture (`defs/sec/`, with Phase 4's company lane as the template)

### Partitions (`defs/sec/partitions.py`)

- `sec_filers = dg.DynamicPartitionsDefinition(name="sec_filer")`, one key per CIK
  (`"0000320193"`), ~3,420 keys. Stage 2 fans each CIK out to every equity mapped to it, resolved at
  parse time from `market.security.cik`. A CIK is permanent, so a re-parse uses today's map.
  - A per-security grid was rejected: ~340 duplicate fetches of shared CIKs (GOOG/GOOGL,
    BRK-A/BRK-B) and ~8,000 partitions that can never be asked.
- `sec_days = dg.DailyPartitionsDefinition(start_date="2026-10-01", timezone="UTC")`.
- `insider_quarters = dg.TimeWindowPartitionsDefinition(cron_schedule="0 0 1 1,4,7,10 *",
  start="2006-01", fmt="%Y-%m", timezone="UTC")`. Key `2026-07` is 2026q3.
- Constants:
  - `FILERS_PER_RUN = 50`;
  - `FLOOR_CYCLE_DAYS = 30`, `SUBMISSIONS_FLOOR_DAYS = 30`, `COMPANYFACTS_FLOOR_DAYS = 90`;
  - `ABSENT_REASK_DAYS = 30`;
  - `EVENT_HISTORY_YEARS = 5`;
  - `INDEX_LOOKBACK_DAYS = 90`.

### Assets

| Asset | Stage | Partitions | Backfill | Pool | Trigger | Writes | Checks | Freshness |
|---|---|---|---|---|---|---|---|---|
| `raw_sec_daily_index` | 1 | `sec_days` | `single_run` | `sec` | schedule `sec_daily_index` (`0 11 * * *`): yesterday plus any missing day in the last 10 | `form.<yyyymmdd>.idx` whole. A federal holiday is proven by the quarter's listing; a weekend writes the empty marker with no request. | `every_business_day_has_an_index` (ERROR) | 2 d |
| `raw_sec_form4` | 1 | `sec_days` | `multi_run(1)` | `sec` | same job, after the index | the complete-submission `.txt` of each 4 or 4/A of a tracked issuer listed that day (`merge_on=["accession"]`); skipped once the quarter's data set is held | `form4_days_are_complete` | 2 d |
| `sec_form4_trade` | 2 | `sec_days` | `multi_run(1)` | `sql` | same job | `insider_trade` (`sec-form4`), insert-only | — | 2 d |
| `raw_sec_filer` (specs `raw_sec_companyfacts`, `raw_sec_submissions`) | 1 | `sec_filer` | `multi_run(50)` | `sec` | sensor `sec_filers_due`; operator backfill | the newest answered companyfacts; the newest main submissions document plus every older page; absences beside them | `no_filer_is_behind_its_filings` | 3 d |
| `sec_filer_facts` (one step; specs `sec_filing`, `filer_profile`, `security_former_name`, `sec_fiscal_calendar`, `sec_statement`) | 2 | `sec_filer` | `multi_run(50)` | `sql` | same job | `security_filing`; `filer_profile` (+ `security.sic`); former names; `fiscal_calendar`/`fiscal_period`; `security_statement` (`sec-xbrl`) with `retract_unproduced`; then `label_fiscal_periods` | `sec_statements_are_labelled`, `statements_carry_a_known_currency`, `one_fiscal_period_one_point` (ERROR), `sec_family_covers_legacy` (transitional) | 3 d |
| `raw_sec_insider_dataset` | 1 | `insider_quarters` | `multi_run(1)` | `sec` | schedule `sec_insider_datasets` (`45 11 * * *`): the newest completed quarter once past its publication lag; history by backfill | the quarter's `form345.zip`, whole | `insider_quarters_are_held` | 120 d |
| `sec_insider_trade` | 2 | `insider_quarters` | `multi_run(1)` | `sql` | same job | `insider_trade` (`sec-form345`): the quarter's accession-bearing rows are retracted, then inserted | — | 120 d |
| `yahoo_fiscal_calendar` (new) | 2 | `security` | `multi_run(100)` | `sql` | `yahoo_companies` job, after `yahoo_statement` | Yahoo calendars where SEC has none; `label_fiscal_periods` | — | as `yahoo_statement` |
| `yahoo_statement` (changed) | 2 | `security` | unchanged | `sql` | unchanged | conflict on the 5-column key, `only_replacing` removed (2b); the currency map (0b) | `statements_carry_a_known_currency` | unchanged |
| `derived_security_metrics` (changed) | 3 | — | — | `sql` | gains `sec_statement` as a dependency; `EDGE_WRITES_FLOOR` goes at contract | metrics with labels | — | 3 h |

### Jobs, schedules and sensors (`defs/sec/automation.py`)

- **Jobs:**
  - `sec_daily_index`: the index, Form 4 raw and Form 4 trades (`run_tags=SEC_RUN`);
  - `sec_filers`: `raw_sec_filer` and `sec_filer_facts`;
  - `sec_insider_datasets`: the data set and its trades (`SEC_DATASET_RUN`).

  Each carries `dagster/max_runtime`.
- **Sensor `new_sec_filers`:** every 6 hours, RUNNING. It adds a CIK key for each equity holding a
  CIK, and only names keys no longer mapped, never deleting them.
- **Sensor `sec_filers_due`:** every 15 minutes, ships STOPPED. Its cursor is the newest index day
  processed, at most 3 days a tick. For each day D:
  - **due keys** are tracked CIKs named in D's index with a `kept` form (a `refreshes_facts` form
    also makes companyfacts due), plus D's floor slot, plus never-materialised keys;
  - **the floor** is `sha256(cik) % 30 == D.toordinal() % 30`, ~114 CIKs a day: submissions are due
    at 30 days old, companyfacts at 90, an absence re-asked at 30. A flat TTL would create
    synchronised waves;
  - **requests** go out for each `FILERS_PER_RUN`-aligned chunk of the grid holding a due key, with
    `run_key=f"{D}:{first key}"`, range tags and `SEC_RUN`. Chunks are aligned to absolute
    positions, so run keys stay stable as the grid only appends.

  If the index lane stalls, the floor stalls with it, and `every_business_day_has_an_index` goes
  ERROR.

  Rejected: one observable source per CIK plus `eager()`, because a scattered set becomes one run
  per CIK (measured 2026-10-06: 254 runs). A 7-day rotation, because it can be up to 7 days late
  after a filing.
- **Time:** the SEC lanes run from 11:00 UTC, clear of the price night (00:00–02:15), symbology
  (03:00) and the company lane (03:30–~06:00).

## Low-level design

### Library (`libs/muffin-ingest-lib/src/muffin_ingest/`)

| Module | Responsibility |
|---|---|
| `providers/sec_edgar.py` (new; the only module importing edgar, lazily) | `configure()` once per process: `EDGAR_BASE_URL = provider_base("sec", …)`, `EDGAR_DATA_URL = provider_base("sec-data", …)`, `EDGAR_LOCAL_DATA_DIR = settings.edgar_scratch_dir()`, `EDGAR_RATE_LIMIT_PER_SEC = settings.sec_requests_per_second()` (5); `import edgar`; `edgar.set_identity(settings.user_agent())`; `edgar.httpclient.HTTP_MGR = get_http_mgr(cache_enabled=False, request_per_sec_limit=…)`; asserts the cache is disabled. `fetch(url, *, provider, timeout_s) -> SecAnswer(document, status)` sends both cache headers. 200 and 404 return. 403, 429 and 5xx raise `SecRefused(status)` outside `metrics.request(provider)`; httpx errors raise `SecTransport`. URL builders for each document. `CONTROL_CIK = 320193`. |
| `facets/sec_index.py` | `CONTEXT_COLUMNS = {"document", "http_status"}`, `raw_rows`; `parse(body) -> list[IndexLine]` for the fixed-width format; `listing_days(body)`; `named(lines, ciks, forms)`. |
| `facets/sec_filings.py` | `CONTEXT_COLUMNS = {"page", "http_status"}`, `raw_rows`; `parse_main` (profile, former names, SIC, `fiscalYearEnd`, filings via `extract_company_filings_table`, older pages), with the rules ported from `xbrl.ts::submissionsFrom` (an empty string is absent, the `000000000` EIN is refused, `isXBRL` is compared numerically); `parse_page`; `filing_rows` (URLs on the real origin); `due`; `pages_due`. |
| `facets/sec_facts.py` | `CONTEXT_COLUMNS = {"http_status"}`, `raw_rows`; `read(body) -> list[Fact]` (orjson; keeps `frame`, `accn`, `fy`, `fp`, `form`, `filed`; raises `Unreadable`); `pick_unit_key` (ported); `statement_rows(facts, calendar, concepts, lines, is_flow, known) -> Normalised`; `due`. Lines are `metric` codes resolved per period through `xbrl_concept` (both taxonomies, by priority, then the latest `filed`), as `xbrl.ts::factsFromCompanyFacts` does today. A new line is a `metric` row plus an `xbrl_concept` row. |
| `facets/fiscal.py` | The calendar above: `calendar_from_sec`, `calendar_from_periods`, `rows(calendar, security_ids, source)`; `MATCH_DAYS = 10`. |
| `facets/insider.py` | `dataset_rows(zip_bytes, issuers, codes)` reads SUBMISSION, REPORTINGOWNER, NONDERIV_TRANS and DERIV_TRANS. `form4_rows(txt_bytes, issuers, codes)` extracts the `<XML>` and calls `Form4.parse_xml`. `line_key`; `trade_key = sha256(security_id\|accession\|line_key)`; `DIRECTION = {"A": "Acquisition", "D": "Disposition"}`; `quarter_bounds`. |
| `writers.py` | `retract_unproduced(cur, table, scope, produced_keys, key_columns)`: within a scope, deletes what the newest whole answer no longer produces. Called only after an answered and parsed companyfacts document. |
| `settings.py` | `sec_requests_per_second()`, `edgar_scratch_dir()`. |

### Project (`projects/muffin-ingest/src/muffin_ingest_dagster/`)

- **`lib/partitioned.py`** gains an `Unchanged` marker.
- **`lib/io_managers.py`:**
  - `dump_to_path` returns early for `Unchanged` when a file exists, writes the empty marker
    otherwise, and tallies `partitions_unchanged`;
  - zstd compression only if measured better.
- **`lib/runtime.py`:** `SEC_RUN` (1,800 s) and `SEC_DATASET_RUN` (900 s).
- **`defs/sec/`** has `partitions.py`, `raw.py`, `core.py`, `checks.py` and `automation.py`.
  `SecFilerRun(dg.Config)` has `limit`, `force`, `reparse` and `budget_seconds = 900`.
- **Stage 2 reads raw through `RawStore`**, one CIK at a time, projecting columns first. A CIK is
  parsed only when its newest raw row came from this run, when `reparse` is set, or when its
  fanned-out securities changed.
- **`defs/companies/`:** `core.py` and `derived.py` change, and gain the new `yahoo_fiscal_calendar`.

### Raw schemas (each added column justified by raw rule (c))

| Asset | Columns |
|---|---|
| `raw_sec_daily_index` | Document, plus `document` (`form_index` or `quarter_listing`) and `http_status` |
| `raw_sec_companyfacts` | Document, plus `http_status` (an absence vs an answer). `merge_on=["http_status"]`. The CIK is the partition key and is not written. |
| `raw_sec_submissions` | Document, plus `page` (`""` for the main document, else the page file name; the request member) and `http_status`. `merge_on=["page", "http_status"]`. |
| `raw_sec_form4` | Document, plus `accession` (the request parameter and merge key) |
| `raw_sec_insider_dataset` | Document only |

A test holds each to its `CONTEXT_COLUMNS`, and stored bytes are checked against served bytes by
sha256.

**Retention (rejected alternative: keeping every companyfacts version, ~4 GB per refresh cycle
against 26 GB free):**
- companyfacts and the main submissions document keep the latest answer only, since both are
  cumulative and carry `accn`/`filed` per fact or filing;
- older submissions pages are kept, and fetched once;
- absences are filed beside the answer.

### Stage-1 rules (`raw_sec_filer`, per partition)

1. If no equity maps to the CIK, count it `not_askable`.
2. Read the stored metadata (`page`, `http_status`, `fetched_at`), never the bodies.
3. Due reasons:
   - `never`;
   - `filed`: index lines since the newest answer (companyfacts only for `refreshes_facts` forms);
   - `floor`: the slot and the age;
   - `absent_reask`;
   - `forced`.
4. Fetch at 5 requests a second. After a main document answers, fetch any older page not held.
5. Classify every document as `answered | absent | absent_unproven | unreadable | refused |
   transport | not_due | unasked`.
6. Absences and stops:
   - an absence is filed only if the same run got a 200 from that host, or the control (AAPL, past
     the cache) answered; otherwise it is `absent_unproven` and not filed;
   - a 403 or 429 stops the run, and the rest are counted `unasked`;
   - three consecutive transport failures with nothing answered also stop the run.

The outcome sets sum to `requested` together with `not_askable`, asserted in tests that stop
mid-run.

**Daily index:** a 404 plus a listing showing a later day is a holiday. Otherwise it is a
`dg.Failure` ("not published"), claiming nothing.

**Insider data set:** a 404 means not yet published, and fails claiming nothing.

### Stage-2 statement rules (`sec_statement`)

Each rule gets a fixture where the right and the wrong rule disagree.

- **Per period**, the highest-priority concept wins, then the latest `filed`.
- **Durations:** 80–100 days is a quarter, 170–195 a half, 300–400 a year. Each must match a
  canonical period (end exact, start within 7 days). Year-to-date durations are skipped and counted.
- **Instants:** at a canonical FY end, both an `annual` and a `quarter` row are written (the Q4
  balance sheet); at a Q1–Q3 or H1 end, the matching type.
- **Currency** comes from the unit key and must be in `market.currency`, else null and counted. The
  row's currency is the most common code, and `mixed_currency` is counted.
- **`as_of`** is the companyfacts `fetched_at`.
- **Retraction:** after an answered, parsed document, `retract_unproduced` over `(security_id,
  source = 'sec-xbrl')`.

### Insider rules

**Mapping:**
- **Issuer to securities:** every equity with that CIK.
- **Owner:** the first reporting owner in document order; `owner_count` is counted.
- **Codes:** `transaction_code` stores SEC's code, and `transaction_type` takes its name from
  `insider_transaction_code`.
- **Lines:** 4/A amendments are counted (deferred), and both nonderivative and derivative lines are
  kept, with `is_derivative`.

**The two lanes:**
- **Data set quarter:** rows with `accession_number is not null` and a filing date inside the
  quarter, from either new source, are deleted, then the quarter's rows are inserted. That assumes
  the data set is keyed by filing date (to verify in step 3).
- **Form 4 lane:** insert-only, and it skips days whose quarter's data set is held.
- **Legacy rows** (no accession) are untouched until contract.

### Idempotency, dates and metadata

**Keys:**
- statements: the 5-column key, plus the retraction;
- `security_filing`: `(security_id, accession_number)`, upsert only and never deleting. Its column
  set never includes `segments_parsed_at` or `segments_parser_version`;
- `filer_profile`: `(security_id)`;
- former names: `(security_id, name)`;
- the fiscal tables: `replace_scope` per security, for the writer's source;
- insider: the unique index and `trade_key`.

**Dates:**
- `period_ending` is the fact's `end`;
- filing and report dates come from submissions;
- trade dates from `TRANS_DATE` or `transactionDate`;
- calendars from `reportDate`s;
- `fetched_at` is the only clock read.

**Metadata:**
- **`raw_sec_filer`:**
  - `companyfacts_*` and `submissions_*` over the outcome set;
  - `pages_{fetched, held}`;
  - `due_{never, filed, floor, forced, absent_reask}`;
  - `calls`, `bytes`, `throttled`, `control_asked`, `control_answered`, `partitions_unchanged`.
- **`sec_filer_facts`:**
  - parse coverage: `filers_parsed`, `filers_unchanged`, `facts_read`, `concepts_by_taxonomy`;
  - statement rows: `statement_rows`, `off_calendar`, `transition`, `ytd_skipped`,
    `currency_withheld`, `mixed_currency`, `rows_retracted`;
  - filings: `filings_rows`, `forms_not_kept` (with names);
  - calendar: `regimes`, `year_end_changes`, `calendars_52_53`, `labelled`, `unlabelled`.
- **Index:** `index_{answered, holiday, weekend, not_published, refused, transport}`,
  `tracked_lines_by_kind`.
- **Form 4:** `form4_{answered, absent, refused, transport, held_already, covered_by_dataset,
  unasked}`.
- **Data set:** `issuers_tracked`, `lines_nonderiv`, `lines_deriv`, `issuer_unmapped`,
  `issuer_fanned_out`, `amendments`, `rows`, `retracted`.

### Requests and budget

| Request | Per day, steady state | Backfill |
|---|---|---|
| Daily index | 1 | ~25 (since 10-01) |
| Form 4 `.txt` (tracked issuers) | ~300 (to measure) | the current quarter |
| Submissions plus pages | ~100–300 event-driven, plus 114 floor | ~3,420 plus ~2,000 pages |
| Companyfacts | ~10 (quiet) to ~400 (peak), plus ~38 floor | ~3,420 (~13 GB on the wire) |
| Insider data set | ~0 (quarterly) | ~82 × 8–13 MB |

At 5 requests a second through one pool, the edge's segments handler (~0.7 a second) still leaves the
total under SEC's 10. Raw grows ~5–9 GB in the first year, against 26 GB free.

## Coexistence with the edge `security-segments` handler (until Phase 6)

The Dagster filings writer must:
1. keep the key `(security_id, accession_number)` and SEC's form spelling in `report_type`;
2. never name `segments_parsed_at` or `segments_parser_version`, and never delete a filing (both
   asserted by unit tests on the writer's column set);
3. write `is_xbrl` on every row;
4. leave `carries_segments = true` on exactly 10-K, 10-Q, 20-F and 40-F. New forms are seeded false,
   so `pending_segments` grows only by the history rows added for those four forms (to measure);
5. leave `security_filer`, `security_disclosure`, the segment metrics in `xbrl_concept` and
   `segment_parser` untouched.

Re-keying `pending_segments` on `disclosure_source_code` is Phase 6.

## Still to measure (rollout step 3; from the node, paced, past the cache)

| Item | Subjects | Expected |
|---|---|---|
| Transport through http-cache | AAPL companyfacts and submissions | 200; UA = `MUFFIN_USER_AGENT`; metrics labelled `sec-data`; **nothing written** under `EDGAR_LOCAL_DATA_DIR`; nginx shows BYPASS and no store |
| Sizes (p50, p95, max), older-page counts, Parquet snappy vs zstd | AAPL, MSFT, JPM, BRK, GOOGL, COST, WMT, TGT, Greif, Mistras, Bristow, ESCO, plus 20 random tracked filers | sets `FILERS_PER_RUN` and the raw estimate |
| A foreign private issuer under `ifrs-full` | NVO (DKK), BUD, ASML, SAP, TSM (TWD and USD) | edgartools' standard map yields nothing; `xbrl_concept` yields revenue and net income in their own currency |
| A CIK with no companyfacts | one of the edge's 336 `xbrl_missing_at` | 404, proven by the control |
| An unknown CIK | an unassigned number | submissions 404 |
| Labelling | AAPL FY2022 | the original filing's `fy` = 2022, where the naive latest `fy` gives 2024 |
| A fiscal-year change | Greif, Mistras, Bristow, ESCO 2019-07-02 | naive `fp` labels repeat years; the calendar repeats none, and ESCO is off-calendar |
| 52/53-week and 12/12/12/16 | AAPL, COST | Q1–Q4 by order; Yahoo's month end within 10 days |
| Half-year | BHP, VOD (20-F) plus Yahoo half rows; NESN.SW (Yahoo-only) | computed H1/H2 labels them |
| January year ends | WMT vs TGT | the conventions differ, and only the filing's `fy` gets both right |
| The daily index | 5 recent days, Columbus Day 2026-10-12, a weekend | `Last-Modified` (the publication time); the holiday proven by the listing; tracked Form 4 lines per day |
| Form 4 | 5 AAPL accessions from 2026q3 | `.txt` size; `Form4.parse_xml`; lines against the 2026q3 data set's rows |
| The insider data set | 2026q3, 2016q1 | tables and columns; keyed by filing date or not; the publication lag; tracked rows per quarter; `ISSUERTRADINGSYMBOL` for GOOG/GOOGL |
| Production reads | — | `report_type` by source (for the seeds); legacy insider `transaction_type` values; `sec`-only metric keys; the 113 drifted pairs' expected disposition; CIKs mapped to more than one equity |
| Pace | ~500 requests at 5/s | `throttled 0`, no 403 |
| Import cost | `import edgar` in the image | time and RSS; loading the definitions does not import edgar |

Fixtures go to `libs/muffin-ingest-lib/tests/fixtures/sec/`, with a re-capture note.

### Measured 2026-10-26 (rollout step 3)

From the node, in a throwaway container from the production image, through http-cache with both
cache headers. Harnesses in this session's scratchpad. None of these findings changes a numbered
decision; four change a parameter or an example, and are marked **changes**.

| Item | Measured |
|---|---|
| Transport | 82 requests, every one logged `BYPASS` by http-cache, nothing stored. `cache_mode` Disabled, 5 a second. Importing and configuring edgartools takes 3.2 s and ~150 MB of RSS, and writes only an empty `_tcache/` and a zero-byte locale marker under the scratch directory. |
| Wire size | SEC gzips: AAPL's 3.79 MB company facts crossed as 272 KB. **Changes** the backfill estimate from ~13 GB to ~1 GB on the wire. |
| Sizes (36 answered filers) | Company facts p50 3.16 MB, p95 4.89, max 8.00 (JPM). Main submissions p50 156 KB, max 4.67 MB (JPM: 26,479 recent filings and **71 older pages**); every other filer has 0–2 pages. |
| Storage | One AAPL company facts body in Parquet: snappy 599 KB, **zstd 308 KB**. **Changes:** the SEC raw assets use zstd. |
| No company facts | 3 of 20 random tracked filers, and Poste Italiane: company facts 404 (S3 `NoSuchKey`), submissions 200. |
| Unknown CIK | 404 for both documents. |
| Foreign private issuers | NVO, BUD, SAP, TSM, BHP and VOD file `ifrs-full`; **ASML files `us-gaap`**. Units: NVO DKK, SAP EUR, VOD EUR, TSM TWD and USD, BHP and BUD USD. |
| Labels | Every accession's facts carry exactly one `(fy, fp, form)` (AAPL 72, GEF 64, VTOL 57, NVO 9, BHP 11 accessions): `fy`/`fp` label the FILING. AAPL's year ending 2022-09-24 is fy 2022 in its original 10-K and 2023, 2024 in later ones. So a period's label is the `fy` of **any fact in its original filing**, whatever concept: revenue changed concept at ASC 606, and a concept-bound rule found no label for most of Greif's years. |
| January year ends | Walmart labels the year ending 2025-01-31 fiscal 2025, and Target the year ending 2025-02-01 fiscal 2024. COST labels each year by its end. Only the filing's `fy` gets all three right. |
| Fiscal-year changes | **Changes an example.** Greif has no recast October–September year: its October years run to 2024, then a 10-KT covers November 2024–September 2025, and a 305-day fragment (18 facts) matches no canonical period. Mistras: May years to 2016-05-31, a 10-KT to 2016-12-31, then December. Bristow: Era's December years to 2019, the successor's March years 2021 and 2022, a 10-KT to 2022-12-31 (labelled fy 2022, like the March 2022 year, so `T` is what tells them apart), then December. Era's 2019 year overlaps the successor's April 2019–March 2020 year by nine months, which is the successor case decision 11 settles. ESCO's "2019-07-02 annual" is an acquisition-date INSTANT tagged FY in a 10-K: no canonical period ends then, so it is skipped. |
| Half years | Duration classifies, `fp` does not: Vodafone's six-month results are `Q2` (2,122 facts), BHP's `H1`, BUD both. NVO and SAP file years only. |
| Daily index | Published about 02:01 UTC the next day (`Last-Modified`). 3,100–3,600 lines a day. **Changes:** a day with no index (Columbus Day 2026-10-12, a Saturday, today before publication) answers **403** with S3's 263-byte `AccessDenied` XML, not 404, so it would read as SEC refusing us and stop the run. The quarter listing (`index.json`, one request, 10.7 KB) names exactly the days published: the lane asks it first and never requests a day it lacks. |
| Form 4 | Tracked issuers filed 161–374 Form 4s a day (2026-10-19..23), one index line each. A complete-submission `.txt` is ~8 KB, and `Form4.parse_xml` reads its `<XML>` block. |
| Insider data sets | Keyed by FILING date: 2016q1, 2025q4 and 2026q1 hold no filing outside their quarter. 8–14 MB each. Published ~7 days after the quarter (2025q4 on 2026-01-07, 2026q1 on 04-07), **but 2026q2 is still unpublished on 2026-10-26** (SEC's own page lists through 2026q1). **Changes:** the publication lag is not dependable, so `sec_days` starts on 2026-04-01, the first day no data set covers, and the Form 4 lane covers every day after the newest data set held (~33,000 files, under two hours at 5 a second). Alphabet's filings name only `GOOG` (77 in 2016q1): attributing by CIK, not symbol, is right. |
| Production reads | 34 CIKs map to more than one equity (3,726 CIKs). Legacy `insider_trade.transaction_type` uses SEC's code descriptions, and `insider_transaction_code.name` matches all but 3 of 54,109 rows, so new rows read the same. `security_filing.report_type` by writer: `sec-submissions` 10-Q 140,629, 10-K 44,332, 20-F 4,695, 40-F 1,345; `sec-filings` adds 8-K, 6-K and amendments. |
 **Any finding
that changes a decision goes back to the user before it is built.**

## Dependencies and isolation

- **edgartools is already locked** (4.35.1, MIT, in the `filings` extra the image installs).
- **Pin `edgartools==4.35.1`:** the design relies on the module global `edgar.httpclient.HTTP_MGR`
  and on `get_http_mgr`'s signature, and a test asserts the swap took effect.
- **What it brings:** pandas, lxml, bs4, hishel 0.1.3, httpxthrottlecache 0.6.1, pyrate-limiter 4.5.0
  (one background leak thread per limiter) and rich. Its import sets `LC_TIME='C'` process-wide,
  which is harmless here.
- **Isolation:** rung 1 (one environment), with the import lazy. Parser tests that need edgartools
  run in the hub test job.

## UI

No muffin-ui PR is required: every redefined view keeps its columns and appends the labels.

- **`security_statement_current`** serves one row per period, picked by priority. SEC rows carry the
  keys `use-statements.ts` reads (`revenue`, `net_income`, `gross_profit`, `operating_income`).
- **Filings** show ~5 years of events plus all accounts history, and `40-F` and `10-KT` read as
  annual.
- **The insider summary** covers every tracked issuer.

Re-timed as anon with the app's conjunctions (`check_anon_read_latency.py`):
- statements: symbol + statement, order by `period_ending desc`, limit 4;
- `security_metric_series`: (symbol, `period_type`, category), (symbol, `metric_code`,
  `period_type`), (`security_id`, `period_type`, `metric_code` in …);
- the insider summary by `security_id`;
- recent filings by `security_id`, order by `filing_date desc`.

Later, and optional: show "FY2026 Q2" instead of a date.

## Observability

- **Prometheus:** `muffin_ingest_provider_requests_total{provider="sec"|"sec-data", outcome}`; the
  duration includes the limiter's wait.
- **Grafana Providers:** a SEC panel with 403 and 429 visible.
- **Grafana Pipeline:** the runs of `sec_daily_index`, `sec_filers` and `sec_insider_datasets`, and
  rows written, zeros included.
- **Grafana Coverage:**
  - "filers behind their filings": the newest accounts `filing_date` against the newest `sec-xbrl`
    `as_of` + 2 days, read as `metrics_ro`;
  - raw bytes under `raw_sec_*`.
- **Alerts:** the existing failed-run and ERROR-check rules cover the three ERROR checks. The SEC
  `pending_*` panels and backlog samples go at contract.

## Rollout (each stage ends live)

| # | Repo | Change | Gate |
|---|---|---|---|
| 0a | deployment | an unknown currency no longer stalls the derivation; requeue on a currency change; behaviour test plus mutations (#459) | deploy; the next `derived_security_metrics` SUCCESS; the underived backlog drains |
| 0b | ingest | the `TRL→TRY` map and known-currency withholding (#123) | roll; `currency_mapped` counted |
| 0c | ops | replay `yahoo_statement` stage 2 for the three companies | 0 unknown codes; their metrics carry TRY |
| 1 | umbrella | this spec, the notes, todos, the guideline in memory and the skill | — |
| 2a | deployment | expand: the fiscal tables, labels, the label function, `filing_form` columns and seeds, `disclosure_source_code`, insider columns and code table, `sec-form345`, `metric_source_field` rows, FY→annual plus the CHECK, the 5-column unique index, the derive and view changes (no-ops), grants, tests | migrations job, mutations, anon timings |
| 2b | deployment + ingest, one window outside 03:30–06:00 | the statement-key switch (the key swap); `yahoo_statement` on the new conflict; `security-statements` retired (RETIRES, 410). Must precede any `sec-xbrl` statement write, because the old key would refuse a SEC row where Yahoo or `sec` holds the date. | the Yahoo day clean; two providers for one period served once |
| 3 | ingest | the library plus `Unchanged`; fixtures (AAPL, MSFT, Greif, Mistras, Bristow, ESCO, COST, WMT/TGT, NVO/ASML/TSM under IFRS, a 404 CIK, index days including Columbus Day, Form 4s, the 2026q3 data set) | tests and mutations |
| 4 | ingest | `defs/sec/`, `yahoo_fiscal_calendar`, the derived dependencies; `new_sec_filers` RUNNING, everything else STOPPED; snapshot, pool, run-limit and freshness tests | roll |
| 5 | local | a tiny subset (~12 CIKs, 3 index days, 2026q3) on a database built from migrations | counters sum |
| 6 | node | a live tiny subset; parity against the edge tables (`sec-xbrl` metrics by key, filings including segment markers, profiles, former names, `sic`, 90 days of insider trades), every difference explained | recorded in this spec |
| 7 | ingest | schedules and `sec_filers_due` RUNNING | first day: `throttled 0`, sums, the `sql` window |
| 8 | ops | backfills: the CIK grid; every insider quarter since 2006, newest first; Form 4 days since 10-01; the label and derive drain (~1 M statements) | a deferred note on the drain |
| 9 | deployment | retire `-xbrl`, `-filings`, `-filing-history` and `-insider` (RETIRES, 410, cron rows, `cron.unschedule('muffin-filing-history')`); re-point the insider summary | 410s; parity holds |
| 10 | deployment | delete the handlers after 3 clean days (`xbrl.ts` stays as long as segments imports it) | logic-check |
| 11 | deployment + ingest | contract, with drop dates (below) | proving queries |
| 12 | all | Grafana (the SEC provider panel, pipeline runs, "filers behind their filings"), docs, skills | — |

**Contract (step 11) drops:**
- the five `pending_*` views;
- the cursor and negative-cache columns, with their entries in `clear_symbol_caches`,
  `symbol_cache_classification` and `backlog_negative_cache`;
- the `sec` rows (decision 12);
- the legacy insider rows;
- `EDGE_WRITES_FLOOR`.

`check_one_period_one_point` is re-keyed on the fiscal labels, replacing `KNOWN_DRIFTED_PAIRS`.

## Risks and rollback

- **SEC refuses the node.**
  - Mitigated by 5 requests a second, stopping on a refusal, a control asked past the cache, and a
    validated User-Agent.
  - Until step 10, rolling back means re-enabling the edge rows and removing their `RETIRED`
    entries.
- **The key swap is one-way** once a second provider writes a period. Keep 2b small; a rollback
  needs a `one_shot` deleting lower-priority duplicates.
- **Overlapping writers:**
  - the edge's `sec-xbrl` metrics and the derived ones have the same source and priority, so parity
    must show equality;
  - the edge filings writer's `do update` against `sec-submissions` is harmless until step 9.
- **An edgartools upgrade:** pinned, and the `HTTP_MGR` swap is tested.
- **`sql` pool contention:** ~60–70 chunk runs a day each hold `sql`, which is why the SEC lanes run
  at 11:00 UTC.
- **Event-log growth** from chunk visits: up to ~3,400 materialisations a day, ~1–1.5 GB a year.
- **Wrong calendar heuristics** produce null labels, not wrong ones, and counts that the checks'
  thresholds catch.

## Deferred notes

To write as the stages land:
- `the-sec-family-leaves-columns-behind`: step 11's list, drop dates, proving queries;
- `a-quarter-is-derived-from-year-to-date-facts`: Q2/Q3 cash flow by year-to-date differencing, safe
  once the calendar exists;
- `two-sec-clients`: N-PORT and the CIK map still on plain httpx;
- `the-segment-queue-reads-the-regulator`: Phase 6, `pending_segments` on `disclosure_source_code`;
  whether 10-KT and amendments carry segments;
- `the-sec-lane-materialises-every-visited-filer`: the event-log growth;
- `an-amended-form-4-restates-the-original`;
- `a-yahoo-calendar-is-observed-not-stated`.

Plus the two Phase 4 notes this spec closes, updated with their "done when" evidence. The
`security-segments` TNDM stall moves to Phase 6 with segments.

## As built

Filled in as each stage lands.

### Step 2a (expand), first half: muffin-deployment, 2026-10-25

Five migrations, each in its own transaction so no lock is held longer than its own statement:

| Migration | What is now true |
|---|---|
| `20261025100000_a_fiscal_period_has_a_home` | `fiscal_calendar` and `fiscal_period`, with the partial unique index (one canonical period per security, year and period), RLS and grants. Empty. |
| `20261025100100_a_statement_carries_its_fiscal_period` | `fiscal_year`/`fiscal_period` on `security_statement` and `security_metric`; `label_fiscal_periods(uuid[])`; the requeue trigger fires on a label change; both derivations carry labels; every `do update` carries `is distinct from`; the `derived_at` marking joins on `source_code`. |
| `20261025100200_a_statement_is_unique_per_provider` | `security_statement_provider_key`, the 5-column unique index 2b swaps in as the key. |
| `20261025100300_a_filing_form_says_what_kind_it_is` | `filing_form` gains `kind`, `is_amendment`, `is_transition`, `kept`, `refreshes_facts`; 19 SEC forms seeded; `ingest_rw` can no longer write it. |
| `20261025100400_an_insider_trade_names_its_filing` | `insider_trade` gains the accession, line and CIK columns with a partial unique index; `insider_transaction_code` with SEC's 20 codes; the `sec-form345` source. |

Where it departs from the DDL sketch, and why:

- **The FY→annual conversion and the `period_type` CHECK move to 2b.** Measured 2026-10-25: the
  2,259 `FY` rows are all `sec`, written 2026-08-20/21 for 59 securities. 1,496 have no annual twin,
  763 collide only with a yfinance annual row, and **none** collides with a `sec` annual row. So
  under the 5-column key the conversion needs no delete at all, and before it every one of the 763
  would collide. The live edge writer already writes `annual`.
- **The fiscal-period CHECKs are `NOT VALID`.** Every existing row is null, which the check admits,
  and validating would scan `security_metric` (2.8 GB) while the migration holds `add column`'s
  ACCESS EXCLUSIVE lock, blocking the app's metric and ratio reads. A NOT VALID check is still
  enforced on every write.
- **The `sec-xbrl` rows of `metric_source_field` are deferred** until `sec-xbrl` statement rows
  exist. `check_derived_metrics.py` takes its sources from that table, so rows added now would pull
  the edge's directly written `sec-xbrl` metrics into its sample, with no statements to compare them
  against.
- **`insider_trade.transaction_code` has no foreign key** to the code table. A code the table lacks
  would fail the whole insert, the shape of the `TRL` stall; the lane counts unknown codes instead.
- **The codes come from Form 4's General Instruction 8** (SEC 1474 (03-26),
  `https://www.sec.gov/files/form4.pdf`, read 2026-10-25), not edgartools: its table lacks K, L, V
  and W and describes I wrongly. The group names are shortened from SEC's headings.
- **`derived_security_metrics`' `metrics_written` now counts changed rows**, not rows sent, because
  of the `is distinct from` guards. The drain loop reads the backlog counts, so it is unaffected.
- **The derivation keeps one statement per metric key in a page** (not in the sketch; found while
  validating). Re-deriving AAPL, MSFT and 7203.T in a rolled-back transaction on production, the
  CURRENT function failed the whole page: `ON CONFLICT DO UPDATE command cannot affect row a second
  time`. The `FY` rows (`sec`) and their yfinance `annual` twins map to the same `annual` metric, on
  4,694 keys across 57 securities, and AAPL's FY2023 short-term debt even disagrees between them
  (5,985,000,000 against 15,807,000,000). It is latent while the twins are never underived together,
  and step 8's label pass re-queues a security's statements all at once, so it would have stalled the
  derivation the way `TRL` did. The page now keeps the highest source priority, then the newest
  `as_of`. Guard: `tests/two-statements-for-one-metric-are-one-metric.sql`.

**Measured on production, rolled back, 2026-10-25 05:30–06:00 UTC:**
- per migration: 67 ms, 29 ms, **8,075 ms** (the index build, 23 MB, under a SHARE lock that holds
  writes, not reads), 216 ms, 225 ms;
- re-deriving AAPL, MSFT and 7203.T (127 statements, the `FY` twins left out so the current function
  can complete) with the current and the new function: **the same 5,889 metric rows**, except three
  7203.T `total_debt` rows the new function labels JPY where the current one left the currency
  empty (its free-cash-flow and total-debt updates never set it). The current function rewrote 582
  rows; the new one wrote 25.
- Re-deriving at all changes stored metrics: 7203.T gains `goodwill` and `long_lived_assets`, AAPL
  `depreciation`, and AAPL's FY2014 `total_debt` moves from 35,295,000,000 to 28,987,000,000, under
  either function. Those statements were derived before the metric mappings existed and never
  re-queued. Step 8's label pass re-derives every statement, which settles it.
- **Not yet in this half:** the view changes (`security_statement_current`, `security_metric_series`,
  `security_recent_filings`) and `security_filing.disclosure_source_code`. They are the second half
  of 2a and must land before 2b. The regulator column waits on a decision (below).

**Decided 2026-10-25 (the user, decision 13): a column on `security_filing`, written by the Dagster filings writers only.** The user's rule: the edge does not need to keep working and is not fixed. So there is no backfill and no trigger: the SEC lane writes `sec` from step 3/4, its step-8 backfill rewrites every SEC filing, and the other regulators' rows fill when Phase 6 moves them. The question as it was put: The DDL sketch adds
`security_filing.disclosure_source_code`, filled by a `one_shot`. The edge's `security-filings`,
`cn-filings`, `in-filings` and `kr-filings` keep inserting rows until step 9 and Phase 6, and none
of them would write it, so every row they add after the one-shot would have no regulator. The
alternative is a column on `data_source` (each writer names its regulator: `sec-submissions` and
`sec-filings` → `sec`, `cninfo` → `cninfo`, `nse` → `nse`, `dart` → `dart`), so the regulator is a
join, with no backfill and no writer change. Nothing in Phase 5 needs it before the views do.

### Step 2a, second half: the views (muffin-deployment#463, same PR)

`20261025110000_one_fiscal_period_is_served_once`:
- `security_statement_current` serves one row per fiscal label (else per period end), chosen by
  source priority, then the newest `as_of`;
- `security_metric_series` keeps a fiscal label's dates in one cluster;
- `security_recent_filings` takes its `kind` from `filing_form`.

Deployed 2026-10-25 07:24 UTC. `derived_security_metrics` then ran 23 times SUCCESS under the new
functions (07:47–18:47).

### Step 2b: the key swap (muffin-deployment#466, muffin-ingest#128), 2026-10-25

| Migration | What is now true |
|---|---|
| `20261025140000_a_statement_is_keyed_by_its_provider` | `security_statement_pkey` is the 5-column provider key (`add constraint … primary key using index` on the 2a index); the 2,259 `FY` rows are `annual`; `period_type` is checked to annual/quarter/half (NOT VALID); `security-statements` answers 410 and its cron row is off; `pending_statements` and its negative-cache pairing are gone. |
| `20261025140100_every_statement_period_is_annual_quarter_or_half` | the CHECK is validated, in its own transaction (SHARE UPDATE EXCLUSIVE only). |

- **Ingest:** `yahoo_statement` upserts on the provider key, and `only_replacing` is gone.
- **Other changes in the same PR:**
  - `check_derived_metrics.py` indexes statements by provider too;
  - two test fixtures use the new conflict target;
  - three tests stop writing `FY`/`Q4` statement rows;
  - three tests that asserted only `pending_statements`' population were removed with it.
- **Measured on production, rolled back:**
  - the swap took 0.4 s of ACCESS EXCLUSIVE and the validation 11.3 s;
  - on AAPL, MSFT, NVDA, 7203.T, SAP.DE, 005930.KS, VOD.L, COST, BRK-B and JPM, the 297 `FY` rows
    come back as `annual` with identical data;
  - 47 Yahoo annual rows that the app served **beside** a SEC year for the same period are now
    served once (MSFT 14, SAP.DE 14, JPM 13, AAPL 3, COST 3).
- **Deployed 2026-10-25 19:32 UTC** (run 40225521420, with #464 and #465). Ingest rolled 19:34
  (`95fb3b…` → `95b1a6…`). Live: the PK reads the 5 columns, the CHECK is validated, no `FY` row
  remains, and both retired resources answer 410.
- **Departures from the plan:**
  - `pending_statements` was dropped now rather than at contract, as Tiingo's view was: nothing can
    reach the handler, and the view would only freeze under the stalled-backlog alert;
  - the logic-check rotation guard had to be bounded to one statement (it read the new CHECK's
    `in (...)` as disabled resources).

### Step 3: the library (muffin-ingest#135, #138-#143), 2026-10-26..27

| PR | What it adds |
|---|---|
| #135 (merged) | `providers/sec_edgar.py`, the only module importing `edgar`: configured before its first import, its cache swapped for an uncached manager, both cache headers on every request, 200/404 returned and 403/429/5xx raised. `facets/sec_index.py`: the daily form index, read right-anchored, and each day classified from the quarter listing alone. |
| #138 (merged) | `facets/sec_filings.py`: filings from both submissions shapes through edgartools, `report_url`/`filing_detail_url` on SEC's origin, the profile, and former names one per name. |
| #139 (merged) | `facets/fiscal.py`: the calendar (below). |
| #140 (merged) | `facets/sec_facts.py`: company facts to statement rows (below). |
| #141 (merged) | `facets/insider.py`: the data set lane and the Form 4 lane, through one line rule. |
| #142 (merged) | `writers.retract_unproduced`: delete within a scope what a whole answer no longer produces, without rewriting the rest. |
| #143 (merged) | `partitioned.Unchanged` and per-asset Parquet compression. |

What building it found:

- **The `filings` extra could not import edgar.** edgartools 4.35.1 imports `pytz` without
  declaring it, and pandas 3 no longer brings it, so the image had it only through yfinance in the
  hub. The extra declares it, and the library CI job installs `filings` and runs `import edgar`. A
  `find_spec` check passed while the import failed, and the SEC tests would have skipped.
- **The links the app opens are written only by the resource step 9 retires.** `report_url` and
  `filing_detail_url` are set on 138,692 `sec-filings` rows and on 0 of 191,001 `sec-submissions`
  rows. Stage 2 builds both from the submissions document, byte-identical to openbb's for Apple.
- **`set_identity` logs the identity at INFO**, so the provider sets `EDGAR_IDENTITY` before import
  and never calls it.
- **Three rules of the calendar algorithm changed** (none changes a numbered decision):
  1. **A regime is labelled from its newest labelled year, counted by years elapsed**, not from each
     year's own filing. Walmart's 10-Ks tag the years ending January 2010-2014 with offsets of −1,
     −2, −2, −1 and −1 against the end year, and every year since 2015 by its end year, which is how
     Walmart names them. Target is −1 throughout; Costco, Apple, Microsoft and JPMorgan are 0
     throughout. Per-filing labels broke Walmart's sequence (2017 missing, 2016 twice).
     Disagreements are counted.
  2. **Quarters are numbered by position in the year, not by the filing's `fp`.** Greif's 10-Q
     ending 2020-07-31 is tagged Q2 and is its third quarter.
  3. **A lone annual report off both neighbours' anchor is a wrong date.** Walmart's 10-K for the
     year ending 2009-01-31 carries a `reportDate` of 2009-04-01, the day it was filed.
- **Step 1's "older ends come from facts" is a fallback, not the spine.** All 858 annual and
  quarterly reports measured carry a `reportDate`, and stage 2 reads every older page. Facts add
  only the years a registrant never filed itself. Each guard on them refuses a measured case:
  - a year is 355-375 days, which refuses Greif's 304-day fragment on its new anchor;
  - the year must be stated in an annual report, which refuses Bristow's March 2020, stated only in
    an 8-K;
  - the end must fall on an existing anchor, which refuses Walmart's December years.
- **The current year is projected**, `is_observed = false`, so the 10-Qs filed before its 10-K have
  a year. It lands on each company's actual rule: Apple's last Saturday of September, Costco's
  Sunday nearest August 31, Target's Saturday nearest January 31. Whether a regime is 52/53-week is
  judged on its last four year ends, because Apple's years ended on Fridays in the 1990s.
- **A quarter inside a transition gets no label**: Greif's three 2025 10-Qs, Mistras's two, Bristow's
  two. Giving them the transition's year would collide with the old regime's quarters. A recast year
  hosts no quarter, or Era's 2018 10-Qs would be relabelled into Bristow's April-March year.
- **`security_filing.disclosure_source_code` (decision 13) is not built yet.** It lands with the
  writer in step 4, as decided.

Company facts (#140), measured 2026-10-27 over 19 filers with their complete submissions history:

- **A fact is placed by matching a canonical calendar period, not by a day band.** A duration
  matches when its end is the period's end and its start is within `START_DAYS = 7` of the period's
  start; an instant at a fiscal-year end is written as `annual` and as `quarter`. The plan's 80-100
  days for a quarter would have refused Costco's 16-week fourth quarter (112 days); matched to the
  calendar, Costco's four quarters sum to its year (166,761,000,000) with Q4 at 53,383,000,000.
  Placed: 30,216 durations and 11,548 instants. Refused and counted: 10,654 year-to-date durations,
  666 off the calendar (Google Inc's 2015 quarters, filed under another CIK; Novo Nordisk's monthly
  6-K facts; ESCO's off-cycle comparatives).
- **A quarterly filer gets no half-year rows**: its six-month figures are year-to-date sums of
  quarters it already reports (`half_of_a_quarterly_filer`).
- **Within a period:** highest `xbrl_concept.priority`, then the latest filed, then the concept name,
  so a tie cannot depend on document order. A tie that disagrees is counted.
- **`metric_source_field` holds 0 `sec-xbrl` rows.** They are seeded with the writer in step 4.
- **`xbrl_concept` cannot read some lines in one taxonomy**, so parity in step 6 will show `sec`
  (openbb) rows company facts do not replace: us-gaap has no concept for `gross_profit`,
  `rd_expense` or `total_liabilities`, and `total_assets` only through `Segment*` concepts; ifrs-full
  has none for `buyback`, `goodwill`, `long_lived_assets`, `sga_expense`, `shares_basic`,
  `shares_diluted` or `stock_based_comp`. A missing line is an `xbrl_concept` row, and decision 12
  lists the periods only `sec` held before deleting them.

Insider (#141), measured 2026-10-27 on the 2006q1, 2016q1 and 2026q1 data sets and nine 2026q1
Form 4s:

- **A data set's file order is not document order; each line's surrogate key is.** About half of
  2026q1's filings list their lines out of order; sorted by `NONDERIV_TRANS_SK`/`DERIV_TRANS_SK`, the
  lines matched the filing's own XML in all ten tables of nine filings, and the shares owned after
  each line step consistently only in that order.
- **The data set lists a filing's owners in no stable order**, so the spec's "first owner in document
  order" cannot be read from it. Both lanes take the **lowest owner CIK** (1.3% of filings name
  several owners).
- **The data set rounds shares and prices to two decimals** (3,647.903 in the XML, 3,647.9). The Form
  4 lane keeps the filing's precision until the quarter's data set replaces its rows.
- **The nine Form 4s reproduce the data set's 58 rows**, every field but the source, to its two
  decimals, which is what makes the two lanes interchangeable for the retraction.
- All three quarters are UTF-8 with no unreadable date; SEC added `AFF10B5ONE` to SUBMISSION after
  2016, so columns are read by name. 2026q1 has 3 lines with no transaction code; they are withheld
  and counted.
- **Size, for decision 10:** 83,891 rows for 2006q1, 77,417 for 2016q1 and 122,993 for 2026q1 against
  today's 3,726 issuers, so every quarter since 2006 is roughly 8 M rows, against 54,109 today. Read
  time is 1.1-1.5 s and under 300 MB a quarter. The backfill runs newest first and is watched
  against the disk headroom, as decided.

The writer and the manager (#142, #143):

- **`retract_unproduced`** carries the produced keys as one typed array per key column, so a large
  filer is one statement (proven on Postgres with 70,000 keys); splitting a NOT EXISTS would delete
  each chunk's complement.
- **`Unchanged` is refused for a partition with no stored file**, where the spec said it would write
  the empty marker: that marker means "collected, and there was nothing", which a never-collected
  partition is not.

### Step 4: `defs/sec/` (muffin-ingest#145, #146, #147; muffin-deployment#475), 2026-10-28..29

| PR | What it adds |
|---|---|
| muffin-deployment#475 (deployed 2026-10-29 19:45 UTC) | `market.xbrl_fact_concept` (decision 14), `sec-xbrl` rows in `metric_source_field`, `security_filing.disclosure_source_code`, `filing_form.fiscal_role`; `check_derived_metrics` sampled per source |
| #145 (merged) | The insider lanes: `raw_sec_daily_index`, `raw_sec_form4` → `sec_form4_trade`, `raw_sec_insider_dataset` → `sec_insider_trade`; both schedules STOPPED |
| #146 (merged) | The filer lane: `raw_sec_filer` (company facts, submissions) → `sec_filer_facts` (filings, profiles, former names, calendars, statements); `new_sec_filers` RUNNING, `sec_filers_due` STOPPED |
| #147 | Filer checks; `yahoo_fiscal_calendar`; `derived_security_metrics` depends on `sec_statement` |

Where the build departs from the design above (none changes a numbered decision):

- **`sec_days` starts on 2026-04-01, not 10-01**, and the index looks back 10 days, not 90. The
  newest insider data set held is 2026q1 (2026q2 was still unpublished on 10-26), so the Form 4
  lane covers every day after it; a longer gap is an operator backfill.
- **The data-set schedule is weekly** (`45 11 * * 1`), not daily. A 404 fails the run claiming
  nothing, so a daily ask would leave a failed run a day for the months SEC takes to publish.
- **A day with no index answers 403** (Columbus Day, a Saturday, a day before publication), which
  reads as a refusal. The quarter listing is asked first, once per run, and a day is requested only
  when the listing names it; a weekend asks nothing, and a holiday keeps the listing as evidence.
- **The due sensor carries the filing day in the run's config** (`filed_submissions`,
  `filed_companyfacts`), rather than stage 1 reading back through index days. A document is due
  when it was fetched before the day its filer filed ended.
- **A 200 that is not a company facts document is never filed**: with `merge_on: http_status` it
  would replace the last good answer. Counted as `unreadable`.
- **Statements compare `data` and `currency`, never `as_of`** (`writers.upsert(compare=...)`).
  Company facts are a filer's whole history, re-read whenever it files; compared like a value,
  `as_of` would rewrite every unchanged statement and the requeue trigger would re-derive them all.
- **No calendar, no statements**: with an empty calendar every fact is refused as off the calendar,
  and the retraction would then delete every statement the filer has. Both are skipped.
- **A calendar is replaced only when it changed** (`lib/fiscal_tables.replace_calendars`), whole,
  for both writers.
- **`yahoo_fiscal_calendar` is not in the `yahoo_companies` job yet.** A label re-queues the
  statement for derivation, so it joins the running rotation at step 7, not on the roll.
- **`sec_family_covers_legacy` is not a check.** Parity is step 6's queries, recorded here.
- **Statement lines come from `metric_source_field`**, which #475 seeded from `metric.category`;
  the library's `STATEMENT_OF_CATEGORY` moved into its test.

Verified after #475's deploy: three versions in `schema_migrations`; the Dagster containers not
restarted (still 2026-10-26 22:35); every anon probe passed (slowest 668 ms); `check_derived_metrics`
compared 100 `sec` and 100 `yfinance` values and 0 `sec-xbrl`, as expected until this lane writes.

**market-verify had been red on every run from at least 2026-10-23**, on one error, and nobody had
read it: `check_one_period_one_point` paged `security_metric` by offset and was cancelled at the
8-second ceiling (the page at offset 70,000 took 12.3 s; by key, 6 ms). muffin-deployment#476 pages
it by key, with a self-test in `quality.yml`. Behind the timeout the guard then counted 120 annual
pairs against 113 known: Korean REITs' six-month fiscal years, SIG.AX's year-end change, ABF.L and
off-calendar SEC comparatives, all step 11's case (#477 raises the constant and names them).
market-verify passed on 2026-10-29 21:40 UTC, the first time since at least 10-23.
