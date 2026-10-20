# A resource can repeat the same failure for weeks, and no alert sees it

Created 2026-10-20 · Status: open. **The alert is the user's decision**; the two instances belong to
Phases 5 and 6.

## Why

I found these while closing out Phase 4, using the sweep CLAUDE.md describes: group `refresh_run`
reports by resource and look for the same report on consecutive runs. Two edge resources have
reported the same failure on every run for weeks:

| Resource | Since | Runs | Every report says | The failure |
|---|---|---|---|---|
| `earnings-history` | 2026-09-06 02:00 UTC, 44 days | hourly, `ok: true` | `walkedTo: 2016-06-30`, `fetched 0, written 0, failed 1, remaining 546` | `openbb 500 on /api/v1/equity/calendar/earnings?provider=nasdaq&start_date=2016-06-28…`, `'NoneType' object has no attribute 'get'` |
| `security-segments` | 2026-09-30 14:27 UTC, 20 days | every 5 minutes, `ok: true`, 5,504 runs | `filings 0, written 0, failed 1, remaining 1` | `unexpected end of file`, on the last queued filing: Tandem Diabetes Care (TNDM, CIK 1438133), 10-Q `0001193125-14-289759`, filed 2014-07-31 |

The Phase 4 spec recorded `earnings-history` on 2026-10-10 (*Measured*, item 5) and listed this note
among those to write. It was not written until now.

**No alert can see either one.**
- The stalled-resource alert reads `resource_health.last_worked`, which counts any run reporting
  `ok`. Both resources report `ok: true`, because a failure on one subject is reported, not raised.
- The backlog alerts have floors, on purpose: "not draining" needs a depth above 500, and "FLAT for
  a week" above 100, because "an empty or nearly-empty backlog is legitimately flat". So a queue
  stuck on its last filing cannot fire them, and `earnings-history` walks a cursor with no
  `pending_*` view at all.

**The data cost is small; the class is what matters.**
- `earnings-history` is missing earnings history before mid-2016, and asks openbb and nasdaq about
  the same window about 24 times a day.
- `security-segments` leaves one 2014 10-Q unparsed, and asks SEC about it about 288 times a day.
- The edge keeps running the families of Phases 5–8 for months. A subject that fails at the head of
  its queue for ever is the head-of-line stall that CLAUDE.md already records seven times.

## Options for the alert (the user's decision)

1. **A `stuck` column on `market.resource_health`**: the resource's newest N completed runs carry
   the same report, with a failure and nothing written. The stalled-resource rule and
   `check_resource_health.py` would both read it, so Grafana and market-verify share one
   definition. Costs a view change through `muffin-schema-change`. **Recommended.**
2. **A Grafana rule over `refresh_run` only.** Cheaper, but market-verify would not see it, and the
   definition would live in the rule's SQL alone.
3. **Leave it.** Each instance gets fixed when its family leaves the edge, and the next stall of
   this shape is found by accident again.

Either alert must be replayed against production before shipping. Today it should name exactly
these two resources, and nothing else.

## What to do

- **The alert**, once decided. Its fixture must make "repeats the same failure" and "failed once"
  disagree, and the replay should name both instances.
- **`security-segments`** (Phase 5, or sooner with the alert):
  - Fetch the filing's index and instance from the node and find where the read ends.
  - A filing that cannot be read is a permanent fact about that filing. Stamp it with its error
    (the queue already uses `segments_parsed_at` as a permanent cursor) rather than asking SEC every
    five minutes.
- **`earnings-history`** (Phase 6): narrow the failing three-day window to single days, find the date
  nasdaq cannot serve, and step past it with the date recorded, instead of asking for the same
  window every hour for ever.

## Done when

An alert fires on a resource that repeats the same failure. Both instances are then either fixed,
or recorded as known with a date by which they will be fixed.

## Context

- CLAUDE.md § "THE SAME DEFECT IN THREE PROVIDERS IN ONE DAY, AND A SWEEP FINDS THEM FASTER THAN A
  BUG REPORT" (the sweep), and the head-of-line stalls it lists.
- `muffin-deployment/stack/observability/grafana/provisioning/alerting/rules.yml`:
  `muffin-resource-stalled`, `muffin-backlog-stalled`, `muffin-backlog-flat`.
- `docs/specs/2026-10-10-yahoo-company-data.md`, *Measured*, item 5.
