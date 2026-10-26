# The cache serves a failing provider's last answer indefinitely

Status: **closed 2026-10-26.** Decided 2026-10-25 (the user): option 3. muffin-ingest#131 rolled 2026-10-26 18:33 UTC. Keep serving stale on 429/5xx; every Dagster request that needs an honest answer sends the bypass or no-store headers; list each location with its Dagster callers and close. Edge callers are out of scope (they are being retired, and are not fixed).

## Why

`stack/proxy/nginx.conf` sets, for every location:

```
proxy_cache_use_stale error timeout updating http_429 http_500 http_502 http_503 http_504;
proxy_cache_background_update on;
```

with `inactive=365d`. Once an entry expires, `updating` hands the stale entry to the request
while a background subrequest refreshes it. If the refresh comes back with a status nginx does
not store, the entry stays: a 400, 403 or 404 is passed to nobody and discarded. The next request
finds the same expired entry and starts another refresh. So **a URL asked at least once a year
keeps serving its last 200 for as long as the provider fails that way**, and the caller cannot
tell.

Measured 2026-10-20 on `/openbb/` (TTL 1 hour): finviz refused openbb-api with 403 from about
2026-09-30, and openbb wraps that as a 400.
- `security-price-targets` asked AAPL's price targets as its control on every run, and http-cache
  answered `STALE … price_target?symbol=AAPL&provider=finviz -> 200` for three weeks.
- The lane re-wrote AAPL's 20 cached rows on every run with a fresh `fetched_at`, and reported the
  provider healthy.

The documented behaviour (CLAUDE.md, 2026-09-16) was that the first request after expiry gets the
stale entry. While the provider keeps failing, every request does.

## What is already done

muffin-deployment#454: a control request sends `X-Muffin-Cache-Bypass` (`proxy_cache_bypass`), so
the two edge controls reach the provider.

## Options

1. **`proxy_cache_background_update off` on locations whose callers need an honest error**, as
   `/yahoo/v8/finance/chart` already has since the FX stale-body fix. The first request after expiry goes to the provider
   synchronously. A 400 is passed through, since it is not in `use_stale`'s list, while concurrent
   requests still get the stale entry (`updating`) and 429/5xx still serve the last good answer.
   Cost: one synchronous provider call per entry per TTL.
2. **Bound the staleness** with an OpenResty check on the entry's age, refusing to serve it past
   N × TTL. More code in the one component every provider call goes through.
3. **Leave it, and bypass where health matters** (#454's approach). Cheapest, and it relies on
   every future caller remembering.

## What to do

- List the locations whose callers ask a repeating URL. A URL that changes every night (the chart
  lane's `period2`, quoteSummary's crumb) cannot meet this. The edge's openbb calls, SEC's
  submissions and the FX spot lane can.
- Decide per location, with the user. Then re-measure by forcing a provider error on one URL in a
  throwaway container and reading what the second and third requests receive.

## Done when

A provider's 4xx reaches a repeating caller within one TTL of the first failure, on every location
a live lane depends on, or the locations where it does not are listed with the reason.

## Each location and its Dagster callers (2026-10-25)

Edge and agent callers are out of scope by the decision. Settings are `stack/proxy/nginx.conf` on
2026-10-25.

| Location (TTL) | Dagster caller | URL repeats? | Fresh answer needed? | Treatment |
|---|---|---|---|---|
| `/sec/` (30d) | `documents.py` (filing documents), `sec_nport.primary_doc` | no: one accession, immutable | no | cached; a filed document never changes |
| `/sec/` (30d) | `sec_nport.fund_directory` (`company_tickers_mf.json`) | yes, daily | yes: a fund SEC listed in the last month could not resolve for up to 30 days | **bypass**, muffin-ingest#131 |
| `/sec-fts/` (7d) | `sec_nport.search_index` (`new_nport_filings`) | only within a day: the window is `today − 310` to `today` | no: a filing published after the day's first search is found the next day | cached, listed |
| `/sec-data/` (7d) | none yet (Phase 5's lane sends bypass and no-store, decision 2) | — | — | — |
| `/openfigi/` (90d) | `openfigi.filter` (directory) | yes, monthly | yes | **bypass** since 2026-10-04 |
| `/openfigi/` (90d) | `openfigi.mapping` (symbology rungs) | rarely: the key is the batch body, and a re-ask's batch is a different set of subjects | yes, for a re-ask | cached; an error wearing a 200 is retried past the cache |
| `/yahoo/v1/finance/search` (30d) | `yahoo_search.search` (Yahoo rung) | yes: the same ISIN, re-asked after 30 days, the TTL | yes | **bypass**, muffin-ingest#131 |
| `/yahoo/v8/finance/chart` (1h, no background update) | price lane, FX lane | price: never (no-store); FX: within the hour | FX: yes | price no-store; FX synchronous on expiry since the stale-body fix |
| `/yahoo/v10/finance/quoteSummary`, `/yahoo/ws/fundamentals-timeseries`, `/yahoo/v1/test/getcrumb` | company lane, session | — | yes | `proxy_cache off` |
| `/nse/`, `/nse-archives/` | `documents.py` (archives) | archives: no, immutable | no | `/nse/` uncached; archives cached |
| `/dart/`, `/cninfo*/`, `/wikidata/`, `/alphavantage/`, `/tiingo/`, `/openbb/`, `/mcp/` | none | — | — | edge or agent only, out of scope |

Calls muffin-ingest makes through openbb in-process (indices, sector groups, analyst targets) go
straight to the provider and never reach http-cache.

## Context

- `docs/deferred/2026-10-20-the-price-target-lane-trusted-a-cached-control.md`
- `docs/deferred/2026-09-16-http-cache-serves-stale-to-daily-lanes.md` (the first-request form)
- CLAUDE.md § The HTTP cache
