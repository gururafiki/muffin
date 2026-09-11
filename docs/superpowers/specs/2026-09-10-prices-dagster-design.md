# Phase 2 — the price family, and the Dagster pipeline standard

**Status: APPROVED 2026-09-10.** Implements §8 Phase 2 of
[2026-09-09-ingestion-rework-design.md](2026-09-09-ingestion-rework-design.md), and **revises its
§6**: that section said "assets = tables, and one materialisation drains N pages of the ledger".
For prices that is the wrong shape, and the reason is measurable — see §3.1.

Every number here was measured against production on 2026-09-10, not estimated. Where a claim in an
earlier document turned out to be wrong, it is corrected in place and the correction is marked, so
a later session does not re-derive it from the wrong version.

## 1. Why prices first

Phase 1 landed the foundation and moved nothing user-facing: `muffin-ingest` (library, ledger, 76
tests), Dagster live with three services, migrations on the Supabase CLI. The 7,891-line Deno edge
function still runs all 54 resources.

Prices are the right first family:

* **They are the throughput pain.** `pending_prices` grows +768/day against an 8,520 backlog. The
  cause turns out not to be the provider (§3.1).
* **They have the simplest provider contract** in the system — one route, one provider, no
  jurisdiction-specific parsing.
* **They are the family the app draws directly**, so a parity failure is visible rather than
  theoretical.

The deliverable is two things, and the first outlasts the second: **a standard** for how every
ingestion pipeline here is built on Dagster, and **the price family** built to it.

## 2. What was measured

| Fact | Value |
|---|---|
| Equities | 12,350 · with a symbol 12,016 · with a **yfinance** symbol **10,894** |
| `market.security_price` | 16.4 M rows — 6.8 M daily, 9.6 M weekly · 11,754 securities · 1970-01-02 → 2026-09-10 |
| …footprint | **1,197 MB heap, 3,943 MB indexes** — 77 % index |
| …indexes | `pkey` 1,553 MB / **2 scans** · `date_idx` 1,490 MB / 11,447 scans · `date_sid_idx` 900 MB / **11 scans** |
| Other price tables | `market.prices` 6,575 rows · `performance` 82,260 · `security_corporate_action` 98,296 |
| Database / disk | DB 10,035 MB · `/mnt/data` **69 GB free** of 98 · `/` 12 GB free of 45 |
| Provider, measured 2026-08-28 | 12 symbols × full history = **11.6 MB JSON in 8.1 s** · mean **~7,300 bars ≈ 29 years** per security |

Two conclusions drive the design.

**`pending_prices` was an artefact of the runtime, not of the provider.** A 90-second worker could
carry ~400 securities per run, so the backlog grew whatever the provider would have allowed. The
same work outside that worker is one nightly pass.

**Two of the three indexes on `security_price` are dead** — 13 scans between them, 2.45 GB. The
replacement table ships with its primary key and nothing else until a query plan earns an index.
This is what pays for holding five times the rows (§5).

## 3. The standard

Every family from here follows the same three stages.

```
  ┌─ 1 ACQUIRE ───────────────┐  ┌─ 2 NORMALISE ─────────┐  ┌─ 3 DERIVE / SERVE ────────┐
  │ talks to the provider     │  │ never talks to a      │  │ never reads raw            │
  │ writes the provider's own │─►│ provider; reads raw,  │─►│ pure computation over core │
  │ words, unchanged, to raw  │  │ writes typed core rows│  │ + the serving views        │
  └───────────────────────────┘  └───────────────────────┘  └───────────────────────────┘
     partitioned; pool = provider   partitioned; pool = sql    eager; pool = sql / db-heavy
```

1. **An asset is a table (or a raw dataset); a partition is a slice of it.** Partition the question
   **the data cannot answer about itself**; leave to a query anything the table already states.
2. **Materialising a partition is a claim of completeness for that slice.** A run that cannot make
   that claim for the whole slice must not write the partition.
3. **The partition key follows the provider's REQUEST grain, not its subject grain** — and those
   are not always the same thing (§3.1).
4. **Stage 1 is the only stage allowed a network call.** Re-running stage 2 or 3 after a logic fix
   must never cost a provider request. This is also what makes the transformation rules testable
   against frozen bytes.
5. **Raw is immutable and reconstructible.** It records what the provider said, under the key we
   asked with, with `ingested_at` and `run_id`. A correction is a new fetch, never an edit.
6. **One I/O manager per storage class**, never per asset. Assets *return* records; they do not open
   connections to write their own output.
7. **A provider is a pool; a rate is the limiter.** A pool cannot express a rate, and a limiter
   cannot stop two runs colliding.
8. **Every rule that has cost this pipeline a month lives in SQL or one shared function**, never in
   an asset body. `ingest.mark_absent` still refuses without an isolated attempt and a healthy
   control.
9. **Every asset emits metadata answering "did this do anything real"** — `calls`, `answered`,
   `empty`, `rows_written`, `rows_retracted`, `backlog`. `rows_written: 0` is a legitimate value and
   is never filtered out of a chart.
10. **Checks are asset checks**, not a separate workflow. `market-verify` keeps only the end-to-end
    anon-key assertions.
11. **Serving views are the compatibility boundary.** The tables underneath can be replaced without
    a UI release.
12. **Code ships by image roll; config and schema ship by deploy** (§8).

### 3.1 Partitioning: date for the cross-section, ticker for history

**A correction to the first draft of this design.** It claimed a 20-symbol batch was one vendor
request, and therefore that ticker partitioning would cost 20× the provider budget. That is wrong.
From `openbb_yfinance/utils/helpers.py`:

```python
data = yf.download(tickers=symbol, ..., threads=False, **kwargs)   # symbol = "A,B,C,…"
```

`threads=False` with comma-joined tickers — **yfinance issues one Yahoo request per symbol,
serially**, inside one openbb call. It matches the measurement exactly: 12 symbols at full history
in 8.1 s ≈ 0.67 s per symbol. Batching collapses *our* call count (545 rather than 10,894); the
vendor sees one request per ticker either way.

Two consequences:

* The "20× the budget" argument is **withdrawn**. At the vendor layer the two schemes cost the same.
* **The limiter must be denominated in symbols per second, not calls per second.** A budget written
  in calls is 20× looser than it reads. `ingest.provider_budget.rate_per_sec` is symbols.

The second objection also fails, and it was checked rather than assumed:
`PartitionsDefinition.get_partition_keys_in_range` is implemented on the **base** class by index
over the ordered key list, so `BackfillPolicy.single_run()` works for static and dynamic partitions
as well as time windows — one run receives `context.partition_keys` and can batch inside it.
Batching survives ticker partitioning.

So the decision rests on orchestration cost and expressiveness:

| Option | Partitions | Materialisation rows/day | Answers |
|---|---|---|---|
| **Date (daily)** | ~365/yr | 1 | *"Did we collect Tuesday?"* |
| **Ticker (dynamic)** | 10,894 | 10,894 if run daily | *"Does AAPL have its history?"* |
| Date × ticker | 10,894 × 7,300 = **80 M** | — | over Dagster's documented ≤100,000/asset |
| Year × ticker | 29 × 10,894 = **316 k** | — | also over the limit |
| Decade × ticker | 33 k | — | fits, buys nothing — we never restate by decade, and a multi-dimensional selection is not one contiguous range, so single-run batching is lost |

**The rule that decides it: partition the question the data cannot answer about itself.**

* *"Does this security have its full history?"* **is** answerable from the data — `min(trade_date)`
  — and more so now that core holds the full span. A partition grid for it duplicates a fact the
  table already states.
* *"Did the collection run on Tuesday?"* is **not**. A security with no bar on Tuesday looks
  identical whether its market was shut, its symbol is dead, or nothing ran at all. That is the
  confusion this codebase has paid for repeatedly, and a date partition removes it structurally.

Three costs of ticker partitioning that bite only at daily cadence, and are why it is Lane B's
scheme rather than Lane A's:

* **No clean daily schedule.** `build_schedule_from_partitioned_job` is for time-window partitions;
  over 10,894 dynamic keys a nightly pass is either 10,894 `RunRequest`s or a programmatically
  launched backfill.
* **Event-log volume.** ~10,894 materialisation rows a day, ~4 M a year, into an event log Dagster
  OSS does not prune on its own. As Lane B it is ~10,894 rows **once**.
* **A scattered selection fragments.** A single-run backfill materialises a contiguous *key range*
  (`ASSET_PARTITION_RANGE_START/END` tags); 37 unrelated repairs become up to 37 runs. Fine for a
  lane that idles at zero. `get_partition_keys()` is also index-scanned per range resolution and is
  commented in Dagster's own source as "potentially expensive".

The number that makes the date lane comfortable, stated at the layer that matters: a full daily pass
is **545 openbb calls / ~10,894 Yahoo requests**, issued serially within each batch — ~0.13 req/s
averaged, ~1.5 req/s inside a batch. The old system tripped the limit by firing resources back to
back inside 90-second workers. The throughput problem goes away because the work stops being
squeezed into 90 seconds, not because a cheaper call was found.

### 3.2 Two acquisition lanes

| Lane | Asset | Partitions | Job | Idles at |
|---|---|---|---|---|
| **A — cross-section** | `raw_price_bars` | **daily**, from go-live, `single_run` | every askable symbol's bars for this window | never |
| **B — history & repair** | `raw_price_history` | **dynamic, one key per `security_id`**, `single_run` | this security has no history, or a new symbol | **zero** |

Two lanes because there are two questions. Lane B is where the subject *is* the slice, so Dagster's
partition grid is the native answer to "which securities are loaded" — no backlog view, and one
security is re-fetched by re-materialising one partition. The initial 29-year load is one backfill
over all keys: one run, 545 calls, chunked internally so memory stays bounded. A sensor keeps the
partition set in step with the universe (`AddDynamicPartitionsRequest` on promotion), which is also
the hook a symbol repair fires.

Lane A cannot be ticker-partitioned without losing the one question the data cannot answer for
itself. Lane B cannot be date-partitioned without a newly promoted security costing a re-fetch of
the universe.

*Rejected:* one asset, initial load as a single-run backfill over 1996 → today — on memory (one run
holding 80 M bars) and because a targeted top-up would then either lie about a date partition's
completeness or re-fetch 10,894 symbols to serve one.

### 3.3 Raw is partitioned Parquet behind an I/O manager

Raw records the provider's answer unchanged: `(provider, asked_symbol, observed_symbol, date,
o/h/l/c, volume, dividend, split_ratio, currency, ingested_at, run_id)`.

| | Parquet on `/mnt/data` **(chosen)** | a `raw` schema in Postgres |
|---|---|---|
| 88 M bars | **~0.8–1.5 GB** compressed | ~10 GB, inside the database the app reads |
| Re-transform | reads files, no load on the serving DB | competes for the 1 GB `shared_buffers` |
| Ad-hoc SQL | needs DuckDB/polars | native |
| Durability | same volume as the DB; **reconstructible in 545 calls** | same volume |

Raw's value is being cheap to keep and cheap to re-read. Putting 10 GB of it into the database the
app reads as `anon` under a 3-second timeout is a shape this codebase has been bitten by. It needs
no backup: 545 calls rebuild it.

Implementation is `dagster-polars`' `PolarsParquetIOManager` if the arm64 wheel and image-size delta
check out, else a `UPathIOManager` subclass over `pyarrow`. Either way the asset returns a frame.

**This needs a deployment change that is easy to miss.** `DAGSTER_HOME` is bind-mounted **read-only**
into all three services, deliberately — the daemon crash-looped when telemetry tried to write there.
Raw needs a *separate*, writable mount at `/mnt/data/ingest/raw`, on `/mnt/data` and never on `/`
(74 % full). It is an Ansible task plus a compose volume carrying the `muffin.config-hash` label, so
the edit actually restarts the service.

### 3.4 Core is written by a Postgres I/O manager

Stage-2 assets return typed records; the `postgres_io` manager performs the write through the
existing `muffin_ingest.writers.upsert` / `replace_scope`. So `dedupe_by` on the conflict key,
`require_currency` and `numeric_or_none` apply to **every** core write without a caller remembering
— which is the writers module's stated purpose, now structural rather than conventional.

Returns are computed in **Python**, not SQL: the rules are intricate and already carry ~100
assertions to port (staleness ≥ 10 days, the `>5×` comparability cut, "a window that never moved is
not a 0.00 % return", `1d` = previous bar rather than a date lookback, YTD anchored on last year's
final close, dividend-reinvested total return). The weekly downsample and the serving views are SQL,
because their input is already in Postgres.

### 3.5 The ledger, reduced to subject health and a call log

Today per-security ingestion state is **21 `%_missing_at` columns and 8 cursors on
`market.security`**, read by **38 `pending_*` views** doing duty as work queues. `ingest.task` is
the normalised form of exactly that — one row per (subject, facet) with `status`, `next_due_at`,
`asked_with`, `last_outcome`, instead of one column per facet on a fact table. It is not a rival to
Dagster; it is third normal form applied to state that already exists.

With Lane B ticker-partitioned the ledger loses its ordering and queue roles. What remains is what
Dagster has no concept of:

1. **Outcome classification with a retry policy.** Dagster knows *materialised* or *failed*. It has
   no notion of "asked, the provider genuinely has nothing, do not ask again for 30 days, and here is
   the retraction that must run". Failed vs empty vs throttled vs dead-subject is the most expensive
   confusion in this codebase's history — ~8,300 securities negative-cached in one afternoon.
2. **A refusal the caller cannot walk around.** `ingest.mark_absent` is `security definer` and
   refuses unless the attempt was isolated *and* a control subject answered; migration 207 revokes
   DML on `ingest.task` from `ingest_rw`, so the worker cannot set `status='absent'` itself.
3. **Sub-run granularity.** One run makes 545 calls. Die at call 300 and Dagster records one failed
   run; `ingest.attempt` records which 300 landed and over which subjects.
4. **A provider budget shared across runs and families** — the daily quota (Alpha Vantage is 25/day)
   and the cooldown.

*If it is ever to be dropped*, the honest list is: replace `status`/`next_due_at` with a
`security_provider_state` table (the ledger renamed) or encode absence as materialisation metadata
queried through Dagster's GraphQL — putting a correctness-critical query behind Dagster's internal
schema; give up the per-call record and with it the dead-run detector; and move the daily quota into
the limiter's own store.

### 3.6 Calling the vendors

**openbb, imported in-process**, for `equity/price/historical` (yfinance), `equity/compare/groups`
(finviz), `equity/calendar/earnings` (nasdaq) and the FRED/OECD/federal-reserve macro routes.
Scaffolded in Phase 1 as `providers/openbb.py`: a lazy `_load_hub()` so `dagster definitions
validate`, mypy and the unit tests all run without ~250 MB of AGPL provider code installed; a
`ROUTES` table as *data*; and `classify()` checking the throttle vocabulary **before** the absence
one.

* **What the import buys** — the provider's own `YFRateLimitError` reaches `classify()` intact.
  Behind the REST hop it was flattened to an empty 204, byte-identical to "this symbol has no data".
  That is the confusion that negative-cached ~8,300 securities, and the reason the licence is
  AGPL-3.0.
* **What it costs** — openbb's egress does **not** pass through `http-cache` (yfinance uses
  `curl_cffi` and ignores our base URLs), so those calls are uncached and invisible to nginx's
  `$provider` metrics. This is the blind spot already recorded for `openbb-api`, moved inside our
  process. **It is why the worker's Prometheus exporter is a Phase 2 deliverable rather than a
  nice-to-have** — in-process is the only place those requests can be counted.
* Every openbb extension is pinned exactly; a bump is deliberate and gated by `@pytest.mark.live`
  contract tests per route.

**`muffin_ingest.http.client` (httpx) for everything else** — Yahoo chart and ISIN search, SEC,
OpenFIGI, Tiingo, Alpha Vantage, Wikidata, DART, CNINFO, NSE. Base URL from
`settings.provider_base()` defaulting to the **real origin** so the cache stays removable, the
SEC-mandated User-Agent, timeouts, Prometheus counters. These do go through `http-cache`, and
`quality.yml`'s `http-cache-covers-every-provider` keeps that honest in both directions.

**Three layers of pacing, each bounding something the others cannot:**

| Layer | Bounds |
|---|---|
| Dagster pool `yfinance` (limit 1) | two runs touching one provider at once |
| `pyrate-limiter` on `ingest.provider_budget` | **symbols**/sec and requests/day, Postgres bucket so it holds across run subprocesses |
| `provider_budget.cooldown_until` | "it told us it is refusing us" — the budget can be untouched and the provider still unwilling |

### 3.7 Dependency isolation: prepare for the split, ship one environment

openbb pins `pandas` and drags a provider stack; yfinance pins `curl_cffi`; `edgartools`,
`pdfplumber` and `lxml` each pin their own. Dagster's mechanisms, lightest first: one environment;
**a second code location** (its own image and gRPC server, assets still depending across locations
by `AssetKey`); `dagster-pipes` for a single step in its own venv; `docker_executor` for a container
per step.

**Ship one environment now; keep the split one packaging change away.** That is safe as a property
of the architecture rather than a hope: because stage 1 hands off through Parquet and stage 2
through Postgres, **no asset passes a Python object to another asset across a stage boundary** — so
any asset can move to a second code location, or behind Pipes, without changing a dependency edge.

To keep the split a packaging change, the library declares extras from the start —
`muffin-ingest[acquire]` (openbb, httpx, edgartools, pdfplumber) and `muffin-ingest[transform]`
(polars, psycopg) — with one image built from both. The day a conflict or an image-size problem
makes it worth a deploy, the transform location becomes a smaller image carrying **no AGPL code at
all**, which is a licence boundary worth having anyway.

*Measured 2026-09-10, and the estimate in the first draft (~35 MB) was low.* On `aarch64` the
wheels are **`polars-runtime-32` 46.6 MB** and **`pyarrow` 46.8 MB**, compressed. `dagster-polars`
0.27.12 is pure Python, declares `dagster` unpinned, and 0.27.x is the line that tracks dagster
1.11. `pyarrow`'s wheel is `manylinux_2_28`, which `python:3.13-slim` (bookworm, glibc 2.36)
satisfies. Since the fallback needs `pyarrow` either way, **the marginal cost of polars is 46.6 MB**,
not 93. It still has to earn that — `scan_parquet` streams, and the 88 M-row transform must not hold
a frame in memory on this node — so the first image roll reports the real layer delta.

## 4. The asset graph

```
                    ┌──────────────────────────────────────── pool: yfinance ───┐
   schedule 22:10 ─►│ raw_price_bars      [DAILY partitions,     single_run]    │
   sensor / repair ►│ raw_price_history   [per-SECURITY dynamic, single_run]    │
                    └───────────────┬───────────────────────────────────────────┘
                                    │ parquet_io  (/mnt/data/ingest/raw/…)
                    ┌───────────────▼──────────────────────── pool: sql ────────┐
                    │ price_bar          [daily]     market.price_bar           │
                    │ price_bar_history  [security]  market.price_bar           │
                    │ corporate_action   [daily]     market.corporate_action    │
                    └───────────────┬───────────────────────────────────────────┘
                                    │ AutomationCondition.eager()
                    ┌───────────────▼───────────────────────────────────────────┐
                    │ price_bar_weekly (matview)      security_return           │
                    │ index_return ◄── raw_group_performance / raw_index_bars   │
                    └───────────────┬───────────────────────────────────────────┘
                                    ▼
                      api.price_series · api.performance    (shape unchanged for the UI)
```

`fx_rate` joins as a third acquisition asset (Yahoo, daily partitions) feeding `market.fx_rate`; it
is small and shares every rule, including the subunit derivation (ILA/ZAC/KWF) and the negative
cache for a currency with no history.

Two assets write `market.price_bar`, on two partition schemes. Deliberate, and visible in lineage;
the alternative was a partition that lies about its completeness.

## 5. The normalised model

Five things are wrong with the current model, each with a cost already paid:

| Today | Problem | Target |
|---|---|---|
| `security_price(security_id, date, close, **grain**)` | a *sampling* concept in the primary key; one date carries two rows meaning different things | `market.price_bar` — daily observations only; weekly is a **matview** |
| `market.prices(symbol, date, close)` | the same fact under a **second key**, FK'd to the curated instruments | retired; curated rows get `security_id` + `is_curated` |
| `performance(scope, scope_id, period, …)` | **polymorphic key** — `scope_id` is a symbol, or a sector code, or a country; `period` is a 10-value CHECK | `security_return` + `index_return`, with `return_period` as a dimension |
| 4 ingestion columns on `market.security` | pipeline state on a fact table | `ingest.task` |
| `close` with **no currency** | the chart draws a bare number — the shape that rendered CNY 1.02 T as "$1.02T" | `currency_code`, **nullable** — see the measurement below |

```sql
create table market.price_bar (
  security_id   uuid not null references market.security on delete cascade,
  trade_date    date not null,
  close         numeric not null check (close > 0),
  volume        bigint,
  currency_code text            references market.currency,   -- nullable, and measured; see below
  source_code   text   not null references market.data_source,
  primary key (security_id, trade_date)
) partition by range (trade_date);          -- one partition per year
-- SHIPS WITH THE PRIMARY KEY AND NOTHING ELSE. Measured on its predecessor: two of three indexes
-- had 13 scans between them and cost 2.45 GB. An index is added when a plan asks for one.

create table market.return_period (          -- was a CHECK constraint listing ten strings
  period_code text primary key, lookback_days int, label text not null, sort_order int not null);

create table market.security_return (
  security_id uuid not null references market.security on delete cascade,
  period_code text not null references market.return_period,
  as_of date not null,
  price_return_pct numeric,
  total_return_pct numeric,          -- NULL means "not computed"; never coalesced to the price return
  source_code text not null references market.data_source,
  primary key (security_id, period_code));

create table market.index_return (           -- sector / country / finviz-group proxies
  index_code  text not null references market.index_scope,
  period_code text not null references market.return_period,
  as_of date not null, price_return_pct numeric, total_return_pct numeric,
  source_code text not null references market.data_source,
  primary key (index_code, period_code));

create materialized view market.price_bar_weekly as
  select distinct on (security_id, date_trunc('week', trade_date))
         security_id, trade_date, close, currency_code
    from market.price_bar
   order by security_id, date_trunc('week', trade_date), trade_date desc;
-- This retires `security-price-history` ENTIRELY: with full daily history held, a weekly series is
-- arithmetic rather than a second fetch.
```

**`currency_code` is nullable, and that is measured rather than lazy.** Of 10,894 askable equities,
**10,469 (96.1 %) have a currency** from their listing or from `security.currency_code`; **425 have
neither**. `NOT NULL` would refuse those securities a price row at all — which is worse than the bug
it prevents, because the app already *withholds* a label it cannot justify (that is how the
CNY-as-"$1.02T" defect was actually fixed), so an unlabelled number degrades gracefully while a
missing bar means no chart. The shortfall is a symbol-resolution gap belonging to the universe
family; an asset check counts it so it stays visible rather than becoming normal. The first draft
of this document said `NOT NULL`.

**`source_code`, not `method_code`.** The draft invented a column. `market.performance.source`
already holds `yfinance` / `finviz`, which are `market.data_source.code` values, so the existing
convention is a real foreign key and the new tables use it.

**Depth: the full ~29 years of daily bars in core.** ~88 M rows ≈ 10 GB (heap ~6.4 GB at the
measured 73 B/row, PK ~3.5 GB) against today's 5.1 GB and 69 GB free. That is what dropping the two
dead indexes pays for: **5× the rows for 2× the bytes**, and any chart range or backtest answerable
from SQL. Three things make it safe rather than merely affordable:

* **Yearly range partitions** — a date filter prunes, `vacuum` is per-year, and a later retention
  decision is a `detach` rather than a rewrite.
* **The estimate is checked before it is committed to.** The 50-security shadow measures real
  bytes-per-row; the full load proceeds only if the extrapolation still leaves ≥ 20 GB headroom.
* **`price_bar_weekly` survives as a serving optimisation.** 29 years of daily is ~7,300 points —
  too many to draw and too slow to ship to `anon` inside 3 s — so long charts read the downsample.
  The difference from today is that it is derived.

The bulk load is chunked by security through Lane B, runs off-hours, pre-creates the yearly
partitions and uses `COPY`: 88 M rows is a lot of WAL on a node whose documented failure mode is
resource exhaustion.

### 5.1 What the UI gets, and when

The cutover lands `api.price_series(symbol, date, close, grain)` and `api.performance(scope,
scope_id, period, change_pct, total_return_pct, as_of)` — **the shapes the app already reads** — so
it needs no `muffin-ui` release. The UI PR is separate and later, and what it unlocks is real:
daily charts at any range (today's daily window is 400 days and everything longer is weekly), a
currency on the price so the chart can label money the way `money.ts` already labels fundamentals,
and volume — with OHLC available from raw if candlesticks are ever wanted.

## 6. Observability

**Dagster owns**, and nothing is rebuilt in Grafana for it: the partition grid — *which days are
missing*, which the old system had no equivalent of; run and step status, duration and logs; asset
check history; backfill progress; and per-materialisation metadata plotted over time (`calls`,
`answered`, `empty`, `throttled`, `rows`), which replaces the `refresh_run` panels.

**Grafana stays the single alert path** and gains one dashboard over the `dagster` database through
`metrics_ro`:

| Panel / alert | Source |
|---|---|
| Failed runs, failed asset checks, freshness breaches → **email** | `dagster.runs`, `asset_check_executions` |
| Dead run — an attempt open past its timeout | `ingest.attempt` |
| Provider requests / throttles / bucket wait, by provider | the worker's Prometheus exporter (multiprocess mode + `mark_process_dead`) |
| Coverage by country/sector/tier, universe size | `coverage_sample`, `universe_sample` — unchanged |
| Infra: memory, disk, container restarts | unchanged |

Retired for this family: the backlog depth / drain-rate / FLAT panels. For Lane A the backlog is
Dagster's unmaterialised partitions; for Lane B it is one count published as asset metadata.
`market-verify.yml` keeps only the end-to-end anon-key assertions, and a check leaves it **only
after the Dagster check has fired correctly once**, proven by mutation as today.

### 6.1 Asset checks

`close_is_positive` (blocking) · `cross_section_covers_the_universe` (**warn**, because a national
holiday legitimately empties a market) · `discontinuities_are_explained_by_a_split` (gauge, the
`>5×` rule) · `one_period_one_point` (blocking) · `no_frozen_series_reported_as_flat` (blocking —
the 62-identical-closes detector) · `weekly_matches_daily` · `anon_read_latency`. A
`FreshnessPolicy.time_window(fail_window=36h)` on `price_bar`.

## 7. Sequencing — two deploys

**A correction to the first draft, found by looking rather than grepping for a filename.** It said
`muffin-ingest` has no build workflow. It has one — inside `quality.yml`, an `image` job on
`ubuntu-24.04-arm` that builds `linux/arm64` and pushes **`:latest` and `:<sha>`** on every push to
main, then asserts all three entrypoints exist in the pushed tag. What is missing is not the build.
It is the **roll**: nothing tells the node to pull it.

That makes the fast path cheaper *and* safer than the draft assumed, because of a second measured
fact: `image_ingest` is `…/muffin-ingest:latest` in **all three** places that set it — the deploy
workflow, `config.example.yml` and the compose default. So:

> **Code ships by image roll; config and schema ship by deploy.** A roll is
> `docker service update --image ghcr.io/gururafiki/muffin-ingest:latest --force` on the three
> Dagster services — a minute, no Terraform, no Ansible, no migrations re-applied.
> **There is no revert trap here, and that is a property of the tags rather than luck:** a full
> deploy renders the same moving tag the roll pulled, so the two *converge*. Were `image_ingest`
> ever pinned to a sha, the roll would be silently undone by the next unrelated deploy — the same
> class of mistake as the bind-mounted config that restarted nothing. Pinning it is therefore a
> decision that has to come with a new way to ship code.

So the only deliverable here is the roll step: a small `workflow_dispatch` in `muffin-deployment`
that updates the three services, triggered from `muffin-ingest`'s `image` job.

| Deploy | Contents |
|---|---|
| **D1 — Foundation** | Ansible: writable `/mnt/data/ingest/raw`, `yfinance`/`yahoo` pools, both under `muffin.config-hash`. Migration: the whole model in §5 — additive, empty, beside the existing tables. Plus the image-roll workflow. |
| **build-out** *(no deploys)* | I/O managers, records, the adapter and `classify()`; Lanes A and B, the sensor; the **29-year backfill** (a Dagster backfill, not a deploy); returns with their ~100 ported assertions; FX; index returns; checks and freshness; **dual-run parity over days** |
| **D2 — Cutover** | Migration: `api.price_series` / `api.performance`, PostgREST exposes `api`, old resources disabled in `cron_resource` — safe together *because parity was proven with no deploys in between*. Old tables stay. UI unchanged. |
| *rides with Phase 3's D1* | Drop `market.prices`, the four `market.security` price columns, the old `pending_*` views; delete the handlers from `index.ts` |

Plus two things that are not `muffin-deployment` deploys: the `muffin-ui` PR, and the docs PR.

### 7.1 Two gaps the migration cutover left, found by being the first to use it

Both were fixed in D1 (muffin-deployment#362), and both are the same shape — *a guard that stopped
covering the thing it was written for when the mechanism underneath it changed.*

* **CI applied no new migrations at all.** It applies `migrations-legacy/` as the reference and the
  baseline into a throwaway database for the equivalence proof. `migrations/` — now the only place
  schema work goes — was never applied to the database the behaviour tests run against. The first
  migration written after 2026-09-10 would have reached production unexercised. Fixed by applying
  them *after* the equivalence proof (anything earlier reads as a difference against the baseline)
  and **once**, because `db push` runs a migration once and the old "must apply twice" discipline
  describes a deploy model that no longer exists.
* **`every-table-is-reachable` walked `pg_tables`**, which lists every partition, so `price_bar`'s
  61 partitions would each have been reported unreachable while the table was fully reachable.

**And one that is NOT fixed, recorded here rather than quietly carried.** The baseline is generated
with `pg_dump --no-privileges`, and the repeatable bundle emits grants only for `relkind in
('v','m')`. So **no artifact in the repo grants anything on a `market` TABLE.** Production is
unaffected — its ACLs came from the legacy applies and were never rebuilt — but a database rebuilt
from `migrations/` + `schemas/` + `always/` would have market tables no role but `postgres` can
read. It is a disaster-recovery gap, not a live one, and it wants its own change: either the bundle
extracts table ACLs too, or the baseline stops being dumped `--no-privileges`.

**The cost of two deploys, stated honestly:** D1 lands the whole model in one migration, so it has
to be right the first time — a correction found during the build-out waits for D2 or buys a third
deploy. That is what this document is for.

**Rollback** is unchanged throughout: the old resources run until D2, so reverting is re-enabling
one `cron_resource` row; D2's views revert with the migration.

### 7.2 Four things the first real run found, and no test could

The assets were complete, CI was green on both halves, and `dagster definitions validate` passed.
Then the first bounded run against production (50 securities, partition 2026-09-09) reported
**SUCCESS**, wrote a 176-byte Parquet file and zero rows. Each finding below was invisible until
something was driven.

| Finding | Why nothing saw it |
|---|---|
| **openbb could not import in the image.** It rebuilds its extension map *inside* `site-packages`, and the container runs as uid 10001 against a root-owned tree, so every call raised `PermissionError`. | The unit tests drive a **fake hub** — deliberately, so the suite needs no 250 MB of AGPL code. That is exactly what makes the image the only place the real one is exercised. Built at image-build time now, guarded by importing it **as the runtime user**. |
| **The hub had providers and no routers.** A provider supplies the data (`openbb-yfinance`); a *router* supplies the namespace (`openbb-equity`). With providers alone the hub imports perfectly and every call dies on `'App' object has no attribute 'equity'`. The built package held eleven modules, all `economy*`/`fixedincome*`, arrived transitively. | `ROUTES` was a control table advertising work nothing could do. Guarded now by resolving **every** route against the real hub in the image: 26/26. |
| **`ingest_rw` could not write a single `market` table.** 83 tables have RLS with a permissive SELECT policy and **none** permitting INSERT. None ever needed one: the only writer was `service_role`, which holds BYPASSRLS. | `every-table-is-reachable` asks `has_table_privilege` — a question about **grants**, which were correct. RLS is a second, independent gate the grant cannot see. This is CLAUDE.md's "verify RLS by behaviour" from the other side, where the flag being *right* is what hid it. |
| **And the asset reported all of that as `empty: 50`.** Fifty securities recorded as having answered nothing, when we had never asked one of them. | The thirty-first instance of the failed-versus-empty shape this rework exists to remove — and the first authored *by* the rework. `mark_absent` still refused to mark anything, so the blast radius was a wasted run; the counter was lying either way. `transport` is now its own outcome. |

**The pattern is one thing, and it is the phase's own thesis.** Every one of these was a gauge
reading green while the thing it measured was broken — and every one became obvious the moment a
number was read off a real run. The instrumentation the design argues for is what turned a silent
success into four named defects in an afternoon.

**Cost, stated plainly:** the third of these needed a migration, so D1's "one deploy" became two.
The plan said a correction found during the build-out would cost exactly that, and it did.

## 8. Verification

* **Parity**, the gate for D2: 200 securities sampled by fund weight — `price_bar` vs
  `security_price` row counts per year and closes per date; `security_return` vs `performance` per
  period within 0.01 pp.
* **Cost**: a full Lane A run reports ~545 calls and does not grow with the window; `ingest.attempt`
  shows zero throttles over 7 days.
* **Latency**: `check_anon_read_latency.py` best-of-three on `price_series` filtered by symbol AND
  grain — the conjunction that timed out at 2,993 ms before migration 80's matview.
* **Size**: `pg_total_relation_size` before and after, measured rather than projected.
* **Dagster**: a deliberately failed check blocks `security_return`; a killed run leaves an open
  `ingest.attempt` and fires the dead-run alert, proven by killing one.

## 8.1 Parity result — bars, 2026-09-11

Ten daily partitions × 100 securities by fund weight, compared on `(security_id, trade_date)` at a
**1e-6 relative tolerance** rather than equality. Both tables hold float32 from the same provider, so
one value reads as `1010.26000976562` through one path and `1010.260009765625` through the other;
comparing exactly reported 36 of 48 as disagreeing when almost all agreed.

| | |
|---|---|
| compared | **602** pairs |
| agree | **586 — 97.34 %** |
| disagree | 16 — 2.66 % |
| rows the OLD table has no bar for at all | **91** |

**All 16 disagreements were adjudicated against the provider, and all 16 support the NEW value.**
Zero for the old pipeline. That is the opposite of what a cutover usually has to defend, so the
16 were examined further rather than banked — and they split cleanly into two causes:

* **The old value is an intraday capture** (4 of 7 examined). It sits INSIDE that session's own
  high/low — BHP.AX `62.78` within `62.12–63.92`, Samsung `266,250` within `263,500–270,500` — so
  it is a price that really traded, written while the market was still open. All on 2026-09-10, all
  Asia-Pacific, whose sessions close early in UTC. This is the same partial-bar defect the new
  pipeline was given a window filter to avoid, present in the old one and evidenced rather than
  inferred.
* **The provider's own bar is degenerate** (3 of 7). `low == high == close` for SQM-B.SN (65450),
  CHILE.SN (188.5) and QIBK.QA (21.60) — the padded-series signature this codebase already records
  for illiquid sessions. The new value is faithful to the provider, but *matching the provider* is a
  weaker claim when the provider reports a flat bar, and it is recorded as weaker rather than
  counted as a win.

**A hypothesis raised earlier and now WITHDRAWN.** QIBK.QA holds 2026-09-10's close against 09-09,
and a systematic date shift was inferred from it. Across ~180 sampled pairs in three samples there
are **zero** shifts. It was one instance.

**And a measurement retracted.** A baseline sample of Gulf and Latin American holdings first read
48 % "unanswered" — an artefact of asking with the DISPLAY symbol. `ALMARAI.SR` is what the app
shows; yfinance wants `2280.SR`. Asked with the fetch symbol the same population reads **85 %
agreeing**, against **95 %** for top-weight names — where display and provider symbol are usually
identical, which is exactly why the weight-ordered sample never showed the bug.

**The bars gate is met**: every disagreement is explained. **Returns parity remains a second gate**
and is written with the `security_return` asset.

## 8.2 Parity result — returns, 2026-09-11

The second gate, and it does **not** reduce to a percentage. It splits into a question we can decide
and a question we cannot, and saying which is which is the result.

### The decidable half: our returns are right given our bars

Every stored `price_return_pct` was recomputed **in SQL**, from `market.price_bar`, independently of
the Python that wrote it:

| | |
|---|---|
| compared | **653** |
| agree | **653** (100%) |
| worst difference | **0.000000 pp** |

Two independent implementations of the same rules over the same bars, agreeing to the last digit.
Combined with §8.1 — bars 97.34% agreement, and **all 16 disagreements adjudicated to the NEW
value** — the new layer is correct on its own terms.

### The undecidable half: `market.performance` cannot be reconstructed

A direct comparison reported 81% disagreement, and chasing it found three separate causes, none of
them a defect in the new layer:

1. **Ragged endpoints.** The old table's newest bar ranged across **09-09 (5,413 securities),
   09-10 (2,646) and 09-11 (586)** at one instant, because its backlog drains unevenly. Two
   snapshots taken at different moments cannot produce a stable number, and re-measuring after the
   old cron ran flipped the offset's *direction*.
2. **Intraday capture, confirmed exactly.** SCCO: our 09-10 close is 194.14 and the old layer
   published `1d = +1.4732`, implying a latest of **197.00**; its `1w = -0.8855` over our 09-04
   close of 198.76 implies **197.00** as well. Two independent equations, one answer — the old
   resource refreshes eight times a day and priced a US name mid-session. A "1-day return" measured
   to a mid-session quote is not a daily return, and a Dagster partition cannot materialise before
   its window closes, so our refusing to publish that number is the correct behaviour.
3. **A residual that is NOT attributed, and is stated as such.** Solving the old `1d` for the price
   it must have used does *not* reproduce its other periods for most securities. The old resource
   **re-fetches its own history at refresh time and does not store it**, so its inputs no longer
   exist and the difference cannot be traced further. That is a property of what is being retired,
   not a finding about what replaces it — and it is the sharpest argument for the new design, where
   raw is kept as Parquet and any published number can be re-derived from the bytes it came from.

**So the gate is passed on the decidable half and closed as unanswerable on the other.** "Matches
`market.performance`" was never the target: §8.1 had already shown the old table holding the next
day's close, and the old bars agree with ours exactly on every date they share.

### Two defects the gate found in the NEW layer, both shipped

Neither was visible to any test, because a fixture whose series ends today cannot tell the two rules
apart.

* **`as_of` was the run's date, not the last bar used.** A figure stamped 09-11 whose newest input
  was the 09-10 close. Fixed to the last bar; that is what made the offset visible at all.
* **Windows were anchored on wall-clock `now` while the value came from the last bar**, so the same
  bars produced different numbers depending on the day the job ran. **21% of the adjudicated
  disagreements were reproduced exactly** by recomputing over our unchanged bars with the last bar
  as the basis. `now` keeps one job — staleness — because only a clock can say whether a series is
  still being updated.

## 8.3 Three failures between the fix and the data, each one stage past the last

The history backfill took four attempts, and the shape is worth keeping: **every failure was at a
seam the previous fix had not looked at, and each one had already been paid for by the provider.**

| Attempt | Failed at | Cause |
|---|---|---|
| 1 | the write | `UPathIOManager` refuses a multi-partition output |
| 2 | the load | `load_input` returns a `{key: obj}` mapping the input type-check rejects |
| 3 | the clean stage | OOM at **2.4 GB** — 96 securities is **683,391 bars**, and `load_input` is eager |
| 4 | the upsert | **65,535** bind parameters is a protocol ceiling; 25 securities is 1.4 M |

Then it ran: **683,391 rows, 96 securities, back to 1970-01-02**, in four runs of ~30 s.

Attempt 3 also corrected a claim in this document. `single_run` was chosen for Lane B partly because
a multi-run policy "turns ten calls into ninety-six" — which is **false for this provider**, and the
fact was already written in `openbb.py`: `yf.download(..., threads=False)` asks the vendor once per
symbol whatever a run covers. Joining symbols collapses *our* call count, never theirs. So the
partition **axis** decides the policy: a date partition batches many securities and keeps
`single_run`; a subject partition has nothing to batch across, and its run width is a **memory
budget** — `multi_run(25)`, making the full 10,894-security load ~436 runs rather than one that
cannot finish.

## 8.4 FX — the same two lanes, and four things only a real run could say

Built on the standard rather than beside it: a DAILY cross-section that claims completeness, and a
per-CURRENCY history whose subject is the slice. Forty-three currencies is small enough that one
lane would work; building it the other way would make the standard something that holds only when
convenient. What genuinely differs is the two parts carrying the domain — the plausibility band, and
subunits being DERIVED rather than fetched.

Yahoo's chart endpoint is called **directly**, not through the hub: openbb has no keyless FX pair
endpoint, and the ECB's free reference rates cover **27 of the 43** currencies here — missing TWD
(535 Taiwanese securities), VND, AED, SAR, QAR, KWD, PEN, CLP, COP, ARS and GEL.

| Found by | What |
|---|---|
| a capture | An unknown pair is **HTTP 404** carrying `{"code":"Not Found","description":"No data found…"}`. The provider raised on every non-200, so each unquoted currency read as a *transport* failure — and since a transport failure must never mark a subject absent, the negative cache could never fill. |
| the first run | `source_code` is a foreign key and `yahoo` was not seeded, so the whole write failed **after** all 38 currencies had answered. Settled as `yfinance`: `data_source` names the vendor, and all 22,236 pre-existing rows say so. |
| the second run | The 09-10 partition wrote **42 rates dated 09-11** — a five-day range is requested so the partition's day is certainly inside it, and the asset took the *newest* point instead of its own. |
| the third run | `outside_window=190` — 38 currencies × 5 points, **every one discarded**, writing nothing while reporting success. |

That last one is the finding worth carrying. Two facts live only in the response's `meta` block:

* **A daily FX bar is stamped at the session's OPEN in the exchange's timezone.**
  `exchangeTimezoneName` is `Europe/London`, `gmtoffset` 3600 — the 2026-09-10 session arrives as
  `1788994800`, i.e. **2026-09-09T23:00Z**. A UTC `.date()` dates every bar a day early.
* **The last point is often a LIVE QUOTE, not a bar**, and it is exactly identifiable: its timestamp
  *equals* `regularMarketTime`, measured to the second on three separate series. `GELUSD=X` is the
  extreme — its only point is the live quote, so Yahoo has **no completed weekly bar for the lari at
  all**, which is far more precise than "it returned one row" and is what the negative cache needs.

**The price lane does NOT share the date defect, and I asserted that it did before checking.**
Measured against the old table on exactly the timezone-exposed venues: HK 540/540, TW 542/542,
SG 554/554, TH 272/272, ID 532/532, KR 532/534, AU 558/560 — same-date agreement is something a
one-day shift makes impossible. openbb's adapter hands back a normalised date; the raw endpoint does
not.

### Verified in production

```
spot, 2026-09-10:  calls=38 answered=38 empty=0 transport=0
                   outside_window=114  live_dropped=38  nulls_dropped=38  ->  41 rows
history:           39 currencies, 21,443 rows (19,874 observed + 1,569 derived)
```

| Invariant | Result |
|---|---|
| a subunit has its parent's full depth | ILA 849 / ILS 849 · ZAC 851 / ZAR 851 · KWF 846 / KWD 846 |
| a derived rate is exactly parent ÷ divisor | **849/849, 851/851, 846/846** within 1e-12 |
| nothing implausible was ever admitted | **0** of 34,848 rows outside the band |

## 8.5 Index returns — and the fourth place a date came from the wrong source

The last of the family. **Country (45)** and **group (17)** scopes are backed by a proxy ETF, so
their returns go through `derive/returns` — the *same* rules a security's use, so a country page and
a stock page cannot disagree about what "3-month return" means. **Sector (11)** has no ETF; finviz
publishes the numbers directly.

Two things settled by measurement rather than assumption:

* `equity/price/historical` serves an ETF **identically** to `etf/historical` — same 16 rows, same
  closes, on the same symbols and window. One call site is only worth having if the answers match.
* The proxy symbol is **not copied**. `countries.etf_symbol` and `classification_groups.etf` already
  hold it; `index_scope.proxy_symbol` stays an editorial override. A group is keyed
  `group:<scheme>:<id>` because a group id is **not** unique across schemes — MSCI and FTSE both
  have `developed`, backed by URTH and VEA.

### Verified in production

```
raw_index_bars    calls=3  answered=61/61  empty=0  transport=0  outside_window=52  bars=79,666
raw_sector_perf   groups=11  rows=77  warnings=0  taken=2026-09-11
index_return      scopes=61  with_returns=61  periods=549  unmapped_labels=0  rows=626
```

`country` 44 of 45 — Colombia's `GXG` is `tracked_fund.enabled = false`, the documented
liquidated-fund exclusion, so that is correct rather than missing.

### Two defects, and one guard that was worse than the defect

**A symbol backs more than one scope, and a dict comprehension keeps the last.** 62 scopes over
**53 distinct symbols** — `EEM` backs three, `IVV` backs three including `country:US` — so nine
scopes silently got no returns. The run said `answered=52` beside `empty=0`, two numbers that cannot
both be right, and that was the only trace. Those scopes genuinely *are* the same index: the
relation is many-to-one and has to be stored as one.

**A snapshot cannot be backfilled.** finviz answers "as of now" and carries no date, so running the
09-10 partition on 09-11 stored today's numbers under yesterday. The first fix was a guard refusing
a closed window — and it could never have collected anything, because `end_offset` is 0 so the
newest *materialisable* partition is always yesterday and today is always outside it. It would have
run for ever collecting nothing while reporting success. **A guard that can only ever refuse is
worse than the defect it replaces**, and only working out what it would do in production caught it;
the test used a deliberately-closed window and passed for the same reason the real thing would have
failed. The asset is unpartitioned now, and `as_of` travels with the data.

### The rule all four date defects share

| # | Wrong source | Effect |
|---|---|---|
| 1 | the clock (`date.today()`) | a figure claimed current whose newest input is days old |
| 2 | the window's anchor | the same bars give different numbers on different days |
| 3 | a partition key, for a source with no dates | today's snapshot stamped with a past day |
| 4 | the **top** of a lookback series | today's in-progress bar becomes the newest close |

**The date travels with the data.** Stamp from the last input actually used; anchor windows on the
data; cut a series at *both* ends of the window; and where a source genuinely has no date, record
when it was **read**, in the raw artifact, so nothing downstream invents one. The first three were
all at the bottom of a window, which is exactly why the fourth was not looked for.

### Parity, and why it closes the same way as §8.2

| scope | n | ≤1pp | median | same-day |
|---|---|---|---|---|
| country | 395 | 203 | 0.99pp | **0** |
| group | 153 | 70 | 1.16pp | **0** |
| sector | 77 | 36 | 1.34pp | 77 |

`same-day 0` is the finding: the old table is dated 09-11 because it prices **intraday**, ours 09-10
because a partition cannot close before its window does. The sector rows *are* same-day and still
1.34pp apart — both sides read finviz, at different moments of a moving number. The old layer is a
moving intraday snapshot and cannot be a stable baseline, which §8.2 established and this confirms
on a second, independent scope.

## 9. Risks

* **polars/pyarrow on arm64** — verify the wheel and the image-size delta on the first image roll;
  fallback is `UPathIOManager` over `pyarrow`.
* **An image roll a deploy reverts** — measured as *not* a risk today, because `image_ingest` is
  `:latest` in all three places that set it, so a deploy converges on what the roll pulled. It
  becomes a risk the moment anyone pins that tag to a sha. Re-checked by rolling an image and then
  running `mode=plan` to see no proposed change.
* **Vendor pacing is per symbol, not per call.** A budget in calls/s is 20× looser than it reads.
* **10,894 dynamic partition keys** — under the documented ≤100,000, but `get_partition_keys()` is
  index-scanned per range resolution. Measure the asset page and a one-key materialisation; the
  fallback is Lane B unpartitioned over the ledger.
* **The 29-year load** is ~10 GB in and ~10 GB out on a node whose failure mode is resource
  exhaustion — chunked, bounded, off-hours, `COPY`, resumable, and gated on the measured
  bytes-per-row rather than the estimate.
* **A writable raw volume is new surface.** `DAGSTER_HOME` is read-only for a reason; the raw mount
  is separate, on `/mnt/data`, and nothing but the I/O manager writes it.
* **Freshness policies are recent API surface** in the pinned 1.11–1.13 range; the fallback is
  `build_last_update_freshness_checks`.

## 10. Out of scope

Families 3–7; the containerd root move; Loki; paid providers; agent access to market data.
