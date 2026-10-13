# The company lane's stage 2 re-reads every statements document on every visit

Created 2026-10-13 · Status: **open, check 2027-04-01** · Owner: the companies family (muffin-ingest)

## What happens

- `raw_yahoo_statements` keeps every timeseries document (Phase 4 decision 4). A statements visit
  adds two, one per frequency: ~126-167 KB of JSON each, measured 2026-10-10.
- A company's statements are asked when Yahoo names a new period or after 90 days, so about four or
  five visits a year: ~9 documents a year per company.
- `yahoo_statement` loads each partition's whole file through the I/O manager and merges every
  document per line (`statements.normalise`). It does this on every visit, including the weekly
  ones where nothing new was fetched; the writer then skips the identical rows.
- On a visit with nothing due, the Parquet manager reads the stored file and writes it back
  unchanged (`_merge_with_stored` with no new rows).

## Why it is deferred

At today's size it costs nothing worth engineering: a run of 100 companies holds ~2 documents each,
~30 MB of JSON. It grows linearly with time: ~150 MB a run after a year and ~450 MB after three,
inside the code location's 2.5 GB container, which the price night's runs share.

## What to do

Measure first: the largest `raw_yahoo_statements` file and a company run's peak RSS. Then, if
needed, either or both:

1. **Stage 2 reads only the documents newer than what core already holds.** The stored rows carry
   the fetch time of the document that last stated them (`security_statement.as_of`), and the
   writer merges into the stored lines (`merge_json`), so parsing the newer documents alone gives
   the same rows. A full re-parse, after a parser fix, stays available as a config flag.
2. **The Parquet manager skips writing a merging partition that received no rows.** The file
   already holds exactly what it would write; the tally can read the row count from the footer.
   This also helps the price lane, whose absent and refused securities rewrite their files nightly.

## Done when

A company run's peak memory is bounded by the documents fetched in that run, not by the company's
history, or the measurement shows it does not matter at the size reached.
