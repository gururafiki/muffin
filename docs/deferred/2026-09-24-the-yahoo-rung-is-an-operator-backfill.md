# The Yahoo rung of the symbol ladder has never been run, on purpose

Created 2026-09-24 · **Check 2026-10-08** · Status: open — a decision about spending the price
sweep's provider allowance, so it is the user's

## Why it is deferred

The symbology ladder has three rungs. The two OpenFIGI rungs went live on 2026-09-24 and drained
the whole grid (muffin-ingest#70–#77). The third, `raw_yahoo_symbol`, carries **no automation
condition by design**, and a test fails if one is added
(`test_the_yahoo_rung_deliberately_carries_no_automation_condition`):

- it is **one request per subject**, where the OpenFIGI mapping rungs take a hundred jobs per
  request with the key;
- it spends **Yahoo's** allowance, which is the one the nightly price sweep lives on. On
  2026-09-19 the provider refused the sweep at call 138 of ~601, and a night that asks 46% of the
  universe is a night of missing bars.

So the Yahoo rung is an operator's backfill: the work is visible as unmaterialised partitions of
`raw_yahoo_symbol` and costs nothing until someone asks for it. This note keeps that
"until someone asks" from becoming "never".

## What is left for it, measured

The rung asks only about equities with an ISIN and **no yfinance provider symbol**
(`subjects_needing(NEEDS_SYMBOL)`), the securities OpenFIGI could not give a local line for.

```
2026-09-20  before the ladder ran         1,618
2026-09-24  after the OpenFIGI rungs        762
2026-09-25  after the repair backfill       692   (all 6,984 partitions adopted)
```

`security_symbology` already runs without it: `eager()` ignores this rung's missing partitions
(muffin-ingest#71), and the input tolerates the absent file.

## What it costs, and what is not yet known

- ~690 Yahoo search requests, once, then only for newly seeded or re-asked subjects.
- The two recent nights were **not** throttled: 300 calls a night covering 2,500 securities,
  `throttled 0` on both 09-23 and 09-24. So the allowance is not binding right now. Whether it is a
  rolling window or a daily budget, and so whether a midday backfill competes with the next
  midnight, is **not measured**.
- The hit rate is unknown. These are exactly the securities OpenFIGI could not place, so many
  may be venues keyless Yahoo does not carry either (this repo has recorded the Philippines, the
  UAE, Kuwait and Chile).

## What to do

1. Backfill `raw_yahoo_symbol` + `security_symbology` for a sample of ~50 partitions from the
   NEEDS_SYMBOL population, at midday UTC, well away from the 00:00 sweep. Read the rung's
   counters (`subjects`, `asked`) and the probes it produced:
   `select outcome, count(*) from market.identifier_probe where scheme = 'symbol' and observed_at > <start> group by 1`.
2. Read the next night's `raw_price_history` counters (`throttled`, `unasked`). A non-zero value
   means the sample competed with the sweep.
3. If the hit rate is worth it and the night was clean, backfill the rest in slices of a few
   hundred on separate days. Otherwise record the hit rate here and close the note as
   "not worth the allowance".
4. Only if it should run continuously: give the rung a condition behind a cron gate (like
   `ReAskAfter`), and delete the test that forbids one in the same change.

## Done when

The NEEDS_SYMBOL population has been asked once, or the measured hit rate has been recorded here
as the reason not to.
