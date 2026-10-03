# The US directory stops at 15,000 listings, and the check says it finished

Created 2026-09-27 · **Decide before Stage 2c** (the listing swap) and before Stage 4 (promotion) ·
Status: open, needs a decision.

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

- `venue_sweep_reached_its_last_page` fails, naming the venue, when the stored rows fall short of the
  provider's `total` by more than drift (a few rows). "No cursor left" is not "finished" when the
  provider stopped issuing cursors at its cap.
- BRBR, LOAR, PSKY and SBET each have a `US` line in `market.venue_listing`, and the 443 falls to
  ~0.
