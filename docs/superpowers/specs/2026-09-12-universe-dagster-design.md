# Phase 3 — Universe & symbols, and the Dagster pipeline standard v2

Supersedes nothing; extends [2026-09-10-prices-dagster-design.md](2026-09-10-prices-dagster-design.md)
§3, which defined the standard the price family half-built. Phase 3 finishes it, because Universe
& symbols is **entity resolution rather than a time series** and so forces the partitioning rules
to generalise instead of remaining a special case of "date".

---

## 1. Status, 2026-09-12

| Step | What | State |
|---|---|---|
| 1 | Standard v2 refactor — partition seam, resource, pools, freshness | **merged** (ingest#32) |
| 2 | The two whole-file registries (`sec-cik-map`, `in-symbols`) | **green, open** (ingest#33, deployment#373) |
| 3 | Worker Prometheus exporter | **green, open** (same PRs) |
| — | Raw fidelity: every lane stores the vendor's answer whole; stage 2 publishes each partition from its own file (§2.1) | **pushed to ingest#33**; CI's unit job green, verified locally (136 unit, 54 dagster, strict typing both ways) |
| 3b | Dagster Grafana dashboard over `dagster.runs` | not started |
| 4 | Discovery — N-PORT + the OpenFIGI exchange sweep | not started |
| 5 | Identity ladder — four rungs, `identifier_probe`, `ReAskAfter` | not started |
| 6 | Model cutover — identity tables, serving views, `promote_listing` RPC, muffin-ui | not started |
| 7 | Retire the ten handlers, **folded with Phase 2's outstanding step (g)** | not started |

**Five live defects were found by building steps 1–3, none by review:**

1. `raw_fx_spot` and `raw_index_bars` both declared `BackfillPolicy.single_run()` and returned a
   flat list — the first multi-day backfill of either would have died at the write, after every
   provider call was paid for. Neither had ever been backfilled.
2. `ingest_rw` had **no EXECUTE** on `apply_cik_map` / `apply_nse_symbol_map`; they were granted
   to `service_role` when the only caller was an edge function. The migration tests run as
   superuser and structurally cannot see this.
3. The deployed `MUFFIN_USER_AGENT` **could only ever have 403'd** — SEC refuses a User-Agent
   carrying a URL, with or without a contact email. Never caught because
   `settings.user_agent()` had no caller.
4. `concurrency.pools` in `dagster.yaml` accepts no per-pool map, so every pool is created on
   first use at limit 1 — *including a typo'd one*, which would bound nothing and report success.
5. `raw_sector_performance` (a finviz call) sat on the `yfinance` pool.

Building the raw-fidelity rule found two more: a range re-parse of `index_return` fed each lookback
bar in once per daily file (predates Phase 3), and a price test that had been passing for the wrong
reason — its row had no provider `date`, so the close rule it is named for was never reached.

---

## 2. The standard, v2

Stages 1–3 and rules 1–12 of the Phase 2 design stand. The changes:

### 2.1 RAW IS THE PROVIDER'S ANSWER, WHOLE — the rule, and where it was being broken

**Stage 1 stores what the vendor sent, with nothing dropped.** A field we do not use today must
still be on disk tomorrow, or adopting it costs a re-fetch of the entire history — which is the
one thing the two-stage split exists to prevent.

Audited 2026-09-12 and **all three frame lanes were violating it**, because the narrowing sat
*inside* stage 1 — and the first repair left one lane still reshaping, which the user caught by
asking the plain question: *"what about yahoo charts? Do we store them exactly as we read them?"*

| lane | raw stored before | raw stores now | what was being lost |
|---|---|---|---|
| prices | `Bar` — 6 of the provider's 10 fields, plus a derived `trade_date` | the provider's row verbatim + declared context | `open` `high` `low` `vwap`; rows whose date would not parse; bars outside the window |
| indices | 5 of 10 fields, plus a derived `trade_date` | the provider's row verbatim + declared context | `open` `high` `low` `vwap` `volume`; the in-progress bar |
| fx | a per-timestamp **pivot** of Yahoo's nested arrays | **the response body, byte for byte** — a `Document` row, exactly as the registry lane | anything not a length-matching array under `indicators.quote[0]` or in `meta`: a second quote block, a key Yahoo adds beside `timestamp`, undatable points — and, before the first repair, the live quote, null closes and out-of-window points |
| registries | the whole document body | unchanged | nothing |

**A pivot is an interpretation, however faithful.** Reading Yahoo's parallel arrays generically fixed
the *fields* and left the *shape*: `chart()` still decided what counted as a field before anything was
written. `providers/yahoo_chart.py` is now two functions — `fetch` returns the body (the only network
call), `parse` turns bytes into points and runs in stage 2. The test that settles it compares the
stored bytes with the served bytes by sha256, because a JSON round trip would pass a stage 1 that
re-serialised the body, and re-serialising is already a choice of key order, number format and
whitespace. The captured body carries a 29-key `meta` block; an earlier count had 27. That drift is
the argument, not a footnote.

**Placement is not storage.** A partition key is needed to decide which file a row goes to, so the
asset parses the provider's `date` to place it — and writes nothing derived into the row.
`prices.CONTEXT_COLUMNS` is exactly the set of columns stage 1 adds, and a test holds `raw_rows` to
it, so a derived column creeping back fails rather than ships.

**What openbb has already done is documented, not undone.** The price and index lanes store
`model_dump()` of openbb's `Data` objects: `extra="allow"` keeps undeclared vendor fields, but openbb
has parsed the vendor's JSON into dates and floats before we see it. Owning that layer would mean
calling yfinance directly — a different decision, and not this one.

**Stage 2 publishes per partition, from its own file.** Keeping the provider's whole answer means a
file can hold a row that belongs to another partition, and that forced one more rule, found by
asking what a range re-parse — the thing stage 2 exists to make free — would now do:

- *prices:* a bar the provider sent outside the window sits in one partition's file while the real
  bar sits in its own. The writer dedupes last-wins, so windowing the flattened run would pick
  between them by **file order**. Each file is now windowed to its own day
  (`partitioned.rows_per_partition`), after which a stray cannot be published at all.
- *fx:* a chart body covers a range and belongs to no single day, so `raw_fx_spot` files the same
  bytes under every day a run covers (`partitioned.to_every_partition`). Windowing the flattened set
  would publish every rate once per copy.
- *indices:* every daily run stores its whole 1,900-day lookback, so a range re-parse loaded each
  bar once per file — a day beside its own duplicate, in a series every return rule reads
  positionally. **This predates the change**; `index_return` now keeps one bar per (scope, day),
  the newest file's.

**And the live quote shares its date with a real bar.** The captured EURUSD body ends in Friday's
last tick (stamped at `regularMarketTime`, 21:29:58Z) *and* carries that day's completed bar, both
dated 2026-09-11 in London — closes 1.16009 and 1.16099. A rule keyed on the date would publish the
tick as the day's rate, wrong in the fourth decimal and entirely plausible. Only the stamp identifies
it, which is how `parse` has always done it; the first test written for it made the date mistake
itself and the capture refuted it.

Request context is added, never subtracted. For a provider row that is exactly
`prices.CONTEXT_COLUMNS` — `security_id`, `asked_symbol`, `observed_symbol`, `provider`, `run_id`,
`provider_warnings`; for a document it is the `Document` row (`url` with its parameters, `sha256`,
`content_type`, `fetched_at`, `run_id`) plus the subject it was asked about. `asked_symbol` beside `observed_symbol` is what makes "what
did we actually request" answerable when a value turns out wrong, and `security_id` is recorded
even though it is ours — without it stage 2 would re-resolve the symbol with *today's* mapping, so
a symbol repaired between fetch and transform would silently re-attribute a whole series.

A heterogeneous schema across partitions is fine and expected: `dump_to_path` takes the union of
keys, and DuckDB reads the set with `union_by_name=true`, which the empty-partition marker already
requires.

### 2.2 The partition decision table

The Phase 2 rule — *partition the question the data cannot answer about itself* — is right but
does not say what to partition **by**. The generalisation:

| Provider's **request grain** | The question data can't self-answer | Partition by | Example |
|---|---|---|---|
| a period of a cross-section | "did we collect period P?" | **time** | price cross-section |
| a document | "did we read document D?" | **dynamic, document id** | N-PORT accession |
| a collection sweep | "is our copy of venue V current, how far did we get?" | **venue** + a cursor | OpenFIGI `/v3/filter` |
| **one whole file** | *nothing — the file is the answer* | **none**; schedule + freshness | `company_tickers.json`, NSE `EQUITY_L.csv` |
| a batch of subjects we choose | "have we asked about subject S?" | **dynamic, subject id** | OpenFIGI ISIN→ticker |
| one subject's whole history | as above | dynamic, subject id | price history |

**Never `date × subject`** — Dagster documents ≤100,000 partitions/asset and the cross-product is
millions. Measured: 27,629 securities, 12,350 equities, 59 exchanges, 74 funds, 148,738 listings.

Row 4 is the largest simplification in the phase: `sec-cik-map` and `in-symbols` were
backlog-driven **only because of the 90-second worker** — the CIK map reached 6,645 of ~27,000
rows and restarted from zero every run. As one unpartitioned asset each, the paging, cursor,
negative cache and `remaining` counter all delete.

### 2.3 Per-subject state is the partition grid

Consistent with the skill's lesson 17 (*"'Is this done?' is a question for Dagster, not for the
data it produced"*):

```
unmaterialised   = never asked
materialised, outcome=hit    = asked, provider answered
materialised, outcome=miss   = asked, provider genuinely has nothing
```

A throttled subject is **not** materialised — it was not answered, and recording it as a miss is
the incident that negative-cached ~8,300 securities.

`ingest.task` / `facet` / `provider_budget` and the 21 `%_missing_at` columns go. What the grid
cannot carry goes two places: *what the provider said* becomes an ordinary observation table
(`market.identifier_probe`), and *the refusal to guess* moves into `providers/isolation.py`, which
already implements it. **The accepted trade:** that invariant stops being one the worker *cannot*
walk around and becomes one the tests prove it doesn't. The cheap way back is a `CHECK` on the
probe table.

### 2.4 One raw I/O manager

A document is a row with a `body` column. Measured: pyarrow infers `binary` for `bytes`,
round-trips identically, and compresses 40,064 B of XML to 3,827 B. So no second manager, and
provenance travels as **columns** rather than a sidecar that can go stale relative to its bytes.

### 2.5 Pools, freshness, seams

One pool per provider, enumerated in a **test** because `dagster.yaml` has no per-pool map. A
`FreshnessPolicy` on every scheduled asset and on **no** backfill-only lane — one goes quiet
unnoticed, the other goes red the day after its load and never recovers. `pending_*` views are
replaced by a sensor per subject-partitioned asset that adds partition keys and nothing else.

---

## 3. Asset graph

```
DISCOVERY
  raw_fund_directory    (none, daily)      company_tickers_mf.json
  raw_nport_filing      (dyn: accession)   primary_doc.xml  (body + provenance columns)
      ├──► fund_holding        market.fund_holding
      └──► discovered_security market.security, security_identifier, issuer
  raw_exchange_sweep    (dyn: exch_code)   OpenFIGI /v3/filter
      └──► venue_listing       market.venue_listing

IDENTITY
  raw_sec_cik_map       (none, weekly) ──► security_cik        [SHIPPED]
  raw_nse_equity_list   (none, weekly) ──► security_nse_filer  [SHIPPED]
  raw_figi_ticker       (dyn: security)  ─┐
  raw_figi_local_symbol (dyn: security)  ─┤
  raw_yahoo_symbol      (dyn: security)  ─┼─► security_symbology
  raw_symbol_probe      (dyn: security)  ─┘   security_identifier, listing, identifier_probe

SERVE
  symbol_resolution     (none, eager)      matview market.symbol_security
```

---

## 4. Data model

Ingestion state leaves `market.security` (21 `%_missing_at` + 8 cursors). The five overlapping
identity concepts become three: `security_identifier` (surrogate key — the `(kind, value)` PK is
what let `<cusip>000000000</cusip>` collapse four companies into one), `listing`, and
`venue_listing` (the raw OpenFIGI directory, renamed because it is a directory).

`clear_symbol_caches` and `symbol_cache_classification` go, but **their contract survives as a
test**: which absences a symbol correction invalidates becomes a property of `identifier_probe`.
That test caught 4,801 equities locked out of `pending_prices` and is ported, not dropped.

**UI impact is small** — it reads only views. Three changes: the search's `untracked_listing`
source, the Track button moving to a `promote_listing` RPC, and nothing else.

---

## 5. Observability

**Dagster owns** run outcomes, the partition grid as the backlog, asset checks, freshness,
schedule ticks. **Grafana keeps** what an orchestrator has no concept of: the coverage model (23
facets × 12 dimensions), `draining_by_marking`, negative-cache growth, distribution tripwires,
the anon-path verification, host/egress metrics.

The worker's Prometheus exporter closes the openbb egress blind spot — `http-cache` sits in front
of openbb-api and yfinance fetches via `curl_cffi`, so in-process is the only place those requests
can be counted. **Correction to the parked scrape job's own comment:** `mark_process_dead` removes
*gauge* files only, so it cannot bound the directory; what does is the exporter clearing it at
startup, which `prometheus_client` requires anyway because files surviving a restart are summed
and served as current.

---

## 6. Verification

Per step: captured payloads before any parser (including one subject the provider has nothing
for); the placeholder-identifier guard ported with a fixture where the wrong rule returns a
**wrong answer** rather than crashing; parity with a tolerance where the gate is *every
disagreement explained*; anon read latency unchanged on every re-pointed view; the UI rendered
rather than diffed.

Phase-level: the grid is the queue, proven behaviourally — materialise a rung for a subject the
provider has nothing for, assert the partition is materialised, the probe says `miss`, the sensor
does not re-seed it, and `ReAskAfter(30d)` does at day 31.

## 7. Risks

* The grid as state has no SQL-level refusal (accepted; mitigated by tests, `CHECK` available).
* Event-log growth: 4 rungs × 27.6k partitions; `prune_dagster_storage` needs re-measuring.
* Step 6 is the only step needing a coordinated muffin-ui release.
* `derive_classifications` has a 30-day TTL against a daily cron and self-skips 29 days in 30 —
  a bug predating this phase, fixed by moving it to an `eager` downstream asset.
