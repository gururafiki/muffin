# Segments and the regulators on Dagster (Phase 6) — design

Status: APPROVED 2026-11-09 (decisions 1–7 below, taken by the user the same day). Extends the
ingestion rework ([2026-09-09](../superpowers/specs/2026-09-09-ingestion-rework-design.md), §8,
Phase 6) and inherits Phase 5's decision 3 on segment raw
([2026-10-24-sec-family.md](2026-10-24-sec-family.md)). Macro and events are Phase 6b, planned
separately.

## Context

Phase 6 moves business-line segment ingestion off the `market-refresh` edge function. It covers
four regulators that share one partitioner, plus the three walkers that discover their filings.
Two live defects make it urgent:
- **SEC segment parsing fails 17% of its runs** (343 of 2,015 in the week to 11-09) on
  `pending_segments`, a view over the 1.2 M-row filing table that times out at the 8 s ceiling.
- **China parses one annual report per run:** 1,106 of 32,275 parsed, ~650 days to finish.

DART and NSE segment parsing has been retired since 2026-11-04, waiting for this phase. Macro and
events (`macro-indicators`, `earnings-calendar`, `earnings-history`, `security-news`) become
**Phase 6b**, planned in their own session after this one.

**Intended outcome:**
- all four regulators parse on Dagster, with the same parsers and the same output;
- the SEC timeouts end, the China backlog drains within weeks, and DART/NSE resume;
- the seven edge resources retire.

## Decisions (the user, 2026-11-09)

| # | Topic | Decided | Rejected |
|---|---|---|---|
| 1 | Scope | Segments + regulators: `security-segments`, `security-cn-segments`, `security-kr-segments`, `security-in-segments`, `kr-filings`, `in-filings`, `cn-filings`. Macro + events = Phase 6b | one phase for all; events first |
| 2 | Done | **Port as-is, then drain.** Same parser output; widening (SEC amendments, CNINFO heading variants) later, measured. Build to the Dagster skills | widening in this phase |
| 3 | Segment table | **Extend `security_segment` in place.** Each edge resource retires the day its Dagster lane starts (never two writers); parity by re-parsing a sample both ways before each switch; no reader changes | a new table beside it |
| 4 | PDF raw | **Whole, then pruned:** a parsed PDF goes after **30 days, or sooner, oldest-parsed first, whenever PDFs exceed 5 GB**. A parser change re-fetches, paced. XBRL documents stay whole | parser input as raw; whole and permanent (~121 GB); a drain paced to fit 30 days |
| 5 | Grids | **Filer grids + a floor**, matching each provider's request grain; SEC reuses `sec_filer` | day grids; one partition per filing (SEC alone has 226,000 parsed filings, over the 100,000 limit) |
| 6 | SEC instances | **An asset of their own on `sec_filer`**, requested only for filers with an unparsed accounts filing; Phase 5's filer visit untouched | inside the filer visit |
| 7 | PDF parsing | **A short-lived child process per PDF with an address-space limit** (768 MB); a runaway PDF is counted `unreadable` and only the child dies | in-process; Pipes subprocess |

**Design choices in this plan, open to objection:**
- A **30-day hash-spread floor** for DART, NSE and CNINFO filers. The edge re-walks every 90 days
  (DART, NSE) or 180 (CNINFO); 30 days costs ~110 list requests a day across the three.
- **CNINFO's orgIds come from its bulk lists**, one weekly request each:
  - `szse_stock.json`: 6,264 A-shares, 0.59 MB;
  - `bj_stock.json`: 607 Beijing stocks;
  - `hke_stock.json`: 2,799 Hong Kong stocks.

  This replaces the edge's per-security lookup (measured 2026-11-09).
- **One `segment_parser.version` for all regulators**, as today. The port keeps the current number
  when parity holds, so nothing re-queues.

## Current state (measured 2026-11-09)

| Resource | Runs / 7 d | Failed | Queue | Note |
|---|---|---|---|---|
| security-segments (SEC) | 2,015 | 343 | 0 | timeouts on `pending_segments`; all accounts filings with XBRL parsed |
| security-cn-segments | 247 | 2 | 31,169 | one PDF a run |
| security-kr- / -in-segments | retired 11-04 | | 0 | DART 769, NSE 1,715 filings parsed |
| kr- / in- / cn-filings | 667 / 665 / 334 | 0 / 1 / 0 | 0 | idle; re-walk 90 / 90 / 180 days |

**Data:**
- `security_segment`: 746 MB, 1.55 M rows.
  - SEC: 1,542,608 rows (2,970 securities, 76,589 filings);
  - NSE: 33,409 rows (329 / 1,715);
  - DART: 21,537 rows (367 / 769);
  - CNINFO: 6,337 rows (426 / 426).
- **No security has segments from two regulators,** and no key is stated by two, so the key stays
  `(security_id, axis, member_code, parent_key, metric_code, period_type, period_ending)` with
  `source_code` on every row.
- `security_filing`: 1.21 M rows, carrying the markers `segments_parsed_at` and
  `segments_parser_version`. `security_filer`: sec 3,776, cninfo 2,173, nse 642, dart 443.
- **Raw sizes:**
  - CNINFO PDFs: median 4.04 MB (1.21–7.09).
  - SEC instances: 1.7 MB median, ~100 KB compressed.
  - `/mnt/data`: 71.8% by the alert's measure.

**Edge code being ported:**
- `segments.ts` (1,171 lines, the partitioner);
- `xbrl.ts`, `dart.ts`, `in.ts`, `cn.ts`, `cn-pdf.ts`;
- `segments-check.ts` (1,061 lines of assertions) and the per-regulator checks.

**Readers (unchanged by decision 3):**
- **muffin-ui:** `security_segment_current`, `security_segment_detail`.
- **Dagster:** `security_classification`, which calls `derive_segment_classification` over the
  spine.
- **pg_cron:** `muffin-segment-spine`.
- **The coverage model's segment facets.**
- **Grafana `segments.json`:** reads the live `pending_*_segments` views and `refresh_run`; both
  are re-pointed.

## Architecture

New family `defs/segments/`. Its grid, asset, job, sensor and schedule names are state, frozen once
they ship. Each regulator has the same three stages:
1. **Registry** maps securities to filer ids and adds grid keys.
2. **Stage 1, per filer:** fetch the filing list, plus every segment-bearing document not yet parsed
   at the current parser version and not held.
3. **Stage 2, per filer:**
   - write `security_filing` rows (the walkers' job);
   - parse each held document;
   - **retract that filing's rows by accession only when the document was read**;
   - upsert `security_segment`;
   - stamp the markers.

**SEC, CNINFO and DART:**

| Asset | Stage | Partitions | Pool | Trigger | Writes |
|---|---|---|---|---|---|
| `raw_sec_instance` | 1 | `sec_filer` (reused) | `sec` | sensor `sec_instances_due`: CIKs with an accounts filing (`filing_form.carries_segments`, `is_xbrl`) unparsed at the parser version, in 50-CIK chunks; parser-bump history = a paced backfill | `index.json` + instance, merged on accession, zstd; 32 MB size gate kept |
| `sec_segment` | 2 | `sec_filer` | `sql` | eager on `raw_sec_instance` | `security_segment` (`sec-segments`), retraction, markers |
| `raw_cninfo_stock_list` → `security_cninfo_filer` | 1 → 2 | — | `cninfo` → `sql` | weekly | `security_filer` (cninfo); grid keys via sensor `new_cninfo_filers` |
| `raw_cninfo_filings` (specs: list, PDF) | 1 | `cninfo_filer` (~2,173) | `cninfo` | schedule `cninfo_filers_floor` (30-day hash floor, chunked); backlog = backfill | announcement list; annual-report PDFs (年度报告 only, as today) |
| `cninfo_segment` | 2 | `cninfo_filer` | `sql` | eager | `security_filing` (cninfo), `security_segment`; each PDF parsed in a capped child process |
| `raw_dart_corp_codes` → `security_dart_filer` | 1 → 2 | — | `dart` → `sql` | weekly | corp-code registry: `corpCode.xml` through the cache hop if stage 5 proves it reachable, else the edge's dated `list.json` discovery |
| `raw_dart_filings` / `dart_segment` | 1 / 2 | `dart_filer` (443) | `dart` / `sql` | floor schedule + eager | `list.json?corp_code=` + `fnlttXbrl.xml` zips; same writes |

**NSE, retention and checks:**

| Asset | Stage | Partitions | Pool | Trigger | Writes |
|---|---|---|---|---|---|
| `raw_nse_filings` / `nse_segment` | 1 / 2 | `nse_filer` (642), keys from the existing `security_nse_filer` | `nse` / `sql` | floor schedule + eager | results list + instances |
| `raw_document_retention` | — | — | — | daily job | drops PDF bodies parsed > 30 days, or oldest-parsed first while PDFs exceed 5 GB (decision 4) |
| checks | | | | | `segments_reconcile` (revenue splits reconcile; ported from the retired guard, rate tripwire); `no_filer_is_behind_its_filings` per regulator; `pdf_raw_within_cap` (ERROR); `every_segment_filing_was_parsed` (WARN, unparsed count as metadata) |

**Unchanged in Phase 6:** the spine stays a pg_cron refresh and the classification stays SQL;
both move in Phase 7.

## Low-level design

**Library (`muffin_ingest`, no Dagster):**
- `facets/segments.py`: the port of `segments.ts`.
  - **Reading facts:** an instance read with lxml `iterparse` (already declared).
  - **Placing them:** `assign_partitions`, the marginals over parent axes, the residual and
    subtotal rules (from `segment_member_class`), the reconciliation targets (including the
    derived total less eliminations), and `reconciled_to`.
  - **Its contract:** the control tables in, `SegmentFact` rows out. One module for all four
    regulators, as today.
- `facets/segments_dart.py`, `segments_nse.py`, `segments_cn.py` (with `cn_pdf.py` for the
  pdfplumber position-based table reader: midpoint column bounds, prefix/suffix name lines,
  `tidy_member_name`, `fiscal_year_end_from`). Each is a line-for-line port with its edge check
  ported as pytest.
- **Providers:** `providers/dart.py`, `nse.py`, `cninfo.py`, and the SEC instance fetch in
  `providers/sec_edgar.py`. Through `documents._get` and the existing http-cache locations (`dart`,
  `nse`, `nse-archives`, `cninfo`, `cninfo-static`, `sec`); the provider label is passed
  explicitly.
- **Outcomes per document:** `answered | absent | too_large | unreadable | refused | transport`,
  summing to `requested`.
- **The PDF child process:** `cn_pdf.parse_in_child(bytes, limit_mb=768)`, `multiprocessing` spawn
  with `resource.setrlimit(RLIMIT_AS)`. A killed child → `unreadable`.

**Raw** follows Phase 5's Document rows: body, url, http status, fetched_at, plus accession (rule
3a). Lists are merged on page, documents on accession.

**Stage 2 rules:**
- Read raw through `RawStore`, one filer at a time. Write with `writers.upsert` (`compare=` on
  value columns) and the accession retraction.
- Learn currencies only from `market.currency`: an unknown code is withheld and counted.
- Stamp markers only for documents read.

## Validation (rollout step 2, before parsers)

Capture whole bodies as fixtures, with a re-capture note.

**SEC instances:**
- the cases each rule exists for: AAPL (residual), AMZN (overlapping splits), Diageo 20-F (IFRS,
  USD), Alphabet (cross-tab), Chevron (marginal), Southern Copper (eliminations), GE Vernova
  (wrong target);
- a 404 CIK;
- one over 32 MB (the AEP case, size from `index.json` only).

**The other regulators:**
- **DART:** SK Gas and Hyundai Mobis zips; a `014` status.
- **NSE:** Reliance, Axis Bank (BANKING taxonomy), a standalone-only filing.
- **CNINFO:** Yangtze Power and LONGi; CATL as the negative (heading variant not read).

**Measurements:**
- whether `corpCode.xml` is reachable through the cache hop, and how long it takes;
- CNINFO and nse rate behaviour, paced;
- **pdfplumber's memory and time** on the largest of 20 PDFs, in and out of the child;
- **golden parity:** the Python port re-parses ~200 stored filings per regulator, compared row for
  row with `security_segment` (key, value, `partition_id`, `reconciled_to`).

Any finding that changes a decision goes back to the user before it is built.

## Dependencies and isolation

| Dependency | Status | Note |
|---|---|---|
| lxml 6.1, pdfplumber 0.11 | already in the `filings` extra, imported by nothing yet | no new dependency, rung 1 |
| Pillow 13 | pulled by pdfplumber | 11-11's Dependabot item checks the pair first |

Memory isolation: decision 7.

## UI impact

None. The same tables and views; the business-lines section reads what it reads today. Verify the
section for AAPL, Yangtze Power, SK Gas and Axis Bank in the browser after each switch.

## Observability

- **Grafana `segments.json`:** throughput, unparsed filings per regulator, and parse outcomes, read
  from Dagster run storage and the checks' metadata instead of `refresh_run` and the live `pending_*`
  views. `providers.json` already shows the ingest worker's requests per provider (dart, nse,
  cninfo, sec).
- **Raw PDF bytes against the 5 GB cap:** an exporter gauge plus a panel; the alert is
  `pdf_raw_within_cap`.
- **market-verify:** segment checks return (reconciliation, one period per split), since this is
  now Dagster data (the user's rule of 2026-11-08).
- **Existing alerts cover failed runs and regressed ERROR checks.**

## Rollout (each step ends live)

Recorded as each step lands, in sections below this table.

| # | Repo | Change | Gate |
|---|---|---|---|
| 0 | umbrella | spec; todos (Phase 6 steps, **Phase 6b heading** for macro + events, deferred notes); rework table | — |
| 1 | ingest | library port: `facets/segments.py` + the four regulator modules + providers; edge checks ported as pytest | tests and mutations |
| 2 | ops / ingest | validation and fixtures (above); golden parity ≥ 99.9% of rows per regulator, every difference explained | recorded in the spec |
| 3 | ingest + deployment | SEC: `raw_sec_instance`, `sec_segment`, `sec_instances_due` (STOPPED), checks; index for the per-CIK queue if measured necessary. Local tiny run → PR → roll → live tiny subset → parity → retire edge `security-segments` (RETIRES, 410, pg_cron unscheduled) → sensor on | counters sum; 0 timeouts |
| 4 | ingest + deployment | CNINFO: registry, grid, PDF child process, retention; parity → retire `security-cn-segments`, `cn-filings` → backlog backfill, paced; **deferred note for the drain** | drain rate, raw ≤ 5 GB |
| 5 | ingest + deployment | DART: corp-code registry, grid; parity on the 769 parsed filings → retire `kr-filings` | DART through the cache hop |
| 6 | ingest + deployment | NSE: grid from `security_nse_filer`; parity on 1,715 → retire `in-filings` | |
| 7 | deployment | Grafana `segments.json` re-pointed; market-verify segment checks back | replay every panel query |
| 8 | deployment | delete the handlers and modules after 3 clean days (`segments.ts`, `xbrl.ts` once nothing imports it, dart/in/cn modules and checks); logic-check updated | logic-check |
| 9 | deployment | contract with a drop date: `pending_segments`, `pending_{kr,in,cn}_segments`, `pending_{kr,in}_history`, `pending_cn_filings`, `dart_discovery_cursor`, `security_filer.history_walked_at`, `security.nse_history_walked_at` | proving queries |
| 10 | all | docs (CLAUDE.md, README, data-ingestion, muffin-ingest family docs), skills (`market-diagnose`, `muffin-dagster-operations`), memory | — |

## Steps 1-3 as built (2026-11-10 to 2026-11-14)

### Step 1: the library port (muffin-ingest#168, merged 2026-11-10)

- **`facets/segments.py` is a regex port, not lxml `iterparse`** as the low-level design planned. A
  line-for-line port of `segments.ts`, regexes included, is what makes the edge's TypeScript a
  usable oracle; lxml would read a few malformed instances differently and every difference would
  then need explaining. lxml stays unused.
- **Where Python and JavaScript differ by default, the port follows JavaScript:** sums add left to
  right (`sum()` compensates since Python 3.12), whitespace is JS's set, `\w` is ASCII, two
  equal-priority axes order by Node 20's `localeCompare` (matched on 25 names), and the 2^18 subset
  search adds in the edge's order (0.02 s for 18 members).
- **The regulator modules are ported at their own steps** (CNINFO at 4, DART at 5, NSE at 6), not
  all in step 1: each is proven against its own production rows when its lane is built.
- `providers/sec_edgar.fetch_instance` finds the instance as the edge did: `index.json` for sizes
  (the 32 MB gate), the HTML index when `index.json` names none.

### Step 2: validation (2026-11-10)

| Proof | Result |
|---|---|
| Golden parity against production | **9,800 of 9,800** stored rows over 558 SEC filings, re-read past http-cache |
| Differential against the edge's own TypeScript under Deno | **0 differences** on 2,800 random filings |
| 20 mutations | caught by the differential 19, by pytest 19 |
| Golden fixtures | five real instances (AAPL 10-Q, GOOGL 10-Q, CVX 10-K, EQNR 20-F, SCCO 10-K 2018) with the rows the edge produced, committed with a manifest. **They cannot be regenerated once step 8 deletes the edge handlers** |

### Step 3: the SEC lane (muffin-ingest#174, merged and rolled 2026-11-14 11:07 UTC)

- **Assets:** `raw_sec_instance` (stage 1, `sec_filer` grid, pool `sec`) and `sec_segment`
  (stage 2, pool `sql`), in ONE job, `sec_segments`, rather than `eager()` on stage 2: stage 2
  must read what stage 1 fetched in the same run, as the SEC filer lane does.
- **The queue is `security_filing`'s own marks, asked per filer** through the primary key (284 ms
  for the whole due count, measured; no index needed). A filing is due when it is an accounts
  form with `is_xbrl` that is unread at the current parser version. **`is_xbrl` is new:** 77,948
  accounts filings carry `is_xbrl = false` and none has a segment row, so the edge spent two
  requests on each for nothing.
- **Raw:** each document row keeps the body whole plus `accession`, `document`, `http_status` and
  `outcome`, merged on `(accession, document)`.
- **Stage 2:** one transaction per filing, its filings oldest first so the newest filing owns a
  period both state; a filing whose parse or write raises is rolled back, left due, and fails the
  run naming it. Unknown currencies are withheld and counted.
- **The sensor `sec_instances_due` asks for one wave at a time** (nothing while a run of the job is
  unfinished), in 50-filer chunks aligned to the grid, with a wave counter in each run key. It
  **refuses a queue over 2,000 filings**: a parser bump is an operator backfill
  ([note](../deferred/2026-11-14-a-parser-bump-re-reads-a-history-raw-does-not-hold.md)).
- **The check `every_sec_filing_was_read`** is ERROR for a filing held a day and never read (a
  transport failure on every wave leaves no failed run to see), WARN for a re-read behind the
  parser, and judges from `as_of`, not `filing_date`, so Friday's filings written on Monday are not
  late on arrival.
- **Read-only against production before the PR** (every commit rolled back), on the newest filing
  of AAPL, GOOGL/GOOG, CVX, SCCO and EQNR: 4 answered, 1 absent (Southern Copper's 10-Q, as the
  edge found), 338 rows, **270 identical**, 0 retracted, 6 marks, and **68 changed: all Equinor's
  2024 comparatives, equal in value**, moving from its FY2024 20-F to its FY2025 one, because the
  edge had read those two filings in the other order.
- **Live tiny subset, 2026-11-14 ~11:30 UTC** (five runs of `sec_segments`, one per filer, each
  re-reading the newest filing): AAPL 82 rows, CVX 74 and GOOGL/GOOG 80 (two marks), all
  `changed=0`; SCCO `no_instance`, marked; EQNR 102 rows, `changed=68`, the same ownership moves.
  `retracted=0` everywhere, outcomes summing, ~24 s a run. Row for row what the read-only drive
  predicted. The served split (`security_segment_current`, EQNR FY2025: 148.883 bn over six
  segments, 105.242 bn over seven products) is unchanged.
- **The edge retired:** muffin-deployment#511 deployed 11:46 UTC (410 from `RETIRED`; pg_cron
  `muffin-segments` unscheduled). Its last runs: 11:32 ok, 11:37 a `pending_segments` timeout,
  11:42 the 410.
- **The sensor started in code:** muffin-ingest#175. Its first tick, counted with the module's own
  query, asks for 1 filing of 1 filer.
- **Two other things this step found and fixed:**
  - `raw_sec_daily_index` failed the day after Veterans Day (11-12), which is correct behaviour:
    a day is "not published" until the next business day is listed. muffin-ingest#172 ends such a
    run claiming nothing, as the insider data-set lane already did.
  - I rolled #172-#174 at 11:07 while the day's `sec_filers` wave was running (it runs every day,
    Friday's index on Saturday). One run was killed and re-executed (`94c5427d` -> `9dd0dbef`).

## Risks and rollback

- **Parser drift in the port.** Golden parity per regulator gates each switch; until step 8 a
  rollback re-enables the edge row and removes the `RETIRED` entry.
- **DART is slow from outside Korea** (115 s for a 1.2 MB XBRL). Run width is sized from stage-5
  timings, and the `dart` pool is limited to one.
- **CNINFO throttling is unmeasured.** The backlog backfill is paced and stops on a refusal; the
  5 GB cap bounds disk whatever the pace.
- **NSE's Akamai headers.** The 16 KB proxy buffer already fixed them; the provider label is
  explicit.
- **Event-log growth from floor visits.** ~110 a day plus SEC's; charted by the existing 20 GB alert.

## Notes inherited from earlier phases

| Note | Handled by |
|---|---|
| [the segment queue reads the regulator](../deferred/2026-11-02-the-segment-queue-reads-the-regulator.md) | items 1–2 by design: per-filer queues keyed on `disclosure_source_code`, never a view over 1.2 M filings. Item 3 (amendments) is widening: decision 2 defers it |
| [the segment queues time out on the grid's filings](../deferred/2026-11-02-the-segment-queues-time-out-on-the-grid-s-filings.md) | closes when DART and NSE resume on Dagster (steps 5–6) and their views drop (step 9) |
| [a resource can repeat the same failure](../deferred/2026-10-20-a-resource-can-repeat-the-same-failure-for-weeks.md) | `security-segments`' half closes at step 3; `earnings-history`'s moves to Phase 6b |
| [raw request credentials](../deferred/2026-09-16-raw-request-credentials.md) | **DART sends `crtfc_key` in the query string:** its adapter redacts it from raw `url` before `raw_dart_filings` merges (step 5 gate), then its raw files are scanned |
| [the historical segment backlog is rising](../deferred/2026-10-04-the-historical-segment-backlog-is-rising.md) | the restored `segments_reconcile` check measures it (step 7). Splits accepted against a non-positive `reconciled_to` are a parser change, outside an as-is port: decided after the check reports |

## Deferred notes to write

- SEC amendments and transition reports (~3,500 never asked; widening, measured later).
- The CNINFO heading variant (CATL's 营业收入构成).
- The spine refresh and classification move with Phase 7.
- The China backlog drain (rollout step 4).
- A fallback for the DART corp-code registry, if `corpCode.xml` stays unreachable.

## Verification

- **Library:** pytest over captured fixtures, with mutations that make candidate rules disagree.
  Golden parity against stored rows.
- **Before each PR:** a local run on a tiny subset (`dagster-pipeline-local-test`) on a database
  built from the migrations.
- **Live:**
  - a tiny subset per regulator, with every counter summing to `requested`;
  - parity on the sample, then the edge resource retired;
  - `check_anon_read_latency.py` unchanged for the business-lines reads;
  - the business-lines section read in the browser for one company per regulator;
  - every Grafana panel query on `segments.json` replayed;
  - market-verify green with the restored segment checks.

## Open questions

None for the design. Stage-5 measurements (DART's registry, CNINFO's rate, pdfplumber's memory) can
reopen a decision, and come back to the user if they do.
