# A slash in a symbol is a second path segment

Created 2026-10-11 · Due with the next muffin-ingest change that touches `yahoo_chart` · Status: open

## Why it is deferred

The chart lane builds its URL as `f"{base}/v8/finance/chart/{symbol}"`
(`libs/muffin-ingest-lib/src/muffin_ingest/providers/yahoo_chart.py`, `fetch`), so a symbol that
contains `/` asks Yahoo for a different path. The first scheduled night of the lane (2026-10-11)
asked about `3BBIF/F.BK` and got an HTML `Not Found` page. `_names_an_absence` correctly found no
statement about the symbol in it, so the run counted the request as `transport`, and a transport
failure records nothing.

Measured from the node on 2026-10-11, one request each:

| Request | Status | Body | Counted as |
|---|---|---|---|
| direct, `3BBIF/F.BK` as it is | 404 | HTML `Not Found` | transport |
| direct, `3BBIF%2FF.BK` | 404 | JSON `No data found, symbol may be delisted` | absent |
| through http-cache, `3BBIF%2FF.BK` | 404 | HTML `Not Found` | transport |

Encoding the slash is therefore not enough by itself. The `yahoo` location in
`muffin-deployment/stack/proxy/nginx.conf` rewrites the decoded URI, so the cache sends a literal
`/` upstream again.

The effect:
- **Such a symbol is never recorded as a miss.** It stays askable and is asked on every visit, about
  every five nights. Each visit costs one request and reports `transport: 1`, which makes a real
  transport failure harder to see.
- **The dead-symbol repair never sees it**, because it acts on a miss.
- **18 yfinance symbols carry a `/` (2026-10-11):** 16 Thai foreign-board lines (`…/F.BK`),
  `ACS/D.MC` and `KEY/R.TO`. All come from OpenFIGI's Bloomberg spelling. For `3BBIF` the repair
  adopted it on 2026-10-06, after the hyphenated `3BBIF-F.BK` was marked dead on 10-01. That earlier
  miss names the other spelling, so it does not exclude the new one.
- 16 of the other 17 hold a `yfinance` miss for the `/` spelling itself. The openbb lane could
  record those, between 09-25 and 10-10. They return to the sweep as the 30-day misses expire, from
  about 2026-10-25 to 11-09. `ACS/D.MC` has no probe and is askable now; it is the grid's last key.
- The repair note says this churn "is bounded", because the next sweep records the new spelling's
  death. Under the chart lane it cannot, so it is not bounded
  ([note](2026-10-05-what-the-dead-symbol-repair-cannot-reach.md)).
- They are scattered through the grid (at most two within one run's 25 keys), so they cannot trip a
  run's "three transport failures and nothing answered" stop.

## Context

- Spec: [the price lane reads the quote currency](../specs/2026-10-06-the-price-lane-reads-the-quote-currency.md).
- `yahoo_chart.fetch` also serves the FX lane (`EURUSD=X`) and the index lane (`^GSPC`). The URL's
  parameter order is http-cache's key, so changing how a URL is spelled turns every stored entry for
  it into a miss.
- CLAUDE.md, http-cache: "a literal hostname in `proxy_pass` is resolved at startup", so every
  location proxies through `set $up` plus `rewrite … break`, and that rewrite decodes.

## What to do (a decision)

1. **Encode only `/` (as `%2F`) in the chart path, and make the `yahoo` location forward the path
   as it was received.** Recommended. Yahoo then states the absence, and the lane marks it like any
   other. Encoding only `/` leaves the FX and index URLs, and their cache keys, unchanged. This needs
   an ingest PR and a deploy for nginx. Test it through http-cache, not directly.
2. **Refuse a symbol containing `/` in `askable_subjects` and count it as `not_askable`.** This is
   ingest only and needs no deploy. It records nothing, so the bad spelling stays in place.
3. **The repair note's option 2** (provider-verified spelling candidates, `/` to `-`) fixes the
   spelling where Yahoo has one. For the Thai foreign boards it does not: both spellings 404.

## Done when

A symbol with a `/` is asked as one path segment through http-cache, its absence is recorded as a
miss, and no night reports `transport` for one.
