# Every deploy ends with a full database dump, and the app's reads time out while it runs

Created 2026-09-25 · **Check 2026-10-02** · Status: open, a small decision for the user. Nothing
is lost and the backup itself is fine, but each deploy costs about 4.5 minutes of failing reads.

## What was seen

The anon latency guard (`check_anon_read_latency.py`), run just after the 22:40 UTC deploy on
2026-09-25, failed **7 of its 20 probes with `57014`**: stock statements, the Markets donut, both
sector-page queries, and the daily and weekly P/E charts. The same probes had all passed at 22:18.
Run again at 22:45, every probe passed, the slowest at 937 ms.

What ran in between was `pg_dump` of the whole database, piped through `gzip -6`, from 22:40:42 to
about 22:45:10. It read `market.price_bar_2025` via `COPY … TO stdout`, gzip used 83% CPU, and the
load average was 5.1. Every reader competes with that for I/O, CPU and buffer cache, and anon has a
3 s statement timeout.

## Why it happens

`ansible/muffin_stack.yml` § 6 ends with:

```yaml
- name: Seed one backup now (async)
  command: /usr/local/bin/muffin-db-backup.sh
  async: 900
  poll: 0
```

It has **no condition**, so it runs on every deploy, not only the one that set backups up. The
nightly cron (`0 3 * * *`) already takes one a day. Its comment explains why it is async (a
synchronous run once starved the node) but not why it runs every time. It was written to seed the
first backup, and it has stayed on. There were four deploys on 2026-09-25, so four extra dumps and
about 18 minutes of degraded reads.

This probably also explains the rule already in CLAUDE.md, "A ONE-OFF TIMEOUT RIGHT AFTER A DEPLOY IS
CONTENTION". That contention has a named cause, and it recurs on every deploy.

## Options

1. **Seed only when the newest backup is old** (recommended): skip if
   `/var/log/muffin-db-backup.log` shows an `uploaded` line from the last ~20 hours. This keeps the
   original intent, a backup soon after a fresh node or a restored one, and a routine deploy costs
   nothing. One `when:` on the task, reading a registered `stat`/`shell` result.
2. **Drop the seed task.** The nightly cron is the backup, and a fresh node gets its first one by
   03:00 UTC. That is simplest, but a replaced node goes up to a day without one.
3. **Keep it, but lower its priority further.** It already runs niced. The COPY is served by a
   normal-priority Postgres backend, and the cost is cache and I/O more than CPU, so this is unlikely
   to help. Not recommended without measuring.

## Done when

A deploy is followed by no `pg_dump` unless the last backup is old, and the anon latency guard
passes when run straight after a deploy.
