# The segment spine refreshes from pg_cron until Phase 7

Created 2026-11-09 · Planned in [the Phase 6 spec](../specs/2026-11-09-segments-and-regulators.md)
(*Architecture*) · Status: open, for Phase 7 (derived and serving)

## Why

Phase 6 moves segment ingestion to Dagster but leaves the serving layer where it is. There are two
pieces:
- **The spine:** pg_cron `muffin-segment-spine` runs `market.refresh_segment_spine()` hourly, with a
  300 s bound (muffin-deployment#410).
- **The classification:** Dagster's `security_classification` calls
  `market.derive_segment_classification` over the spine.

The spine refresh does not know when Phase 6's lanes write. It refreshes on the hour whatever
happened, and a split parsed at :17 is served at :16 the next hour.

## What to do in Phase 7

Make the spine refresh a Dagster asset that is eager on the four `*_segment` assets, bounded as
today. Move the classification behind it so it reads a fresh spine. Then unschedule
`muffin-segment-spine`.

## Done when

`muffin-segment-spine` is gone from `cron.job`, and the spine's freshness follows the segment lanes.

## Context

- `muffin-deployment/stack/supabase/schemas/0105-security_segment_spine.sql`; migration
  `20261003…` (`refresh_segment_spine` on pg_cron).
- `todos.md`, Phases 7-8.
