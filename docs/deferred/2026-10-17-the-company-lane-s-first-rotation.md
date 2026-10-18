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

## The first day, read 2026-10-18

Every check passed but two, and both were defects that are now fixed.

**Runs.**
- 18 of 18 SUCCESS, from 03:30:31 to 05:50:53 UTC, 2 h 20 min.
- Each run took 461–478 s against `dagster/max_runtime` 1,800 s (26%).
- The runs were serialised on the `yfinance` pool, so the last waited 7,736 s in the queue. That is
  expected.
- **Not expected: the runs also held the `sql` pool, which is run-granularity.** Four
  `derived_security_metrics` runs created 03:47–05:17, and the listing runs created 05:41–05:47,
  waited until 05:51, up to 7,418 s. The cause is the
  [run-granularity pool note](2026-09-16-sql-pool-run-granularity-blocks-every-lane.md), at a new
  scale. Nothing failed, but no roll or deploy should go in before about 06:00, not 05:30.

**Counters.**
- Every one sums to `requested`.
- Summary: 1,726 answered + 35 not askable + 1 transport = 1,762.
- Statements: 1,726 fetched + 1 skipped + 35 not askable.
- `throttled 0`, `crumb_rejected 0`, 18 sessions.
- **The one `summary_transport` was a defect:** `3BBIF/F.BK`. Yahoo states an absence in a second
  wording, `Quote not found for ticker symbol`, for every symbol containing a `/`, and the lane
  matched only `Quote not found for symbol`.
  - Fixed in muffin-ingest#115, rolled 2026-10-18 08:05 UTC (`a09b15…` → `25d8b2…`).
  - Verified live: both wordings now come back as answers.

**What it wrote.**
- Profiles 1,699, fundamentals 1,702, share stats 1,698, estimates 1,538.
- Officers 13,897, none retracted.
- Classification 3,398 rows, 17 retracted.
- `provider_country_iso2` changed for 1,520 companies. The edge only ever filled it for a scoped 384.
- 44,632 statement rows over 1,723 securities: none without a currency, 627 half-years, 92 mixed
  currency, no unknown keys.
- `fundamental_units_are_conventional` passed: dividend yield median 1.67 (percent), profit margin
  0.0666, ROE 0.0847.
- `no_company_is_far_behind_the_rotation` warns, as it must until the rotation completes: 11,009 of
  12,660 stale.

**Yahoo's spend.**
- 5,179 data requests for 1,727 companies asked: one summary plus the annual and quarterly
  timeseries, 3.0 each.
- Plus 36 session requests, so 5,215 in all.
- That is over the spec's ~3,500 a day only because every company's statements were never fetched
  (`statements_reason_never_fetched` 1,726). From the second rotation, statements are due only after
  an earnings date or at 90 days.
- 488 MB transferred, stored as 124 MB of Parquet (35 MB summaries, 89 MB statements).

**Downstream.**
- After the lane, `derived_security_metrics` drained `pending_ttm` 352 → 0 (4,476 TTM rows) and the
  metrics backlog 8,839 → 0.
- The price night before it was clean, and the lane never contended with it.
- `check_anon_read_latency.py` passed all 23 reads once `muffin-db-backup.sh` read 0. The statements
  read (`security_statement_current`) took 0.47–0.69 s best of three on AAPL, MSFT, 7203.T and
  VOD.L in the morning, and 0.65–0.85 s that afternoon. **It grows with the table**, which the
  rotation adds ~44,600 rows to a day:
  [note](2026-10-18-the-statements-read-resolves-every-symbol.md), check by 2026-10-21.

**The TTM spot check found two defects in `derive_ttm`.**
- AAPL's and NVDA's TTM EPS and P/E are continuous, one TTM per quarter, matching the filings.
- **COST had no TTM at all.** A 12/12/12/16-week year (Q1 to Q3 168 days, Q3 to the year end 112, 119
  in a 53-week year) failed both Q4 bounds. So Costco, PepsiCo, AutoZone and Domino's had no TTM, and
  their P/E stood on the fiscal year: COST 54.32 on 18.21.
- **Separately, a quarter counted twice with another missing still spanned a year.** 797 accepted
  windows in 109 securities were affected. 42 of them are a newest TTM, among them Greif's EPS of
  7.845, which counted a summer twice after its fiscal-year change.
- Both are fixed in muffin-deployment#443, validated on production's rows first, deployed 14:14 UTC.
  The 14:17 derivation drained the 236 re-queued securities. Served now: COST 49.75 on 19.88, PEP
  17.23 on 7.63, Greif B 15.86 on its fiscal year (labelled `annual`), and AAPL/NVDA/MSFT/JACK
  unchanged.
- AAPL's quarterly statement table shows one column per quarter (decision 21, #441).

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
