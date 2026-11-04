# openbb-api sits near its memory limit

Created 2026-11-02, from the firing `muffin-container-near-oom` alert · Status: **Decided 2026-11-04 (the user):** option 1, raise the limit to 1.5 GiB. **Built in muffin-deployment#489** (deployed 2026-11-04 22:15 UTC). The limit reads 1,610,612,736 bytes, the service sat at 21.8% after its restart, and `muffin-container-near-oom` stopped firing. Done once the ~870 MiB plateau has returned without the alert (~11-06).

## Why

openbb-api has a 1 GiB limit (`muffin-deployment/stack/docker-compose.yaml`). Measured:
- 800-820 MiB for days before 10-31; back to ~810 MiB within six hours of its 10-31 restart;
- 870-874 MiB since the afternoon of 11-01, and **884 MiB (86%) at 2026-11-02 ~22:40 UTC**.

It rises to a level and holds there, so it is a plateau rather than a leak. The service was
OOM-killed at this limit once before, by one exploratory catalogue request (CLAUDE.md, "imf
OOM-kills openbb-api"). A kill drops every request in flight for ~15 s while Swarm restarts it.

Its callers today: the agent's market tools (through openbb-mcp and the `/openbb/` cache location)
and the edge resources not yet on Dagster (price targets, earnings history, and the rest of Phases
6-8). The Dagster lanes call Yahoo and SEC directly, not through it.

The node has room: 23,974 MiB total, 13,247 MiB available (2026-11-02).

## Options

1. **Raise the limit to 1.5 GiB.** One line, a deploy, and the alert clears with headroom for a
   larger request.
2. **Keep the limit and the alert**, as an early warning that a request is approaching the kill.
   The alert keeps firing while the plateau holds, and a gate left red hides the next true
   positive (CLAUDE.md, 2026-09-05).
3. **Find what holds the memory** (openbb loads each provider's extension at first use). Costs a
   profiling session on a shared production service.

Recommended: 1. openbb-api's use shrinks as Phases 6-8 move its last callers off it.

## Done when

The user has chosen, and `muffin-container-near-oom` reads 0 for openbb-api (for 1) or is
documented as a standing warning (for 2).

## Context

- `todos.md`, Phase 5 (the 2026-11-02 alert items).
- `muffin-deployment/stack/docker-compose.yaml` (`openbb-api`).
