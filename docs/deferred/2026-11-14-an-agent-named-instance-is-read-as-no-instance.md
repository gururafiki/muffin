# An instance named by a filing agent is read as "no instance"

Created 2026-11-14 · Phase 6 step 3 ([spec](../specs/2026-11-09-segments-and-regulators.md)) ·
Status: **decided by the user 2026-11-14: widen now and re-queue (option 1).** Phase 6 decision 2
deferred widening "later, measured"; this was the measurement.

## Why

The edge decided which file in a filing is the XBRL instance with `isInstanceName`:
`-\d{8}(_htm)?\.xml$`, i.e. `aapl-20250628_htm.xml` or `aapl-20150926.xml`. The port keeps it as-is
(`facets.segments.is_instance_name`). **Filing agents name the instance otherwise**, and the rule
rejects every such name, so the filing is recorded as having no instance and marked read for good:

| Filing | Agent | Instance the rule rejects |
|---|---|---|
| Southern Copper 10-Q, 2026-10-30 | Toppan Merrill (0001104659) | `scco-20260930x10q_htm.xml` |
| three filers, 10-Qs | M2 Compliance (0001493152) | `form10-q_htm.xml` |
| two filers | RDG (0001437749) | `bomn20260930_10q_htm.xml`, `desp20260930_10q_htm.xml` |
| Lightwave Logic | (0001079973) | `lwg_10q-093026_htm.xml` |

Measured 2026-11-14 on the Dagster lane's first wave: **10 of 29** filings came back `absent`. Each
of the 11 absent filings held so far lists **exactly one** `*_htm.xml`. Fetched and parsed read-only
with the current parser, **7 of 11 carry segments**: Southern Copper's 10-Q has 158 facts over
three axes, the others 10 to 46.

**On the history** (filings read since 2019-06-15, when inline XBRL began; read-only):

| Who filed | Filings read | With no segment rows | Share |
|---|---|---|---|
| a filing agent | 37,649 | 24,346 | **64.7%** |
| the company itself | 45,280 | 10,941 | 24.2% |

The baseline for a company that genuinely discloses no segments is the self-filed 24%. The 40-point
gap on agent filings is roughly **15,000 filings** missing segments they disclose, over ~1,900
filers. Southern Copper is the case the 2026-09-05 elimination rule was built for, and its 10-Qs
have never been read.

## Options

1. **Widen now (recommended).** In the inline-XBRL era SEC names exactly one extracted instance
   `<primary document>_htm.xml`, so `is_instance_name` takes any `*_htm.xml` (still excluding
   linkbases and `FilingSummary.xml`) and keeps the dated rule for the pre-2019 standalone
   instance. The shortest-name tie-break is unchanged, so every filing the edge read picks the same
   file and golden parity still holds. Then a one-shot re-queues the filings read with no segment
   rows since 2019-06-15 (~35,000), read by a paced operator backfill: ~2-3 requests each at 5 a
   second, about 6 hours of the `sec` pool, and ~3-4 GB of raw at ~100 KB a compressed instance.
   Filings that genuinely have none are marked again.
2. **Widen for new filings only.** The rule changes; the history stays as the edge left it until
   a later decision. Cheap, and it leaves ~15,000 filings without segments they disclose.
3. **Leave it for after Phase 6.** As decided on 2026-11-09: the port stays as-is, and ~1/3 of new
   accounts filings keep reading as "no instance".

## Done when

The user has chosen; if 1 or 2, the rule ships with a test over the agent names above, and for 1
the re-queue runs and `security_segment` gains rows for Southern Copper's 10-Qs.

## Context

- muffin-ingest `facets/segments.py` (`is_instance_name`, `instance_from_index_json`,
  `instance_from_index_html`); the edge's `segments.ts::isInstanceName`.
- [Segment parsing is ported as-is and widened later](2026-11-09-segment-parsing-is-ported-as-is-and-widened-later.md).
- [A parser bump re-reads a history raw does not hold](2026-11-14-a-parser-bump-re-reads-a-history-raw-does-not-hold.md):
  option 1 here is a targeted re-queue, not a version bump, so it does not need that decision.
