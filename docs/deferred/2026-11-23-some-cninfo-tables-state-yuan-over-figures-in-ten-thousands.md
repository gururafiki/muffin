# Some CNINFO tables state yuan over figures in ten thousands

Created 2026-11-23 · Found while checking the bracketed-unit fix of muffin-ingest#199 · Status:
**decided 2026-11-23 (the user): option 1, check against the company's revenue**

## Why

25 CNINFO reports (23 companies, FY2015 to FY2025) store a business-line split placed against a
total under 10 m yuan, median 0.94 m. A listed A-share company with that little main-business
revenue is implausible.

Read against their PDFs on 2026-11-23, both the current reader and the branch read them the same
way, so this is not the bracketed-unit defect #199 fixes. **The filer's own unit line is wrong:**

- 航天长峰 (600855) FY2025, page 15: the table is headed `单位：元 币种：人民币` over `军工电子
  54,294.31`. Two lines above it, the report's text states `军工电子业务主营业务收入54,294.31万元`.
  So the figures are in ten thousands of yuan, and the split is stored at 1/10,000: 0.12 m yuan
  against a true 1.23 bn.
- 广东电力 (000539) FY2023: the composition table is headed `单位：元`, and the split is stored at
  2.8 m yuan for a company with tens of billions of revenue.

The reader takes the unit the table states, as it should. No rule over the table alone can tell a
wrong unit line from a small company.

## Measured (production, 2026-11-23)

The CNINFO revenue splits placed (`partition_id > 0`, top level) against a `reconciled_to` under
10,000,000:

- 25 reports over 23 securities, totals from 123,363 to 9,109,519 yuan;
- the first three: gssh0600855 FY2025, 9900035299 FY2019, 9900019841 FY2016.

## What to do (options, for the user)

1. **A plausibility check against the company's revenue (recommended; chosen 2026-11-23).** In stage 2, when the
   split's total times 10,000 is within ~1% of the company's stated revenue for the same year
   (`security_metric`, `revenue`, annual, from Yahoo or the filing), read the table as 万元, and
   say so in the stage-2 metadata. The revenue is stated independently of the table, so this is
   evidence, not a guess. Then re-queue the 25.
2. Leave them unplaced: refuse a split whose total is under some floor. That hides the data
   rather than correcting it.
3. Leave them as they are: 25 of ~18,800 reports (0.13%) are wrong by a factor of 10,000.

## Context

- `muffin-ingest/libs/muffin-ingest-lib/src/muffin_ingest/facets/cn_pdf.py`: `_UNIT`,
  `unit_stated_last`.
- The measuring query: `security_segment` where `source_code = 'cninfo'`, `metric_code =
  'revenue'`, `partition_id > 0`, `parent_member is null`, `reconciled_to < 10000000`.

## Done when

No placed CNINFO revenue split totals under 10 m yuan unless the company's own revenue is that
small.
