# Durable market-data ingestion — design

**Status: APPROVED 2026-09-09.** Written after a full read of the code, docs, the live database,
the node, Grafana and GitHub. Every number here was measured against production, not estimated.

Supersedes nothing; it is the first design covering ingestion as a whole. How the CURRENT system
works is [docs/data-ingestion.md](../../data-ingestion.md); what it holds is
[docs/data-coverage.md](../../data-coverage.md). Both stay authoritative until each family is
migrated, and each cutover updates them.

## 1. Context — why this rework

Muffin's market data (the `market` schema that the Expo app reads) is ingested by **one 7,891-line
Deno edge function** dispatching **54 resources** through a 50-branch if-chain, run as a fresh
256 MB / 90 s worker per request inside a 512 MB `supabase-functions` container. pg_cron fires it
over HTTP through Kong (a 5-minute rotation of 41 resources plus 12 dedicated jobs). All state is in
Postgres: a `refresh_log` mutex, **38 `pending_*` views** acting as work queues, **21
`%_missing_at`** negative-cache columns and 8 cursors bolted onto `market.security`. The function
reaches Postgres only through PostgREST (1,000-row cap, 8 s RPC timeout). Providers are reached
through an OpenResty cache; yfinance goes through the self-hosted `openbb-api` hop, which turns a
rate limit into an empty 204. The UI reads 35 views as `anon` (3 s timeout). The LangGraph agent
reads none of it — the pipeline serves the UI only.

It works, but every structural constraint of the runtime has been re-discovered as a bug family
(CLAUDE.md records ~30 instances of "a request that failed vs one that answered nothing", six
head-of-line stalls, four anon-timeout incidents, five "verify the mutation applied" traps). The
user's ask: **a durable, stable, robust ingestion for the whole stock universe**, willing to invest
now for a better long-term solution rather than keep everything custom.

### 1.1 Live defects found during exploration (2026-09-09, none previously recorded)

| Finding | Evidence |
|---|---|
| Edge-runtime container OOM-killed ~every 3-5 h | kernel log: kills at 07:24, 10:02, 12:25, 17:12 UTC, `anon-rss` ~520 MB each; RSS creeps ~1 MB/min after restart (402 MB at +82 min, 417 MB at +95 min). Each kill loses in-flight runs with no record. |
| `security-cn-segments` dies on every invocation since 09-07 17:05 | `refresh_log`: started 15:45 today, `finished_at` null; zero `refresh_run` rows in 48 h; rotation slot 39 fires it every ~205 min; permanent head-of-line block (same class as the AEP 128 MB filing). |
| Root disk 93% | `/` 41 G of 45 G: 27 GB `/var/lib/containerd` + 7.6 GB stale `/var/lib/docker`; next image pull can fail a deploy. (`/mnt/data` 27% of 98 GB.) |
| Postgres on defaults | `shared_buffers` 128 MB for an 11 GB DB; heap hit 27% `security_metric`, 51% `security_statement`, 85% `security_price`; 3.4 TB read from disk since July; container 1.5 GB limit, 246 MB used. |
| `security_price` is 82% index | 6.65 GB total, 1.2 GB heap, 5.45 GB indexes; `security_price_grain_date_idx (security_id, grain, date desc)` duplicates the PK `(security_id, grain, date)` — 1.5 GB of waste. |
| Alerts fire into a void | 6 of 12 Grafana rules active (oldest since 08-28, 12 days); `market-verify` red 5 of the last 8 days. SMTP works; nobody acts. |
| Throughput below the universe | `pending_prices` +768/day (8,520 deep), `pending_performance` +240/day (8,156) — daily prices cannot keep up with 12,350 equities on the shared yfinance budget; `pending_segments` 192,625 with a 483-day ETA. |
| Resources at the cliff | statements 70 s, kr-segments 66 s, performance 59-61 s, insider 52 s, price-targets 47-60 s of a 90 s worker. |
| Deploys heavy and disruptive | 25-40 min each, 6/day this week (30 PRs in 5 days); all 203 migrations re-run every deploy; readers hit dropped views (`permission denied for view pending_segments` in `refresh_run` today). |
| Double scheduling | `security-in-segments` has its own pg_cron job AND sits in the rotation (skips); `security-cn-segments` only in the rotation. `security-eps-history` unscheduled since 08-28. |

### 1.2 Root causes

1. **Execution-model mismatch.** Batch ingestion (long, memory-heavy, rate-limited, stateful across
   pages) inside a request/response FaaS: every resource is paged to 90 s; a dead worker is silent;
   36 hand-rolled deadlines; the mutex/TTL dance; the "bare 502".
2. **No shared provider limiter.** ~15 resources share yfinance with no token bucket; the rotation's
   "one resource per 5 min" is the only throttle — it starves throughput AND still trips limits.
3. **Work queue by view.** 38 predicates + 21 columns + cursors, no per-item attempt history, so
   "never asked" / "asked, empty" / "asked, failed" / "throttled" keep being confused.
4. **Provider quirks handled ad hoc** in one file, guarded by 293 source-code greps
   (`logic-check.ts`).
5. **Deploy = re-apply 203 migrations** (25-40 min), dropping/recreating views mid-deploy.
6. **Serving layer entangled with raw tables**: a heavy view is an app outage (3 s anon timeout).
7. **Observability without action**: good sampling, but killed workers invisible, no logs shipped,
   no per-provider budget, alerts ignored.

## 2. Decisions (settled with the user in this session)

| Topic | Decision |
|---|---|
| Runtime | **Python ingestion library + task ledger in Postgres + Dagster OSS** (webserver, daemon, one code-location container) on the existing node. Runs are subprocesses in the code-location container. **Never model securities as Dagster partitions** — an asset is a table; the ledger is the per-security grain. |
| Why Dagster over Prefect | Asset checks (OSS) = the 39 verify assertions + 10 defect predicates, visible and blocking; declarative asset graph + `AutomationCondition.eager()` replaces cron-offset choreography (metrics :24/:54, facets :14, spine as 2nd RPC); freshness policies/checks per served table; per-provider concurrency **pools** serialise provider access so an in-process token bucket is correct; asset-centric UI answers "is this table healthy". Cost: ~1.5 GB, an event-log cleanup job. Prefect's native slot-decay limiter and ~0.5 GB saving weighed less. |
| Data model | **Incremental normalisation beside the live schema**: new `ingest` schema (ledger), fiscal-period dimension, retire `instruments`/`prices` overlay, serving `api` schema; migrated facet by facet. |
| Sequencing | **Stabilise first (Phase 0), then migrate by family**, disabling the old resource per resource as each lands. |
| Migrations | **Supabase CLI + declarative schemas** — SHIPPED, see §7. `supabase db push` applies only what `supabase_migrations.schema_migrations` says is pending; `schemas/` is the declared source of truth and a view changes only when its definition does; `always/` carries the two files that must re-run every deploy. `market.one_shot` is KEPT: apply-once by construction, it now genuinely runs once. |
| Providers | **Free only for now.** OpenBB stays the hub but is **imported as a library in-process**, not called over HTTP (§2.2 Q5); direct adapters for the rest, as today. A new provider = one adapter module + control rows; paid bulk providers later without redesign. |
| Licence | `muffin-ingest` is **AGPL-3.0**, because `openbb-core` is AGPL-3.0 and is imported. Every other submodule stays GPLv3 (`langchain-opensandbox` MIT). A line in its README and in the umbrella's Conventions section. |
| Alerting | **Grafana email is the single path.** Grafana reads the ledger and Dagster's tables. `market-verify.yml` (anon-key end-to-end) stays. |
| Agent access | Out of scope (UI-only consumer). |

### 2.1 Constraints and open decisions inherited from `todos.md` / `docs/data-coverage.md`

Read in full (2026-09-09). These are carried into the design rather than rediscovered:

| Recorded item | Where it lands in this plan |
|---|---|
| **Point-in-time is an open decision**: "add `observed_at` to `security_metric` now, or accept that every restatement until then is lost permanently — cheap today, irrecoverable retroactively" (HTTP-cache deferred scope; data-coverage Tier 3 #10; P1 "Develop point in time analysis") | **Decided here: Phase 1 adds `observed_at` (and `superseded_at`) to `security_metric`, `security_statement`, `security_segment`, `security_fundamentals`; writers never overwrite a differing value, they append.** The serving views keep choosing the latest, so nothing user-visible changes; an as-of lens becomes possible later. |
| **Launch TTLs already decided**: sector/country/group performance 30-60 min, instrument performance 60 min, prices 24 h, profile 24 h, holdings 7 d, tickers 10 min ("Market data TTLs, revisit at launch") | Seed values of `ingest.facet.ttl`; the app's `stale_after` derives from the facet TTL, so a TTL change is a row, not a deploy. |
| **Bars are ALREADY split-adjusted** (`splits_only` default; NFLX 10-for-1 smooth); a back-adjustment pass "would have corrupted the data" | The prices facet keeps `splits_only`, keeps `firstComparableIndex`'s discontinuity guard (redenominations, OTC ratio changes), and **never back-adjusts**. Total return via `include_actions` stays as shipped. |
| "Historical data doesn't need refresh, we only need to pull latest data" (P1 item on what `market-refresh` pulls) | `ingest.task.watermark`: full history is fetched once per (security, grain); every later attempt asks from the newest stored bar. |
| CN: "the heading list is a constant in `cn-pdf.ts` and should become a control table when a second format is added" | `market.cn_segment_heading` control table seeded from `CN_TABLES` when the CNINFO parser is ported (family 6). |
| Statements: one security per call, ~12.5% real coverage; `security-refresh` covers what a user opens | The `yfinance` pool + on-demand `refresh_security` job at priority 1000 keep that behaviour; the ledger's `priority` is what makes "what a user opened" jump the queue. |
| Promotion is a product call ("decide which catalogued funds to TRACK"; opt-in venues) | Unchanged: `tracked_fund` and `exchange.promotion_enabled` stay the control surface; `population_sql` reads them. |
| Symbol renames: "the identifier model tolerates a rename, nothing detects one" | Deferred; `filer_profile.tickers` (SEC) and `security_former_name` are the inputs when it is built — recorded, not planned here. |
| `pending_segments` defined by SIX migrations and dropped/recreated on every deploy | Exactly what the repeatable bundle (section 7) ends: one definition, one transaction. |
| Observability deferred scope: per-request tracing, PostHog, openbb-api's own egress | Tracing and PostHog stay out of scope; the worker's own provider counters close the openbb-egress blind spot for ingestion calls only. |
| OpenBB upstream bugs (N-PORT 500, Alpha Vantage 204, no ISIN resolution, serialised requests) | Why `sec`, `openfigi`, `alphavantage`, `yahoo` are direct adapters; the `openbb` pool is limit 1 because openbb-api serialises anyway. |

### 2.2 Design questions raised in review, answered

**Q1. Why direct SQL (psycopg) instead of Supabase's SDK?** The Supabase SDK (`supabase-py`) is a
client for PostgREST over HTTP — the right tool for the UI (anon key, RLS, 3 s timeout), and the
layer that caused four recorded defect families in the current pipeline: `PGRST_DB_MAX_ROWS=1000`
silently truncating (four incidents), an RPC being ONE statement under the `authenticator` role's
8 s `statement_timeout` (`sample_backlogs` died at 8,068 ms; `derive_ttm` cancelled at 400
securities), a new table invisible until PostgREST reloads its schema cache (`PGRST205`), and
numeric-through-JSON precision (the `z.coerce` guard). A server-side batch worker on the same
private overlay needs what only a database connection gives: transactions spanning claim → write →
complete, `for update skip locked`, `COPY`/multi-row upserts, `on conflict` on partial indexes, a
dedicated role (`ingest_rw`) with its own 120 s statement timeout, and a connection pool. Dagster's
own storage connects the same way (there is no PostgREST option for it). Supabase's guidance for
server-side workers is likewise a direct or pooled Postgres connection. PostgREST remains the read
path for muffin-ui, unchanged.

**Q2. Do we have to build the ledger, or does Dagster manage ingestion state out of the box?**
Dagster manages everything at RUN and ASSET level, and the plan uses it for all of that instead of
the old custom tables. What it does not model is per-ITEM state — which of 12,350 securities × ~40
facets is due, absent, throttled or leased — because its only per-item primitive is partitions,
bounded at ~25k per asset (UI slows from ~10k) and meant for time windows. That per-item ledger is
the irreducible custom part, and it is deliberately small: three tables and six functions.

| Concern | Old system (custom) | New: Dagster OOTB | New: ours |
|---|---|---|---|
| Scheduling, rotation, pacing | `cron_tick`/`cron_resource`/`cron_cursor`, 12 pg_cron jobs | schedules, sensors, run queue, `max_concurrent_runs`, per-provider **pools** | — |
| Mutual exclusion per resource | `refresh_log` + `begin/finish_refresh` | pools (limit 1) + run queue | — |
| Run history, logs, durations | `refresh_run` (jsonb report) | runs, event log, step logs, asset materialisation metadata (plotted over time in the UI) | one summary row per run per facet in `ingest.attempt` (Grafana reads it; Dagster's internal tables are not a stable contract) |
| Dead run detection | none (a killed worker wrote nothing) | run monitoring (`max_runtime_seconds`, `run_monitoring`) | lease expiry (`reap()`) so the ITEMS a dead run held return to the queue |
| Data-quality guards | `data_defect` view + market-verify scripts | **asset checks** (blocking, severity, history) | the SQL of each check (ported) |
| Freshness per table | `resource_health`, TTL columns | **freshness policies / checks** | facet TTL row (drives both the ledger and the app's `stale_after`) |
| Derive-after-fetch choreography | cron offsets (:24/:54, :14) | `AutomationCondition.eager()` on derived assets | — |
| Re-run everything (parser version bump) | `segment_parser.version` + view predicates | backfill UI is partition-based, not used | `requeue_version()` |
| Per-security backlog, negative cache, cursor, priority, lease | 38 `pending_*` views, 21 `%_missing_at`, 8 cursors | — (partitions unsuitable) | `ingest.task`, `ingest.facet` |
| Provider quota / cooldown across runs | none | — | `ingest.provider_budget` (daily quota) |

**Q3. Which Python dependencies are planned?** Pinned with `uv`; each with its reason; nothing
else unless a facet needs it.

| Dependency | Why |
|---|---|
| `dagster`, `dagster-postgres`, `dagster-webserver` | orchestrator, its Postgres storage, UI |
| `psycopg[binary,pool]` (v3) | direct SQL, pool, `COPY`, pipeline mode (`dagster-postgres` brings psycopg2 for itself; two drivers is acceptable) |
| `httpx` | one HTTP client for the direct providers, timeouts, connection reuse through http-cache |
| `openbb-core` + only the extensions used (`openbb-yfinance`, `-finviz`, `-nasdaq`, `-fred`, `-oecd`, `-federal-reserve`, `-sec` if a route needs it) | the hub, **in-process** (§2.2 Q5). Never `openbb[all]` — that is the 1 GB image. AGPL-3.0; brings `pandas`, `aiohttp`, `fastapi`/`uvicorn` (unused but declared) |
| `pydantic` (v2) | typed records at the provider boundary (units, currency, period_type) |
| `pyrate-limiter` (v4, with `psycopg[pool]`) | per-provider rate limiting with multiple rates per key (per-second AND per-day) and a Postgres-backed bucket, so the limit holds across run subprocesses |
| `prometheus-client` | `/metrics` for the worker (requests, throttles, quota, rows written) |
| `structlog` | JSON logs with `run_id`/`facet`/`attempt_id` |
| `edgartools` (MIT) | **four SEC jobs, not one**: N-PORT fund portfolios (`investment_data()`), the submissions/filing index, Form 4 insider transactions, and XBRL company facts + filing instances with dimensions — so it replaces the transport half of `ingest.ts`, `edgar.ts`, `xbrl.ts` and the filings/insider fetchers. Brings `pandas`, `pyarrow`, `lxml` |
| `OpenDartReader` | DART listing and document fetch (replaces `dart.ts` transport; the ZIP/instance reading is ours) |
| `pdfplumber` | CNINFO PDF positional table extraction (replaces the hand-written PDF walker in `cn-pdf.ts`) |
| `lxml` | N-PORT and NSE XBRL parsing |
| dev: `ruff`, `mypy`, `pytest`, `testcontainers[postgres]`, `respx` (httpx mocking) | CI and fixtures; `testcontainers` also replaces the hand-rolled throwaway Postgres in `quality.yml`'s migration job |

Deliberately **not** dependencies: `yfinance` directly (it is reached through openbb, which is what
makes a provider swap a config change), `supabase-py` (Q1), `sqlalchemy` for our code, `dlt` (it
owns the schema and has no per-item backlog model), any XBRL library for DART/NSE beyond `lxml`
(the segment rules are ours).

**Q5. Why import the openbb library instead of calling `openbb-api` over HTTP?** Because the HTTP
layer is where this pipeline's most expensive defect class is manufactured. Measured and recorded:
Alpha Vantage answers an exhausted quota with `200 + Information` and openbb's REST hop collapses
that to an empty `204`, **byte-identical to "this symbol has no data"** — the exact confusion that
negative-cached ~8,300 securities in one afternoon; a throttled yfinance likewise arrives as an
empty 204 rather than as `YFRateLimitError`. In-process, the provider's warnings and exceptions
reach `classify()` intact, so `throttled` and `dead_symbol` are separable at the source instead of
by string-matching a flattened response. It also removes a measured bottleneck (`openbb-api`
serialises concurrent requests: three calls 5.53 s parallel vs 5.58 s serial) and 3 calls × ~1.9 s
per security of JSON round-trip. Costs, accepted deliberately: the import costs ~250 MB and ~2 s per
run subprocess (≤3 concurrent inside the worker's 2.5 GB, and net positive once the 1 GB `openbb-api`
service is retired); only the extensions actually used are installed; **`openbb-core` is AGPL-3.0**,
so `muffin-ingest` is AGPL-3.0. The **`openbb-mcp` service is untouched** — it serves the LangGraph
agent, which is a separate consumer — and `openbb-api` is retired only after the last family moves.
Providers openbb cannot serve stay direct adapters for the reasons already measured: no N-PORT
holdings route, no ISIN resolution, SEC statements annual-only, and DART's TLS needing the proxy.

**Q6. Is Dagster still the right choice now the design is concrete?** Yes. The custom residue is
the ledger (3 tables, 6 functions), the facet modules and provider adapters (business logic no
framework owns), and the SQL of the checks. Prefect would delete one dependency (`pyrate-limiter`,
~30 lines of configuration) and add back three custom things: a checks harness, per-table freshness,
and derive-after-fetch chaining. Dagster deletes those three plus the scaffolding of the 13
`check_*.py` scripts. Nothing else considered removes more — Airflow 3's assets are weaker and it is
heavier, Kestra is JVM, Temporal and Hatchet are durable-execution engines rather than data
orchestrators. The only thing that could reverse it is footprint: if the Dagster UI goes unused in
practice, Prefect's ~0.5 GB saving becomes the sole remaining argument.

**Q4. Is there an out-of-the-box Dagster capability for the rate limiter?** Only partly.
Dagster provides **concurrency** controls — pools (`pool=`, limit N, op or run granularity),
`tag_concurrency_limits`, `max_concurrent_runs` — which bound how many things run at once. It has no
requests-per-second or calls-per-day primitive (Dagster's own rate-limiting example is a pool of 1
plus sleeps in code; Prefect's slot decay is the primitive Dagster lacks). So the design is layered:
pools give "one run per provider at a time" (the anti-burst guarantee that replaces the rotation),
and **`pyrate-limiter`** — a library, not our code — gives the per-second and per-day rates on one
key with a Postgres-backed bucket, which is correct even if two runs ever touch a provider. Our
`limiter.py` shrinks to configuration: one `Limiter` per provider built from `provider_budget`
rows, plus the cooldown gate that `ledger.mark()` sets on a throttle.

## 3. Target architecture

```
                        ┌──────────────── Dagster OSS (3 services) ────────────────┐
 schedules / sensors ─► │ daemon ──► run queue ──► subprocess run in muffin-ingest │
 on-demand (UI) ──────► │ webserver (GraphQL + UI, behind Cloudflare Access)        │
                        └───────────────┬───────────────────────────────────────────┘
                                        │ imports
                    ┌───────────────────▼───────────────────┐
                    │ muffin_ingest (pure Python library)     │
                    │  providers/  http/  limiter  ledger     │
                    │  parsers/ (bounded subprocess)  facets/ │
                    │  derive/ (SQL functions, direct psycopg)│
                    └──────┬────────────────┬────────────────┘
        http-cache (OpenResty) │            │ direct SQL (no PostgREST)
   openbb LIB ▸ yfinance/finviz│      ┌─────▼──────────────────────────────┐
   SEC · OpenFIGI · Yahoo ·    │      │ Postgres (supabase-db)              │
   Tiingo · AlphaVantage ·     │      │  ingest.*  (task, attempt, facet,   │
   Wikidata · DART · CNINFO ·  │      │            provider_budget)         │
   NSE · FRED/OECD             │      │  market.*  (facts, control tables)  │
                               │      │  api.*     (serving views/matviews) │
                               │      │  dagster   (separate database)      │
                               │      └────────────┬───────────────────────┘
                                                   │ PostgREST (anon, 3 s)   ▲ Grafana (metrics_ro)
                                              muffin-ui                      Prometheus ◄ worker /metrics
```

**Principles, each mapped to where the rule lives (so "a rule at one call site is not a rule"):**

| Hard-won rule (CLAUDE.md) | Where it lives in the new design |
|---|---|
| failed ≠ empty ≠ throttled ≠ dead symbol | `Provider.classify(response) -> Outcome` per adapter, tested against captured payloads; `ledger.record()` refuses an untyped outcome. |
| Mark absent only when asked ALONE with the provider proven healthy | `ledger.mark_absent()` requires `attempt.isolated=True` and a control-symbol success in the same run — the only path that writes `status='absent'`. |
| Marking retracts stale rows | facet modules register a `retract(security_id)` callback; `ledger.mark_absent()` calls it. |
| Backlog = anti-join at the grain of work, must advance, breadth-first | one `ingest.task` row per (security, facet); claim = `... order by fair_rank, priority ... for update skip locked`; `fair_rank` = per-security round assigned at enqueue. |
| Symbol-keyed vs ISIN-keyed vs CIK-keyed negative caches | `ingest.facet.key_kind`; `ledger.invalidate(security_id, key_kind='symbol')` requeues only those facets. |
| `remaining` = backlog, not page | Dagster asset metadata reads `count(*) from ingest.task where facet=... and next_due_at<=now()`. |
| A killed worker leaves a record | `ingest.attempt` row written at START (Dagster run id); a "dead run" is an attempt with no finish past its timeout — an asset check + Grafana alert. |
| One dead symbol must not poison a batch | `providers.batch_with_isolation()` in the library, used by every batched facet. |
| Provider budgets shared | Dagster pool per provider (limit 1) + `pyrate-limiter` per provider (per-second and per-day, Postgres bucket) + `ingest.provider_budget` cooldown on a throttle. |
| A throttle must be distinguishable from an absence | openbb imported IN-PROCESS, so the provider's own exception/warning reaches `classify()` instead of being flattened to an empty 204 (§2.2 Q5). The string vocabularies remain as the second line of defence. |
| Units, currency, fiscal-year-end = annual AND Q4, dedupe before upsert | `facets/*` write through typed `pydantic` records with `currency` required on money and `period_type` in every key; `dedupe_by()` in the writer. |
| Parser rule that stops emitting must retract per accession | `parsers.xbrl.write_segments(accession, facts)` deletes-then-inserts per accession. |
| Segment partition rules (one partition, subtotal dropped, residual-only not served) | ported verbatim from `segments.ts` into `parsers/segments.py` with the 79 `segments-check.ts` assertions as pytest. |
| Serving views must survive deploys / anon 3 s | `api` schema built by the repeatable bundle in ONE transaction; matview refreshes are Dagster assets with measured duration; `check_anon_read_latency.py` unchanged. |

## 4. The ledger (`ingest` schema)

Replaces 38 `pending_*` views, 21 `%_missing_at` columns, 8 `*_fetched_at` cursors,
`backlog_negative_cache`, `symbol_cache_classification`, `refresh_log`, and (eventually)
`refresh_run`. Created by a versioned migration; per-facet backfill happens at each family's cutover.

```sql
create schema ingest;
create type ingest.task_status as enum ('due','leased','fresh','absent','backoff','disabled');
create type ingest.outcome as enum ('answered','empty','throttled','dead_subject','unsupported_venue',
                                     'transport','parser_killed','lease_expired','skipped_cooldown');
create type ingest.key_kind as enum ('symbol','isin','figi','cik','corp_code','nse_symbol','fund','currency','none');

create table ingest.provider_budget (      -- shared per-provider rate + daily quota + cooldown
  provider_code text primary key, rate_per_sec numeric not null, burst int not null default 1,
  daily_quota int, used_today int not null default 0, quota_day date not null default current_date,
  cooldown_until timestamptz, cooldown interval not null default '15 minutes',
  control_subject text, enabled boolean not null default true);

create table ingest.facet (                -- CONTROL TABLE: a new facet is a row
  facet text primary key, family text not null, asset text not null,   -- asset = Dagster asset / table
  provider_code text not null references ingest.provider_budget,
  key_kind ingest.key_kind not null,
  grain text not null check (grain in ('security','filing','global')),
  ttl interval not null, absent_ttl interval not null default '30 days',
  backoff interval not null default '1 hour', batch_size int not null default 20,
  page_size int not null default 200, control_subject text,
  population_sql text not null,   -- SELECT security_id, priority FROM …  (who OWES this facet; the anti-join source)
  retract_sql   text,             -- DELETE … WHERE security_id = $1     (what an absent mark must remove)
  old_resource text, old_missing_column text,   -- provenance for the cutover backfill
  enabled boolean not null default false);

create table ingest.task (
  facet text not null references ingest.facet,
  subject text not null,                    -- security_id | security_id:accession | 'global'
  security_id uuid references market.security on delete cascade,
  status ingest.task_status not null default 'due',
  priority numeric not null default 0,      -- fund weight; on-demand = 1000
  round smallint not null default 1,        -- ASSIGNED AT ENQUEUE, never recomputed (migration 189's lesson)
  next_due_at timestamptz not null default now(), attempts int not null default 0,
  last_asked_at timestamptz, last_answered_at timestamptz,
  asked_with text,                          -- the exact key used (BRK-B, US0378331005, 320193)
  last_outcome ingest.outcome, last_error_class text, last_error text,
  version int not null default 0, watermark date,   -- parser version / price cursor
  lease_id uuid, lease_expires_at timestamptz, run_id text,
  updated_at timestamptz not null default now(),
  primary key (facet, subject));
create index task_claim_idx    on ingest.task (facet, round, priority desc, subject) where status in ('due','backoff');
create index task_due_idx      on ingest.task (facet, next_due_at)                   where status in ('due','backoff');
create index task_security_idx on ingest.task (security_id);
create index task_lease_idx    on ingest.task (lease_expires_at)                     where status = 'leased';

create table ingest.attempt (              -- APPEND-ONLY, one row per provider call; a killed run leaves this row
  attempt_id bigserial primary key, run_id text not null, facet text not null, provider_code text not null,
  started_at timestamptz not null default now(), finished_at timestamptz, duration_ms int, http_status int,
  subjects int not null, asked_with text[], isolated boolean not null default false,
  outcome ingest.outcome, error_class text, error text,
  answered int default 0, empty int default 0, dead int default 0, rows_written int default 0, rows_retracted int default 0);
create index attempt_facet_idx on ingest.attempt (facet, started_at desc);
create index attempt_open_idx  on ingest.attempt (started_at) where finished_at is null;   -- the DEAD-RUN alert
```

Functions (`security definer`, owned by `postgres`, executable by the new `ingest_rw` role — the
only writer; facet modules never touch `ingest.task` directly):

- `ingest.sync_population(facet)` — inserts `due` tasks for subjects in `population_sql` not yet in
  the ledger (the anti-join at the grain of the work). Run by every asset before claiming, so a
  backlog is always `count(*) where status='due'`, never a page.
- `ingest.reap()` — runs at the start of every claim: `leased` rows past `lease_expires_at` →
  `backoff` with `last_outcome='lease_expired'`; open `attempt` rows of that run get
  `finished_at=now(), outcome='lease_expired'`. **This is how a killed run leaves a record.**
- `ingest.claim(facet, limit, lease, run_id)` — `… where status in ('due','backoff') and
  next_due_at <= now() order by round, priority desc, subject limit … for update skip locked`, then
  `status='leased', attempts+1, last_asked_at`. Breadth-first is structural: `round` is stored per
  subject at enqueue (security grain: 1; filing grain: `1 + count(*)` of that company's existing
  tasks, annuals first), so a draining queue cannot renumber.
- `ingest.complete(facet, subject, outcome, asked_with, rows_written, watermark)` — `answered` →
  `fresh`, `next_due_at = now()+ttl`; `throttled`/`transport` → `backoff`, never `absent`.
- `ingest.mark_absent(facet, subject, asked_with)` — the ONLY path to `absent`; sets
  `next_due_at = now()+absent_ttl` and executes `facet.retract_sql` (marking retracts).
  `ledger.py` calls it only when the attempt was `isolated` AND the control subject answered.
- `ingest.requeue_symbol_keyed(security_id)` — replaces `clear_symbol_caches`: requeues `absent`
  tasks of facets with `key_kind='symbol'` only; fired by a trigger on provider-symbol changes.
- `ingest.requeue_version(facet, version)` — the `segment_parser.version` bump path.
- `ingest.spend(provider, n) → boolean` — atomic daily-quota check (Alpha Vantage 25/day) and
  cooldown gate.

**Cutover backfill per facet** (`ingest.seed_facet(facet)`, called from the family's versioned
migration): from `population_sql`, insert tasks with `status='absent', next_due_at =
<old_missing_column> + absent_ttl` where the old column is set, else `due`; `watermark` from the
old cursor. In the same migration the family's `pending_*` views are **redefined over the ledger**
(`select … from ingest.task where facet=… and status='due'`) so `sample_backlogs`, `backlog_drain`
and the Grafana panels keep working unchanged; the `%_missing_at` columns are dropped. The
compatibility views, `backlog_negative_cache` and `symbol_cache_classification` are deleted in the
final phase once Grafana reads `ingest.*` directly.

Cursor-style facets (filings, insider, news, price targets, earnings): same rows, short `ttl`, no
`absent`. Discovery sweeps (exchange listings, DART/CNINFO/NSE windows) keep their own small cursor
tables — they are not per-security.

## 5. The library — new submodule `muffin-ingest`

New repo `gururafiki/muffin-ingest` (Python 3.13, `uv`, ruff/mypy/pytest, arm64 image →
`ghcr.io/gururafiki/muffin-ingest`, Tier-1 protection like `muffin-agent`), pinned by the umbrella
like the other eight. Chosen over living inside `muffin-deployment` because it is a real codebase
with its own tests and image, and the deployment repo must stay Terraform/Ansible/SQL.

```
src/muffin_ingest/
  config.py            settings from env (DB DSN, HTTP_CACHE_BASE, keys); origins as today
  http/client.py       ONE httpx client: base URL via http-cache, timeouts, retries, UA,
                       Prometheus counters (requests, 429, bytes, duration) by provider
  limiter.py           one pyrate-limiter Limiter per provider (per-second + per-day rates, Postgres bucket)
                       built from ingest.provider_budget; plus the cooldown gate set on a throttle
  ledger.py            claim / complete / mark_absent / defer / invalidate / enqueue (psycopg 3)
  providers/base.py    class Provider: name, batch_size, spell(security)->str, fetch(...),
                       classify(resp)->Outcome  (answered|empty|throttled|dead_symbol|unsupported|transport)
  providers/openbb.py  the hub, IN-PROCESS (`from openbb import obb`): route table is data, and the
                       provider's own warnings/exceptions reach classify() intact (§2.2 Q5)
  providers/{sec,openfigi,yahoo,tiingo,alphavantage,wikidata,dart,cninfo,nse}.py
                       sec.py wraps edgartools (N-PORT, submissions, Form 4, XBRL); the rest use httpx
  providers/isolation.py  batch_with_isolation(): batch → per-symbol → control symbol; returns dead[]
  parsers/nport.py     OUR rules over edgartools' portfolio rows: placeholder CUSIP, XX country,
                       assetCat typing, ISIN→CUSIP→FIGI resolution order, lot dedupe
  parsers/xbrl.py      edgartools instance parse + PORTED partition search from segments.ts
  parsers/dart.py, cninfo_pdf.py (pdfplumber), nse_xbrl.py
  parsers/sandbox.py   run a parser in a subprocess with RLIMIT_AS + wall-clock timeout
  facets/<facet>.py    fetch_page(claimed) → records → write() → outcomes  (one file per facet)
  derive/*.py          calls market.derive_* / refresh_* with explicit statement_timeout
  writers.py           typed pydantic rows, dedupe_by(conflict_key), COPY/upsert helpers
src/muffin_ingest_dagster/
  definitions.py       assets, checks, schedules, sensors, pools, resources
  assets/<family>.py
tests/                 pytest; fixtures = captured provider payloads (ported from *-check.ts)
```

Testing rules carried over: every classifier vocabulary tested on real payloads; a property test
that `throttled` and `dead_symbol` vocabularies share no term; the 79 segment assertions, 38 XBRL,
23 DART, 13 CN, 22 CN-PDF, 12 isolation checks ported to pytest; a ledger test that a page of one
over three securities reaches all three (the `a-queue-must-reach-every-company` lesson).

## 6. Dagster definitions

- **Assets = tables**, grouped by family: `universe` (fund_holding, exchange_listing, security,
  security_identifier), `symbols` (listing, security_provider_symbol), `prices` (security_price_daily,
  security_price_weekly, performance), `fundamentals` (security_fundamentals, security_share_stats,
  security_estimate, security_profile, security_officer, news, dividends), `sec` (cik map,
  security_statement, security_metric_xbrl, security_filing, insider_trade, security_segment),
  `regulators` (kr/in/cn filings + segments), `macro` (macro_observation, fx_rate, earnings, price
  targets), `derived` (security_metric, ttm, classifications, sic, segment classification),
  `serving` (security_facets, symbol_security, security_segment_spine, coverage_sample,
  universe_sample). Each materialisation = "drain up to N pages of the ledger within a budget",
  emitting metadata `{claimed, answered, empty, absent, throttled, remaining}`.
- **Pools** (dagster.yaml `concurrency.pools`): `yfinance`, `sec`, `openfigi`, `yahoo`, `tiingo`,
  `alphavantage`, `wikidata`, `dart`, `cninfo`, `nse`, `db-heavy` — each `limit: 1`. This is the
  rotation's pacing made explicit and enforced (one run per provider at a time); the per-second and
  per-day rates come from `pyrate-limiter` with a Postgres bucket (section 2.2, Q4), so they hold
  even across run subprocesses. `max_concurrent_runs: 3`.
- **Schedules** per family (prices every 30 min, SEC every 5 min, regulators every 15 min, macro
  6 h, universe daily); **AutomationCondition.eager()** on derived and serving assets so metrics/
  TTM/facets/spine/coverage recompute when an upstream materialises — no cron offsets.
- **Asset checks** (OSS): port the market-verify floors, `data_defect` predicates,
  `check_one_period_one_point`, `check_segments_reconcile`, `check_derived_metrics`,
  `check_quarter_is_a_quarter` as checks on their tables; blocking (`ERROR`) where a bad table must
  not feed `security_facets`/`coverage_sample`. **Freshness checks** per served table from the
  facet TTLs. A **dead-run check** on `ingest.attempt` (started, no finish past timeout).
- **On-demand**: job `refresh_security(security_id)` (priority tag 10) launched via GraphQL. The
  UI contract is unchanged: the existing `market-refresh` edge function becomes a thin shim that
  maps `{resource, symbol}` → Dagster GraphQL `launchRun` on the overlay (`dagster-webserver:3000`),
  so `triggerRefresh`, the Track button and the per-security button keep working.
- **dagster.yaml**: Postgres storage in database `dagster` on the existing `supabase-db`
  (Ansible creates it), `retention.schedule/sensor.purge_after_days`, and a nightly
  `cleanup_event_logs` op (the docs' recipe) — Dagster OSS does not prune event logs itself.
- **Not used, deliberately**: dynamic partitions per security (UI limits ≤25k/asset), docker-per-run.

## 7. Migration tooling — SHIPPED 2026-09-10, and not as written below was planned

**This section is a record of what was built, replacing the original plan.** Five of that plan's
assumptions were wrong, each found by measurement, and they are kept here because the same
assumptions are easy to make again.

### What shipped

```
stack/supabase/
  config.toml          the Supabase CLI project root, deliberately minimal
  schemas/             123 objects + 22 matview indexes + 262 grants — the DECLARED source of truth
  migrations/          20260910000000_baseline.sql, and everything generated from schemas/ after it
  migrations-legacy/   the 204 historical files: retired from the deploy, kept as the REFERENCE
  always/              001-app.sql and 003-security.sql
  run-cli.sh           the one definition of how the CLI is invoked here
```

| When | What runs |
|---|---|
| dev / CI | edit `schemas/` → `supabase db diff -f <name>` → a versioned migration |
| CI gate | the baseline must reproduce what the 204 legacy files build; `always/` must be idempotent; the bundle must equal what the migrations produce and applying it must change nothing |
| deploy | `supabase db push` (pending only) → `always/` in one transaction → SIGUSR1 → coverage sample |

**DECLARATIVE, NOT RE-APPLIED EVERY DEPLOY.** The original plan applied the bundle on every deploy.
Supabase's declarative model generates a migration when a definition changes, so a view is dropped
and recreated ONLY when it actually changes — which removes the reader-outage window rather than
shortening it. That is the whole user-visible point: 36 of 84 views and 10 of 40 functions had more
than one definer, `symbol_cache_classification` twelve, and every deploy dropped and recreated all
of them.

**AND ONE BIG TRANSACTION IS NOT THE SHORTCUT IT LOOKS LIKE.** Wrapping the old loop in a single
transaction would give atomicity and the ~110s apply for free, and it is WORSE for the app: the
first view dropped holds ACCESS EXCLUSIVE for the whole run, so anon reads block past their
3-second timeout and FAIL, where today they meet a short window per file.

### The two files that cannot be baselined are the two CI could never apply

Not a coincidence. `always/001-app.sql` and `always/003-security.sql` both say *IDEMPOTENT,
RE-APPLIED ON EVERY DEPLOY* in their own first line, and both reference `auth.users`, which exists
only in a real stack. `003` revokes the DEFAULT PRIVILEGES so a table LangGraph creates later cannot
silently re-acquire anon access — **it works only because it re-runs**. Baselining it would have
reproduced the exposure measured on 2026-08-09, invisibly.

### Five assumptions in the original plan, all wrong

| Planned | Measured |
|---|---|
| baseline via `supabase db dump` **from production** | generated in **CI** — production can carry Studio drift, and the migrations are the definition. It is schema **AND seed data**: in CI the database holds only what the migrations put there, so a full dump is exactly the control-table seeds. A schema-only baseline would rebuild a node with `countries`, `exchange`, `metric` and `cron_resource` EMPTY. |
| `--db-url …@localhost:5432` | **nothing listens on 5432**; Postgres is only on the `muffin-net` overlay |
| run the CLI as `ghcr.io/supabase/cli:<pinned>` | **no official CLI image exists** — Docker Hub answers 401 for `supabase/cli` where `library/postgres` answers 200 through the same request. The released binary is the only distribution. |
| the CLI is a static Go binary | **dynamically linked against glibc** (`/lib/ld-linux-aarch64.so.1`), and `supabase/postgres` is **musl** — the borrowed image failed with `exec …: no such file or directory`, which names the binary that exists and not the loader that does not. It runs in `debian:12-slim`. |
| `repeatable/{views,functions,grants}/` | a flat `schemas/`, one file per object, in `pg_depend` order |

Two more the CLI itself imposed: **`sslmode=disable` is required** (this Postgres has no SSL and does
not need it — the connection never leaves the overlay), and the **project root is the directory that
CONTAINS `supabase/`**, not that directory itself.

### Verified on the node after the cutover deploy

```
migration history:    20260910000000 baseline
anon reads thread:    false          -- always/ still runs
stats reset:          2026-09-10 18:47:29
node migrations:      1              -- the baseline; legacy files are repo-only
services:             all 1/1
deploy:               11m04s         -- 41 min at the start of this work
```

The apply task no longer appears among the slowest tasks at all; the slowest is now a 33s image
pull. `market.one_shot` is NOT retired — it is apply-once by construction and now genuinely runs
once, so retiring it would be churn.

### What the checks caught before it shipped

`drop view` **loses the ACL** (`anon cannot read 40 serving view(s)` — the app's entire read path);
`drop materialized view` **also loses its indexes**, and without the unique one
`refresh … concurrently` is rejected so every refresh takes ACCESS EXCLUSIVE; `pg_get_viewdef` is
**not round-trip stable**; a rendered function signature **cannot be re-parsed** as regprocedure;
and `pg_dump` emits GRANTs in **ACL array order**, so re-granting reorders them and an idempotence
check must compare a set rather than a sequence.

## 8. Phased roadmap## 8. Phased roadmap

### Phase 0 — Stabilise (days, no rework; each step ships alone and is verified on the node)

| # | Change | Where | Verification |
|---|---|---|---|
| 0.1 | Reclaim root disk: `docker image prune -a` of unused images; delete stale `/var/lib/docker` (7.6 GB, not the data-root); then move containerd root to `/mnt/data/containerd` (`/etc/containerd/config.toml` `root=`, stop docker+containerd, `rsync`, restart) with a rollback note | `maintenance.yml` new action + `docs` | `df -h /` < 60%; all 32 services 1/1 after restart |
| 0.2 | Stop the OOM loop: `supabase-functions` `memory: 512M → 1G`; add a nightly `docker service update --force muffin_supabase-functions` (node cron) as a stop-gap for the ~1 MB/min RSS creep | `stack/docker-compose.yaml` ~line 623; `ansible/muffin_stack.yml` cron task | 48 h with zero `exit 137` in `docker service ps`; kernel log clean |
| 0.3 | Unblock China: set `enabled=false` for `security-cn-segments` in `market.cron_resource` until the parser stamps the head on failure (`segments_parsed_at` + `tooLarge`/`crashed` outcome BEFORE parsing, like the AEP fix), and bound the PDF fetch by declared size; remove the double scheduling of `security-in-segments` (rotation row disabled, own job kept) | migration (versioned) + `cn-pdf.ts`/`index.ts` | `refresh_run` shows cn-segments rows with `ok` and a moving head; no container kill at its slot |
| 0.4 | Postgres tuning via the `supabase-db-config` volume (`/etc/postgresql-custom/*.conf` is included by the image's `postgresql.conf`): `shared_buffers=1GB`, `effective_cache_size=8GB`, `work_mem=32MB`, `maintenance_work_mem=256MB`, `random_page_cost=1.1`; container limit `1536M → 3G`; the tmpfs `/dev/shm` note in the compose stays | `stack/docker-compose.yaml` supabase-db; Ansible task writing the conf | `show shared_buffers`; heap hit % on `security_metric`/`security_statement` > 90% after a day; `check_anon_read_latency` best-of-3 improves |
| 0.5 | `drop index market.security_price_grain_date_idx` (duplicate of the PK) as a versioned migration; re-time the app's price queries as anon before/after | migration | 1.5 GB freed; `price_series` latency unchanged or better |
| 0.6 | Alert hygiene: for each of the 6 firing rules, fix or silence with a written reason (container-memory rule: exclude services at a known-steady ratio or raise to 90%; disk: fixed by 0.1; stopped-succeeding: fixed by 0.3; FLAT backlog `pending_eps_history` (300, unscheduled resource): disable the rule for unscheduled resources; data-defect: reclassify `contradicted_negative_cache` as GAUGE in the rule as CLAUDE.md already says) | `provisioning/alerting/rules.yml`, `market-verify.yml` | 0 firing alerts for 48 h; market-verify green |
| 0.7 | `security-performance` at 89 s: cut its page so p95 < 70 s (stop-gap only) | `index.ts` | `refresh_run.duration_ms` p95 |

### Phase 1 — Foundation — **COMPLETE 2026-09-10**

All six items shipped and verified in production: `muffin-ingest` published and pinned as the ninth
submodule; the `ingest` ledger (4 tables, 9 functions) with a privilege boundary that makes its
refusal-to-guess a rule rather than a convention; the migration tooling above; Dagster live with
three services, six healthy daemons, a materialising smoke asset and two schedules; the library
seams (outcome, vocab, isolation, ledger, limiter, HTTP, provider, **openbb hub**, **writers**),
76 tests, every rule mutation-proven; and the edge function still serving everything unchanged.

Two things deliberately NOT done, so the next phase does not assume them:

* **The worker exposes no metrics.** The counters exist in `muffin_ingest.http.client`, nothing
  calls them, and the Prometheus job is PARKED rather than left permanently red. It needs an
  exporter in MULTIPROCESS mode — each Dagster run is a subprocess, so the counters live in
  short-lived children — plus `mark_process_dead` on exit or the per-PID files grow without bound.
  Phase 2 wants this, because provider throttling is the thing it will need to see.
* **The containerd root is still on `/`** (27 GB). It moves every image layer on a live node and
  wants its own change and rollback plan.

### Phase 1 — Foundation (1-2 weeks) — as originally planned

1. Create `muffin-ingest` repo + CI + arm64 image; umbrella pins it (submodule 9).
2. Versioned migration: `ingest` schema (section 4), `api` schema (empty), `dagster` database +
   read-only role for Grafana.
3. Migration tooling switch (section 7) — lands BEFORE any family, because every family adds
   versioned migrations and repeatable views.
4. Deploy Dagster (webserver, daemon, `muffin-ingest` code location) with an empty
   `Definitions` + one smoke asset; Traefik route `muffin-dagster.<domain>` behind Access; Grafana
   datasource `muffin-dagster`; nightly event-log cleanup op.
5. Library skeleton: `http`, `limiter`, `ledger`, `providers/base`, `openbb`, `writers`; pytest
   green; `docker service update --image` path proven (minutes, no Terraform).
6. The edge function keeps running everything. Nothing user-visible changes.

### Phase 2 — Prices + performance — **CUT OVER 2026-09-12**

`market.performance` is a VIEW over `security_return` + `index_return`, `price_series` reads
`price_bar`, and the ten old resources are `enabled = false`. Verified on the node after the deploy:
the view serves instrument 103,270 rows / 11,663 ids / 9 periods, country 396/44/9, group 153/17/9,
sector 77/11/7; the app's own anon queries answer in **209 ms** (instrument+symbol) and **1.3 ms**
(country+period); all five rebuilt dependents kept their ACLs; `coverage_sample` kept writing.

**Recipe steps (a)-(c) and (e) shipped. (d) was skipped deliberately** — the user chose to disable
the old ingestion and re-ingest rather than dual-run, so parity became ADJUDICATION against the
provider instead of agreement with the thing being replaced:

| gate | result |
|---|---|
| returns self-consistency | 79,889 / 79,889 |
| bars parity | 116,743 / 117,304 (99.52%); the 497 systematic disagreements adjudicated to NEW in all six probes |
| index returns | `country:KR 1d` −4.1933 vs the provider's −4.1933 for 09-10, **exact to 4dp** |
| FX | **cannot be attributed** — both writers share the table, key and `source_code`, and the old function populates `derived_from` too. Stored 09-11 sits 0.03-0.57% above the provider's close for all six of EUR/GBP/JPY/KRW/ILS/TWD, same direction: a mid-session snapshot, which is the OLD shape. Suggestive, not proof. |
| price invariants | 0 frozen series, 0 returns orphaned from the view's join; the single −100% row is FFAI, real (2021 close 12,902,400 split-adjusted against 1.67) |
| equity `complete` | 43.4% → **67.5%** |

**It is a capability gain, not a like-for-like swap**: 3y went from **45 instruments to 11,190** and
5y from 45 to 10,631, because the old per-symbol path only ever held a ~400-day window.

**Still open, and none of it blocks Phase 3:**

* **(g) is NOT done** — the ten handlers are still in `index.ts`, and with them the five
  `pending_*` views they read. Measured: the six explicit blocks are **1,007 lines**, and the other
  four performance resources are not blocks at all — they fall through to a generic `spec!.load()`
  dispatch with `'sector-performance'` as a default in two places. Seven tests, the Grafana pipeline
  dashboard, `config.example.yml` and `logic-check`'s "a resource must report its own `pending_*`
  view" guard all reference them. Nothing is broken meanwhile (the cron rows are disabled, so the
  code is unreachable); the clock on it is the FLAT-backlog alert, which fires ~7 days after the
  cutover because `backlogs_to_sample()` is catalogue-derived over `pending\_%`.
* **The first scheduled run had not happened when this was written.** The automation sensor ticks
  (5 ticks, cursor populated, against 0 ever before) and the three schedules are registered
  `DECLARED_IN_CODE`, but `daily_prices` first fires at 00:00, so eager materialisation of
  `security_return` is demonstrably armed rather than demonstrably working.
* **market-verify has been red since 2026-09-08** on four failures that belong to other families —
  `data_defect` and `sector_constituents` timing out as anon, the significant-holding check 500ing,
  and the segment spine failing 5 of 12 refreshes. They are Phase 5/7 work. The consequence for
  THIS phase is that gate (f) had to be evaluated by running the price invariants directly, and
  that a cutover landing into a red gate cannot be verified by that gate.

### Phase 2 → 7 — Cutover by family (each family = its own PR set, its own planning session)

Per family, the same recipe: (a) `ingest.facet` rows + backfill of the old `%_missing_at`/cursor
columns into `ingest.task` (absent ⇒ `status='absent', next_due_at = missing_at + 30d`; cursor ⇒
`next_due_at = fetched_at + ttl`); (b) library facet modules + pytest from captured payloads;
(c) Dagster assets + checks + schedule; (d) **dual-run 3-7 days** with the old resource still on
(both write the same tables; parity = row counts and spot values per security); (e) disable the
old resource (`cron_resource.enabled=false` / drop the pg_cron job) and its `pending_*` views;
(f) coverage_sample and market-verify unchanged or better; (g) delete the handler from `index.ts`.

| Phase | Family | Old resources retired | Notes |
|---|---|---|---|
| 2 | Prices + performance | `security-prices`, `security-daily-history`, `security-price-history`, `security-performance`, `instrument-prices`, `instrument-performance`, `sector/country/group-performance`, `fx-rates` | **Designed 2026-09-10: [2026-09-10-prices-dagster-design.md](2026-09-10-prices-dagster-design.md)**, which revises §6 above — an asset is not "drain N pages of the ledger"; the cross-section is date-partitioned and history is ticker-partitioned. |
| 3 | Universe + symbols | `fund-holdings`, `exchange-listings`, `security-tickers`, `security-local-symbols`, `security-yahoo-symbols`, `security-symbol-repair`, `promote-listing`, `promote-wave`, `sec-cik-map`, `in-symbols` | N-PORT parser ported from `ingest.ts`; `invalidate(key_kind='symbol')` replaces `clear_symbol_caches`. |
| 4 | yfinance backlogs | `security-profiles`, `security-profile-detail`, `security-industries`, `security-fundamentals`, `security-quarters`, `security-share-stats`, `security-news`, `security-management`, `security-dividends`, `security-refresh` | Fiscal-period dimension introduced here (`market.fiscal_period`), used by statements/metrics/segments/EPS from now on. |
| 5 | SEC family | `security-statements`, `security-xbrl`, `security-filing-history`, `security-filings`, `security-insider`, `security-segments`, `security-wikidata-industries` | `edgartools` for instances; partition logic ported with its 79 assertions; per-accession retraction; `sec` pool. |
| 6 | Regulators + macro + events | `kr-filings`, `security-kr-segments`, `in-filings`, `security-in-segments`, `cn-filings`, `security-cn-segments`, `macro-indicators`, `earnings-calendar`, `earnings-history`, `security-price-targets`, `security-eps-history`, `security-corporate-actions` | DART needs the proxy hop (TLS 1.2 static RSA) — the http client keeps the cache base URL. CNINFO PDFs in the sandboxed subprocess. |
| 7 | Derived + serving | `security-metrics`, `derive-classifications`, `facets-refresh`, `observability-sample` | Derived assets get `AutomationCondition.eager()`; `api` schema views take over from `market` views for the UI in one coordinated muffin-ui PR (same columns, new schema) — `check_anon_read_latency.py` extended to `api`. |
| 8 | Retirement | the `market-refresh` edge function (kept only as the GraphQL shim), `cron_tick`/`cron_resource`/`cron_post`/vault secrets for functions, all pg_cron ingestion jobs, `refresh_log`, `refresh_run` (frozen as history), `logic-check.ts` + `*-check.ts`, `functions` CI job, **and the `openbb-api` service** (1 GB freed; `openbb-mcp` stays for the agent) | `market-verify.yml` stays. `observability-sample` becomes a serving asset. |

## 9. Observability changes

- **Pipeline dashboard**: panels move from `refresh_run` to `ingest.attempt` (outcomes per facet,
  duration vs budget, rows written incl. zeros) and Dagster `runs`/`run_tags` (queue depth,
  failures); "dead runs" panel from `attempt_open_idx`.
- **Providers dashboard**: adds the worker's Prometheus series
  (`muffin_ingest_provider_requests_total{provider,outcome}`, `_throttled_total`,
  `_quota_used{provider}`, `_bucket_wait_seconds`) beside the http-cache series; the openbb-api
  egress blind spot closes for calls made by the worker.
- **Alerts (Grafana, same email route)**: replace "resource stopped succeeding" with "facet has had
  no `answered` attempt within 2× its TTL", "dead run", "backlog FLAT/marking" (reads the ledger),
  keep infra rules. Dagster asset-check failures surface as a panel from Dagster's DB, not as a
  second alert path.
- **market-verify.yml**: unchanged in spirit; checks that become asset checks are removed from the
  workflow only after the check has fired correctly once in Dagster (proven by mutation, as today).
- **Logs**: `docker service logs` + Dagster run logs (per step, in the UI). Loki deferred.

## 10. Verification plan

- Per family: dual-run parity (counts per table per day, 50 spot securities compared old vs new),
  `coverage_sample` equity `complete` non-decreasing, `market-verify` green, anon latency budget
  unchanged, Grafana panels render (`check_dashboards_can_render.py`), no `exit 137`, ledger
  invariants (no `absent` row without an `isolated` attempt; no claimed row older than lease).
- Phase-level: `pending_prices` depth falling for 7 consecutive days after Phase 2; segment queue
  ETA < 60 days after Phase 5; deploy of ingestion code < 5 min; zero readers 404 during a deploy
  (probe `security_current` every second through a migration).
- Final: edge function serves only the shim; pg_cron holds only DB maintenance; `market.security`
  has no ingestion-state columns; CLAUDE.md, `docs/data-ingestion.md`, `docs/data-coverage.md`,
  `todos.md`, the six `market-*` skills and `muffin-deployment/README.md` rewritten for the new
  system (the 'Keep documentation up to date' rule).

## 11. Risks, rollback, out of scope

- **Dual-write drift** during a family's overlap: bounded by the parity check and by writing
  through the same upsert keys; rollback = re-enable the old `cron_resource` row.
- **Dagster memory** (~1.5 GB) on a node whose failure mode is OOM: hard limits per service,
  `max_concurrent_runs: 3`, parsers in RLIMIT'd subprocesses; measured headroom 14 GB.
- **In-process openbb**: an openbb release can change a route's response shape and now fails inside
  the worker rather than behind a service boundary. Mitigations: the version is pinned in
  `pyproject.toml` and bumped deliberately; contract tests (`@pytest.mark.live`) drive each route
  used against the real provider before a bump; a provider exception is an `outcome`, never a crash
  — a bad route degrades one facet, not the worker. Rollback for the whole idea is re-pointing
  `providers/openbb.py` at `OPENBB_API_URL`, which is why the adapter keeps that seam.
- **AGPL-3.0 on `muffin-ingest`**: it is a self-hosted internal service that is not distributed and
  not offered to third parties, and the repo is public anyway, so the obligation is satisfied by
  publishing the source — which is already the case. Recorded so it is a decision rather than an
  accident.
- **Event-log growth**: nightly cleanup op + tick retention; Grafana panel on the `dagster` DB size.
- **Migration baseline** on a live 11 GB DB: `db dump --schema` is metadata only; rehearsed on the
  CI throwaway first; the legacy directory stays until Phase 8.
- **Provider limits do not change**: throughput improves by removing waste (double asks, dead
  heads, per-page overhead), not by magic; whole-universe coverage beyond ~12k equities needs a
  paid bulk provider later (explicitly deferred by the user; the adapter seam is the design).
- **Out of scope**: agent access to `market`, paid providers, moving off the single node, Loki,
  the UI features list (screener route etc.), the LangGraph checkpoint issues in `todos.md`.

## 12. Deployment detail (muffin-deployment)

- **One image, three Swarm services** from `{{ image_ingest }}` in `stack/docker-compose.yaml`:
  `muffin-ingest` (code location: `dagster api grpc -h 0.0.0.0 -p 4000 -m
  muffin_ingest_dagster.definitions`; internal ports 4000 and 9102 for Prometheus; env
  `DAGSTER_HOME`, `INGEST_DATABASE_URL=postgresql://ingest_rw:…@supabase-db:5432/postgres`, the
  `*_BASE_URL` values the compose already sets for the edge function (through http-cache), provider
  keys, `PROMETHEUS_MULTIPROC_DIR`), `dagster-daemon` (`dagster-daemon run`), `dagster-webserver`
  (`-w /opt/dagster/home/workspace.yaml`, Traefik labels for `muffin-dagster.<domain>` behind
  Cloudflare Access, Terraform `cf_hostnames` entry like grafana). All three carry the
  `muffin.config-hash` container label over `dagster.yaml` + `workspace.yaml` (staged to
  `/home/ubuntu/dagster/`, bind-mounted) — the lesson that a bind-mounted config change restarts
  nothing.
- **Roles and databases** (Ansible play 6, guarded and idempotent): `create role dagster login`,
  `create database dagster owner dagster`; `ingest_rw` role created by a versioned migration
  (NOLOGIN there, like `metrics_ro`; password set by Ansible) with `statement_timeout='120s'` and
  grants on `market`/`ingest`; `metrics_ro` gets `connect` + `select` on the `dagster` database
  for Grafana (`failed_when: false` on the first deploy, before Dagster has created its tables).
- **Grafana/Prometheus**: datasource `muffin-dagster` (postgres, `jsonData.database: dagster`,
  user `metrics_ro` — the `jsonData` placement is load-bearing); Prometheus scrapes
  `muffin-ingest:9102`.
- **Fast releases**: `maintenance.yml` gains `update-service` (`docker service update --image
  ghcr.io/gururafiki/muffin-ingest:<sha> --with-registry-auth muffin_muffin-ingest`); muffin-ingest's
  build workflow dispatches it on push to main. Full Terraform deploys converge on `:latest`.
- **Memory budget** (measured today: 24 GB total, 9.2 GB used, 14.8 GB available): new services
  `muffin-ingest` 2.5 GB (code server + ≤3 run subprocesses, each importing openbb at ~250 MB;
  parser child RLIMIT 768 MB), `dagster-webserver` 512 MB, `dagster-daemon` 512 MB; Phase 0 adds
  +1.5 GB Postgres, +0.5 GB functions (temporary). **`openbb-api` (1 GB) is retired at the end of
  the migration**, so the steady state is roughly flat against today. Declared limits already
  exceed RAM on paper (~22 GB); Swarm limits are ceilings, not reservations.
- **`openbb-api` stays up throughout the migration** and is removed only in the retirement phase,
  after the last family stops calling it. **`openbb-mcp` is never touched** — it serves the agent.
  Both are the same image, so retiring one service does not affect the other.
- **Disk prerequisite**: the image is ~600 MB; Phase 0.1 must bring `/` under 60-70% first.
- **On-demand shim**: `functions/market-refresh/index.ts` shrinks to `shim.ts`: verify admin, map
  `resource` → Dagster job/config via a `ROUTES` table, POST `launchRun` to
  `http://dagster-webserver:3000/graphql` on the overlay, return `{ok, runId}`. During cutover only
  resources in `MIGRATED` are routed to Dagster; the rest fall through to the legacy handler. That
  is the per-resource UI switch; `cron_resource.enabled=false` is the scheduler switch. The
  muffin-ui code (`triggerRefresh`, Track, per-security refresh) does not change.
- **Supabase CLI on the node**: THERE IS NO OFFICIAL CLI IMAGE — `supabase/cli` does not exist on
  Docker Hub. The pinned `linux_arm64` release binary is installed by `roles/supabase_cli`, and
  `stack/supabase/run-cli.sh` runs it inside `debian:12-slim` on the **`muffin-net`** overlay
  (the network is named `muffin-net`, not `muffin_muffin-net`, and it is attachable). A container
  is required because nothing listens on 5432 on the host; `debian` rather than the database image
  because the binary is glibc-linked and `supabase/postgres` is musl. The wrapper runs
  `--version` as a precondition, so a linkage change says so in one line.

### 12.1 Per-family retire lists (what each cutover migration disables and drops)

| Family | `cron_resource` rows / pg_cron jobs disabled | `pending_*` views and `security` columns retired |
|---|---|---|
| Prices | `security-prices`, `-price-history`, `-daily-history`, `-performance`, `sector/country/group/instrument-performance`, `instrument-prices`, `fx-rates` | `pending_prices/_price_history/_daily_history/_performance/_fx_history`; `prices_missing_at`, `price_history_missing_at`, `daily_history_missing_at`, `performance_missing_at`, `daily_history_from`, `price_history_from`; `market.prices` dropped after `price_series`/`instrument_current` repoint to `security_price` via `symbol_security` |
| Universe + symbols | `fund-holdings`, `exchange-listings`, `security-tickers`, `-local-symbols`, `-yahoo-symbols`, `-symbol-repair`, `promote-wave`, `promote-listing`, `sec-cik-map`, `in-symbols` | `pending_ticker/_local_symbol/_yahoo_symbol/_symbol_repair/_promotion`; `figi_missing_at`, `local_symbol_missing_at`, `yahoo_symbol_missing_at`, `symbol_repair_at`; `clear_symbol_caches` → wrapper over `requeue_symbol_keyed` |
| yfinance backlogs | `security-profiles`, `-profile-detail`, `-industries`, `-fundamentals`, `-quarters`, `-share-stats`, `-news`, `-management`, `-dividends`, `-refresh`, `instrument-profile`, `-corporate-actions` (Tiingo), `-wikidata-industries` | nine `pending_*`; `profile_missing_at`, `profile_detail_missing_at`, `industry_missing_at`, `fundamentals_missing_at`, `share_stats_missing_at`, `estimates_missing_at`, `provider_country_missing_at`, `news_fetched_at`, `management_fetched_at`, `wikidata_missing_at` |
| SEC | `security-statements`, `-xbrl`, `-filing-history`, `-filings`, `-insider`, `-segments`; jobs `muffin-segments`, `muffin-filing-history` | seven `pending_*`; `statements_missing_at`, `quarters_missing_at`, `xbrl_fetched_at`, `xbrl_missing_at`, `filings_fetched_at`, `filing_history_fetched_at`, `insider_fetched_at`; `security_filing.segments_parsed_at/_parser_version` → `task.version` (`segment_parser` stays the version source) |
| Regulators + macro + events | `kr-filings`, `security-kr-segments`, `in-filings`, `security-in-segments`, `cn-filings`, `security-cn-segments`, `macro-indicators`, `earnings-calendar`, `earnings-history`, `security-eps-history`, `security-price-targets`; jobs `muffin-kr-*`, `muffin-in-*`, `muffin-cn-filings` | six regulator `pending_*`, `pending_eps_history/_price_targets`; `eps_history_fetched_at`, `price_targets_fetched_at`; Alpha Vantage's 25/day enforced by `ingest.spend` |
| Derived + serving | `security-metrics`, `derive-classifications`, `facets-refresh`, `observability-sample`; jobs `muffin-metrics`, `muffin-classify`, `muffin-facets`, `muffin-observability`, `muffin-promote` | `pending_metrics/_ttm/_segment_alias` |
| Retirement | `muffin-rotation`, `muffin-cron-prune`; drop `cron_resource`, `cron_cursor`, `cron_*()`, `refresh_log`, `begin/finish_refresh`, `backlog_negative_cache`, `symbol_cache_classification`, compatibility `pending_*`; `refresh_run` frozen then dropped after 400 d; `resource_health` → `ingest.facet_health` | `logic-check.ts`, `*-check.ts`, the `functions` CI job (shrinks to `deno check shim.ts`); `http-cache-covers-every-provider` moves to muffin-ingest CI; `negative-caches-are-classified.sql` → `every-facet-is-classified.sql` |

## 13. First implementation steps (Phase 0 + foundation kick-off), in order

1. Write this design as `docs/superpowers/specs/2026-09-09-ingestion-rework-design.md` in the
   umbrella and commit it (the brainstorming → spec → plan convention).
2. Phase 0.1-0.7 (section 8), one PR/run each in `muffin-deployment`, verified on the node.
3. Create the `muffin-ingest` repo (Tier-1 protection, Dependabot, CodeQL like the others), the
   umbrella submodule entry, and the CI skeleton.
4. Migration tooling switch (section 7) as its own PR set with the CI diff guard.
5. `ingest` schema migration + Dagster services deployed with a smoke asset (Phase 1).
6. Family 1 (prices + performance) planned in its own session, per the phased-work convention.

Documentation to update as each phase lands (the "keep documentation up to date" rule):
CLAUDE.md (umbrella), `docs/data-ingestion.md`, `docs/data-coverage.md`, `todos.md`,
`muffin-deployment/README.md` (Observability + deploy runbook), the six `market-*` skills, and the
memory notes for this project.
