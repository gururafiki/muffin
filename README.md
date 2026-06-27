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
