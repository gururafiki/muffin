# finviz moved its quote page, and the price-target resource is frozen

Created 2026-11-05, from the firing `muffin-backlog-stalled` alert · Status: **open, for the user to decide**.

## Why

`pending_price_targets` has stayed at **2,865** for every sample since 2026-11-04 16:04 UTC. Every
`security-price-targets` run since then has looked the same:
- `actions: 0, advanced: 0`;
- `openbb 400 on /api/v1/equity/estimates/price_target?symbol=ASC,TRPCF,MNDY,…`;
- the message `all 40 failed individually and the control did not answer — treated as a provider
  outage, not bad symbols`.

The resource behaves correctly: it marks nothing. The data it serves is frozen at 11-04.

Measured from the node on 2026-11-05:
- **openbb-api** answers `400 {"detail":"Failed to get data for AAPL"}` for AAPL and GWW with
  `provider=finviz`, on finvizfinance 1.5.0, the version that fixed October's User-Agent block.
- **finviz itself is not blocking.** `https://finviz.com/quote.ashx?t=AAPL&p=d` answers **301** to
  `/quote?t=AAPL&p=d`, which ends at `https://finviz.com/stock?t=AAPL&p=d` with a 200 and 307 KB.
- **finvizfinance in muffin-ingest** fails the same way (`TypeError: object of type 'NoneType' has
  no len()` after `warn_missing(url, selector)`). The library still scrapes the old layout.

So finviz changed its site on or around 11-04 and the scraper is broken upstream. openbb-api's
deploy restart on 11-04 at 22:15 is not the cause: the stall began six hours earlier.

## Options

1. **Retire `security-price-targets` now, and build the analyst actions from Yahoo.** The company
   lane already stores `upgradeDowngradeHistory` in every quoteSummary document: AAPL's carries
   969 entries with the firm, both grades and the prior and current target, against finviz's 20
   ([2026-10-20 note](2026-10-20-the-price-target-lane-trusted-a-cached-control.md)). The new
   asset is a stage 2 over files already on disk and makes no provider request. Retiring the
   resource also takes its backlog off the stalled alert.
2. **Wait for an upstream finvizfinance fix**, then re-pin openbb-mcp-docker. That is a dependency
   bump for the edge, and the date is unknown. The alert stays red until then, and a red gate
   hides the next true positive.
3. **Retire the resource and build nothing yet.** The table stays as it was on 11-04 until a
   phase replaces it.

Recommended: 1, which is the replacement the 10-20 note already identified.

## Done when

The user has chosen; `muffin-backlog-stalled` no longer names `pending_price_targets`; and the stock
page's analyst actions are newer than 2026-11-04.

## Context

- `muffin-deployment/stack/supabase/functions/market-refresh/` (`security-price-targets`).
- `todos.md`, Phase 5 (the 2026-11-05 check-in).
