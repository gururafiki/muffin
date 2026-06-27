# Deploying muffin-ui

`muffin-ui` is packaged as a Docker image (this directory's `../Dockerfile`):
the Expo web export served by nginx, which reverse-proxies `/api` →
`langgraph-api` (same-origin, like the chat UI). It runs as an extra Swarm
service behind Traefik at `muffin.<domain>`, alongside the legacy chat UI which
moves to `muffin-chat.<domain>`.

## `muffin-deployment.patch`

The Swarm/Traefik/Cloudflare wiring lives in the **`muffin-deployment`**
repo (a separate submodule). Because this work session is scoped to
`gururafiki/muffin` only, those edits are provided here as a patch instead of
being pushed to `muffin-deployment` directly.

Apply it from the deployment repo:

```bash
cd muffin-deployment            # the submodule / repo
git apply /path/to/muffin-ui/deploy/muffin-deployment.patch
git diff                        # review
```

It changes:
- `stack/docker-compose.yaml` — adds the `muffin-ui` service (Traefik router
  `app` → `muffin.<domain>`, port 80) and extends the API CORS allowlist to both
  UI origins.
- `stack/config.example.yml` — adds `image_app` + `app_subdomain: muffin`;
  renames `chat_subdomain` default to `muffin-chat`.
- `terraform/cloudflare.tf` + `variables.tf` + `muffin.tfvars.example` — adds the
  `app` hostname to `cf_hostnames` (DNS record + Access app are already
  `for_each` over it) and the `cloudflare_app_subdomain` var.
- `.github/workflows/deploy.yml` — threads `APP_SUBDOMAIN` / `image_app` /
  `TF_VAR_cloudflare_app_subdomain` through CI.

Also set GitHub repo variable `CHAT_SUBDOMAIN=muffin-chat` (and optionally
`APP_SUBDOMAIN=muffin`) before the next CI deploy. The image is built by
`muffin-ui/.github/workflows/build.yml` once muffin-ui is its own repo.
