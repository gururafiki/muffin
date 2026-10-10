# Two readers still take a market cap from `security.market_cap`, which stops refreshing

Created 2026-10-10 · Due with Phase 4's contract step (step 10) · Status: open

## Why it is deferred

Since Phase 4 step 5 (muffin-deployment, migration `20261010200000_a_market_cap_carries_its_currency`),
a market cap lives on `security_fundamentals.market_cap` with its own `market_cap_currency`, written
weekly by the Dagster company lane. `security.market_cap` stays as the backup until the contract
step, and nothing refreshes it any more.

That migration moved the readers that convert or label a cap:
- `security_market_cap_usd`, and through it style, cap bands, peers, `aggregate_performance` and the
  screener;
- `security_current` and `instrument_current`, the stock page.

Two readers were left on the legacy column on purpose:

| Reader | What it does with the cap | Why it waited |
|---|---|---|
| `sector_constituents` | orders a country's sector page, and returns `market_cap` beside `currency_code` | It was the 14-second anon timeout of 2026-09-25 (migration `20260925000000`). A new join there needs its anon timing re-measured, which belongs with the contract's other view changes |
| `security_facets.market_cap_native` | `security_current.market_cap`, so it follows the new cap already; its `currency_code` comes from `security_currency`, not from the cap | Nothing in the app reads the native column (measured 2026-10-10: the screener reads `market_cap_usd`) |

So the sector page orders by the August caps until this closes. Within one country page the
currencies mostly agree, so the order is stale rather than wrong.

## What to do

1. `sector_constituents`: take `coalesce(f.market_cap, s.market_cap)` and append
   `market_cap_currency`, as `security_current` does. Time the app's own query as anon, best of
   three, before and after (`check_anon_read_latency.py` already probes it).
2. Find any other reader with
   `select distinct dependent from pg_depend … where referenced column = market.security.market_cap`,
   and any function body naming it.
3. Drop `security.market_cap` and `market_cap_at` with the rest of the contract, once that query
   returns nothing.

## Done when

No view or function reads `security.market_cap`, and both columns are dropped.
