# The ratio view takes its quote currency from the bar

Created 2026-10-10 · Due after the first chart rotation (about 2026-10-16) and the `GBX` deploy ·
Status: **merged in muffin-deployment#433 (2026-10-16), deploys with #426 and #428**

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

## Built (2026-10-16)

- **Step 1, measured:** all 11,542 securities with a bar in the last week have a `raw_price_chart`
  partition, and `labels_changed` ran 374, 205, 121, 367 and 228 over the first five nights, then 0
  on 10-16, the first night of the second rotation.
- **Step 2 is not met and does not need to be first.** `GBX` arrives with #426 in the same deploy.
  Ten large London lines checked serve no price ratio at all today (no TTM, and half-year balance
  sheets are read only from #428), and #428 would make them appear a hundred times out under the
  old rule. Deploying the switch with #426 and #428 leaves London as gaps until each line's next
  chart visit labels its bars `GBX` (about five nights), then right.
- **Who it moves,** over the 12,006 securities with a bar in the last 14 days: 11,109 unchanged,
  493 change quote currency, 150 gain one, 248 lose it (238 London, 7 Lima, 1 Bangkok, 8 US OTC).
- **Step 3:** muffin-deployment#433. Both arms read `price_bar.currency_code`; a new behaviour test
  makes the rules disagree on both grains, and reverting either arm fails it. CI's migrations job
  was replayed on the node: the bundle matches, and 107 of 107 tests pass.
- **Step 4** waits on the deploy.

## Deployed (2026-10-16/17)

- **Live 2026-10-16 19:06 UTC**, in the same deploy as #426 (`GBX`) and #428.
- **Step 4's latency check found every P/E read timing out for anon (`57014`), 25 minutes after the
  deploy.** The label switch did not cause it. The view's spans ran `lead()` over all of
  `security_metric`, so the symbol filter stopped at the window. #428's fiscal-year fallback and the
  TTM re-derivation pushed that past the ceiling. Fixed in muffin-deployment#437, deployed
  2026-10-17 14:45 UTC. As anon afterwards: daily 852 ms, weekly 1,154 ms, SAP.DE 775 ms, and all
  23 probes ok (timed from a laptop, network included).
- **Sampled P/Es, newest daily bar, 2026-10-17:**
  - ALG.KW 11.09 (12,305 before), AZRG.TA 22.72 (2,547 before), NBK.KW 13.49, AMRM.TA 18.48;
  - DOM.L 15.41, which is 231.2p ÷ (£0.15 × 100).
- **London relabels as the rotation visits it.** 25 of the 238 London lines carried `GBX` after the
  first night. VOD.L, SHEL.L and AZN.L were not yet visited, so they serve no P/E: a gap, as
  designed.
- **Left:** reading the charts in the app. That rides with muffin-ui#137's render check.

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
