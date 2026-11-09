# An amended Form 4 restates the original

Created 2026-11-02 · Planned in [the SEC spec](../specs/2026-10-24-sec-family.md) (*Deferred
notes*) · Status: **closed 2026-11-04** (the guard test holds an original and its 4/A). **Decided 2026-11-04 (the user):** option 2, the summary view skips a superseded original; then measure how the data sets mark amendments. **Built in muffin-deployment#490** (deployed 2026-11-04 22:15 UTC).

## As built, 2026-11-04

**The key is narrower than the decision's wording.** An amendment can restate only the lines it
corrects, so "issuer, owner and day" would also drop real trades. Measured:
- one 4/A restates only a derivative grant (30,864 -> 31,397 shares), and leaves the same day's
  11,626-share purchase at 129.02 standing;
- three 4/As of 2026-11-02 each restate only line `nd:1` of a Form 4 whose other lines stand.

So a line is superseded only by an amendment line with the same security, owner, transaction day,
derivative flag and transaction code, filed on or after it.
- **In the 90-day window:** 350 lines rather than 431. 86 securities move, and no buyer or seller
  count changes.
- **Still uncovered:** 14 lane groups hold more original lines than amendment lines even at that
  key. The XML carries no per-line link, so nothing narrower exists.

**How the data sets mark amendments:** as their own accession, `4/A` beside `4` (15,047 against
584,889 lines in 2006-07), with no field naming the original. One rule therefore covers both sources,
and option 1 (retract by accession) is not possible from either.

## Why

A Form 4/A amends a Form 4 already filed. It usually restates the whole table with a correction,
so the original's lines are superseded. The Form 4 lane stores both, keyed by accession and line
(`insider_trade (security_id, accession_number, line_key)`), and `security_insider_summary` does
not read `form_type`, so it counts both.

Measured 2026-11-02 over the lane's rows (Form 4 days 08-01..11-01): 60,641 Form 4 lines in
24,768 accessions, and **661 Form 4/A lines in 293 accessions**. Matched against the originals by
security, owner CIK and transaction date:

| 4/A lines | Count | In the summary |
|---|---|---|
| repeat an original line exactly (same code, shares, derivative flag) | 249 | counted twice |
| share an owner and day with an original but differ | 151 | the corrected and the superseded line both counted |
| no original in the table (filed before 08-01, or under another issuer) | 261 | counted once, correctly |

So about 400 lines, 0.7% of the lane's rows, are counted twice or counted with the value they
corrected. The summary's 90-day buyer and seller counts can move by one person where it happens.

The insider data sets (decision 4, for history) carry amendments too. How they mark the original
is unmeasured.

## Options

1. **The amendment supersedes its original's lines.** A 4/A's XML carries
   `dateOfOriginalSubmission`, not the original's accession, so the original is found by issuer,
   owner and filing date; stage 2 then retracts its lines. Exact, and a little more code.
2. **The serving view excludes a superseded original**: a Form 4 line with a later 4/A for the
   same issuer, owner and transaction date is not counted. One view change; the raw table keeps
   both, which is how a restatement stays visible.
3. **Accept it**: 0.7% of lines, and the summary is a count of people.

Recommended: 2, then measure how the data sets mark amendments before the history backfill
decides whether 1 is needed.

## Done when

The user has chosen, and a guard test holds an original and its 4/A with different shares and
asserts the summary counts the 4/A's.

## Context

- `muffin-ingest/libs/muffin-ingest-lib/src/muffin_ingest/facets/insider.py`.
- `muffin-deployment/stack/supabase/schemas/` (`security_insider_summary`).
- The SEC spec's *Step 6*; `todos.md`, Phase 5.
