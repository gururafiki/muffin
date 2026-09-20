# Partition to the provider's request grain, and extend instead of re-fetching

2026-09-19 · Decided with the user; **not yet implemented**. Supersedes the option list in
`docs/deferred/2026-09-17-a-throttled-day-partition-still-materialises.md` and settles
`docs/deferred/2026-09-16-dagster-pruning-erases-partition-state.md`.

## Why this is being reopened

**Our `calls` counter is an accounting fiction, and every budget decision has been sized against
it.** `openbb`'s yfinance adapter calls `yf.download(..., threads=False)`, which loops
`for ticker in tickers` and issues `/v8/finance/chart/{ticker}` for each one. Measured on the wire
2026-09-19 by counting URLs through `YfData`:

```
symbols asked : 4   (AAPL, MSFT, KO, SAP.DE)
chart requests: 6
   AAPL · MSFT · KO · SAP.DE ×3
```

So a "batch of 20" is **at least 20 upstream requests**, and a suffixed foreign symbol costs more.
The consequences, against numbers already recorded:

| | reported | actually asked of the vendor |
|---|---|---|
| 09-18, clean night | 602 calls | ~12,021 requests |
| 09-19, refused | 138 calls | ~2,740 requests |

A nightly cross-section needs **~12,021 provider requests** and the allowance on 09-19 was **~2,740**.
Batching collapsed our bookkeeping and bought nothing upstream, which is why four separate pieces of
work — pacing, the counter fix, the throttle options, the recovery backfill — each improved the
*report* rather than the spend.

Two further measurements shape the design:

- **Dagster documents 100,000 partitions per asset** (`DynamicPartitionsDefinition.__doc__`), and
  `raw_price_history` already runs **12,016** dynamic partitions in production. Per-ticker
  partitioning at this universe's scale is demonstrated, not theoretical. (CLAUDE.md and
  `muffin-ingest/README.md` both said ~25,000; that was wrong and is corrected with this change.)
- **The event-log hot path is indexed.** `get_materialized_partitions` runs
  `select partition, max(id) … group by partition`, served by Dagster's partial index
  `(asset_key, dagster_event_type, partition, id) WHERE asset_key IS NOT NULL AND partition IS NOT
  NULL`. Table size is therefore a disk question, never a latency one.

## The rule

> **A partition is the unit the provider is asked about. The backfill policy is what re-batches
> partitions into one run.**

It follows that:

- **Never partition finer than the provider's grain.** finviz answers every sector group in ONE
  request, so `raw_sector_performance` stays unpartitioned — partitioning it by group would
  *multiply* provider calls by 77.
- **Never partition coarser than it either.** A day-partitioned cross-section over a per-ticker
  provider is one partition standing for 12,021 independent requests, so it can only ever be
  all-or-nothing, and a refusal mid-way leaves a materialised partition whose completeness claim is
  false. This is the defect three deferred notes have circled.
- **A bulk API keeps per-subject partitions and batches inside the run.** `raw_figi_ticker` is
  already the model: per-security partitions, `multi_run(200)`, and 10 jobs per OpenFIGI request, so
  200 partitions cost 20 requests. Do not "fix" it into a coarser partition.

## Decisions

### 1. The recurring price lane is partitioned by ticker

`raw_price_bars` moves from `trading_day` to the security grid, and merges with `raw_price_history`
into **one lane**: the same asset extends a security whether it has 10 years or one day. Dagster's
grid then answers "which securities are current?" natively, and a throttled night leaves ~9,000
partitions unmaterialised rather than one partition that lies.

**"Did we collect Tuesday?" stops being a partition and becomes an asset check** over
`market.price_bar` — a count per trade date against the askable universe. That is the one capability
this trades away, and it is recoverable because the data can answer it; the reverse (a day partition
answering "is AAPL current?") never was.

### 2. Extend, don't re-fetch — in a merging I/O manager

`ParquetIOManager` replaces a partition's file. A `MergingParquetIOManager` instead reads the
existing file, unions on the row key, and writes — so an asset that fetched only the extension does
not destroy what earlier runs stored. The asset stays ignorant, which is the split this repo already
keeps ("an asset RETURNS rows; what happens to them is not its business").

The same manager exposes the partition's existing rows so the asset can derive its own watermark and
ask the provider only for what is missing. **Raw is therefore self-describing**: what to fetch next
is answered by what we already stored, with no dependency on stage 2 having succeeded and no second
source of truth to drift.

Dagster offers no merge primitive, and this was checked rather than assumed: self-dependency via
`TimeWindowPartitionMapping(start_offset=-1)` is real but **time-window only**, so it cannot express
"the same ticker partition, as it was before" once the partition is the ticker.

**The invariant changes and must be written down**, or it reads as the double-count the current
comment warns about: a partition file is no longer "the provider's latest answer, replacing the
last" but "every answer we hold for this subject, newest winning per row key".

**Amended 2026-09-20, by the first live run.** The merge keeps a stored row it cannot key — "I
cannot tell whether this was superseded" resolving to keeping it — and that is right for an
*extension* and wrong for a *full history*. Every one of the 12,016 partitions had been written
before raw stopped adding `trade_date`, so none carried the `date` the key names: the watermark read
nothing, every subject took the full-history path, and one partition went **4,496 → 8,998 rows**,
the same history twice. Published bars stayed correct (stage 2 drops a row with no usable date), so
nothing but the raw file could show it, and `rows_unkeyable` would have been permanently non-zero —
a "something is wrong" counter with a standing population is not a signal.

So the asset says which kind of answer each partition got (`partitioned.Complete` marks the loading
cohort) and the manager replaces those while merging the rest. It is a set of partition keys, not a
flag, because one run holds both. **An empty complete answer replaces nothing**: a dead symbol, a
refusal and a holiday all return no rows, and writing that over a stored history would delete it to
record a quiet day — enforced in the manager rather than trusted of each caller.

Proven live on three untouched legacy partitions once the fix was rolled: `rows_fetched 783,
rows_kept 0, rows_superseded 777, rows_unkeyable 0, rows_total 783`, `trade_date` gone from the
file, and stage 2 `dropped 0` where the pre-fix run reported 4,497.

**TWO PARTITIONS KEEP A LEGACY ROW ON PURPOSE, so a non-zero `rows_unkeyable` there is not a
defect.** Of the three partitions the pre-fix run doubled, Jardine Matheson's 4,496 legacy dates
were measured to be **entirely contained** in the 4,502 just fetched — fully superseded, so its
file was removed and rebuilt clean. The other two are securities the provider now answers nothing
for (`dead: 1, answered: 0`), and each holds **one date the fetch no longer returns**
(`fb51819a` 2026-07-17, `05dfe591` 2025-09-22). Deleting those would destroy raw evidence that
cannot be re-obtained, which is what rule 3 forbids — so they stay, and the counter saying so is
telling the truth. Measure which it is before removing a file; "superseded in substance" is a
claim about dates, not about row counts.

### 3. Stop pruning Dagster storage

`prune_dagster_storage` is deleted. Measured: the steady state is **~1 MB/day** (231–1,036 rows/day
across 09-13…09-19; the 69 MB and 59 MB days were the one-off history backfill), so never pruning
costs **~365 MB/year today** and **~11 GB/year** once the nightly sweep is per ticker — against
51 GB free on `/mnt/data`, with the grid query indexed either way.

The job's own rationale cited "a database that shares a 1.5 GB-limited container": that limit is the
container's **RAM**, not its disk. Pruning was destroying the partition grid — the state this design
now depends on — to reclaim a third of a gigabyte a year.

Revisit if the event log passes ~20 GB, and prefer "keep the newest materialization per (asset,
partition), prune the rest by age" over a flat age cut, because partition status needs exactly one
row per partition.

### 4. Refresh is chosen per lane, from what the provider makes observable

| Lane | Provider grain | Partition | Trigger |
|---|---|---|---|
| prices (daily + history, merged) | per ticker | security | `on_cron` daily, `on_missing` backstop |
| fx spot | per pair | currency | `on_cron` daily |
| fx history | per pair | currency | `on_missing` — idles at zero by design |
| indices | per proxy symbol | scope | `on_cron` daily |
| sector performance (finviz) | **all groups in one request** | none | `on_cron` daily |
| symbology (OpenFIGI) | **bulk, 10 per request** | security + `multi_run(200)` | `on_missing` |
| statements / filings | per issuer | issuer | observable → `data_version_changed()` |

**Where an event exists, observe it instead of polling on a calendar** — but observe it at the
grain the provider publishes, not per subject. SEC's daily index is one request listing every filing
that day: measured **780 KB in 0.35 s**, 172 accounts forms on 09-18. One
`@observable_source_asset` for the whole market therefore replaces 3,516 per-issuer polls, and only
issuers whose CIK appears that day are re-fetched. A per-issuer observable would have cost more than
the fetch it saves, which is the trap to name.

Freshness policies stay descriptive only: Dagster OSS does not alert on them, and alerting here is
Grafana's.

## Migration — names are state

Changing an asset's `partitions_def` orphans its materialization history, and the definitions
snapshot test will fail loudly, which is the point. Expand/contract:

1. Land the merging I/O manager and the retention change first — both are independent of the grid
   and each is useful alone.
2. Add the new per-ticker asset **beside** `raw_price_bars`, backfill it, and verify it against the
   day-partitioned lane at a common anchor (the provider adjudicates, not the old table).
3. Re-point `price_bar`, then retire the old asset, keeping its Parquet as the backup.
4. The 12,016 `security` partitions already registered are reused; no new dynamic partition set.

**Order matters for spend.** Until step 3, both lanes ask the same provider about the same
securities, so the old lane's schedule is stopped before the new one's backfill starts.

## Open questions, carried deliberately

- **Run count.** 12,016 partitions at `multi_run(25)` is 481 runs a night; at 200 it is 60. The
  provider cost is identical either way — N trades run overhead against per-run memory, and the
  `yfinance` pool at limit 1 serialises them regardless. Measure before choosing N.
- **A ~2,740-request allowance against ~12,021 securities** means a full nightly sweep is not
  affordable at all. Per-ticker partitioning makes the shortfall *visible and resumable* rather than
  fixing it; the universe still has to be prioritised (fund weight) or the cadence relaxed for the
  tail. That is a separate decision and should not be smuggled into this one.
- Whether the same treatment suits `raw_index_bars` (61 proxies) is unmeasured; 61 partitions is
  cheap but the lane has never been the constraint.

## Done when

A security's partition extends from its own stored rows with no full re-fetch; a throttled night
leaves unmaterialised partitions that the next run completes without re-asking what succeeded; the
per-day completeness claim is an asset check over `price_bar`; and `market.price_bar` reaches a full
day's bar count across several runs rather than one.
