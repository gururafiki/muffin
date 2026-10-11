# 3,094 half-years sit in `security_statement` as quarters

Created 2026-10-10 · Due after the edge's `security-quarters` retires (Phase 4 step 9) · Status: open

## Why it is deferred

The edge's `security-quarters` asked openbb for `period=quarter`, and Yahoo labels a half-year `3M`,
so semi-annual reporters were filed as quarters. Measured 2026-10-10: 3,094 yfinance `quarter`
periods in 2,192 securities sit 170–195 days after the previous one (VOD.L, NESN.SW and BHP.AX
among them). The app shows them in the quarterly tables as if they were three months.

`derive_ttm` is not fooled: four of them span about 18 months, past its 370-day window, so no TTM is
formed from them. The damage is the quarterly table, and the metrics derived from those rows.

The company lane (Phase 4 step 6, muffin-ingest#107) files a half as `period_type = 'half'`, told
from a quarter by the CADENCE of the company's quarterly series. That is half-yearly only if every
gap between period ends is 170–195 days. It does NOT retract the edge's `quarter` row, which sits
beside the `half` row for the same period until this repair runs. That leaves two problems a one-shot
has to finish:
- the edge's `security-quarters` would re-queue a company whose quarter rows disappear and write them
  back, which is why `pending_quarters` now also counts `half` rows (migration
  `20261010220000_sec_depth_is_asked_of_every_cik_holder`), and why the repair waits for the
  resource to retire;
- periods older than the window Yahoo now returns are never re-filed, so the lane cannot retract them.

## What to do

After `security-quarters` is retired (410, no `refresh_run` rows):
1. A `market.one_shot` migration that deletes the yfinance `quarter` statement rows of every
   security the lane has filed a `half` row for (its cadence is half-yearly), plus the
   `security_metric` rows derived from them (`period_type = 'quarter'`, the same security and
   `as_of`, sources `yfinance` and `derived`).
   **Not by the gap of each row.** Corrected 2026-10-11: 2,210 securities have a 170–195-day gap
   in their Yahoo quarter series, and 1,451 of them also have 90-day gaps. They are quarterly
   reporters missing a quarter (600011.SS 2025-12-31, 184 days after 2025-06-30, a three-month
   income statement), and a per-row rule would delete their real quarters.
   TTMs need no repair: since muffin-deployment#428 a TTM needs four quarters within 240–300 days,
   which half-year spacing never meets, and a re-evaluation retracts any that remain.
2. Count before and after, and name five securities to check on the stock page.

## Done when

No yfinance `quarter` row sits 170–195 days after its predecessor, and the quarterly tables of
VOD.L, NESN.SW and BHP.AX show halves under their own label or nothing.
