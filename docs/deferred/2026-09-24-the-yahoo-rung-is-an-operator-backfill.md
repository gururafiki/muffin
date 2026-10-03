# The Yahoo rung of the symbol ladder has never been run, on purpose

Created 2026-09-24 · **Check 2026-10-08** · Status: the last slice is running (2026-10-03). The
user approved the sample on 2026-09-25, then said to go ahead with the rest on the same conditions.
A failed condition stops them and goes back to the user.

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

## Prerequisite, shipped 2026-09-25

The ladder used to label every symbol probe `openfigi`, whichever rung answered. So this rung's
first run would have stored Yahoo's hits as OpenFIGI's, and a Yahoo miss would have overwritten
OpenFIGI's miss under the same key. muffin-ingest#79 (rolled 20:48 UTC) records one probe per rung
asked, under that rung's own name (`openfigi` / `yahoo`). The hit rate below can now be read
straight off `identifier_probe where provider = 'yahoo'`.

**Scheduled:** the 50-subject sample runs after the 2026-09-26 sweep finishes (~02:00 UTC). That is
~22 hours before the next sweep, and it keeps the first night of the new rotation clean to verify.

## The sample, 2026-09-26

Backfill `jcgpqnrj`, launched 20:20 UTC, 3.7 hours clear of the 00:00 sweep. Fifty subjects were
drawn from the 692 still missing a yfinance symbol, by md5 order of the security id, so the draw is
stable and not weighted toward any country. The picks are not contiguous in the grid, so the
backfill ran one run per subject; all 50 succeeded in about 20 minutes, queued behind the pools.

- **10 hits, 40 misses: a 20% hit rate.** Every hit was adopted as the security's yfinance symbol.
- **The hits are the securities OpenFIGI's local rung cannot place.** Six are incorporated
  offshore: Alibaba `9988.HK`, NetEase `9999.HK`, NIO `9866.HK`, ANTA `2020.HK` (Cayman), Flow
  Traders `FLOW.AS` and Stolt-Nielsen `SNI.OL` (Bermuda). Four have no country at all and resolved
  to Singapore lines (`C52.SI`, `F83.SI`, `MZH.SI`, `P40U.SI`). That is the fallback this rung was
  built for.
- **The misses are mostly securities with no home listing Yahoo indexes**: CN 6, US 6, KY 4, CA 4,
  GB 3, and a tail of single countries.

20% clears the ~10% bar set on 2026-09-25. So the 09-27 slice of 300 goes ahead if that night's
`raw_price_history` shows `throttled 0` and `unasked 0`.

## Slice 2, 2026-09-30

The 09-27 check ran three days late, on 2026-09-30, so it read five nights instead of one. Every
night from 09-26 to 09-30 showed `throttled 0` and `unasked 0`, and the rotation was continuous. The
sample's 50 stored answers were all ordinary search results, none an error body. Both conditions
held, so slice 2 went ahead.

Backfill `tklpqzfi`, launched 20:21 UTC, priority −1, tag `muffin/reason=yahoo-slice-2-2026-09-30`:
the next 300 of the 654 then eligible, in md5 order of the security id. 282 runs, all succeeded,
finished 22:47 UTC.

- **52 hits, 248 misses: 17.3%.** 50 hits were adopted as the security's yfinance symbol; two
  named a listing another security already holds (`symbols_held_elsewhere`), which adoption
  leaves alone by design.
- **No refusal.** All 300 stored answers are ordinary search results (`quotes` present, no error
  body), read from the raw files.
- **Where the hits are.** 32 have no country, 10 are Cayman, 3 Luxembourg, 2 Bermuda. That is the
  same pattern as the sample. The misses are mostly China (33), the US (31), Cayman (26), Bermuda
  (16) and Ireland (15).
- **The nights after it were clean.** 10-01, 10-02 and 10-03 each show `throttled 0` and
  `unasked 0` over 2,500 keys, and the rotation continued 5013→7512, 7513→10012, then wrapped
  10013→189.

## Slice 3, 2026-10-03

The 10-01 check was not run: the session that scheduled it was idle from 09-30 to 10-03. Read on
10-03 instead, all three conditions held: slice 2 clean, hit rate 17.3%, three clean nights. So the
rest went ahead.

Backfill `cnmwfbxq`, launched 09:23 UTC, priority −1, tag `muffin/reason=yahoo-slice-3-2026-10-03`:
**354 subjects**. That is every NEEDS_SYMBOL subject still in the grid with no Yahoo probe (644
needing, 350 already asked), in md5 order, none from slice 2.

**Our own deploy failed it at 09:41, not the provider.** The #398 deploy restarted the Dagster
services; the daemon iterated the backfill while the code location was down, could not find
`raw_yahoo_symbol`, and failed the backfill. 33 runs had succeeded, 1 was killed in flight and 303
were cancelled (see `2026-09-26-a-deploy-rolls-the-ingest-image.md`). The 33 stored answers are
ordinary search results (24 with quotes, 9 empty, none refused), so the conditions still held.

Backfill `fvteerkp`, launched 09:56 UTC, tag `muffin/reason=yahoo-slice-3b-2026-10-03`: the **321**
partitions of the 354 with no `raw_yahoo_symbol`, read from Dagster's partition status rather than
re-derived.

## What to do

1. Backfill `raw_yahoo_symbol` + `security_symbology` for a sample of ~50 partitions from the
   NEEDS_SYMBOL population, at midday UTC, well away from the 00:00 sweep. Read the rung's
   counters (`subjects`, `asked`) and the probes it produced:
   `select outcome, count(*) from market.identifier_probe where scheme = 'symbol' and provider = 'yahoo' and observed_at > <start> group by 1`.
2. Read the next night's `raw_price_history` counters (`throttled`, `unasked`). A non-zero value
   means the sample competed with the sweep.
3. If the hit rate is worth it and the night was clean, backfill the rest in slices of a few
   hundred on separate days. Otherwise record the hit rate here and close the note as
   "not worth the allowance".
   **Concretely, as scheduled on 2026-09-25:**
   - 50 on 09-26 after the sweep.
   - 300 on 09-27 at ~02:00 UTC, if the sample's hit rate is at least ~10% and the 09-27 night
     shows `throttled 0` and `unasked 0`.
   - The remaining ~340 on 09-28, on the same two conditions read off the 09-28 night.
   - Each slice excludes subjects that already hold a `provider = 'yahoo'` probe.
4. Only if it should run continuously: give the rung a condition behind a cron gate (like
   `ReAskAfter`), and delete the test that forbids one in the same change.

## Done when

The NEEDS_SYMBOL population has been asked once, or the measured hit rate has been recorded here
as the reason not to.
