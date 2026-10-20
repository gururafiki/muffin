# The price-target lane trusted a cached control, and Yahoo already holds the data

Status: open. Phase 6 (events family), where `security-price-targets` leaves the edge. The outage
itself is over: finviz answers again since openbb-mcp-docker#5 (deployed 2026-10-20 12:20 UTC; the
12:30 run advanced 120 securities), and both edge controls ask past the cache since
muffin-deployment#454.

## Why

From about 2026-09-30, finviz refused every request from openbb-api with 403: price targets
(`quote.ashx`) and sector groups (`groups.ashx`) alike. The cause was the client.
- openbb-api's image (built 2026-08-10, `openbb[all]` unpinned) had finvizfinance 1.3.0, whose
  2020 Chrome/81 User-Agent finviz now flags.
- muffin-ingest, on finvizfinance 1.5.0, got 11 sector rows and 20 AAPL price targets from the
  same node in the same minute on 2026-10-20.

openbb-mcp-docker#5 pins the package set and takes finvizfinance >= 1.5.0.

`security-price-targets` reported `ok: true` on every run for three weeks: `advanced: 0`,
`actions: 20`, `remaining` growing to 3,265, then flat. Two things hid the outage.

1. **The control symbol was answered by the cache.** `fetchWithIsolation` asks AAPL to tell an
   outage from a batch of uncovered symbols. The edge reaches openbb through http-cache, which
   still held a 200 for AAPL's price targets, so the control "answered". The helper then reported
   `control AAPL answered — the provider is up and these symbols are unanswerable` about a
   provider that answered nobody.
   - No security was mislabelled: the lane advances a cursor only on a null error and never marks
     `dead`.
   - It is the only live caller. The helper's other callers retired on 2026-10-18 and leave with
     their handlers at step 10.
   - A control can only prove the provider is healthy if it bypasses every cache between the
     caller and the provider.
2. **The 20 rows written each run were AAPL's cached answer**, re-upserted with a fresh
   `fetched_at`. So `security_price_target.fetched_at` read 2026-10-20 for data from a cache entry
   of unknown age.

The alerts did fire, "A backlog is not draining while its runs report success" and "A non-empty
backlog has been FLAT for a week", both since at least 2026-10-16. Nobody read them until
2026-10-20.

**A latent gap, for whoever moves the lane.** The handler advances a batch only when
`fetchWithIsolation` returns no error, and its comment says the helper returns none "after isolating
each symbol and proving the provider healthy with a control". The helper does not: after isolating,
it always returns the batch's error. In practice this rarely matters. openbb's finviz adapter
answers a mixed batch with the good symbols' rows (`SGGKF,BAC` → 200, 20 rows, while `SGGKF` alone
is a 400 because its finviz page is a 404, measured 2026-10-20), so only a batch whose every symbol
is unanswerable reaches the isolation path. Such a batch would never advance.

## What Yahoo already has

The company lane's quoteSummary requests `upgradeDowngradeHistory`, so the document
`raw_yahoo_summary` stores for every company the rotation visits already carries analyst actions.
Measured on AAPL's stored document on 2026-10-20:
- **969 entries**, newest 2026-10-12 (JP Morgan, Overweight → Overweight, `priceTargetAction:
  Raises`, `priorPriceTarget` 340, `currentPriceTarget` 360);
- every field `security_price_target` stores: firm, date, prior and current target, action, and
  the grade change;
- finviz returned 20 rows for the same company.

Coverage is US listings in both. The provider module notes that non-US listings lack the module.

## What to do (Phase 6)

- Prefer a stage-2 parse of the stored summary documents to a finviz fetch. It costs no request
  and has deeper history. Measure coverage over the rotation's documents before deciding, and
  compare a sample against finviz for the same firms and dates.
- If finviz stays, ask it from muffin-ingest's in-process openbb, which has no cache in the path.
  Any control must bypass caches.
- Retire `security-price-targets` (RETIRES marker, 410) once the replacement has run.

## Done when

`security_price_target` is written by a Dagster lane, the edge resource answers 410, and
`pending_price_targets` is dropped.

## Context

- CLAUDE.md § Phase 4 check-in 2026-10-20
- openbb-mcp-docker#5; `stack/supabase/functions/market-refresh/resources.ts` (`fetchWithIsolation`)
- `libs/muffin-ingest-lib/src/muffin_ingest/providers/yahoo_summary.py` (the module list)
