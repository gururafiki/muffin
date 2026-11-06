# Analyst actions from Yahoo

Status: **design, for the user's approval** (the replacement decided on 2026-11-06, when finviz's
price targets retired: muffin-deployment#494,
[note](../deferred/2026-11-05-finviz-moved-its-quote-page.md)).

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
