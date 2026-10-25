# A listing Yahoo answers with one point keeps its openbb bar's label

Created 2026-10-25 · Status: **decided 2026-10-25 (the user): mark them dead, so they leave the rotation and the symbology repair looks for a live line; relabel their stored bars with the currency Yahoo's document states**

## What was found

Reading the price lane's checks before dropping `raw_price_history`:
`a_bar_s_label_is_its_listing_s` (WARN) failed 13 of 1,403 evaluations between 2026-10-11 and
10-24. Every failure named one of the same five securities, once per rotation visit.

| Listing | Newest stored bar | Its label | Yahoo's chart answer |
|---|---|---|---|
| Picton Property Income, PCTN.L | 2026-09-10 | GBP | one point, 2026-09-09, `GBp` |
| TMBThanachart NVDR, TTB-R.BK | 2026-10-08 | none | one point, 2026-10-22, `THB` |
| Sichuan Kelun-Biotech, SKBHF | 2026-06-08 | CNY | one point, 2026-06-08, `USD` |
| JTC PLC, JTCPF | 2026-08-21 | GBP | one point, 2026-08-21, `USD` |
| Orla Mining, OLA.TO | 2026-08-05 | USD | one point, 2026-08-04, `CAD` |

- Yahoo answers each listing with a single point, stamped at its `regularMarketTime`.
- None of the five has a bar in the last 14 days.
- Their newest stored bar is an openbb bar, carrying the guessed label the chart lane exists to
  replace: GBP for pence, USD for Canadian dollars, none for baht.
- Measured over the 12,072 asked equities on 2026-10-25: 11,998 have a bar within 14 days, 33 are
  15–60 days stale and 41 more than 60 days. The five are among the 74.

## Why the label is not corrected (unverified)

The likely reason is that stage 2 publishes nothing from these documents. The one point is a quote
stamped at `regularMarketTime`, and the lane drops a live quote rather than storing it as a bar
(CLAUDE.md, "A LIVE QUOTE CAN SHARE ITS DATE WITH A COMPLETED BAR"). With nothing published,
nothing relabels or retracts the openbb bar. This has not been checked against the stage-2 code.

## What to decide

1. Is a listing Yahoo answers only with a quote a dead listing, to be recorded as such and left
   out of the rotation, or does it keep being asked?
2. Should its last openbb bars go, keep their wrong label, or be relabelled from the document's
   currency without a bar to publish?
3. Should the check skip a security whose newest document holds no bar, so it stops warning on
   the same five?

## Done when

The five (and the rest of the 74) are either current, recorded as no longer trading, or carry the
label their own documents state, and `a_bar_s_label_is_its_listing_s` passes across a rotation.
