# The US directory stops at 15,000 listings, and the check says it finished

Created 2026-09-27 · Decided 2026-10-04: **NYSE Arca for new US listings, and REIT, depositary
receipt and partnership walks on every venue** (see "Decision" at the end) · Status: built —
muffin-deployment#412 deployed 2026-10-03 23:49 UTC, muffin-ingest#92 to roll after the 00:00 lanes.
Closing criteria: "Done when" below, measured after the first full walk.

## What happened

The OpenFIGI venue sweep walked the `US` composite code to its last page, and
`venue_sweep_reached_its_last_page` passed. But the walk holds **15,000 of the 20,096** listings the
provider reports:

- the first page's `total` is 20,096 and the sweep stored 150 pages of 100;
- page 150 carries no `next` cursor, which is what the check reads, so it passes;
- OpenFIGI documents the limit: "Max Results: 15,000" per `/v3/filter` query, with or without a key.

The cursor is signed and counts pages. Page 149's `next` decodes to `AoEs` + base64 of the last
FIGI + ` 149`, then a `.` and a signature. So there is no way to resume past the cap; the query has
to be narrower.

Results come back **ordered by FIGI**. So the cap drops the NEWEST FIGIs, every US line above
`BBG013JYT8V4`: roughly every US listing created since 2022. Among them are BellRing Brands (BRBR),
Loar (LOAR), Paramount Skydance (PSKY) and Sharplink (SBET), all tracked securities with no US line
in the directory.

Only the US is affected. Of the 59 venues, one other stopped short of its total: `GR` at 14,202 of
14,205, which is drift between pages.

## Why it matters

Measured 2026-09-27:

- **443 of 2,812** tracked US equities that hold a share class have no US line in the directory;
  279 have no line at all;
- `market.untracked_listing`, the Markets search's "listed, not tracked", cannot offer any US
  company listed since about 2022;
- Stage 2b's `security_listing` derivation finds no US line for those 443, so their primary listing
  cannot be derived. Stage 2c's compatibility view needs one.
- Stage 4 promotion from the directory would never reach a new US IPO.

## The sizes of the documented splits

Measured 2026-09-27, `securityType2: Common Stock`, the first page's `total`:

| Query | Total |
|---|---|
| `exchCode: US` (composite) | 20,096 |
| `US` + `securityType: Common Stock` | 20,030 |
| `US` + `currency: USD` | 20,099 |
| `UV` (OTC) | 15,334 |
| `UV` + `securityType: Common Stock` | 15,261 |
| `UN` (NYSE) | 5,611 |
| `UA` (NYSE American) | 5,532 |
| `UP` (NYSE Arca) | 5,540 |
| `UF` (Cboe BZX) | 5,522 |
| `UW` / `UQ` / `UR` (Nasdaq tiers) | 1,320 / 860 / 1,737 |

`UN`, `UA`, `UP` and `UF` are each about the whole exchange-listed US common-stock universe (~5.5k),
because every NMS stock trades on every one of those venues under unlisted trading privileges. So
**one of them, swept on its own, covers every exchange-listed US common stock, new IPOs included, in
~56 pages.** OTC cannot be enumerated: it exceeds the cap on its own, and no documented filter
narrows it further.

Each local line carries `compositeFIGI`, the composite `US` line's FIGI.

## Options

1. **Add one unlisted-trading venue (`UP` or `UF`), mapped to the composite line in stage 2**
   (recommended).
   - Raw keeps the local lines whole.
   - Stage 2 emits a `US` row per local line: `figi = compositeFIGI`, the same ticker, name and
     share class. The composite sweep's own rows win where both exist.
   - The directory stays at composite grain, which is all the model knows (`market.exchange` has
     one US row).
   - Still missing: OTC lines with a FIGI past the cap. They are mostly thin OTC foreign-ordinary
     lines (`GNGBF`) of companies already reachable on their home venue.
   - Cost: ~56 pages a week.
   - Needs a way to sweep a code that is not a `market.exchange` row, because a second US row
     would change every rule that picks "the" US venue. Either a partition outside the exchange
     table, or a `sweep_codes` column on the `US` row.
2. **Replace the composite `US` sweep with the listed local codes**, dropping OTC entirely. This
   loses every OTC line, including OTC-only US companies, and changes the FIGIs of US lines already
   written.
3. **Accept the cap.** Record that the directory does not reach newer US listings and leave search
   and promotion without them.

## Done when

- A capped walk is named, and reads as covered only when an alias covering it has finished its own
  walk. Since 2026-10-04 that verdict is its own check, `directory_query_within_the_cap`, so
  `venue_sweep_reached_its_last_page` names only walks a resume can help. "No cursor left" is not
  "finished" when the provider stopped issuing cursors at its cap.
- BRBR, LOAR, PSKY and SBET each have a `US` line in `market.venue_listing` (via `US.arca`), and so
  do PLD (`US.reit`), the TSM ADR (`US.dr`) and ET (`US.partnership`); the 443 falls to ~0.

## Re-checked 2026-10-03, at the user's request

The question was whether OpenFIGI can page past 15,000, or filter by date. **It cannot:**

- **Pages.** The documentation states 15,000 results per query, 150 pages of 100. The cursor is
  signed and counts pages.
- **Dates.** The only date ranges, `expiration` and `maturity`, are for options, futures and bonds.
  Results are listed "alphabetically by FIGI", so the cap drops the newest.

What does work is asking smaller questions. Measured 2026-10-03:

| Split | Result |
|---|---|
| `stateCode` (the issuer's home state; 142 values incl. Canadian, Japanese, Chinese) | 127 codes hold 14,261 of 20,098 US lines, the largest CA 1,511. **But new listings carry none:** BellRing is not among MO's 59 lines, nor Sharplink among MN's 107. Rejected. |
| `micCode` | Cannot be combined with `exchCode` ("Cannot have both exchCode and micCode"); alone it is no partition (XNYS 37,888, XNAS 0). Rejected. |
| `includeUnlistedEquities: true` | 110,986. Wider, not narrower. |
| `UP` (NYSE Arca), Common Stock | 5,541 lines, 56 pages; 1,466 US composite lines the directory lacks. BellRing's Arca line `BBG0154FBJJ5` names `BBG013QNJHP8`, the composite, as its `compositeFIGI`. |

**The cap was the smaller half.** The 533 tracked equities with a legacy US primary and no derived US
line (505 with a share class) break down, by mapping each share class to all its lines:

| Cause | Securities |
|---|---|
| Exchange-listed, composite past the cap (recovered by Arca) | 201 |
| On NYSE Arca, composite **inside** the cap but absent: REITs (Tanger, Brixmor, SL Green, PECO) | 152 |
| Depositary receipts (ABEV, BBD, BSAC, CIB, PDD, EDN…) | 86 |
| OTC only, composite past the cap (mostly Singapore REIT/foreign-ordinary lines) | 26 |
| OTC only, composite absent (Singapore REITs: ACIRF, FRLOF, KPLIF…) | 23 |
| No US line visible (XOM, EA, AVB: the probe's mapping truncated their lines; not a finding) | 11 |
| Composite-only lines (money-market funds GVMXX, BISXX) | 6 |

`securityType2` is a vocabulary of its own, and the sweep asks only for `Common Stock`, on every
venue. `REIT` is separate (US 435 lines, London 154, Singapore 39, Toronto 42), and so are
`Depositary Receipt` (US 2,719, London 139) and `Partnership Shares` (US 52: AB, BIP, IEP). The
directory held 99,459 rows, all `Common Stock`; PLD, AMT, O, SPG, ET, EPD, MPLX, BIP, TSM, BABA and
NVO were all absent, and AAPL present.

## Decision (user, 2026-10-04)

**NYSE Arca for new US listings, and REIT, depositary receipt and partnership walks on every venue.**
About 270 more requests a week (~15 minutes keyed). Expected to recover ~460 of the 505.

Still missed: the 26 foreign OTC lines past the cap (no filter reaches them; their companies are
reachable on their home exchange), and the composite-only money-market lines.

Not taken: `Unit`. Toronto has 39 income-trust units, but the type also holds SPAC units elsewhere,
so it would need a per-venue rule.
