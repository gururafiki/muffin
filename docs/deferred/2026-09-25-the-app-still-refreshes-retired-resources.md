# The app still asks `market-refresh` for resources the D2 cutover retired

Created 2026-09-25 · Status: **CLOSED 2026-09-25, verified live** — muffin-deployment#389 (the
function refuses them, 410) and muffin-ui#133 (the app stops asking). The 2026-09-26 01:55 UTC
check-in re-counts `refresh_run` over the night.

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

## What was done (2026-09-25)

**The function refuses them.** muffin-deployment#389 answers **410** for all ten resources D2
retired, with the Dagster lane that replaced each. The refusal comes before the admin gate and
`begin_refresh`, so nothing is claimed or fetched whoever asks.
- `logic-check.ts` holds the `RETIRED` map equal to the migrations' `-- RETIRES:` markers in both
  directions, and checks the gate's position.
- Six mutations, each caught.

The unverified question above ("what an admin's call does") no longer matters: it cannot reach a
handler. Production showed it had not happened. Since 09-12, `refresh_run` recorded only rotation
skips from before the migration landed, plus today's 403.

**`security-refresh` lost its returns step.** It recomputed one symbol's returns through the retired
path and upserted them into `market.performance`, which has been a view since D2 (`relkind v`). Every
press of the stock page's Refresh cost a provider request and up to 15 s, for a write that could
only fail. Nobody had pressed it since 09-12.

**The app stops asking.** muffin-ui#133:
- The four hooks are read-only: no mutation and no stale-triggered effect. The `refreshing` field,
  the "updating" badge it fed, and `isStale` are gone with them.
- The sector, country and group pages lose the Refresh button, since everything they show is
  Dagster's.
- Markets keeps one, for `instrument-profile`, which is still live.
- `RESOURCE_INFO` drops the retired names.

## Verification

- [x] **The function, probed live at 22:08 UTC:**
      - `fx-rates`, `instrument-performance` and a bare request (default `sector-performance`) each
        answered 410 with the replacing lane;
      - `instrument-profile` still answered 403, since the gate catches retired names only.
- [x] **The served bundle** (`entry-12216195….js`) contains none of the retired names, and does
      contain the new `security-refresh` copy.
- [x] **In the browser, 22:19-22:47 UTC:** the Markets, sector and stock pages made no
      `market-refresh` call. The old 403 and "universe refresh failed" messages are gone; the one
      remaining console error is the known React #418.
- [x] **`market.refresh_run` from 22:09 UTC** (after my own probes) to 22:48: **zero** rows for any
      retired resource, across repeated page loads.
