# Market data coverage — what we have, what we don't, what's worth adding

**Measured against production 2026-08-19.** Every number here was counted, not estimated. How the
pipeline works is a separate document: [data-ingestion.md](data-ingestion.md).

> **Two live stalls were found on 2026-08-28 and both were invisible to every count here.**
> `security-statements` returned `written: 240, remaining: 8668` byte-identical on five consecutive
> runs — the `no_currency` population admitted 2,416 securities SEC can never answer for (no CIK),
> starving the 3,328 it can. And `security-eps-history` re-asked an exhausted 25-a-day quota for
> data the forward earnings calendar returns 643 companies at a time. **A coverage figure that is
> not moving is the thing to look at**; `market.backlog_drain` now names it (`FLAT`,
> `draining_by_marking`) rather than leaving it to be spotted by eye.

> **Coverage is now measured continuously, so prefer the live view over the tables below.**
> `market.coverage_current` (migration 131) computes completeness across ten dimensions — country,
> sector, industry, cap band, style, MSCI tier and region, income group, currency, security type —
> and `market.coverage_sample` snapshots it twice daily, which is what the Grafana coverage
> dashboard reads. The numbers in this document are a hand-counted point in time; the view is the
> same question asked automatically.
>
> **Completeness is TYPED, and `market.required_facet` is the control table that decides what each
> security type owes.** A bond arrives from an N-PORT filing and that is all it will ever be, so one
> flat definition would report 55% of the universe (15,159 bonds of 27,629) as permanently broken
> for facets that can never apply — a number that gets ignored within a week. Retyping what a type
> owes is a row in Studio, not a migration.
>
> **Known miscalibration: ETFs read 0% complete and the SEED is what is wrong, not the data.** All
> 74 have a symbol and performance and **none has a row in `security_price`** — `pending_prices` is
> scoped `where security_type_code = 'equity'`, so an ETF can never get one. ETF returns come from
> `performance`, computed off `etf/historical`, and bars were never stored. Requiring `price` of an
> ETF asks for something this pipeline has never produced. Fix is one row in `required_facet`.
>
> **First real sample, 2026-08-27:** equities **39.9% complete** (4,927 of 12,350), with `industry`
> the bottleneck at 7,712 against symbol 12,016 / price 11,711 / profile 11,799. By country,
> **CN 12.8%, JP 15.2%, TW 17.0%** against the 39.9% average — Asian markets are far behind, and
> that is where provider budget should go.

---

## 1. The distinction that governs everything below

Two different things get called "the universe", and only one of them is nearly complete:

| | count | what it means |
|---|---|---|
| **Catalogued** | **108,217 listings** / 59 venues / 46 countries | findable in search, promotable on demand. Name, ticker, FIGI, venue. **No price, no sector, no fundamentals.** |
| **Tracked** | **27,629 securities** (12,350 equity) | fully ingested — priced, classified, fundamentals, statements |
| **Untracked** | **92,938 listings** | catalogued but not tracked |

**The gap is deliberate, not a backlog.** The tracked universe is the union of what US-registered
funds hold (via SEC N-PORT) plus listings someone promoted. Promoting all 92,938 would roughly
quadruple the universe and flood rate-limited providers for weeks, for companies nobody has asked
for.

**The control surface for bulk promotion now exists** (2026-08-19), and it is opt-in per venue —
`market.exchange.promotion_tier` / `.promotion_enabled`, drained by the `promote-wave` resource.
It does **nothing** until an operator enables a venue, which is the correct default: every promoted
security becomes work for five rate-limited backlogs, so promoting faster than they drain starves
the securities people are already looking at.

**The order is the feature, and the obvious order is wrong.** Ranking venues by untracked count puts
Frankfurt first (15,711, ahead of the US at 10,160). Measured on a 400-listing sample per venue,
matched by name against securities already held:

| venue | sampled | already in universe | % |
|---|---|---|---|
| **GR** Frankfurt | 400 | 73 | **18.3** |
| IB India | 400 | 24 | 6.0 |
| LN London | 400 | 21 | 5.3 |
| HK | 400 | 19 | 4.8 |
| US | 400 | 2 | 0.5 |
| JP | 400 | 1 | 0.3 |

Nearly a fifth of Frankfurt's untracked listings are **cross-listings of companies already tracked**.
`untracked_listing` cannot see this because it excludes by composite FIGI, and `composite_figi` is
per **country of listing**, not per company — so the listing is genuinely untracked while the company
is not. Promoting it mints a duplicate that consumes profile, price and statement calls of its own.
18.3% is a LOWER BOUND: exact name matches only. Hence `promotion_tier` ranks home markets first, and
`pending_promotion` dedupes by name against what we hold.

**`exchange_listing` carries no liquidity or market-cap signal at all** — only identity. So "promote
by liquidity" cannot be gated on liquidity: you must promote a security to learn its cap. A cap floor
can only PRUNE after promotion, never gate before it.

---

## 2. What IS integrated

> **Freshness has two floors, not one.** A row's `stale_after` bounds how old the *stored* value
> may be; the **HTTP cache** in front of every provider bounds how new the value could have been
> when it was stored. See `data-ingestion.md` §3 and §9c.

### 2.1 The universe

| | count |
|---|---|
| securities | **27,629** |
| ├ equity | 12,350 |
| ├ bond | 15,159 |
| ├ ETF | 74 |
| ├ derivative | 44 |
| └ cash | 2 |
| catalogued listings | 108,217 |
| tracked funds (ETFs we ingest holdings from) | 79 |
| fund holdings | 39,886 |
| price bars | **6.50 M** — 3.06 M daily (rolling ~400 days) + **3.44 M weekly back to 2006** |
| company metrics (`security_metric`) | **2.09 M** — of which **1.42 M from SEC XBRL** and **1.01 M quarterly** |
| taxonomy nodes (sectors + industries) | 162 |

Measured 2026-08-21. The metric and weekly-price rows did not exist the previous day; both backlogs
are still draining, so these grow. `security_price` now carries a `grain`: the daily series is a
rolling window and the weekly one is the full history, and they OVERLAP on purpose — a weekly
series that stopped where the daily window begins would make a 20Y chart end two years ago.

### 2.2 Per-equity coverage (of 12,350)

| dimension | coverage | source |
|---|---|---|
| country | **99.9%** | N-PORT filing + yfinance operating country |
| symbol | **97.3%** | OpenFIGI + Yahoo search |
| statements attempted | **97.6%** | **sec** where a US ticker exists (18 annual periods, with a reporting currency), yfinance otherwise (4 periods, none) |
| price series | **94.6%** | yfinance daily bars |
| currency | **94.0%** | N-PORT `curCd` + metrics |
| market cap | **93.7%** | profile + promoted from metrics jsonb |
| fundamentals | **93.2%** | `equity/fundamental/metrics` |
| sector | **90.5%** | filing (via fund) + yfinance |
| **industry** | **62.4%** | `equity/profile.industry_category` |

### 2.3 What was added 2026-08-20/21

Everything here is free and was measured across a US mega-cap, a German, a Japanese, a Korean and a
Brazilian ADR before being built — the discipline that stopped `revenue_per_geography` becoming a
table nobody could fill.

| | state | note |
|---|---|---|
| **company metrics, charted** | 2.09 M rows | up to 22 annual periods and 17 years of QUARTERS. Derived in SQL from statements, and read straight from SEC XBRL where the filer publishes it |
| **SEC XBRL** | 1.42 M rows, 3,516 filers mapped | one request per filer at 0.17s against 5.58s for three openbb calls. **Half the filers report under `ifrs-full` with no `us-gaap` node at all** — AB InBev, Novo Nordisk, TSMC, Nokia, Santander |
| **20-year weekly prices** | 3.44 M bars | `interval=1W`, works for every market tried, batches 12 symbols |
| **statement reporting currency** | 1,125 rows | was **0 of 104,972**. Genuinely multi-currency: USD, EUR, DKK, PEN, TWD |
| **dividends** | 2,550 yfinance rows | global — Korea, Spain, Finland, Taiwan, Indonesia. Tiingo remains US-only and is now splits-only |
| **share statistics** | 1,653 rows | float, shares outstanding, ownership, **and short interest for every market** (FINRA's route is US-only by construction) |
| **analyst estimates** | 1,559 rows | targets in EUR, MXN, MYR, ZAC, IDR, AUD, PLN — the doc previously called these "all premium" |
| **company news** | 1,216 articles | stored once and shared: 11% are returned for more than one security. 90-day retention, pruned every run |
| **symbol repair** | live | `ATCOA.ST` → `ATCO-A.ST`, `6.HK` → `0006.HK`, `BRK/B` → `BRK-B`. Candidates are VERIFIED against the provider, never pattern-matched and rewritten |

**Industry at 62.4% is provider-limited, not a stalled backlog.** The chain reconciles with **zero
unexplained**: 7,701 have one, ~3,479 the provider answered without one, ~837 have no profile at
all, ~331 have no symbol to ask about.

### 2.4 What was added 2026-08-21/22 — the derived layer and the pages that read it

The gap being closed here was against financecharts' per-stock page. Phase 0 fixed a defect that
blocked everything after it; Phases 1-3 built the derived layer, the presentation, and the breadth.

| | state | note |
|---|---|---|
| **quarterly series, decontaminated** | repaired | XBRL duration facts for Q2/Q3 are frequently YTD, and the old filter (`days > 200`) let the 6-month ones through. AAPL's `2026-03-28` "quarter" read **254,940M against a full-year 416,161M — 61% of a year in one quarter**. Nothing in any row count showed it |
| **TTM as a third `period_type`** | 633,788 rows (from 83,247) | a rolling sum of four discrete quarters for flow metrics, the latest instant for stock metrics |
| **`security_ratio_series`** | live | P/E, P/S, P/B, EV/EBITDA, earnings and FCF yield **computed per price bar**, the way financecharts does it — they store adjusted close and diluted EPS TTM and never store a ratio. EPS TTM is **stepwise in time**, so it holds between filings and steps on the filing date; getting that wrong makes P/E jump on report dates rather than on price |
| **FX per bar** | 21,605 rate rows | a ratio across currencies divides dollars by kroner and looks ordinary. Withheld unless comparable |
| **news, dividends, profile, statements, peers** | rendered | 1,216 articles and 9,066 corporate actions had been collected and **nothing read them** |
| **company profile fields** | zero new calls | description, employees, website, HQ and beta were on every `equity/profile` response this pipeline ever made, and were discarded. Fifth instance of "the answer is already in a response you fetch" |
| **Form 4 insider transactions** | live | `equity/ownership/insider_trading?provider=sec` — the item §5 named as the one free thing still worth doing |
| **filings, management, next earnings** | live | SEC filing index by CIK, officers, and upcoming report dates from nasdaq |
| **leadership, with the pay currency** | live | `pay` was served as a bare number. SK hynix's chief executive is **4,239,000,000** — won, about $3m — and with a hardcoded `$` that reads as four billion dollars. Same shape as Alibaba's CNY revenue printing as "$1.02T" |

**Found by using the pages rather than reading the diff (2026-08-22):**

| | what it was | state |
|---|---|---|
| annual charts plotted a fiscal year **twice** | AAPL 2025 at both 09-27 (filing) and 09-30 (provider), values agreeing | fixed — migration 126 collapses to one point per fiscal period, filing wins |
| a country's sector list had **no ordering** | `weight` is the SECTOR fund's, null for all 56 Korean IT rows, so the list ran alphabetically — Clobot above SK hynix | fixed — market cap is the fallback |
| the returns request was **unbounded** | one `in.()` over every loaded symbol, and infinite scroll grows the page by 20 forever | chunked at 100 (prevention: 600 symbols measured OK at 5,793 chars) |
| EPS history asked under **OTC lines** | `ASMLF`/`BUDFF`/`TSMWF` are bare tickers the provider answers `{}` for | fixed — backlog requires a US listing, 1,015 → 394 |

Three earlier reports turned out to be **already fixed** and are recorded here so they are not
re-investigated: Vietnam showing US sectors (a country with no coverage now says so), a country's
sector returns not matching its ETF, and the missing gained/lost labels (a whole-universe fetch was
silently truncated at `PGRST_DB_MAX_ROWS`; it now asks only for the symbols on the page).

**Verification that mattered more than the row counts:** Samsung's P/E reads 25.89 (KRW over KRW),
AAPL 37.54, NVDA 39.34; all nine stock-page anon reads answer in 0.06-0.83s against a 2,000 ms
budget. A ratio spot-checked against a **non-USD filer** as well as a US mega-cap, because the
currency mismatch is the failure mode that looks right.

### 2.3 What each security can carry

- **Identity** — ISIN, CUSIP, FIGI, ticker, LEI (on the issuer), name, issuer
- **Placement** — filed country, operating country, sector, industry, the funds holding it and at
  what weight
- **Prices** — ~400-day window (daily for 90 days, weekly before), **split-adjusted**
- **Returns** — 1d/1w/1m/3m/6m/ytd/1y/3y/5y, **price returns only**
- **Fundamentals** — ~35 ratios: P/E, margins, ROE, debt/equity, beta, EV, dividend yield
- **Statements** — income, balance sheet, cash flow, ~52 line items per period as jsonb
- **Corporate actions** — splits and dividends; dividends are **global** since migration 87 (Korea, Spain, Finland, Taiwan, Indonesia), splits remain US-listed

### 2.4 Aggregates that work

Sector and country performance, fund sector/country weights (the Markets donut), sector
constituents ranked by the weight the fund actually reports in its SEC filing, country tiers by
MSCI/FTSE/World Bank lens, and a full classification tree.

### 2.5 Filters and recomputed aggregates (2026-08-19)

`market.security_facets` is one row per security carrying **every dimension a list can filter by** —
region, MSCI/FTSE tier, World Bank income group, sector, industry code, cap band, style, currency,
and bond maturity/coupon. Region, tier and income group had been seeded for 181–221 countries and
joined to *nothing* until this view; bonds (15,159 of 27,629) could not be filtered at all.

**It is MATERIALISED, and that is not an optimisation.** As a plain view, filtering by
`msci_tier` AND `sector_id` together returned `57014 canceling statement due to statement timeout`
to anon — each predicate was survivable alone (0.3–0.7s) and the conjunction was not, because the
planner's estimate collapses and a per-row sector lookup runs 59,076 times. Materialised: **0.35s**,
and bounded — eight combinations up to a 5-way conjunction all land between 0.26s and 0.38s.
Refreshed by `facets-refresh` (60-minute TTL); `refreshed_at` carries the snapshot's age.

`market.aggregate_performance(period, group_by, …12 filters)` recomputes a weighted mean over any
filtered slice, grouped by any facet. Cap-weighted **and** equal-weighted, because one mega-cap can
carry a sector while its median name falls.

**It returns concentration, not just coverage — they are different questions.** Developed large-cap
value information technology reported **+327.40%** with `constituents 77/80` and `weight_covered
0.98`: every completeness guard satisfied, the arithmetic correct, and **240 of those 327 points from
two companies** (MU +670.8%, SNDK +3,471.6%). The returns were real — checked, because a number that
large is usually a broken series: MU has 276 smooth bars, largest single-bar move ×1.19, against this
pipeline's ×6-in-one-bar corruption threshold. So `top_contributor` / `top_contributor_share` ship
alongside. Weight share alone would miss it: SNDK is 3.2% of the bucket by cap and supplies a third
of the answer.

### 2.6 Style — growth/value (2026-08-19)

`market.security_style` fits book-to-price against **Russell 1000 Growth/Value membership**
(IWF/IWD are tracked funds), rather than inventing a rule. Measured accuracy **0.678** against a
0.629 base rate, **2.5% outright swaps**; per-class recall value 0.84, growth 0.48.

**Ranked WITHIN a (tier × cap band) peer group, which is the whole design.** Ranked globally, the
median Russell 1000 name sits at the **0.299 percentile of the world** — 70% of global equities are
cheaper than the median US large cap — so a threshold that splits the Russell sensibly labelled
**89% of all securities "value"**. Accuracy was flat at ~0.71 across every candidate cohort and could
not detect this, because the calibration set is 63% one class. Growth recall (0.55 → 0.70) and
cohort-centredness (0.299 → 0.430) could.

The shipped thresholds are **not** the most accurate ones: matching Russell's own name proportions
halves outright growth↔value swaps (4.5% → 2.5%) while scoring lower, and a swap is the only error a
user sees. `style_source` distinguishes an index fact from a 0.678 model; 98.2% of scoreable
equities land in one of 7 cohorts, and the rest get **no style** rather than one computed against
strangers.

### 2.7 Macro (2026-08-19)

`market.macro_indicator` is a control table — adding a series is a row, never a migration — with
`market.macro_observation` and the `macro_current` serving view. **49 series across 14 countries**:
OECD CPI/GDP/unemployment, federal_reserve yield curve/EFFR/SOFR, FRED 10y yields and unemployment,
and yfinance gold/WTI/BTC/S&P 500. Driven by `macro-indicators` (6-hour TTL); **2,137 observations**
on the first production run.

Observations key on **(indicator, date, dimension)** because a yield curve is a term structure —
flattening it would make the "curve" whichever maturity was written last.

---

## 3. What is NOT integrated

> **Some apparent coverage gaps are CACHE artefacts, not source gaps.** The canonical case: a
> newly listed company cannot be resolved at all while `company_tickers.json` is up to 30 days
> stale, because that file is the CIK↔ticker map. Before concluding a provider lacks something,
> check the TTL table in `data-ingestion.md` §3 and the traps in §8.

### 3.1 Blocked on money or a licence

| Gap | Why | What it would take |
|---|---|---|
| **GICS proper** | licensed taxonomy | an MSCI/S&P licence. We use yfinance's taxonomy as a proxy, which is why `provider_sector` sits beside the curated `sector_id` |
| **Index membership** (S&P 500, FTSE 100…) | FMP premium; index constituents gated on every free provider | a paid provider — or approximate from fund holdings, which is what we do today |
| ~~**Analyst estimates, price targets, ratings**~~ **WRONG — measured 2026-08-20** | `equity/estimates/consensus` (yfinance) answers for **all six** probe symbols including SAP.DE, 7203.T and 005930.KS; `equity/estimates/price_target` (finviz) returns 20 rows for US-listed names and **HTTP 400** for local foreign symbols. So consensus is universal and free, price targets are a US-only tier. Not premium |
| **Institutional holdings (13F)** | `equity/ownership/form_13f` returns **204**; FMP's `institutional`/`major_holders` **402** | genuinely unavailable free |
| ~~**Insider holdings**~~ **needs no separate pipeline** | `equity/ownership/insider_trading?provider=sec` returns Form 4 rows through the API we already call | ordinary resource work |
| **Intraday / real-time prices** | free tiers are EOD | paid feed. Also a different storage shape |
| **Options chains, borrow** | premium or exchange-licensed | paid feed |
| ~~**Short interest**~~ **free, US only** | `equity/shorts/short_interest?provider=finra` returns 120 rows for US-listed names and **0** for local foreign symbols — FINRA is a US SRO, so that is the dataset's real shape, not a gap | ordinary resource work |
| ~~**Revenue by geography / business line**~~ **SOLVED 2026-08-29, from the filings rather than a vendor** | The FMP route stays dead and the warning below stands: `revenue_per_geography` and `revenue-product-segmentation` are **per-symbol gated** — measured 2026-08-29 on the `stable` API (v4 is retired), AAPL/MSFT/GOOGL/NVDA/JPM/XOM/TSM/BABA answer and NEE, PLD, SAP.DE, **ASML (even the US ADR)**, SHEL.L, NESN.SW, 005930.KS, BHP.AX and 7203.T all **402** — and it returns revenue only, never profit. The answer was never a vendor: **every filing's own XBRL instance carries revenue AND operating income per segment**, keyless. See `security-segments` in [data-ingestion.md](data-ingestion.md). Do NOT build this on FMP |
| **Peer groups** | `equity/compare/peers` (fmp) is free and answers for every symbol tried, but it is **sector + market-cap proximity, not a curated peer set**: SAP.DE returns Micron, SK hynix and ASML (all German-listed semiconductors). US names are good — KO to PG/PEP/BUD/UL, JPM to BAC/HSBC/RY/WFC. Usable if labelled as what it is | ordinary resource work, with honest labelling |

### 3.2 Structurally impossible with the current sources

| Gap | Why |
|---|---|
| **Non-US UCITS funds** (most European ETFs) | they file **no N-PORT** — there is no equivalent public holdings disclosure |
| **Commodity funds** (SLV, USO, DBC) | trusts and pools filing **10-K**, not N-PORT |
| **Unit investment trusts** (MDY) | file no N-PORT |
| **Non-US corporate actions** | ~~Tiingo is US-listed only~~ — **DIVIDENDS SOLVED** 2026-08-18 via the yfinance price response (deployment#149), which covers every market yfinance does. **Splits are still US-only**: `stock_splits` rides on the same response and is not yet captured. Low urgency, because bars arrive already split-adjusted, so a missing split corrupts nothing — it is only an absent fact. |
| **Local-listing fundamentals for some venues** | keyless yfinance does not cover e.g. Philippines (`ICT.PS`) or UAE (`FAB.AE`) — confirmed by driving them directly |
| **Segment disclosure for non-SEC filers (most of Europe and Asia)** | There is **no EDGAR equivalent**. filings.xbrl.org indexes 25,675 ESEF filings with pre-converted xBRL-JSON, and ASML, Nokia, Novo Nordisk and TotalEnergies FY2025 carry **431–872 facts and ZERO segment axes** — measured 2026-08-29. ESEF mandates *detailed* tagging of the primary statements only; IFRS 8 segment notes are **block-tagged as text**, so the numbers are not machine-readable at all. Germany is not indexed. The 787 non-US securities that file a 20-F/40-F with SEC (ASML, SAP, Diageo, Infosys, MUFG, TSMC, Novo, Toyota…) ARE covered, through the same instance parser. Japan (EDINET) and Korea (DART) need free API keys and their tagging depth is **unverified** — after ESEF that is a gate, not an assumption |

### 3.3 Built but not finished

| Gap | State |
|---|---|
| ~~**Total return**~~ **DONE 2026-08-18** (deployment#149 + #153) | Dividends were arriving on the price response all along — `include_actions` defaults to `true` in openbb's yfinance provider and `barFrom` discarded them. `performance.total_return_pct` now carries a **daily-reinvested** total return beside the price return. Verified live: of 79 one-year rows, **55 show total > price, 24 show total = price exactly, and 0 show total < price** (which would be impossible). Implied yields: median **1.75%**, p90 5.37%, max 8.13%, **none above 25%** — and the top of the distribution is REITs (Gecina, Landsec, Kite Realty), which is where a domain expert would predict it. |
| **ETFs as tracked funds** | 74 tracked against ~6,664 US ETPs. Cataloguing is now live; deciding which to *track* is a product call |
| **The US directory sweep** | letter-partitioned A–Z + 0–9 and still early. It completes on its own |
| ~~**Reporting currency of statements**~~ **DONE 2026-08-20** (deployment#177) | The sixth source has it: `provider=sec` returns `reported_currency` **and** 18 annual periods against yfinance's 4. The five sources checked were price-side providers — the filing was never asked. The real blocker was the backlog: `currency` sat at **0 of 104,972** with column and code both present since migration 29, because `pending_statements` exited on "has no statements at all" and locked out the 8,559 securities already holding four currency-less periods. SEC is **annual-only** here (`period=quarter` → 422), so quarterly depth still needs `companyfacts` |
| **Symbol changes / renames** | the identifier model tolerates one; nothing detects one |
| **Sub-industry depth (levels 3–4)** | `taxonomy_node.parent_id` models the full tree; only levels 1–2 are populated |

---

## 4. What I'd add, in priority order

These are my recommendations, with the reasoning so you can disagree with the reasoning rather than
the conclusion.

### Tier 1 — high value, no new dependency

**1. Total return via `include_actions`.** The single biggest correctness gap in what we *show*.
Every number in the app understates high-yield markets, and for a 10-year horizon that is not a
rounding error. Test whether `equity/price/historical` returns `dividends` as a column on the
response we already fetch; if it does, this costs **no additional provider calls** — which matters,
because the binding constraint here is requests per unit time.

**2. More tracked funds, chosen by what they'd add.** The universe grows by adding ETFs, and this is
now a *query* rather than a memory: the catalogue can tell you which funds exist. Adding a
small-cap or emerging-market fund brings thousands of securities no current fund holds. **IWM alone
once brought 1,922 small caps.** Cheap, no code.

**3. ~~Bond reference data.~~ DONE 2026-08-18 (deployment#150).** The first increment needed no new
provider, exactly as predicted: N-PORT's `<debtSec>` block was in filings we already download and
`parseHoldings` read around it. Measured after deploying and re-ingesting the five bond funds:

| | before | after |
|---|---|---|
| bonds with a maturity date | **0** | **15,159 (100%)** |
| zero-coupon bonds identified | — | 13 |
| bonds flagged **in default** | — | 10 |
| coupon kinds (learned, not seeded) | — | Fixed · Variable · Floating · None |

The maturity spread is now queryable: 14 maturing before 2027, 3,006 before 2030, 12,137 before
2050. The longest are university **century bonds** maturing 2122 — a real instrument class, checked
rather than assumed to be a parse error.

Still missing for bonds: **credit rating** (licensed — S&P/Moody's/Fitch) and **yield to maturity**,
which needs a bond price we do not have; N-PORT gives `valUSD` and `balance`, from which a price can
be derived, but that is a separate piece of work.

**4. Finish the ETF catalogue and pick the tracking rule.** Cataloguing is live; ~6,664 US ETPs
exist. A defensible rule ("track any ETF above $1bn AUM", "track any fund a user opens") turns a
one-off decision into a policy.

### Tier 2 — needs a new source, but a free one

**5. ~~Institutional holdings from 13F.~~ NOT AVAILABLE FREE — this section contradicted its own
table.** §3.1 records the measurement: `equity/ownership/form_13f` returns **204** and FMP's
`institutional` / `major_holders` return **402**. The filings themselves are public, so "public and
free" reads as true and is the wrong test — what matters is whether a source in THIS stack serves
them, and none does. Building it would mean parsing 13F from EDGAR directly, which is a new
ingest rather than a resource. Do not list it as a free item again without a measurement showing
rows.

**6. Insider transactions from Form 4 — NEEDS NO NEW SOURCE, so it does not belong in this tier.**
`equity/ownership/insider_trading?provider=sec` serves Form 4 through the openbb-api this stack
already calls, which makes it ordinary resource work (a backlog, a negative cache, a table) rather
than a new pipeline. It stays on the list because the SIGNAL is differentiated — insider buying is
one of the few things a persona can reason about that a price series cannot show — not because it
is hard.

**7. Corporate filings / news.** The agent does deep research; having filings indexed against
`security_id` would make that grounded rather than searched.

**8. ~~FX rates.~~ DONE 2026-08-18 (deployment#152).** `market.fx_rate` covers **41 currencies**
with subunit handling derived rather than authored, and `security_market_cap_usd` is the comparable
figure. It unlocked exactly what was predicted: `security_facets.cap_band` bands on the USD value and
is **NULL when no rate is known** — a cap with no FX rate is unbanded, never guessed, because banding
a ₩1,802tn Korean company off its native figure puts it three orders of magnitude wrong.

The `market-verify` mega-cap canary is still US-only, and that constraint is real rather than
oversight: `security.market_cap` is denominated in each security's own currency, so the canary
checks by **fund weight** instead — a percentage is free of currency, cap and country.

### Tier 3 — worth doing once the above lands

**9. Sector/industry classification for bonds and funds.** `security_taxonomy` is keyed on
`security_id` and a fund *is* a security, so XLK could be classified under Information Technology
and EWJ under Japan. That would make "which ETFs cover this sector" a query rather than the
hardcoded map it is today.

**10. Point-in-time fundamentals.** Everything is "latest". An agent backtesting a thesis needs to
know what was *knowable* on a date. This is a schema decision best made before the data grows, not
after.

**11. Earnings dates and events calendar.** Cheap to fetch, high user value, and it gives the
statements backlog a sensible priority ordering — refresh what is about to report.

### What I would *not* do

- **Bulk-promote the 92,728 untracked listings.** It quadruples the universe, floods rate-limited
  providers for weeks, and most of those companies nobody will ever open. On-demand promotion
  already works and is the right shape.
- **Buy FMP.** Measured twice: v3 is retired for new keys and the `stable` line gates per symbol so
  hard that ordinary US mid-caps 402. It would not serve this universe even paid.
- **Build a splits back-adjustment pass.** Bars are already split-adjusted; doing it again would
  corrupt price history. This was on the roadmap and would have been actively harmful.

---

## 5. Honest summary

**For US and developed-market large caps the data is good** — 90%+ on every dimension except
industry, prices current daily, statements and fundamentals broadly present.

**Three things I would want a user to know before trusting a number:**

1. **Industry is 62% covered**, and the missing 38% is the provider's limit, not a queue.
2. **A filtered aggregate can be well-covered and still be two companies.** `weight_covered`
   answers completeness, not concentration — read `top_contributor_share` beside it.
3. **Style is a model, not a fact, outside the ~1,000 index-labelled names.** `style_source` says
   which you are looking at; growth recall is 0.48.

*(The first two entries here previously read "all returns are price returns" and "market cap cannot
be compared until FX lands". Both were already false when written — total return shipped 2026-08-18
and FX the same day — which is exactly the failure mode this document exists to prevent.)*

**The bond slice is no longer the largest untapped asset** — it went from no attributes at all to
100% maturity coverage on 2026-08-18, from filings we were already parsing. What is left there is
credit rating (licensed) and yield (derivable, not yet built).

**The largest correctness gap — total return — is closed as of 2026-08-18.** `performance` now
carries a daily-reinvested `total_return_pct` beside `change_pct`, verified against 79 one-year rows
with zero impossible values and a median implied yield of 1.75%.

**What is left is mostly product decisions and licensed data**, not engineering: which catalogued
ETFs to track, which venues to opt into promotion, and the licensed sets (GICS, index membership,
ratings, estimates). The free engineering items that were outstanding — total return, FX, bond
reference data, filters, style, macro — all landed on 2026-08-18/19.

~~**The free item still worth doing is Form 4 insider transactions**~~ **DONE 2026-08-21** — served
by `equity/ownership/insider_trading?provider=sec` through the openbb-api already deployed, so it
was a resource rather than a pipeline, exactly as predicted. **13F is NOT one of them**: `form_13f`
answers 204 and FMP's equivalents 402. This summary previously named both as free, contradicting
§3.1's own measurement two hundred lines above it — the filings being public is not the same as a
configured provider serving them. **Re-measured 2026-08-22 with a live FMP key**, since a 402 read
from a keyless deployment proves nothing: `form_13f` still returns 204 from SEC and rejects every
other provider, and `revenue_per_geography` 402s for 7 of 13 symbols tried — genuinely per-symbol
premium, which is the same trap `equity/fundamental/metrics` set when a 3-symbol probe of mega-caps
suggested a feature that could never serve the universe.

**One measured correction to an earlier justification:** `equity/compare/peers` was recorded here as
402/premium. With a live key it works for all 13 symbols tried, so that reason was wrong. The
decision not to use it stands on a different and better ground — FMP's peer list for AAPL includes
an **$852k** company — which is why `security_peers` is computed from the spine instead.

**A coverage gap named rather than papered over:** EPS history (`historical_eps`, alpha_vantage,
**25 calls a DAY**) can only be asked for securities whose US-listed symbol this pipeline holds.
~610 large holdings have none — AB InBev is held only as `BUDFF` (its US rows are BONDS), Novo
Nordisk only as `NONOF` — and alpha_vantage answers `{}` for those spellings. Closing it means
resolving the ADR (`NVO`, `BUD`), which is a symbol-resolution problem, not an EPS one.
