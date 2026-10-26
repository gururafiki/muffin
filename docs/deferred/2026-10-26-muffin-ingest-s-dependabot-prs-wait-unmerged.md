# muffin-ingest's Dependabot PRs wait unmerged, behind 107 open alerts

Created 2026-10-26 · Status: open

## Why

Pushing to muffin-ingest on 2026-10-26 printed "GitHub found 107 vulnerabilities on
gururafiki/muffin-ingest's default branch (12 critical, 54 high, 34 moderate, 7 low)". Read from the
Dependabot alerts API, every alert is counted twice, once per lockfile
(`libs/muffin-ingest-lib/uv.lock` and `projects/muffin-ingest/uv.lock`):

- **Pillow 12.3.0: 90 alerts, all 12 criticals among them.** Pulled in only by `pdfplumber`
  (`muffin-ingest-lib[filings]`), which nothing deployed runs yet: the PDF segment parser is Phase 6.
- **aiohttp 3.14.3:** 16 alerts.
- **filelock 4.0.1:** 6. **setuptools:** 1.

The fixes are already open as Dependabot PRs and have not been merged:
- #119 and #120: Pillow 13.0.0, a MAJOR version, so read its changelog against `pdfplumber`;
- #116 and #118: aiohttp 3.14.4;
- #121: filelock 4.2.1;
- #122: setuptools 84.1.0;
- also #47 (structlog 26), #80 (minor/patch group), #114 (python 3.14-slim) and #124 (actions).

## What to do

1. Merge the patch bumps (aiohttp, filelock, setuptools) once CI is green, then roll.
2. Pillow 13: check that `pdfplumber` 0.11.x declares support for it, run the library suite, then
   merge both lockfiles together.
3. Leave #114 (Python 3.14) for its own decision: it changes the runtime of every lane.

Roll only outside the no-roll windows; a roll kills in-flight runs (`muffin-deploy`).

## Done when

The Dependabot alert count for muffin-ingest is 0 critical and 0 high, and the merged PRs are rolled.
