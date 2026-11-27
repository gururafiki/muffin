# What China's segment-note reader cannot read yet

**Why.** Phase 6c step 6 (muffin-ingest#212, muffin-deployment#558) reads the financial-statement
segment note for banks, insurers and state firms. It was gated on 2026-11-27 over the FY2025 reports
of the 88 large Chinese companies (over $2 bn) that held no split for FY2023 or later:

| Outcome | Companies |
|---|---|
| a revenue split, reconciling exactly | 25 (14 from the note, 11 that the 12 MB size gate had refused) |
| operating income only | 3 |
| a main-business table read that does not reconcile | 18 |
| nothing | 42 |

The 60 that read nothing, or nothing that reconciles, fail for the reasons below. Each was found by
reading the report's own pages on the node. None is a reason to have held the step back.

**Context.**
- Spec: `docs/specs/2026-11-26-more-segment-sources.md`, step 6.
- Gate harness: `gate_modern.py` over `/tmp/claude-cngate/docs/modern/<orgId>.pdf` on the node. Each
  PDF was fetched through `cninfo.report`.
- Probes: `probe_hint.py` (pages naming the note), `probe_note.py` (each table, its anchors, kind
  and member kind), `probe_lines.py` (a page's lines as the reader bands them).

## The causes, measured

1. **Geographic operating segments: not read, by design.** Hua Xia, Shanghai Pudong, Qilu and
   Industrial Bank report their operating segments by region (京津冀地区, 长三角地区, 济南地区),
   and so, probably, do most city banks (Ningbo, Nanjing, Beijing, Jiangsu, Hangzhou, Shanghai,
   Chongqing, Chengdu, Changsha). The city banks were not each verified. These tables are read as
   geography and skipped, because the note has no axis of that kind. Read onto a geography axis,
   they would show where a bank earns, but not what it does.
2. **Revenue stated only as its components.** Postal Savings, Xiamen and Suzhou list 利息净收入,
   手续费及佣金净收入, 投资收益 and so on with no 营业收入 row. Their operating income is placed;
   their revenue would have to be computed by summing the components per segment, which the filing
   does not state.
3. **Traditional characters.** China Construction Bank's CNINFO report is set in traditional
   characters (年度報告, 分部報告, 合計), so neither the cover's period nor the vocabulary matches.
   Fixing it means mapping the dozen traditional characters the vocabulary uses, or a second
   vocabulary.
4. **No extractable digits.** PICC's PDF draws its digits from a font with no Unicode map: the text
   reads `成立于 年 月`. Only OCR would read it.
5. **A cover drawn as an image.** Shanghai Rural Commercial Bank's first page has no text, so the
   report's period is never found and nothing is read.
6. **A rotated table.** Industrial Bank prints its segment table turned 90 degrees, so it is
   itemised one glyph per line. It is geographic anyway (cause 1).
7. **Not investigated:** Agricultural Bank of China and Bank of Communications. Both have pages
   that name the note; why nothing reads there is not yet known.
8. **Main tables that do not reconcile (18).** These are mostly securities firms, plus Sinopec and
   Fosun Pharma. Their mandated table is found but its split is unplaced. The note stage
   deliberately does not run beside a main-business table. This belongs to the main reader, not the
   note.

## What to do

- For cause 7, read Agricultural Bank's and Bank of Communications' note pages with `probe_note.py`.
- Decide (the user) whether banks' geographic segments go onto a `cninfo` geography axis (cause 1).
- Cause 2 becomes worth doing only if a computed revenue split is acceptable as data. It is a
  derivation, not a statement, so ask first.
- Cause 3, if CCB matters enough: a small traditional-to-simplified map applied before matching,
  gated over the held reports.
- Cause 8: run the 18 through the main reader's partition step to see why they miss. It may be the
  0.01% tolerance on rounded broker tables.

## Done when

Each cause is either fixed and gated over the held reports, or recorded as a decision not to.
