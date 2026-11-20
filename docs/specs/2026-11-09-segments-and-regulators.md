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

### After step 3: agent-named instances, and a raw layout (2026-11-14 afternoon and evening)

- **The first wave read 10 of 29 filings as having no instance**, because the edge's name rule
  rejects names a filing agent gives (`scco-20260930x10q_htm.xml`). The user decided to widen and
  re-queue: muffin-ingest#176 (the dated rule first, else the one `*_htm.xml` SEC extracted; a
  newer filing keeps the rows it holds), and muffin-deployment#513 re-queued 35,540 filings as
  "behind the parser" ([note](../deferred/2026-11-14-an-agent-named-instance-is-read-as-no-instance.md)).
- **The re-read runs as paced backfills** (the sensor refuses over 2,000 due), each at priority
  −1 so the nightly lanes outrank it:

  | Pass | Runs | Read | No segments | Rows written | Kept by newer | Left unasked |
  |---|---|---|---|---|---|---|
  | 1 `rwgskvng` 11-14 14:33 | 1 OOM | 8,521 | 3,915 | 136,120 | 23,906 | 26,675 |
  | 2 `cwxxzicl` 11-14 17:10 | 2 OOM | 7,452 | 3,558 | 106,813 | 17,496 | 17,666 |
  | 3 `zlahfjut` 11-14 22:35 | 75/75 | 6,913 | 3,177 | 119,188 | 17,444 | 12,322 |
  | 4 `szxovihm` 11-15 13:27 | 75/75 | 5,121 | 1,838 | 106,414 | 15,407 | 7,182 |
  | 5 `mlhkhrpd` 11-15 23:25 | running | | | | | |

  Every pass since #177 ran without an OOM kill, and every one ended with 0 failed writes and
  every currency known. A pass is bounded by each run's byte budget, so it reads ~5,000–8,500
  filings and leaves the rest unasked for the next. The 11-14/15 night ran beside pass 3 and every
  lane succeeded with its counters summing.
- **One row group per raw file did not survive the re-read.** Principal Financial's instances are
  413 MB of bodies in a 14 MB file, and Parquet decodes a row group whole: stage 2 was OOM-killed
  reading it, and stage 1's merge twice more, one kill leaving a corrupt 272-byte file.
  muffin-ingest#177 adds `row_group_rows` to the Parquet I/O manager (a group-by-group merge into a
  file renamed over the old one) and `stored_rows_where` (a read pruned by row-group statistics);
  `raw_sec_instance` writes one instance per group and stage 2 reads one filing at a time: 393 MB
  for every filing of that file, against 2,829 MB. The 1,504 files still in one group were
  rewritten in place, each checked `equals` before its rename. This holds for the regulators
  still to come: a CNINFO PDF or a DART zip kept per filer is the same shape.

### Step 4: CNINFO (2026-11-15 and 11-16; muffin-ingest#180, muffin-deployment#517)

**Decided by the user 2026-11-15: fix the reader now** rather than port it as-is (decision 2), and
read every report the edge read again, so all China segment rows come from one reader. The gate:
every difference from the edge classified, and ~30 reports checked against the rendered PDF.

**The lane:**
- `raw_cninfo_stock_list` → `security_cninfo_filer`: CNINFO's three bulk lists (A-shares, Beijing,
  Hong Kong) map securities to orgIds, weekly (`cninfo_stock_lists`), replacing the edge's
  per-security lookup. The sensor `new_cninfo_filers` adds `cninfo_filer` keys and ships RUNNING,
  since it only adds keys.
- `raw_cninfo_filings` (stage 1, pool `cninfo`) and `cninfo_segment` (stage 2, pool `sql`), one job
  `cninfo_segments`, as SEC's. A run is bounded by 900 s and 300 MB of reports, taken breadth-first
  (each filer's first report, then each one's second). `cninfo_filers_floor` is a 30-day hash
  floor; the backlog drains by backfill
  ([note](../deferred/2026-11-15-the-china-segment-backlog-drains-by-backfill.md)).
- **Each PDF is read in a child process** (decision 7): `python -P -m muffin_ingest.facets.cn_child`,
  the PDF on stdin, `RLIMIT_AS` 768 MB, a 120 s timeout, one pickled answer on a duplicated stdout.
  `multiprocessing` was tried first and rejected: every start method that does not fork re-runs the
  parent's `__main__`. Measured: 0.21 s and 24 MB per start; 40–60 MB peak on the 15 largest
  reports; parse median 0.79 s, p95 2.5 s, max 3.7 s over the golden set with two pages joined.
- `cninfo_retention` drops read report bodies after 30 days, or oldest first above 5 GB
  (decision 4); `cninfo_reports_within_cap` checks it; `every_cninfo_report_was_read` is WARN for a
  re-read behind the parser.
- **CNINFO's announcement times are epoch milliseconds at Beijing midnight**, so read in UTC every
  date was a day early. Reports are fetched with `X-Muffin-Cache-No-Store` (served if held, never
  stored); the search bypasses the cache.

**The reader.** pypdfium2 rebuilds pdf.js's text items from pdfium's characters (pdf.js was the
edge's engine). Each defect below was found by classifying a difference and confirmed on the
rendered page:

| Defect | Example | Fix |
|---|---|---|
| a money cell on two lines kept as its last line | 储能行业 194.20 for 2,660,336,194.20 | fragments joined per column until complete |
| the explanation, next section and sales-model table read as rows | a paragraph as a member name | `_TABLE_ENDS` |
| totals stored beside their parts | 合计, 小计 | dropped when they restate rows; a named total restating nothing is its group's row |
| a 万元 table stored as yuan | ×10,000 too small | the table's unit, including one at the foot of the previous page |
| clipped text read | 浙商's running header is a whole other page, clipped | `_clipped_away` |
| a deduction summed as a part | 南方出版传媒 `减：内部抵销数` | stored negative; a `减：` anywhere starts the name |
| `其中：` rows and nested rows summed flat | 中信建投, 中远海控 | `parent_member`; `_nested` by the table's own arithmetic |
| a partial table taken as the target | 钢铁 1225011770, 哈投 | the largest stated grand total, else the total most tables agree on |
| SEC's 0.5% placing a coincidental subset | five of 1225177612's six products | 0.01% for CNINFO |
| one-decimal figures read as unfinished | 云天励飞, 中海油服's 百万元 table | whole unless the next line continues them |
| a numbered row ending the table | 广州发展 `(1)燃煤发电及供热业务` | ends only when its cell holds no revenue |
| **a table cut by the page break** | 上海隧道's geography short by 澳门 1.25 bn | `join_pages`: the next page read below the table page |
| a restated prior-year table read as this year's | 厦门钨业 2024 (调整后) | an axis is read once |
| one member named twice under one parent | 1225263103's two `其他` | one member carrying their sum |

**Golden parity, 716 reports (2026-11-16):** 700 read, 16 over the 12 MB gate. The edge stored rows
for 516; 355 of them carry at least one edge defect:

| Edge defect | Rows | Reports |
|---|---|---|
| a 万元 table stored as yuan (+ cut) | 919 (+15) | 73 (+8) |
| total rows stored as segments | 422 | 118 |
| sales-model rows | 385 | 131 |
| names glued from two lines / cut short | 292 / 62 | 89 / 30 |
| fragment values (a cell's last line) | 138 | 47 |
| leading digits lost | 86 | 24 |
| a margin read as money | 47 | 20 |
| deductions stored positive | 34 | 9 |
| cost-analysis rows / junk names | 24 / 29 | 12 / 13 |
| other misattributions (a following table's products or revenue timing filed under geography) | 85 | 25 |

5,046 rows are identical and 67 identical apart from a stripped `其中：`/`(n)`. 3,233 rows are ours
only, mostly tables on the second page. Partitions: 1,875 placed now, 84 unplaced now (14 by the
0.01% tolerance, the rest because the target moved to a stated or agreed total), **0 unexplained**,
**0 duplicate keys**. Tables found 1,189 → 1,467 with the page join, reconciling 1,070 → 1,409 (96%);
523 reports have a placed split. The two tables placed before the join and not after were partial
(an industry table listing four industries with no total, against product and geography tables
agreeing on 4.62 bn): the old reading served them as whole splits.

**Not read, measured, deferred:**
- 143 of 716 reports (20%) state their split as `营业收入构成`, Shenzhen's format, and 10 carry only
  the product or geography heading
  ([note](../deferred/2026-11-16-a-fifth-of-china-s-reports-state-their-split-as-revenue-composition.md)).
- Page 1 of each filer's search only, as the edge did
  ([note](../deferred/2026-11-15-cninfo-reads-only-the-newest-search-page.md)).
- 6 reports may run past the second page (an upper bound); 16 reports exceed the 12 MB gate.

**Rollout, 2026-11-16:**
- **Roll and deploy.** muffin-ingest#180 rolled at 06:52, after the weekly promotion probe and wave
  and with nothing in flight. muffin-deployment#517 deployed at 07:14:
  - migration 20261115120000 applied;
  - the one-shot re-queued **1,422** full reports the edge read (it kept reading until retired,
    so more than the 1,383 counted on 11-15);
  - pg_cron `muffin-cn-filings` is gone, and both names answer 410;
  - the three Dagster tasks kept their 06:52 start.
- **`new_cninfo_filers`' first tick started in the daemon the roll was replacing** (06:52:29,
  12 s before the new daemon), and with a 6-hour interval it would have sat `STARTED` until
  ~12:52. The sensor's own function was run once by hand in the code-location container and its
  partition request applied: 2,173 keys.
- **Live subset.** Five filers (Yangtze Power, LONGi, CATL, Gree, Moutai), five runs of 39–61 s:
  - 5 searches answered; 57 reports named, 56 fetched and 1 over the 12 MB gate;
  - 56 read, 20 of them with no table (CATL's heading variant among them);
  - 546 rows, all placed, 6 retracted, 0 failed.

  Yangtze Power's FY2025 split is 境内水电行业 75,661,563,315.43 and 其他行业 10,323,376,439.80, which
  sum exactly to the reconciled 85,984,939,755.23. Served to `anon` by
  `security_segment_current` in 34 ms: 87.99% / 12.01%, gross margins 65.79% / 31.54%. The browser
  check could not run, because Playwright hung and the Chrome extension was not connected.
- **Registry, run once by hand:** 6,265 listed, 2,173 securities mapped, 0 unmapped, 0 changed
  from the edge's mapping.
- **Started:** `cninfo_retention` (every 15 minutes) and `cninfo_stock_lists` (Mondays).
  **`cninfo_filers_floor` is held STOPPED until the drain is done**: it treats a filer never
  collected as due, so its first tick would have asked all ~87 chunks at priority 0, ahead of the
  11:00 SEC wave. The drain is a priority −1 backfill instead (pass 1 `murkjqch`, launched 10:19;
  [note](../deferred/2026-11-15-the-china-segment-backlog-drains-by-backfill.md)).
- Both were started through GraphQL, so they are RUNNING only as database state until their
  `default_status` is changed in code (with the floor's, after the drain). muffin-ingest#183
  declares them RUNNING.

### Step 4b: Shenzhen's composition table (muffin-ingest#183, muffin-deployment#520; 2026-11-16 to 11-20)

**Why.** Drain pass 1 was cancelled at 11:35 on 11-16, after 11 runs: **0 of 562 Shenzhen reports
gave a row**, against 61 of 163 Shanghai ones. Shenzhen prints no mandated heading, only
`营业收入构成`, so the golden set's "20% of reports" was in fact every Shenzhen report, half the
filers. The user decided (11-16) to read that table first, gated like the first fix, then drain
China once.

**The reader.** Where no mandated heading is printed within 90 pages, the reader tries each page
carrying `营业收入构成` as a line of its own. Groups `分行业`/`分产品`/`分地区` start each axis,
`分销售模式` ends the reading, and an unknown `分…` group is skipped. `营业收入合计` is the stated
total, and there is no cost column. Shapes found by reading the whole population rather than a
sample, each with a test built from the report's measured geometry:
- a figure printed one digit group per item, the pieces gapping and overlapping by ±0.06 pt (Yunda);
- an elimination's minus flush against its figure, or alone on the line above a wrapped cell;
- a share label set over two lines (`占营业收`/`入比重`), and a group label centred across the table;
- Kangxi radicals for ideographs (`营业收⼊构成`), mapped back by NFKC on the radical blocks only;
- `营业总收入构成` and `营业收入与构成`;
- a table in 千元 printing whole numbers (Midea), read in yuan;
- an unknown group (`分行业应用`, 汉威), skipped rather than read as the current axis;
- an orphan `其中` at the top of a group (安科生物), part of the group;
- a cover printing `2025 年度报告` rather than `2025年年度报告`, which had dropped readable tables for
  want of a period (伟星股份, 华利集团).

**The gate**, on the node over the production image (detail in
[the composition note](../deferred/2026-11-16-a-fifth-of-china-s-reports-state-their-split-as-revenue-composition.md)):
- **Every Shenzhen report pass 1 fetched (624):** 610 of 615 read have facts, 609 reconcile in
  every group, 0 duplicate keys, p50 1.9 s. The 5 without facts are a bank and a broker.
- **Every extracted revenue row against its PDF (6,905):** 6,898 have name and figure on the
  table's pages, the other 7 are explained, and 35 sampled rows were read by eye.
- **The 716 golden reports:** 572 identical, 141 gained, 0 lost, 0 stored figures changed.

**Left unread:** brokers' business-line tables, 卓胜微's table with no group labels, the 10 reports
carrying only a product or geography heading, and cost from the 10% table.

**Rollout, 2026-11-20:** #183 merged 15:24 and rolled 15:29 (two DART stage-1 runs launched during
the restart failed with `DagsterUserCodeUnreachableError` and were re-executed). #520 re-queues the
757 reports read with no row, deployed with step 9.

### Step 5: DART (2026-11-16; muffin-ingest#181)

Ported as-is (decision 2): DART's archives are XBRL, read by the parser SEC's use, so the lane adds
a provider, a registry and a grid, not a parser.

**The lane:**
- `raw_dart_corp_codes` → `security_dart_filer`: `corpCode.xml`, one 3.6 MB ZIP naming every filer,
  with a stock code for 4,016 listed companies, mapped onto Korean equities by their six-digit code.
  It is weekly (`dart_corp_codes`, Monday 07:50) and **takes 346 s from the node**, which is why
  both DART schedules carry `DART_RUN` (1,800 s) rather than the 300 s short limit. The edge never
  fetched it: it timed out twice at 240 s in September, without the cache hop. The sensor
  `new_dart_filers` adds `dart_filer` keys and ships RUNNING.
- `raw_dart_filings` (pool `dart`) and `dart_segment` (pool `sql`), one job `dart_segments`, ten
  filers a run. Each filer's `list.json` is asked fresh (cache bypass), then its annual reports
  (사업보고서) not read at the current parser version and not held, newest first, in rounds across
  the run's filers. Archives are immutable and cached for 90 days. `dart_filers_floor` is the
  30-day hash floor; `every_dart_filing_was_read` is WARN.
- **DART refuses with HTTP 200**, so the body decides:
  - `013` (no data) is an answer;
  - `020` (the daily limit) is a refusal that stops the run and leaves the rest `unasked`;
  - `014` (no file, sent as XML from an archive endpoint) marks the filing;
  - any other body is asked again, because it settled nothing.
- Only annual reports are filed: quarterly and half-year reports have no `11011` archive.

**Golden parity, 769 filings (2026-11-16):**
- The port re-read 768; the 769th was a dropped connection and was not retried.
- **21,515 of 21,519 comparable stored rows match (99.98%).**
- 4,688 more rows the port produces are comparatives whose key a newer filing already owns.
- **The other 20 rows are two Hyundai Motor filings**, read by the edge at 01:34 and 01:54 UTC on
  2026-09-06:
  - Migration 196 added `long_lived_assets` and `goodwill` later that day without a parser bump, so
    16 rows are long-lived assets the edge never asked for.
  - Four `total_assets` instants are placed now where the edge left them unplaced.
  - The edge's own parser, run in Deno on those two instances with today's vocabulary, agrees with
    the port on all 100 facts (36 + 64, 0 differing).

**Read-only drive, before the PR:** Samsung, SK Gas and Hyundai Motor against production. 3 lists
answered, 2 archives re-read on request (98 rows), 0 failed, every counter summing. The 48 annual
reports already read were not fetched.

**The key was in http-cache's access log.** DART takes its key as `?crtfc_key=`, and the default
log format prints `$request_uri`: 781 lines in the 48 hours to 2026-11-16 06:40, on the node since
the location was added (2026-09-05). Raw never held it (`redacted`). Since muffin-deployment#518 the
`/dart/` location logs a copy of the URI with the key's value replaced. **Rotating the key is the
user's call**: the lines already logged are in Docker's log files on the node until they rotate.

**Rollout, 2026-11-16:**
- muffin-ingest#181 rolled 10:29–10:30; muffin-deployment#518 deployed 10:31–10:44 (migration
  20261116100000: `kr-filings` answers 410, pg_cron `muffin-kr-filings` unscheduled, the key
  redacted from the access log).
- **Registry, run once by hand: 1,086 Korean equities mapped**, 643 more than the edge's 443.
- **Live subset `zfnkyscb`** (10:49): Samsung Electronics, SK Gas and Hyundai Motor, three runs;
  100 rows, every counter summing, Hyundai Motor's two filings re-read as requested.
- **Drain:** stage 1 only (`raw_dart_filings`, pool `dart`), backfill `zgajhenf` at priority −1
  from 12:23. Stage 1 and 2 are separate backfills because pools are run-granularity: a run holding
  both would hold `sql` through DART's slow transfers. `dart_segment` over the grid follows, reading
  what stage 1 holds. `dart_filers_floor` and `dart_corp_codes` stay STOPPED until then.

### Step 6: NSE (2026-11-16; muffin-ingest#182, muffin-deployment#519)

Ported as-is (decision 2): the instances are XBRL, read by the shared parser after the edge's
normaliser (`in.ts`), ported as `facets/nse.py`.

**The lane:** `raw_nse_filings` (pool `nse`) lists each filer's annual results and fetches every
consolidated instance not read at the current parser version and not held; `nse_segment` files
the results in `market.security_filing`, normalises each instance and reads it. The grid
`nse_filer` takes its keys from `security_nse_filer` (the registries family, by ISIN); 25 filers a
run; `nse_filers_floor` is the 30-day hash floor (08:20), held STOPPED; `every_nse_filing_was_read`
is WARN.

**What the provider measured:**
- **NSE moved its API to `www.nseindia.in`** (a 301 from `.com`), while the archives answer on both
  hosts identically. The http-cache `nse` location, the edge's `nse()` origin and `settings` follow;
  links are canonicalised to `nsearchives.nseindia.com`, the form every stored accession has.
- The cookie handshake answers **403 and sets the cookies anyway**; they are sent as a `Cookie`
  header. A redirect counts as a refusal (`follow_redirects=False`), so a moved endpoint fails
  loudly rather than being followed somewhere unexamined.
- The normaliser names anonymous members, annualises `Four*` contexts, and raises
  `NotConsolidated` for a standalone instance, which is counted (`standalone`), never read.
- **NSE lists a result with no XBRL as `…/corporate/xbrl/-`, and the edge filed that link as a
  filing**, once per company: 440 rows, every one marked read, none an instance, none owning a
  segment row. The lane files only `.xml` links; migration 20261116120000 deletes the 440 once.

**Golden parity: 33,409 of 33,409 stored rows (100%)**, re-read by the port from the stored
filings' instances.

**Rollout:**
- muffin-deployment#519 deployed 11:35–11:47 (migration 20261116120000: `in-filings` answers 410,
  pg_cron `muffin-in-filings` unscheduled, the placeholders deleted, `/nse/` on `.in`).
- muffin-ingest#182 rolled 12:26–12:28. It killed two runs in flight (a SEC re-read run and a DART
  stage-1 run), re-executed at once.
- **Live subset `yzwqxcqm`** (12:28): RELIANCE, AXISBANK, INFY, HDFCBANK. 4 lists answered,
  46 results listed and filed, 0 instances named: every result was already read at the current
  parser version, so the port read nothing again, as decision 2 intends. 46 filings, all canonical,
  all dated, none duplicated.
- **Drain:** backfill `pmneyhxa` over all 642 filers at priority −1, from 12:35. 26 of 26 runs
  succeeded: 642 of 642 lists answered, 6,460 results listed, 8 instances fetched (4 read, 4
  standalone only), `changed` 0, 0 failed. `nse_filers_floor` was started on 2026-11-20 after a dry
  run of its next two ticks (19 and 16 small runs at 08:20).

### Step 7: observability (muffin-deployment#521, merged 2026-11-20)

- **Three `segments.json` panels read `muffin-dagster`** instead of the edge's `pending_*` views and
  `refresh_run`:
  - *Filings still to read*: the newest `every_*_was_read` check per regulator, never read plus
    behind the parser, labelled from the check's own name;
  - *Segment rows written per hour, by regulator*: the `rows` metadata of each `*_segment`
    materialization, one per (run, asset);
  - *China's annual-report PDFs held, against the 5 GB cap*: `cninfo_reports_within_cap`'s
    `held_bytes` and `cap_bytes`.
- **A dashboard query that pattern-matches `event_logs` scanned 1.5 M materializations and timed
  out.** The asset keys are matched on Dagster's small `asset_keys` table and handed to the indexed
  lookup as `asset_key = any(array(…))`: 95 ms.
- **market-verify's segment checks are back** (9b `check_segments_reconcile.py` and
  `check_spine_refresh_succeeds.py`, with the spine self-test in `quality.yml`), since segments are
  Dagster data again (the user's rule of 2026-11-08). Both were replayed on production first: 3,643
  splits checked, the served rate 0.38% against a 1.25% tripwire, and the spine refreshed 0.1 h
  before.
- `check_anon_read_latency.py` probes the stock page's business-lines reads again.

### Step 8: the edge's handlers deleted (muffin-deployment#522, merged 2026-11-20)

No segment-lane run failed from 2026-11-17 to 11-20 (11-16's three failures were the roll and the
cancelled CNINFO pass), so all seven handlers went at once, not only SEC's:
- the seven branches of `market-refresh/index.ts` (1,095 lines), their constants and TTLs;
- `segments.ts`, `xbrl.ts`, `dart.ts`, `in.ts`, `cn.ts`, `cn-pdf.ts` and their six checks;
- the `logic-check.ts` guards that only covered that code: the shared segment conflict target,
  `segment_member_class` being read, the read-gated retraction, and the `in-filings` stamp.

The `RETIRED` entries stay, so each resource answers 410 naming its lane. `origins.ts` keeps the
regulators' hosts because the http-cache guard reads them.

**The first merge was refused** with *"refusing to allow an OAuth App to create or update workflow
… without `workflow` scope"*. #521 had changed `quality.yml` in the same minute, and GitHub's merge
would have written a `quality.yml` neither branch held. Rebasing #522 over SSH, so its head already
held the merged file, let `gh pr merge` through. #521 itself had merged because its branch held
exactly the file the merge produced.

### Step 9: the contract (muffin-deployment#523, 2026-11-20)

- **Dropped:** `pending_segments`, `pending_{kr,in,cn}_segments`, `pending_{kr,in}_history`,
  `pending_cn_filings`, and `backlog_negative_cache`'s row for `pending_segments`.
  `pending_cn_segments` and `pending_kr_history` had sat FLAT since their resources retired, so "A
  non-empty backlog has been FLAT for a week" fired on them. Dry-run on production in a rolled-back
  transaction: `backlogs_to_sample` lists only the five live queues, and `backlog_drain` carries
  none of the seven.
- **Kept until 2026-12-20:** `dart_discovery_cursor`, `security_filer.history_walked_at` and
  `security.nse_history_walked_at`
  ([the retired-columns note](../deferred/2026-09-30-the-retired-families-leave-columns-behind.md)).
- **Tests:**
  - five tested only the views and were deleted;
  - `segments-aggregate-within-a-partition` lost its backlog block;
  - `india-must-ask-with-nse-s-own-symbol` now asserts on `security_filer.filer_id`, which the NSE
    lane asks with, so a security NSE does not list must get no filer id.

  Replayed on the node twice: the bundle matches, applying it changes nothing, 117 of 117 tests.

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
