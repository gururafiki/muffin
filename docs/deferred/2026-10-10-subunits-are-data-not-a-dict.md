# Subunits are a dict in code, beside a table that should hold them

Created 2026-10-10 · Due when a subunit is next added · Status: open (decision 4: later)

## Why it is deferred

Which currency is a fraction of which, and by how much, lives in `muffin_ingest.facets.fx.SUBUNITS`:
`ILA`, `ZAC`, `KWF` and since 2026-10-10 `GBX`. The codes themselves live in `market.currency`. That
is the same fact in two places. Adding pence needed both a code change and a migration (#104 and
muffin-deployment#426). The FX lane now derives only a subunit the table holds, which made the order
safe, but it is a guard against the drift rather than its removal.

The user decided on 2026-10-10 to leave it (decision 4 of the quote-currency spec): it is not on the
labels' path, and a schema change would have cost a deploy that the Cloudflare token was blocking.

## What to do

1. Add `parent_code text references market.currency` and `per_parent numeric` to `market.currency`,
   and seed the four rows.
2. Have `fx.with_subunits` read them (`known_currencies` already reads the table) and delete the
   dict.
3. Keep a test that the divisors are the real ones, now against the table.

## Done when

`SUBUNITS` is gone from the code and a new subunit is one row.
