# What Europe's segment-note reader cannot read yet

**Why.** Phase 6c step 7 (muffin-ingest#213, muffin-deployment#560) reads the IFRS 8 note's HTML
tables in ESEF reports from filings.xbrl.org. It was gated on 2026-11-28 over nine captured reports
and driven read-only on the node over three filers' 17 annual reports. Eight of the nine place a
split that adds up to the report's tagged revenue. These are the misses, each found by reading the
report's tables; none is a reason to have held the step back.

**Context.**
- Spec: `docs/specs/2026-11-26-more-segment-sources.md`, step 7.
- Fixtures and tests: muffin-ingest `libs/muffin-ingest-lib/tests/fixtures/esef/`,
  `tests/unit/test_esef.py`.
- Probes used: a per-table dump of kind, column names and row roles over a report's block
  (`segment_note._column_names`, `_lines`, `_member_kind`).

## The misses, measured

1. **Schneider's FY2022-FY2024 notes read nothing**, while its FY2025 note reads both axes. Not yet
   investigated; the FY2025 report's comparatives cover FY2024, so the newest year is served.
2. **FY2020 and FY2021 reports carry no note block** (L'Oréal, Inditex, Schneider: 108-185 KB
   reports). ESEF required block tagging of the notes from FY2022, so these years can only come
   from a later report's comparatives. Not a defect.
3. **Atlas Copco's geography table** lists countries inside regions with two value columns per
   year (`Intäkter`, `Anläggningstillgångar`) in one grid; its business split reads, its geography
   does not.
4. **Enel's geography split reconciles within tolerance, not exactly** (78,873 against 78,947 €m in
   2024; 95,831 against 95,565 in 2023): `Rest of the World` is a subtotal column of the countries
   after it, and the derived target (total less adjustments) is offered only when the members'
   own sum equals it, which the subtotal column prevents. The finer split is placed.
5. **ASML** files one segment; its net-system-sales-by-technology table is a breakdown of system
   sales, not of revenue, and anchors nothing.
6. **Airbus** prints its note as positioned `<div>`s, not a `<table>`. Not read, by design.
7. **Germany and Switzerland are not indexed** by filings.xbrl.org, so no row covers them.

## After the first stage-2 reads: version 2 (muffin-ingest#214, muffin-deployment#561)

The drain's first stage-2 reads placed a split for **44 of 207** reports since FY2022 in a 59-filer
sample, against eight of nine in the gate. The nine-report gate had not seen the common shapes.
Version 2 was gated over every report production held on 2026-11-28 (2,593, no provider request):

- FY2022+ reports placing a split: **492 -> 806** of 2,146; 942 splits gained.
- Splits flagged as broken-looking (a member near the total, a fragment, a year in a name): 16.2%
  -> 10.9%.
- By country: GB 180 -> 319 of 777, SE 96 -> 169 of 500, NL 60 -> 105, NO 27 -> 52 of 226, DK 16
  of 117, FR 60 -> 73 of 94.
- Lost against version 1: 6, each read and none a split that was right: EQT's income statement,
  Picanol's balance sheet, two with years as members, OCI's double count, one 2024 comparative.

**Fixing the joining exposed reads version 1 got right by accident.** Schroders' skip came from a
sentence about another note, and VBG's `Koncernen` total earned its metric only because the
letter-spacing broke the name. Each loss in the gate was read with every rule toggled off in turn
(`toggle.py`) before deciding whether it was a regression.

## Still missed after version 2, each read in its report

8. **Keller**: an `Underlying` subtotal sits between its segments and the total.
9. **5493002TF62S16D67T17**: the header row is offset by one cell from the figures.
10. **5493002HQHWN5JQHKQ51**: a `Sub total` member between the segments.
11. **Enagás**: `Ingresos de explotación` has no tagged figure to anchor on.
12. **Bonheur**: one table is split across two HTML tables.
13. **KBC and the banks**: revenue is `total_income`, which is not yet read (Phase 6c bank work).
14. **KONE**: the first member is read as `ratkaisut`, one word of a longer Finnish name. Not yet
    traced.
15. **Footnote digits in names** (`UK and Ireland 1`): stored as written.

**Yield is still lowest in Norway (52 of 226) and Denmark (16 of 117).** Not yet investigated by
language.

## What to do

- Read Schneider's FY2024 block with the per-table dump to see which rule misses (cause 1).
- Cause 3 would need a region-then-country reading of one grid; only worth it if the first drain
  shows the shape is common.
- Cause 4: offer the derived target whenever a line holds an adjustment, and let the partition
  search choose; gate over the drained reports first.
- Causes 8 and 10: a subtotal member between segments and the total. Measure how many reports
  carry one before writing the rule, since `segment_member_class` already names subtotals for SEC.
- After the drain, count `no_anchor`, `no_kind` and `no_note` by country and language, starting
  with NO and DK, before writing any new rule.
- Footnote digits: strip a trailing ` 1`..` 9` only where the table carries a matching footnote.

## Done when

Each cause is either fixed and gated over the drained reports, or recorded as a decision not to.
