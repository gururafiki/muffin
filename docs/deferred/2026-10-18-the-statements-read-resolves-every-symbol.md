# The stock page's statements read resolves every security's symbol

Created 2026-10-18 · Check by 2026-10-21, mid-way through the company lane's first rotation · Status:
**closed 2026-10-18** (muffin-deployment#447, see *Resolved* below)

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

## Resolved, 2026-10-18 (muffin-deployment#447, deployed 20:23 UTC)

- **The readers:** two, both filtering by symbol: muffin-ui's `use-statements.ts` and
  `check_anon_read_latency.py`. No view depends on this one, and no Grafana panel or script reads it.
- **The rows did not change.** The worry above was wrong. `security_symbol` already excludes a security
  with no symbol, and `symbol_security` is its rows with a symbol, one per security: 12,402 each, 0
  differing. Compared on production in a rolled-back transaction, AAPL, MSFT, 7203.T, VOD.L,
  005930.KS, SAP.DE, NVDA and BRK-B differ by 0 rows either way. The only difference is freshness:
  a symbol change shows after the next facets refresh.
- **The read:** about 250 ms → about 1 ms on the server (index scans from the symbol inward). As anon
  through Cloudflare, best of three: AAPL 125 ms, MSFT 107 ms, 7203.T 87 ms, VOD.L 95 ms.
- **The guard:** `a-one-symbol-statements-read-reads-one-security.sql` counts the rows the read touches
  across every relation: 4 on the new view, 605 on the old view and on a per-row lateral.
- **What it found on the way:** the view's two existing tests became snapshot tests (rows inserted in a
  test are invisible to the matview until it is refreshed). One of them,
  `the-gate-must-see-the-effective-country.sql`, would have kept passing on an empty view, since it
  asserts that no row disagrees. Both now refresh, and that one gained a floor.

## Re-measured 2026-10-21, mid-rotation

As anon through Cloudflare, best of three, with no backup running:
- AAPL 210 ms, MSFT 135 ms, 7203.T 78 ms, VOD.L 350 ms.
- `income` holds 101,317 rows, against 80,619 on 10-18 (+26%).
- `check_anon_read_latency.py`: all 23 probes ok; the statements probe 125 ms, the slowest probe
  661 ms (the weekly chart).

Every read is well inside the 2,000 ms budget and none has grown with the table, so no separate
check is scheduled. market-verify times this read every night.

