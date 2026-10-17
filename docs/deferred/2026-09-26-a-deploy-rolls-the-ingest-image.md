# A deploy rolls the ingest image, without the roll's care for in-flight runs

Created 2026-09-26 · Status: **decided 2026-10-11 (the user): option 1, pin the digest** (Phase 4
decision 19); built in muffin-deployment#431. The roll half is live (2026-10-11 09:56 UTC); the
deploy half ships with the next deploy. Wider than first written (2026-10-03, below). The operating
rule below holds until two deploys are seen to leave Dagster alone.

## What happened

muffin-ingest#82 merged at ~21:38 UTC and its image was pushed to `:latest` two minutes later. The
muffin-deployment#394 deploy was already running. Its Ansible play pre-pulls every stack image
(`Pre-pull all stack images`) and then runs `docker stack deploy`, which resolves each tag to a
digest by default. So at 21:40:10 it moved `muffin_muffin-ingest`, `muffin_dagster-daemon` and
`muffin_dagster-webserver` to #82's digest (`c49641a4…`). That was a roll, but nobody launched one.

The planned order was:

1. the deploy;
2. an explicit `roll-ingest`;
3. a tiny live subset;
4. the backfills.

The implicit roll skipped step 3: the new sensor seeded 5,512 subjects at 21:50 and automation
began asking them. Nothing broke. The code was correct, and no run was in flight at 21:40.

## Why it matters

`maintenance.yml roll-ingest` exists because a roll kills in-flight runs:

- each run is a child process of the code-location container;
- a killed run stays `STARTED` and holds its pool slot until reported failed;
- since muffin-deployment#387 the roll script records the in-flight run ids and fails the ones it
  killed.

A deploy does none of that. A deploy during the 00:00 UTC lanes, or during a backfill, kills those
runs silently. The stack template reads
`image_ingest | default('ghcr.io/gururafiki/muffin-ingest:latest')`, so every deploy re-resolves
`:latest`.

## 2026-10-03: a deploy after a roll restarts Dagster even when the image has not changed

The #398 deploy at 09:40 UTC restarted all three ingest services, although `:latest` was the same
digest (`bb11d1ca…`) that `roll-ingest` had moved them to at 09:14. Task history on the node shows
the pattern:

| Event | Dagster tasks created | Image in the spec |
|---|---|---|
| 09-26 22:45, 22:54 rolls | yes | `muffin-ingest:latest`, no digest |
| 09-26 23:04 deploy, after those rolls | yes, 23:11 | `:latest@sha256:8185…` |
| 09-30 20:25 and 21:11 deploys, no roll before them | **no** | unchanged |
| 10-03 09:14 roll | yes | `muffin-ingest:latest`, no digest |
| 10-03 09:32 deploy, after that roll | yes, 09:40 | `:latest@sha256:bb11…` |

The roll's task spec and the next deploy's differ in **exactly one field**: the image string. The
roll writes the bare `muffin-ingest:latest`; `docker stack deploy` writes
`muffin-ingest:latest@sha256:…`. That is a task-template change, so Swarm replaces the task, and the
first deploy after any roll is itself a roll, even with no new image. A second deploy finds nothing
to change. The 10-03 09:56 deploy, straight after the 09:40 one, replaced no Dagster task.

Read this off the **tasks** (`docker inspect <task-id> --format '{{json .Spec}}'`), not the
service. Diffing a service's `PreviousSpec` against its `Spec` shows `UpdateConfig`,
`RollbackConfig`, `StopGracePeriod` and `DNSConfig` changing on every service in the stack, including
supabase-db, which had been up for three weeks. The daemon fills defaults into `Spec` and not
into `PreviousSpec`. A service's `UpdatedAt` also moves on every stack deploy whether or not a
task is replaced. Both readings briefly convinced me the 09:56 deploy had restarted Dagster.

That restart also **failed a running backfill, not only the run in flight**. The daemon iterated
the backfill while the code location was down, raised `DagsterAssetBackfillDataLoadError` (a
framework error, so not retried), and cancelled every queued run: Yahoo slice 3 ended with 33
succeeded, 1 killed and 303 cancelled. muffin-deployment#401 sets
`DAGSTER_BACKFILL_RETRY_DEFINITION_CHANGED_ERROR` on the daemon, so a backfill pauses while its
location is unloadable instead. The run in flight still dies.

Option 1 below covers this too, provided the roll and the deploy write the **same string**: the
roll updates to `…:latest@sha256:<the digest it pulled>`, and the deploy renders that recorded
digest. Pinning only the deploy would still differ from the roll's bare tag.

## Options

1. **Pin the digest in the deploy** (recommended). Only `roll-ingest` changes the ingest image: the
   roll writes the digest it rolled to somewhere the deploy reads (a repo variable, or a file on the
   node), and `image_ingest` renders it. A deploy then never moves ingest.
2. **Give the deploy the roll's in-flight handling** for the three ingest services: record the runs,
   deploy, fail what was killed. The deploy would still roll ingest; it would just clean up after.
3. **Operating rule only**: never merge a muffin-ingest PR while a deploy is running or about to be
   dispatched. Cheap, and exactly the kind of rule that is forgotten.

## As built (muffin-deployment#431)

- **The running service spec is the record**, not a repo variable or a file. `muffin-roll-ingest.sh`
  reads the digest it pulled (`RepoDigests`) and updates the three services to
  `ghcr.io/gururafiki/muffin-ingest:latest@sha256:<digest>`, the string `docker stack deploy` would
  render for that digest. It then prints `== specs ==` and fails if any service is left unpinned.
- **The deploy reads the running spec** (`muffin_stack.yml`, before rendering the stack): if the
  ingest service runs a pinned image of the same `repo:tag` that `image_ingest` names, that string is
  what the stack file renders. A pinned image of a different tag, an unpinned spec, or a node with
  no ingest service falls through to `image_ingest` as before.
- Measured on a throwaway stack on the node before merging: a bare-tag roll followed by a deploy
  created a new task, while a pinned roll followed by a deploy of the same string created none.
- **First pinned roll, 2026-10-11 09:56 UTC:** all three services moved from `sha256:70756adb…` to
  `sha256:b4cc1cea…`, and all three specs read `pinned`. Before it, every spec held the bare tag the
  10-10 roll had written, so that roll is what makes the next deploy a no-op for Dagster.

## Observed 2026-10-16/17: the pin held, and the mount order restarted the code location

- **The 2026-10-16 18:56 deploy replaced the code-location task on the SAME digest**
  (`5a67c1…` → `5a67c1…`), and left the daemon and the webserver alone. The pin had held. But the
  10-14 roll's `docker service update --force --image` had rewritten the service's mounts in
  source-path order, and the stack file listed them in another order, so the deploy saw a changed
  task template. Env order is not re-sorted. The 19:06 deploy, straight after, replaced nothing.
- **muffin-deployment#436** lists the code location's mounts in source order. `quality.yml` now fails
  any service named in the roll's `SERVICES=(…)` whose mounts are listed otherwise.
- **2026-10-17, the after-a-roll case, verified.** The roll ran at 14:29 (`5a67c1…` → `df0ed5…`, all
  three pinned), and the deploy of `2e3c4ea` (#436 and #437) followed at 14:35. Afterwards all three
  containers still had `StartedAt` 14:29, and `docker service ps` showed no task newer than the roll.
- **Still unobserved:** a deploy run between an ingest merge and its roll. #110 and #112 merged after
  both 10-16 deploys and were rolled before the next one, so that case never occurred.

## Operating rule until then

- Merge a muffin-ingest PR only when you are about to roll it.
- Do not dispatch a muffin-deployment deploy between an ingest merge and its roll, unless the
  implicit roll is intended and no runs are in flight.
- **After any roll, treat the next deploy as a roll too.** Dispatch it only with no run in flight
  and no backfill running. If several deploys are queued, land them before the roll, not after.

## Done when

A deploy leaves the ingest services' image digest unchanged, and only `roll-ingest` moves it. This
is verified by two deploys that report the three services unchanged: one after an ingest merge, and
one straight after a roll.
