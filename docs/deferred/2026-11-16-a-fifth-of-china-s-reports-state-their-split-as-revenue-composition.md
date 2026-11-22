# A fifth of China's reports state their split as revenue composition

Created 2026-11-16 · Planned in [the Phase 6 spec](../specs/2026-11-09-segments-and-regulators.md),
step 4 · Status: **closed 2026-11-23.** The variant is built and live (muffin-ingest#183, rolled
2026-11-20 15:29). The shapes under *Left* are recorded as known gaps in
[data-coverage.md](../data-coverage.md) § 3.3 rather than built (the user, 2026-11-23). Decided
2026-11-16 (the user): build the variant, gated like the first fix, then drain all of China once.

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

## Built and gated (2026-11-16 to 11-20)

muffin-ingest#183 reads `营业收入构成` where no mandated heading is printed within 90 pages: the
group rows `分行业`/`分产品`/`分地区` start each axis, `分销售模式` ends the reading, a group the reader
does not know is skipped, and `营业收入合计` is the stated total. Reading the whole population, not a
sample, found the shapes a 30-report sample had not (see the spec's step 4 for each). The gate, on
the node over the production image:

- **Every Shenzhen report drain pass 1 fetched (624):** 615 read, 9 with no body. **610 have facts
  and 609 reconcile in every group**, 6,874 members, 0 duplicate keys, p50 1.9 s a report. The 5
  with no facts are a bank (three years) and a broker (two years), correctly none. The one partial
  is Midea FY2023, whose industry and product tables sum to 333.06 bn against a stated 372.04 bn:
  left unplaced.
- **Every extracted revenue row against its PDF (6,905):** 6,898 have both their name and figure on
  the table's pages. The 7 others are 3 names (a ® mark, two names over 40 characters) and 4
  figures that are right: 科大讯飞 lists 华东地区 under main business and again under 其他业务, which
  the reader sums into one member, and one figure the text layer prints as `19,455,687,441.`.
  Pairing: 6,467 of the 6,503 rows whose name sits on a text line have their figure beside it.
  35 sampled rows read by eye, all correct, including an elimination's minus sign.
- **The 716 golden reports:** 572 identical to the merged reader, 141 gained (no table before), 0
  lost, 0 stored figures changed. The 3 still reading nothing are under *Left*.

## Left

- **Brokers** state `营业总收入构成` by business line (财富管理, 自营, 投资银行…) with no group labels;
  read as nothing (华林证券, 华西证券). Banks state no split.
- **卓胜微** prints industry, products, regions and sales mode with no group labels at all, each
  summing to 100%. Inferring the groups from running sums would be guessing the axis names.
- **The 10 reports carrying only the product or geography heading** (mandated form), and **cost**
  from the `占公司营业收入或营业利润10%以上` table: not read.

## Done when

The re-queue (muffin-deployment#520, 757 reports) is drained and the drain note records the yield;
then close this note, or reopen it for one of the shapes under *Left*.

**Closed 2026-11-23** (the user: close, and record the gaps). The four shapes under *Left* are
listed in [data-coverage.md](../data-coverage.md) § 3.3. Reopen this note to build one of them.
