# Taiwan's TPEx lines are filed under `TT`, and we price them as `.TW`

## Why

Taiwan has two stock markets. The Taiwan Stock Exchange (TWSE, MIC `XTAI`) is spelled `.TW` on
Yahoo, and the Taipei Exchange (TPEx, formerly GreTai, MIC `ROCO`) is spelled `.TWO`. OpenFIGI
files **both under exchange code `TT`**. `market.exchange` maps `TT` to `.TW` only, so every TPEx
security this pipeline knows is asked for under a spelling Yahoo does not serve.

Measured 2026-10-04 from the local rung's stored OpenFIGI answers, one file at a time. Of the 527
Taiwanese equities holding a yfinance symbol:

| OpenFIGI's label on the `TT` line | Price lane rejected it alone | Not judged yet (3a rolled 10-04) |
|---|---|---|
| `TT (Taipei Stock Exchange)`, i.e. TPEx | **100** | 3 |
| `TT (Taiwan Stock Exchange)`, i.e. TWSE | 1 | 422 |

So the TPEx label explains 100 of the 101 dead `.TW` symbols. GlobalWafers (`6488`) is among them.

**The discriminator is already in raw, and stage 2 discards it.** The mapping answer's `exchCode` is
the string `TT (Taipei Stock Exchange)`, and `pick_local_symbol` strips the label (`split(' (')`) on
purpose, because OpenFIGI labels codes inconsistently (Samsung `KS`, TSMC `TT (Taiwan Stock
Exchange)`). The directory confirms OpenFIGI separates the two markets: `/v3/filter` with
`micCode: ROCO` returns 1,427 common stocks, all labelled Taipei, and `micCode: XTAI` returns
1,090, all labelled Taiwan.

Stage 3b (muffin-ingest#100) cannot repair these on its own: OpenFIGI's pick is the same dead
`.TW`, and Yahoo's `.TWO` fails `pick_home_listing`'s suffix test, because `market.exchange` knows
no `.TWO`.

## Context

- muffin-ingest#100 (Stage 3b): the ladder may replace a dead held symbol and never re-proposes it.
- `facets/symbology.py`: `pick_local_symbol`, `pick_home_listing`, `_venues`.
- The venue directory (`venue_listing`, stage 2 of the OpenFIGI sweep) applies the same suffix, so
  untracked TPEx listings carry `.TW` too. A Stage 4 promotion wave would mint them already dead.

## Options (decision for the user)

1. **A labelled-venue control table** (recommended for now). `market.exchange_label (exch_code,
   label, country_iso2, suffix)`, seeded with `('TT', 'Taipei Stock Exchange', 'TW', '.TWO')`. The
   ladder's local pick and the directory's stage 2 read a labelled match before falling back to
   `market.exchange`. Small, exact, one row today. Repairs the 100 by re-parsing raw already on
   disk, with zero provider calls; the price lane then verifies each.
2. **MIC as the venue key.** ISO 10383 MIC is the standard venue identifier, and OpenFIGI's
   directory can be walked by MIC (`ROCO` answers). This is the right long-term model if more
   codes turn out to be shared, but it re-keys `market.exchange`, the directory queries and every
   FK on the exchange code.
3. **Verify spelling candidates against the provider.** When `.TW` is dead, try `.TWO` (and other
   known variants, such as Hong Kong's zero padding) with one yfinance request each. This needs no
   model change, but it spends the price sweep's budget, and it fixes neither the directory nor
   promotion.

## What to do

1. Decide between the options.
2. Implement, then re-derive with no provider call: backfill `security_symbology` over the Taiwanese
   subjects, and the directory's stage 2 over the `TT` partitions.
3. Check: the 100 hold `.TWO`, and the price lane answers for them on its next pass (yfinance `hit`
   probes).

## Done when

No Taiwanese security holds a `.TW` symbol that OpenFIGI labels as Taipei, and the directory offers
TPEx listings under `.TWO`.
