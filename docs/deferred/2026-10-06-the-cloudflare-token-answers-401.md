# Every deploy fails: the Cloudflare token answers 401

## Why

`deploy.yml` runs 37536299564 (apply) and 37536550774 (plan), 2026-10-06 21:47 and ~21:55 UTC,
both failed while Terraform was refreshing state. Every one of the 10 Cloudflare resources got:

```
GET https://api.cloudflare.com/client/v4/zones/***/dns_records/<id>
401 Unauthorized
{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}
```

Planning failed before Ansible ran, so **nothing was applied and production is unchanged.** The last
successful deploy was 2026-10-04 18:44 UTC (run 37225592018), so the `CLOUDFLARE_API_TOKEN` secret
stopped authenticating in between: it expired, was revoked, or lost its zone permissions. Two
identical failures minutes apart rule out a transient error.

This is the same symptom as 2026-09-21, when the fix was a replacement token. Note that the token
is account-owned (`cfat_`), so it must be verified at
`/accounts/{account_id}/tokens/verify`; `/user/tokens/verify` answers 401 for a valid one.

Image rolls are unaffected: `maintenance.yml roll-ingest` goes over SSH, not Terraform.

## What is waiting on it

- muffin-deployment#422 (Stage 6: the baseline with its seed rows and privileges, `before-migrations.sql`,
  the legacy cron jobs, the index scopes) is merged and not deployed.
- Any image build that dispatches `deploy` (muffin-ui, muffin-agent, the wrappers) fails the same
  way.

## What to do

1. The user creates a replacement token with the same permissions (zone DNS edit, Access apps and
   policies) and updates the `CLOUDFLARE_API_TOKEN` secret on `gururafiki/muffin-deployment`.
2. Run `deploy.yml` with `mode=plan` and read it: no replacement, and no Cloudflare 401.
3. Run `deploy.yml` with `mode=apply`. Then verify #422 on production:
   - `supabase_migrations.schema_migrations` holds `20261006210000` and `20261006220000`;
   - `cron.job` has 16 jobs with unchanged `jobid`s;
   - `market.index_scope` still has 73 rows;
   - `metrics_ro` and `ingest_rw` can still log in.
4. The first deploy after the 2026-10-06 21:12 roll restarts Dagster. Do not run it during the
   00:00 UTC lanes or with runs in flight.

## Done when

A deploy succeeds and #422's checks above hold on production.
