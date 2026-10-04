# A stale NYSE Arca line keeps a delisted US line listed

Created 2026-10-04 · Check by 2026-10-31, before the 1 November directory refresh · Status: open,
needs a decision between the options below.

## What happens

The US directory reaches past OpenFIGI's 15,000-result cap through the alias query `US.arca`. Every
NYSE Arca line (`exchCode: UP`) names its US line in `compositeFIGI`, and stage 2 files that US line
(D1 in [the venue-directory spec](../specs/2026-10-04-the-venue-directory-asks-by-query.md)).

Arca keeps lines for companies that are gone. Measured on the 2026-10-04 walk:

| | |
|---|---|
| Arca lines | 5,541, all naming a composite |
| composites inside `US.common`'s window (`<= BBG013Q1HJ92`) | 4,114 |
| of those, not returned by `US.common` | **30 (0.7%)**: Kirkland Lake Gold and Whiting Petroleum (both merged 2022), Tufin (private 2022), Paycor, Redfin, CureVac, CyberArk, PROS; Fogo Hospitality and Samba TV, IPOs that never listed |
| composites past the window, vouched for by Arca alone | 1,427 |

Two consequences:

1. **Inside the window, the outcome depends on walk order.** D4's rule lets the venue's own walk
   decide there, but it reads `last_seen_at`, and an alias sighting stamps that too. On 2026-10-04
   `US.arca` walked first (12:15–12:19) and `US.common` after (12:19–12:27), so all 30 were correctly
   marked absent at 15:02. Had the order been reversed, the Arca sighting would have been newer than
   `US.common`'s start: none would be marked, and any existing mark would be cleared, since only a
   newer sighting clears one. The order today is a property of partition keys, not a rule.
2. **Past the window, a delisted US line is never marked.** Only Arca vouches there. At the
   in-window rate, about 10 of the 1,427 are stale. The Markets search then offers them as "listed,
   not tracked", and Stage 4's promotion could mint a security for one.

The marks were checked against the provider, not assumed. OpenFIGI returns ARC Resources' Toronto
line and Schroders' London line, also marked that day, only with `includeUnlistedEquities: true`. So
the walks missed nothing, and the 262 non-US marks agree with the provider's own listing status.

## Options

1. **Record who saw a line.** Add `venue_listing.venue_seen_at`, stamped only when the line's own
   venue query returns it. The in-window rule reads it, and the trigger clears a mark on a newer
   `venue_seen_at` for in-window lines. This removes the order dependence. It does nothing past the
   window.
2. **Check past the window against a second source.** Nasdaq Trader's symbol directory
   (`nasdaqlisted.txt`, `otherlisted.txt`) is keyless, published daily, and lists every
   exchange-listed US security. A US line past the window whose ticker neither file carries is
   absent. This is a new provider, so it needs its own raw asset, stage 2 and cache location.
3. **Accept it.** About 30 order-dependent lines and about 10 permanently stale ones, against 99,459.
   Add a WARN check that names US lines whose only recent sighting is the alias, so the count stays
   visible.

Recommendation: **1 before the 1 November refresh**, because the refresh re-walks every query and
the order is not guaranteed to repeat. Then **2 before Stage 4 enables promotion on US**, since that
is when a stale line starts costing provider budget.

## Done when

- A refresh with `US.arca` walked after `US.common` leaves the in-window stale lines marked.
- Either a second source judges the lines past the window, or a check reports how many only Arca
  vouches for.
