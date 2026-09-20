# `market.untracked_listing` is empty until the venue sweep has walked the venues

Created 2026-09-20 · **Check 2026-09-27** · Status: the lane is fixed and proven; it has not been
switched on, and nothing reports the drain

## Why it is deferred

Migration `20260913100000` re-pointed `market.untracked_listing` from `exchange_listing` (148,782
rows) onto `market.venue_listing`, which only the Dagster OpenFIGI sweep fills. That sweep has
**never run** — `new_exchange_sweeps` ships STOPPED — so measured 2026-09-20:

```
market.venue_listing       0        market.exchange_listing   148,782
market.untracked_listing   0
```

The Markets search reads `untracked_listing` (`muffin-ui/src/features/markets/api/
use-security-search.ts`) and `promote_listing` reads `venue_listing`, so both have been dead since
the 2026-09-17 deploy and nothing reported it. **Decided with the user 2026-09-20: leave the view
where it is and run the sweep**, rather than re-pointing it back — so this note is the thing that
stops "it will fill once we turn it on" being a claim nobody is in a position to check.

## What it will cost, measured rather than estimated

The spec first sized this at ~62 minutes from "25 requests a minute". That ceiling was measured on
`/v3/mapping` and does not hold for `/v3/filter`. Measured against the real endpoint, after 65 s of
silence each time:

```
paced 2.5 s   5 pages in 14.6 s, then 429 on request 6     (reproduced three times)
paced 12 s    7 pages in 74.3 s, no 429 at all
```

So ~5 requests a minute. At `SWEEP_PACING = 12 s` (muffin-ingest#61) and ~1,488 pages for 59
venues, a full pass is **~5 hours of provider time** across ~37 runs of 40 pages each. Resuming is
an operator backfill by design — `new_exchange_sweeps` only ADDS venues, and its own comment says
"re-materialising them is an operator's call".

## Context

- Spec: `docs/specs/2026-09-20-turning-the-universe-lanes-on.md`.
- muffin-ingest#58 — the resume keeps its pages and `venue_sweep_reached_its_last_page` names the
  venues to re-materialise; #60 — the column the parser emitted that no table has; #61 — the
  pacing.
- Proven locally 2026-09-20 on real provider bytes: the sweep resumed from page 5, the partition
  file went 5 → 10 rows, a run refused on its first request kept all 10, and 10 pages became
  **1,000 rows in `venue_listing`** with `provider_symbol` carrying the venue's `.AX` suffix —
  `untracked_listing` then returned 1,000.

## What to do

1. Roll the image, then materialise ONE venue partition live and read its counters before anything
   else. The local run is a superuser against a database no resource has written; the live run is
   the first exercise of the `ingest_rw` grant and the RLS policy beside it (checked on the node:
   `rolbypassrls = t`, `has_table_privilege(…, 'INSERT') = t`, so it should hold — but checked is
   not the same as exercised).
2. Start `new_exchange_sweeps` with `default_status=RUNNING` in code, never in the UI.
3. Backfill the venues, then re-backfill whatever `venue_sweep_reached_its_last_page` still reports
   unfinished. That check IS the selection; there is no need to guess.
4. Watch `select count(*) from market.untracked_listing` climb off zero, and compare it against
   `exchange_listing`'s 148,782 — they will not match (the sweep asks only for `Common Stock`, so
   every ADR is absent by construction), and the GAP is the thing to explain rather than the total.
5. **Decide on an OpenFIGI API key.** At ~5 requests a minute the full pass is ~5 hours and the
   monthly refresh the same again. A key raises the allowance; it is a credential decision.

## Done when

`market.untracked_listing` is non-trivial and its size is explained against the old directory, the
Markets search returns rows in the deployed app, `venue_sweep_reached_its_last_page` passes for
every venue, and this note records what the full pass actually took.
