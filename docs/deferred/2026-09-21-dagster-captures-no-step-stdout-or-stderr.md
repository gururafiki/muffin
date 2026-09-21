# Dagster captures no step stdout or stderr, and says so once per step in a line nobody reads

Created 2026-09-21 · **Check with the next muffin-deployment deploy** · Status: found by reading
the live sweep's output; pre-existing since the code location was built

## What is happening

Every step of every run logs this and carries on:

```
OSError: [Errno 30] Read-only file system: '/opt/dagster/home/storage'
```

`compute_logs` is not configured, so Dagster falls back to `LocalComputeLogManager` with
`base_dir = $DAGSTER_HOME/storage`. `$DAGSTER_HOME` is `/opt/dagster/home`, bind-mounted
**read-only** into all three services — deliberately, and for a good reason: the mount is what
stops Dagster writing `.telemetry` state, whose crash loop is documented in `dagster.yaml` itself.
The directory is `drwxr-xr-x root:root` and the container runs as uid 10001, so the manager cannot
create its tree and raises on every step output.

## Why it matters, and why it is smaller than it looks

Structured logging is UNAFFECTED — `context.log.info(...)` becomes an event row in the `dagster`
database, which is how the AU sweep's `venue AU: 22 pages …` was read today. What is lost is raw
**stdout/stderr**: a library traceback nobody caught, a `print`, a C-level warning, and the dying
output of a process killed by the supervisor.

That last one is the whole cost. CLAUDE.md already records that *a run's error is not in
`user_message`* and that the three supervisor kills (memory, wall clock, CPU) are distinguishable
**in the log and nowhere else**. Compute logs are that log. So this gap is invisible until the day
something dies without raising, which is exactly the day it is needed — the 2026-09-13..16 outage
shape.

## What to do

In `muffin-deployment`'s `dagster.yaml` template, give the compute log manager a writable base
directory on the volume the raw store already uses, rather than making `$DAGSTER_HOME` writable
(that would hand three containers a read-write config directory to fix a logging path, and reopen
the telemetry question the read-only mount closes):

```yaml
compute_logs:
  module: dagster._core.storage.local_compute_log_manager
  class: LocalComputeLogManager
  config:
    base_dir: /var/lib/muffin-ingest/compute-logs
```

The volume must be mounted into **all three** services — the webserver reads these files to render
the stdout/stderr tab, and only the code location writes them.

Then decide retention. `LocalComputeLogManager` never prunes, and this is the node whose `/` filled
to 100% from image layers in one afternoon. The files are small (a few KB a step) and the raw
volume has ~51 GB free, so a `find -mtime +30 -delete` in `maintenance.yml` is enough — but it
should exist before the directory does, not after.

## Alternative, if the logs are judged not worth a volume

`NoOpComputeLogManager` silences the error and states the position honestly, rather than leaving a
misconfiguration that looks like a bug. It is strictly worse for diagnosis and strictly better than
today, which is the same outcome plus an exception per step.

## Done when

A step's stdout is readable in the Dagster UI, or `NoOpComputeLogManager` is configured on purpose;
either way no run logs `Errno 30` any more, and if files are being written, something deletes them.
