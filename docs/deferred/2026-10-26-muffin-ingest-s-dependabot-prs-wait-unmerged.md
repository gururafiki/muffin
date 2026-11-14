# muffin-ingest's Dependabot PRs wait unmerged, behind 107 open alerts

Created 2026-10-26 · Status: **closed 2026-11-14**: 0 open alerts, from 100 on 2026-11-09.

## Done 2026-11-11 and 2026-11-14

| PR | Bump | How it was checked |
|---|---|---|
| #116, #118 | aiohttp 3.14.3 -> 3.14.4 | CI |
| #121, #155 | filelock 4.0.1 -> 4.2.1 | CI |
| #122 | setuptools 84.0.0 -> 84.1.0 | CI |
| #120, #119 | **Pillow 12.3.0 -> 13.0.0**, both lockfiles together | `pdfplumber` 0.11.10 declares `Pillow>=12.2.0`; a PDF built in the test extracted its text and one rect and rendered to PNG through `page.to_image`; library suite 722 passed on Pillow 13 |
| #171, #170 | **soupsieve 2.9.2 -> 4.0** (opened 11-12), both lockfiles | its only dependant, beautifulsoup4 4.15.0, declares `soupsieve>=1.6.1`; CSS selection including `:has()` and `:-soup-contains()` checked; edgartools imports; library 727 and project 261 passed |
| #137 | certifi -> 2026.10.18 (project) | CI |
| #173 | certifi -> 2026.10.23 (library) | Dependabot opened no PR for the library's lockfile, so `uv lock --upgrade-package certifi`, nothing else moved |

Rolled 2026-11-11 20:02 UTC (the first six PRs) and 2026-11-14 11:07 UTC (the rest).
**Left open, not part of this note:** #114/#156 (Python 3.14/3.15, the user's own decision),
#46 (edgartools 4 -> 5), #47 (structlog 26), #80 (Dagster 1.13.28 in the local deployment) and
#165 (actions).

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
