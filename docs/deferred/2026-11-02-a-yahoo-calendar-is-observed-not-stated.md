# A Yahoo calendar is observed, not stated

Created 2026-11-02 · Planned in [the SEC spec](../specs/2026-10-24-sec-family.md) (*Deferred
notes*) · Status: open, **waiting on one decision** (the anchor, below). Measured 2026-11-07 and
again 2026-11-11: the 62 unvisited securities have calendars, and the "no annual period" case is
**one security** (VGC.TO). **The COST inside-the-span case is fixed** by muffin-deployment#506
(2026-11-08): a quarter on a 52/53-week calendar matches within 25 days, the nearest row wins, and
106 Yahoo rows of ten retailers were labelled and derived (read 2026-11-09).

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

## Measured 2026-11-07 ~00:05 UTC, after the rotation's first full week with the calendar step

Yahoo calendars: 3,552 -> **9,308**. Yahoo statement rows still unlabelled:

| Period type | 2026-11-02 | 2026-11-07 |
|---|---|---|
| annual | 74,465 of 172,707 | **2,158** of 179,583 |
| quarter | 67,102 of 165,912 | **1,912** of 177,987 |
| half | 1,536 of 3,297 | **55** of 3,339 |

Every unlabelled row has a reason. None is "a canonical period exists": the labeller is
consistent.

- **No calendar: 62 securities** (868 annual and 831 quarterly rows). They are not recent listings.
  TMRP.TA, STJ.L, WEIR.L, 2380.HK and several Shanghai lines each hold five clean December years.
  They were last visited on 2026-10-30 at ~03:37, hours before the calendar step joined the
  company job that day, and the rotation has not come back to them since. They get a calendar on
  their next visit. **This is not the "no annual period" case**, which the measurement has not met.
- **Off calendar: 213 securities annual, 266 quarterly.** Almost all hold a **SEC** calendar, which
  replaces a Yahoo one for the whole security. Among income rows, Yahoo periods lie:
  - before the SEC calendar's first period: 233 annual, 2 quarterly;
  - after its last: 93 annual, 137 quarterly (Yahoo serves a quarter before its 10-Q exists);
  - inside the span but more than 10 days from any SEC period: 281 quarterly, 10 annual.

  Calendars built from Yahoo account for 30 such rows.
- **Superseded, or a period of another class nearby:** 71 securities annual, 24 quarterly.

**COST shows the inside-the-span case** (read as anon from `security_metric_series`, 2026-11-07).
Three quarters still appear twice, because Yahoo dates them at the month end (2025-05-31,
2026-02-28, 2026-05-31) and Costco's 12/12/12/16-week quarters end on a Sunday 13-21 days earlier
(05-11, 02-15, 05-10). That is beyond the 10-day window, so Yahoo's rows stay unlabelled and get
their own columns. The values are identical. A rule matching a Yahoo month-end to the canonical
period ending in the same month, within ~31 days and with no nearer period of its class, would
label them. That is a change to `market.label_fiscal_periods`, for the user.

## Measured 2026-11-11 ~15:40 UTC (the 11-10 check-in, read a day late)

Yahoo calendars: 9,308 -> **9,369** over 9,244 securities; SEC calendars 3,619 over 3,417.

| Period type | 2026-11-07 | 2026-11-11 |
|---|---|---|
| annual | 2,158 of 179,583 | **1,306** of 179,605 (279 securities) |
| quarter | 1,912 of 177,987 | **903** of 183,532 (174 securities) |
| half | 55 of 3,339 | **23** of 3,351 (9 securities) |

Every unlabelled row still has a reason:

| Reason | Annual rows | Quarter rows | Half rows |
|---|---|---|---|
| No calendar | 0 | 10 (1 security) | 0 |
| Off calendar, before the calendar's first period | 706 (181 securities, all SEC calendars) | 10 | 1 |
| Off calendar, after its last | 303 (27, SEC) | 548 (461 SEC, 87 Yahoo) | 14 |
| Off calendar, inside the span | 26 (8, SEC) | 287 (285 SEC) | 0 |
| A superseded period, or one of another class, within 10 days | 271 | 45 | 8 |
| A canonical period in the window, and a nearer row took the label | 0 | 3 | 0 |

- **The 62 unvisited securities have calendars.** "No calendar" fell from 62 securities to one.
- **The "no annual period" case exists, once: VGC.TO** (Valor Gold Corp, Canada). It holds ten
  quarterly rows for 2025-03-31 to 2026-06-30 and no annual row. Yahoo was asked again on
  2026-11-11 at 04:30 and still serves no annual statement. The stored quoteSummary document does
  state the year: `lastFiscalYearEnd` 2025-12-31, `mostRecentQuarter` 2026-06-30. A second security
  has no Yahoo annual row and holds a SEC calendar, so it is labelled.
- **Off calendar is almost all SEC calendars**, as on 11-07: Yahoo periods outside the span of the
  filings SEC holds. They stay unlabelled by design, since the SEC calendar replaces Yahoo's for
  the whole security.

**The anchor decision, for the user.** One security of 9,245 has quarters and no annual period.
- **Accept (recommended).** Ten rows stay unlabelled until Yahoo serves a year. No code.
- **Anchor on `lastFiscalYearEnd`.** `calendar_from_periods` would take the stated year end when
  no annual period exists. It costs a rule and its tests for one company today, and covers any
  recent listing that arrives the same way.

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
