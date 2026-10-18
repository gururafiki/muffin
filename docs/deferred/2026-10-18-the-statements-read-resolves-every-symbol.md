# The stock page's statements read resolves every security's symbol

Created 2026-10-18 · Check by 2026-10-21, mid-way through the company lane's first rotation · Status:
**open**

## Why it is deferred

`market.security_statement_current` joins `market.security_symbol`, the view that resolves each
security's symbol with LATERAL subqueries. So a read for one symbol cannot narrow before the join.
- **Measured 2026-10-18, as `postgres`, warm.** `symbol = 'AAPL' and statement = 'income'` scanned
  every income statement through the bitmap index (85,597 rows). It resolved all 27,977 securities in
  a nested loop and took **407 ms** on the server.
- **As anon over PostgREST, best of three:** AAPL 0.66 s, MSFT 0.85 s, 7203.T 0.65 s and VOD.L 0.84 s.
  The same reads took 0.47–0.69 s that morning.
- **`check_anon_read_latency.py` read it at 1,993 ms** right after the 14:14 UTC deploy: contention,
  but 7 ms under its 2,000 ms budget.

The cost grows with `security_statement`: income 80,619, balance 72,055, cash 65,026 rows. The
company lane's first rotation adds about 44,600 statement rows a day (2026-10-18: 44,632) until about
2026-10-24. The guard is the safety net: market-verify fails above 2 s, before anon's 3 s ceiling.
Under contention it may fail before the read is actually slow.

This is a known shape. CLAUDE.md records that "resolving a symbol through `security_symbol` costs a
scan of the whole universe". `price_series` (migration 102) and `security_ratio_series` (#437) moved
to the materialised, indexed `market.symbol_security`. This view never did.

It was not fixed in the same change as muffin-deployment#443 because swapping the join changes the
view's rows:
- `security_symbol` gives one row per security, with a null symbol where there is none.
- `symbol_security` holds only securities with a symbol, and may name a security under more than one.

A reader that does not filter by symbol would see different rows, so the readers need listing first.

## What to do

1. List every reader of `security_statement_current`: muffin-ui's hooks, `.github/scripts/check_*`,
   Grafana provisioning, other views (`pg_depend`). Note which filter by symbol and which by
   `security_id` or not at all.
2. Rewrite the view's join on `market.symbol_security`, keeping a security with no symbol reachable
   if any reader needs it. Follow `muffin-schema-change`: a guard that counts the statement rows a
   one-symbol read touches, as `a-one-symbol-ratio-read-reads-one-security.sql` does, with the
   mutations run on the node.
3. Re-time the four symbols above as anon, best of three, and run `check_anon_read_latency.py` once
   `muffin-db-backup.sh` reads 0.

## Done when

A one-symbol statements read touches only that security's rows. The four reads take well under a
second, and do not grow with the table.
