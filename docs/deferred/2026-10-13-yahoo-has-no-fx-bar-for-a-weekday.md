# Yahoo has no FX bar for a weekday, and the stale-body guard fails it for good

Created 2026-10-13 · Status: **CLOSED 2026-10-13** — option 3 decided and shipped (muffin-ingest#111,
rolled 21:24 UTC); Yahoo filled the day late, and the re-run after the roll stored all 41 rates

## Resolved (2026-10-13)

- **Decided:** option 3, the rule as decided plus a re-read.
- **Shipped:** muffin-ingest#111, rolled 21:24 UTC (`5a67c183…`). A weekday with no rate of its own
  fails only when every body predates the day's end; otherwise it materialises empty and is named in
  `provider_skipped_days`. Each night also offers the days before its own, insert-only.
- **Yahoo filled the day between 19:07 and ~21:30 UTC on 10-13**, about 21 hours after it ended.
  The re-run after the roll (backfill `xzgwjcij`) published 41 rates for 10-12 (EUR 1.12047),
  `provider_skipped_days: none`. Under the new rule the 10-14 00:00 night would have filled it by
  itself, from the 10-13 body.
- **Still to read:** the 10-14 00:00 run, the first night on the new code (`reread_offered`,
  `refilled`, and the 10-13 rates).

## What happened

- `daily_fx` failed at 2026-10-13 00:00 UTC (run `4d1f9d2d`) on partition 2026-10-12, a Monday:
  `fx_rate` raised *"no rate inside the window of weekday partition(s) 2026-10-12 while the stored
  bodies carry rates for other days: a stale or cached answer"*.
- **The body was not stale.** EURUSD=X's `regularMarketTime` was 2026-10-13 00:00:27, and its
  daily series ran Thu 10-08, Fri 10-09, Tue 10-13 (close null), then the live tick. Monday is
  simply absent.
- **Re-materialising does not help.** The recovery backfill `vzvzhniq` (19:07 UTC, run
  `d88f1ac4`) fetched a fresh body with the same gap and failed the same way. A one-month request
  (`range=1mo`) has every weekday from 10-01 to 10-09 and no 10-12.
- **It is not a US-holiday rule.** 10-12 was Columbus Day, but Labor Day (2026-09-07) has a stored
  rate. Every stored day from 09-25 to 10-09 equals Yahoo's bar for it.
- **Cost of the gap today:** conversions take the most recent rate at or before a bar, so Monday's
  bars use Friday's rate.

## Why it stays failed

The 2026-09-17 decision (option C in
[the stale-cache note](2026-09-16-http-cache-serves-stale-to-daily-lanes.md)) was to fail a
partition when *"a body's `regularMarketTime` predates the partition's window end and no point
falls inside the window"*. muffin-ingest#42 built a broader rule: fail any weekday with no rate
inside its window when the bodies carry rates for other days. It reported one accepted edge, 25 Dec
and 1 Jan. A weekday Yahoo leaves out is a second edge. A re-run cannot fix it, so the partition
stays failed unless Yahoo fills the day.

## Options

1. **The rule as decided.** Fail only when the body is stale: its newest point and
   `regularMarketTime` both predate the window end. A fresh body without the day materialises the
   partition empty, with a counter (`provider_skipped_day`). If Yahoo fills the day later, nothing
   picks it up.
2. **Keep the broad rule.** Re-run the partition by hand if Yahoo fills the day. A permanently
   failed partition is the signal.
3. **Option 1 plus a re-read.** Each night also publishes the earlier days its five-day body
   carries, as the price lane re-reads 7 days (`REREAD`). A day Yahoo fills within five days is
   then published by a later night. This changes the rule that a partition publishes only its own
   day. The writer already skips rows whose values did not change, so the re-read costs no writes.

Recommendation: 3. It fixes this case, and a day Yahoo fills late then arrives by itself, which
the prices lane shows happens.

## Done when

Either the 2026-10-12 partition is materialised (empty, or with Yahoo's late bar), or the user has
chosen to keep the broad rule and this note is closed with that decision.
