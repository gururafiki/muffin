# Some DART splits carry a wrong reconciliation target

Created 2026-11-23 · Found by re-running `check_segments_reconcile.py` against production while
fixing its `security_filing` read (muffin-deployment#540) · Status: **open, not yet investigated**

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
