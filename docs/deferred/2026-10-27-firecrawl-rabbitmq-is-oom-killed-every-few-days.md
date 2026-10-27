# Firecrawl's RabbitMQ is OOM-killed every two or three days

Created 2026-10-27 · Status: decided 2026-10-27 (option 1), live since 20:38 UTC; watching

## Why

The Grafana alert *A container is near its memory limit* (`muffin-container-near-oom`, > 85% for
10 minutes) fired from 2026-10-27 03:50 to 07:30 UTC on `muffin_firecrawl-rabbitmq`. It cleared
because the kernel killed the container. Measured 2026-10-27 on the node:

- **Task history:** `non-zero exit (137)` at 10-19 14:39, 10-22 03:54, 10-24 17:08 and 10-27 07:15
  UTC, every ~61 hours. Swarm restarts it each time (`restart_policy: any`), so nothing stays down
  and nothing else reports it.
- **The curve:** memory rises about 1% of the 512 MiB limit every 30 minutes, steadily, with no
  traffic pattern (Prometheus `muffin_service_memory_bytes`, 30 hours). It reached 99.4% before the
  07:15 kill and stood at 40% (217 MB) at 20:00.
- **What grows is `quorum_ets`:** `rabbitmq-diagnostics memory_breakdown` puts it first, at 70.8 MB
  (32%), 12 hours after the restart. All four queues (`extract.jobs`, `extract.dlq`,
  `nuq.queue_scrape.prefetch`, `nuq.queue_crawl_finished.prefetch`) are QUORUM queues, and all hold
  0 messages.
- **Why it never stops:** quorum queues keep WAL entries in memory until the WAL rolls over, and
  RabbitMQ 3.13.7 runs with the default `wal_max_size_bytes` of 536,870,912, the same as the
  container's limit. The WAL file was 46.7 MB after 12 hours (~3.9 MB an hour), and the memory table
  is about 1.5 times that, so the container dies at a WAL of roughly 240 MB, about 2.5 days in. It
  never reaches the rollover that would release it.
- **And nothing applies backpressure first:** `Memory high watermark setting: 0.4 of available
  memory, computed to: 10.0558 gb`. RabbitMQ sizes the watermark from the host's 24 GB, not the
  container's 512 MiB, so its own flow control can never engage.
- **No volume:** the service has no data volume, and the node name is the container's hostname, so
  each restart starts an empty WAL and the cycle begins again.

What it costs: a restart drops Firecrawl's in-flight queue state, so a scrape or crawl the agent
started in that minute can be lost. It is not ingestion; muffin-ingest does not use Firecrawl.

RabbitMQ's persistence docs ([3.13](https://www.rabbitmq.com/docs/3.13/persistence-conf)) give the
rule this deployment breaks: allocate the node "at least 3 times the memory of the effective WAL file
size limit", with `raft.wal_max_size_bytes = 32000000` as their example. At the default 512 MiB WAL,
that is 1.5 GiB of memory, against the container's 512 MiB.

## What to do (options, for the user)

1. **Configure RabbitMQ for its container (recommended).** Add one environment entry to
   `firecrawl-rabbitmq` in `stack/docker-compose.yaml`:
   `RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS: "-rabbit total_memory_available_override_value 536870912 -ra wal_max_size_bytes 32000000"`.
   The WAL rolls over at 32 MB, the docs' example, so by their 3x rule the node needs ~96 MB for
   it. The watermark becomes ~205 MB, so RabbitMQ throttles publishers before the kernel kills it.
   It is one deploy with no new files, and an env change is in the task spec, so the deploy
   restarts the service. Before shipping, check in a throwaway `rabbitmq:3` container that
   `rabbitmqctl environment` shows both values; a `conf.d` file (`raft.wal_max_size_bytes`,
   `total_memory_available_override_value`) is the fallback if the erl args do not take.
2. **Raise the limit to 1.5 GiB**, the docs' 3x rule at the default WAL. It costs 1 GiB of the
   node's headroom, and leaves the watermark computed from the host.
3. **Leave it.** A restart every 2-3 days, each costing whatever Firecrawl had in flight.

## Done when

After the change ships, `muffin_service_memory_bytes` for `muffin_firecrawl-rabbitmq` stays flat
under 60% of its limit for 5 days, with no new `exit (137)` in `docker service ps`, and
`rabbitmq-diagnostics status` reports a watermark computed from 512 MiB.

## Shipped

muffin-deployment#474, deployed 2026-10-27 at 20:38 UTC (the stack deploy restarted the task, as
an env change in the spec should). Read from the container at 20:43:

- `RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS` carries both settings;
- `application:get_env(ra, wal_max_size_bytes)` is `{ok,32000000}` and
  `application:get_env(rabbit, total_memory_available_override_value)` is `{ok,536870912}`;
- `Memory high watermark setting: 0.4 of available memory, computed to: 0.2147 gb`;
- the same four quorum queues, all empty; 127.5 MiB of 512 MiB (24.9%).

The 2026-10-27 07:15 kill was the last one; it is the fourth in eight days.
