# Raw documents would store API keys that travel in the request URL

Created 2026-09-16 · **Due before the first keyed provider's raw asset merges; check 2026-10-16** ·
Status: open

## Why it is deferred

Found while writing the raw-layer rules. No keyed document provider runs on Dagster yet — SEC, NSE,
Yahoo and OpenFIGI send no secret in the URL — so nothing has leaked. The Phase 4–6 families will add
providers that do.

## Context

- `muffin-ingest` `src/muffin_ingest/providers/documents.py`: `Document.as_row()` stores `url`
  verbatim beside the body, and the raw Parquet files live for ever on `/mnt/data/ingest/raw`.
- Keyed providers planned for Dagster: Alpha Vantage (`apikey=`), Tiingo (`token=`), FRED
  (`api_key=`), DART (`crtfc_key=`); CLAUDE.md already records that the Alpha Vantage and Tiingo keys
  travel in the query string. For any other provider, check where its key travels before its first
  raw asset. Headers are not stored today.
- Rule: `dagster-ingestion-best-practices` › `references/raw-layer.md` — redacting a credential in the
  stored request context is the one permitted change; persisting a secret is forbidden.
- The HTTP cache already keys GET requests on the full URI, so a rotated query-string key invalidates
  that provider's cache (CLAUDE.md › The HTTP cache) — a separate effect, not fixed by this.

## What to do

1. Declare each provider's credential parameter names explicitly in its adapter — a list, not a
   heuristic.
2. Redact those parameters in the URL before `as_row` stores it, keeping the parameter name
   (`apikey=REDACTED`) so the stored request still shows what was asked.
3. Test with a keyed URL: the stored `url` holds no key, equals the redacted form, and the body is
   unchanged by sha256.
4. Grep the existing raw root on the node for known key values (without printing them) to confirm
   nothing was ever stored.

## Done when

The redaction test is merged, and the first keyed provider's raw files on the node contain no
credential.
