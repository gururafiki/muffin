# `market.untracked_listing` is empty until the venue sweep has walked the venues

Created 2026-09-20 · Updated 2026-09-21 · **CLOSED** — all 59 venues swept, the view holds
84,220 rows and the completeness check passes

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

So ~5 requests a minute, and `SWEEP_PACING = 12 s` (muffin-ingest#61) follows from it.

**CORRECTED 2026-09-21: ~209 minutes, not ~5 hours.** The 1,488-page figure came from
`exchange_listing`'s whole 148,782 rows, and the sweep does not ask for all of them — it sends
`securityType2: 'Common Stock'`, so mutual funds and depositary receipts are out of scope by
construction. Counted over the 59 ENABLED venues at that filter:

```
common-stock rows  100,923      pages (100/page)  1,043
provider time      ~209 min     venues over SWEEP_MAX_PAGES (40)  5
```

The five needing a second pass are US (163 pages), GR (143), IB (55), LN (44) and JP (41) — the
resume mechanism is what carries them, and it is now exercised live rather than assumed. Resuming
is an operator backfill by design: `new_exchange_sweeps` only ADDS venues, and its own comment says
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

## Measured live, 2026-09-21 — AU

The first venue swept in production, and the first rows the lane has ever written:

```
raw_exchange_sweep AU   22 pages, pages 0..21, last cursor_at = NULL  (the walk finished)
venue_sweep_reached_its_last_page   PASSED
market.venue_listing            2,115   all of them AU, all Common Stock
market.untracked_listing        1,864   ← off zero for the first time since 2026-09-17
```

**The gap against the old directory is fully explained**, which was step 4 of this note and is the
half that mattered. Old AU held 2,761 rows: **2,134 Common Stock + 540 Mutual Fund + 87 Depositary
Receipt**. The 627 non-common-stock rows were never in this sweep's scope. Of the 2,134 common
stocks, **19 are in the old table and not the new** — delistings since whenever that table was last
walked — and **0 FIGIs are new**, so the current walk is a strict subset rather than a different
answer. That is the expected shape for a venue whose directory was swept once and then frozen.

Two things the live run found that the local one could not:

* the `ingest_rw` grant and the RLS policy beside it hold — this was the first real write, and
  `venue_listing` took 2,115 rows through `postgres_io` in 2.26 s;
* a walk that FINISHED logged `resumes at '<stale cursor>'`, because the loop only advances
  `cursor` when the provider hands one back. The check passed and the sentence disagreed with it.
  Fixed in muffin-ingest#66.

## What to do

1. ~~Roll the image, then materialise ONE venue partition live~~ — **done 2026-09-21, see above.**
2. ~~Start `new_exchange_sweeps` with `default_status=RUNNING` in code, never in the UI.~~ —
   **muffin-ingest#66.** It had to come first after all: measured before that PR,
   `dynamic_partitions` held exactly ONE `exchange_sweep` key (the AU one added by hand), so a
   backfill had nothing to select. The sensor is add-only, so starting it spends nothing.
3. Backfill the remaining 58 venues, then re-backfill whatever `venue_sweep_reached_its_last_page` still reports
   unfinished. That check IS the selection; there is no need to guess.
4. Watch `select count(*) from market.untracked_listing` climb off zero, and compare it against
   `exchange_listing`'s 148,782 — they will not match (the sweep asks only for `Common Stock`, so
   every ADR is absent by construction), and the GAP is the thing to explain rather than the total.
5. **Decide on an OpenFIGI API key.** At ~5 requests a minute the full pass is ~209 minutes and
   the monthly refresh the same again, all of it serialised behind the `openfigi_filter` pool. A
   key raises the allowance; it is a credential decision and is open with the user.

## The full pass, measured 2026-09-21

```
venues swept                       59 of 59      venue_sweep_reached_its_last_page: PASSED
raw pages held                  1,028            unfinished 0 · never_swept 0
market.venue_listing           99,459
market.untracked_listing       84,220            (was 0)
old exchange_listing          148,820 all types · 100,923 Common Stock
FIGIs the old table never had      59
```

**99,459 against 100,923 is 98.6%**, and the ~1,464 difference is delisting turnover: the old
table accumulates and never retracts, having been walked once and frozen. 59 FIGIs are genuinely
new.

**What it actually cost, and it is not what this note predicted.** The ~209-minute estimate was
for the ANONYMOUS budget — and `OPENFIGI_API_KEY` was in the container's environment the whole
time, never sent (muffin-ingest#67). Keyed, 56 venues finished in about five minutes against 39 in
fifty-eight unkeyed. So the honest cost of a refresh is minutes, not hours, and the API-key
question this note carried was answered by reading the environment rather than by buying anything.

**Two things the drain found**, both with their own notes:

* **US needed 150 pages against `SWEEP_MAX_PAGES` 40**, so it took several passes — which is the
  design working, and the check named it as the backfill selection rather than anyone guessing.
* **`SWEEP_PACING_KEYED = 0.3 s` is too fast to sustain.** The provider says so directly:
  `openfigi throttled US after 20 pages`, then `after 0 pages` on the immediately-relaunched pass.
  ~20 requests then a refusal, so passes alternate 20/0 and the honest figure is nearer 2-3 s. It
  shipped on a 15-page probe that sat just under the cliff — a measurement taken just below a
  ceiling read as headroom.
* **SM and PM failed twice identically on a CACHED ERROR**, not a flaky provider —
  `docs/deferred/2026-09-21-an-error-wearing-a-200-is-cached-for-90-days.md`.

## Done when

~~`market.untracked_listing` is non-trivial and its size is explained against the old directory~~
(84,220; 98.6% of the old common-stock set, the rest delisting turnover) · ~~
`venue_sweep_reached_its_last_page` passes for every venue~~ (59/59, 0 unfinished) · ~~this note
records what the full pass actually took~~ (~5 minutes keyed).

**One item remains: the Markets search returning rows in the deployed app.** The data is there and
the view answers; nobody has loaded the page. That is the only part of this note still open, and
it belongs with an anon read-latency measurement — `untracked_listing`'s base went from 0 to
99,459 rows, so the view's plan is not the one last measured.
