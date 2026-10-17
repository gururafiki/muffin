# The company lane's first rotation

## Why

The `yahoo_companies` schedule is declared RUNNING from muffin-ingest#113 (Phase 4 step 8). Its first
tick is 03:30 UTC on 2026-10-18.
- **The rotation:** a seventh of the universe a day (~1,810 of 12,660 companies), in runs of 100,
  each day resuming after the previous day's last key.
- **What a visit fetches:** stage 1 decides per company. The summary is due every 7 days. The
  statements are due on the first visit after an earnings date, else every 90 days.

The live subset (step 7, five companies) measured nothing at scale. The run width of 100, the pace,
the crumb's lifetime and the request spend per company all come from these first days. The rotation
completes on 2026-10-24.

Background: the umbrella spec `docs/specs/2026-10-10-yahoo-company-data.md`, *Step 7* and decisions
3, 20 and 21.

## What to check

**2026-10-18, after the first scheduled day:**
1. Every run SUCCESS, and every outcome counter summing to `requested` (`muffin-dagster-operations`,
   `scripts/run_events.py`). Check `throttled 0`, `crumb_rejected 0` and `summary_transport 0`.
2. Run length against `dagster/max_runtime`, and the gap between runs, which is the pool queue.
3. The price night before it (00:00) stayed clean: the company lane must not have taken the
   `yfinance` pool from it.
4. `derived_security_metrics` drained `pending_ttm` after the day's statements. No stock page lost its
   P/E: re-run `check_anon_read_latency.py` and read three 52/53-week filers' TTM (NVDA, COST, AAPL).
5. Yahoo's spend: requests per company, against the spec's budget of ~3,500 a day.

**2026-10-25, after the first full rotation:**
- `security_fundamentals.as_of`: the median is at most 7 days old.
- `market_cap_currency` is set for nearly every equity. Lenovo's cap reads HK$, not `$432.92B`.
- `no_company_is_far_behind_the_rotation` passes.
- Statements carry a currency, and the quarterly statement table shows one column per quarter for
  52/53-week filers.
- The http-cache size, after the chart lane's no-store header
  ([note](2026-10-10-http-cache-keeps-every-yahoo-chart-for-a-year.md)).

## Done when

The first full rotation has completed, with every day's counters summing and `throttled 0`, and the
checks above hold. Then step 9 (retiring the edge resources) can start.
