# Two SEC clients

Created 2026-11-02 · Planned in [the SEC spec](../specs/2026-10-24-sec-family.md) (*Deferred
notes*) · Status: open, small, no decision needed

## Why

Phase 5 put every SEC family request on one client, `providers/sec_edgar.fetch`: edgartools'
transport with its disk cache off, a 5-requests-a-second limiter, a 403/429/5xx raised as
`SecRefused`, and a control filer (`CONTROL_CIK`) that proves an absence. Two older callers still
reach SEC through `providers/documents._get`, plain httpx:

| Caller | Requests | Through |
|---|---|---|
| `documents.sec_company_tickers` (the CIK map, `security_cik`) | one ~776 KB file per run | http-cache `sec` |
| `providers/sec_nport` (N-PORT holdings: `fund_directory`, `search_index`, `primary_doc`) | a few per tracked fund per quarter | http-cache `sec`, `sec-fts` |

Both send `settings.user_agent()` and are counted under `provider="sec"`, so neither is
broken. What they lack:
- **The limiter.** SEC allows 10 requests a second per address. The filer lane, the Form 4 lane and
  the edge's segment handler already share the node's address; N-PORT runs outside the shared
  5-a-second budget.
- **The absence rule.** `_get` raises `DocumentRefused` on every non-200, a 404 included, and
  asks no control. The SEC lanes file a 404 as an absence once the control has answered in the
  run, and stop on a 403 or 429.
- **The cache bypass.** They are served through http-cache, which keeps a 200 for its location's
  TTL, so the N-PORT search index can return a cached answer (see the 2026-10-20 note on the cache
  serving a failing provider's last answer).

## What to do

Move both onto `sec_edgar.fetch`, keeping their raw shapes. The cache question is per request:
the EDGAR full-text search should bypass (it answers "what was filed since"), while a filing's
primary document is immutable and can stay cached.

## Done when

`grep -rn "sec.gov\|efts" muffin_ingest/providers` finds only `sec_edgar.py`, and the N-PORT lane's
next quarter runs on it with outcomes summing.

## Context

- `muffin-ingest/libs/muffin-ingest-lib/src/muffin_ingest/providers/documents.py`, `sec_nport.py`,
  `sec_edgar.py`.
- [The cache serves a failing provider's last answer](2026-10-20-the-cache-serves-a-failing-provider-s-last-answer-for-ever.md).
