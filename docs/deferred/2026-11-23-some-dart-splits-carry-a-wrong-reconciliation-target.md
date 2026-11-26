# Some DART splits carry a wrong reconciliation target

Created 2026-11-23 · Found by re-running `check_segments_reconcile.py` against production while
fixing its `security_filing` read (muffin-deployment#540) · Status: **cause found and fixed
(muffin-deployment#546, merged 2026-11-26); closes once the re-read below is verified**

## Why

The guard's primary assertion: a placed split sums to the figure the parser accepted it against
(`reconciled_to`). On 2026-11-23, 8 of 817 served splits did not (0.98%, tripwire 2.5%, so the gate
stays green). Five of them are Korean (DART), FY2025, and in the two read, the **split is right and
the target is wrong**:

- **HL Mando** (`ifrs-full:GeographicalAreasAxis`, accession 20260318000883): Korea (as
  `CountryOfDomicileMember`) 3.16 T, China 2.05 T, other countries 1.72 T, US 1.59 T, India 0.93 T.
  The sum, 9.45 T won, is about the company's annual revenue. `reconciled_to` reads 1.02 T, which
  matches no member and no total read so far.
- **Galaxia Moneytree** (`ifrs-full:SegmentsAxis`, 20260323001081): electronic payment 96.9 bn + O2O
  32.7 bn = 129.7 bn, against `reconciled_to` 8.0 bn.

The others (first read only from the guard's notice):

| Company | Axis | Split | Target |
|---|---|---|---|
| Cosmecca Korea | geography | 704.6 bn | 71.2 bn |
| Wonik IPS | segments | 925.5 bn (1 member) | 445.6 bn |
| HFR | segments | 149.6 bn | 142.0 bn |

HFR is 1.05×, which may be an intersegment elimination rather than this defect. Wonik IPS's split
is ONE member, which is not a breakdown at all.

This is the shape CLAUDE.md records for GE Vernova ("a wrong reconciliation target, not a wrong
split"). The parser accepted a partition whose members do not sum to the figure it stored, so the
partition came from somewhere other than reconciliation against that figure. The likeliest route is
the inherited partition (`bestMap` learned from another bucket); this is unconfirmed.

## What it costs

The app checks a split against the company's own `revenue` metric, not against `reconciled_to`, so
HL Mando's page shows the right shares if Yahoo's revenue is present. Anything reading
`reconciled_to` as "the filed total" (the guard, the Business lines dashboard) reads a wrong number.

## What to do

1. Read HL Mando's DART instance on the node (raw `raw_dart_filings`) and find where 1,017,521,239,000
   comes from, and which rule placed the geography members in partition 1.
2. Fix the rule in the shared segment code (`segment_tables` / the DART stage 2), gate it over the
   held DART instances by diffing output, re-queue what changes.

## Done when

No placed DART revenue split's sum differs from its `reconciled_to` by more than the guard's
tolerance, other than through a stated elimination.

## Cause (2026-11-26)

`ifrs-full:MajorCustomersAxis` was in `market.segment_axis` as a **qualifier** (legacy migration
155 put it there so its facts would not be disqualified as unknown). A qualifier narrows a fact
without changing what it measures, so a `Revenue` fact under `MajorCustomersAxis =
GroupOfCustomersMember`, the revenue from one group of customers, was read as the company's total.
HL Mando's 1,017,521,239,000 is that figure: its largest customer group. Not the inherited
partition, which the note guessed.

Re-parsing the held DART instances with the axis removed from the vocabulary, against today's:

| Set | Reconciling splits |
|---|---|
| the 30 held filings among those whose split misses its target | 97 -> 125 (29 gained, 1 lost) |
| 66 random held DART filings | 225 -> 237 (13 gained, 1 lost) |
| 134 SEC IFRS filings | 320 -> 320 |

The one loss each time is Cosmecca's 2024 Canada + Europe, which had matched the same kind of
customer figure. Removing `TimingOfTransferOfGoodsOrServicesAxis` as well gained more and lost real
splits (CJ Freshway's food distribution, 3.06 T won), so that axis stays a qualifier.

**The fix:** muffin-deployment#546 deletes the axis from the vocabulary (an unknown axis
disqualifies the fact as a member and as a total, which is right for a customer's revenue) and
re-queues every DART filing holding a revenue row (882 in the dry run). Most were read by the edge,
so stage 1 fetches their archives again.

## Then

1. Deploy #546 after the 08:05 UTC DART floor.
2. Stage 1 alone over `grid:dart_filer` (`raw_dart_filings`, pool `dart`, priority -1), until
   nothing is unasked; then `dart_segment`.
3. Read HL Mando's served geography split against `reconciled_to`, and recount the DART splits whose
   sum misses its target.
