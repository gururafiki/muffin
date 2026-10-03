# The Dagster webserver's idle database connections go dead

Created 2026-10-03 · Check by 2026-10-17 · Status: open; the cause is likely, not yet confirmed.

## What happened

On 2026-10-03 at 15:22, two run launches through the Dagster webserver's GraphQL failed with
`psycopg2.OperationalError: server closed the connection unexpectedly`:
- the first on its first query (`SELECT … FROM snapshots`);
- the second part-way through, on `INSERT INTO event_logs`.

The third launch, a minute later, succeeded.

The webserver had restarted at 14:29 (a deploy), served launches at 14:32, then sat idle for about
50 minutes. Measured at the time:
- **Postgres logged nothing:** no FATAL, no terminated backend, no restart since 2026-09-09.
- **Connection headroom was fine:** ~24 of `max_connections` 100.
- **A fresh Python process in the same container read run storage in 0.08 s.** Only the
  long-running webserver process held dead connections.

**The damage a failed launch leaves:** run `e97b77b1` was created and stuck in `NOT_STARTED`. A run
that never ends can make `AutomationCondition.in_progress()` treat its asset as permanently in
flight, which would have blocked `security_classification`'s eager condition. It was reported failed
by hand.

## The likely cause

Docker swarm routes a service's virtual IP through IPVS, which drops a TCP connection after 900 s
of idleness without telling either end. Postgres runs with `tcp_keepalives_idle = 0`, which means
the OS default of 7,200 s, so nothing keeps an idle connection alive past the cut. The daemon is
unaffected because it queries every few seconds. The webserver idles whenever nobody uses the UI.

**Not yet proven.** Confirm before fixing: from a container on the overlay, hold a `psql` session
to `supabase-db` idle for 16 minutes, then query. Repeat with keepalives set at 300 s.

## What to do

Options, cheapest first:
1. **Server-side keepalives:** `tcp_keepalives_idle = 300`, `tcp_keepalives_interval = 30` and
   `tcp_keepalives_count = 3` on `supabase-db`. This protects every client on the overlay at once:
   the webserver, the daemon, Grafana, PostgREST and langgraph-api.
2. **Client-side, Dagster only:** `params: {keepalives: 1, keepalives_idle: 300}` under
   `postgres_db` in `stack/dagster/dagster.yaml`.
3. **`endpoint_mode: dnsrr` for `supabase-db`,** which bypasses IPVS entirely. It changes how every
   client resolves the service, so it has the largest blast radius.

Meanwhile, `dagster_gql.py` could retry once on this exact error, because a launch that dies
part-way leaves an orphan run behind.

## Done when

The confirming test above is recorded. The webserver then survives an hour idle and its first
launch succeeds, and no `NOT_STARTED` orphan appears.
