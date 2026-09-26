# A deploy rolls the ingest image, without the roll's care for in-flight runs

Created 2026-09-26 · **Check 2026-10-03** · Status: open. Operating rule in the meantime below.

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

## Options

1. **Pin the digest in the deploy** (recommended). Only `roll-ingest` changes the ingest image: the
   roll writes the digest it rolled to somewhere the deploy reads (a repo variable, or a file on the
   node), and `image_ingest` renders it. A deploy then never moves ingest.
2. **Give the deploy the roll's in-flight handling** for the three ingest services: record the runs,
   deploy, fail what was killed. The deploy would still roll ingest; it would just clean up after.
3. **Operating rule only**: never merge a muffin-ingest PR while a deploy is running or about to be
   dispatched. Cheap, and exactly the kind of rule that is forgotten.

## Operating rule until then

Merge a muffin-ingest PR only when you are about to roll it. Do not dispatch a muffin-deployment
deploy between an ingest merge and its roll, unless the implicit roll is intended and no runs are in
flight.

## Done when

A deploy leaves the ingest services' image digest unchanged, and only `roll-ingest` moves it —
verified by a deploy after an ingest merge that reports the three services unchanged.
