# OpenFIGI returns its errors as HTTP 200, so http-cache stores them for 90 days

Created 2026-09-21 · **CLOSED 2026-09-22** by muffin-ingest#69 + muffin-deployment#385 (deployed
09-22 21:57 UTC, directive verified in the running http-cache config on 09-24)

## What happened

Two venues (SM, PM) failed the venue backfill twice, identically, with
`OpenFigiUnreadable: openfigi /v3/filter replied with an error: There was an error while
processing this request.` A transient does not pick the same two venues twice.

Both walk cleanly in 3 pages when asked DIRECTLY. Through http-cache the node gets:

```
http 200 | cache: HIT | ERROR: There was an error while processing this request.
```

Read off disk, decompressed, byte-exact:

```
KEY: POST|api.openfigi.com|/openfigi/v3/filter|f06ce690d4628ff92ba95f4542a74f6d
HTTP/1.1 200 OK
{"error":"There was an error while processing this request."}
```

OpenFIGI answers a transient server fault with **HTTP 200** and an error body.
`proxy_cache_valid 200 90d` therefore stores it, and `proxy_ignore_headers Cache-Control` removes
the provider's own opportunity to prevent that. **One second of provider trouble becomes three
months of a request that cannot succeed.**

`nginx.conf`'s header says *"WHAT IS DELIBERATELY NOT CACHED: anything that is not a 200. A cached
429 or 5xx is poison"* — correct, and blind to an error that wears a 200.

## Blast radius, measured

268,358 cache entries, **1,582 OpenFIGI**, **exactly 2** holding an error body. Both were the
venue sweep's page-1 requests for SM and PM. Purged by hand; both venues then swept in 3 pages.

It was contained this time by luck: the same hiccup on the US request would have made the largest
venue unsweepable until December.

## The detector that said zero, and why

A first scan grepped the cache for the error text and reported **0 poisoned of 268,314** while two
entries were demonstrably serving it. Two reasons, both worth keeping:

* OpenFIGI answers **gzipped**, so the body is not plaintext on disk;
* the check for `Content-Encoding: gzip` used a capital C, and **nginx stores headers lowercase**.

So the detector destroyed the thing it detects — the same shape as the `http-cache-covers-every-
provider` guard that truncated `https://host` at `https:`. The working scanner decompresses and is
at `/tmp/scan_openfigi_cache.py` on the node (also reproduced in this note's history).

**Entries are locatable exactly, without scanning**: the key is
`"$request_method|$proxy_host|$request_uri|$body_key"` with `$body_key = ngx.md5(<raw body>)`, and
the filename is `md5(key)` filed at `levels=1:2`. Computing it for
`{"exchCode":"SM","securityType2":"Common Stock"}` found the file first try.

## What to do

Three options, in the order they are worth considering:

1. **Do not cache an OpenFIGI response whose body is an error.** nginx decides cacheability from
   the status line before the body filter runs, so this needs OpenResty to inspect the body and
   set `ngx.var.no_cache` — the cache key is already computed in Lua, so the machinery is there.
   Fixes it for every caller at once.
2. **Have the CALLER bypass the cache when it sees an error body**, by re-asking with
   `Cache-Control: no-cache` wired to `proxy_cache_bypass`. Narrower, needs no nginx change, and
   turns "cached poison" into "one wasted request". Pairs naturally with classifying the transient
   error as retryable rather than fatal — which is a separate defect in the same failure.
3. **Shorten the TTL.** Cheapest and weakest: 90 days is right for the DATA (a FIGI mapping is
   effectively permanent), so cutting it to buy error recovery trades the thing the cache is for.

Prefer 1, take 2 if the Lua proves awkward, and do not do 3 alone.

## Also worth fixing beside it

`facets/openfigi.parse_filter` treats EVERY 200-with-error as fatal, behind a comment asserting it
is "a shape problem in OUR request, never a venue that has nothing". Measured false: `Invalid key
'…'` is ours, `There was an error while processing this request.` is theirs and transient. A
transient must stop the venue the way a 429 does — file what was fetched, leave it resumable — not
raise and fail the run.

## Done when

An OpenFIGI error body is not cached (or is bypassed on the retry), a transient error leaves the
venue resumable rather than failing the run, and this note records the mechanism chosen.

## Closed — the mechanism chosen

The caller decides, because nginx decides cacheability from the status line before any body
filter could see the error. `parse_filter` now tells the two errors apart instead of calling every
200-with-error "ours":

- `Invalid key '…'` is ours and permanent, so it raises at once and spends no second request.
- `There was an error while processing this request.` is theirs, so it is re-asked ONCE with
  `X-Muffin-Cache-Bypass: 1`. nginx maps that header to `proxy_cache_bypass`, which skips the stored
  entry AND stores the fresh answer over it, so one retry also un-poisons the entry for every later
  caller. `proxy_no_cache` would have left the bad entry in place.
- The same error twice becomes `OpenFigiUnavailable`, the same fact as a 429. The sweep stops,
  files what it fetched, and stays resumable, and `venue_sweep_reached_its_last_page` names the
  venue.

An error nobody recognises is treated as theirs on purpose. Reading a transient as ours would fail
a run and need a human at 3am. Reading ours as a transient only leaves a venue unfinished on a
dashboard.
