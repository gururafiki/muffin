# A regulator floor visits its whole grid every day

Created 2026-11-22 · Found while preparing to start `dart_filers_floor` · Status: **decided
2026-11-23 (option 1, the user); built in muffin-ingest#197, which also declares
`dart_filers_floor` and `dart_corp_codes` RUNNING**

## Why

The three regulator floors (`cninfo_filers_floor`, `dart_filers_floor`, `nse_filers_floor`) are
meant to visit each filer every 30 days. They visit nearly every filer every day.

- `floor_chunks` (`defs/segments/automation.py`) requests every width-aligned chunk of the grid
  that holds a filer on its floor day. Filers' floor days are spread by hash across 30 days, so a
  chunk of ~45 almost always holds one (1 − (29/30)^45 ≈ 78%).
- Stage 1 (`raw_cninfo_filings`, `raw_dart_filings`, `raw_nse_filings`) asks the provider for the
  list of every filer in the run's range. It has no age check, unlike the SEC lane, where "a floor
  visit is not a fetch" because the asset decides by the stored answer's age.

Measured 2026-11-22:

| Floor | Grid | Runs a day | Cost a day |
|---|---|---|---|
| `nse_filers_floor` (running since 11-20) | ~620 | 19 on 11-21, 16 on 11-22 | ~1 minute a run, ~600 NSE list requests |
| `dart_filers_floor` (stopped) | 1,096 | 24, by a dry run of 11-23 and 11-24 | ~1,100 DART list calls at ~3.5 s each, about an hour, holding `sql` because the job includes stage 2 |
| `cninfo_filers_floor` (stopped) | ~1,400 | not measured | one CNINFO search per filer |

Nothing is wrong with the data; the floors cost about 30 times their design. NSE is cheap enough not
to matter today. DART is the one that would hold the `sql` pool for an hour each morning.

## Options

1. **Stage 1 skips the list for a filer whose list is younger than the floor** (recommended). This
   is the SEC lane's rule. Due archives are still fetched: a re-queued report not held in raw
   must be fetched, and the list is not needed to know it is due. One change in each of the three
   stage-1 assets, plus tests. Afterwards a daily tick costs ~1/30 of the grid in list calls; the
   runs still start, but they are short.
2. **Run the floors on stage 1 alone**, with stage 2 as a separate step, as the drain does. That
   frees `sql`, but still lists every filer daily.
3. **Leave the floors as they are** and start DART's anyway: about an hour of DART calls a day.
4. **Keep DART and CNINFO floors stopped** and refresh them by an operator backfill once a month.

## What was built (muffin-ingest#197)

- Stage 1 of CNINFO, DART and NSE skips the list request for a filer whose stored list is younger
  than `list_max_age_days`. The default is `FLOOR_DAYS - 1` (29 days), so a list fetched on one
  floor day is due on the next.
- The filer's reports are planned from the stored list, so a due report is fetched as before, even
  when stage 2 never filed that list.
- A new outcome, `fresh`, keeps the list outcomes summing to `requested`.
- These stored lists are asked again at any age: one that was not an answer (an absence, or a
  gateway page), and a DART walk that a transport failure cut short.
- `list_max_age_days: 0` lists every filer.
- 9 new tests; 9 mutations, all caught.

**The drains synchronised every list, and they stay synchronised.** Measured on the node,
2026-11-22 23:40 UTC:

| Raw asset | Files | Stored list age |
|---|---|---|
| `raw_dart_filings` | 1,086 | all 1.1 days |
| `raw_nse_filings` | 642 | 0.6 to 6.4 days |
| `raw_cninfo_filings` | 2,173 | 0.0 to 1.1 days |

- So the floors list almost nothing until about 2026-12-19, and each grid then comes due over 2-3
  days.
- On a given day only the chunks that hold a floor-day filer run (about three in four), so the
  lists stay clustered in 2-3 consecutive days every month.
- SEC's grid behaves the same after its backfill.
- The cost is a monthly burst between 07:35 and ~10:30 UTC, before the SEC wave. The runs serialise
  on `sql`: DART ~1,100 lists at ~3.5 s, CNINFO ~2,200 searches, NSE ~640 lists.
- If that burst ever collides with something, spreading it is one more condition: ask a list that
  is 29 days old only on the filer's own floor day, or once it is two floor periods old. Each list
  would then come due on its hash-spread day, and some would wait up to 58 days once.

## Context

- `muffin-ingest/projects/muffin-ingest/src/muffin_ingest_dagster/defs/segments/automation.py`
  (`floor_chunks`, the three floor schedules) and `raw.py` (the three stage-1 assets).
- CLAUDE.md, 2026-11-03..04: "A weekday tick of `sec_filers_due` visits the whole grid", the same
  chunk shape, harmless there because SEC's asset checks age.
- DART's annual reports arrive in March and April, so no data waits on this before then.

## Done when

Each regulator floor lists a filer at most once per floor period, and `dart_filers_floor` and
`dart_corp_codes` run.
