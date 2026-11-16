# A fifth of China's reports state their split as revenue composition

Created 2026-11-16 · Planned in [the Phase 6 spec](../specs/2026-11-09-segments-and-regulators.md),
step 4 · Status: open, a widening (decision 2: heading variants later, measured)

## Why

The reader looks for the mandated `主营业务分行业情况` heading, as the edge did. Measured
2026-11-16 over the 716 golden reports (`cn_variant.py`, first 90 pages of each):

| What the report carries | Reports |
|---|---|
| a mandated heading (`主营业务分行业/分产品/分地区情况`) | 547 |
| `营业收入构成` and no mandated heading | **143** |
| `主营业务` with `分行业` or `分产品`, other wording | 3 |
| neither (long reports, wording unread) | 6 |
| no text layer | 1 |
| over the 12 MB gate, unread | 16 |

So **143 reports (20%) yield nothing**, and neither the edge nor this reader read any of them. CATL is
one of them. Ten more carry only the product or geography heading: the reader starts at the
industry heading (`CN_TABLES[0]`), so it reads none of them either.

The variant is the Shenzhen exchange's format, a different table (1225107435, page 21):

- one table headed `营业收入构成`, stating `营业收入合计` first (a stated total, the target);
- group label rows `分行业`, `分产品`, `分地区` inside that one table;
- columns: this year's amount and share (`金额`, `占营业收入比重`), last year's, and the change.
  There is **no cost column**;
- cost appears in a separate table, `占公司营业收入或营业利润10%以上的行业、产品、地区…情况`,
  only for lines at or above 10% of revenue.

## Context

- `facets/cn_pdf.py`: `CN_TABLES`, `parse_segment_page` (headers are `分行业` + `营业收入` +
  `营业成本`, so this table's header never opens one), `segment_facts_from_pdf` (the industry
  heading picks the page).
- Every split here reconciles to the stated `营业收入合计`, which is consolidated revenue, not
  main-business revenue: `其他业务` is a row, not a gap.
- Cost would come from the 10% table, a partial disclosure. Join it by member name, or leave cost
  out.

## What to do

1. Capture five such reports (CATL and four of `cn_variant.py`'s examples) as fixtures.
2. Read `营业收入构成`: the group label rows start each axis, the first amount column after the
   name column is revenue, and `营业收入合计` is the stated total. Skip the share and prior-year
   columns. Add the 10% table's cost if it joins cleanly by name.
3. Start the page search at any mandated heading, not only the industry one (the ten reports).
4. Gate as step 4 did: every new row checked against the PDF on ten reports, every split
   reconciling to its stated total. Then re-queue only the CNINFO reports with no segment rows,
   by a one-shot migration as step 4's was, and drain them by backfill. Do not bump
   `segment_parser.version`: all regulators share it, so a bump re-queues SEC's whole history too.

## Done when

The variant is read and verified on the golden set, or the note is closed with a reason.
