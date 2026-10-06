# The price lane reads the quote currency

Decided 2026-10-06: own the Yahoo fetch
([note](../deferred/2026-10-05-a-price-bar-s-currency-is-not-its-quote-currency.md), option 1). This
spec plans it. It changes no code until the decisions in §10 are taken.

## 1. What exists, measured 2026-10-06

**The label is a guess.** `prices.currency_by_security` labels every bar with the primary listing's
currency, falling back to `security.currency_code`. That column holds the currency of a line a US
fund holds (N-PORT) or the metrics response's *reporting* currency. Neither is the currency of the
line the lane prices. The ratio view does not even read the bar's label:
`security_ratio_series.quote_currency` comes from `security.currency_code`.

**Seven of thirteen sampled labels are wrong.** One listing per currency class, Yahoo's
`meta.currency` against the stored label:

| Listing | Stored label | Yahoo says | Off by |
|---|---|---|---|
| VOD.L | EUR | GBp | not even the right currency |
| SHEL.L | GBP | GBp | 100× |
| AZRG.TA | ILS | ILA | 100× |
| ALG.KW | KWD | KWF | 1,000× |
| 0992.HK | USD | HKD | 7.8× |
| CSU.TO | USD | CAD | 1.4× |
| GRUMAB.MX | USD | MXN | 18× |
| AAPL, NPN.JO, 2330.TW, 7203.T, BHP.AX, SAP.DE | right | (same) | — |

The sample was chosen to include the suspect classes, so it is not a rate. The earlier note
estimates ~83 wrong among the 3,689 securities that have a P/E.

**The closes do not change.** On every overlapping date, for all thirteen, Yahoo's chart
`quote.close` equals the stored close to the cent. The lane's openbb route returns the same
split-adjusted close. Only the label is wrong.

**Owning the fetch costs no requests.** openbb's yfinance adapter already asks
`/v8/finance/chart/<ticker>` once per ticker (measured 2026-09-19: four symbols, six requests). A
direct chart request per security is the same number of requests, and it returns `meta.currency`,
the rest of the `meta` block and, on request, the dividends and splits.

**Yahoo's own label can be wrong for old bars.** `AMRM.TA` jumps 96.6× on 2026-05-18: its earlier
bars are shekels, its later ones agorot, and `meta.currency` says `ILA` for all of them. `AZRG.TA`
is agorot throughout. So a fetch's label is reliable from the most recent unit change onwards, not
necessarily before it.

**Unit changes are rare; noise is not.** In `price_bar` over two years, 135 series have a step of
more than 5× between consecutive bars, 1,417 steps in all, mostly illiquid lines bouncing. Only 32
are the size of a subunit factor: 31 near 100× and 1 near 1,000×. A rule that treats any 5× step
as a unit change would strip labels from whole histories.

**The currency table.** `market.currency` holds 43 codes, including the subunits `ILA`, `KWF` and
`ZAC`, and **no pence**. The factors live in code (`fx.SUBUNITS`), and the FX lane derives a
subunit's rates from its parent's.

**Yahoo's codes are case-sensitive.** Pence is `GBp` and cents `ZAc`. Uppercasing turns `GBp` into
`GBP`, which is 100× wrong, while `ZAc` becomes `ZAC`, which happens to be this schema's code.

## 2. Data model

- `price_bar.currency_code` keeps its meaning, the currency the close is quoted in, but it is now
  **observed**. It stays nullable: a bar with no trustworthy label gets none.
- **Pence becomes a currency:** a `GBX` row in `market.currency` and
  `fx.SUBUNITS["GBX"] = ("GBP", 100.0)`, so the FX lane derives its rates like the other subunits.
- **Yahoo's code maps to ours explicitly** (`GBp → GBX`, `ZAc → ZAC`, `ILA`, `KWF`). A three-letter
  uppercase code passes through only if `market.currency` holds it. Anything else is unlabelled and
  counted.
- **Decision 4:** should subunits become data (`parent_code`, `per_parent` columns on
  `market.currency`) rather than a dict in `fx.py`? Recommended later, as its own note: it is the
  same fact in two places, but not on this path.

## 3. Architecture

- **Stage 1, a new raw asset `raw_price_chart`** beside `raw_price_history`, on the same
  `security` grid, pool `yfinance`, `multi_run(25)`. Each fetch is stored as a `Document` row: the
  body byte for byte, plus `security_id` and `asked_symbol`, as the FX lane already does.
  - An extension appends a document.
  - A full load replaces the file.
  - A symbol change restarts the history (#99's rule).
- **Stage 2, `price_bar_history` reads the chart documents.** For each security, newest fetch wins
  per date. Each bar is labelled with the newest document's currency, unless a subunit-sized break
  separates it from that document (decision 3).
- **The changeover needs no extra requests (decision 2):** a security's first visit by the new
  lane is a full-history load instead of an extension. The sweep reaches every security in about
  five nights and asks once per ticker either way, so this costs bytes (about 1 MB rather than a
  few KB per security), not requests. After one cycle every partition has a full chart history,
  and the openbb raw becomes a backup with a drop date.
- **The ratio view takes the bar's label:** `quote_currency` comes from `price_bar.currency_code`,
  and a bar with none gets no ratio. That makes the chart show a gap instead of a point 100×
  wrong.

## 4. Low level

- `yahoo_chart.fetch` gains `period1`/`period2` (epoch seconds), because an extension's window is
  a date (`watermark − REREAD`), not one of Yahoo's range presets. A full load keeps `range=max`.
- Parameters: `interval=1d`, `includeAdjustedClose=true` and `events=div,split`. The events ride
  on the same request and are stored whole for the corporate-actions family to parse later.
- Already handled by `yahoo_chart.parse`:
  - dates in the exchange's own offset (`gmtoffset`);
  - refusing the live quote (its stamp equals `regularMarketTime`);
  - refusing null and NaN closes;
  - recognising Yahoo's 404 that names an absence.
- One symbol per request, so isolation is natural. A named absence after a healthy control is a
  `miss` probe, as now. A 429 or a transport fault is `refused` and stops the run, counting the
  rest as `unasked`.
- **Pacing:** no faster than today. The 2026-10-06 night spent about 3,500 s fetching 2,500
  securities, about 1.4 s per security, and openbb asked one or more requests for each. The direct
  lane asks exactly one per security, so pacing it at 1.4 s per request is no faster per request
  than today, and probably slower. `min_seconds_between_calls` becomes that per-request figure.
  Going faster is how this provider was lost on 2026-09-19.

## 5. Validated against the provider (so far)

- 13 listings across 11 currencies: the closes are identical and `meta.currency` is present for
  all.
- The `AMRM.TA` unit change is in Yahoo's own history.
- **Still to capture before building:**
  - fixtures for VOD.L, AMRM.TA, NPN.JO, ALG.KW and AAPL;
  - a `range=max` body for a long-lived listing, to size a full load;
  - an extension window across Kuwait's Sunday–Thursday week;
  - a request from the node through http-cache, which the FX lane already makes.

## 6. Dependencies and isolation

- The price lane no longer calls openbb. Everything goes through `yahoo_chart`, which routes via
  http-cache.
- The FX lane already runs on the same module, so a Yahoo shape change shows up in both, and both
  are fixed by one re-parse.

## 7. UI

- **Ratio charts:** the ~83 wrongly labelled securities get correct ratios, or a gap where the
  label is withheld.
- **Still to check:** whether the stock page's price axis labels its currency from
  `security.currency_code`. If it does, it moves to the bar's label in the same change.

## 8. Metrics and checks

Per run:
- `bars_unlabelled`;
- `labels_changed` (a stored label replaced by an observed one);
- `unit_breaks_found`.

A check, `a_bar_s_label_is_its_listing_s`, compares each security's newest label with its newest
document's `meta.currency`. It warns, and names the securities.

## 9. Gaps this does not close

- `security.currency_code` keeps its other meanings, and its other readers keep them too.
- `market.listing.currency_code` (Phase 4) could be filled from the same meta; that is noted, not
  done here.
- Stored bars before a subunit-sized break stay unlabelled under the recommended rule. That is 32
  breaks today.

## 10. Decisions

1. **Raw layout:** a new `raw_price_chart` storing each fetch's body (recommended), versus keeping
   openbb's rows and adding a second, currency-only request per security. The second option
   doubles requests.
2. **The changeover:** a security's first visit by the new lane is a full load (recommended: no
   extra requests, done within about five nights). The alternatives are a one-off refetch of
   12,000 histories, or labelling only bars fetched from now on.
3. **Bars before a unit change in a subunit series** (`AMRM.TA`):
   - (a) leave them unlabelled (recommended: nothing inferred, and the ratio shows a gap);
   - (b) label them with the parent currency, inferred from the size of the jump;
   - (c) take Yahoo's label for all of them, wrong before the break.
4. **Subunits as data** in `market.currency`: later, as its own note (recommended), or now.
5. **Pacing:** keep today's request rate (recommended), versus re-measuring the allowance first.
