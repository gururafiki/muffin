# What the dead-symbol repair cannot reach

## Why

Stage 3b (muffin-ingest#100) went live on 2026-10-05. It lets the symbology ladder replace a symbol
the price lane rejected alone, and it never re-proposes the dead one. Its first live run, and a
replay of stage 2 over the stored answers for every other dead symbol, show that it repairs
**nothing real today**. The mechanism works; the answers it is offered do not.

Live subset (backfill `yokgirsk`, 7 dead subjects, both rungs and stage 2, 7 runs SUCCESS):
- OpenFIGI repeated each dead spelling, so nothing was proposed.
- Yahoo, asked by ISIN, missed all 7.
- The one "repair" was BDMS: `BDMS-F.BK` became `BDMS/F.BK`, the same Thai foreign-board line in
  Bloomberg notation, which also returns 404 on Yahoo.

Replay over the other 261, with no provider call: 259 get no proposal, and 2 more get the same
notation churn (`3BBIF-F.BK`, `BLA-F.BK`). The churn is bounded. The next sweep records the new
spelling's death, OpenFIGI repeats it, and it is excluded.

## The dead symbols, by cause

262 on 2026-10-04. Suffix counts are exact; a cause is "verified" only where Yahoo was asked.

| Cause | Count | Example | Verified |
|---|---|---|---|
| Venue outside keyless yfinance (`.PS`, `.AE`, `.VN`) | 82 | ICT.PS | earlier (CLAUDE.md) |
| TPEx line asked as `.TW` | 100 | GlobalWafers `6488` | [own note](2026-10-04-taiwan-s-tpex-lines-are-filed-under-tt.md) |
| Thai foreign-board share class (`-F`, `/F`) | 15 | BDMS: both spellings 404; main board `BDMS.BK` and NVDR `BDMS-R.BK` trade at THB 19.0 | BDMS |
| Primary market abroad: a Swiss-domiciled company that trades in the US or London | 7 | Garmin (`GRMN.SW` dead, `GRMN` live), Coca-Cola HBC (`CCH.L` live) | Garmin, CCH |
| Another spelling or venue of the same line | several | `ANDINAB.SN` → `ANDINA-B.SN`; enCore `EU.TO` → `EU.V` (TSXV); Bright Minds `DRUG.TO` → `DRUG.CN` (CSE) | those three |
| Probably delisted, suspended, or a superseded instrument | the rest | Hino Motors `7205.T`; Keyera's subscription receipts (the ordinary line `KEY.TO` is a different ISIN) | not per symbol |

## Context

- muffin-ingest#100. `plan_symbols` compares the dead symbol literally, so a re-spelling of the same
  line is a new candidate (BDMS).
- `pick_local_symbol` builds `ticker + suffix` from OpenFIGI's Bloomberg ticker (`BDMS/F`, `BRK/B`).
  Yahoo never uses `/`.
- `pick_home_listing` accepts a Yahoo hit only on the security's own country's venues, so it refuses
  Garmin's NYSE line and Coca-Cola HBC's London one.
- `market.exchange` knows no TSXV (`.V`), no CSE (`.CN`) and no `.TWO`.
- CLAUDE.md: "a wrong name is not a missing security", and "never pattern-match and rewrite". Generate
  candidates, verify each against the provider, adopt only what answers.

## Options (decisions for the user)

1. **TPEx first** (100 of the reachable ones). See its own note.
2. **Provider-verified spelling candidates** for a dead symbol (the TPEx note's option 3, generalised).
   - Generate a few candidates: `/` to `-`, a Yahoo share-class hyphen, the country's other venues
     (`.V`, `.CN`).
   - Ask Yahoo for each, one chart request, and adopt only one that answers.
   - Covers the spelling and venue rows. It spends a few requests per dead symbol, once per death.
3. **Primary abroad.** When the home line is dead, let the derived primary listing
   (`security_listing.is_primary`, Stage 2b-ii) name the line to price. That is Garmin's NYSE line,
   or Coca-Cola HBC's London one. This is a ladder rule, not a spelling.
4. **Thai foreign boards.** Either accept that Yahoo cannot price them, or price the share class off
   its main-board line. That is a proxy: the foreign board can trade at a premium when the foreign
   ownership limit binds, so the proxy must be labelled as one.

## What to do

1. Decide 2, 3 and 4 (TPEx has its own note). The recommended order by yield is TPEx, then 2, then 3.
   4 is lowest.
2. After each, re-run `security_symbology` over the affected subjects (stage 2 only where raw
   already holds the answer), then read the price lane's `yfinance` probes on its next pass.

## Done when

Every dead symbol is either repaired, or carries a cause a person has accepted (an honest venue gap,
a delisting).
