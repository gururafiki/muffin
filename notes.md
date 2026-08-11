# Market data — state of play

Updated 2026-08-11. Numbers are measured against production, not estimated.

## Where we are

| | at the start | now |
|---|---|---|
| securities | 35 hand-authored | **10,060** |
| holdings | — | **17,474** from 66 tracked funds |
| securities with a sector | ~35 | **6,687** |
| per-security return rows | 405 | **13,431** |
| symbols the price provider accepts | 35 | **7,996** (+4,268 display tickers) |
| countries offered in the app | 19 | **46** |
| tier (developed/emerging/frontier) growth | none | live, 153 rows |
| exchange directory | none | 2,422 listings, 4 of 38 venues |

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
| 8 | Edge functions missing in Supabase Studio | **Done today** — Studio had no volume mount at all |
| 9 | Infinite scroll + missing per-stock % | Done |
| 10 | Stock page skeleton | **Done today** — it rendered a bare symbol over blank space |
| 11 | Extend edge-function timeouts | Done — 60s/150MB → **90s/256MB**; they were ours, not the platform's |

## What is left for a *complete* universe

**1. Finish the exchange directory — 4 of 38 venues.**
One venue per run at ~15 min intervals; the remaining 34 are roughly a day of scheduled
warm-ups, or an afternoon if driven manually. This is what turns the universe from "what the
tracked funds hold" into "every listed company on the venues we can price".

**2. Sector coverage: 6,687 of 10,060.** The rest are securities yfinance has no profile for.
Grows as the directory fills and as more funds are tracked.

**3. Per-country sector returns.** A country page still shows *US* sector performance — now
honestly labelled, but it is the last mislabelled data on screen. Now finally buildable: Japan has
1,039 classified securities, Korea 248.

**4. Sub-industries.** `taxonomy_node.parent_id` models sector → industry group → industry →
sub-industry; only level 1 is populated. This is why the sector page shows no sub-sector chips —
the authored slugs (`software-saas`) had nothing behind them. yfinance's `industry_category` could
populate level 2 from the profile calls we already make.

**5. Market cap and fundamentals.** Blocked, not deferred: FMP's free tier gates **per symbol**
(AAPL 200, BHP/SAP/NEE/PLD 402). This is why the sector page ranks by fund weight — a fact from a
filing rather than an estimate.

**6. Total return, corporate actions, index membership, GICS proper.** All need a paid or licensed
source. Everything today is *price* return, which understates high-yield markets.

**7. Non-US UCITS funds are structurally impossible** — they file no N-PORT. Coverage of *funds*
grows only by adding US-registered ones.

## What is left for a *fully functional* UI

- **Country page**: replace the US sector panel with per-country sector returns (needs #3 above).
- **Sub-sector chips**: return once level 2 exists (#4).
- **Ticker search**: the exchange directory makes a real symbol search possible; nothing uses it yet.
- **Stock pages for non-US names**: they resolve and price now, but market cap and fundamentals stay
  blank until #5.

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
