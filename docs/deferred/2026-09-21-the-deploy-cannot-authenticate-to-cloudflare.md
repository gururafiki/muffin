# The deploy fails at Terraform: 401 from the Cloudflare API on every Cloudflare resource

Created 2026-09-21 · **BLOCKER — nothing can deploy** · Status: needs a credential the user holds

## What happens

`Deploy to Oracle Cloud` run **35634638709** (commit `47aaf53b`) failed in `Terraform apply`,
before Ansible ran at all. Every Cloudflare resource returned the same thing:

```
Error: failed to make http request
  with cloudflare_dns_record.muffin
  GET https://api.cloudflare.com/client/v4/zones/***/dns_records/4da6468efe79d36b14d96d2d9800b8ea
  401 Unauthorized
  {"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}
```

Also `cloudflare_zero_trust_access_policy.muffin[0]` and
`cloudflare_zero_trust_access_service_token.muffin_api[0]`. It fails during REFRESH, so no change
of ours is involved and nothing was applied — the stack on the node is untouched and healthy.

`code: 10000 Authentication error` is unambiguous: the credential was rejected. An outage or a
rate limit would not answer 401.

## What is known, and what is only plausible

**Known.** The last successful deploy was **2026-09-17 11:47** (`14fe1d6a`); every deploy before
that succeeded back through 09-10. This is the first failure. `gh secret list` reports
`CLOUDFLARE_API_TOKEN` last updated **2026-06-21**, along with `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_ZONE_ID` and the five OCI secrets.

**Plausible and UNVERIFIED.** Three months between 06-21 and the first 401 is the shape of a
Cloudflare API token TTL expiring. It is equally consistent with the token having been revoked or
rolled at Cloudflare. Only the token's own page can say which, and the secret's value is not
readable from here — so this note deliberately stops at the 401 rather than asserting an expiry.

## What it is holding up

Two merged, unreleased changes:

* **muffin-deployment#383** — three Grafana alerts share a copy-pasted summary, the worst being
  "market-verify has not run" arriving as *"N backlog(s) have not moved in 24 hours"*.
* **muffin-deployment#384** — Dagster captures no step stdout or stderr at all.

Neither is urgent on its own. What matters is that **the deploy path itself is down**, so the next
change that IS urgent has nowhere to go, and a stack drift or a migration would sit unapplied.

Note the ingest image roll is a SEPARATE path — `maintenance.yml`'s `roll-ingest` goes over SSH and
`docker service update`, no Terraform — so muffin-ingest#66 rolled fine at 17:49 today. That is why
the discovery lane went live while this was broken, and it is worth knowing: **a green roll says
nothing about whether a deploy would work.**

## What to do

1. Check the token at Cloudflare → My Profile → API Tokens: is it expired, revoked, or fine? Its
   scopes must still cover Zone:DNS:Edit and Account:Zero Trust (Access apps, policies, service
   tokens) for the resources above.
2. Mint or extend it, then `gh secret set CLOUDFLARE_API_TOKEN --repo gururafiki/muffin-deployment`.
3. Re-run the deploy and confirm it reaches Ansible. #383 and #384 ride it.
4. **Then check the other secrets set the same day.** All eight are dated 2026-06-21; if the
   Cloudflare one carried a 90-day TTL, the OCI API key may have its own clock. A deploy that
   fails on OCI after this is fixed would be the same lesson twice.

## Done when

A deploy reaches `ansible_playbook.muffin` and completes, #383 and #384 are live, and this note
records whether the token had expired or been revoked — because "it works again" without that
answer leaves the next expiry exactly as surprising.
