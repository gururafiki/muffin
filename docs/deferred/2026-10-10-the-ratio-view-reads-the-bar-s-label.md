# The ratio view takes its quote currency from the bar

Created 2026-10-10 · Due after the first chart rotation (about 2026-10-16) and the `GBX` deploy ·
Status: open

## Why it is deferred

`security_ratio_series.quote_currency` comes from `security.currency_code`, which is the currency of
a line a US fund holds or a metrics response's reporting currency, not the quote currency of the
line the price lane prices. Since muffin-ingest#104 each bar carries the currency Yahoo states for
its line, so the view should read the bar's label. A bar with no label then gets no ratio: a gap
instead of a point 100 times out.

It cannot switch yet. Until a security's first chart visit, its bars still carry the old guessed
label. Measured 2026-10-10 over 12,021 equities with a bar in 30 days, **527 newest bars disagree
with `security.currency_code`**: bar `CNY`/security `HKD` 151, `CNY`/`USD` 70, `USD`/`CAD` 56,
`ILS`/`ILA` 49, `ZAR`/`ZAC` 45, and others. For the Tel Aviv and Johannesburg rows the guessed bar
label is the wrong one (agorot and cents quoted as shekels and rand), so switching before the
relabel would make about a hundred P/Es a hundred times worse. London also needs `GBX`
(muffin-deployment#426), or its bars stay unlabelled and its ratios become gaps.

## Context

- Spec §3 (the ratio view takes the bar's label) and §7:
  [the price lane reads the quote currency](../specs/2026-10-06-the-price-lane-reads-the-quote-currency.md).
- Nothing else reads `price_bar.currency_code` today (checked 2026-10-10: `price_series` exposes no
  currency, and `coverage_current` uses `price_bar` for existence only).
- The view: `muffin-deployment/stack/supabase/schemas/0117-security_ratio_series.sql`, where both
  `quote_currency` lines read `s.currency_code`.

## What to do

1. Confirm the rotation is complete. Every equity with a bar in the last week should have a
   `raw_price_chart` partition, and `labels_changed` in the nightly `price_bar_history` metadata
   should have fallen to about 0.
2. Confirm `GBX` is in `market.currency` on the node.
3. In muffin-deployment, change `quote_currency` to the bar's `currency_code` through a migration and
   the matching `schemas/` file, and add a behaviour test where the bar's label and the security's
   column disagree.
4. Re-measure as `anon` with `check_anon_read_latency.py` (best of three), and read a London, a Tel
   Aviv and a Kuwaiti stock's P/E chart in the app.

## Done when

The view reads the bar's label, a bar with none yields no ratio, and the sampled P/Es are right.
