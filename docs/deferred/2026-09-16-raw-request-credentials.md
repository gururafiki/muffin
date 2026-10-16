# Raw documents would store API keys that travel in the request URL

Created 2026-09-16 · **Due before the first keyed provider's raw asset merges; next check: Phase 4
step 7, the company lane's first live run** · Status: open, the first provider's half built

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

## Checked 2026-10-16

- **The first credential in a URL is Yahoo's crumb**, and its adapter redacts it:
  `yahoo_summary.fetch` stores `crumb=redacted`, declared by name, and
  `test_yahoo_company.py` asserts the stored URL holds no crumb (muffin-ingest#107, rolled
  2026-10-11). Its raw asset, `raw_yahoo_summary`, arrives with muffin-ingest#110, so no summary file
  exists on the node yet.
- **Nothing credential-like has ever been stored.** Every `url` column under the raw root, read
  inside the code-location container: 50,996 Parquet files, 37,503 stored URLs. None contains the
  value of any of the 8 credential variables in the container's environment (`ALPHA_VANTAGE_API_KEY`,
  `DAGSTER_PG_PASSWORD`, `DART_API_KEY`, `EDINET_API_KEY`, `FRED_API_KEY`, `GPG_KEY`,
  `OPENFIGI_API_KEY`, `TIINGO_TOKEN`), and none carries an `apikey`, `api_key`, `token`,
  `crtfc_key`, `crumb`, `key` or `access_token` parameter. Only names and counts were printed.
- **OpenFIGI's key travels in a header**, which raw does not store.
- **Still to do:** the same scan over `raw_yahoo_summary` after #110's first live run. Then each
  Phase 5–6 keyed provider (Alpha Vantage `apikey`, Tiingo `token`, FRED `api_key`, DART
  `crtfc_key`) redacts in its adapter the way the summary does, with the same test.

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
