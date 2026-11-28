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

## What to do

- Read Schneider's FY2024 block with the per-table dump to see which rule misses (cause 1).
- Cause 3 would need a region-then-country reading of one grid; only worth it if the first drain
  shows the shape is common.
- Cause 4: offer the derived target whenever a line holds an adjustment, and let the partition
  search choose; gate over the drained reports first.
- After the first drain, count `no_anchor` and `no_note` by country and language before writing any
  new rule.

## Done when

Each cause is either fixed and gated over the drained reports, or recorded as a decision not to.
