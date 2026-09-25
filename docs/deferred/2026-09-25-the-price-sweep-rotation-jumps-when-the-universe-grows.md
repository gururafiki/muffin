# The nightly price sweep's rotation jumps whenever the universe grows

Created 2026-09-25 · **Check 2026-10-02** · Status: **DECIDED 2026-09-25: option B**, shipped in
muffin-ingest#78 and rolled at 20:34 UTC. Open until a week of nights has run on it.

## What happened

`nightly_prices` picks its slice from the date:

```python
start = (day * SWEEP_SLICE) % len(keys)      # day = the tick's date ordinal, SWEEP_SLICE = 2500
```

Its docstring says this "advances by exactly one slice a night on its own". That holds only while
`len(keys)` is constant. **Adding one security to the `security` grid re-maps every future slice**,
because `day × 2500 mod N` and `day × 2500 mod (N+1)` are unrelated numbers.

Measured on production, 2026-09-25:

```
tick    N        slice             overlap with earlier nights
09-23   12,267   [871, 3371)       —
09-24   12,267   [3371, 5871)      0 with 09-23
09-25   12,268   [2300, 4800)      1,071 with 09-23 + 1,429 with 09-24 = the whole slice
```

One new security arrived between 09-24 and 09-25, so the 09-25 night re-swept 2,500 securities
swept the two nights before and reached none of the 7,268 still waiting. The formula reproduces
both overlap numbers exactly.

## What it costs

- Coverage stops being a round-robin once growth is frequent, and with discovery and symbology
  live it will be. With a random start every night, the chance a given security is still missed
  after k nights is (1 − 2500/N)^k: ~33% after 5 nights and ~4% after 14. So a few hundred
  securities would sit past the lane's own 14-day staleness line most of the time.
- Staleness on 2026-09-25 (newest `price_bar` per security): ≤3 days 3,531 · 4–7 days 2,130 ·
  **8–14 days 6,056** · >14 days 29. Most of the 6,056 are there because the 09-21 (OOM) and 09-22
  (#68) nights failed. The 09-25 night could have reached them and was spent on a re-sweep.
- `no_security_is_far_behind_the_sweep` currently passes (threshold 14 days, 881 stale), and the
  8–14-day group will cross that line within days unless the rotation reaches it.

Tonight (09-26) is unaffected as long as N stays 12,268: the slices continue [4800,7300),
[7300,9800), [9800,12268), then wrap.

## Options

**A — fixed slots.** `cycle = ceil(N / 2500)`, `slot = day % cycle`, `start = slot × 2500`.
Adding keys only lengthens the last slot, and each key is swept once per `cycle` nights. The
position jumps only when N crosses a multiple of 2,500, so once per 2,500 additions. It is a pure
function, tested offline in a few lines. Switching to it would itself cost a partial night: computed
for 09-26/27 it re-sweeps 1,629 and then 2,500 recently covered keys, unless a one-off phase offset
lines it up with where the current rule is.

**B — resume after the last key the previous sweep requested.** The schedule reads its own
previous tick's runs from Dagster's run storage (`dagster/schedule_name = nightly_prices`) and
starts after the highest partition key they covered. Growth appends keys at the end, so it never
moves the position. A skipped or failed night is simply continued, and there is no transition
cost. It costs more code, and a schedule evaluation that reads run storage (still stateless on our
side, since the state is Dagster's).

**Not recommended: stalest-first.** It is what one really wants, but a `RunRequest` names a single
contiguous range, so a scattered stalest set becomes hundreds of runs.

Recommendation: **B** — it is the only one with no discontinuity at all. A is the smaller change if
the discontinuity once per 2,500 additions is acceptable.

## Decision and what shipped (2026-09-25)

**B**, approved by the user.
- **The anchor.** Every run carries `muffin/sweep_night` and `muffin/sweep_last`. The next tick
  reads the newest night strictly before its own and resumes after that night's last key.
- **Retried ticks and failed nights.** Tonight is excluded, so a retried tick yields the same run
  keys. A failed night still advances.
- **Fallbacks.** The highest range end of an untagged night (the 09-26 transition), then the date
  rule, never zero.
- **Wrapping.** Slices wrap past the end of the grid, and no run straddles it.

Proven before shipping:
- **Against production run storage:** tonight resumes at 4800, and re-evaluating 09-25 resumes at
  5871 (the old rule chose 2300).
- **By a dry run of the deployed schedule after the roll:** 100 requests, run keys
  `739885-4800` … `739885-7275`, all tagged `2026-09-26`.
- **By mutation:** 13 mutations, each caught. Two fixtures first passed with their rule deleted,
  because over a constant grid the date rule lands on the same keys.

## Done when

Consecutive ticks with a growing grid are proven disjoint by a test in which the grid grows
between ticks, the chosen rule is live, and a week of ticks shows no night re-sweeping one of the
previous four.
