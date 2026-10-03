# The segment classification probes the primary key once per member

Created 2026-10-03 · Check by 2026-10-31, or sooner if `security_classification`'s `weighted_ms`
passes 60,000 · Status: open, not failing.

## What happened

`market.derive_segment_classification()` took 102 ms after the 2026-09-05 fix (the spine instead of
the view). On 2026-10-03 it took **20.1 s** rolled back, and the Dagster asset's first run recorded
`weighted_ms` **15,044**. Through PostgREST's 8 s ceiling that cancelled every daily
`derive-classifications` run from 09-27 to 10-03, which is why Stage 5 moved it to Dagster, where
`ingest_rw` allows 120 s. The function did not change; the table under it grew.

## The measurement

`EXPLAIN (ANALYZE, BUFFERS)` of the function's statement, run on production in a rolled-back
transaction on 2026-10-03 (18.0 s in total):

- **15.5 s is one node.** The `candidate` CTE, which picks each security's axis, runs a nested loop:
  `security_segment_spine` (16,136 product/business rows), then for each row an index scan on
  `security_segment_pkey` at **0.94 ms**, about 13 rows each.
- **Memoize achieves nothing**: 0 hits in 16,136 lookups, since every key is distinct.
- **The probes are cold**: 225,063 shared hits and **33,202 blocks read** from disk.
- **The key is the wrong shape for the question.** The primary key is
  `(security_id, axis, member_code, parent_key, metric_code, period_type, period_ending)`, and
  `period_type = 'annual'` is not a prefix, so each probe walks every row of the member, of every
  metric and period, and visits the heap.
- `security_segment` holds **1.44M rows (682 MB)**, of which 383,612 are partition 1 and annual. The
  `latest` CTE reads those in one sequential scan in 1.5 s.

The cost grows with each member's history, and history grows as `pending_segments` (79,209 filings
on 2026-10-03) and the Chinese backlog drain.

## What to do

Read the annual, partition-1 rows ONCE, as a `materialized` CTE, and let `latest`, `candidate`,
`split_total` and `by_node` hash-join to it instead of probing the base table. The `latest` CTE
already pays for that scan, so the expected total is a few seconds. Do not change what is counted:
`candidate` counts mapped fact ROWS across every annual period, which is a semantic choice of its
own, separate from this cost.

Prove it before shipping:
- **Identical output.** In one rolled-back transaction, run the current function and capture
  `security_taxonomy` where `source_code in ('segment-revenue', 'segment-profit')`. Repeat with the
  rewrite. The two sets must be equal both ways under `EXCEPT`.
- **Timing.** Best of three, cold and warm.
- **Structure.** The existing test `a-weighted-classification-is-not-a-label.sql` must pass
  unchanged. The structural guard on `pg_get_functiondef`, which requires the spine rather than
  the view, still applies.

## Done when

`weighted_ms` on the asset's materialisation is below 5,000 with the same row count, and the
equality check above is recorded in the PR.
