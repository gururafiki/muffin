# The venue directory, one partition per question — design

Status: APPROVED 2026-10-04 (D1 P1, D2 control tables, D3 automatic, D4 follow-up PR before Stage 4).
BUILT 2026-10-04: D1–D3 in muffin-deployment#412 and muffin-ingest#92; D4 in muffin-deployment#413
and muffin-ingest#93. Rolled together at 09:47 UTC; the first pass is backfill `eaapxywk`.
Built the same day: muffin-deployment#412 (control tables, view, bundle) and muffin-ingest#92 (the
lane). See "As built" for where the build departs from the design and why. Extends
[2026-09-26-finishing-the-universe-family.md](2026-09-26-finishing-the-universe-family.md) (Stage 2:
listings come from the directory). Resolves
[docs/deferred/2026-09-27-the-us-directory-stops-at-15000.md](../deferred/2026-09-27-the-us-directory-stops-at-15000.md).

## Context

The OpenFIGI venue directory (`raw_exchange_sweep` → `market.venue_listing`) is what the listing
derivation, the Markets search ("listed, not tracked") and, from Stage 4, promotion are built on.
It has two gaps, measured 2026-10-03:

1. **The US walk stops at 15,000 of 20,098 lines**, so US listings created since ~2022 are missing
   (BellRing, Loar, Paramount Skydance, Sharplink).
2. **Every venue is asked only for `securityType2: Common Stock`.** REITs, depositary receipts and
   partnerships are separate OpenFIGI types, so none is in the directory on any of the 59 venues:
   Prologis, American Tower, British Land, the TSMC and Alibaba ADRs, Energy Transfer.

Decided 2026-10-04: add a NYSE Arca walk for new US listings, and ask every venue for REIT,
depositary receipt and partnership lines as well as common stock. The user is fine with re-walking
the whole directory, so the partitioning should be whatever fits best.

## Current state

Measured 2026-10-03/04.

- **Partitions:** `exchange_sweep`, one dynamic key per venue (`US`, `LN`, … 59), seeded weekly by
  `new_exchange_sweeps` from `market.exchange`. One key = one `/v3/filter` walk `{exchCode,
  securityType2: Common Stock}`, resumed by the cursor stored in the file.
- **Refresh:** none automatic. A re-walk is an operator backfill; the 30-day freshness policy is
  descriptive only (the skill puts freshness on scheduled assets).
- **Directory:** 99,459 rows, all `Common Stock`. `last_seen_at` is never refreshed (the upsert does
  not write it), and nothing marks a line the provider has stopped returning: the 2026-09-21 load
  found ~1,464 delistings the old table never retracted.
- **Readers:** `derive_security_listing` (by share class), `untracked_listing` (Markets search),
  `promote_listing` (Track button), `listing_covers_legacy`, `venue_sweep_reached_its_last_page`. None
  filters on type, so new types flow through without changes.
- **Gap, by cause** (505 tracked securities with a legacy US primary and no derived US line): cap 201,
  REIT 175, depositary receipt 86, OTC past the cap 26, unclassified 17.

## Validation

- **The cap is the documented contract.** OpenFIGI's documentation for `/v3/search` and `/v3/filter`,
  re-read 2026-10-04: "Max Results: 15,000 · Max Results Per Page: 100 · Max Amount of Pages: 150",
  the same with or without a key. Results are "listed alphabetically by FIGI". `start` is the
  pagination parameter: "the response will contain a next property whose value should be sent in
  succeeding requests as the value of the start property".
- **Our walk used `start` exactly so.** The stored US file holds pages 0..149, each fetched with the
  previous page's `next`. Page 149 is full (100 rows) and has no `next`, while `total` is 20,096; held
  15,000, last FIGI `BBG013JYT8V4`.
- **Splits measured 2026-10-03:**

| Query | Total | Verdict |
|---|---|---|
| `US`, Common Stock | 20,098 | capped |
| `UP` (NYSE Arca), Common Stock | 5,541 | covers every exchange-listed US stock; each line's `compositeFIGI` is the `US` line |
| `US` + `stateCode` (127 codes) | 14,261 in total, largest 1,511 | new listings carry no state: rejected |
| `micCode` | cannot be combined with `exchCode` | rejected |
| `US` REIT / Depositary Receipt / Partnership Shares | 435 / 2,719 / 52 | all under the cap |
| `LN` REIT / Depositary Receipt | 154 / 139 | |
| `SP` REIT, `CN` REIT | 39, 42 | |

## Decisions

### D1. Partitioning — what is one partition?

The provider's unit of work is one `/v3/filter` query `(exchCode, securityType2)`: its own `total`,
its own cap, its own cursor, its own completeness. There are 237 of them (59 venues × 4 types, plus
NYSE Arca).

| Option | Shape | For | Against |
|---|---|---|---|
| **P1. One partition per query** (recommended) | dynamic keys `US.common`, `US.reit`, `US.dr`, `US.partnership`, `US.arca`, `LN.common`… | Matches the provider's grain (rule 6): one key = one walk = one completeness claim and one cursor. A capped split such as NYSE Arca is just another query. Runs chunk cleanly with `multi_run`. | No two-dimensional grid in the UI; the key format is our convention. |
| P2. Venue × type grid | `MultiPartitionsDefinition(venue: dynamic, type: static)` | Dagster draws a venue × type grid; a backfill can select a row or column. | NYSE Arca does not fit: either a fake venue `UP` crossed with all four types (three wasted walks), or two walks hidden inside the `(US, common)` cell. The type list becomes code. A multi-partition run is a start/end pair, which in two dimensions is a rectangle, so a run can pull in cells nobody asked for (`get_partition_keys_in_range` is a cross product); it would need `multi_run(1)`. |
| P3. One partition per venue, all its queries inside | keys unchanged | No re-walk; "venue V is complete" in one claim. | Coarser than the provider's grain: one throttled query leaves the venue half-current, and the file needs a cursor per query. A US run is ~240 requests. |

**Recommendation: P1.** Re-key all 59 existing walks to `<venue>.common` and re-walk once (~1,300
requests, ~65 minutes keyed). Delete the 59 old keys afterwards; their raw files stay as the backup.
The asset, check and partitions-definition names stay: names are state, and nothing needs renaming.

### D2. Where the list of queries lives

| Option | For | Against |
|---|---|---|
| **Control tables** (recommended): `market.directory_type` (Common Stock, REIT, Depositary Receipt, Partnership Shares) × enabled `market.exchange` rows, plus `market.directory_alias` for a query filed under another venue (`US.arca`: asks `UP`, files under `US`). A view `market.directory_query` is their union; the sensor seeds keys from it. | The skill's rule: lookups and editorial choices are rows, changed without a deploy. A new exchange gets every type automatically. Adding `Unit` for Toronto later, or splitting Frankfurt when it passes the cap (14,205 today), is a row. | A migration and a deployment PR beside the ingest PR. |
| Code constants in `defs/discovery/partitions.py` | One PR; simpler to read. | A new type or split is a code change and an image roll, against the project's own rule. |

### D3. When the directory refreshes

| Option | For | Against |
|---|---|---|
| **Automatic** (recommended): `on_cron` monthly (all queries), `on_missing()` (a new key is walked when added), and a resume of an unfinished walk. All built-in and serialisable, so the default automation sensor evaluates them. As built, the resume is a sensor (`unfinished_sweeps`), not `any_checks_match(check_failed())`; see "As built". | The directory stays current without anyone remembering; a throttled walk resumes itself. The freshness policy then describes a scheduled asset, as the skill requires. | ~1,300 keyed requests a month on OpenFIGI's filter budget, which nothing else uses. |
| Operator backfills, as today | Nothing spends unless someone asks. | The directory silently ages; the freshness policy fails with nothing alerting (Dagster OSS does not alert on it). |

Needed either way: the CAPPED verdict moves out of `venue_sweep_reached_its_last_page` into its own
non-blocking check. Otherwise the capped `US.common` would fail for ever, and with D3's resume branch
it would be re-asked every 15 minutes.

### D4. Lines the provider stops returning (delistings)

Today nothing retracts them; Markets search offers them as "listed, not tracked", and Stage 4 would
promote them. A complete walk is a completeness claim, so it can say what is gone.

| Option | Shape |
|---|---|
| **Follow-up PR, before Stage 4** (recommended) | Stage 2 stamps `last_seen_at` with the page's `fetched_at`. A small unpartitioned asset marks `delisted_at` on lines of a (venue, type) scope not seen since the oldest latest complete walk among the queries covering it (for US common stock: `US.common` and `US.arca` together). Marked, never deleted: `security_listing` keeps its foreign key and the history stays readable. `untracked_listing` and `derive_security_listing` exclude marked lines. |
| In this change | Same design, one larger PR. |
| Never | Search and promotion keep offering delisted companies. |

### Not open (stated for review)

- **NYSE Arca lines become their `US` line in stage 2.** Raw keeps the Arca pages verbatim. Stage 2
  emits `figi = compositeFIGI`, filed under `US`, and drops (and counts) a line without one. A
  separate `UP` venue in `venue_listing` was rejected: every rule that picks "the" US line would then
  see two.
- **Raw gains the request's `security_type2`** beside the `exch_code` it already records. An empty
  page carries no rows to read the type from, so this is request context (raw rule 3c).
- **Pools unchanged:** `openfigi_filter` (limit 1) for raw, `sql` for stage 2. Width: one query per
  raw run (`multi_run(1)`), see "As built"; stage 2 keeps `multi_run(4)`.
- **Not asked:** `Unit` (Toronto income trusts, 39, but also SPAC units elsewhere) and OTC lines past
  the cap (no filter reaches them; the 26 tracked ones are reachable on their home exchange).

## Data model

- `market.directory_type(security_type2 pk, key_suffix unique, enabled)`. Seeded with Common Stock
  `common`, REIT `reit`, Depositary Receipt `dr`, Partnership Shares `partnership`.
- `market.directory_alias(query_key pk, exch_code_asked, files_under → exchange, security_type2 →
  directory_type, enabled, reason)`. Seeded with `US.arca`.
- `market.directory_query`, a view over both: `query_key, exch_code_asked, files_under,
  security_type2, maps_to_composite`.
- Grants: select to `ingest_rw` and `metrics_ro`; `anon`, as every non-`pending_` view requires.
- `venue_listing` is unchanged in this part. D4 adds `absent_since` (named in "As built — D4").

## Architecture

| asset | stage | partitions | automation | pool | writes | checks |
|---|---|---|---|---|---|---|
| `raw_exchange_sweep` | 1 | `exchange_sweep`, one key per query | D3 | `openfigi_filter` | Parquet, one walk per key | `venue_sweep_reached_its_last_page` (finished); new `directory_query_within_the_cap` (WARN; a capped scope with a finished covering alias passes, naming it) |
| `venue_listing` | 2 | same | `eager()` | `sql` | `market.venue_listing` upsert on `figi` | — |
| `security_listing` | 3 | unpartitioned | unchanged | `sql` | unchanged | `listing_covers_legacy` |

Sensor `new_exchange_sweeps`: same name; reads `market.directory_query`; interval 1 day instead of 7,
so a new row is walked within a day.

## Rollout

1. muffin-deployment: migration and repeatable bundle for the control tables and the view.
2. muffin-ingest: raw records `security_type2`; the stage-1 query lookup; stage 2's composite mapping;
   the check split; the sensor; D3's condition; tests (Arca → composite, a line with no composite
   dropped and counted, a capped scope covered by a finished alias, the sensor's keys); local tiny run
   (`US.partnership`, one page).
3. Roll. Let the daemon evaluate the new condition once BEFORE the 237 keys exist: `on_missing()`
   treats a key already missing at its first evaluation as handled (measured on 1.13.22). Then the
   sensor (or a hand `add_dynamic_partitions`) seeds them and `on_missing()` walks them (~1,300 keyed
   requests, ~65 minutes, all past the cache). Read every counter: pages per key, rows per type,
   Arca lines mapped and dropped.
   **As rolled:** the sensor's last tick was 09-28 under the old 7-day interval, so under the new
   1-day interval it fired at 09:47:09, 15 s before the daemon's first evaluation of the new
   condition (09:47:24, which requested nothing). The 237 keys therefore counted as handled, and the
   first pass was launched as backfill `eaapxywk` at 09:48:43. The monthly tick and every later key
   are unaffected. One measurement from it: the first two walk runs overlapped for 17 s despite the
   pool's single slot; every later run waited, and the daemon logged the pool blocking them.
4. Delete the 59 old keys. Verify BellRing, Loar, Paramount Skydance, Sharplink, Prologis, TSMC's ADR
   and Energy Transfer each have a `US` line, and re-run `listing_covers_legacy` (expect ~460 of the
   505 recovered).
5. Re-time `untracked_listing` as anon, best of 3; extend the universe dashboard (lines by type,
   unfinished and capped queries).
6. D4's follow-up PR, then Stage 2c.

## As built (2026-10-04)

Five places where building it changed the design, each found by reading the code or the provider,
not by a failure:

| Design said | Built | Why |
|---|---|---|
| Resume via `any_checks_match(check_failed())` | Sensor `unfinished_sweeps`, every 15 minutes, requesting each walk whose file ends in a cursor; run key `query:cursor-hash:hour`; tag `muffin/sweep_resume` makes the run resume-only | A check on a partitioned asset is unpartitioned in Dagster 1.13, so its status is the whole grid's: the condition would have re-walked all 237 queries the moment one stopped |
| `multi_run(4)` | `multi_run(1)` | A successful run claims every partition it covers. With four a run, a refusal in one left the rest unasked and claimed: a new query read as walked, a refresh as done |
| (not considered) | Every `/v3/filter` page bypasses http-cache | The cache keeps an OpenFIGI 200 for 90 days keyed on the request body, and a monthly re-walk sends last month's bodies: the refresh would have replayed old pages for three months |
| A throttle stops the walk | The same page is asked again after 65 s, twice; past that, the run stops and files what it has; a run that fetched nothing fails | Keyed pacing (3 s) is 20 a minute, the bucket's refill rate, so a refusal is ordinary. Failing an empty run loses nothing and claims nothing |
| Checks per run partition | Both checks answer for the whole grid on every evaluation; a cap passes only when a FINISHED alias covers it | Same unpartitioned-check fact: a partition-scoped check reported whichever query ran last |

Also: `ingest_rw` holds no DML on `directory_type`/`directory_alias`. Legacy migration 206's default
privilege granted it on every new `market` table, and 207 revoked that only in `ingest`.

Verified before rollout:
- The real provider answers a query with no results as `{"data": [], "total": 0}` and no `next`: one
  stored page, a finished walk, not a never-walked one.
- Locally against the real OpenFIGI: `US.partnership` 52 lines; `US.arca` 2 pages, 200 lines, all
  mapped to their US line; the resume merged a third page.

## As built — D4 (2026-10-04)

| Design said | Built | Why |
|---|---|---|
| `delisted_at` | `absent_since` | Past the US cap only NYSE Arca's walk can see a line, so a stock moved from an exchange to OTC goes absent while it still trades. The name says what is measured |
| Mark lines not seen since "the oldest latest complete walk among the queries covering" the scope | `market.mark_venue_absence(p_walks jsonb)`. The venue's own walk vouches for its scope, or only up to its last FIGI when it is capped. Past that window, only the aliases vouch, and only once all have finished. A window where fewer than half the lines were seen since the walk began is refused and named, not marked | A capped walk saw nothing past its window, so a single threshold across the queries would have marked every US line only Arca returns. The refusal is the 1,369-security lesson: when nothing answers, blame the provider, not the universe |
| Stage 2 stamps `last_seen_at`, and a walk that returns a line clears its mark | A trigger keeps the newest sighting, and clears a mark only when the sighting moves forward. Stage 2 never writes `absent_since` | Re-filing an older walk (a range re-run, a parser fix, an alias walked before the venue's own) would otherwise un-mark a line a newer walk did not return, until the next day's mark |
| (not considered) | Stage 2 keeps the newer of two sightings of one line in a run | `US.common` and `US.arca` both name a US line. The writer keeps the last of two rows, which was the older sighting whenever the alias sorted last |
| An unpartitioned asset marks | `venue_listing_absence`, daily at 05:41 UTC, passing every query's walk. A finished walk stage 2 has not filed yet is passed as unfinished and named. "Filed" means a `venue_listing` materialization after the partition's latest raw one, by event-log storage id | For the hour after a monthly refresh every walk is finished and unfiled. Judged then, each would mark every line it returned |
| `untracked_listing` and `derive_security_listing` exclude marked lines | Those two, and `promote_listing` refuses a marked line, saying since when. `security_listing` depends on the mark, so a line marked in the morning leaves the listings the same morning | The Track button would otherwise mint a delisted company by hand |

The facts live with the files and the rules live in the database, where CI tests them on real
Postgres: 13 variants of the migration each fail its two tests (`a-line-the-directory-stops-returning
-is-not-offered`, `a-walk-marks-only-what-it-could-see`). The asset's 9 mutations each fail its
tests in muffin-ingest.

## Risks and rollback

- A monthly pass that throttles part-way resumes on its own; a run that errors outright waits for the
  next cron tick, visible as a failed run.
- Rollback: disable a type or alias row (D2), or remove the condition (D3); old raw files stay on disk
  until the deferred drop.

## Deferred

- Delete the 59 pre-re-key raw files after the first full pass has been verified (note with the date).
- Frankfurt (`GR.common`) sits at 14,205 of 15,000. When the CAPPED check names it, split it with a
  `directory_alias` row.

## Open questions

None. D1–D4 were decided 2026-10-04, each as recommended.
