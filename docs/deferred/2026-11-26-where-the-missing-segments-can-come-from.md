# Where the missing segments can come from

Created 2026-11-26 · Asked by the user ("figure out where to get missing segments") · Status:
**options measured; waiting for the user's choice**

## Why

On 2026-11-26, 2,979 equities over $2 bn of market cap ($53.9 T) held no placed revenue split for
FY2023 or later. The gap by country (equities, with a split, cap covered, large ones missing, cap
missing):

| Country | Equities | With a split | Cap covered | Large missing | Cap missing |
|---|---|---|---|---|---|
| CN | 2,626 | 2,107 | 49% | 293 | $9.6 T |
| JP | 2,490 | 8 | 12% | 466 | $6.6 T |
| US | 3,054 | 2,328 | 93% | 203 | $5.9 T |
| CH | 153 | 21 | 11% | 95 | $3.4 T |
| SA | 124 | 0 | – | 52 | $2.5 T |
| EU + UK (14 countries) | ~1,600 | ~150 | 2–63% | 672 | ~$12.6 T ($2.3 T of it DE) |
| TW | 542 | 5 | 63% | 149 | $2.1 T |
| IN | 664 | 308 | 60% | 182 | $1.9 T |
| KR | 1,346 | 468 | 58% | 33 | $1.9 T |

## What was measured

Every finding below was measured on 2026-11-26, from raw already held or from the provider.

1. **SEC filers read with the wrong vocabulary.** A dry re-parse of the 300 largest SEC "filers"
   with no split, with four revenue concepts added below every existing one
   (`RevenuesNetOfInterestExpense`, `RevenueAndOperatingIncome`, `RevenueFromSaleOfGoods`,
   `RegulatedAndUnregulatedOperatingRevenue`): 9 gain a placed split, $1.28 T (Novartis, Morgan
   Stanley, Goldman, NextEra, UBS, Sanofi and three others). 4 have every annual instance over
   the 32 MB gate (HSBC, Santander). 171 hold a CIK but file no 10-K, 20-F or 40-F (SK hynix,
   CATL, Inditex, Air Liquide), so "held: sec" is the wrong label for them. 86 give nothing either
   way: insurers' premiums (`PremiumsEarnedNet`, 4 filers) are the only cluster left, and the rest
   look single-segment.
2. **Second listings of a company that has a split.** By normalised name, 101 large lines ($3.6 T)
   have a sibling with a split: CN 65 (H-shares), KR 10 (preferred shares and an SK hynix ADR), US
   8, BR 7. Exact names find 76; `issuer_id` is missing on 664 of the 2,979.
3. **Japan's EDINET.** The key is configured (`EDINET_API_KEY`). The annual reports (有価証券報告書,
   docType 120) of Toyota, Sony, Mitsubishi Corp, Tokyo Electron and Recruit were found by date and
   downloaded. The segment note is a text block holding the note's HTML table: Toyota's external
   revenue 41,080,731 + 3,447,195 + 567,399 = 45,095,325 百万円, the consolidated figure, with
   operating income, assets, depreciation and capex by segment. The note carries both years; the
   first table was the prior year. IFRS filers use
   `NotesSegmentInformationConsolidatedFinancialStatementsIFRSTextBlock`, Japanese-GAAP filers
   `NotesSegmentInformationEtcConsolidatedFinancialStatementsTextBlock`.
4. **Europe's ESEF, via filings.xbrl.org (keyless).** The segment note is block-tagged
   (`ifrs-full:DisclosureOfEntitysReportableSegmentsExplanatory`), and the block holds the note's
   HTML table: L'Oréal's four divisions sum to 44,052.0 €m, the group total; LVMH and Schneider
   likewise. Of 24 large missing companies sampled by LEI (no Germany), all 24 are indexed and 18
   hold a revenue table in the block. The misses: Inditex (one business), Airbus (no `<table>`),
   Santander and Erste (bank labels), Intesa (newest indexed filing is FY2022), DSV (no block).
   Coverage for a 2024-12-31 year end: SE 343, GB 327, DK 239, NO 236, FI 209, FR 192, IT 192, BE
   125, NL 121, ES 118, **DE 0 and CH 0**. The index refuses bursts (429 after ~15 requests); 8 s
   between requests holds.
5. **China's CNINFO financials and SOEs.** Banks, insurers and brokers (55 large, $3.2 T) and 33
   non-financials such as PetroChina and Sinopec ($0.9 T) were read into no rows: they do not print
   the mandated `主营业务分行业` table. ICBC prints `经营分部信息概要` (page 44 of 408) and the full
   note `财务报表附注五、分部信息`; PetroChina discusses each `分部` and has the note.
6. **Taiwan's MOPS.** Reachable from the node at ~10 KB/s (Hon Hai's rendered report: 1.5 MB in
   150 s, cut off before its `部門資訊` note). The segment table itself is not yet confirmed.
7. **No machine-readable source:** Switzerland (Roche, Nestlé), Saudi Arabia (Aramco), Australia,
   Singapore, HK-only companies (Tencent, Xiaomi, Meituan: 139 large, $1.7 T), and Germany outside
   the SEC filers. Their annual reports are PDFs; HKEX and ASX publish them, Switzerland and Germany
   leave them on company sites or a register without an API.
8. **Nothing to collect:** India's ~140 large NSE filers with no segment facts at all are
   single-business companies (Maruti, UltraTech, Sun Pharma), and so are many US ones.

## The options

| | Option | Large companies | Cap | Effort |
|---|---|---|---|---|
| A | SEC vocabulary (bank, IFRS sale-of-goods, utility, insurer concepts) and a higher instance size gate | ~15 | ~$1.8 T | small |
| B | Serve a company's split on all its listings (a company key) | 101 now, more as others land | $3.6 T | small–medium |
| C | Japan: EDINET's segment note HTML | up to 466 | $6.6 T | medium |
| D | Europe and UK: ESEF segment blocks via filings.xbrl.org | ~430 of 577 (75% yield) | ~$7.7 T | medium–large (languages) |
| E | China: CNINFO's segment note for financials and SOEs | 88 (+ their H-shares via B) | $4.1 T (+$3.6 T) | medium |
| F | Taiwan: MOPS | up to 149 | $2.1 T | medium; one more probe |
| G | English annual-report PDFs (HKEX, ASX, company sites) | ~500 (CH, SA, HK-only, AU, DE, SG) | ~$12 T | large; discovery differs by market |
| H | A paid vendor (FMP segments: revenue only, per-symbol premium) | unknown | – | money; not recommended |

## Done when

The user has chosen; each chosen option becomes its own step with a gate over held documents.
