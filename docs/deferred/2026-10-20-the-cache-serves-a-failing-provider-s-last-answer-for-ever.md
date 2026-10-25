# The cache serves a failing provider's last answer indefinitely

Status: **decided 2026-10-25 (the user): option 3.** Keep serving stale on 429/5xx; every Dagster request that needs an honest answer sends the bypass or no-store headers; list each location with its Dagster callers and close. Edge callers are out of scope (they are being retired, and are not fixed).

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

## Context

- `docs/deferred/2026-10-20-the-price-target-lane-trusted-a-cached-control.md`
- `docs/deferred/2026-09-16-http-cache-serves-stale-to-daily-lanes.md` (the first-request form)
- CLAUDE.md § The HTTP cache
