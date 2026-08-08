# Muffin

Multi-agent **stock-analysis** system built on LangGraph — a council of 13 famous-investor personas,
criteria-driven analysis, deep research, and a trading-decision pipeline — deployed on
**Oracle Cloud Always-Free** (single ARM node, Docker Swarm) behind Traefik + Cloudflare Access.

This is the **umbrella repo**: it pins all the pieces together as git submodules.

> **Live:** chat UI → https://muffin.rafiki.guru · API → https://muffin-api.rafiki.guru
> (both behind Cloudflare Access).

## Repositories (submodules)

| Submodule | What it is | Image |
|---|---|---|
| [`muffin-agent`](https://github.com/gururafiki/muffin-agent) | The LangGraph agent (4 graphs: `stock_evaluation`, `criteria_analysis`, `research`, `council`) | `ghcr.io/gururafiki/muffin-agent` |
| [`muffin-deployment`](https://github.com/gururafiki/muffin-deployment) | Terraform + Ansible + Swarm stack + service configs + deploy CI | — |
| [`openbb-mcp-docker`](https://github.com/gururafiki/openbb-mcp-docker) | OpenBB MCP server (market data) | `ghcr.io/gururafiki/openbb-mcp-docker` |
| [`agent-chat-ui-docker`](https://github.com/gururafiki/agent-chat-ui-docker) | Legacy chat UI (Next.js, same-origin `/api` proxy) — `muffin-chat.<domain>` | `ghcr.io/gururafiki/agent-chat-ui-docker` |
| `muffin-ui` | New app: Expo/React Native (Web·iOS·Android), static web + nginx `/api` proxy — `muffin.<domain>` | `ghcr.io/gururafiki/muffin-ui` |
| [`nuq-postgres-docker`](https://github.com/gururafiki/nuq-postgres-docker) | arm64 Firecrawl `nuq-postgres` | `ghcr.io/gururafiki/nuq-postgres-docker` |
| [`langchain-opensandbox`](https://github.com/gururafiki/langchain-opensandbox) | OpenSandbox backend for LangChain deep agents (MIT) — a library, not a service; extracted from `muffin-agent` and shared with the LangChain community | — (PyPI) |

Each image repo builds its own arm64 image in CI (GHCR); `muffin-deployment` references them.

> **`muffin-ui`** currently lives as a top-level directory in this umbrella repo (not yet a
> submodule). It will be extracted into its own `gururafiki/muffin-ui` repo and re-added as a
> submodule; its image-build workflow (`muffin-ui/.github/workflows/build.yml`) activates then.

## Architecture

```
                       Cloudflare (DNS + Access)
        │ muffin.<domain>   │ muffin-chat.<domain>   │ api.<domain>
        ▼                   ▼                        ▼
        ┌──────────────────────── Traefik (LE / CF DNS-01) ───────────────────────┐
        │   muffin-ui ──/api─┐                                                      │
        │   agent-chat-ui ──/api─┴─►  langgraph-api (muffin-agent)                  │
        └───────────────────────────────────────────┬─────────────────────────────┘
   private overlay network (nothing else exposed)    │
   openbb-mcp · firecrawl(api/mcp/playwright/redis/rabbitmq/postgres=nuq) · searxng ·
   opensandbox · langgraph-postgres · langgraph-redis                 (15 services total)
```

## Quickstart

```bash
git clone --recurse-submodules git@github.com:gururafiki/muffin.git
cd muffin
```

**Deploy** (one command provisions the VM + Cloudflare **and** runs Ansible — the `ansible/ansible`
Terraform provider + `cloud.terraform` dynamic inventory; no `generate_inventory.sh`):

```bash
cd muffin-deployment
cp stack/config.example.yml stack/config.yml          # domain, image refs, models
cp stack/secrets.example.yaml stack/secrets.yaml      # API keys, passwords, CF DNS token
cp terraform/muffin.tfvars.example terraform/terraform.tfvars   # OCI + Cloudflare + key paths
pip install ansible-core && ansible-galaxy collection install cloud.terraform
cd terraform && terraform init && terraform apply     # VM + Cloudflare + Swarm + 14-service stack
```

Then set Cloudflare SSL/TLS → **Full (strict)**. Full runbook: [`muffin-deployment/README.md`](https://github.com/gururafiki/muffin-deployment#readme).

**Deploy from CI:** `muffin-deployment` has a `Deploy to Oracle Cloud` workflow (`workflow_dispatch`)
driven by individual GitHub secrets/variables (needs a remote TF state backend).

## Calling the deployed API

### Use the API hostname for the interactive reference

**API reference → https://muffin-api.\<domain\>/docs** (Scalar, served by langgraph-api).

**Do not use `https://muffin.<domain>/api/docs`** — it renders, but no request it sends can work.
langgraph-api inlines an OpenAPI document with **no `servers` key**, so the client falls back to the
page origin and misses the `/api` prefix that exists only because `muffin-ui`'s nginx strips it. It
fails *silently*: the wrong URL returns `200 text/html` (the SPA shell), so the client reports success
on a nonsense response. On the API hostname the API really is at the origin root, so everything
resolves correctly with no workaround. A design to patch the app-host page was written and
deliberately dropped — see
[`muffin-ui/docs/superpowers/specs/2026-08-03-api-docs-base-url-design.md`](muffin-ui/docs/superpowers/specs/2026-08-03-api-docs-base-url-design.md).

> Known nit, both pages: with no `servers` the *displayed* curl sample is relative
> (`curl /assistants`) and isn't pasteable. Execution is unaffected.

### Two auth layers

Both must be satisfied, and they fail differently.

1. **Cloudflare Access** (perimeter, from `muffin-deployment/terraform/cloudflare.tf`) — browsers use
   the email/SSO login (24h session); scripts send the service token as
   `CF-Access-Client-Id` + `CF-Access-Client-Secret`.
2. **LangGraph identity** ([`muffin-agent/auth.py`](muffin-agent/auth.py)) —
   `Authorization: Bearer <Supabase **user** access token>`. Reads are open to anonymous callers;
   **creating a thread or starting a run requires sign-in** ("read-shared, write-authenticated").

Verified against `POST /threads`:

| Credential sent | Result |
|---|---|
| none (Access only) | **403** `Forbidden` — anonymous is read-only |
| Supabase user `access_token` | **200**, and `metadata.owner` = your user UUID |
| `SUPABASE_SERVICE_ROLE_KEY` | **401** `Invalid or missing credentials` |
| `SUPABASE_ANON_KEY` | **401** |
| malformed token | **401** |

**403 vs 401 is the diagnostic:** 403 means *no* credential was sent; 401 means one was sent and
failed verification. `auth.py` fails loud rather than silently downgrading a signed-in client.

### Get a token, then write

```bash
# 1. GoTrue password grant. The Supabase hostname is deliberately PUBLIC (no Access app —
#    see cf_public_hostnames in cloudflare.tf), so this call takes NO CF headers.
TOKEN=$(curl -s -X POST "https://supabase.<domain>/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"…"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# 2. Write, with BOTH layers present.
curl -X POST "https://muffin-api.<domain>/threads" \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{}'

# 3. Start a run — assistant_id accepts the graph name directly.
curl -X POST "https://muffin-api.<domain>/threads/$THREAD_ID/runs" \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"assistant_id":"trading_decision","input":{…},"config":{"configurable":{…}}}'
```

**From the `/docs` page:** Access is already satisfied by your SSO cookie. Pass the token via the
**`Headers`** tab — key `Authorization`, value `Bearer <token>`. The `Select Auth Type` picker comes
up **empty**, because the document declares no `securitySchemes`.

### Gotchas

- **Never send the anon or service_role key** as the bearer — both 401 on the `aud=authenticated`
  claim check. Only real user sessions authenticate.
- **Don't mint a Supabase JWT locally** — `auth.py` verifies `iss` against the server's
  `SUPABASE_URL` (`<url>/auth/v1`), so a self-signed token 401s. Use the password grant.
- Access tokens expire (~1h); re-run the grant or use the `refresh_token` it also returns.
- `MUFFIN_API_TOKEN` — the shared-bearer `api-client` identity that is fully **exempt** from the
  write rules — is **not configured** in this deployment, so there is no long-lived shared token.
- `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` are also unset, so `auth.py`'s Cloudflare-Access-JWT mode
  is off: Access is purely the perimeter and identity comes only from Supabase.

## Working with submodules

```bash
git submodule update --remote --merge        # pull latest of every submodule
git -C muffin-agent checkout main && ...      # work inside a submodule, commit/push as usual
git add muffin-agent && git commit -m "bump muffin-agent"   # then pin the new commit here
```

## Development

Local dev (LangGraph dev server + the MCP/infra services) lives in
[`muffin-deployment/compose`](https://github.com/gururafiki/muffin-deployment); agent dev docs are in
[`muffin-agent`](https://github.com/gururafiki/muffin-agent) (`CLAUDE.md`, `docs/`).

## License

GNU GPL v3.0 — see [LICENSE](LICENSE). Each submodule is GPLv3; third-party images they wrap retain
their own upstream licenses.
