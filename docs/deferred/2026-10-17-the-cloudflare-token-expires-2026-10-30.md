# The Cloudflare token expires 2026-10-30

## Why

The `CLOUDFLARE_API_TOKEN` set on 2026-10-16 reports `expires_on: 2026-10-30T18:50:47Z` at
Cloudflare's `/accounts/{id}/tokens/verify`. It is account-owned (`cfat_`), so `/user/tokens/verify`
answers 401 for it by design. The token it replaced stopped working about fourteen days after it
was set, and this one was given the same lifetime.

When it lapses, two things fail:
- **Every deploy**, at Terraform's refresh (`401 / code 10000`) before anything is applied. That is
  what blocked deploys from 2026-10-06 to 10-16:
  [note](2026-10-06-the-cloudflare-token-answers-401.md).
- **Traefik's certificate renewals**, the next time one is due. Traefik renews 30 days before
  expiry and the five origin certificates now expire 2027-01-14, so this one waits until
  mid-December. The `muffin-tls-cert-not-renewing` alert (muffin-deployment#435) fires at 25 days.

Image rolls are unaffected: `roll-ingest` goes over SSH.

## Options (the user's credential decision)

1. **A token without an expiry date**, with the same permissions: zone DNS edit, plus Access
   applications and policies. Recommended. A two-week lifetime turns every fortnight into a deploy
   outage, and nothing here rotates the token automatically.
2. **Rotate before 2026-10-30** and keep rotating. After each one, run a deploy: since #434 the new
   value reaches Traefik as a new secret.

## How to check a token

Write `Authorization: Bearer <token>` to a header file with an editor. Then run
`curl -s -H @<file> https://api.cloudflare.com/client/v4/accounts` to read the account id, and
`…/accounts/<id>/tokens/verify` to read `status` and `expires_on`. Delete the file after. The token
must never appear in a command line.

## Done when

`CLOUDFLARE_API_TOKEN` holds a token whose `expires_on` is absent or months away, and a deploy has
succeeded with it.
