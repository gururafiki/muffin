# English annual-report PDFs are the last segment source

Created 2026-11-26 · Due when Phase 6c (steps 1–8) is done · Status: open (option G, deferred by
the user)

## Why it is deferred

About 500 large companies (~$12 T) have no machine-readable segment source:
- Switzerland: Roche, Nestlé, Novartis without its 20-F;
- Saudi Arabia: Aramco;
- HK-only companies: Tencent, Xiaomi, Meituan (139 large, $1.7 T);
- Australia;
- Singapore;
- Germany outside the SEC filers, since filings.xbrl.org does not index Germany.

Their annual reports are English PDFs. HKEX and ASX publish them; Switzerland and Germany leave them
on company sites or on a register with no API. Reading them means building per-market discovery and
a PDF table reader in English. That is a larger build than any of options A–F, so it waits until
those have landed and their yield is known.

## Context

- [The options note](2026-11-26-where-the-missing-segments-can-come-from.md), measurement 7 and option G.
- China's PDF reader (`facets/cn_pdf.py`) and the shared segment-note interpreter
  (`facets/segment_note.py`, Phase 6c step 5) are the parts that could be reused.

## What to do

1. After Phase 6c, re-measure the large no-split population by country.
2. For the two largest remaining markets, measure:
   - how filings are discovered (HKEX's `titlesearch`, ASX announcements);
   - whether the segment note is a text table and not an image;
   - whether the shared interpreter, anchored on a total read from the same report, reads it.
3. Put the measured options to the user.

## Done when

The user has decided whether and where to build option G, on measured yield.
