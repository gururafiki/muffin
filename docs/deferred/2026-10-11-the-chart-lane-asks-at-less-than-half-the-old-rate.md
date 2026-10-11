# The chart lane asks Yahoo at less than half the old rate

Created 2026-10-11 · Due with the next muffin-ingest PR (the comment); the rate is a decision ·
Status: open

## Why it is deferred

Decision 5 of the quote-currency spec was "today's pacing". `CHART_SECONDS_BETWEEN_REQUESTS = 1.4`
(`projects/muffin-ingest/src/muffin_ingest_dagster/defs/prices/partitions.py`) was derived in its
comment as "the 2026-10-06 night spent ~3,500 s on 2,500 securities, ~1.4 s each". That 3,500 s
was the night less stage 2. It includes about 15 s of start-up in each of 100 runs and the
staleness check. The stage-1 step itself, `raw_price_history`, took **1,578 s** that night and
1,579 s on 10-09, for about 2,450 securities: **0.64 s per security**. openbb asked Yahoo at least
once per security, so the old lane's request rate was at least 1.5 a second.

The first scheduled chart night, 2026-10-11, measured from each step's `STEP_SUCCESS.duration_ms`:

| Step | 10-09 (openbb) | 10-11 (chart) |
|---|---|---|
| stage 1 | 1,579 s | 3,635 s |
| stage 2 (`price_bar_history`) | 1,534 s | 1,503 s |
| checks | 146 s | 556 s (the label check is new: 321 s) |
| sum of run times | 4,957 s | 7,230 s |
| first start to last end | 96 min | 134 min (00:00:09 to 02:14:26) |

So the lane asks Yahoo at about 45% of the old rate, and the night is about 38 minutes longer.
Stage 1 is bound by the spacing: 25 requests × 1.4 s is 35 s a run, against 36.4 s measured. It
will not shrink after the first rotation, when visits become week-long extensions.

The night still ends long before the 03:00 symbology tick and the 03:30 window planned for the
Phase 4 company lane. That lane is to be paced "no faster than the price lane per request", so it
inherits whichever rate is chosen here.

## What to do

1. In the next muffin-ingest PR, correct the comment on `CHART_SECONDS_BETWEEN_REQUESTS`. It states
   a measurement that is wrong by a factor of two. Nothing else changes.
2. Decide the rate:
   - **Keep 1.4 s and amend decision 5** (recommended). The cost is about 38 minutes a night and
     nothing else. Yahoo's allowance once fell fourfold between two consecutive days, and the
     Phase 4 company lane will add about 3,500 requests a day beside this one.
   - **Return to the old rate, about 0.65 s.** The old lane reported `throttled 0` on every one of
     the 18 nights from 2026-09-23 to 10-10, measured from the runs' metadata. The night would end
     near 01:40 (the label check is new).

## Done when

The comment states the measured numbers, and the spec records which rate was chosen.
