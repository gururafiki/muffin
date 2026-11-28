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
- **Live, 2026-11-27** (rolled 09:09, `98ec00e8`; nothing in flight):
  - `cninfo_registry` by hand: 2,173 equities mapped, 0 unmapped; **68 H-share lines** onto their
    A-share filer (215 listed, 469 held H-share securities).
  - The N-PORT replay over the newest filing per fund (`guifrrkl`, 74 filings, 7 runs, priority
    −1): **525 issuers filled** (528 measured), 29 disagreeing and 16 conflicting left alone.
  - `filer_siblings` by hand: **132 links** (cninfo 68, sec 46, dart 14, nse 4), 0 retracted,
    **9 refused**; 198 holders copied, **69,712 filings and 45,895 segment rows**. The rolled-back
    measurement said 143 and 4: the HK registry now maps some lines the issuer route did, and the
    issuer fill joins more companies whose two filers both file accounts (21 issuers hold two
    registry filers, mostly an A-share filer plus an SEC CIK).
  - Rendered against live data: 005935.KS serves Samsung's FY2025 segments (DX ₩187.97T of the
    ₩363.72T the filing totals); 6031.HK serves Sany's FY2024 products (挖掘机械 CN¥30.37B,
    40.1%); PETR4.SA serves exactly what PBR does. Petrobras's split mixes country members with
    its segments and is shown as filed figures without shares, the same on PBR: a pre-existing
    SEC parse, not the copy.
  - `cninfo_retention` stayed RUNNING in stored state until `schedule-reset` (09:10): it pruned
    6,245 reports (7.5 GB) on 11-26 14:03-18:01 while pass 9 fetched, each read first.

### Step 5, C: EDINET validation (2026-11-27, against the real API)

The probe ran from the node, with the key passed by name.
- **The daily list keeps a rolling ten years.** `documents.json?date=…&type=2` answers 200 for
  every day, and its `metadata.status` is 404 (no results) for a day older than about ten years.
  Bisected 2026-11-27: the horizon lies between 2016-11-24 and 2016-11-28. A day falls off the API
  as time passes, so the history backfill runs oldest-first, and kept raw is the only copy of
  anything past the window. One list is 0.7 MB in ~1–2.5 s (2026-06-18: 720 documents, 154 annual
  reports; June 2017–2021: 2,096–2,801 documents a day).
- **An annual report** is `docTypeCode 120`, `ordinanceCode 010`, `formCode 030000`.
  `secCode` is five digits, the four-character local code plus a check digit (`72030`). Toyota
  (E02144) filed FY2026 on 2026-06-10, MUFG (E03606) on 06-24, Nintendo (E02367) on 06-25.
- **An archive** (`documents/{docID}?type=1`) is 0.6–2.6 MB and arrives in 3.6–8 s. Its instance
  is `XBRL/PublicDoc/jpcrp030000-asr-…xbrl`, 3.8–13.2 MB.
- **The segment note is one text block**:
  `jpigp_cor:NotesSegmentInformationConsolidatedFinancialStatementsIFRSTextBlock` (IFRS: Toyota,
  97 KB) or `jpcrp_cor:NotesSegmentInformationEtcConsolidatedFinancialStatementsTextBlock`
  (JGAAP: Nintendo 34 KB, MUFG 281 KB). MUFG also carries four narrower sub-blocks.
- **Shapes the reader must handle:**
  - **Toyota:** segments as columns (自動車, 金融, その他, 消去又は全社, 連結). The
    外部顧客への営業収益 row sums exactly to its 連結 column, 48,036,704 百万円, which is also the
    tagged consolidated figure; △ marks a negative. One table per year. A geography table follows,
    with the years as columns.
  - **Nintendo** reports one segment, so its split is the product table under 関連情報
    (ゲーム専用機 1,083,534 + IP関連収入等 81,388 = 1,164,922). Its geography table nests
    「うち、米国」 inside 米大陸, a subset; the four regions alone sum to its total (1,164,921 against
    1,164,922, rounding).
  - **MUFG**, a bank, states 粗利益 (gross operating profit, never revenue), a 顧客部門小計
    subtotal column, and nested rows using colspans. Its 営業純益 is the operating line.
- The archives are kept on the node at `/tmp/claude-edinet/` as fixtures until they are
  captured into the repo.
- **The anchors are not a fixed concept list.** Toyota tags its consolidated revenue
  (50,684,952 百万円) only under filer extensions: `jpcrp030000-asr_E02144-000:TotalNetRevenuesIFRS`,
  `SalesRevenuesIFRS`, `OperatingRevenueFromExternalCustomersIFRS` and
  `OperatingRevenuesIFRSKeyFinancialData`. No `jpigp_cor` concept carries it. Nintendo uses the
  standard `jppfs_cor:NetSales`. So the interpreter reverses the plan's lookup:
  - **A row's member sum is a total** when the filing holds a consolidated, non-dimensional
    duration fact of exactly that value, under any concept. The fact is consolidated when its
    context does not end in `_NonConsolidatedMember` (`CurrentYearDuration`, `Prior1YearDuration`).
  - **Which metric it is** comes from the matching concepts' local names and the row's label
    (外部顧客への売上高, 営業収益, 営業利益), kept as control rows. The value match is what makes
    the rule language- and taxonomy-independent; the name only chooses the metric.
  - The period comes from the matched fact's context (`CurrentYearDuration` 2025-04-01..2026-03-31),
    which also replaces parsing the heading's 前連結会計年度 / 当連結会計年度 text.
  - `segment_total_concept` rows for `edinet` remain only as a FALLBACK where no fact matches.
- **Old archives download while their list is inside the window**: Toyota 2017-06-23 (`S100AKEX`,
  0.69 MB) and 2021-06-24 (`S100LO6W`, 1.04 MB) both answered 200.

### Step 5, C: EDINET as built (2026-11-27)

**5a (muffin-deployment#554, deployed 10:44 UTC).**
- `market.segment_note_rule(regulator, rule, pattern, role, priority)` holds the note reader's
  vocabulary: block concepts (consolidated or not), heading kinds (business, product, geography,
  skip), label roles and concept roles. `ingest_rw` reads it and cannot write it.
- `market.edinet_document` is the catalogue: every annual report (120) and amendment (130) a day's
  list names, one row per document.
- `market.file_edinet_filings(p_edinet_codes)` files a mapped company's annual reports (ordinance
  010, form 030000, not withdrawn) into `security_filing`, and removes a withdrawn report's EDINET
  filing and segments, never a CNINFO row under the same accession. This is the user's choice of a
  document table over a replay job: a company mapped later gets its history by one call, with no
  request.
- The registry and the day lane both call it, scoped to the filers they touched.

**5b (muffin-ui#145).** `memberLabel` passes printed names through whole. Splitting at a case
change had damaged 142 of 25,521 CNINFO members.

**5c (muffin-ingest#210).** `defs/edinet/`, three lanes:
- The code list maps each Japanese equity by its four-character local code, from a JP listing or a
  `.T` symbol. A company holding a placed SEC revenue split in its last ~two fiscal years is left
  to the SEC and released.
- The day lane is one partition per day in Tokyo:
  - a held list is never replaced by a 404;
  - a list fetched ten days after its day is settled;
  - a run that did not hear every day claims none;
  - a withdrawal is only ever set.
- The filer lane fetches due archives newest first, in rounds across filers, and reads each report
  against its own figures.
- Everything ships STOPPED except `new_edinet_filers`.

**Read-only against production, before the PR.** The branch ran in a throwaway container with real
EDINET through http-cache and every write intercepted.
- **Registry:** 2,349 of 2,483 Japanese equities mapped. Eight are left to the SEC: Toyota, Sony,
  Honda, MUFG, Mizuho, Nomura, ORIX and Takeda. 126 are unmapped, mostly 2024-25 IPOs and J-REITs.
- **Days 2026-06-25 and 06-26:** 3,148 documents, 728 catalogued (604 annual reports of every
  ordinance), 4 withdrawals, filing scoped to the 657 filers touched.
- **Filer lane:** three reports read into 114 rows, all placed. Each FY2026 split reconciles to the
  report's own total:

  | Company | Split | Total |
  |---|---|---|
  | Nintendo | ゲーム専用機, IP関連収入等 | ¥2,313,051 m |
  | Makita | five regions, which are its reportable segments | ¥777,600 m |
  | Yellow Hat | カー用品, 賃貸不動産, その他 | ¥171,280 m |

The harness's interception missed a data-modifying CTE (`with released as (delete …)`), and the
read-only connection refused it. `readonly.SafeCursor` now intercepts that shape, and the runner
forwards `EDINET_API_KEY`.

### Step 6, E: China's segment note, validation (2026-11-27)

The three 2026 reports the plan names, fetched through the lane's own `cninfo.report` (the
http-cache held two of them) and kept on the node at `/tmp/claude-cnnote/` for fixtures.
Raw no longer holds their bodies: they were pruned on 2026-11-23, before decision 5 kept them.

| Report | Size | Pages | Outline | Note | Shape |
|---|---|---|---|---|---|
| ICBC 2025 | 9.3 MB | 408 | none | p.316 `五、分部信息`; summary p.44 `经营分部信息概要` | summary: rows `营业收入` 838,270 then 公司金融 410,676 / 个人金融 327,739 / 资金 93,990 / 其他 5,865, amount and share columns per year, like the `营业收入构成` table |
| Ping An 2025 | 9.5 MB | 370 | 41 entries, none for segments | p.245-252 `七、分部报告` | segments as columns (寿险及健康险, 财产保险, 银行, 资产管理, 金融赋能, `其他业务及合并抵销`, 合计); `营业收入合计` 502,171 + 353,272 + 131,442 + 51,346 + 49,358 + (37,083) = 1,050,506 |
| PetroChina 2025 | 9.4 MB | 273 | none | p.177 `60 分部报告 (1) 经营分部` | segments as columns (油气和新能源 … 总部及其他, 合计); `对外交易收入` sums to 2,864,469 = 合计; `分部收入` and `减：分部间交易收入` rows above it |

What this changes in the plan:
- **The outline cannot find the note.** Two of three reports carry no outline, and the third's
  outline has no segment entry. The note is found by a text scan for its heading (`分部报告`,
  `分部信息`, `经营分部`); the scan already finds every candidate page in under a second.
- **The tables are EDINET's shapes, drawn in PDF positions.**
  - Segments are columns, and metric rows include a total.
  - An eliminations column (`其他业务及合并抵销`) is part of the sum, as `消去` is in Japan.
  - Column headers wrap over two lines (`油气和` / `新能源`, `寿险及` / `健康险`).
  - Negatives are in parentheses, the unit is 人民币百万元, and `–` is an empty cell.
  - So the note stage builds a grid from `cn_pdf`'s positions and hands it to
    `facets.segment_note`, anchored on the note's own 合计 column, as planned.
- **The bank summary is the composition shape.** ICBC's page 44 is a heading plus a total row
  with members below it, with amount and share columns. It may be read by the existing
  composition reader under a new heading, without the note stage. Decide that when building.
- **No report is near the size gate**: 9.3-9.5 MB against `MAX_PDF_BYTES` 12 MB.

**5d, live on a tiny subset (2026-11-27, 14:16-14:25 UTC).**
- **Roll:** #210 rolled at 14:17. All three services moved to `a4a25b88`, gRPC was SERVING and the
  location LOADED. No run was in flight, and pass 10 had finished.
- **Registry** (`e9645183`, 47 s): 3,811 codes; of 2,483 Japanese equities, 2,349 mapped, 8 left
  to the SEC, 126 unmapped. `filed` 0, because the catalogue was still empty.
- **Days 2026-06-24..26** (`klaugxhi`, one run, 30 s):
  - 3 lists answered (4.5 MB fetched, 500 KB on disk);
  - 4,776 documents, 1,182 catalogued (1,006 annual reports);
  - 6 withdrawals named, 1,074 filers touched;
  - **527 annual reports filed for 527 mapped securities**, all due.
- **Filers** Advantest (E01950, IFRS), Nintendo (E02367) and Tokio Marine (E03847, an insurer)
  (`vhhqudhy`, one run, 44 s): 3 archives (3.85 MB) answered and read; 53 rows, all placed;
  3 marked.
- **Served** (`security_segment_current`, read per security):

  | Company | Split | Total |
  |---|---|---|
  | Nintendo | ゲーム専用機 96.8% / IP関連収入等 3.2%; four regions | ¥2,313,051 m |
  | Advantest | テストシステム 90.3% / サービス他 9.7%; four regions | ¥1,128,610 m |
  | Tokio Marine | revenue 損害保険 84.8% / 生命保険 15.2% | ¥7,693,560 m |

**Two defects the first live read found, fixed before the history drain.**
1. **Tokio Marine's profit split held a total.** Its table heads the consolidated column
   `連結合計`, and the total label knew only `連結` and `合計`. As a member, the column pushed the
   sum to ¥1,081,201 m, which `_close` (0.05%) matched to `jpigp_cor:SubtotalOpeCFIFRS`, an
   operating cash-flow subtotal of ¥1,080,955 m.
   - Fix: `連結合計`/`連結計` become total labels (muffin-deployment, with EDINET's parser
     version raised to 2).
   - Fix: a match's slack becomes the table's own rounding, one unit per member plus one and
     never over 0.05% (muffin-ingest#211).
   - The gate over 41 held reports changed 3, each a correction. S100YGOV lost a comparative
     split matched to the wrong concept 24 units off. S100YIA0's segment assets, matched to cost
     of sales, moved to their own year.
2. **Advantest also serves its 2014 SEC split** (`us-gaap:StatementBusinessSegmentsAxis`, from its
   last 20-F) beside the 2026 EDINET one. `security_segment_current` takes each axis's latest
   period however old, so a company that left one regulator keeps showing its last split from it.
   This predates EDINET and is recorded for a decision.

**The history drain, measured:**
- **Day lists:** ~3,650 days in ~122 runs of 30, ~2.5 hours, a few hundred MB.
- **Archives:** ~2,349 filers × up to 10 reports ≈ 23,000 archives at ~1 MB, so ~23 GB against
  81 GB free, and ~39 hours at ~6 s each.
- **The pool trap:** a run holds every pool its steps declare, so archive runs that also write
  stage 2 would hold `sql` for up to 15 minutes each. The drain therefore runs stage 1 alone on
  `edinet` and stage 2 as a separate, request-free backfill, as DART's did.

**Fixes live (14:38 roll of muffin-ingest#211, 14:45 deploy of muffin-deployment#555).** The
re-read (`ovsmyfpc`) asked EDINET nothing, because the three archives were held. It read all three
at version 2: 64 rows, 16 changed, the `連結合計` member retracted, and 8 profit rows left
honestly unplaced.

**Decisions (the user, 2026-11-27).**
- **The full ten years now.** Days go oldest-first, because the API's window drops a day each day.
  Then every archive on the `edinet` pool alone, then the request-free read. After that the
  schedules and the due sensor go on, and `edinet` is enabled.
- **Each company serves only its newest regulator.** `security_segment_current` serves only the
  source whose newest period is the company's newest, so Advantest's 2014 SEC split stops showing
  beside its 2026 EDINET one. Older regulators' rows stay stored.

- **A bank's business split is its own metric, `total_income`.** Santander tags it
  `ifrs-full:GrossProfit`, MUFG's note says 業務粗利益, and ICBC's summary calls it 营业收入. It is
  reconciled against the filing's own total-income figure and labelled "Total income" on the page,
  and classification reads it like revenue. It is never stored as revenue.
  - **Scope: follow the filing.** Only where the filing itself does not call the line revenue:
    Santander's `GrossProfit` (a bank's only, by industry) and MUFG's 業務粗利益. The 146 banks
    already serving a split their filing calls revenue stay revenue, and China's banks are read as
    revenue from 营业收入, so step 6 needs no new metric.

**Newest regulator only, as built (muffin-deployment#556).**
- **Affected today:** three securities: 6857.T, and 338.HK with 600688.SS (Sinopec Shanghai
  Petrochemical: SEC FY2022 beside CNINFO FY2015). Every Japanese company that once filed a 20-F
  joins them as the EDINET drain fills.
- **Where the choice is made:** in `security_segment_current`. Everything below `pivoted` is keyed
  by regulator, because SEC 20-F filers and DART share IFRS axis strings. A window then ranks the
  regulators per company: newest annual period, then `data_source.priority`. The result is filtered
  last. The instant laterals are bounded to the chosen regulator.
- **Who reads it:** `source_code` is appended to `current`. `security_segment_detail` and
  `check_segments_reconcile.py` read the choice from there rather than deriving it again.
- **Rejected first: a shared view joined into `newest`.** On production's plan the join collapsed
  the row estimate to 1. The planner then put the whole of `security_segment_latest` on the inner
  side of a nested loop, and a third parallel hash ran out of the database container's 256 MB
  `/dev/shm`. The whole read is the spine's refresh, so that plan would have broken it. A filter
  applied after the windows cannot change how anything beneath it is joined.
- **Rolled back on production:**
  - 49,894 -> 49,872 rows; the 22 removed are exactly the three securities, and nothing is added;
  - 19 other securities identical in both views;
  - AAPL 6.5 ms old vs 6.4 ms new;
  - a whole read 46 s.
- **Guard:** six mutations caught.


### Step 6, E: China's segment note, as built (2026-11-27)

muffin-ingest#212 (the reader, the 48 MB gate) and muffin-deployment#558 (the vocabulary, the axis,
the re-queue).

**What it is.** `facets/cn_note.py` builds the note's grid from `cn_pdf`'s text positions and reads
it with `facets/segment_note.read_grid`, the interpreter EDINET's notes use. Each metric row is
anchored on its own `合计` cell. The stage runs only when no main-business table was read, so every
report read before reads as before. It is on only while `segment_note_rule` holds the `cninfo`
rows, which let the image roll ahead of the deploy.

**The gate over the 88 large companies (FY2025, on the node, 768 MB child).** Four runs, each fixing
what the last one showed:

| Run | Revenue split (note + main) | Change |
|---|---|---|
| first reader | 10 + 11 | finds the note only on pages naming it; 4 of the 10 by luck (below) |
| + labels, pages, members, 未分配, years | 12 + 11 | China Life, CITIC; Qilu correctly dropped |
| + unit carry, captions, three-line headers | 12 + 11 | Qingdao Rural restored, SF Holding exact |
| + date-and-year caption, bare unit, gross rows, own rounding | **14 + 11** | China Merchants Bank, Bank of China |

All 25 splits reconcile exactly, and 3 more place operating income only. The causes for the other
60 are in `docs/deferred/2026-11-27-what-china-s-segment-note-reader-cannot-read-yet.md`.

**Rules the reports needed** (each with a test, 16 of 16 mutations caught):
- **A row label's numbering is not the label.** Bank of China and China Life write `一、营业收入`.
- **The pages after the note's heading are read, though they do not name it.** Industrial Bank and
  Bank of Communications print the tables on later pages with no running header naming the note.
- **Across a gap, the heading resets and the unit carries on.** A heading carried from the
  accounting policies (`23 分部报告`) would claim a table 100 pages on. The unit, though, is stated
  once for all the notes: SF Holding states it 60 pages before its segment note. The first version
  reset both, and lost SF Holding and Qilu.
- **A caption above a header reaches back to the row labels.** China Merchants Bank's
  `(a) 分部业绩、资产及负债` was being merged into the header. A header can also wrap below its
  total line: Qingdao Rural's `公司银行业` / `务`.
- **A year under each segment splits its column.** China Merchants Bank prints 2025 and 2024 side by
  side. The newest year is chosen by value; the fixture puts 2024 first. A date line under the years
  makes the table a balance sheet.
- **A table of places is geography, whatever its heading says.** This is the new `member` rule
  kind. Bank of China prints 境内 / 中银香港集团 / 其他国家和地区 under `分部报告`, and Qilu
  prints 济南地区 / 济南以外地区 under `2. 业务分部`. Qilu's had been read as business before this
  rule.
- **A gross row beside an elimination column reconciles to the total less the eliminations.** Bank
  of China's segments total ¥663,127 m, its 抵销 column removes ¥4,817 m, and the printed total is
  ¥658,310 m. Both figures are offered as anchors, and the members' own sum chooses.
- **A note's split must add up within its own rounding,** one unit per member and one more, not
  XBRL's 0.5%. Under the old tolerance, Bank of China's 2024 members without 投资银行业务 passed as
  the whole split, 0.42% off. This is a `to_rounding` flag on `read_grid`, which EDINET does not
  set.
- **`未分配` is a member.** SF Holding's carries ¥1,458 m of external revenue, and without it the
  split is 0.47% short.
- **Units.** Two more phrasings state a unit: `货币单位均以人民币百万元列示` and a bare
  `（人民币百万元）` caption.

**Four of the first reader's ten were luck, and the gate showed it.** Qilu's read was a geographic
table taken as business. SF Holding was placed 0.47% short, because the 0.5% tolerance admitted the
split without 未分配. Bank of China's 2024 was a subset. Only the reconciliation column of the gate
showed these: "it read something" said nothing about whether it read the right thing.

**The size gate: 12 MB to 48 MB.**
- **Reach:** 26 of the 88 file over 12 MB, and banks file 20-36 MB. 11 of those 26 then read from
  their main tables, which the gate alone had been refusing.
- **Cost:** the largest (36.1 MB, 454 pages) reads in 5.1 s, none takes more than 9.4 s, and none is
  unreadable at 768 MB.
- **Re-asking:** a report refused for its size is fetched again once it is due again. Before this, a
  held `too_large` answer counted as held for ever.

**The gate over held reports.** Every fourth report raw holds (1,626) was read by the running
image's reader and by the branch's. On the first reader: 1,234 unchanged, 389 empty in both, 3
gained (PetroChina 2008 among them), 0 changed or lost. The re-run on the final code is recorded in
`todos.md`.

**The re-queue.** The one-shot sets FY2023+ CNINFO full reports read into no rows back to version
0. Measured: 806 reports across 414 securities, out of 7,202 read; ~6 GB to fetch again, with
`/mnt/data` at 80 GB free. It drains by a paced `cninfo_segments` backfill.

**Each company is served only its newest year (the user, 2026-11-27; muffin-deployment#559).**
Rendering SF Holding after the note went live showed its page leading with FY 2016 product and
region splits from its main tables, above its 2025 operating segments: `security_segment_current`
served every axis at that axis's own newest period. Measured on the spine, 288 securities were
served a `srt:` axis over a year older than their newest split, 209 a CNINFO one, 138 a `us-gaap:`
one and 90 an `ifrs-full:` one. Within the regulator a company is served from, only axes at the
company's newest annual period are served now. It is one predicate on the filter applied last
(`p.period_ending = p.source_newest`). `security_segment_detail` serves a cross-tab only at a
period `current` serves, and the reconcile guard's "served" follows.
- **Rolled back on production:** 49,969 -> 46,223 rows. The 3,746 removed are spread over 877
  securities, nothing is added, and no security is left empty. SF Holding loses three 2016 axes,
  TSM one 2015 axis, and Toyota four axes older than its FY2026. AAPL, MSFT, Samsung, SAP, Bank
  of China and Advantest are unchanged.
- **Accepted cost:** a filer that drops a split in its newest year loses it from the page until it
  reports one again (Toyota's 2025 geography).

### Step 7, D: ESEF via filings.xbrl.org, validation (2026-11-28, against the real API)

Nine filers by LEI, from this machine at 8 s pacing (no 429 met). Each filing list arrived whole in
one response, with no `next` link (Novo Nordisk's 24 filings in one page). The newest annual
xBRL-JSON report and its segment text block were read for each.

| Filer | Language | Numbers | Unit line | Block | Tagged anchor |
|---|---|---|---|---|---|
| L'Oréal FY2025 | FR | `5 163,0` | `En millions d'euros` | 7 tables, divisions as rows; four divisions sum to 44 052,0 | `Revenue` 44,052.0 m |
| LVMH FY2024 | FR | `40 990` | `(en millions d'euros)` | 6 tables | `Revenue` 84,683 m |
| Schneider FY2025 | FR | `33 130` | `(en millions d'euros)` | 4 tables, segments as columns; two blocks | `RevenueFromContractsWithCustomers` 40,152 m |
| Iberdrola FY2025 | ES | `16.845` | in prose only (`expresado en millones de euros`) | 8 tables, business and geographic | `Revenue` 44,076 m |
| Inditex FY2025 (Jan) | ES | `28.249` | none found | 3 tables | `Revenue` 39,864 m |
| Atlas Copco FY2025 | SV | `76 513`, minus as `–88` | none found | 8 tables, columns, `Elimineringar`, `Gruppen` | `Revenue` SEK 168,343 m |
| Enel FY2024 | EN | `10,355` | footnotes only | 9 tables; text broken by spaces (`P erformance`) | `Revenue` 73,914 m |
| ASML FY2025 | EN | `21,622.4` | `(€, in millions)` | 4 tables (one segment; product and geography) | `RevenueFromContractsWithCustomers` 32,667.3 m |
| Airbus FY2025 | EN | `52,577` | `(In € million)` | **no `<table>`**: positioned divs | `Revenue` 73,420 m |
| Novo Nordisk | EN | — | — | the newest filing is a Q3 interim with no segment block | — |

What this changes in the plan:
- **Each table has its own number convention, and the interpreter knows only one.**
  `segment_note.number` reads `,` as thousands and `.` as the decimal point, so L'Oréal's `5 163,0`
  would read as 51,630. Each table's convention is decided from its own cells:
  - space, NBSP and thin space are always thousands separators;
  - a separator followed by one, two or four or more digits at a cell's end is the decimal mark,
    and where both `.` and `,` appear, the later one is;
  - a lone `.` followed by exactly three digits is a thousands separator (Iberdrola).

  EDINET is unaffected: its tables already follow the default, which is `,` for thousands.
- **The unit is inferred from the anchor, not from a unit line.** Iberdrola, Inditex and Atlas
  Copco state their unit only in prose or not at all, and the phrases differ by language
  (`millions`, `millones`, `MSEK`; French `billion` means 10¹²). Every placed split must already
  reconcile to a tagged consolidated figure, so the table's scale is the one of 1, 10³, 10⁶, 10⁹
  under which one of its lines meets an anchor. A wrong scale cannot reconcile to a figure tagged
  to the unit.
- **Annual reports are told apart from interims by the company's fiscal year end.** The list carries
  no report type, and some filers (Novo) file every quarter. `market.fiscal_calendar` covers 935 of
  the 985 European equities holding an LEI. A filing is annual when its period end falls within ten
  days of that year end; without a calendar, December 31.
- **Durations end exclusive** in xBRL-JSON (`2025-01-01T00:00:00/2026-01-01T00:00:00`), so the
  anchor's end is the day before.
- **Divs are not read.** Airbus's block holds no `<table>`. It is counted and skipped, as planned.
- **Size:** reports run 2-27 MB, so ~985 filers × ~5 years is ~35 GB of JSON, kept whole by decision
  3 (perhaps ~6 GB as compressed Parquet), against 73 GB free.
- **Nothing for ESEF is seeded yet**: no `xbrl-org` data source, no `esef:` axes, no rules and no
  parser row. Step 7 therefore has a schema half, as step 5 did.

### Step 7 as built (2026-11-28): muffin-ingest#213, muffin-deployment#560

**The reader.** `facets/esef` loads a report's facts, takes every non-dimensional monetary fact as
an anchor, and reads the note blocks in order with `segment_note.read_note(detect_numbers=True,
infer_scale=True)`, stopping at the first block that places a split. The gate over nine captured
reports found eight European table shapes the Japanese interpreter could not read. Each is now a
rule for European tables only (`NoteVocabulary.spaced`), mutation-proven; Japanese and Chinese
tables take none of these paths:

| Rule | Found on |
|---|---|
| A row whose every figure is a year, beside a name or with two of them, is a header | Atlas Copco (`2025` above the names), Inditex, ASML |
| A column's name is its own header cells joined; a cell spanning neighbours is a group header, and a year is never part of a name | Schneider (`Gestion de` over `l'énergie`), Enel, Inditex |
| A label-only row opening in lower case continues the label above | Enel (`Revenue and other income` / `from third parties`) |
| Segments stated before eliminations reconcile to the total less them, offered only when the members add up to it | Inditex (40,107 against a tagged 39,864 €m), Iberdrola (before discontinued operations) |
| A kind named in prose is local to its table; a table with none is business unless its members are places | Iberdrola (its business table followed a "by geographic location" sentence) |
| In a sentence, the kind nearest the table wins | Inditex (the customers' location, then the geographic table) |
| The first table to state a split keeps it | LVMH (a quarterly table restating the year gross of intra-group sales) |
| A cross-reference is stripped from a name | Iberdrola (`México (Nota 18)`) |

Two further rules, joining a heading broken mid-word and blanking `sin dato` cells, were removed
because no report read differently without them.

**The lane** (`defs/esef/`), DART's shape:
- `security_esef_filer` maps each equity in the ten covered countries whose N-PORT issuer holds an
  LEI, and releases the SEC's split holders (decision 2). It asks the index nothing.
- `raw_esef_filings` (pool `xbrl_org`, 8 s pacing, 15-minute budget, reports kept whole): a filer's
  list, then its annual reports not yet read. Annual reports are told from interims by the fiscal
  year end (±10 days; 31 December without a calendar). Of a period filed twice (Inditex's `-0` and
  `-1`), the one the index added last is read.
- `esef_segment` files the annual reports into `security_filing` (`report_type` `AFR`, source
  `xbrl-org`) and reads each due report, one transaction per report.
- `every_esef_filing_was_read` (WARN). `new_esef_filers` runs; `esef_registry` (Mondays 07:55 UTC)
  and `esef_filers_floor` (daily 09:15 UTC) ship STOPPED.

**Validated read-only on the node** (three filers, the real index, production rows): 3 lists, 17
annual reports of 22 listed, 69 MB, no refusal at 8 s, 2 min 55 s; stage 2 read all 17, placing
1,022 rows with none unplaced or failed. L'Oréal's FY2022-FY2025 reports each place three axes
reconciling to the tagged revenue; FY2020-FY2021 reports (108-185 KB) carry no note block, since
ESEF required block tagging from FY2022. Misses:
`docs/deferred/2026-11-28-what-europe-s-segment-note-reader-cannot-read-yet.md`.
