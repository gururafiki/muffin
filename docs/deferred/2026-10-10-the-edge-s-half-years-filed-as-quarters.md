# 3,094 half-years sit in `security_statement` as quarters

Created 2026-10-10 · Due after the edge's `security-quarters` retires (Phase 4 step 9) · Status: open

## Why it is deferred

The edge's `security-quarters` asked openbb for `period=quarter`, and Yahoo labels a half-year `3M`,
so semi-annual reporters were filed as quarters. Measured 2026-10-10: 3,094 yfinance `quarter`
periods in 2,192 securities sit 170–195 days after the previous one (VOD.L, NESN.SW and BHP.AX
among them). The app shows them in the quarterly tables as if they were three months.

`derive_ttm` is not fooled: four of them span about 18 months, past its 370-day window, so no TTM is
formed from them. The damage is the quarterly table, and the metrics derived from those rows.

The company lane (Phase 4 step 6) files a half as `period_type = 'half'`, told from a quarter by the
gap to the previous period end, and retracts the edge's `quarter` row for the same period. That
leaves two problems a one-shot has to finish:
- the edge's `security-quarters` would re-queue a company whose quarter rows disappear and write them
  back, which is why `pending_quarters` now also counts `half` rows (migration
  `20261010220000_sec_depth_is_asked_of_every_cik_holder`), and why the repair waits for the
  resource to retire;
- periods older than the window Yahoo now returns are never re-filed, so the lane cannot retract them.

## What to do

After `security-quarters` is retired (410, no `refresh_run` rows):
1. A `market.one_shot` migration that deletes yfinance `quarter` statement rows whose gap to the
   previous period end is 170–195 days, plus the `security_metric` rows derived from them
   (`period_type = 'quarter'`, the same security and `as_of`, sources `yfinance` and `derived`).
   TTMs need no repair: since muffin-deployment#428 a TTM needs four quarters within 240–300 days,
   which half-year spacing never meets, and a re-evaluation retracts any that remain.
2. Count before and after, and name five securities to check on the stock page.

## Done when

No yfinance `quarter` row sits 170–195 days after its predecessor, and the quarterly tables of
VOD.L, NESN.SW and BHP.AX show halves under their own label or nothing.
