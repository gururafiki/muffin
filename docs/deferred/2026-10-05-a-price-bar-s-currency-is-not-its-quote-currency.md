# A price's currency is not the currency it is quoted in

## Why

Nothing in the pipeline reads the currency of the line it prices. Yahoo states it on every chart
answer (`meta.currency`), and openbb's yfinance adapter drops it, so stored raw has no currency
field (checked 2026-10-05). Two columns stand in for it, and both are assigned rather than read:

- **`market.security.currency_code`.** This is the one that matters: `security_ratio_series` serves
  it as `quote_currency`. It is filled from N-PORT's holding currency first, then from the yfinance
  metrics response (CLAUDE.md). N-PORT reports the line a US fund holds, often a USD OTC or ADR
  line. The metrics response reports the **reporting** currency. Measured: `security.currency_code`
  equals the metrics currency for Constellation, Franco-Nevada and Lancashire (all USD reporters),
  and for Geely and Kuaishou (CNY). Restaurant Brands' N-PORT holding is its USD line.
- **`market.price_bar.currency_code`**, set by `prices.currency_by_security` from the listing
  currency (primary first) or `security.currency_code`. **Nothing reads it.** There is no view
  dependency (`pg_depend` on the column) and no function body naming it.

Verified against Yahoo on 2026-10-05:
- **Controls.** Every class whose label is the venue's own currency matched: KWF, NOK, CHF and ILA,
  two symbols each.
- **Suspect classes.** Every one was wrong, except one London line Yahoo genuinely quotes in USD
  (0ADF.L).

## What it serves today

These are P/Es read from `security_ratio_series` on 2026-10-05. Each error is the factor between the
served value and the true one, using `fx_rate` for 2026-10-02.

| Line | Yahoo quotes in | Served as | Served P/E | Too high by |
|---|---|---|---|---|
| ALG.KW | KWF (fils) | KWD | 12,305.2 | 1,000× |
| AAYAN.KW | KWF | KWD | 2,578.3 | 1,000× |
| ALHE.TA | ILA (agorot) | ILS | 10,685.2 | 100× |
| AZRG.TA (Azrieli) | ILA | ILS | 2,546.7 | 100× |
| GRUMAB.MX (Gruma) | MXN | USD | 172.4 | 18.3× |
| 0992.HK (Lenovo) | HKD | USD | 222.6 | 7.85× |
| CSU.TO, QSR.TO, FNV.TO, CLS.TO, RBA.TO | CAD | USD | 82.17, 25.24, 274.80, 60.43, 50.11 | 1.42× |
| 558.SI, ME8U.SI | SGD | USD | 60.97, 22.18 | 1.28× |
| 1024.HK (Kuaishou) | HKD | CNY | 7.95 | 1.17× |

**Scope.** 3,689 securities have a trailing EPS, so a P/E is possible for them. In the classes the
samples show to be wrong, there are about 83:

| Venue | Served as | Securities |
|---|---|---|
| Tel Aviv | ILS | 21 |
| Kuwait | KWD | 18 |
| Oslo | USD | 11 |
| Toronto | USD | 8 |
| Hong Kong | USD | 6 |
| Tel Aviv | USD | 5 |
| Mexico | USD | 4 |
| Hong Kong | CNY | 2 |
| Singapore | USD | 2 |
| Oslo | EUR | 2 |
| Copenhagen, Frankfurt and Oslo | DKK or USD | 1 each |
| PBR-A, an NYSE line | BRL | 1 |

Across all priced equities the label is wider than the P/E damage. By venue, `security.currency_code`
reads:

| Venue | Label | Securities | Correct label |
|---|---|---|---|
| Hong Kong | CNY | 117 | HKD |
| Hong Kong | USD | 68 | HKD |
| Singapore | USD | 39 | SGD |
| Toronto | USD | 34 | CAD |
| London | USD | 34 | some correct, like 0ADF.L |
| London | GBP | 215 | pence |
| Tel Aviv | ILS | 26 | agorot |

Yahoo quotes most London lines in pence (LRE.L: GBp). Not one London line has a P/E today, so that
100× is latent. It arrives with each London security's first trailing EPS.

**It is about to get worse.** muffin-ingest#99 reloads a history asked with another symbol. Read off
raw on 2026-10-05:
- **95 histories will reload** on the sweep's next visit.
- **58 of them are labelled USD on a non-US line:** Singapore 35, London 9, Hong Kong 7, Oslo 3,
  and one each in Mexico, Amsterdam, Milan and Warsaw.
- **Tencent is one.** Its whole history is TCTZF, the USD OTC line (52.95 on 10-02, while 0700.HK
  closed near HKD 423). Today its label and its prices agree, both USD. The reload is right for the
  prices, but the label stays USD, so the two disagree and its P/E goes 7.85× too high.

## Context

- Found while verifying muffin-ingest#99 on Geely (0175.HK: HKD, labelled CNY) and SATS (S58.SI:
  SGD, labelled USD).
- The openbb adapter calls Yahoo's chart endpoint once per ticker (measured 2026-09-19).
  `providers/yahoo_chart.py` already calls the same endpoint directly for FX.
- CLAUDE.md, "Raw is the vendor's answer, whole": on 2026-09-12 the user chose not to own the openbb
  layer yet. This is the first defect that needs it.
- A unit can change mid-series. Tel Aviv moved from shekels to agorot on 2026-05-18 without
  rescaling the old bars (CLAUDE.md). So the currency belongs to each **fetch**, not to the security.

## Decision (2026-10-06)

**Option 1: fetch price history through `yahoo_chart`** and keep `meta.currency` per fetch. Bars are labelled from it, and `security_ratio_series` takes its quote currency from it. Planned in its own spec before building.

## Options (as presented)

1. **Fetch price history through `yahoo_chart`, and serve the quote currency from it**
   (recommended).
   - It is the same request per ticker, so the budget does not change.
   - Raw keeps Yahoo's answer, `meta.currency` included, per fetch.
   - Stage 2 labels each bar with it, subunits included.
   - `security_ratio_series` takes `quote_currency` from the bar instead of `security.currency_code`,
     and converts subunits by their parent's rate.
   - The FX lane already derives ILA, ZAC and KWF (`fx.SUBUNITS`). It has no pence, which London
     needs.
   - Yahoo spells pence `GBp` and cents `ZAc`. Uppercased, `ZAc` becomes `ZAC`, which is this
     schema's code for cents, so that case comes out right. But `GBp` becomes `GBP`, the pound.
     **One normalisation is right for cents and 100× wrong for pence**, so map Yahoo's codes
     explicitly.
   - Existing raw has no currency, so the stored bars need one short chart request per security:
     ~12,000, about five nights of the sweep's budget. Or they wait for each history's next full
     reload.
2. **A quote-currency lane**, one request per symbol on the same budget (Yahoo chart with
   `range=1d`, or the yfinance quote). It leaves the price lane alone. It costs those ~12,000
   requests and then one per new security, and it stays per security rather than per fetch.
3. **Derive from the venue.** It costs no request, but it needs a currency on `market.exchange`
   (authored; there is none today). It is wrong for lines a venue quotes in another currency (0ADF.L
   in USD, Toronto's `-U` lines), and it cannot see a venue change its unit.

**Interim, any option: withhold rather than convert.** The ratio view could serve no price-based
ratio when the security's currency is not the priced line's evidenced currency. That stops the
1,000× and 100× numbers now, and is honest while the label is unknown. It needs the evidence from
one of the options. Without it, the only stop-gap is withholding a listed set of venues.

## What to do

1. Decide the option, and whether to withhold in the meantime.
2. Label the stored bars and re-point `security_ratio_series.quote_currency`.
3. Re-check the P/E of a Kuwaiti, a Tel Aviv, a Hong Kong and a Toronto security against an
   independent source.

## Done when

- Every served `quote_currency` is the currency Yahoo states for the line priced.
- A check counts the disagreements (market-verify, sampled as the segment checks are).
