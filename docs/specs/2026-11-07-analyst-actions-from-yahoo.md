# Analyst actions from Yahoo

Status: **approved by the user 2026-11-08, as recommended (1a, 2a, 3a), and built** (the
replacement decided on 2026-11-06, when finviz's price targets retired: muffin-deployment#494,
[note](../deferred/2026-11-05-finviz-moved-its-quote-page.md)). See *As built* at the end.

## What exists

- **Raw.** The Dagster company lane (`yahoo_companies`) already stores every company's whole
  quoteSummary document, refreshed weekly. Each one carries `upgradeDowngradeHistory.history`. So
  this is a stage 2 over files already on disk, and it costs no provider request.
- **Table.** `market.security_price_target` holds finviz's rows, frozen at 2026-11-04:
  - columns `security_id`, `published_date`, `analyst_company`, `target_from`, `target_to`,
    `status`, `rating_change`, `source_code`;
  - key `(security_id, published_date, analyst_company)`, which has **no source**.
- **Reader.** muffin-ui reads the table directly (`use-analyst-actions.ts`).

## Measured: AAPL's stored document (captured fixture)

- **Volume.** 971 actions from 2012-09-12 to 2026-10-01, against finviz's ~20.
- **Fields.** Each action has the same eight: `epochGradeDate`, `firm`, `fromGrade`, `toGrade`,
  `action`, `priceTargetAction`, `priorPriceTarget`, `currentPriceTarget`.
- **`action` vocabulary:** `main` 709, `reit` 171, `down` 38, `up` 35, `init` 18.
- **`priceTargetAction`:** Raises 483, Maintains 233, Lowers 165, Announces 67, empty 22,
  Adjusts 1.
- **`0.0` is an absence wearing a value.** `currentPriceTarget` is 0.0 on 22 of 971 and
  `priorPriceTarget` on 130. It must become null, or "lowers its target to 0" is served.
- **The same firm on the same day twice: 2 of 971.** The current key cannot hold them. The same
  firm at the same second: 0.

## Choices

1. **The key.** The rule is that every ingested row names its provider, with the provider in the
   key where two providers state one fact.
   - **a (recommended).** The key becomes `(security_id, source_code, published_at,
     analyst_company)`, with the action's timestamp, not its date. Both sources are kept, and a
     serving view picks one per action by priority. The app then reads the view.
   - **b.** Keep the key and let Yahoo's rows replace finviz's. That loses the provider rule, and
     the 2-in-971 same-day pairs still collide.
2. **Depth.**
   - **a (recommended).** Everything Yahoo serves, back to 2012. At ~100 actions per company over
     ~12,000 companies that is about 1.2 m rows, small.
   - **b.** A window such as 3 years, with a retention rule.
3. **finviz's frozen rows.**
   - **a (recommended).** Keep them until the contract, behind the view's priority (Yahoo first),
     then delete with a drop date like the other retired families.
   - **b.** Delete them now.
4. **Vocabulary.** Map `action` to the app's `status`: up → Upgrade, down → Downgrade, init →
   Initiated, reit → Reiterated, main → Maintains. `main` is new to the app, so the UI needs one
   word. `rating_change` is `fromGrade → toGrade`, and the targets are prior and current, with 0.0
   as null.

## Plan once approved

- **muffin-deployment.** Expand the table key (expand/contract) and add a serving view with
  priority; a test with a fixture where the two sources and the same-day pair disagree; a node
  replay with mutations. Then muffin-ui reads the view.
- **muffin-ingest.** A stage-2 asset in `defs/companies/` reading the stored documents, in the
  `yahoo_companies` job; tests over the captured AAPL document; a tiny local subset, then a live
  subset; then a replay over every stored document, which needs no request.

## As built (2026-11-08)

- **muffin-deployment#504** (deployed):
  - `security_price_target` gains `published_at` and `currency_code`;
  - its key becomes `(security_id, source_code, published_at, analyst_company)`;
  - finviz's 49,025 rows take midnight UTC and USD.

  `security_analyst_action` hides a row where a higher-priority source states the same firm
  (compared without case), security and day. The guard's fixture makes the wrong rules disagree,
  and four mutations were caught on the node replay. On a rolled-back production dry run, AAPL read
  as anon in 13.6 ms, and the view has an anon latency probe.
- **muffin-ingest#166:**
  - `facets/analyst_actions.py` and the stage-2 asset `yahoo_analyst_action`, over
    `raw_yahoo_summary`;
  - Yahoo's codes map to the app's words (`main` is "Maintains"), a 0.0 target is no target, and
    targets carry the quote currency;
  - a document carrying the module retracts Yahoo's own rows it no longer states, per company;
  - it ships outside the `yahoo_companies` job until a live run and a replay over every stored
    document, then joins it.
- **muffin-ui#143:** the stock page reads the view, orders by `published_at`, and labels each target
  with its own currency.

### The live run, and why the view picks per company (2026-11-08)

- **Live run.** After the roll, a backfill over six companies (AAPL, MSFT, NVDA, TSM, 7203.T,
  VOD.L) succeeded. Yahoo's rows run from 2012 to 2026-11-03: AAPL 979, MSFT 955, NVDA 984, TSM 106,
  all USD and all in the five words. Toyota and Vodafone carry no module and wrote nothing.
- **Matching one action across providers does not work.** With the first view's rule (same firm,
  ignoring case, same day), 42 finviz rows still showed beside Yahoo's on those four companies.
  29 of them had a Yahoo action within three days at the same target under another spelling:
  - BofA Securities and B of A Securities;
  - KeyBanc Capital Markets and Keybanc;
  - Evercore ISI and Evercore ISI Group;
  - Rothschild & Co Redburn and Rothschild & Co;
  - Robert W. Baird and Baird;
  - The Benchmark Company and Benchmark.

  Some were also a day apart (Stifel on MSFT). So the page showed one action twice.
- **muffin-deployment migration 20261108220000** applies "Yahoo first" (3a) per company: a source's
  rows show only where no higher-priority source has any row for that company. A covered company
  loses the few actions only finviz recorded; they stay in the table until the contract.
  - **The first form was too slow.** Written as an anti-join, it took AAPL to 147-168 ms as anon:
    every pair of the company's rows was checked, with a `source_priority()` call for each.
  - **The window is linear.** As `max(priority) over (partition by security_id)`, with
    `data_source` joined, AAPL reads in 1.1-1.8 ms, and the filter reaches the primary key below
    the window.
- **The replay over every stored summary**, backfill `swfbhjmr`:
  - launched 21:20 UTC over 12,846 partitions, with `dagster_gql.py --partitions grid:security`, an
    option added for it;
  - 129/129 runs succeeded, 15-18 s each, by 22:07;
  - 410,213 Yahoo actions over 3,376 companies, newest 2026-11-07;
  - targets are USD 400,720, CAD 7,419, MXN 594, ILA 495, CHF 465, GBX 232, EUR 157, and 95
    withheld.

  The view serves 3,393 companies, 17 of them from finviz alone.
- **muffin-ui#143** deployed at 21:48: the served bundle reads `security_analyst_action`.
- **muffin-ingest#167** rolled at 22:12: the asset is in the `yahoo_companies` job from the 11-09
  03:30 run.

