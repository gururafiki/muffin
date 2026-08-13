Describe for me all the external calls we are making and when. What data gets synced? Who triggers the sync? Are there any scheduled syncs? What operations I can do now to sync new data?
Describe for me all the gaps we have as for now and why? Which data do we lack, which is synced partially? 



----
Additional asks to do while we wait:

1. Let's have TTLs you selected as a roadmap items (later once we go live) and for now set them differently.
sector-performance	market.performance (sectors)	1 day
country-performance	market.performance (countries)	1 day
instrument-performance	market.performance (35 instruments)	1 day
instrument-profile	market.instruments sector/industry/cap	1 week
instrument-prices	market.prices (~400-day window)	1 day
fund-holdings	security, issuer, identifier, fund_holding	1 month
derive-classifications	security_taxonomy, security.country_iso2	1 month
security-tickers	ticker identifiers, is_tradeable	1 day

2. And let's add to every page button "refresh" that refreshes data fror that page, is it possible? Let's add todo button to restrict this button (and underlying edge functions) only to admin users.

3. Regarding all the gaps you've captured - please make sure they are actionable and tracked in todos.

4. Also please document somewhere all refresh procedures and who runs them and when, how to configure, how to add new funds and what is missing as for now.

5. Additional thing: found on this page: https://muffin.rafiki.guru/group/emerging?scheme=msci&lens=tier
Why i see "Also in this group" at the bottom and don't see these countries? I'm pretty sure that threre are ETF for these countries, at least for Poland. Is it intentionally missed? What else do we miss? Please analyse and document as todos

6. Also on that page I've seen that South Korea had growth 121.9%. When I've clicked on https://muffin.rafiki.guru/country/south-korea - i see that no single sector demonstrated that growth, could you advise how is it possible? Also when I click on any sector (e.g. Information Technologies) - there are no stocks. What do we miss?

7. And one more small ask.
On the main page (with map) I would like also to see growth per tier (in the same way as we have per sector/country). Is it possible?
 

8. I don't see edge functions in Supabase UI

9. One more ask:
"Load more" button for stocks is great, but having infinite scroll might be better. Also I don't see Gained/Lost percentage per stock for some reason

10. When I open stock page I would like skeleton to be rendered. Right now stock page looks empty

11. just curious - right now we have timeouts on edge funcitons - maybe we can extend it for our self-hosted setup? Or it's not a problem?

----
Every external call
Three upstreams. Everything else is internal.

Upstream	Called by	Endpoints	Auth
openbb-api (internal) → finviz, yfinance	performance/profile/price resources	equity/compare/groups, etf/historical, equity/price/historical, equity/profile	keyless providers
SEC EDGAR	fund-holdings	company_tickers_mf.json, data.sec.gov/submissions/CIK…, efts.sec.gov/…search-index, Archives/…/primary_doc.xml	User-Agent only
OpenFIGI	security-tickers	api.openfigi.com/v3/mapping	your key
What syncs, and its TTL
Resource	Writes	TTL
sector-performance	market.performance (sectors)	30 min
country-performance	market.performance (countries)	60 min
instrument-performance	market.performance (35 instruments)	60 min
instrument-profile	market.instruments sector/industry/cap	24 h
instrument-prices	market.prices (~400-day window)	24 h
fund-holdings	security, issuer, identifier, fund_holding	7 days
derive-classifications	security_taxonomy, security.country_iso2	7 days
security-tickers	ticker identifiers, is_tradeable	10 min
Who triggers it
Three ways, and only one is automatic.

Cron — market-warmup.yml, 02:10/08:10/14:10/20:10 UTC. Runs all seven resources with the anon key. Each self-skips inside its TTL, so a pass is cheap.
The app itself. Stale-while-revalidate: a screen reading a row past stale_after fires triggerRefresh in the background. The reader is never blocked.
You, manually. gh workflow run market-warmup.yml -f resource=<name>, or a direct POST with the service-role key for force and fund scoping:

curl -X POST "https://supabase.rafiki.guru/functions/v1/market-refresh" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"resource":"fund-holdings","fund":"XLE","force":true}'
market-verify.yml also runs daily at 03:00 UTC, asserting shape as anon.

To add an ETF: insert a row in market.tracked_fund in Studio (symbol, name, kind, represents_code), then run the scoped refresh above, then derive-classifications, then security-tickers. No deploy — proven with SMH.

The gaps, and why
Partially synced:

Tickers: 4,246 of 9,786. Resolution asks OpenFIGI for the US line; most non-US local listings have none. Needs an exchange→provider-suffix map (security_provider_symbol exists for this, NESN → NESN.SW). Rows without one render by name and are correctly not tappable.
Sector classification: 514 of 9,786. Coverage is exactly what the 11 sector SPDRs hold — US large caps. A security no sector fund holds gets no sector. Grows by adding ETFs.
% change: 35 securities. market.performance still only covers the curated instruments, so most constituents show no number rather than an invented one.
Not synced at all:

Market cap and fundamentals — FMP's free tier gates per symbol (AAPL 200, BHP/SAP/NEE/PLD 402). This is why the sector page ranks by fund weight instead.
Sub-industries — fund holdings carry no industry. taxonomy_node.parent_id models the tree; nothing populates level 2. This is why I removed the chips rather than let authored slugs stand in.
The sector donut — etf/sectors is FMP-premium, index/sectors is TMX-only. fund_sector_weight is now built and renormalising, but nothing reads it yet.
Total return / dividends (everything is price return), corporate actions, index membership, GICS proper (needs a licence).
Structurally impossible: non-US UCITS funds file no N-PORT, so they can never be tracked here.

Timeliness caveat: N-PORT is filed ~60 days in arrears, so holdings can be up to ~4 months old. Fine for reference data — but any UI showing weights must show as_of and never imply they're live.

----

What shipped
before	now
securities	35 hand-authored	9,786
sector constituents	~3 per sector	514 across 11 sectors
tickers	35	4,246
holdings	—	16,424 from 38 funds
The sector page now ranks by the weight the fund actually reports in its SEC filing, rather than a market cap that needs a paid provider.

What the screenshot caught that the type checker didn't
I built it, it typechecked, the smoke test passed — and then the rendered page showed three things wrong:

Tokyo Electron had a chevron promising a stock page that cannot exist. Most non-US listings have no US ticker; those rows are now plain content, not fake affordances.
The chips fell back to software saas — the authored slugs with nothing behind them that this project had already removed once. Fund holdings carry no industry, so the honest render is no chips. Restoring them silently would have been a regression dressed as continuity.
The country filter matched a display name where the server stores ISO-2.
None of those were visible from types or from green checks. Looking at the actual page was what found them.

One limit on my verification
I verified npm run check, expo export, and 64 smoke checks locally, and confirmed in production that sector_constituents returns 514 rows to an anon reader. I have not driven the deployed page itself — that needs the CF Access service-token pair, which I don't have locally. So: the data is confirmed live and readable, and the bundle is confirmed built and deployed, but the deployed page rendering it is unverified by me. Worth a look on your side.

Two open items
The Studio edge-functions error — supabase-studio has no volumes: key while supabase-functions mounts /home/ubuntu/supabase/functions. A one-line read-only mount fixes it; I haven't made the change since I asked first and haven't heard back. It's cosmetic — self-hosted Studio can't deploy functions regardless.

Country page and the Markets donut are the remaining migrations. fund_country_weight and fund_sector_weight are built, renormalising, and verified readable — but nothing reads them yet. That's the natural next step whenever you want it.

----


# Market data — state of play

Updated 2026-08-11. Numbers are measured against production, not estimated.

## Where we are

| | at the start | 2026-08-11 | **2026-08-13** |
|---|---|---|---|
| securities | 35 hand-authored | 10,060 | **27,627** (12,348 equity, 15,159 bond, 44 derivative, 2 cash) |
| tracked funds | — | 66 | **74** |
| holdings | — | 17,474 | **39,886** |
| equities with a sector | ~35 | 6,687 | **10,878 of 12,348 (88%)** |
| equities with an industry | 0 | 345 | **5,673** |
| securities with fundamentals | 0 | — | **6,397** |
| securities with statements | 0 | 12 | **7,039** |
| price bars | 0 | ~331,441 | **1,252,553** |
| exchange directory | none | 2,422 listings / 4 venues | **59,324 listings / 54 venues** |
| symbol backlog | — | — | **0** (was 8,532 this morning) |

**Securities are now TYPED from the filing's `assetCat`** (2026-08-13). Every non-share holding used
to be `other` — 15,205 of them — so a futures contract and a sovereign bond were the same kind of
thing. `other` is now 0.

## 2026-08-13 — what changed, and the one thing that went wrong

**Twenty PRs.** The universe work is done; most of the day went on a defect I caused and the guards
that now make it impossible.

| backlog | morning | evening |
|---|---|---|
| yahoo_symbol | 8,532 | **0** |
| profile | 2,437 | **0** |
| industry | 7,593 | **0** |
| fundamentals | 5,250 | ~2,960 |
| prices | 6,268 | ~4,958 |
| statements | 8,791 | ~8,715 |

**The defect worth knowing about.** Draining six resources back to back tripped yfinance's rate
limit. A throttled yfinance answers **200 with no rows** rather than erroring — and every outage
rule in the pipeline was a *throw* check, so all of them stayed quiet while six marking sites
recorded **~8,300 securities as permanently unanswerable**: INTC, PEP, XOM, TXN, EA, SCCO, EQH,
REGN, UPS among them. Nothing errored. `pending_industry` went to 0 and read as *drained*.

A backlog that empties by MARKING looks exactly like one that empties by WORKING. All six sites now
gate on the endpoint having answered for someone in the run; `market-verify` has a mega-cap canary
that cannot be decorative (it read 109 of 213 when the incident was live); the warm-up cron is paced;
and the marks were cleared.

**Three of my own fixes were wrong first, and measurement caught each:**

- a rule that would have re-caused the same incident — disproved by re-running once throttling stopped
- a source guard that reported "all six sites gated" while three were not (brace-matching counts
  braces in comments; and the first mutation run used mis-escaped `sed`, so four passes were four
  no-ops)
- a production tripwire that passed on the exact data it was written to catch (the incident was a
  30-minute window inside a day that classified 2,020)

**Also fixed:** the Markets donut was timing out for anon in the deployed app (7s view, 3s anon
limit) and now answers in 0.46s with real filed weights; search returned bond lines above every real
bank; a frozen price series was reported as a flat market; 28 securities were named
`New Issuer: BB Company ID:<n>` and OpenFIGI names them in a response we already make; migrations
now apply atomically, so a deploy no longer breaks every reader mid-flight.

**One assumption failed and reported itself.** I batched the statements fetch on the reasoning that
`equity/fundamental/metrics` batches. Those endpoints do not — `symbolsAsked 50, symbolsAnswered 0`
on the first run, with nothing written and nothing wrongly marked. Reverted. Statements instead got
an on-demand path so the securities someone opens are not last in a five-week queue.

**What is genuinely left** is drain time on two provider-rate-bound backlogs, and the things that
need money or a licence: GICS, total return, index membership. Commodity and UIT funds are
structurally unreachable — they file no N-PORT.

## Your original asks — status

| # | Ask | State |
|---|---|---|
| 1 | Classifications + countries per classification from the API | **Done** |
| 2 | Countries in each group, real growth, changeable timeframe | **Done** |
| 3 | Sector performance from the API | **Done** |
| 4 | Companies in a sector with real numbers, sub-sectors, classifications | **Mostly** — numbers and classifications yes; **sub-sectors no** (see below) |
| 5 | Things you missed | Ongoing — the list below |

## The follow-up list (notes items 1–11)

| # | Item | State |
|---|---|---|
| 1 | TTLs as pre-launch values, production values as roadmap | Done — see `muffin-deployment/README.md` |
| 2 | Refresh button per page + admin restriction | Done — admin-only via `app_metadata.role` |
| 3 | Gaps actionable in todos | Done — `todos.md` |
| 4 | Document refresh procedures | Done — README "The refresh model" |
| 5 | "Also in this group" countries missing | Done — 19 → 46 countries |
| 6 | Korea +121.9% with no matching sector; empty sector pages | Done — the number was real; the *sectors* beside it were US-only and are now labelled, and non-US securities now have sectors |
| 7 | Growth per tier on the map page | Done |
| 8 | Edge functions missing in Supabase Studio | **Done** — Studio had no volume mount at all |
| 9 | Infinite scroll + missing per-stock % | Done |
| 10 | Stock page skeleton | **Done today** — it rendered a bare symbol over blank space |
| 11 | Extend edge-function timeouts | Done — 60s/150MB → **90s/256MB**; they were ours, not the platform's |

## Done since this file was last written (2026-08-11)

- **Sub-industries** — taxonomy level 2, 91 real industries; the sector page's chips are back with
  data behind them. This was the last unfulfilled part of the original brief.
- **Per-country sector returns** — a country page shows its OWN sectors, not finviz's US ones.
  Korea: Information Technology +309% carrying 61% of the fund, which is what makes its +121.9%
  country return legible.
- **Company search** — 10,060 securities were reachable only by drilling Globe → country → sector.
- **The exchange directory is readable** — `untracked_listing` plus a `promote-listing` resource
  that pulls a listed company into the universe; the existing backlogs then classify and price it
  with no new code.
- **Weights say which fund they belong to.** "61% of fund" never named the fund, so the number was
  unattributable.
- **Taiwan recovered** — 534 securities silently dropped because OpenFIGI returns `exchCode` bare
  for some venues and labelled for others.
- **Studio's Functions page** and the **stock-page skeleton** — the two items missed from the list.

## Statements (2026-08-11)

Pulled. Income, balance and cash from keyless yfinance, **one jsonb per period** rather than a
column per line item — AAPL and Samsung differ by 19 income and 19 balance fields, so a relational
shape would be the union of every line item any filer reports, or a migration each time a provider
adds one. First run wrote 120 rows across 12 securities, 52 line items apiece.

Fetched **one security at a time**, unlike the other backlogs: each endpoint returns a row per
*period*, so a multi-symbol response interleaves periods from different companies with only a
`symbol` to separate them.

The accepted cost, so it is not a surprise later: cross-security aggregation means
`data->>'total_revenue'` with no type safety. Right trade while the app's job is to *show* a
statement rather than compute over 50 line items across 10,000 companies.

## What is left for a *complete* universe

Measured 2026-08-13, not estimated.

**1. The backlogs, which are provider-limited rather than code-limited.**

| backlog | outstanding | moving? |
|---|---|---|
| statements | 8,851 | throttle-bound |
| prices | 6,165 | slowly |
| fundamentals | 5,250 | throttle-bound |
| industry | 1,722 | yes |
| profile | 205 | nearly done |
| yahoo_symbol | 23 | nearly done |

yfinance rate-limits us, and it signals that by answering **200 with no rows** rather than erroring
— which is what let one afternoon's over-eager drain record ~8,300 securities as permanently
unanswerable before the gates landed. Fundamentals and statements drain over days via the paced
cron, not in a session.

**2. Market cap and fundamentals are NOT blocked** — the note above this one saying FMP gates per
symbol is still true but no longer relevant, and there is now a second reason: **openbb's fmp
provider calls the v3 API, which returns `403 Legacy Endpoint` for everyone without a pre-August-2025
subscription — AAPL included.** Keyless yfinance serves `equity/fundamental/metrics`, and 6,397
securities already have fundamentals from it.

**3. Total return, corporate actions, index membership, GICS proper.** Still need a paid or licensed
source. Everything today is *price* return.

**4. Non-US UCITS funds remain structurally impossible** — they file no N-PORT. **Commodity funds
too**: SLV is a trust, USO and DBC are pools filing 10-K. Neither is a backlog item.

## What is left for a *fully functional* UI

Everything from the original brief now has data behind it. What remains is gated on money, not
engineering:

- ~~Deep fundamentals~~ **SOLVED, and my earlier conclusion was wrong.** I probed the providers we
  hold KEYS for and reported none could serve this universe. Each finding was true — FMP gates per
  symbol (402 on BHP/SAP/NEE), Tiingo free is "limited to the DOW 30", Alpha Vantage is US-only at
  25 calls/day — and all of it beside the point: **keyless yfinance** serves
  `equity/fundamental/metrics`, including the non-US local listings (`005930.KS`, `7203.T`,
  `KGH.WA`) that Alpha Vantage returns empty for. 30-35 fields, no key, no cap.

  The mistake: I searched among the things I had keys for rather than among the things that could
  answer. Twice in two days the answer was in a response we were already fetching — market cap was
  the first.
- **A "track this" action** for an untracked listing — `promote-listing` exists and is admin-only;
  no button calls it yet.
- **Dividends / total return** — every number shown is a price return.

## How to operate it

Full runbook — triggers, credentials, the resource table, adding an ETF, making yourself an admin —
is in **`muffin-deployment/README.md`**. The short version:

- **Automatic**: `market-warmup.yml` cron at 02:10/08:10/14:10/20:10 UTC, service-role key.
  `market-verify.yml` asserts shape daily at 03:00.
- **Manual**: `gh workflow run market-warmup.yml -f resource=<name>`, or POST with the service-role
  key and `"force": true` to bypass the TTL.
- **Add an ETF**: a row in `market.tracked_fund`, then `fund-holdings` (scoped) →
  `derive-classifications` → `security-local-symbols` → `security-tickers`. No deploy.
- **Become admin** (needed for the in-app refresh button):
  ```sql
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || '{"role":"admin"}'::jsonb
   where email = 'you@example.com';
  ```
  Then sign out and back in — the claim is baked into the token when it is issued.

## The lesson from the Taiwan bug (2026-08-11)

The exchange table in `exchanges.ts` was written from memory of Bloomberg codes and spot-checked
against four securities. The codes were right — but **all four happened to return OpenFIGI's bare
`exchCode`**, so I never saw that it also returns a labelled form (`TT (Taiwan Stock Exchange)`).
The exact match resolved Korea and silently dropped **Taiwan: 534 securities, no symbol, no
sector, no price, no error**.

What actually found it was measuring per-country symbol counts in production, not re-reading the
code. Three durable changes came out of it:

- `exchCode` is normalised before comparison.
- `market-verify` asserts no country has securities and zero provider symbols — the signature of
  this bug class, and nothing else looks like it.
- **A negative cache can memorise your own bug.** Taiwan's 534 were marked
  `local_symbol_missing_at` by the broken match, so fixing the code changed nothing until that
  cache was cleared. Any resolution fix must invalidate what the old behaviour poisoned.

Rule going forward: prefer a published source (OpenFIGI publishes its `exchCode` enum and
enumerates venues; the World Bank lens gives geography; SEC gives holdings), or derive from data
already in the schema — then measure the result in production and encode the measurement as a
guard.

## Things that cost real debugging (don't rediscover them)

- **A backlog view defined as "wants X and lacks X" re-asks forever** for things that can never
  have X, and they crowd out the ones that would resolve. Four columns exist for this
  (`figi_`, `profile_`, `local_symbol_`, `performance_missing_at`) because it was found four times.
- **A 204 is "no data", not a failure.** Treating it as an error discarded 22 of 24 batches.
- **A per-call timeout must be bounded by the REMAINING budget.** A deadline that only gates
  whether to *start* a call lets one begin at 34.9s of a 35s budget and run 20s past it — which is
  a killed worker and a bare 502, not a catchable error.
- **`create or replace view` only appends columns** — it cannot rename, reorder or drop. Two deploys
  died on this. CI now applies every migration twice against a throwaway Postgres.
- **Weights do not sum to 100** (EWT's own filing sums to 110.38). Anything drawing a donut must
  renormalise.
- **N-PORT lags ~60 days**, so holdings can be ~4 months old. Always show `as_of`.
- **`PGRST_DB_MAX_ROWS` is 1000, and a `limit` above it is not an error — just a shorter answer.**
  It has cost two round-trips: once in the ticker backlog, and once *inside the duplicate guard*,
  which compared a true count against a truncated page and failed a green pipeline over nothing.
- **CI now parses the Swarm stack template.** A one-line volume mount inserted mid-`environment:`
  orphaned two keys and failed a deploy; nothing had ever looked at that file.
