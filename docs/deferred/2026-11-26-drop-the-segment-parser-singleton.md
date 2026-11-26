# Drop the segment parser's singleton column

Created 2026-11-26 · Due on or after 2026-12-27 · Status: open

## Why it is deferred

Phase 6c decision 4 gives each regulator its own parser version. The expand step keeps
`market.segment_parser`'s old `singleton` column, and keeps `max(version)` meaning what it did. Then
the database deploy can land before the ingest roll that reads per regulator, and either half
can ship alone. Dropping the column waits until nothing reads the table the old way.

## Context

- Spec: [2026-11-26-more-segment-sources.md](../specs/2026-11-26-more-segment-sources.md), *Data model
  changes*, step 1.
- The readers that took one version:
  - the four `_UNREAD` fragments in muffin-ingest (`facets/sec_segments.py`, `cninfo.py`, `dart.py`,
    `nse.py`);
  - `segments.vocabulary`;
  - `quality.yml`'s parser-version step;
  - `check_segments_reconcile.py`.

## What to do

1. Prove that nothing reads `segment_parser` without `regulator`:
   - `grep -rn "segment_parser" muffin-ingest/libs muffin-ingest/projects muffin-deployment/.github muffin-deployment/stack/supabase/schemas`;
   - every query names a regulator.
2. A contract migration drops `singleton`, with a guard test asserting one row per enabled
   `disclosure_source`.

## Done when

`segment_parser` has no `singleton` column, and the guard test passes.
