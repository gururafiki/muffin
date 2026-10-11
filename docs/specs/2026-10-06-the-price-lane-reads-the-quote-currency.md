# The price lane reads the quote currency

Decided 2026-10-06: own the Yahoo fetch
([note](../deferred/2026-10-05-a-price-bar-s-currency-is-not-its-quote-currency.md), option 1). This
spec plans it. **The decisions in §10 were taken on 2026-10-10, all as recommended, and this spec
became Stage 0 of [Phase 4](2026-10-10-yahoo-company-data.md).**

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

**Taken 2026-10-10 (the user), each as recommended:** 1 a new `raw_price_chart`; 2 a security's
first visit is a full load; 3 (a) bars before a unit change stay unlabelled; 4 subunits as data
later, as its own note; 5 today's pacing. The options as presented:

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

**Decision 5 amended 2026-10-11 (the user).** The 1.4 s in §4 was not today's rate. It divided
the night's time less stage 2, so it included each run's start-up. The old stage-1 step took
1,578 s for ~2,450 securities, about 0.64 s each. So the lane shipped at ~45% of the old rate, and
its first night took 134 minutes against 96. The user kept 1.4 s: the cost is time only, and the
company lane (Phase 4) adds ~2,400 Yahoo requests a day beside it.
[Note](../deferred/2026-10-11-the-chart-lane-asks-at-less-than-half-the-old-rate.md).

## 11. As built — 2026-10-10

**Ingest: muffin-ingest#104, rolled 2026-10-10 19:52 UTC. Schema: muffin-deployment#426 (`GBX`),
open until a deploy is possible (the Cloudflare token).**

### What the build found that this spec did not say

- **`range=max` is not daily, so a full load is `period1=0`.** Measured from the node: with
  `interval=1d`, `range=max` returned AAPL at `dataGranularity: 3mo` (169 points since 1984), VOD.L at
  `3mo`, NPN.JO at `1mo` and AMRM.TA at `1wk`. `period1=0&period2=<today 00:00 UTC>` returned AAPL's
  11,549 daily bars, every one on a date the openbb history also holds, closes within 5e-15. Stage 2
  refuses any body whose `dataGranularity` is not `1d`. §4 said "a full load keeps `range=max`";
  that would have stored a quarterly close as a daily bar.
- **The stored histories were split-adjusted only by accident.** Yahoo's `close` is split-adjusted,
  and an extension re-reads a week. The openbb lane's histories were adjusted all the same (checked
  on APH, SFBS, 7649.T, TDPOWERSYS.BO and RUSHA across their 2026 splits) because each batch shared
  one window: one security with an old watermark dragged the whole batch's re-read back months.
  Per-security windows end that, so two rules replace it, both costing bytes, never requests:
  - an extension whose body carries a **split dated on or after the stored full load** reloads the
    whole history in the same run;
  - a full load **90 days old** is reloaded at the next visit, which also bounds the file.
- **A change of unit and a bounce differ in whether they are undone.** Over two years of `price_bar`:
  96 steps above 5x in 57 series, 35 near 100x and 1 near 1,000x.
  - The persistent ones were Tel Aviv on 2026-05-18 (96.6x to 102.6x, four lines), DIA.MC 1,029.9x,
    BCG.L on 2026-08-24, and HOME.L's longer swings between pence and pounds.
  - The rest were undone within 1 to 6 bars: six Johannesburg lines on 2025-01-10, SBK.JO,
    300276.SZ, XPML11.SA, and ROSE.L's week-long swings in 2025 and 2026.

  So a subunit-sized step (within 1.25x of 100 or 1,000) undone by the opposite step within 10 bars
  is a bounce, and its bars carry no label. One that stands is a change of unit, and the bars before
  the newest one carry no label (decision 3a).
- **Holiday filler is retracted.** The newest document is the provider's answer for its span, so a
  stored bar on a date it lacks is removed (`prices.retract_bars_absent_from_raw`, unchanged). The
  first visits found the openbb lane's holiday rows: zero volume, the close carried from the session
  before. ALG.KW lost 6 (Eid al-Adha 05-27/28 and others) and AMRM.TA 9 (Yom Kippur 09-21, the
  Sukkot eves). Yahoo's own zero-volume sessions stay.
- **The order of the two halves is free.** A label is given only when `market.currency` holds the
  code, and the FX lane derives a subunit only when the table holds it. Without the second rule, FX
  would have derived `GBX` rates and failed every rate's write on the foreign key until the
  migration deployed. Until `GBX` deploys, London bars are unlabelled, which nothing reads yet.
- **The ratio view waits for the relabel**
  ([note](../deferred/2026-10-10-the-ratio-view-reads-the-bar-s-label.md)). On 2026-10-10, 527 newest
  bars disagreed with `security.currency_code`, and for Tel Aviv and Johannesburg the bar's old guess
  was the wrong one. Switching first would have made about a hundred P/Es a hundred times worse.

### Proven

- **Offline:** 14 of 14 rule deletions caught by the tests, over ten captured bodies
  (`tests/fixtures/capture.md`).
- **On the node, read-only:** the branch's own assets over AAPL, VOD.L, ALG.KW and AMRM.TA for two
  nights, every write intercepted. Night 1 made 4 full loads and 22,820 bars, with closes equal to
  the stored ones; night 2 extended all four.
- **Live:** the real `nightly_prices` job ran once each for ALG.KW, AMRM.TA and AAPL, all succeeded,
  and the label check found no disagreement.
  - **ALG.KW:** 1,038 bars `KWD → KWF`, 6 retracted.
  - **AMRM.TA:** 97 bars `ILA` from 05-18 and 404 unlabelled before it, 9 retracted.
  - **AAPL:** `changed 3`, the three new days only.
- **Tonight's tick (2026-10-11):** dry-run on the deployed code, 100 runs, continuing the rotation.

### Left

- Deploy `GBX` (muffin-deployment#426). Then re-run `fx_rate_history` for `GBP` (stage 2 only),
  so pence gets the pound's history.
- The ratio view reads the bar's label after one rotation:
  [note](../deferred/2026-10-10-the-ratio-view-reads-the-bar-s-label.md).
- Drop the openbb raw after two clean rotations:
  [note](../deferred/2026-10-10-the-openbb-price-raw-is-the-rollback.md).
- Subunits as data (decision 4): [note](../deferred/2026-10-10-subunits-are-data-not-a-dict.md).
- Price-chart bodies in http-cache:
  [note](../deferred/2026-10-10-http-cache-keeps-every-yahoo-chart-for-a-year.md).
