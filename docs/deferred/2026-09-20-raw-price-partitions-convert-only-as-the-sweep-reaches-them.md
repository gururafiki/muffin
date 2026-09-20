# Every raw price partition still holds the pre-2026-09-12 shape until the sweep rewrites it

Created 2026-09-20 · **Check 2026-09-27** · Status: the fix is live and proven; the CONVERSION is
in progress and nothing verifies it completes

## Why it is deferred

All **12,016** `raw_price_history` partitions were written by the history backfill before raw
stopped adding `trade_date`, so none carries the provider `date` that `merge_on` keys on. Measured
2026-09-20 on a sample of 40 untouched partitions: **40 of 40 legacy**, zero already converted.

muffin-ingest#57 makes a run that fetched a subject's WHOLE history REPLACE its partition, so each
one converts the first time the sweep reaches it — and the sweep covers 2,500 partitions a night at
`SWEEP_SLICE`, throttle permitting. That is roughly **five nights** for a full pass, and until a
partition has been touched:

- its watermark reads nothing, so the run re-fetches the entire history rather than the extension
  (the same ONE request per ticker, so no extra provider spend — but the full payload, not a day);
- the "extend, don't re-fetch" feature the whole change exists for is inert for that subject.

**Nothing reports the conversion's progress**, which is the shape this repo keeps paying for: an
unplotted number cannot be seen to be wrong, and "it self-heals over five nights" is a claim nobody
is currently in a position to check.

## Context

- Fix and measurements: muffin-ingest#57, rolled 2026-09-20 (image `3b2ec2b8…`).
- Design: `docs/specs/2026-09-19-partitioning-to-the-provider-grain.md` § Decisions 2, as amended
  2026-09-20 with the live finding.
- The defect it repairs: the merge kept 4,496 unkeyable stored rows beside a freshly fetched 4,502
  — one partition at **8,998 rows**, raw heading from ~898 MB to ~1.8 GB across a full pass, and
  `rows_unkeyable` permanently non-zero so it could never signal a real shape mismatch.
- Proven live on three untouched legacy partitions plus one rebuild: `rows_total == rows_fetched`,
  `rows_superseded` 312/392/777/4,496, `rows_unkeyable` **0**, `trade_date` gone, stage 2 `dropped`
  0 where the pre-fix run dropped 4,497.

**Two partitions keep a legacy row on purpose and must not be counted as unconverted.**
`fb51819a…` and `05dfe591…` are securities the provider now answers nothing for (`dead: 1,
answered: 0`), and each holds one date the fetch no longer returns (2026-07-17 and 2025-09-22).
Deleting those would destroy raw evidence that cannot be re-obtained, so they stay and their
`rows_unkeyable: 1` is the counter telling the truth.

## A transient cost that disappears with the conversion

The replace branch calls `_stored_rows(path)` purely to count `rows_superseded`, and the asset's
watermark loop has already read that same file — so a converting partition is read TWICE per run.
During the conversion window that is ~2,500 extra full Parquet reads a night. Once converted, the
replace branch fires only for genuinely new securities, so the cost decays to nothing on its own.
Do not optimise it before measuring whether it still exists.

## What to do

1. Count how many partitions still carry `trade_date` (read `pq.read_schema` per file in the
   `muffin_muffin-ingest` container — the same sampling used to find this). Compare against 12,016.
2. If it is not falling at roughly the sweep's rate, find out why before assuming: a throttled
   night converts only what it reached, and `nightly_prices` rotates by date rather than by "what
   is still legacy", so a slice can be re-covered while another waits.
3. When it reaches 2 (the two dead securities above), the conversion is complete: say so here,
   and re-measure raw's size on disk — it should be at or below the 898 MB it started at.
4. Consider whether "how many partitions are in the old shape" deserves a standing metric. It is a
   one-off by construction, so the honest answer is probably no — but say which, rather than
   leaving it unasked.

## Done when

Every `raw_price_history` partition but the two deliberate ones carries `date` and no
`trade_date`; a nightly sweep reports `extending_from_watermark` for substantially all of its
slice and `loading_full_history` only for new subjects; and `rows_unkeyable` is 0 across the lane
apart from those two.
