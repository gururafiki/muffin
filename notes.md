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
and when we refresh data - do we keep existing one and just pull new incrementally or is already fetched data also refreshed (preferred if we pull only new)? when market event like stock split happens - do we recompute historical prices we have stored? Also do we refresh stock prices every day? 
Another thing I've noticed - when I open some countries it still shows US Sectors, it's weird. Example for this is Vietnam. Let's state clearly that there are no data for this country if such case occurs. And in the same time let's verify and make sure we have all the data pulled for all the countries.

Another issue I've noticed is that when I open South Korea - it show great growth of Information Technology, but when I click on it there are no gained/lost label near stocks. Why is it happening, do we lack some data?
----

couple more asks:
1. Can we add to stock page also country (with option to click on it) (if not added yet) and funds in which this ticker/stock is included .(with option to click on them to open full list of stocks within fund).
2. Can we add search to pages where lists are shown (list of countries, sectors, stocks within sector.
3. Wanted to confirm - how does it work if company belongs to one country, but stock is listed in US? E.g. Where will i find Alibaba?
---
### Not all stocks from each exchange are synced

Direct answer to your question: no, not from a single query per exchange — and I can now say exactly why.


US Common Stock       total 20,107     we hold 15,000  (stopped exactly there)
US Depositary Receipt total  2,700     we hold      0
OpenFIGI's /v3/filter reports the true total but stops paging at 15,000, so ~5,100 US common stocks are unreachable by enumerating the venue alone. #120 adds the 2,700 ADRs (which is where BABA lives), but it doesn't lift that ceiling.

Partitioning is the way past it, and I tested the candidates rather than guessing:

micCode — not usable. XNYS reports 37,787 (more than exchCode US) and XNAS reports 0, so it's a different taxonomy, not a subdivision.
query prefix — works. query=A gives 1,410, query=B gives 247, both far under the cap.
So a venue over 15,000 can be swept as 26 letter-partitions, each comfortably inside the ceiling. That's a real change to the sweep and I'll do it next.

And there's a shortcut for the specific case you raised. BABA doesn't need the sweep at all — /v3/mapping resolves it directly:


BABA | ALIBABA GROUP HOLDING-SP ADR | figi BBG006G2JVL2 | Depositary Receipt
The promote-listing resource only needs a FIGI. So a named ticker can be pulled into the universe on demand, without waiting for its exchange to be enumerated — which is the right answer for "this major company should be here" regardless of what the funds hold.

I'll build both: the letter-partitioned sweep for completeness, and a promote-by-ticker path for named companies.


---
Every external call — rebuilt from what is deployed, 2026-08-13
(The version this replaces described 3 upstreams and 7 resources; there are now 4 and 17.)

| Upstream | Called by | Auth |
|---|---|---|
| **openbb-api** (internal) → finviz, yfinance | every performance / profile / price / fundamentals / statements resource | keyless providers |
| **SEC EDGAR** | `fund-holdings` | descriptive User-Agent only; ~10 req/s fair-access limit |
| **OpenFIGI** | `security-tickers`, `security-local-symbols`, `exchange-listings` | your key — 250 req/min x 100 ids (anonymous is 25 x 10) |
| **Yahoo search** (`query2.finance.yahoo.com`) | `security-yahoo-symbols` | keyless; resolves an ISIN to its HOME-market symbol |

**FMP, Alpha Vantage, Tiingo, FRED and Biztoc keys are all set and none is used by this pipeline.**
FMP cannot be: openbb's fmp provider calls the **v3** API, which now answers `403 Legacy Endpoint`
for anyone without a pre-August-2025 subscription — AAPL included.

## What syncs, and its real TTL

| Resource | TTL | Why that number |
|---|---|---|
| `sector-` / `country-` / `group-` / `instrument-performance` | 24 h | daily returns |
| `instrument-prices` | 24 h | the curated ~400-day window |
| `security-prices` | 24 h | daily bars, fetched incrementally from the last stored date |
| `security-tickers` | 24 h | OpenFIGI, and the backlog now drains in one keyed pass |
| `instrument-profile` | 7 days | curated overlay |
| `fund-holdings`, `derive-classifications` | **30 days** | N-PORT is quarterly; a short TTL would re-ask SEC for last quarter's answer |
| `security-profiles`, `-industries`, `-fundamentals`, `-statements`, `-performance`, `-local-symbols`, `-yahoo-symbols`, `security-refresh`, `promote-listing`, `exchange-listings` | **10 min** | INCREMENTAL — each run drains a slice, so the TTL only has to permit the *next* run. A completion-shaped TTL stalls a backlog for a week. |

## Who triggers it

- **Cron** — `market-warmup.yml`, now **eight times a day** (02:10, 05:10, 08:10, 11:10, 14:10,
  17:10, 20:10, 23:10 UTC), service-role key, **paced 30 s between resources**. The pacing is not
  cosmetic: firing all seventeen back to back is what tripped yfinance's rate limit and let ~8,300
  securities be recorded as unanswerable.
- **`market-verify.yml`** — daily at 03:00 UTC, 39 assertions, as anon.
- **The app** — stale-while-revalidate; a screen reading a row past `stale_after` fires
  `triggerRefresh` in the background. The reader is never blocked. Writes are **admin-only**
  (`app_metadata.role`), so the button is hidden for everyone else.
- **A stock page** — `security-refresh` does returns, market cap, fundamentals **and statements**
  for one symbol, on demand. That last one matters: the statements backlog is ~5 weeks deep, so
  without it the securities someone actually opens would be last in the queue.
- **You** — `gh workflow run market-warmup.yml -f resource=<name>`, or a direct POST with the
  service-role key for `force` and fund scoping:

```
curl -X POST "https://supabase.rafiki.guru/functions/v1/market-refresh" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"resource":"fund-holdings","fund":"XLE","force":true}'
```

`force` bypasses the TTL and the error backoff but **not** the in-flight lock, and is service-role
only — the anon key is public, and a public cache-buster is a free way to hammer the provider.

**To add an ETF:** a row in `market.tracked_fund` in Studio, then the scoped `fund-holdings` refresh,
then `derive-classifications`. No deploy. Everything downstream — symbols, sectors, industries,
prices, fundamentals — picks it up from the backlogs on its own.

## The gaps, measured 2026-08-13

Of **12,348 equities** (the universe is 27,627 securities; the rest are bonds, derivatives and cash,
correctly typed and correctly excluded from every equity view):

| | coverage |
|---|---|
| fundamentals | **92%** (3% negative-cached as genuinely unavailable) |
| sector | **89%** |
| market cap | 66% |
| industry | 61% |
| statements | **12.5%** — see the caveat above; a row count reads ~12x this |

Still draining: prices, statements, performance. Nothing is code-blocked.

**Blocked on money or a licence:** GICS proper, total return / dividends (everything today is a
*price* return), index membership, per-symbol fundamentals beyond what keyless yfinance gives.

**Structurally impossible, not deferred:** non-US UCITS funds file no N-PORT; commodity funds are
trusts or pools filing 10-K (SLV, USO, DBC); MDY is a unit investment trust. None of these can be
reached by adding a row to `tracked_fund`.

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
| securities with statements | 0 | 12 | **~1,544 (12.5%)** |
| price bars | 0 | ~331,441 | **1,252,553** |
| exchange directory | none | 2,422 listings / 4 venues | **59,324 listings / 54 venues** |
| symbol backlog | — | — | **0** (was 8,532 this morning) |

**Careful with the statements figure.** `security_statement_current` returns one row per
(security, statement, period) — about twelve per security — so a row count reads as roughly 12x the
coverage. 12,928 rows is ~1,544 securities, not 12,928. I quoted the row count as coverage several
times on 2026-08-13 before catching it; the honest number comes from the backlog arithmetic:
12,348 equities − 8,355 pending − 2,449 negative-cached.

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


---

# HANDOVER — 2026-08-14 (afternoon): what the failing verify check turned out to mean

`market-verify` was RED when this session picked up, with one assertion failing:

> 12 returns are exactly 0.00% over 3m/6m/1y — a delisted instrument is being priced off its final bars

The symptom was real. **Both halves of the diagnosis were wrong**, and pulling on it found two
separate populations of falsely negative-cached securities that no count in the system could see.

## The flat returns were arithmetic, not a defect

The flagged names were live companies — Austrian Post, SpareBank 1 SMN, Bank Rakyat Indonesia.
Most quotes sit on a coarse tick grid (Tokyo and Shenzhen in whole units, Seoul in won), so a price
returning to **exactly** its anchor is ordinary: 10 of 18 were a provable exact round-trip, the
identical close sitting in the anchor neighbourhood. "A real 0.00% is vanishingly unlikely" was
written when the universe was 35 curated instruments and is false across 12,348 equities.

The check now keys on the discriminator: **a symbol flat on 3+ FRESH periods**. A frozen series is
flat on every window at once (Egypt, Nigeria and Portugal were flat on all nine); coincidence
cannot land on three. Measured: 36 symbols had one fresh zero, 2 had two, none had three.

## Two false-mark populations, same root cause

**`performance_missing_at` — 2,548 of 3,045 marks were false.** Settled by contradiction:
`security-prices` and `security-performance` call the SAME endpoint, and those securities had daily
bars from the last five days. MediaTek, Tapestry, Ferguson, Royalty Pharma, Edenred, ACS.
`security-refresh` against TPR and 2454.TW returned all seven periods, a market cap, fundamentals
and statements. Cause: marking gated on `fetched.length > 0` — a TALLY. yfinance throttles
**progressively**, omitting symbols from a 200 rather than erroring, so nothing throws and
`fetchWithIsolation` (which only engages on a throw) never runs. 2,297 marks in one pass on 08-11.

**`statements_missing_at` — ~2,445 marks from three bursts.** No contradiction is available here (a
security with no statements has none), so the RATE settles it: 518 + 725 + 1,032 marks in three
single hours against a ~15/hour steady state. ISRG, EXC and MLM each returned 12 rows of statements
when re-driven today.

**The part that made both invisible, and the thing most worth carrying forward:** a mark does not
just stop new data, it **freezes the old data**. Exclusion from the backlog means the refresh never
revisits the security, and the retraction that deletes periods a run stops producing only runs for
symbols a run ANSWERS. So REA.AX, 1803.T and MRP.JO were still serving `1d/1w/1m = 0.00%` written on
08-10, four days after their prices resumed moving daily. **The guard that stopped PRODUCING those
numbers could never REMOVE them.**

## The canary that was supposed to catch this, and why it did not

`market-verify`'s mega-cap check read `statements_missing_at = 0 of 213` on the same morning 85 of
the 221 securities that are a ≥1.5% sector-fund holding were marked. Its filter is
`country_iso2 = 'US' and market_cap > 50e9`, which has three blind spots that this incident walked
through completely:

- **no market cap at all** — ISRG had none, and 34% of the universe still does not
- **below $50bn** — EXC $46bn, MLM $33bn, ESS $19bn
- **not American** — Chubb is Swiss

It is US-only because `market_cap` is denominated in each security's own currency, and that
constraint is real. **Fund weight has neither problem** — a percentage is free of currency, cap and
country. `.github/scripts/check_significant_holdings.py` now checks by weight. Keep both: they fail
on different things.

## Shipped for it

| PR | What |
|---|---|
| deployment#122 | performance marking requires per-symbol evidence + retracts; migration 55 repair; flat-return check rewritten; contradicted-mark check added |
| deployment#123 | `provider_country_iso2` — the operating country, so Alibaba is under China not Cayman |
| deployment#124 | migration 57 statements repair; weight-based canary |
| deployment#125 | market cap promoted out of `security_fundamentals.raw` — 66% → **92.8%** |
| deployment#126 | the backlog widened so #123's column is actually filled |
| deployment#127 | six jurisdictions the unresolved-name report named |

## Verified in production, end to end

| | before | after |
|---|---|---|
| market cap coverage | 8,163 (66.1%) | **11,454 (92.8%)** |
| `performance_missing_at` | 3,045 | **500** |
| `statements_missing_at` | 2,618 | **189** |
| contradicted performance marks | 2,548 | **0** |

`one_shot` records all four repairs: 2,548 performance marks cleared, 2,445 statement marks
cleared, 3,290 market caps promoted, and the country marks cleared after the six jurisdictions
landed.

**Alibaba, the case this started from:** `filed=KY, provider=CN → shows CN (China)`. Alibaba Health
`filed=BM, provider=HK → shows HK`.

**The backlogs drain by WORKING, not by marking** — which is the distinction the whole day was
about. One `security-statements` run after the repair: `written: 408, failed: 0, symbolsAnswered
34/60`. One `security-profiles` run: `homed: 276, noCountryMarked: 31, remaining: 2`.

**And the decisive proof, measured a few hours later.** The 2,546 securities that re-entered
`pending_performance` when migration 55 cleared their marks had drained to **3**, while
`performance_missing_at` rose only 497 → 517. Symbols carrying performance went **9,268 → 11,499**.
So ~2,231 of the cleared securities got real data and ~20 were honestly re-marked: they drained by
FETCHING, not by being recorded unanswerable a second time. That is what makes the 2,548 marks
demonstrably false rather than a judgement call — and it is the comparison to run whenever a
negative cache is cleared, because a backlog that empties by marking looks identical to one that
empties by working.

**What the unresolved-name report bought:** it named Macau, Monaco, Guernsey, Jersey, Isle of Man
and Gibraltar on its first run — six jurisdictions missing from `market.countries` entirely, which
a guessed alias table would never have found. That is the argument for reporting what you could not
resolve rather than pre-filling a mapping from memory. After #127 the report comes back **empty**:
every provider country name now resolves, and Sands China sits under Macau, B&M European Value
Retail under Jersey, Sirius Real Estate under Guernsey, Scorpio Tankers under Monaco.

**Final country position: 291 securities carry an operating country, 169 of them relocated off an
offshore filing (KY/BM/VG/MH), and 12,333 of 12,348 equities (99.9%) now have a country.** The 16
still marked are securities whose profile carries no country at all — correctly cached, not stuck.

## The universe: what the sweep turned out to be doing

Picked up after the above, on the ask to capture the whole stock market.

**`exchange-listings` was never on the cron.** It is the ONLY resource that grows the universe
beyond what the tracked funds happen to hold, and it was written, deployed, reachable and absent
from the schedule — so it ran when a human remembered. Last run 08-11, three days earlier, with
**16 venues never enumerated at all**: Australia, Japan, China, Indonesia, Sweden, Greece, Peru.
Nothing reported it, because **a resource that is never invoked cannot fail** — every backlog it
feeds was drained and every count was plausible. Same shape as the inert column in migration 56:
the failure is an ABSENCE, and absences do not raise.

The existing guard asked "does everything the cron calls exist?", which cannot see a resource that
exists and is never called. The new one asks the other direction. It immediately found a second
defect — in the cron PARSER: the last entry of the list ends with `)` rather than `\`, so the regex
had been silently dropping `derive-classifications`, which the original check had therefore never
verified. 17 names became 18.

**Then driving the sweep by hand found two more, both live:**

- **A 429 broke out of `listExchange` silently.** The resource returned `written: 0, pages: 0,
  complete: false` with `ok: true` — byte-identical to a venue with nothing left to add. A refusal
  read as completion. Now reported as `throttled`, and `complete` excludes it.
- **`listings: written` was written unconditionally**, so that refused run overwrote Japan's
  recorded 1,800 with 0. The rows were never touched — `exchange_listing` still held all 1,800 —
  which is exactly why it went unnoticed: every listing was present and only the number above them
  was wrong.

**`untracked_listing` called 9,976 tracked companies untracked.** It excluded a listing only when a
`security_identifier` of kind `figi` matched — and **547 of 27,628 securities have one**. So it
answered "listings whose composite FIGI we have not happened to store", which reads exactly like
"listings we do not track". Samsung Electronics is tracked as `005930.KS` with ticker `SSNLF` and
both its directory rows sat in the untracked view. **An unread view cannot be wrong in a way anyone
notices** — nothing had read it since migration 25, and it surfaced only because search was
extended to use it.

**Search now reaches the directory** (muffin-ui#84). 63,411 listings were catalogued and invisible
to the one feature whose job is finding a company. Directory hits are labelled and inert — there is
no stock page for a security with no price series. Deduped by NAME after measuring that both
plausible identifiers are wrong: `country_iso2` is the VENUE's country (so a "local line" test on it
is true for every row while reading as logic — my first version did exactly that), and
`composite_figi` is per country of listing, not per company.

**Four drillable countries had NO VENUE in the sweep at all** — and three already held securities
whose symbols could therefore never resolve: Kuwait 40, Qatar 35, Vietnam 57, every one of them
symbol-less. The catalog covers 42 countries and the app offers a page for 45; nothing compared the
two. Argentina is the case no per-security check can see — a page with nothing behind it looks the
same as an empty market. Added VN/VM/KK/QD/AR (deployment#130), every code and suffix derived from
a published source: **exchCode from OpenFIGI `/v3/mapping` on an ISIN we already hold, suffix from
Yahoo search on the ticker it returns.** The two differ and that is the trap — Doha is `QD` to
OpenFIGI and `.QA` to Yahoo, Kuwait `KK`/`.KW`, Buenos Aires `AR`/`.BA`. A wrong suffix does not
error; it produces a symbol the provider answers nothing for, which then gets negative-cached.

**The five venues WORKED, and the follow-up I wrote for them did not.** After deployment#130,
Kuwait went 0 → 37 of 39 symbols, Qatar 0 → 33 of 35, Vietnam 0 → 56 of 57, and the sweep returned
exactly the totals `/v3/filter` had predicted. I then saw `security-local-symbols` answer
`remaining: 0` with 57 of 57 Vietnamese equities carrying `figi_missing_at`, concluded the negative
cache was blocking resolution (the Taiwan pattern), and shipped a clear for it. **Wrong.** The cron
resolved them twenty minutes later with the marks STILL SET — 38, 33, 57, unchanged. Marks unchanged
plus symbols resolved is only possible if the marks were never the blocker: `figi_missing_at` gates
the FIGI lookup, and `pending_local_symbol` — which is what actually assigns `SHIP.KW` — never
consults it. I read a five-minute timing gap as a permanent exclusion. Corrected in deployment#134;
the statement stays as a harmless one-off and explicitly not as a template.

**And do not read a high `figi_missing_at` rate as a defect.** It records that OpenFIGI has no US
line for an ISIN, which is simply true for most local listings: CN 96%, IN 99%, TW 96%, KR 97% of
equities carry it and nearly all still have a working symbol. That is the expected shape of an
emerging market. I nearly treated it as a second systemic bug.

**`security-prices` verified after the isolation fix:** backlog **393 → 46**, `prices_missing_at`
359 → 659 (+300 confirmed unanswerable one at a time), and **32,233 bars written** — recovered from
batches that had been hiding answerable securities behind one bad member. That resource had written
zero, run after run, for days.

**Directory growth this session: 59,324 → 95,926 listings (+62%)**, venues never enumerated 16 → 2
(only Colombia and Peru left, and the cron now reaches them). `untracked_listing` fell to 81,007
once it stopped counting 14,784 tracked companies as untracked.

**And a fifth defect, found by reading a resource's own counters:** `security-prices` reported
`written: 0, emptySeries: 300, batchesFailed: 0, remaining: 393` — identical run after run. The
`written > 0` gate added that morning to stop a throttled provider marking a whole page is correct
and, once every security left is one the provider does not carry, **can never fire**. Confirmed
rather than assumed: `security-refresh` at `ICT.PS` and `FAB.AE` returns `returns: 0, "not covered"`
— the Philippines and the UAE are outside keyless yfinance. Nothing was wrongly marked and no data
was wrong; the same 300 symbols were simply re-asked eight times a day for ever. Fixed by per-symbol
isolation (deployment#131), which **keeps what it recovers** — a batch is often empty because ONE
member is bad, and discarding the others' bars would make the fix a slower version of the bug.

**promote-by-ticker is verified working** — the last mechanical item from the morning handover.
`{"resource":"promote-listing","symbol":"BABA","exchange":"US"}` returns `promoted: true`, and
`security-refresh` then gave BABA $297bn market cap, 7 return periods, fundamentals and 12 statement
rows.

**`security-statements` marking is CORRECT as written, and the note below saying otherwise was
wrong.** `STMT_BATCH = 1` — statements are fetched one symbol at a time, so an empty 200 IS
per-symbol evidence. That is structurally different from `security-performance`, which batched 40
and therefore had no evidence about an omitted symbol. Nothing to fix.

## Still open

- `industry_missing_at` (3,479) and `fundamentals_missing_at` (492) were checked for the same
  defect and are **clean** — 1 and 0 contradictions respectively, and 1 of 221 significant holdings.
  Those marks look earned.
- ~~`security-statements` still marks on an empty per-security answer.~~ **CHECKED AND WITHDRAWN.**
  `STMT_BATCH = 1`, so an empty 200 is per-symbol evidence and the rule is right as written — the
  reason `security-performance` needed rewriting is that it batched 40 and had no evidence about an
  omitted symbol. Recorded here rather than deleted because "rewrite it like the other one" was a
  plausible-sounding next step that would have been wasted work.
- Splits detected, prices never adjusted (now in `todos.md`).

**Deployed and verified for #122:** `one_shot` records `Cleared 2548`; `performance_missing_at`
3,045 → **497** (exactly the 497 that had no recent bars — the numbers reconcile); the contradicted
count 2,548 → **0**; `pending_performance` 0 → **2,546**, i.e. those securities are back in the
refresh cycle rather than excluded for 30 days.

## Two of my own changes were wrong first, and measurement caught both

- **#123 shipped an INERT column.** `provider_country_iso2` was written correctly by the resource,
  and production sat at 0 rows populated: `security-profiles` is driven by `pending_profile`, which
  asks for securities with no SECTOR, and that backlog was drained — so the resource answered
  "every security has a sector" and fetched nothing. Nothing could report it; the resource was
  *succeeding*. #126 widens the backlog, scoped to the 384 securities no country page can show
  rather than all 11,395 (re-queueing everything would have spent eighteen runs of the rate limit
  to change nothing, and starved statements).
- **A verify guard measured a page instead of counting.** It asked for `limit=5000` and silently got
  1,000 — `PGRST_DB_MAX_ROWS` — so it would have reported "1000" for ever however bad things got.

## And a fourth instance of the oldest lesson here

`security.market_cap` was at 8,163 of 12,348 (66%) because `equity/profile` carries no cap for most
non-US listings. **2,871 of the 2,952 missing caps were already in `security_fundamentals.raw`** —
fetched, stored in jsonb, never promoted to the column the app reads. COSCO Shipping, HEXPOL, Emmi,
Trina Solar. Coverage → ~89% with no new upstream call. That is four: market cap and the operating
country both ride on `equity/profile`; the currency and *this* market cap both ride on
`equity/fundamental/metrics`. **Check what a response CONTAINS before concluding a field needs a
provider or a paid key.**

Every guard proven by mutation, each failing independently: reverting the evidence rule, deleting
the retraction, widening migration 55's window, removing migration 57's cutoff, and the realistic
one-shot drift (guard removed **and** ledger insert made conflict-tolerant — the crude version is
caught by the ledger's own primary key, so it proves nothing).

## Two traps that cost time today

- **The contradicted-mark guard first asked for `limit=5000` and silently got 1000**
  (`PGRST_DB_MAX_ROWS`). It would have reported "1000" for ever however bad things got — as a
  measurement. Count with `Prefer: count=exact` + `Range: 0-0`; it works through an `!inner` embed.
- **`urllib`'s default User-Agent gets a 403 from Cloudflare** on `supabase.<domain>` — reads like
  an auth failure, is not. curl works.

## Still open from this thread

- **Splits are detected but stored prices are never adjusted.** Now written down properly in
  `todos.md` rather than implied by the guards that work around it.
- `security-statements` still marks on an empty per-security answer; the repair clears the residue
  and the weight canary will catch a recurrence, but the marking rule itself was not changed the way
  `security-performance`'s was.

---

# HANDOVER — 2026-08-14 (morning)

Written so someone else can pick this up cold. Numbers are measured against production at the time
of writing, not estimated.

## 1. What is IN FLIGHT right now

**Three PRs open and unmerged.** All have green checks; none is deployed.

| PR | What | Why it matters |
|---|---|---|
| `muffin-deployment#121` | `promote-by-ticker` completion | The half already merged resolves a ticker to a FIGI and then **promotes nothing**, because `untracked_listing` is built from `exchange_listing` and a ticker the sweep never enumerated has no row. Measured on the first BABA attempt: `{"figi":"BBG006G2JVL2","promoted":false,"reason":"already tracked or unknown figi"}` — the FIGI was right and the message was wrong. #121 builds the security from the mapping response instead. **Without this, promote-by-ticker does not work.** |
| `muffin-ui#82` | Stock page: clickable country, "Held by" funds, `/fund/[fundSymbol]` page | Depends on `market.security_funds` and `market.fund_holdings`, already merged and deployed as deployment#118. |
| `muffin-ui#83` | Search on region/group/sector lists + the `/other` page | The "Other" bucket surfaces securities no list can place. |

**A local drain loop is running** (`scratchpad/drain-run3.sh 40`). It is a convenience, not
infrastructure — the paced cron does the same work eight times a day. If it is not running, nothing
is broken; the backlogs simply drain slower.

## 2. Backlogs, measured

| backlog | count | note |
|---|---|---|
| yahoo_symbol · profile · industry · performance · fundamentals | **0** | drained |
| statements | 3,539 | was 8,791. Slow BY DESIGN — see §4 |
| local_symbol | 411 | OpenFIGI, different provider, does not compete for the yfinance limit |
| prices | 392 | was 6,268 |

Coverage of 12,348 equities: fundamentals 92%, sector 89%, market cap 66%, industry 61%,
statements ~12.5% (**see the row-count caveat above — `security_statement_current` returns ~12 rows
per security and reads as 12x the truth**).

## 3. Issues found and FIXED in this stretch (all deployed unless noted)

- **Korea's IT stocks showed no gained/lost while their returns were in the database.**
  `fetchPerformance('instrument', period)` set no `.limit()`, and `PGRST_DB_MAX_ROWS` is 1000 against
  9,267 matching rows — so ~89% never reached the UI. Now scoped to the symbols on the page.
- **Vietnam showed US sectors.** 45 countries are drillable, only 26 have their own sector rows, so
  19 rendered American numbers on a page about somewhere else. It WAS labelled "US sector
  performance"; that label proved a weaker signal than eleven familiar sector names sitting there
  looking local. Now says there is no data for that country.
- **Alibaba was priced off the wrong listing.** N-PORT reports the INCORPORATION jurisdiction, so it
  is filed under `KY`; there is no exchange in the Cayman Islands, so `allowedSuffixes('KY')` was
  empty, `pickHomeListing` refused every hit, and it fell back to OpenFIGI's US line — displayed AND
  priced as `BABAF` with 275 bars, while the real listing is `9988.HK`. **180 equities** sit in
  venue-less jurisdictions (119 KY, 56 BM, 5 VG). Fixed in deployment#119.
- **The exchange sweep lost every ADR.** `securityType2: 'Common Stock'` excludes
  `Depositary Receipt`, which is what `BABA`, `TSM`, `NVO` and every foreign company's US line are.
  Fixed in deployment#120.
- **28 securities were named `New Issuer: BB Company ID:<n>`** — an N-PORT filer placeholder. OpenFIGI
  returns the real name in the SAME `/v3/mapping` response we already make; it was being discarded.
  Backfilled by hand as well, since the resource only fires for securities lacking a ticker and
  these had one.

## 4. Things that are NOT bugs, so nobody re-investigates them

- **Statements is ~5 weeks deep and that is inherent.** The provider does NOT accept several symbols
  on `equity/fundamental/income|balance|cash` — measured directly: `symbolsAsked 50,
  symbolsAnswered 0`. I batched it, it silently wrote nothing, and it was reverted. `security-refresh`
  gives any security someone actually opens its statements on demand, which is what makes the depth
  tolerable. **Do not "fix" this by batching.**
- **Do not raise a resource's page size to go faster.** The binding constraint is requests per unit
  TIME, not per run. `security-industries` uses 30 calls of its 90-second budget; a bigger page trips
  yfinance's limit sooner and buys nothing. The only optimisation that works is fewer requests PER
  SECURITY.
- **A bare 502 means a dead worker again** — but only since 2026-08-13. Application failures now
  answer `200` with `"ok": false`.
- **muffin-ui's 3 Dependabot alerts stay open deliberately.** `image-size` has NO patched version;
  `uuid` would need forcing four major versions into a package pinned to v7. Both are build-time
  only. Reasoning is in `todos.md`.

## 5. What is LEFT

**Immediate (mechanical):**
1. Merge and deploy the three open PRs. #121 in particular — promote-by-ticker is broken without it.
2. After #121 deploys, verify: `{"resource":"promote-listing","symbol":"BABA","exchange":"US","force":true}`
   should return `promoted: true`, and BABA should then appear in search.
3. Let `exchange-listings` run. deployment#120 restarts the US partitioned (A–Z then 0–9); each run
   takes one venue/type/prefix slice, so completing the US takes many runs.

**Unfinished from the discussion, not yet started:**
- **`provider_country_iso2`.** The fix for the Alibaba class of problem at the source: yfinance's
  `equity/profile` returns an OPERATING country, and we fetch that response already for sector and
  industry. Storing it beside the filed country — exactly as `provider_sector` sits beside the
  curated `sector_id` — would let Alibaba appear under China rather than Cayman Islands. deployment#119
  fixes the SYMBOL for these; it does not fix the COUNTRY.
- **Splits are DETECTED but stored prices are never adjusted.** `firstComparableIndex` refuses to
  report a return whose anchor predates a >5x single-bar move, per period, so a split does not
  fabricate a +900%. But the stored closes stay unadjusted and the pre-split history is silently
  excluded rather than corrected. There is no split or corporate-action handling anywhere in the
  pipeline.
- **Three stale entries in `todos.md`** proven wrong by measurement and not yet corrected:
  "sub-industry depth — only level 1 populated" (there are 151 level-2 nodes and 7,577 securities
  with an industry), "fundamentals blocked — every provider we hold a key for is gated" (11,395 of
  12,348, backlog 0, via keyless yfinance), and "~1,900 securities cannot get fundamentals" (backlog
  is 0).

**Blocked on money or a licence, not engineering:** GICS proper, total return / dividends
(everything is a PRICE return), index membership.

**Structurally impossible:** non-US UCITS funds file no N-PORT; commodity funds are trusts or pools
filing 10-K (SLV, USO, DBC); MDY is a unit investment trust.

## 6. The one thing most worth internalising

**The expensive failures all looked like success.**

A backlog that empties by MARKING securities unanswerable is indistinguishable from one that empties
by fetching them. On 2026-08-13 a throttled yfinance — which answers **200 with no rows** rather than
erroring — let six marking sites record **~8,300 securities as permanently unanswerable**, including
INTC, PEP, XOM and REGN, while `pending_industry` went to 0 and read as drained. Every count stayed
plausible.

Three of the fixes for it were themselves wrong at first, and in each case only measurement caught it:
a rule that would have re-caused the incident; a source guard that reported "all six sites gated"
while three were not (the mutation test's `sed` was mis-escaped, so four passes were four no-ops);
and a production tripwire that passed on the exact data it was written to catch.

So: **compare two populations, never watch one number.** `market-verify`'s mega-cap canary is the
model — a $50bn company having no industry is not a provider limitation, it is the bug, and it read
109 of 213 while the incident was live.

## 7. Operator skills

Six live under `.claude/skills/`, invocable as `/market-…`:

`market-refresh-routine` (drain, paced) · `market-refresh-security` (one security now) ·
`market-add-fund` (add an ETF, with the check that stops you adding one that can never be ingested) ·
`market-diagnose` (a resource is failing) · `market-repair-negative-cache` (clear wrongly-marked
securities, with how to tell a wrong mark from an earned one) · `market-health` (coverage and what is
genuinely blocked).

Each carries the measurement behind its advice, because the reasons are what stop the next person
undoing them.

---

# DATA CORRECTNESS AUDIT — 2026-08-15

Coverage says how much data exists; this audits whether the VALUES are right. Two real bugs, and one
of them I found by making the mistake myself.

## Verified correct

| dimension | method | result |
|---|---|---|
| prices | compared against **Yahoo directly**, same dates | GOOG/AAPL/005930.KS/7203.T match to **0.00–0.03%**; STX, ROST <0.5% |
| market caps | `cap ÷ price` = implied share count | right for all: AAPL 14.7bn, MSFT 7.5bn, NVDA 24.4bn, MediaTek 1.59bn |
| fundamentals units | range check on 800 securities | **0** outside expected bands — the fraction/percent trap is closed |
| sector classification | 17 unambiguous companies | **17/17**, incl. GOOG→communication-services, AMT→real-estate |
| identifiers | placeholder / empty scan | 0 placeholder CUSIPs, 0 placeholder ISINs, 0 empty, across 27,406 |
| extreme returns | largest 1-day ratio per security | 6 above +1000%, all 1.10–1.42x daily — real runs, not splits |
| price bars | integrity scan | 0 non-positive, 0 future-dated, across 3.06M |
| statements | period dates + magnitude vs market cap | none future-dated; Toyota ¥50.7tn, Samsung ₩333.6tn plausible |
| classification chain | full reconciliation | **0 unexplained** (see below) |

**Samsung's market cap looked wrong and was not.** ₩1,802tn is above the band I expected — but
`cap ÷ price` gives 6.73bn shares, which is right. The price is ₩268,000 in this data. The
measurement corrected me, not the reverse; do not "fix" a number because it disagrees with a
half-remembered figure.

## Bug 1 — statement figures labelled in the wrong currency

**Alibaba's revenue reads $1.02 TRILLION**, which would make it larger than Walmart. The figure is
1,023,670,000,000 **CNY** (~$141bn). `security_statement.currency` is null on all 83,211 rows, so the
view falls back to `security.currency_code` — the QUOTE currency. BABA genuinely trades in USD;
its accounts are not in USD. **565 non-US companies are quoted in USD, 376 of them with statements.**
Xiaomi (CNY) and Itaú (BRL) are the same shape. Correct for every LOCAL listing (7203.T JPY,
005930.KS KRW, SAP.DE EUR).

**No source here can supply the reporting currency, and I checked five before concluding it:** the
statement endpoints carry none; `equity/fundamental/metrics` and Yahoo chart meta both return the
quote currency; `quoteSummary.financialCurrency` answers `Invalid Crumb`; a country→currency guess is
wrong (VALE and NU are Brazilian and report in USD); and **deriving it from `enterprise_to_revenue`
was tested and FAILS** — Yahoo computes that ratio inside the reporting currency, so BABA reads 1.00,
and it false-positives on VALE (0.18) and Samsung (0.69).

So the label is WITHHELD rather than invented (deployment#135 + muffin-ui#85) — `money.ts`'s own rule
applied to the case that still defaulted. A number with no unit is worse than one with the right unit
and far better than one with the wrong unit.

## Bug 2 — found by making the mistake myself

An audit query paged `security_current` with `limit`/`offset` and **no `order`**, and reported 1,935
company names on multiple securities with repeated ISINs — which would mean a broken identity model.
Re-run with `order=security_id`: **12,000 rows, 12,000 distinct ids, ZERO repeated ISINs**, and 181
repeated names that are all genuine share classes (PETR3/PETR4 local, PBR/PBR-A ADRs, four distinct
ISINs). The data was right; the query was not.

**Two resources had the same shape.** `security-local-symbols` (3 pages) and `security-tickers`
(4 pages) both ordered by `best_weight` alone — which is **0 for every security no tracked fund
holds**, i.e. most of the backlog. Postgres gives no stable order among ties, so successive `range()`
calls can return one row twice and another never. Re-processing is harmless; the SKIPPED rows sit at
a page boundary the resource never reaches, and the symptom is a backlog that stops draining while
every run reports success. Both now carry `security_id` as a unique tiebreak (deployment#136), and
the check counts `range()` reads against tiebreaks so a new paged read cannot be added without one.

## The classification chain reconciles exactly

`pending_industry` is 0 while industry coverage is 62.4%, which is the shape of a backlog that thinks
it is finished. It is not one — the accounting closes with **0 unexplained**:

    7,700  have an industry
    3,479  industry_missing_at   (profile answered, carried no industry_category)
      837  profile_missing_at    (provider has no profile at all)
      331  no symbol             (cannot be asked about)
    ─────
   12,347  of 12,349 equities

Industry at 62.4% is genuinely provider-limited. `pending_industry` requires a level-1 sector, so the
1,168 sector-less equities can never enter it — and every one of them is accounted for upstream.

## The one loose thread, now resolved

NESN.SW and SAP.DE drifted ~1% from Yahoo over 25 days where the mega-caps matched to 0.03%. The
dividend-adjustment hypothesis was **wrong** — raw and `adjclose` give an identical difference.
Measuring PER DATE showed the real shape: **every settled bar matches to 0.000%** and only the
single most recent bar differs. That is a provisional last close — European markets settle at
17:30 CET and the fetch caught a different moment than Yahoo's final print. Not a defect.

The lesson is about the measurement, not the data: `max diff over 25 days` hid the fact that 24 of
those days were exact. **Compare a whole series before believing a single aggregate difference.**

---

# NEXT STEPS EXECUTED — 2026-08-15

The four next steps from the status reading, done. Two of them uncovered defects that only existed
because of the step itself.

## 1. The directory is actionable (muffin-ui#86)

99,811 listings were searchable and inert. `promote-listing` had worked since the directory was
built — BABA returns `promoted: true` and `security-refresh` then gives it a market cap, seven
periods, fundamentals and twelve statement rows — and **nothing called it**. There is now a Track
button on untracked search hits: admin-only (same rule as `RefreshButton`, because the server
rejects a non-admin token), promoting **by FIGI** rather than ticker (the directory row carries the
exact FIGI; a bare ticker is ambiguous across venues), and it does not claim the security is ready —
promotion creates it and the backlogs fill it.

**This resolves the bulk-promotion question rather than answering it.** 81,007 listings stay
findable and promotable on demand; tracking them all would 3x the universe and flood the
rate-limited backlogs for weeks. If that is ever wanted it is a `tracked_fund`-style control
surface, not a code change.

## 2. Two defects the button exposed

**A 200 from `market-refresh` is not proof the work happened.** `promote-listing` answers
`{ skipped: true, reason: 'fresh or in flight' }` when the TTL has not elapsed, and
`{ promoted: false }` when it resolves a FIGI it cannot build from. Both are 200s with no `error`,
so the first version of the button said "added" for either. It now requires `promoted === true`, and
`triggerRefresh` returns the body so it can check. Measured by hitting the `skipped` case, not
imagined.

**An early return after `begin_refresh` leaked the claim** (deployment#137). Three validation paths
returned 400/500 without `finish_refresh`, so a malformed request refused the resource for the
in-flight TTL — a `promote-listing` call with no `figi` made the next VALID call, 45 seconds later,
fail. **My first reading was that the lock was stuck; it is not** — `p_inflight_ttl` is two minutes
and it self-heals. The alarm was worse than the bug, but one mistake still cost two failures.

## 3. The currency gate failed open on the case it exists for (deployment#138)

#135 gave the statements view `country_iso2` so the app could withhold a currency label for a non-US
company quoted in USD. It exposed the **FILED** country — and BABA has none, because it was promoted
from the directory rather than ingested from a filing. `country_iso2` NULL, `provider_country_iso2`
CN. The caller tests `USD AND country !== 'US'`; **NULL is falsy**, so the gate declined to fire and
labelled Alibaba's CNY revenue USD again.

Caught by verifying the deploy against production rather than trusting the merge. **A guard that
fails open on its own headline case is worse than no guard, because it is now believed.** 21
securities are in that shape, all promoted rather than ingested — a population that only exists
since the Track button. The view now answers the EFFECTIVE country, and the test encodes the
CALLER'S rule rather than the column: asserting `country_iso2 is not null` would have passed while
the UI mislabelled.

## 4. The price drift was not a defect

NESN.SW and SAP.DE differed ~1% from Yahoo where mega-caps matched to 0.03%. The dividend-adjustment
hypothesis was **wrong** (raw and `adjclose` give an identical difference). Per-date measurement
showed **every settled bar matches to 0.000%** and only the most recent one differs — a provisional
close, since European markets settle at 17:30 CET and the fetch caught a different moment. The
lesson is about the measurement: `max diff over 25 days` hid that 24 of them were exact.

## Where ingestion stands

    universe    27,628 securities · 12,349 equity · 99,811 listings · 59 venues
    coverage    country 99.9% · symbol 97.3% · currency 94.0% · cap 93.7% · sector 90.5% · industry 62.4%
    health      20 resources, 0 failing · market-verify GREEN

Backlogs cycle daily by design (prices ~2,900, performance ~5,300 are the 24h TTL, not a stall —
**zero** never-priced securities remain). `derive-classifications`, `instrument-profile` and
`fund-holdings` look stale and are not: their TTLs are 7 to 30 days.

**Industry at 62.4% is provider-limited, and the chain reconciles with ZERO unexplained:** 7,700 have
one, 3,479 the provider answered without one, 837 have no profile at all, 331 have no symbol to ask
about. `pending_industry` reading 0 is correct, not a stalled backlog.

## `pending_local_symbol` sits at 283 for ever, and that is FINE

Worth writing down because the number invites a chase. **221 of the 283 already have a symbol** from
`security-yahoo-symbols`, a different resolver on a different path — so the backlog is not blocking
them and only ~62 securities genuinely lack one, 0.5% of the universe.

The composition explains the rest: **190 are offshore incorporations** (KY 119, BM 56, MH 10, VG 5)
where no exchange exists for `security-local-symbols` to resolve against, so they can never leave a
backlog defined as "has an ISIN, has no local symbol". The resource already filters to addressable
countries after reading, so they cost no provider calls — the view lists them, the run skips them.

The remainder are ~93 securities in REAL markets with no venue in the catalogue: LU 21, RU 16, IS 15,
RO 9, HU 6, EG 6, PA 5, CZ 5. Adding those venues is the same shape as VN/KK/QD/AR and would work —
but none of those countries is drillable, most of the securities already have symbols, and the
`every-drillable-country-is-swept` test passes because they are not app-visible. Low value, recorded
rather than done.

**A correction:** deployment#136's description said the missing paging tiebreak was "consistent with
`pending_local_symbol` sitting at 283". That implication was wrong — the 283 are venue-less
jurisdictions and the tiebreak did not move the number, as measured after it deployed. The tiebreak
fix is still correct (unordered pages can genuinely skip rows); it simply was not the cause of this.

## What is genuinely left

- **Statements ~4,300 pending** — provider-bound, drains over days. The on-demand path covers
  anything a user opens.
- **The reporting currency** — the label is now withheld rather than wrong, which is correct but is
  not the same as knowing. Needs `quoteSummary.financialCurrency` (blocked on a crumb) or an openbb
  release that surfaces it. Four dead ends are recorded in `todos.md` so nobody retries them.
- **Corporate actions** — splits are detected but stored prices are never adjusted. Needs a splits
  feed that does not exist here.
- **Blocked on money or licence:** GICS proper, total return / dividends, index membership.
- **Structurally impossible:** non-US UCITS funds file no N-PORT; commodity funds file 10-K.

---

# HANDOVER — 2026-08-15 (evening): corporate actions exist, and are one deploy from correct

Written to be picked up cold after a context compaction. Every number below was measured against
production at 14:45 UTC on 2026-08-15, not estimated.

## 1. THE ONE THING THAT NEEDS A HUMAN

**`muffin-deployment` #140 and #141 are MERGED TO `main` AND NOT DEPLOYED.**

```bash
gh workflow run "Deploy to Oracle Cloud" --ref main    # in muffin-deployment
```

Merging muffin-deployment does **not** auto-deploy — `Deploy to Oracle Cloud` is
`workflow_dispatch` only. (The auto-CD path in `MEMORY.md` is for the *build* repos, which dispatch
`deploy` after pushing an image; a deployment-repo change has no image to build and therefore no
dispatcher.) I tried to trigger it and the permission classifier blocked the call, so it is sitting
on `main` unapplied. **Nothing else in this handover is blocked on you.**

Until that deploy lands, production is in a known-inconsistent state: the 521 corporate-action rows
described below are still present and still unattributable, and `security_corporate_action` has no
`observed_symbol` column. Confirmed at 14:45 UTC — the count is 521 and the column 42703s.

**After it deploys, verify in this order:**

1. `security_corporate_action` count is **0** (migration 68 one-shot-deletes the 521).
2. Run the resource:
   ```bash
   curl -X POST "$BASE/functions/v1/market-refresh" -H "apikey: $SRV" -H "Authorization: Bearer $SRV" \
     -H 'Content-Type: application/json' -d '{"resource":"security-corporate-actions","force":true}'
   ```
3. Assert every new row carries an `observed_symbol` that **equals the security's own price
   symbol**. That is the whole point of #141 — see §3.
4. Assert `remaining` counts **securities**, not rows. Before #140 it reported `remaining: 0` on a
   run the provider had refused with a 429.

## 2. Corporate actions: what shipped, and what your Tiingo key bought

**The key works, and the note that had blocked this for weeks was wrong.** `todos.md` recorded
Tiingo free as "limited to the DOW 30" — measured against your token, it serves **93% of our US
tickers**. First live run:

```json
{"resource":"security-corporate-actions","written":521,"none":5,"noTicker":0,"failed":1,
 "lastError":"tiingo 429: You have run over your hourly request allocation","asked":60,"remaining":0}
```

**521 real rows — 23 splits and 498 dividends across 45 securities.** This is the first
corporate-action data in the system; "splits are detected but never adjusted" has been an open item
in this file since 2026-08-14.

New surface: `market.corporate_action_kind` + `market.security_corporate_action` (migration 67),
`market.pending_corporate_actions`, a `security-corporate-actions` resource, and
`functions/market-refresh/tiingo.ts` with a typed `TiingoNoSuchTicker` so a 404 (this ticker does
not exist) is never confused with a network failure.

**The rate limit is on UNIQUE SYMBOLS, not requests** — re-asking about a symbol already fetched
this hour is free. That shapes any future pacing work: batch by symbol coverage, not by call count.

## 3. Two defects I found by verifying the output, not the diff

Both were invisible to the type checker, to CI, and to the resource's own success report.

**#140 — `remaining` was in the wrong unit.** `written` counts **rows** (521) and `wanted.length`
counts **securities** (60), so `wanted.length - written` went negative and clamped to 0. The run
above was **refused by the provider with a 429** and reported a drained backlog. The backoff itself
was correct; only the arithmetic turned a refusal into "done". Fixed with a `covered` counter that
counts distinct securities, and `logic-check.ts` now fails on a `remaining` computed from a row
count.

**#141 — the actions did not match the price series.** This is the serious one. The resource asks
Tiingo by **US ticker**; prices are stored against the **primary listing**; and for **33 of the 45**
securities those are different instruments:

```
asked SSNLF → priced 005930.KS      asked NONOF → priced NOVO-B.CO
asked ASMLF → priced ASML.AS        asked BUDFF → priced ABI.BR
```

A cash dividend on Samsung's OTC line is quoted in **USD** against a **KRW** price series — wrong by
three orders of magnitude. An ADR ratio change would *introduce* a discontinuity if applied to the
local line, which is the exact defect corporate actions exist to remove.

Migration 68 adds `observed_symbol` **NOT NULL** (without it the rows are unauditable — you cannot
ask after the fact which listing an action came from, which is how this passed review), deletes the
521, and restricts the backlog so the two symbols must agree:

```sql
join market.security_symbol sym
  on sym.security_id = s.security_id and upper(sym.symbol) = upper(t.value)
```

Proven by mutation: removing the join makes the test report
`pending_corporate_actions offers the wrong securities: T68 Local priced: offered, expected not offered`.

**The cost is coverage, and it is the right trade.** Samsung gains no dividend record. That is
honest: Tiingo carries no Korean data, and the OTC line's dividend is a different number about a
different instrument. Same principle as the currency work earlier today — **a wrong number is worse
than no number, because a wrong one is believed.**

## 4. Provider keys — what each one is actually worth

You pasted seven keys. Measured, so nobody re-tests them:

| key | verdict |
|---|---|
| **TIINGO_TOKEN** | **WORKS and is now in use.** 93% of our US tickers; daily EOD carries `divCash`, `splitFactor`, `adjClose` per bar. US-listed only. Caps **unique symbols**, not requests. The variable name not ending in `_API_KEY` is fine — it is read as `TIINGO_TOKEN` throughout. |
| **FMP_API_KEY** | **DEAD, twice over.** v3 answers `403 Legacy Endpoint` and openbb's fmp provider calls v3. The `stable` line works but gates per symbol so hard that **`ROST` and `TPR` return 402** alongside every foreign listing. Would need a paid plan *and* a client bypassing openbb, to buy what Tiingo gives free. |
| **OPENFIGI_API_KEY** | In use — 250 req/min × 100 ids. |
| ALPHA_VANTAGE / FRED / BIZTOC / FINRA | Not used by this pipeline. Alpha Vantage is US-only at 25 calls/day and returns empty for the local listings we care about. |

**Do not re-derive this.** Twice now the answer to "which provider can serve X" has been "a response
we were already fetching" (market cap, operating country, currency, and the cap again). Check what a
payload CONTAINS before shopping for a key.

## 5. Where ingestion actually stands (measured 14:45 UTC)

```
universe    27,629 securities · 12,350 equity · 99,811 listings · 3,057,307 price bars
coverage    country 99.9%  symbol 97.3%  currency 94.0%  cap 93.7%  sector 90.5%  industry 62.4%
health      market-verify GREEN (03:36 UTC today)
```

| backlog | count | reading |
|---|---|---|
| `pending_fundamentals` | **0** | drained |
| `pending_industry` | **0** | drained — and correctly so; the chain reconciles with 0 unexplained (§6) |
| `pending_profile` | 2 | drained |
| `pending_local_symbol` | 283 | **permanent and FINE** — see the section above; 221 already have a symbol from a different resolver, 190 are offshore incorporations with no exchange to resolve against |
| `pending_prices` | 2,940 | the 24h TTL cycling, not a stall |
| `pending_performance` | 6,699 | the 24h TTL cycling, not a stall |
| `pending_statements` | 4,194 | genuinely draining; provider-bound, days not hours |
| `pending_corporate_actions` | 6,526 | new; will re-scope sharply downward once #141 deploys and the listing-agreement join applies |

**`untracked_listing` is 84,651 and rising** (81,007 yesterday) because `exchange-listings` is on the
cron now and still sweeping. That number is not a backlog and not a gap — it is the directory of
things findable in search and promotable on demand via the Track button. Bulk-promoting them would
3x the universe and flood the rate-limited backlogs for weeks; if it is ever wanted it is a
`tracked_fund`-style control surface, not a code change.

## 6. Things that look like bugs and are NOT — do not re-investigate

Each cost real time to establish.

- **`pending_industry` = 0 with industry at 62.4%.** Reconciles exactly, 0 unexplained: 7,700 have
  one, 3,479 the provider answered without one, 837 have no profile at all, 331 have no symbol.
- **`pending_local_symbol` = 283 for ever.** Venue-less jurisdictions. Recorded in full above.
- **A high `figi_missing_at` rate is not a defect** — it records that OpenFIGI has no *US* line for
  an ISIN, which is simply true for local listings (CN 96%, IN 99%, KR 97%), and nearly all of them
  still have a working symbol.
- **Statements are ~5 weeks deep BY DESIGN and must not be "fixed" by batching.** Measured:
  `symbolsAsked 50, symbolsAnswered 0`. The endpoints do not accept multiple symbols. `security-refresh`
  gives anything a user opens its statements on demand, which is what makes the depth tolerable.
- **Do not raise a page size to drain faster.** The binding constraint is requests per unit TIME.
  The only optimisation that works is fewer requests PER SECURITY.
- **NESN.SW / SAP.DE drifting ~1% from Yahoo is a provisional last close**, not a defect — every
  *settled* bar matches to 0.000%.
- **`derive-classifications`, `instrument-profile`, `fund-holdings` looking stale** — their TTLs are
  7 to 30 days.

## 7. What is genuinely left

**Ordinary work, unblocked, in rough priority order:**

1. **Deploy #140/#141 and verify** (§1). Everything below assumes this is done.
2. **Back-adjust stored prices using the splits we now hold.** This is the second half of corporate
   actions and is now ordinary work rather than blocked on a feed. Today `firstComparableIndex`
   *excludes* history before a >5x move rather than *correcting* it, so a split silently truncates a
   series instead of fabricating a return. The guard stays either way — it also catches the Tel Aviv
   ILA/agorot redenomination, which is not a corporate action and no splits feed will ever report.
3. **Total return from `divCash`.** We now have dividends. Every number in the app is a *price*
   return, which understates high-yield markets. This was on the "blocked on money" list and no
   longer is — for US-listed securities.
4. **Widen corporate-action coverage past US listings.** Tiingo is US-only, so #141's listing
   agreement is what limits it. Non-US actions need another source.

**Still blocked on money or a licence:** GICS proper, index membership, per-symbol fundamentals
beyond keyless yfinance.

**Still structurally impossible:** non-US UCITS funds file no N-PORT; commodity funds are trusts or
pools filing 10-K (SLV, USO, DBC); MDY is a unit investment trust. None is reachable by adding a
`tracked_fund` row.

**Two open items needing a decision, not engineering:**

- **The statement reporting currency.** The label is now *withheld* rather than wrong, which is
  correct but is not the same as knowing. Needs `quoteSummary.financialCurrency`, which requires a
  Yahoo crumb; my laptop test was rate-limited and is **INCONCLUSIVE, not failed** — worth one probe
  from the node. Four other dead ends are recorded in `todos.md` so nobody retries them.
- **Bulk promotion of the 84,651 untracked listings** — a product call, per §5.

## 8. The pattern this session kept re-teaching

**Every defect above was found by looking at the data the code produced, never by reading the code.**

- `remaining: 0` on a run the provider had refused — a success report computed from the wrong unit.
- 33 of 45 actions attributed to the wrong listing — a green suite, a clean diff, and rows that
  could not be checked because nothing recorded where they came from.

Both are the same shape as the whole preceding week: **a resource that reports success while doing
the wrong thing is the default failure mode here, not the exception.** The counter-measure that
keeps working is to make the output *self-describing* — `observed_symbol` exists so that the next
person can ask "which listing did this come from" and get an answer instead of a guess. A row you
cannot audit is a row you will eventually have to delete, which is exactly what migration 68 does to
all 521.

Corollary worth keeping: **when a fix is a deletion, deploy it promptly.** Those 521 rows are wrong
*now*, and the longer they sit the more likely something starts reading them.

---

# HANDOVER — 2026-08-17: price ingestion had been stopped for three days

Numbers measured against production on 2026-08-17, not estimated.

## 0. THE BLOCKER, unchanged from 08-15 and now costing real data

**Nothing has been deployed since 2026-08-15 12:21 UTC.** #140 and #141 were merged that afternoon
and the deploy was never run; #144 now sits behind them. `Deploy to Oracle Cloud` is
**`workflow_dispatch` only** — merging `muffin-deployment` does not deploy it. (The auto-CD in
`MEMORY.md` is for the *build* repos, which dispatch after pushing an image; a deployment-repo
change has no image and so no dispatcher.)

```bash
gh workflow run "Deploy to Oracle Cloud" --ref main    # in muffin-deployment
```

I attempted this on 08-15 and again today; both times the permission classifier blocked the call.
**This is the only thing on the critical path.** Everything below is merged or in a green PR.

## 1. `security-prices` had not run since 08-14, and every signal said it was healthy

This is the most important thing in this file. The cron called it **eight times a day** throughout,
and every single call answered:

```json
{"resource":"security-prices","skipped":true,"reason":"fresh or in flight"}
```

which the warm-up **correctly** counts as a success — a warm-up finding fresh data is the happy
path. Green workflow, `ok: true` in `refresh_log`, no error anywhere, and price ingestion simply
stopped.

| | |
|---|---|
| newest stored price bar | frozen at **2026-08-14** |
| `pending_prices` | 2,940 → **11,348** (92% of all 12,350 equities) |
| `security_price` rows | 3,057,307 → 3,057,307, **identical to the digit** across three days |

**Cause: a default TTL.** The TTL was a ternary chain ending in `: PROFILE_TTL_MINUTES` (7 days),
kept *beside* a separate `EXTRA` array of known resources. The two drifted, and three resources were
in the array and absent from the chain — `security-prices`, `security-yahoo-symbols`,
`security-corporate-actions`. All three are **incremental backlogs**, exactly what the comment two
lines above the chain warns must never get a completion-shaped TTL. The warning was correct, sitting
directly on top of the code, and the fallback silently defeated it.

**The fix is to delete the default, not add three branches.** Every resource declares its TTL in one
map and `EXTRA` is *derived from that map's keys*. The two lists cannot drift because there is now
only one list, and a resource added without a TTL is not "the default applies" — it is
`unknown resource`, a loud 400 on the first call. (deployment#144)

**What to check after the deploy:** `pending_prices` falls from 11,348, and `security_price` gains
bars dated after 2026-08-14. No repair migration is needed — the stalled resources are already
outside the new window and resume on the first cron pass.

## 2. `remaining` was lying in four more resources

#140 fixed this for corporate actions. The same unit confusion was live elsewhere, and two of them
were reporting a **drained backlog on every run**:

| resource | reported | truth |
|---|---|---|
| `security-statements` | `written: 276, remaining: 0` | 276 is ROWS (~12/security) against 60 asked; `pending_statements` **3,646** |
| `security-performance` | `refreshed: 2751, remaining: 0` | 2,751 rows ≈ 306 securities; `pending_performance` **6,909** |
| `security-prices` | `remaining: <page size>` | the same number whether the run priced everything or nothing |
| `security-industries` / `-profiles` | over-counted | counted `writes` **before** `dedupeBy`, so a security in two sectors counted twice |

`remaining` is subtracted from a count of SECURITIES. Subtract ROWS and it clamps to zero — the one
number an operator reads to judge a backlog, failing in the believable direction.

**The discriminator is the upsert's conflict key.** `security_fundamentals` is keyed on
`security_id` alone, so counting its rows *is* counting securities and `written` is correct there —
the only site where it is. `security_taxonomy` is keyed on `(security_id, node_id, source_code)` and
`security_price` on `(security_id, date)`, so counting theirs is not.

**The guard took three attempts and the first two passed while broken** — worth reading before
writing another guard here:

1. **Inferring** the unit by walking from `counter += arr.length` to the nearest `onConflict` cannot
   tell whether that upsert wrote that array. Three false positives on correct code (`emptyIds`,
   `deadIds`, `batch` are arrays of SECURITIES, so their `.length` *is* a security count). A guard
   that cries wolf on correct code gets deleted.
2. **A blacklist of counter names** cannot express "legal here, illegal there" — which is exactly
   `written`'s situation. Mutation put `written` back into the statements expression and the guard
   **passed**.
3. **A per-resource whitelist** of the identifiers each `remaining` may mention, *plus* a rule that
   it must actually subtract something — the page-size bug is the ABSENCE of a subtraction, which a
   whitelist alone cannot see.

Five mutations, each caught independently.

## 3. The exchange directory contains no funds at all

Of 102,390 rows in `exchange_listing`: **99,673 Common Stock, 2,717 Depositary Receipts, ZERO
funds** — against **74** ETFs in the universe, every one hand-added to `tracked_fund`, none
discovered.

Nothing could report it: every coverage number is computed over `security_type_code = 'equity'`, so
a missing asset class moves no metric. Backlogs drain, `market-verify` is green, and search simply
never offers an ETF. **The failure is an ABSENCE, and absences do not raise** — same shape as
`exchange-listings` being off the cron, and `untracked_listing` sitting wrong and unread for weeks.

**Not just a third row, because OpenFIGI has two type vocabularies.** Measured against `/v3/filter`:

```
securityType2 = 'Mutual Fund'  US -> 44,119   FEUCX, WATFX, NPRTX  (open-end funds)
securityType  = 'ETP'          US ->  6,664   DGP, UWM, EWH, ICLN, MDY  (actual ETFs)
```

SPY is `securityType: 'ETP'` **inside** `securityType2: 'Mutual Fund'`. The coarse bucket is both
wrong and unusable — 44,119 is over the 15,000 paging ceiling and is overwhelmingly open-end mutual
funds, which are not exchange-traded. `figi_field` on `exchange_sweep_type` records which of the two
a type uses, so adding a fund class stays a row in Studio. (migration 69)

**Scope, deliberately:** this CATALOGUES ETFs so they are searchable and promotable. It does not make
them tracked funds — 6,664 N-PORT filings would swamp SEC's fair-access limit and every downstream
backlog, and most are not US-registered and file no N-PORT at all. `tracked_fund` stays curated;
this makes choosing the next one a query instead of a memory.

Note the trap it is guarded against: **OpenFIGI ignores an unknown filter key and returns the venue
UNFILTERED** rather than erroring — which is how "Samsung Electronics" once returned 8,725 rows that
were nearly all options. A typo in `figi_field` would not fail, it would flood.

## 4. `logic-check.ts` was never typechecked

It is only ever `deno run`, which **strips** types rather than checking them — so the one file
holding every guard in this pipeline was the one file nothing typechecked. Three errors were sitting
on `main` (a missing `YahooHit` import, an optional chain returning `boolean | undefined`) and the
suite passed green. CI now typechecks it.

## 5. Do we have the whole universe? — the honest answer

**Two different things are often conflated here, and only one of them is nearly complete.**

| | count | state |
|---|---|---|
| **Catalogued** (searchable, promotable) | 102,390 listings / 59 venues | stocks + ADRs substantially complete outside the US; **US is at prefix B of 36**; **funds: 0 until #144 deploys** |
| **Tracked** (priced, classified, fundamentals) | **12,350 equities** | the union of tracked-fund holdings + promoted listings — *not* the whole market, by design |
| **Funds** | **74** | hand-picked for N-PORT holdings; ~6,664 US ETPs exist |
| Bonds / derivatives / cash | 15,159 / 44 / 2 | typed from the filing, correctly excluded from equity views |

Coverage of the 12,350 tracked equities: country 99.9%, symbol 97.3%, statements-attempted 97.7%,
prices 94.6%, currency 94.0%, cap 93.7%, sector 90.5%, **industry 62.4%** (provider-limited; the
chain reconciles with zero unexplained).

**The gap between 102,390 catalogued and 12,350 tracked is deliberate**, not a backlog. Promoting
everything would 3x the universe and flood rate-limited providers for weeks. The Track button
promotes on demand; bulk promotion remains a product decision, and if wanted it is a
`tracked_fund`-style control surface, not a code change.

**The US directory sweep is the one genuine incompleteness in the catalogue.** It is
letter-partitioned (A–Z then 0–9) because OpenFIGI stops paging at 15,000 while reporting ~20,107 US
common stocks, and it advances one slice per cron pass, round-robin with 58 other venues. It will
finish on its own; it is slow because the sweep is fair, not because it is stuck.

## 6. What is left

**Unblocked, in priority order:**

1. **Deploy** (§0). Everything else assumes it.
2. Verify #141: `security_corporate_action` → 0, then re-run and confirm every row carries an
   `observed_symbol` matching the security's own price symbol.
3. Verify #144: `pending_prices` falls, bars appear after 08-14, and the three stalled resources
   show fresh `refresh_log` timestamps.
4. Let the ETP sweep run, then decide which of the newly catalogued funds are worth *tracking*.
5. ~~**Back-adjust stored prices for splits**~~ — **NON-TASK, and building it would have corrupted
   the data.** Verified 2026-08-17: the provider already adjusts. OpenBB's yfinance provider
   defaults to `adjustment=splits_only`, and NFLX's stored series is **smooth across its 10-for-1
   split on 2025-11-17** (~$110 both sides) where unadjusted data would show a 10x cliff. A
   back-adjustment pass would have divided already-adjusted closes again. `firstComparableIndex`
   still earns its keep, but for **redenominations** (Tel Aviv shekels→agorot) and OTC ratio
   changes — which are not corporate actions and no splits feed fixes.
6. **Total return** — still real work, since `splits_only` excludes dividends. Two routes, and
   **measure the second first**: (A) re-fetch with `adjustment=splits_and_dividends`, simple but
   doubles requests per security against the binding constraint; (B) `include_actions`, which
   yfinance returns as columns **on the price response we already fetch** — one call, covers the
   non-US listings Tiingo 404s. If (B) holds it is the fifth time the answer was already in a
   response we were fetching.

**Still blocked on money or a licence:** GICS proper, index membership, non-US corporate actions
(Tiingo is US-only).

**Still structurally impossible:** non-US UCITS funds file no N-PORT; commodity funds file 10-K.

## 6b. Post-deploy verification, and one thing that looked like a regression and was not

All four fixes confirmed against production after deploying:

| | evidence |
|---|---|
| #144 TTL | all three stalled resources run on demand; newest price bar **2026-08-14 -> 2026-08-17** |
| #141 actions | 855 rows, **0 of 855** mismatched between `observed_symbol` and the security's price symbol (was 33 of 45 securities) |
| #140/#144 units | statements `60-25-1 = 34`, performance `1000-560 = 440` — both reported `0` before |
| #145 fund labels | `figi_security_type = 'ETP'` populating: SPY, DIA, ISHARES MSCI INDIA, ABF SINGAPORE BOND FUND |

**Two resources showed `ok: false` immediately after the deploy and both were deploy-window
artifacts**, worth knowing because "is anything failing?" is the obvious health check and it gives
false alarms for a few minutes after every deploy:

- `security-performance` was **in flight** when the functions container restarted, so it never
  called `finish_refresh` and left `finished_at: null`. The 2-minute in-flight TTL self-heals it.
- `security-prices` hit `relation "market.pending_prices" does not exist` — migrations apply
  `--single-transaction` **per file**, so between migration 35 (which drops dependent views) and
  the file that recreates them there is a real window where a reader 404s. Transient by
  construction; the view had 11,009 rows minutes later.

**`WorkerRequestCancelled` on `security-performance` looked like a regression and was not.** Settled
by retrying across the in-flight window rather than by reasoning: the next clean attempt returned
`refreshed: 3880, securitiesCovered: 560, batchesFailed: 0, remaining: 440` — more work than the
run that had failed.

**But one real measurement came out of chasing it, and it is a standing risk rather than a bug:**
the cron's own `security-performance` run at 14:51 today — hours before any change — took
**89 seconds against a 90-second worker limit** (`workerTimeoutMs` in `functions/main/index.ts`).
The mechanism is the one already documented in this file: the 60s deadline gates whether to START a
batch, and that batch's tail (fetch, isolation, upsert, retraction, stale-period prune) is not
bounded by it. Nothing is being fixed for it now because the resource demonstrably completes
560 securities cleanly; it is recorded so that if `WorkerRequestCancelled` starts recurring, the
first place to look is the unbounded tail, not the provider.

## 6c. "Are there blockers for markets beyond the US?" — measured 2026-08-17

Short answer: **no blocker of coverage or capability. The blocker was THROUGHPUT, and it was
arithmetic.** The two things that sound like blockers were both checked first and neither is one.

**Venue coverage is not a blocker.** 59 venues across 46 countries, every one swept within the past
week — Germany 14,184 listings, India 5,432, UK 4,346, Japan 4,086 + 3,950, Switzerland 3,471,
Thailand 3,194, plus Korea, Taiwan, Mexico, Brazil, Australia, China.

**The 15,000 paging ceiling is not a blocker either, and I expected it to be.** Partitioning
triggers off the `total` the API itself reports (`total > PAGING_CEILING`), not a hardcoded list of
"big exchanges" — so any venue that grows past the cap partitions automatically. That was written
generically the first time.

**Symbol resolution beyond the US is healthy** — measured per country, equities with no provider
symbol: JP 0%, DE 1%, IN 1%, KR 1%, CH 2%, HK 2%, TW 2%, AU 2%, CA 2%, CN 2%, VN 2%, IL 2%, MY 2%,
TH 3%, BR 3%, SG 3%, ZA 3%, GB 4%, MX 4%, PH 5%. No country shows the Taiwan signature (securities
present, symbols absent), which is the failure mode worth watching for.

**The real blocker (deployment#146):**

```
59 venues x 3 instrument types                             = 174 slices
+ 36 letter-partitions x 3, for the one venue over the cap = 108 slices
                                                             282 slices
```

`exchange-listings` swept exactly ONE venue/type/prefix slice per invocation, 8 cron runs a day —
a **35-day full catalogue pass**. And most slices are trivial: Portugal is 50 listings and a single
request, costing a whole cron slot exactly like a 4,000-listing venue.

**Neither binding limit was per-invocation.** OpenFIGI's keyed allowance is 250 requests a MINUTE
and one page is one request, so a run sweeping twenty single-page venues spends twenty of them. The
loop now budgets wall clock and requests explicitly, and **refuses to START a venue it cannot
finish** rather than merely checking the deadline has not passed — the distinction that has
`security-performance` sitting at 89s of its 90s limit.

**Catalogued is still not the same as tracked, and that gap is by design.** Japan has 8,036
catalogued listings and 1,368 tracked equities; the tracked universe is the union of what
US-registered funds hold (via N-PORT) plus promoted listings. Growing tracked non-US coverage means
adding country/regional ETFs to `tracked_fund`, or bulk promotion — a product decision, not an
engineering gap.

## 7. The pattern, stated once more because it recurred twice today

**Both defects reported success while doing nothing.** `skipped: true` is a legitimate success that
happened to mean "stopped for a week"; `remaining: 0` is a legitimate answer that happened to mean
"I counted the wrong unit". Neither raised, neither moved a metric, and both were found by comparing
a *reported* number against a *measured* one.

The counter-measure that keeps working: **compare two populations, never watch one number.** The
price-bar count being identical to the digit across three days is what exposed the TTL bug — not any
error, not any check, just two measurements of the same thing on different days.
