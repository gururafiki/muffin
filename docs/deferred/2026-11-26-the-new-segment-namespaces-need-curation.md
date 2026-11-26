# The new segment namespaces need curation

Created 2026-11-26 · Due after EDINET (Phase 6c step 5) has drained its newest year · Status: open

## Why it is deferred

Phase 6c adds members named in Japanese (`edinet:`), in each European filer's language (`esef:`),
and in Chinese for the banks' segment note (`cninfo:经营分部`). Two consequences:

- **`pending_segment_alias` will fill with them.** The queue (`schemas/0102`) recognises only
  English/XBRL catch-all members. Japanese and European "other", "corporate" and "elimination"
  members are not caught by it, so they will flood the curation queue.
- **The new splits will not classify industries until their members are aliased.**
  `derive_segment_classification` maps a member through `segment_alias` to a `segment_concept` with
  a node. An unaliased member serves on the stock page but feeds no `security_taxonomy` row.

The segment members themselves are correct; this is editorial work, measured once the members
exist.

## Context

- Spec: [2026-11-26-more-segment-sources.md](../specs/2026-11-26-more-segment-sources.md), rule 5 and
  *Risks*.
- Comparability lessons: CLAUDE.md § "Segment collection finishing is not segment data being usable".
  - Keyword matching generates candidates, sector filters them, and review adopts them.
  - A standard member naming a substance may be generic; one naming a role must be scoped to its
    filer.

## What to do

1. After EDINET's newest year is read, count the new members by issuer:
   ```sql
   select axis, count(distinct member_code), count(distinct security_id)
     from market.security_segment_spine
    where axis like 'edinet:%' or axis like 'esef:%' or axis = 'cninfo:经营分部'
    group by 1;
   ```
2. Add the residual and total members that the reader did not already drop (`その他`, `全社`,
   `Other`, `Autres`, `Övrigt`…) to `segment_member_class`, so they stop reaching the queue.
3. Propose aliases for the members held by two or more issuers (commodities first, the sound
   cluster), and put them to the user.

## Done when

The new namespaces' catch-all members are classed, and the queue's head is real business lines again.
