# Raw documents would store API keys that travel in the request URL

Created 2026-09-16 · **Due before the first keyed provider's raw asset merges; next check: the
first Phase 5–6 keyed provider's raw asset** · Status: open, Yahoo's half done and verified on the node

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

## Checked 2026-10-20, after the company lane's first days

The scan above, repeated over the whole raw root inside the code-location container (120 s, 132 MB
peak; names and counts printed only):
- 61,588 Parquet files, 41,847 with a `url` column, 62,959 stored URLs.
- `raw_yahoo_summary`: 5,176 files, 5,176 URLs, and **every one carries `crumb=redacted`**. No other
  crumb value appears in any query string, path or host.
- `raw_yahoo_statements` (10,354 URLs), `raw_price_chart` (24,434) and `raw_yahoo_symbol` (711) carry
  no credential parameter, as expected: none of those endpoints takes one.
- No URL contains the value of any of the same 8 credential variables, and none carries an `apikey`,
  `api_key`, `token`, `crtfc_key`, `key` or `access_token` parameter.

So Yahoo's half is done. What remains is the second half of "Still to do" above: each Phase 5–6 keyed
provider redacts in its adapter, with the same test, and its raw files get the same scan. The scan
is now a script, `muffin-dagster-operations/scripts/scan_raw_urls.py` (muffin-deployment#456), and
`dagster-ingestion-best-practices`' raw layer points at it (muffin-ingest#117).

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
