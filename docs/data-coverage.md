# Market data coverage — what we have, what we don't, what's worth adding

**Measured against production 2026-08-19.** Every number here was counted, not estimated. How the
pipeline works is a separate document: [data-ingestion.md](data-ingestion.md).

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
| price bars | ~3.06 M |
| taxonomy nodes (sectors + industries) | 162 |

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

**Industry at 62.4% is provider-limited, not a stalled backlog.** The chain reconciles with **zero
unexplained**: 7,701 have one, ~3,479 the provider answered without one, ~837 have no profile at
all, ~331 have no symbol to ask about.

### 2.3 What each security can carry

- **Identity** — ISIN, CUSIP, FIGI, ticker, LEI (on the issuer), name, issuer
- **Placement** — filed country, operating country, sector, industry, the funds holding it and at
  what weight
- **Prices** — ~400-day window (daily for 90 days, weekly before), **split-adjusted**
- **Returns** — 1d/1w/1m/3m/6m/ytd/1y/3y/5y, **price returns only**
- **Fundamentals** — ~35 ratios: P/E, margins, ROE, debt/equity, beta, EV, dividend yield
- **Statements** — income, balance sheet, cash flow, ~52 line items per period as jsonb
- **Corporate actions** — splits and dividends, **US listings only**

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
| **Revenue by geography / operating markets** | `equity/fundamental/revenue_per_geography` (fmp) is **per-symbol gated**: AAPL/MSFT/KO/NKE answer, MLM and SAP.DE return `402 Premium Query Parameter: this value set for 'symbol' is not available under your current subscription`. Measured 2026-08-20 — the same free-tier shape that got the fundamentals feature reverted | a paid key, or another source. Do NOT build `security_revenue_segment` on this |
| **Peer groups** | `equity/compare/peers` (fmp) is free and answers for every symbol tried, but it is **sector + market-cap proximity, not a curated peer set**: SAP.DE returns Micron, SK hynix and ASML (all German-listed semiconductors). US names are good — KO to PG/PEP/BUD/UL, JPM to BAC/HSBC/RY/WFC. Usable if labelled as what it is | ordinary resource work, with honest labelling |

### 3.2 Structurally impossible with the current sources

| Gap | Why |
|---|---|
| **Non-US UCITS funds** (most European ETFs) | they file **no N-PORT** — there is no equivalent public holdings disclosure |
| **Commodity funds** (SLV, USO, DBC) | trusts and pools filing **10-K**, not N-PORT |
| **Unit investment trusts** (MDY) | file no N-PORT |
| **Non-US corporate actions** | ~~Tiingo is US-listed only~~ — **DIVIDENDS SOLVED** 2026-08-18 via the yfinance price response (deployment#149), which covers every market yfinance does. **Splits are still US-only**: `stock_splits` rides on the same response and is not yet captured. Low urgency, because bars arrive already split-adjusted, so a missing split corrupts nothing — it is only an absent fact. |
| **Local-listing fundamentals for some venues** | keyless yfinance does not cover e.g. Philippines (`ICT.PS`) or UAE (`FAB.AE`) — confirmed by driving them directly |

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

**5. Institutional holdings from 13F.** Public, free, quarterly, and the same shape as the N-PORT
pipeline we already have — the ingest, identity resolution and snapshot model all carry over.
"Which funds own this?" is one of the most asked questions about a stock.

**6. Insider transactions from Form 4.** Same argument: public, free, and a genuinely differentiated
signal for the agent's analysis, not just the UI.

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

**The free items still worth doing are 13F institutional holdings and Form 4 insider transactions**
(§4 Tier 2): public, free, and the same shape as the N-PORT pipeline that already works.
