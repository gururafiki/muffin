# More segment sources (Phase 6c) — design

Status: APPROVED 2026-11-26 (decisions 1–5, taken by the user the same day). Extends
[2026-11-09-segments-and-regulators.md](2026-11-09-segments-and-regulators.md) (the segment family
on Dagster). The options it chose from are measured in
[the options note](../deferred/2026-11-26-where-the-missing-segments-can-come-from.md). A design
review against the code (2026-11-26) found five defects in the first draft, and their fixes are
folded in below:
- H-shares mapped to a CNINFO filer but dropped by `FILERS`' join on six-digit listings;
- a SEC version bump stalling `sec_instances_due`;
- new concepts in the global `xbrl_concept` changing DART, NSE and SEC statements;
- assuming raw holds SEC history;
- a floor for EDINET, which has no per-filer list.

As-built notes are added below the rollout as each step lands.

Governing skills:
- `dagster-ingestion-best-practices` (rules 1–10);
- `dagster-expert`;
- `dagster-pipeline-local-test` (including the reader gate over held documents);
- `muffin-schema-change`;
- `muffin-deploy`;
- `muffin-dagster-operations`;
- `muffin-grafana-dashboards`.

## Context

On 2026-11-26, 2,979 equities over $2 bn ($53.9 T) held no placed revenue split for FY2023 or later.
Eight sources were measured that day. The user chose this order:
- **A**: SEC vocabulary and size limit;
- **B**: one split on every listing of a company;
- **C**: Japan through EDINET;
- **E**: China's segment note for banks and state firms;
- **D**: Europe through ESEF.

F (Taiwan) gets one more probe, G (English PDFs) is deferred, and H (a paid vendor) is rejected.

**Intended outcome:** each source lands as a regulator in the existing segment family. It goes
through the shared writer and the views the app already reads, so the stock page's business lines
need no data change in the app. Each step ends live, with its yield measured against the baseline
below.

## Decisions (the user, 2026-11-26)

| # | Topic | Decided | Rejected |
|---|---|---|---|
| 1 | Company key | **The regulator filer.** Every listing of a company maps to its filer, and the lanes write its split on each listing, as they already do for GOOG/GOOGL under one CIK | resolving siblings in the serving views; name matching (false positives measured: Orion Oyj vs Orion Korea, INDB vs IBCP) |
| 2 | Two regulators for one company | **The home lane skips SEC's companies.** EDINET and ESEF skip a security that holds a placed SEC revenue split for one of its last two fiscal years. A WARN check catches any security with splits from two regulators for one period | the serving views pick by source priority |
| 3 | Raw retention | **Keep EDINET archives and ESEF reports whole, permanently.** Grow `/mnt/data` as needed | pruned after read |
| 4 | Parser version | **One per regulator** | one shared version, plus a re-queue migration for each fix |
| 5 | China's PDFs | **Stop pruning from now on.** Already-pruned reports are kept when a re-read fetches them | Phase 6 decision 4 (prune 30 days after read, 5 GB cap) |

**Design choices in this plan, open to objection** (several came from the design review):
- **Japan, Europe and China's note share one interpreter, anchored on the filing's own totals.** A
  metric line is the row or column whose member cells sum to the filing's tagged consolidated figure
  for a period. Japan and Europe have those tags; China's note has its own total column. Matching on
  values rather than labels is what makes it language-independent.
  - Matching on values alone also accepts tables that merely sum to the total: reconciliation tables,
    the intersegment `計` row, and major-customer tables. So a table needs more evidence: at least two
    identified metric lines, or a known kind heading, and at least two members that are not totals or
    adjustments.
  - Total and adjustment columns are removed before partitioning.
  - A table whose kind cannot be established is skipped and counted, never guessed. A geography axis
    read as business would put countries into industry classification.
- **Segment total concepts are scoped per regulator** in a new `market.segment_total_concept`, not
  added to `xbrl_concept`. That table is global: SEC, DART and NSE segment parsing read it, and so
  does the SEC statement lane (`sec_facts.CONCEPTS_SQL`). `RevenueFromSaleOfGoods` is a component of
  revenue in DART instances, and Japanese `NetSales` would match extensions in 10-Ks.
- **A does not bump SEC's parser version.** A bump makes ~148,000 filings due, most no longer in raw
  (~25 GB of re-fetching). It would also stall `sec_instances_due`, which refuses any tick above
  2,000 due. A re-queues a targeted set instead.
- **B copies before it re-reads.** A security newly mapped to a filer gets that filer's filing rows
  and segment rows copied from a sibling that read them at the current parser version. Re-reading
  would mean fetching SEC's history again (the edge read it, and raw does not hold it) and China's
  pruned PDFs.
- **Siblings across the SEC take segments only.** The issuer links include PETR3/4.SA, VALE3.SA,
  ABEV3.SA, UMC's 2303.TW and CCL1N.MX, whose ADRs file with the SEC. Setting `security.cik` on those
  local lines would also give them the SEC's statements, fiscal calendar, SIC and Form 4 attribution.
  So they get a `security_filer('sec')` row with `via = 'issuer_sibling'`, and only the filing and
  segment writers fan out through it. Same-country share classes (LEN-B) take `security.cik`, as GOOG
  and GOOGL do.
- **EDINET discovers filings per day.** `documents.json?date=` is its publishing grain, and it has no
  per-company listing. The per-filer document lane runs from a due sensor over `security_filing`
  marks (like `sec_instances_due`), not from a 30-day floor, since a floor visit to a filer would ask
  EDINET nothing. A replay job files the day history for filers mapped later.
- **The China note keeps source `cninfo`**, with its own axis `cninfo:经营分部`.
- **Providers by name:**
  - `data_source` `edinet`;
  - `data_source` `xbrl-org` for filings.xbrl.org; the regulator stays `esef` in `disclosure_source`.

## Measured baseline (2026-11-26)

| Source | Reach | Notes |
|---|---|---|
| A: SEC vocabulary | 9 of the 300 largest SEC no-split filers ($1.28 T: Novartis, Morgan Stanley, Goldman, NextEra, UBS, Sanofi…) | dry re-parse with four revenue concepts. 4 filers' annual instances exceed 32 MB: HSBC 33–55 MB, Santander 33–46 MB |
| A: `held: sec` | 171 CIK holders file no 10-K, 20-F or 40-F | coverage labels them `held` |
| B: CNINFO HK list | 215 HK lines share their A-share's orgId; 68 of them are securities we hold | 37 large ones lack a split their A-share has ($336 bn) |
| B: shared LEI issuer | 59 large listings | DART 8 ($795 bn, Samsung preferred); SEC 23 ($717 bn); CNINFO 27; NSE 1 |
| B: N-PORT fix | 528 equities gain an issuer (432 large) | 5 more large links today ($0.11 T); groundwork for C/D/E |
| C: EDINET | up to 466 large, $6.6 T | one day's list 440 KB, 1.9 s, 93 annual reports. An archive is 0.6–1.7 MB in ~5 s, its instance 3–7 MB. Code list 576 KB, 11,475 rows (EDINET code, 5-digit 証券コード, 法人番号). Toyota's external revenue sums exactly to its tagged consolidated figure |
| D: filings.xbrl.org | ~430 of 577 large ($7.7 T) | one request per LEI lists filings (L'Oréal: 5). A JSON report is 6.7 MB and carries tagged `ifrs-full:Revenue` for 3 years. 18 of 24 sampled hold a revenue table. DE and CH are not indexed. 429 after ~15 fast requests; 8 s pacing holds |
| E: China note | 88 large, $4.1 T, plus their H-shares through B | ICBC `经营分部信息概要` on p.44 of 408 |
| Disk | `/mnt/data` 92 of 133 GB | EDINET ~30 GB for 10 years; ESEF ~2 GB; China grows as re-reads keep PDFs |

## Architecture: five rules

1. **A source is a regulator in the segment family**, never a parallel path:
   - registry → `security_filer`;
   - stage 1 per filer (provider pool) → raw, kept whole;
   - stage 2 (`sql`) → `security_filing` rows with `filing_date`, then
     `lib/segment_tables.py::file_filing` (upsert, accession-scoped retraction, markers);
   - a parser version per regulator;
   - an `every_<reg>_filing_was_read` check;
   - the drain runs as a paced backfill.

   New sources must write `security_filing` rows with dates, because `HELD_BY_NEWER` and
   `security_segment_latest` order filings by `filing_date`.
2. **A company is a filer.** A filer maps to every listing of the company. A newcomer gets the filer's
   history by copy; future filings fan out through `security_filer`.
3. **One regulator per security.** Lower-priority registries skip SEC split holders (decision 2). The
   sibling extension fills holes only and refuses when siblings disagree. A WARN check guards both.
4. **Every axis has a `segment_axis` row with a unique string.** `security_segment_current` drops an
   axis with no row, and `derive_segment_classification` joins on the axis string alone.
   - Resolved countries are written as `country:<ISO2>`, so they read as geography wherever they
     appear.
   - Region names get `segment_member` rows; totals and adjustments get `segment_member_class` rows.
5. **Vocabulary lives in control tables:**
   - `segment_total_concept` holds segment total concepts by regulator;
   - `segment_note_block` holds block concepts and their kind;
   - `segment_note_heading` holds JP and EU heading patterns with a kind or `skip`, covering
     `差異調整…`, `主要な顧客ごとの情報` and reconciliation tables.

## Data model changes (muffin-deployment)

**Expand:**
- `segment_parser`: drop the singleton key, add `regulator` (FK to `disclosure_source`), set today's
  row to `sec`, and insert `cninfo`, `dart` and `nse` at the current version. `max(version)` readers
  keep working, so the deploy can precede the roll.
- `security_filer.via` (`registry` | `issuer_sibling`, default `registry`).
- `segment_total_concept(regulator, metric_code, concept, priority)`, `segment_note_block` and
  `segment_note_heading`: control tables, with DML revoked from `ingest_rw`.
- Seeded control rows:
  - `data_source`: `edinet`, `xbrl-org`;
  - `filing_form`: the EDINET annual report (docType 120 with its ordinance/form codes) and the ESEF
    annual financial report;
  - `segment_axis`:
    - `edinet:報告セグメント` business, `edinet:製品及びサービス` product, `edinet:地域` geography;
    - `esef:segments`, `esef:products`, `esef:geography`;
    - `cninfo:经营分部`;
  - `segment_member`: JP and EU region names;
  - `segment_member_class`: `計`, `合計`, `調整額`, `消去`, `全社`, Corporate, Eliminations, and
    other residuals.
- **Functions** (run by a Dagster asset):
  - `market.extend_filers_to_issuer_siblings()`: equities only; holes only (no enabled regulator
    filer already holding an annual accounts filing); refuses on disagreement; writes
    `via='issuer_sibling'`; retracts its own stale rows.
  - `market.copy_filer_history(security_id, regulator)`: copies filing and segment rows from a
    sibling that read them at the current version; returns counts.
- **`security_disclosure` (0065):** `held` requires an annual accounts filing through `filing_form`
  (`is_annual and carries_segments`). The fixture of `tests/a-capability-is-not-a-regulator.sql`
  gains a 10-K row.
- **Enabling:**
  - `disclosure_source` notes are rewritten now;
  - `edinet` is enabled at C live;
  - `esef` is enabled at D live, with `disclosure_coverage` rows for the measured countries (SE, GB,
    DK, NO, FI, FR, IT, BE, NL, ES; never DE or CH while the index lacks them).

**Contract (later, with a drop date):** `segment_parser.singleton`.

**CI that reads one parser version:** `quality.yml` lines 372–386 and
`check_segments_reconcile.py:304` (per regulator via `FILER_SOURCE`). A guard test asserts every
enabled `disclosure_source` has a parser row.

## Rollout (each step ends live)

| # | Repo | Change | Gate |
|---|---|---|---|
| 0 | umbrella | spec, `todos.md` (Phase 6c steps), deferred notes, options note set to chosen | — |
| 1a | deployment | expand: per-regulator `segment_parser`, `security_filer.via`, `segment_total_concept`; CI reads per regulator; guard test | node replay (two passes, mutations); filings behind the parser unchanged |
| 1b | ingest | per-regulator version; `sec_instances_due` above the cap; shared helpers to `lib/`; WARN check | local tiny run; after the roll each stage 2 reports the same version, 0 re-queued; WARN baseline recorded |
| 2a | ingest | A: 64 MB instance gate (child process if measured); `reask_too_large` | peak RSS on HSBC and Santander, measured locally |
| 2b | deployment | A: SEC concepts in `segment_total_concept`; one-shot re-queue; `held` fix | dry re-parse over held SEC raw: 0 changed rows for split holders, ~9 gains; anon latency |
| 2c | ops | A: paced `sec_segments` backfill; `reask_too_large` backfill | reconcile guard; coverage delta |
| 3a | ingest | B: N-PORT issuer fill; CNINFO HK list, `FILERS` fix; sibling asset; SEC filing and segment fan-out through `security_filer` | unit tests; local tiny run |
| 3b | deployment | B: sibling extension and copy functions, with guard tests | rolled-back run on production rows: ~59 issuer and 37 orgId links |
| 3c | ops | B: N-PORT replay (newest filing per fund); sibling asset run; copies | WARN not increased; H-share and Samsung preferred rendered |
| 4 | deployment | grow `/mnt/data`; China PDFs kept | free space; retention job stopped |
| 5a | deployment | C: `/edinet/` and `/edinet-dl/` cache locations with key redaction; EDINET control rows; parser row | http-cache guard |
| 5b | muffin-ui | `memberLabel` passthrough for `cninfo:`, `edinet:`, `esef:` | `segment-label-check` |
| 5c | ingest | C: provider, `segment_note`, `facets/edinet`, `defs/edinet`, fixtures | reader gate; parity against Japanese 20-F filers; kind audit |
| 5d | ops + deployment | C live: tiny subset, sensors on, history backfill, enable `edinet`, guards and panels | counters sum; disk |
| 6 | ingest + deployment | E: CNINFO note stage; re-fetch for the 88 | reader gate over held PDFs: 88-filer yield; 0 existing CNINFO splits changed |
| 7 | same shape as 5 | D: `/xbrl-org/`, `facets/esef`, `defs/esef`; enable with coverage rows | parity against SEC 20-F filers (Shell, Novo, Sanofi, TotalEnergies); per-language skip audit |
| 8 | ops | F: probe Taiwan MOPS's segment note | result back to the user; no build without a decision |
| 9 | all | docs, skills, memory; curation follow-up note | — |

## Low-level design by step

### 1. Groundwork

**Library:**
- `facets/segments.py`: `vocabulary(conn, regulator)` reads that regulator's version and raises when
  the row is missing. It also unions `segment_total_concept` for the regulator.
- The four `_UNREAD` fragments read `segment_parser where regulator = REGULATOR`:
  - `facets/sec_segments.py:43`;
  - `cninfo.py:162` (also used by `READ_AT`);
  - `dart.py:177`;
  - `nse.py:201`.

**Project:**
- `defs/segments/core.py`: each stage-2 asset passes its regulator. `STAMP_PARSED` and `file_filing`
  already take the version.
- `defs/segments/automation.py::sec_instances_due`: above `MAX_DUE_PER_TICK` it still requests chunks
  holding a filing filed in the last 14 days (`DUE_BY_FILER` gains a recency column). New 10-Ks then
  keep flowing during any large re-read.
- Move `floor_chunks`, `on_floor`, `FLOOR_DAYS`, `LIST_MAX_AGE_DAYS`, `_younger_than` and
  `_round_robin` to `lib/filer_lanes.py`. No names in Dagster's state change.
- New check `no_period_has_splits_from_two_regulators` (WARN) on `sec_segment`.
- Test fakes that match `from market.segment_parser` are updated, and the snapshot is regenerated.

### 2. A: SEC

- **Concepts:** `segment_total_concept` rows for `sec`: `RevenuesNetOfInterestExpense`,
  `RevenueAndOperatingIncome`, `RevenueFromSaleOfGoods`, `RegulatedAndUnregulatedOperatingRevenue`,
  below the existing revenue priorities. Insurers' `PremiumsEarnedNet` is left out: premiums are not
  revenue.
- **Size gate:** `MAX_INSTANCE_BYTES` goes to 64 MB (`facets/segments.py:954`; DART's own gate stays).
  AEP's 128 MB filing stays refused. If HSBC's 55 MB instance peaks too high in stage 2, instances
  over 32 MB are parsed in a capped child process. That means generalising `cn_child` into a shared
  `facets/child.py`.
- **`SecInstanceRun.reask_too_large`:** stage 1 collects accessions whose newest raw outcome is
  `too_large` and passes them as `named`; stage 2 re-reads them. No database re-queue is needed,
  because a too-large filing carries no marker to clear.
- **One-shot re-queue:** annual SEC accounts filings for FY2023+ of securities with no placed annual
  revenue split. The size comes from the gate; it is expected to stay under the sensor cap.

### 3. B: one split on every listing

- **N-PORT** (`facets/nport.py`): a pure `issuer_fills(holdings, ids, issuer_by_lei)`.
  - `discovered_security` sets `issuer_id` where it is null, never moves one, and counts
    `issuer_filled` and `issuer_disagrees`.
  - The replay runs only the newest filing per tracked fund, so older filings cannot overwrite issuer
    names.
- **CNINFO** (`facets/cninfo.py`):
  - `hke_stock.json` joins `STOCK_LISTS`, with its own `hk_org_ids()` (4–5-digit codes).
  - HK equities whose orgId is an A-share filer get `security_filer('cninfo', orgId)`.
  - `FILERS` takes securities from `security_filer` and the code from a lateral `min(listing.symbol)`
    restricted to six-digit codes. Without this an H-share silently drops out of
    `array_agg(security_id)`.
- **SEC fan-out:**
  - the filing writer in `defs/sec/core.py` (`sec_filer_facts`) and `sec_segments.FILINGS` fan out
    through `security_filer('sec')`;
  - statements, calendar, SIC and Form 4 still follow `security.cik`;
  - the `sync_sec_filer` trigger must keep `via` on rows it did not create.
- **New asset `security_filer_siblings`:** runs after the registries, calls
  `extend_filers_to_issuer_siblings()`, then `copy_filer_history()` for each new row, and emits counts.
  Copied rows keep their `source_code`. Retracting a sibling row deletes what was copied for it.

### 4. Disk and China retention

- One deploy grows the data volume. The size is chosen from measured free space plus ~40 GB for
  EDINET and ESEF; the online path was measured on 2026-11-21.
- `cninfo_retention` ships STOPPED in code, and its job stays as the rollback.
- `cninfo_reports_within_cap` becomes a gauge of held bytes, no longer an ERROR. The disk alert
  covers growth.

### 5. C: EDINET

**Library:**
- `providers/edinet.py`:
  - `daily_index(date)`, `document(doc_id)` (type=1 zip), and `code_list()`;
  - `Subscription-Key` is redacted from stored URLs;
  - bodies are classified (a zip versus an error JSON), as `dart.classify` does, so an error is never
    filed as an absence.
- `facets/segment_note.py`:
  - HTML to grids, with stdlib `html.parser` and colspan/rowspan expanded;
  - one number convention per table (`△`/`▲`, parentheses, U+2212, decimal comma, space or NBSP);
  - the anchored interpreter described above;
  - member names NFKC-normalised, with footnote markers stripped;
  - output is `SegmentFact` rows, partitioned with `assign_partitions`.
- `facets/edinet.py`:
  - reads the instance from the zip;
  - takes anchors from `parse_facts` with the `edinet` total concepts (`jppfs_cor`/`jpigp_cor`);
  - takes the note text block (JGAAP and IFRS concepts from `segment_note_block`), with headings
    from `segment_note_heading`;
  - banks' `業務粗利益` is never stored as revenue.

**Project (`defs/edinet/`, group `segments`):**
- Partitions: `edinet_day` (time window, `Asia/Tokyo`, start pinned at the earliest day the API
  serves) and `edinet_filer` (dynamic EDINET code).
- Registry: `raw_edinet_code_list` → `security_edinet_filer`, weekly (`edinet_code_list`).
  - It joins on 4-character local codes, which can be alphanumeric (`130A`), taken from `.T`
    symbols and listings.
  - It deletes its own rows for SEC split holders (decision 2).
- Discovery: `raw_edinet_daily_index` → `edinet_filing`, job `edinet_daily_index`, schedule
  `edinet_daily` after JST midnight with a 10-day lookback. History goes by backfill (~3,650 days).
- Documents: `raw_edinet_filings` (pool `edinet`) → `edinet_segment` (`sql`), job
  `edinet_segments`. The sensor `edinet_documents_due` uses the `chunks_due` pattern.
- `new_edinet_filers` adds keys and requests `edinet_filing_replay`: stage 2 only, over the whole
  day range, configured to file only the new filers. It makes no requests.
- Check: `every_edinet_filing_was_read`.

**Cache:** `/edinet/` (lists and documents no-store, because raw keeps them) and `/edinet-dl/`, in
`nginx.conf`, `origins.ts` and `CACHE_LOCATIONS`. The access-log redaction map gains
`Subscription-Key`.

### 6. E: China's segment note

- A note stage in `cn_pdf`:
  - only when no main-business table was read;
  - finds `经营分部`/`分部信息` through the PDF outline, because ICBC is 408 pages;
  - builds a segments-as-columns grid from the position machinery and feeds it to the shared
    interpreter, anchored on the note's own total column.
- `CninfoRun` gains a per-run `max_pdf_bytes` and a `reread` list for the 88 filers.
- `cn_child`'s 768 MB and 120 s limits are re-measured on the largest bank reports.

### 7. D: ESEF

- **Library:**
  - `providers/xbrl_org.py`: `filings(lei)` with the `has` filter, paginated; `report(json_url)`;
    8 s pacing; a 429 stops the run.
  - `facets/esef.py`: anchors from the xBRL-JSON facts. Durations end exclusive, so a day is
    subtracted. Blocks come from `segment_note_block`, then go to `segment_note`.
- **Project (`defs/esef/`):**
  - grid `esef_filer` (LEI); registry `security_esef_filer` from `issuer.lei` and `filer_profile.lei`
    in coverage countries, skipping SEC split holders;
  - `raw_esef_filings` (list plus due reports) → `esef_segment`;
  - floor `esef_filers_floor` with the shared list age; sensor `new_esef_filers`; check
    `every_esef_filing_was_read`;
  - `filing_date` comes from the index's `date_added`, recorded as a proxy, with filings deduped per
    period.

## Validation (before each reader is built; fixtures captured whole, with a re-capture note)

- **A:**
  - peak RSS for the HSBC and Santander instances;
  - the dry re-parse over all held SEC raw (split holders unchanged).
- **B:**
  - the rolled-back function run on production rows, listing every link with both symbols, read by
    eye;
  - 6031.HK, 005935.KS, PETR4.SA and LEN-B traced end to end.
- **C:**
  - Toyota (IFRS), a JGAAP filer, a filer reporting in 千円, a single-segment company, a bank;
  - the earliest day the API serves, its rate behaviour over 50 paced requests, and amendment doc
    types (130 is deferred);
  - parity against Sony, MUFG and Honda's SEC splits (excluded from production by decision 2, but
    read in the gate).
- **D:**
  - L'Oréal, LVMH, Schneider, Iberdrola, Atlas Copco (SV), Enel (IT), Airbus (no table), Inditex
    (single segment);
  - list pagination;
  - the 429 signature.
- **E:**
  - ICBC, Ping An and PetroChina PDFs: outline presence, size, the note's page, and the interpreter's
    split.

Any finding that changes a decision goes back to the user before it is built.

## UI

- No data-shape change: the business-lines section reads `security_segment_current` and `_detail` by
  `security_id`.
- One muffin-ui PR (step 5b): `memberLabel` stops camel-splitting names in the `cninfo:`, `edinet:`
  and `esef:` namespaces, so `esef:iPhone` does not render as "i Phone".
- Each step renders the stock page against live data for one company it added:
  - 6031.HK and 005935.KS (B);
  - Toyota (C);
  - ICBC (E);
  - L'Oréal (D).

## Observability

- **Grafana `segments.json`** reads the `every_*_was_read` checks and the `*_segment` materializations,
  so EDINET and ESEF should appear by name. Every panel query is replayed after each lane goes live.
- **`providers.json`** gains the `edinet` and `xbrl-org` labels from the ingest exporter.
- **market-verify:**
  - `check_segments_reconcile.py` gains `edinet` and `xbrl-org` in `SAMPLE_SOURCES` and
    `FILER_SOURCE`, reading the parser version per regulator;
  - `check_anon_read_latency.py` is unchanged and re-run after each deploy.
- **Disk:** the existing disk alert, plus the CNINFO held-bytes gauge.
- **Coverage:** enabling `edinet` and `esef` moves Japan and Europe from `none` to `resolvable` or
  `held`; the coverage delta is recorded per step.

## Risks and rollback

- **Wrong table or wrong kind** (the main reader risk): the evidence rule, skip-and-count, the kind
  audit (no country on a business axis), and parity against the 20-F filers.
- **Wrong sibling link:**
  - holes only, refuse on disagreement, `via` provenance;
  - deleting `via='issuer_sibling'` rows also removes their copied rows;
  - the WARN check fires on any overlap.
- **Memory on 64 MB instances:** measured before raising; child-process parse; AEP's 128 MB stays
  refused.
- **EDINET key in URLs:** redacted in raw and in the access log, as DART's is.
- **ESEF throttling:** 8 s pacing; a 429 stops the run and leaves the rest unasked.
- **Disk:** grown before the EDINET drain; the alert stays.
- **Curation load:** Japanese and European catch-all members will flood `pending_segment_alias`, and
  new splits will not classify industries until members are aliased. A follow-up note covers this.
- **Rollback:**
  - each lane stops (schedules and sensors) and its `disclosure_source` row is disabled;
  - a source's rows can be deleted by `source_code`;
  - China pruning restarts by starting `cninfo_retention`.

## Deferred notes to write

- The SEC re-queue drain (A).
- The EDINET history drain, and amendments (docType 130).
- The ESEF drain, and re-filed reports.
- The China note re-fetch.
- Segment curation for `edinet:`, `esef:` and `cninfo:` members.
- Taiwan MOPS (F) result.
- English PDFs (G).
- Contract of `segment_parser.singleton`, with a drop date.

## Verification

- **Library:**
  - pytest over captured fixtures, where the right rule and the wrong one disagree (a reconciliation
    table summing to the anchor; an intersegment `計` row; a decimal-comma table; a geography table
    without a heading);
  - mutation runs with `PYTHONDONTWRITEBYTECODE=1`.
- **SQL:** each migration replayed on the node with mutations (`muffin-schema-change`), and validated
  against production rows in a rolled-back transaction.
- **Readers:** the gate over held documents (`gate_reader.sh`) before and after each reader change;
  every difference classified.
- **Live:**
  - per lane, a tiny subset whose outcome counters sum to `requested`;
  - then the sensors and backfills;
  - market-verify green;
  - `check_anon_read_latency.py` under budget;
  - the stock page rendered for the companies named above.
- **Yield:** the large-no-split count and its cap, re-measured after each step against 2,979 /
  $53.9 T.

## As built

### Steps 1a and 1b (2026-11-26)

muffin-deployment#548, muffin-ingest#205 (rolled 2026-11-26).

- **What shipped:**
  - `market.segment_parser` is keyed by regulator, with an FK to `disclosure_source`. sec, cninfo,
    dart and nse each start at 20; the rows are derived from `disclosure_source.enabled`.
  - `singleton` stays until [the contract](../deferred/2026-11-26-drop-the-segment-parser-singleton.md).
  - `market.segment_total_concept` is a control table that `ingest_rw` may read but not write.
  - Each lane's queue reads its own regulator's version (`segments.unread_sql`), and so does
    `vocabulary(conn, regulator)`, which raises when the row is missing.
  - `check_segments_reconcile.py` judges staleness per regulator.
- **`sec_instances_due` above its cap** still asks for chunks holding a filing filed in the last 14
  days.
- **WARN check `no_period_has_splits_from_two_regulators`** is on `security_classification`, not
  `sec_segment`: it is a property of the whole table, and the classification follows every lane.
  Baseline: 0 periods.
- **Live:** an AAPL reread at parser version 20 wrote 82 rows and changed 0.
- **Moved to later steps, from the plan above:**
  - `security_filer.via` goes to step 3b, where it is first written;
  - the floor helpers move to `lib/` in step 5, beside the first new lane that needs them.

### Step 2, A (2026-11-26)

muffin-ingest#206 (64 MB gate), #207 (fallback totals); muffin-deployment#549 (`held`, the
`fallback` column), #550 (rows and re-queue).

- **64 MB gate, no child process.** Measured in the production image, a 54.7 MB HSBC instance
  parses within the 2.5 GB code location. 56 of the 60 filings refused as too large are now under
  the gate; AEP's 128 MB stays refused.
- **No `reask_too_large`.** `SecInstanceRun.reread` (filer key → accessions) already names
  accessions to read again, so the 56 are one run with that config.
- **The concepts are FALLBACKS (`segment_total_concept.fallback`)**, consulted only when the regular
  vocabulary places no flat revenue split in a filing. As ordinary concepts they changed 24 filings
  of 13 companies that already had a split (Equinor FY2023: 155.9 bn → 106.8 bn).
- **`RevenueFromSaleOfGoods` is left out.** It is an IFRS component of revenue, and as a total it
  demoted Dr Reddy's, Buenaventura and Toyota.
- **Gate over all 10,309 held SEC annual filings (FY2023+) under the shipped rule:**
  - 2,825 filings of split holders unchanged;
  - 17 gain a revenue split. 15 are filings of companies with none (Goldman, Nomura, NextEra, DTE,
    XP, Community Financial). 2 are filings of companies holding a split from another filing:
    Spire, and Ferrovial, whose regions sum exactly to its 9,148 m total;
  - none changed a placed split.
- **`held` requires an annual accounts filing** from the filer's regulator (`filing_form`).
  Measured on production, rolled back:
  - 336 securities went from `held: sec` to `none`;
  - 52 from `held: nse` to `resolvable`;
  - 32 from `held: sec` to `resolvable: cninfo`;
  - 6 to `resolvable: dart`.

  The whole view reads in 152 ms.
- **Re-queue:** 1,943 filings of 656 filers (rolled back on production; nothing else was due).
- **Live, 2026-11-26 20:03–20:08:** the sensor drained all 1,943 filings in 74 runs, each
  succeeding:
  - stage 1: 400 instances fetched, 1,543 already held;
  - stage 2: 1,929 read, 14 too large.

  13 of the 656 companies gained a placed revenue split, 9 of them over $2 bn ($0.91 tn): Morgan
  Stanley, Goldman Sachs, NextEra, UBS, Rocket, DTE, Nomura, XP, Community Financial.
  - Every new split reconciles to within 0.4% of its target.
  - Morgan Stanley's business axis (one member, 46%) and NextEra's (NEER only, 32%; FPL is a
    co-registrant outside the segment axis) are partial disclosures, served with the remainder
    named. Both companies' regional splits are complete.
  - Novartis and Sanofi stay without splits because `RevenueFromSaleOfGoods` was left out.
- **The 56 filings over 32 MB** go through one backfill with `raw_sec_instance.reread`
  (`sskwxxck`, priority -1, launched 2026-11-27 00:40).

### Step 3, B (2026-11-27)

muffin-deployment#551 (deployed 2026-11-27), muffin-ingest#208.

- **`security_filer.via`** (`registry` | `issuer_sibling`). A registry always wins:
  - the SEC trigger, `apply_nse_symbol_map` and the CNINFO and DART assets claim their rows;
  - the SEC trigger no longer deletes a sibling row on a write naming a null CIK.
- **The rule is SQL:** `issuer_sibling_links()` and `extend_filers_to_issuer_siblings()`.
  - Sources are registry rows with an annual accounts filing; holes only; equities only.
  - An issuer holding two registry filers is refused.
  - A link the rule stops wanting is retracted, with the filings and segments it brought.
- **Deviation: the copy is general.** `filer_holders_to_copy()` names any holder with none of its
  filer's history beside a holder with some, so an H-share line CNINFO's HK list maps is copied
  too. On production it named exactly the 143 new links, so it changes nothing that already
  exists.
- **Deviation: no `security.cik` for same-country siblings.** Every sibling row carries segments
  only, US duplicates included (Honeywell, U-Haul and Greif rows with no listing). One rule, and no
  second copy of any company's statements.
- **Measured on production, rolled back:**
  - 143 links: cninfo 83, sec 43, dart 13, nse 4;
  - 4 issuers refused, each filing with SEC and its home regulator: Sinopec Shanghai, Dr Reddy's,
    Wipro, China Southern;
  - extend took 3.9 s;
  - Petrobras's lines: 4,496 filings and 379 segment rows each; Samsung preferred: 12 and 58;
  - ICBC's H-share: 61 filings, 0 segments (Chinese banks print no mandated table; step 6).
- **CNINFO's HK list** (`hke_stock.json`, 2,798 rows) maps 68 held H-share lines onto their
  A-share filer: 36 the issuer route reaches anyway, and 32 it does not, 29 of them large (Zhongji
  Innolight $78 bn, Hengrui, Hua Hong, SF Holding, Sany).
- **`FILERS` in CNINFO** took holders by joining each one's own six-digit listing, which silently
  dropped any holder without one. It now takes every holder, and the search code from any of them.
- **SEC fan-out:** the segment queries key on `security_filer('sec')`. The filer lane writes the
  filing list for every holder, and statements, profile, calendar and SIC for the CIK holders.
- **N-PORT issuer fill:** a held security gains the issuer its holding names, only where empty.
