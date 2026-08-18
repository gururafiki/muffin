# Market data coverage — what we have, what we don't, what's worth adding

**Measured against production 2026-08-18.** Every number here was counted, not estimated. How the
pipeline works is a separate document: [data-ingestion.md](data-ingestion.md).

---

## 1. The distinction that governs everything below

Two different things get called "the universe", and only one of them is nearly complete:

| | count | what it means |
|---|---|---|
| **Catalogued** | **107,985 listings** / 59 venues / 46 countries | findable in search, promotable on demand. Name, ticker, FIGI, venue. **No price, no sector, no fundamentals.** |
| **Tracked** | **27,629 securities** (12,350 equity) | fully ingested — priced, classified, fundamentals, statements |
| **Untracked** | **92,728 listings** | catalogued but not tracked |

**The gap is deliberate, not a backlog.** The tracked universe is the union of what US-registered
funds hold (via SEC N-PORT) plus listings someone promoted. Promoting all 92,728 would roughly
quadruple the universe and flood rate-limited providers for weeks, for companies nobody has asked
for. The Track button promotes on demand; bulk promotion is a product decision and would be a
`tracked_fund`-style control surface, not a code change.

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
| catalogued listings | 107,985 |
| tracked funds (ETFs we ingest holdings from) | 74 |
| fund holdings | 39,886 |
| price bars | ~3.06 M |
| taxonomy nodes (sectors + industries) | 162 |

### 2.2 Per-equity coverage (of 12,350)

| dimension | coverage | source |
|---|---|---|
| country | **99.9%** | N-PORT filing + yfinance operating country |
| symbol | **97.3%** | OpenFIGI + Yahoo search |
| statements attempted | **97.6%** | yfinance income/balance/cash |
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

---

## 3. What is NOT integrated

### 3.1 Blocked on money or a licence

| Gap | Why | What it would take |
|---|---|---|
| **GICS proper** | licensed taxonomy | an MSCI/S&P licence. We use yfinance's taxonomy as a proxy, which is why `provider_sector` sits beside the curated `sector_id` |
| **Index membership** (S&P 500, FTSE 100…) | FMP premium; index constituents gated on every free provider | a paid provider — or approximate from fund holdings, which is what we do today |
| **Analyst estimates, price targets, ratings** | all premium | paid provider |
| **Institutional / insider holdings** | 13F and Form 4 are public but a separate pipeline | SEC ingestion work, not a purchase |
| **Intraday / real-time prices** | free tiers are EOD | paid feed. Also a different storage shape |
| **Options chains, short interest, borrow** | premium or exchange-licensed | paid feed |

### 3.2 Structurally impossible with the current sources

| Gap | Why |
|---|---|
| **Non-US UCITS funds** (most European ETFs) | they file **no N-PORT** — there is no equivalent public holdings disclosure |
| **Commodity funds** (SLV, USO, DBC) | trusts and pools filing **10-K**, not N-PORT |
| **Unit investment trusts** (MDY) | file no N-PORT |
| **Non-US corporate actions** | Tiingo is US-listed only; a Japanese split is invisible to us |
| **Local-listing fundamentals for some venues** | keyless yfinance does not cover e.g. Philippines (`ICT.PS`) or UAE (`FAB.AE`) — confirmed by driving them directly |

### 3.3 Built but not finished

| Gap | State |
|---|---|
| **Total return / dividend-adjusted performance** | every number is a **price** return. Bars arrive `splits_only`-adjusted. We now hold dividends for US listings, so this is ordinary work — but **measure `include_actions` first**, since it may return dividends as columns on the price response we already fetch |
| **ETFs as tracked funds** | 74 tracked against ~6,664 US ETPs. Cataloguing is now live; deciding which to *track* is a product call |
| **The US directory sweep** | letter-partitioned A–Z + 0–9 and still early. It completes on its own |
| **Reporting currency of statements** | unknown, so the label is **withheld rather than guessed**. Five sources checked; none supplies it. Needs `quoteSummary.financialCurrency` (blocked on a Yahoo crumb) |
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

**3. Bond reference data.** 15,159 bonds — the largest single slice of the universe — carry
essentially nothing: no coupon, no maturity, no rating, no yield. They arrive from AGG/LQD/HYG
holdings and then sit there. N-PORT itself carries maturity and coupon in fields we currently
discard, so **the first increment needs no new provider at all**.

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

**8. FX rates.** With 337 of 1,000 sampled securities non-USD, cross-market comparison is currently
impossible — you cannot rank a JPY market cap against a USD one. ECB publishes daily reference rates
free. **This unlocks the market-cap lens that is US-only today**, which is also why the
`market-verify` mega-cap canary has three blind spots.

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

1. **All returns are price returns.** No dividends. High-yield markets are understated.
2. **Industry is 62% covered**, and the missing 38% is the provider's limit, not a queue.
3. **Market cap is denominated in each security's own currency** and cannot be compared across
   markets until FX lands.

**The largest untapped asset is the bond slice** — 15,159 securities, the majority of the universe,
carrying almost no attributes, with the first improvement available from filings we already parse.
