# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is the **umbrella repo** for **Muffin** — a multi-agent stock-analysis system built on LangGraph
(a council of investor personas, criteria-driven analysis, deep research, and a trading-decision
pipeline). It contains almost no code of its own: its job is to **pin the six component repos
together as git submodules** and ship the cross-cutting deploy runbook ([README.md](README.md)).

Deployed on **Oracle Cloud Always-Free** (single ARM `A1.Flex` node, single-node Docker Swarm) behind
**Traefik** (Let's Encrypt via Cloudflare DNS-01) + **Cloudflare Access**. Live: Expo app →
`muffin.rafiki.guru`, legacy chat UI → `muffin-chat.rafiki.guru`, API → `muffin-api.rafiki.guru`
(all behind Access).

## Submodules

Each submodule is its own GitHub repo and the source of truth for its own area. **Read the linked
docs before working inside a submodule** — do not re-derive that detail here.

| Submodule | What it is | Image | Where to read |
|---|---|---|---|
| `muffin-agent` | The LangGraph agent — 4 deployed graphs + persona council, criteria analysis, deep research, trading-decision pipeline | `ghcr.io/gururafiki/muffin-agent` | **[muffin-agent/CLAUDE.md](muffin-agent/CLAUDE.md)** (exhaustive) + `muffin-agent/docs/`, `muffin-agent/.claude/skills/` |
| `muffin-deployment` | Terraform + Ansible + Swarm stack + service configs + deploy CI + local-dev compose | — | [muffin-deployment/README.md](muffin-deployment/README.md) |
| `openbb-mcp-docker` | OpenBB MCP server (market data), arm64 build | `ghcr.io/gururafiki/openbb-mcp-docker` | [openbb-mcp-docker/README.md](openbb-mcp-docker/README.md) |
| `muffin-ui` | Expo/React Native client (Web/iOS/Android), Expo-web static SPA + nginx `/api` proxy, arm64 build — served at `muffin.*` | `ghcr.io/gururafiki/muffin-ui` | [muffin-ui/README.md](muffin-ui/README.md), [muffin-ui/ROADMAP.md](muffin-ui/ROADMAP.md) |
| `agent-chat-ui-docker` | Legacy chat UI (Next.js, same-origin `/api` proxy), arm64 build — served at `muffin-chat.*` | `ghcr.io/gururafiki/agent-chat-ui-docker` | [agent-chat-ui-docker/README.md](agent-chat-ui-docker/README.md) |
| `nuq-postgres-docker` | arm64 rebuild of Firecrawl's `nuq-postgres` queue DB | `ghcr.io/gururafiki/nuq-postgres-docker` | [nuq-postgres-docker/README.md](nuq-postgres-docker/README.md) |

**The detailed agent architecture (MuffinAgentBuilder, middleware stack, the persona/criteria/research/
trading-decision graphs, memory routes, testing rules) lives in [muffin-agent/CLAUDE.md](muffin-agent/CLAUDE.md).**
This umbrella file only covers the cross-submodule picture.

## Runtime architecture (cross-submodule)

- **Image supply chain:** each `*-docker` submodule builds its **own arm64 image in CI** and pushes to
  GHCR. `muffin-deployment` references those `ghcr.io/gururafiki/*` tags in its Swarm stack — it builds
  nothing itself. ARM64 is mandatory (the Oracle node is aarch64); upstream amd64-only images can't
  schedule there, which is why `nuq-postgres-docker` exists at all.
- **Request path:** Cloudflare (DNS + Access) → Traefik → a UI that proxies `/api` → `langgraph-api`
  (the `muffin-agent` image). Two UIs are exposed: the Expo app (`muffin.*`, `muffin-ui`) and the
  legacy chat UI (`muffin-chat.*`, `agent-chat-ui`); plus the LangGraph API (`muffin-api.*`).
- **Private overlay (~14 services total, none externally exposed):** `openbb-mcp`, Firecrawl
  (api/mcp/playwright/redis/rabbitmq + `firecrawl-postgres` = `nuq-postgres`), `searxng`, `opensandbox`,
  `langgraph-postgres`, `langgraph-redis`. See `muffin-deployment/stack/docker-compose.yaml` for the
  full stack + per-service memory budget.

## Working with submodules (the umbrella's core workflow)

```bash
# Clone everything (the --recurse-submodules is required)
git clone --recurse-submodules git@github.com:gururafiki/muffin.git

# Pull latest of every submodule
git submodule update --remote --merge

# Make a change INSIDE a submodule: commit + push it in the submodule's own repo FIRST,
# then return to the umbrella and pin the new commit:
git -C muffin-agent checkout main           # submodules can land in detached HEAD after clone/update
#   ... edit, commit, push inside muffin-agent ...
git add muffin-agent && git commit -m "bump muffin-agent"   # pins the new submodule commit here
```

Gotchas: a fresh checkout leaves submodules in **detached HEAD** — `git checkout main` inside the
submodule before committing. A change isn't live until it's (1) committed/pushed in the submodule,
(2) its image is rebuilt by CI (for the `*-docker` repos / `muffin-agent`), and (3) the new commit is
pinned here and deployed. The umbrella tracks a specific commit per submodule, not a branch.

## Commands

### Deploy — `muffin-deployment` (one `terraform apply` provisions infra AND runs Ansible)

```bash
cd muffin-deployment/stack
cp config.example.yml config.yml && cp secrets.example.yaml secrets.yaml   # domain, image refs, models, secrets
cd ../terraform && cp muffin.tfvars.example terraform.tfvars               # OCI + Cloudflare + key paths
pip install ansible-core && ansible-galaxy collection install cloud.terraform
terraform init && terraform apply        # VM + Cloudflare DNS/Access + Swarm + the full stack
# then in Cloudflare: SSL/TLS -> Full (strict)
```

Terraform itself runs Ansible (via the `ansible/ansible` provider + `cloud.terraform` dynamic
inventory — there is **no** `generate_inventory.sh`). State lives in OCI Object Storage via the
S3-compatible backend, so CI and local runs share state. CI deploy: the `Deploy to Oracle Cloud`
workflow (`workflow_dispatch`). Full runbook + remote-state env vars: [muffin-deployment/README.md](muffin-deployment/README.md).

### Local development — agent + infra

```bash
# Infra services the agent depends on (run from muffin-deployment/compose):
docker compose up -d openbb-mcp firecrawl-mcp searxng

# Then develop the agent. Easiest path (VSCode): press F5 on "LangGraph Dev Server (Debug)" —
# docker compose brings up infra + chat UI, `langgraph dev` runs on the host under debugpy,
# UI at http://localhost:3000 routes to it, breakpoints fire in muffin-agent/src on every request.
```

Set `MEMORY_DEBUG_USER_ID` in the dev stack so agents that need `/memories/` don't raise
`MemoryUnavailableError` against clients (like agent-chat-ui) that don't populate `user_id`.

### Agent build / test / lint — run inside `muffin-agent`

These are documented in [muffin-agent/CLAUDE.md](muffin-agent/CLAUDE.md); the essentials:

```bash
cd muffin-agent
pip install -e ".[dev]"            # runtime + dev deps
pytest                             # all tests   (pytest -m unit | -m integration | <path> for subsets)
ruff check src/ tests/ && ruff format src/ tests/
mypy src/
```

CLI entrypoints (`muffin = muffin_cli.main:main`): `muffin decide`, `muffin criteria-analyze`,
`muffin research`, `muffin persona`, plus the specialist signals — all require the local MCP/infra
stack above.

## Deployed LangGraph graphs

`muffin-agent/langgraph.json` registers the graphs LangGraph Platform serves (Python 3.13, auth via
`auth.py`): `stock_evaluation`, `criteria_analysis`, `research`, `council`, `trading_decision`. Adding/changing a
deployable graph is a `muffin-agent` concern — see its CLAUDE.md (every registered graph requires an
integration test, enforced by the suite).

## Conventions

- **License: GNU GPL v3.0** ([LICENSE](LICENSE)). Each submodule is GPLv3; third-party images they wrap
  keep their upstream licenses.
- **All published images are arm64** (Oracle A1 / aarch64). Anything new that runs on the node must
  have an arm64 build.
- Coding conventions, collaboration preferences, and "memorize lessons in CLAUDE.md" rules are
  defined per-submodule — for the agent, follow [muffin-agent/CLAUDE.md](muffin-agent/CLAUDE.md).
