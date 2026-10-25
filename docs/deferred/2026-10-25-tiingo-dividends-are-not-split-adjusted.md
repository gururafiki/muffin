# Tiingo's dividends are not split-adjusted, and they inflate total returns

Created 2026-10-25 · Status: **open, needs a decision** (Phase 4 decision 9, Tiingo's retirement)

## What was found

The 10-25 check-in started from the one firing Grafana alert, `muffin-backlog-stalled`.
- **The stall.** `pending_corporate_actions` has sat at exactly 1,035 since 2026-10-22, and
  `security-corporate-actions` has written nothing since 10-20. Every hourly run asks the same 60
  securities, Tiingo answers each with no actions (`none: 60`), and the report is identical. The
  handler records nothing for an empty answer: its comment says the view's 30-day `as_of` window
  stops a re-ask, but a security with no actions has no row for that window to see, and the
  `if (none > 0 …) {}` block is empty. Once the weight-ordered head was 60 companies with no splits
  or dividends in five years, the queue froze. 1,031 of the 1,035 have never had an answer. This is
  the seventh head-of-line stall in this file's history of them.
- **The parity check decision 9 asks for, run against Yahoo's stored chart documents** (read-only,
  a throwaway container of image `730edfde…`, `facets.actions.merge` over `raw_price_chart`), over
  all 388 securities Tiingo covers:

  | | Tiingo rows | Yahoo, same day and value | same day, other value | within 5 days | Tiingo only | outside Yahoo's span |
  |---|---|---|---|---|---|---|
  | dividends | 6,823 | 5,828 | 732 | 141 | 80 | 42 |
  | splits | 91 | 80 | 0 | 0 | 11 | 0 |

  Yahoo also states 202 dividends and 6 splits in that window that Tiingo lacks. The table alone
  could not say this: `security_corporate_action` is keyed `(security, ex_date, kind)` with no
  provider, and the Yahoo writer never replaces a Tiingo row (`only_replacing`), so on a day both
  state only Tiingo's row exists.
- **The 732 are split adjustment.** Yahoo's dividends are split-adjusted, like its closes; Tiingo's
  are as paid. Value ratios cluster at split factors: 2.0 (73), 10.0 (58), 4.0 (24), 0.1 (40, reverse
  splits). For example AVGO 2021-06-21: Tiingo 3.60, Yahoo 0.36, against a stored close of 46.46.
  84 securities are affected.
- **They break total returns.** `security_return` reinvests `(close + dividend) / previous close`
  over split-adjusted closes, so a pre-split dividend counts ten times over. Served on 2026-10-25:
  AVGO 5y **total +1,140.7% against price +527.2%** (a 613-point gap), 3y +330.4 against +274.9;
  MCHP 5y +10.5 against −0.9. AAPL (+5.9) and MSFT (+7.1) are plausible.
- **The rest of Tiingo's own rows are mostly not dividends Yahoo missed.** The 11 Tiingo-only
  "splits" are distributions of 1.01–1.05 (Tencent's 1.03 in 2022). Tiingo-only dividends include
  DHR's 28.19 on 2023-10-02, which is the Veralto spin-off, and VIV's monthly ADR distributions, which
  are probably real.

## What to decide

1. **Retire Tiingo now** (decision 9's condition is met): `security-corporate-actions` answers 410
   with a `-- RETIRES:` marker, its cron row is disabled, and `pending_corporate_actions` is
   dropped, which also clears the alert.
2. **And its rows**, one of:
   - **(recommended) let Yahoo's rows replace Tiingo's on every day Yahoo states**, by deleting the
     Tiingo rows Yahoo's documents cover and replaying `yahoo_corporate_action` stage 2 over the 388
     partitions (no provider request). The 133 rows Yahoo does not cover (80 Tiingo-only and 42
     out-of-span dividends, 11 "splits") stay until the contract, then `security_return` re-derives. AVGO's 5y total return comes back near its price
     return plus its yield;
   - delete every Tiingo row (also drops the 80 Tiingo-only dividends, VIV's among them);
   - keep them, and put the provider in the key so both are stored (the Phase 5 guideline), with the
     return reader choosing Yahoo. That is a model change for the price family.

The nightly backup holds the rows either way.

## Done when

`security-corporate-actions` answers 410, `pending_corporate_actions` is gone, no stored dividend
disagrees with Yahoo's documents on a day they cover, and AVGO's served 5y total return is within a
few points of its price return plus its dividends.
