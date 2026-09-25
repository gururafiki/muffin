# The app still asks `market-refresh` for resources the D2 cutover retired

Created 2026-09-25 · **Check 2026-10-09** · Status: open, low severity. Every call fails harmlessly
and the app keeps the data it already has. It belongs in its own muffin-ui PR.

## What was seen

Found during the Markets search check in the browser, 2026-09-25 20:35 UTC. Opening the Markets
tab logged:

```
[ERROR]   Failed to load resource: 403 @ /supabase/functions/v1/market-refresh
[WARNING] [market] universe refresh failed, keeping existing:
          Error: market-refresh(instrument-performance) failed: Edge Function returned a non-2xx status code
```

`market.refresh_run` recorded that call as a failed run:
`instrument-performance | ok=false | refresh is restricted to admin users`.

## Why it happens

The app still invokes three resources that `market.cron_resource` has held **disabled since the D2
cutover on 2026-09-12**. Returns and prices now come from the Dagster lanes, and
`market.performance` is a view:

```
instrument-performance   enabled = false
instrument-prices        enabled = false
sector-performance       enabled = false
instrument-profile       enabled = true    (still live)
```

The callers in `muffin-ui/src/features/markets/`:
- `api/use-asset-universe.ts:31` and `api/use-sector-constituents.ts:41` both have
  `const RESOURCE = 'instrument-performance'`;
- `refresh-button.tsx:143` and `:147` include the three retired names in the Markets and stock
  refresh lists.

A non-admin is refused with 403 (refresh is admin-only), so the only effects today are:
- a console error;
- a failed `refresh_run` row for every non-admin page load;
- a Refresh button offering work that no longer exists.

**Unverified:** what an admin's call to a retired resource does. The handlers were disabled in the
cron table, not deleted, and `instrument-performance` used to write `market.performance`, which is
now a view.

Nothing alerts on it. `resource_health.scheduled` requires `cron_resource.enabled`, so a retired
resource is exempt from the stalled-resource rule.

## What to do

1. Remove the three retired names from the two hooks and from the refresh button's lists. If the
   UI should still show freshness for these families, take it from the Dagster lanes' own data,
   such as the newest `market.security_return.as_of`, rather than a refresh call.
2. Check what an admin's call to a retired resource returns. If it can write anything, refuse
   retired resources in the function itself.

## Done when

A Markets or stock page load makes no `market-refresh` call for a disabled resource, and
`market.refresh_run` gains no rows for them.
