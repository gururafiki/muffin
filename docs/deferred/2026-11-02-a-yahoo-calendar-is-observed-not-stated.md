# A Yahoo calendar is observed, not stated

Created 2026-11-02 · Planned in [the SEC spec](../specs/2026-10-24-sec-family.md) (*Deferred
notes*) · Status: open; first measure after the label drain (~2026-11-06)

## Why

A company with no SEC filing gets its fiscal calendar from the period ends Yahoo has served us
(`calendar_from_periods`, the spec's rule 6). No document states that calendar. Three
consequences:

- **No annual period, no calendar.** In the company lane's first day with the calendar step
  (2026-11-02, 1,764 securities): 1,619 calendars from Yahoo, 129 kept their SEC calendar, and
  **16 had no annual periods**, so their quarters stay unlabelled.
- **A year-end change is seen late.** Yahoo serves about four annual periods. A new year end
  becomes a new regime only once Yahoo serves it, and the old regime's last year is all we see of
  the transition.
- **The window rolls.** Yahoo drops old lines per period
  (CLAUDE.md, "Yahoo's statement window rolls per line"), so a period we stored may be absent from
  the calendar's next build and lose its label. Unmeasured.

The drain, measured 2026-11-02: `fiscal_calendar` holds 3,552 `yfinance` calendars and 3,415 SEC
ones. Yahoo statement rows still unlabelled: annual 74,465 of 172,707, quarter 67,102 of 165,912,
half 1,536 of 3,297. The company lane labels ~1,764 companies a day, so the rotation reaches the
rest by about 11-06.

**A stated anchor is already stored.** The company lane's quoteSummary document carries
`defaultKeyStatistics.lastFiscalYearEnd`, which equalled the newest period on every listing
measured in Phase 4 (CLAUDE.md, "the earnings date names the next report"). Tenth instance of "the
answer is already in a response you fetch".

## What to do, after the drain

1. Count Yahoo statements still unlabelled, by reason: no calendar, off calendar, half-year
   reporter, superseded regime.
2. Read the securities with no annual period. If most are recent listings, accept; if not,
   anchor their calendar on `lastFiscalYearEnd`.
3. Re-label a sample a week later and count labels that moved, to measure the rolling window.

## Done when

Every unlabelled Yahoo statement row has a reason in the count, and the user has decided on the
anchor.

## Context

- `muffin-ingest/libs/muffin-ingest-lib/src/muffin_ingest/facets/fiscal.py`
  (`calendar_from_periods`); `defs/companies/` (`yahoo_fiscal_calendar`).
- The SEC spec's *Fiscal calendar algorithm* (rule 6) and *Step 6*; `todos.md`, Phase 5 step 8.
