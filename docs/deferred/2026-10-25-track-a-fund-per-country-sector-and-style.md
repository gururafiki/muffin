# Track a fund per country, per sector, per country and sector, and per style

Created 2026-10-25 · Status: **decided (the user), not yet planned**

## The decision

The user, 2026-10-25: "track at least one ETF per sector in each country (+ per growth/value if
exists) and per each country/sector." So the tracked set should cover, where a fund exists:
- every country, with a country fund;
- every sector, with a sector fund;
- every (country, sector) pair;
- growth and value, per country and globally.

## What is tracked today (measured 2026-10-25, 74 enabled)

| Kind | Count | Funds |
|---|---|---|
| country | 44 | iShares MSCI country ETFs, one per country (`EWJ`=JP, `MCHI`=CN, `IVV`=US, …) |
| sector | 11 | the US Select Sector SPDRs (`XLK`, `XLF`, …): **US sectors only** |
| group | 8 | regions and broad markets (`EEM`, `VWO`, `VEA`, `IEUR`, `EPP`, `ILF`, `URTH`, `EEMA`) |
| other | 11 | bonds (`AGG`, `LQD`, `HYG`, `EMB`, `TIP`), US style and size (`IWF` growth, `IWD` value, `IWM`, `RSP`), themes (`SMH`, `ICLN`) |

So: countries are covered; sectors only for the US; style only for the US large caps; no
(country, sector) pair outside the US.

## The constraint that bounds it

Holdings come from SEC **N-PORT**, which only **US-registered** funds file. Most country-sector
ETFs are listed abroad (iShares' Canadian sector ETFs, UCITS sector ETFs in Europe) and file no
N-PORT, so "at least one per pair" is "at least one per pair that a US-registered fund covers".
`market-add-fund` already records the check that stops adding a fund that can never be ingested.

## What the plan has to decide (options to bring to the user)

- **Finding candidates.** About 6,664 US ETPs are catalogued from OpenFIGI. Classifying them by
  name is a guess ("find the data source"); classifying them by their own holdings is a
  measurement, but needs one N-PORT fetch per candidate.
- **Classifying a fund.** By the concentration of its holdings in one country, one sector, or one
  style bucket, for example 80% of weight. Which of several funds covering one cell to keep
  (largest by assets, oldest, cheapest).
- **The budget.** Each tracked fund is a filing a quarter, plus the new securities its holdings
  bring into every downstream backlog. Global sector funds (iShares Global sector ETFs) and
  developed or emerging style funds are the likely additions; pure country-sector pairs outside the
  US will mostly be empty.
- **Serving.** The country × sector views must say which cells have a fund behind them and which
  are derived from broader funds.

## Done when

Every cell that a US-registered fund covers has a tracked fund, and the cells that none covers are
listed as such.
