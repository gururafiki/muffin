# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is the **umbrella repo** for **Muffin** — a multi-agent stock-analysis system built on LangGraph
(a council of investor personas, criteria-driven analysis, deep research, and a trading-decision
pipeline). It contains almost no code of its own: its job is to **pin the seven component repos
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
| `langchain-opensandbox` | OpenSandbox backend for LangChain deep agents (MIT) — extracted from `muffin-agent` 2026-08-08 and shared with the community. **A library, not a service**: no image, no deployment, nothing in the Swarm stack. `muffin-agent` depends on it. | — (PyPI) | [langchain-opensandbox/README.md](langchain-opensandbox/README.md) |

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
- **Private overlay (~14 services total, none externally exposed):** `openbb-mcp`, `openbb-api`, Firecrawl
  (api/mcp/playwright/redis/rabbitmq + `firecrawl-postgres` = `nuq-postgres`), `searxng`, `opensandbox`,
  `langgraph-redis`. See `muffin-deployment/stack/docker-compose.yaml` for the
  full stack + per-service memory budget.
- **`langgraph-postgres` is no longer rendered post-cutover.** It is wrapped in
  `{% if not use_supabase_db %}` (the stack template's only Jinja control block); with
  `USE_SUPABASE_DB=true` it simply isn't in the stack, freeing 1 GB. Its `langgraph-data` volume is
  still declared on purpose, so flipping the flag back is a real rollback.

## The market-data path (UI ← Supabase ← OpenBB)

Added 2026-08-09. muffin-ui's Globe/Markets numbers were authored constants in the JS bundle;
sector performance is now real. The chain, and why each hop exists:

```
muffin-ui  ──supabase.schema('market').select()──►  PostgREST (supabase-rest)  ──►  market.performance
           ──supabase.functions.invoke()────────►  edge fn market-refresh  ──fetch──►  openbb-api:6900
```

- **Reads have no API server in the path.** `market.*` is a Postgres schema exposed through PostgREST
  — the same component `user_backups` already used. Adding an endpoint is adding a table, not code.
  **PostgREST *is* `supabase-rest`**; it is not a separate thing to install.
- **`openbb-api` is a second service from the `openbb-mcp-docker` image**, not a new repo:
  `openbb-core` hard-depends on fastapi/uvicorn, so the REST app is already installed. This is why
  no Deno MCP client was needed. Route convention `obb.x.y.z` → `/api/v1/x/y/z` is **not perfectly
  regular** (`/equity/price/performance` vs `/etf/price_performance`) — check `/openapi.json`.
- **finviz + yfinance are keyless**, which is what makes this free. `equity/compare/groups`
  (sectors) is finviz-only and **US-listed only** — do not relabel it as global.
- **Per-symbol performance has no ready-made endpoint here.** finviz's `price_performance` is
  **broken upstream** (mangles the symbol: `AAPL` → `'AAAPL' is not in list`, 422) and fmp's
  `etf/price_performance` is a **premium** endpoint that 402s on this deployment's free key. So
  country returns are computed from `etf/historical` (yfinance, keyless) — ~5.2y of daily closes
  for all 19 country ETFs in ONE batched call (~4 MB, ~5 s; the provider adds a `symbol` column
  only when several are requested). That is also why countries offer 3Y/5Y and sectors do not.
  They are **price** returns — dividends excluded.
- **Classification data is server-owned and editable.** Memberships upsert `do nothing` so a
  redeploy cannot revert a Studio correction; schemes/groups/countries upsert `do update`.
  `WorldMap` takes a resolved `Scheme`, not an id.
- **Hong Kong has no SVG path in `world-geo.ts`** despite being modelled and drillable, so
  anything iterating `WORLD_GEO` alone silently drops it — the seed generator unions the map ISOs
  with `COUNTRIES`.
- **`with_fileglob` does NOT sort.** The first deploy of this ran the migrations `04, 01, 05,
  02, 03` and failed (`schema "market" does not exist`) — Ansible returns filesystem order, so
  the numeric prefixes meant nothing until the glob was piped through `| sort`.
- **An instrument's provider symbol is not always its ticker.** `market.instruments.price_symbol`
  carries the difference (NESN → `NESN.SW` on yfinance; the bare ticker returns an **empty 200**,
  which makes `res.json()` throw a `SyntaxError` naming neither call nor symbol). Every other
  seeded name has a US listing or ADR, which is why exactly one row failed.
- **`force: true` bypasses the TTL — SERVICE-ROLE ONLY.** `begin_refresh` correctly skips inside
  the TTL, which gets in the way when data is fresh and *wrong*. `force` also clears the error
  backoff but NOT the in-flight lock, so concurrent forced refreshes still collapse into one
  upstream fetch. The role check is load-bearing: the anon key is public, and a public
  cache-buster is a free way to hammer the provider.
- **The price refresh is BATCHED (12 symbols at a time) and that is load-bearing.** Doing the
  whole universe at once returned Kong's *bare* 502 — the worker died rather than answering, so
  the function's try/catch reported nothing. Ruled out by measurement: the fetch (a LARGER one
  succeeds), the write (real rows upsert in ~0.1s), and the code (identical run returns 200 on the
  same edge-runtime image locally). Never reproduced off the node. Batching bounds peak memory to
  one batch and makes any recurrence name the batch. **A bare 502 from an edge function means the
  worker died — look at memory, not at your error handling.**
- **`market.prices` is deliberately a ~400-day window**, daily for the recent 90 days and weekly
  before that (~107 bars/symbol). It exists because the
  performance refresh already downloads full daily history and discards it. The chart offers
  1M/3M/6M/1Y only — it never offers a range it cannot draw, while the 3Y/5Y *numbers* still come
  from `market.performance`.
- **Chart windows anchor on the LAST BAR, not `Date.now()`.** Wall-clock in render is impure and
  React Compiler rejects it; anchoring on the data also means a stale series draws a full month
  instead of shrinking toward empty.
- **Sub-sectors come from `equity/profile.industry_category`, NOT `.industry`** — the latter is
  present on the yfinance response and always null. `equity/screener` cannot do this job at all:
  yfinance's returns no sector/industry/country columns and orders by day change, and index
  constituents are gated on both providers (fmp premium/402, cboe has no `^GSPC`).
- **`market.instruments.sector_id` is a CURATED placement, kept next to the fetched
  `provider_sector`** rather than overwritten — yfinance says "Financial Services" where muffin
  says "financials". Same reason memberships upsert `do nothing`: editorial choices live in the
  DB and a redeploy must not revert them.
- **OpenBB returns performance as a FRACTION** (`-0.0366` = −3.66%) while the UI wants percent.
  Guarded by `functions/market-refresh/check.ts`, which drives the real provider.
- **A quoted `numeric` would drop every row.** PostgREST v14.12 sends `numeric` as a JSON number
  (measured, including at high precision), so `z.coerce` in the client schema is a guard, not a
  fix for a live bug — but without it a driver that quoted the value would make `parseArray` drop
  every row and the UI would silently show authored data. `smoke-market.mjs` feeds quoted values
  to keep the guard honest.
- **Anything not live stays badged SAMPLE**, and live values show age + source. A list never mixes
  the two — a sector with no server row shows no number rather than an authored one.
- **`priced = false` is not the same as "no data".** Cash and bond yields have no meaningful price
  return, so they are excluded from the refresh and render with no number. Showing a 10Y yield
  move as "+4.1%" would read as a gain.
- **FMP's free tier is per-SYMBOL, not just per-endpoint.** Measured 2026-08-09 on
  `equity/fundamental/metrics`: AAPL/MSFT/NVDA/JPM/XOM/PFE/KO/NKE/TSLA return 200 while NEE, PLD,
  BHP and SAP return **402** — including every non-US name tested. So "the endpoint works" proved
  nothing; a 3-symbol probe that all happened to be covered led me to build a fundamentals feature
  that could never serve the universe, and it was reverted. **Probe an endpoint with symbols you
  expect to FAIL, not just the obvious mega-caps.**
- **The sector donut weights are BLOCKED, not deferred**: `etf/sectors` is FMP-premium (402) and
  `index/sectors` is TMX-only. Deriving weights from muffin's own 35 curated tickers would be a
  different number wearing the index's name — the SAMPLE badge stays until there is a real source.

**A new table is INVISIBLE over the API until PostgREST rebuilds its schema cache**, and
`notify pgrst, 'reload schema'` at the end of a migration is NOT reliable — 15 tables 404'd with
`PGRST205` after two successful deploys. Earlier migrations only ever appeared because their deploy
also changed `supabase-rest`'s config and restarted it, masking the problem. The deploy now sends
**SIGUSR1** (PostgREST's documented reload signal) after applying migrations. If a brand-new table
404s, that is the first thing to check — not your grants.

**Every `market` table has RLS with an explicit policy** (`09-market-rls.sql`), not grants alone:
public `select` policy on the 9 data tables, and `refresh_log` has RLS with **no policy at all**
(which denies every role that does not BYPASSRLS). Grants alone were restrictive but left
`rls_disabled_in_public` on the advisor and were one stray `grant` from being wrong. **Verify RLS
by BEHAVIOUR, not by the `relrowsecurity` flag** — the flag cannot tell you whether you have
locked out the edge function. **LangGraph's `public` tables are deliberately left without RLS**:
they are already unreachable via the grant revoke, and enabling it depends on langgraph-api's role
having BYPASSRLS, which is unverified — get that wrong and every agent run breaks.

**The self-hosted Supabase MCP server has NO authentication** and Supabase's own docs say it "is
not intended to be exposed to the Internet". It proxies Studio's admin API. `supabase.<domain>` is
PUBLIC (no Cloudflare Access), so adding the `/mcp` Kong route there would publish an
unauthenticated admin endpoint — and if it inherited Kong's `key-auth`, the anon key is in
`runtime-config.js`. Route it via the Access-protected `supabase-studio.<domain>` or leave it off.

**Supabase's default grants exposed LangGraph's tables to the public anon key** (measured
2026-08-09: `GET /rest/v1/thread` and `/checkpoint_blobs` returned real rows). LangGraph keeps its
tables in `public` deliberately — a dedicated schema was tried and abandoned because langgraph-api
recreates them there. `03-security.sql` revokes `public` from `anon`/`authenticated`, re-grants only
the app's own tables, and revokes the **default privileges** so tables created later don't
re-acquire it; being re-applied every deploy is what makes it self-healing. New app tables therefore
go in their own schema (like `market`) with explicit grants, never in `public`.

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
# One-time: compose reads env_file at PARSE time, so a missing .env breaks every
# command — including the three services below, which need no secrets.
cd muffin-deployment
cp compose/.env.example compose/.env
cp config/firecrawl/.env.example config/firecrawl/.env

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

## Calling the deployed API

Full runbook (auth layers, token recipe, gotchas): **[README.md → Calling the deployed API](README.md#calling-the-deployed-api)**.
The three facts worth not re-deriving:

- **The API reference is `muffin-api.<domain>/docs`, never `muffin.<domain>/api/docs`.** The latter
  renders but cannot execute anything: langgraph-api inlines a spec with **no `servers` key**, so the
  client resolves against the page origin and misses the `/api` prefix nginx strips. It fails
  *silently* — the wrong URL returns `200 text/html` (the SPA shell). Patching it was designed and
  deliberately dropped (`muffin-ui/docs/superpowers/specs/2026-08-03-api-docs-base-url-design.md`);
  don't re-propose it without reading that spec.
- **Two auth layers, distinguishable by status code.** Cloudflare Access is the perimeter (SSO cookie
  or `CF-Access-Client-Id`/`-Secret`); `muffin-agent/auth.py` is the identity. Reads are open;
  create-thread / start-run need `Authorization: Bearer <Supabase **user** access token>`.
  **403 = no credential sent** (anonymous is read-only); **401 = a credential was sent and failed**.
- **Only real user sessions authenticate.** The anon and service_role keys both 401 (the
  `aud=authenticated` check), and a locally minted JWT 401s (`iss` is verified against the server's
  `SUPABASE_URL`) — use the GoTrue password grant against the *public* `supabase.<domain>` host.
  `MUFFIN_API_TOKEN` and `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` are all **unset** in this deployment.

Note: `muffin-agent/docs/deployment.md` § Authentication predates the Supabase JWT mode and describes
only the `MUFFIN_API_TOKEN` / CF-Access-JWT modes — neither of which is enabled. Trust the umbrella
README over it until that doc is corrected.

## Agent skills (`.agents/skills` + `.claude/skills`)

Skills follow the [Agent Skills](https://agentskills.io/) `SKILL.md` format. In every repo that has
them, the pattern is identical: real, git-tracked content lives in `.agents/skills/<name>/`, and
`.claude/skills/<name>` is a relative symlink to it (`../../.agents/skills/<name>`) — Claude Code
only reads `SKILL.md` files under `.claude/skills/`, so the symlink is what makes a skill discoverable.

- **Canonical home = the submodule the skill concerns.** LangChain/LangGraph/Deep Agents/LangSmith/
  Langfuse/`financial-prompt-engineering` skills are committed inside `muffin-agent`; React Native /
  web-design/React-architecture skills (`react-native-skills`, `web-design-guidelines`,
  `react-best-practices`, `composition-patterns`) are committed inside `muffin-ui`. This keeps each
  submodule self-sufficient if it's ever opened or cloned on its own.
- **Mirrored at the umbrella root.** Claude Code resolves `.claude/skills/` relative to the directory
  you opened, not recursively into nested submodules — and this repo is always opened with
  `muffin-umbrella` as root. So every skill's real content + symlink is duplicated here too
  (`muffin-umbrella/.agents/skills/<name>` + `muffin-umbrella/.claude/skills/<name>`), keeping the two
  copies byte-identical.
- **Adding a new skill:** commit it into the owning submodule first (`<submodule>/.agents/skills/<name>`
  + symlink), then copy the same folder + symlink into the umbrella root and commit there too.

## Repo hardening baseline (every repo, set 2026-08-08)

All eight repos are public and carry Dependabot (version + security updates), secret scanning +
push protection, CodeQL, and a branch ruleset. Protection is **tiered on purpose** — full parity
everywhere would turn every one-line Dockerfile bump and every umbrella submodule re-pin into a PR:

- **Tier 1 — `muffin-agent`, `muffin-ui`, `muffin-deployment`:** PR required (0 approvals) + Copilot
  review on push + code-quality + CodeQL gate + **a required status check** from the repo's own
  `quality.yml`. No deletion, no force-push.
- **Tier 2 — `openbb-mcp-docker`, `agent-chat-ui-docker`, `nuq-postgres-docker`,
  `langchain-opensandbox`:** no deletion, no force-push, CodeQL gate.

  **"Direct push preserved" is not actually true for these four, and that was measured on
  2026-08-08.** The `code_scanning` rule in the ruleset blocks a direct push to `main` with
  `Code scanning is waiting for results from CodeQL for the commit <sha>` — results can only exist
  for a commit already on the remote, so a push of a new commit can never satisfy it. They are
  therefore PR-only in practice, exactly like Tier 1 minus the required status check. Either accept
  that (open a PR, CodeQL runs on it, merge) or drop the `code_scanning` rule from the Tier 2
  ruleset. Do not keep asserting direct push works.

- **Tier 3 — `muffin` (umbrella): direct push to `main` DOES work.** Measured 2026-08-09 by pushing
  the muffin-agent re-pin straight to `main`. Its ruleset ("Main branch guardrails", id 20584837)
  carries only `deletion` + `non_fast_forward` — **no `code_scanning` rule**, because the umbrella
  cannot have CodeQL at all (GitHub reports `languages: []` for it). No CodeQL rule means nothing to
  wait on, so the block that catches the other four never applies here. This file previously listed
  the umbrella inside Tier 2 and declared all of Tier 2 PR-only; that was wrong for the umbrella
  specifically. Verify with
  `gh api repos/gururafiki/<repo>/rulesets/<id> --jq '.rules[].type'` before assuming either way —
  a submodule re-pin does not need a PR.

  A fast-forward IS accepted where a merge commit is not: pushing the PR branch's own head advances
  `main` to a commit CodeQL has already reported on. `git merge --ff-only origin/<branch> && git push`
  lands a green PR without the API, and GitHub marks the PR merged. It only works while `main` has not
  moved since the branch was cut.

  Second gotcha, same session: **`gh pr merge` fails on any PR touching `.github/workflows/`** with
  `refusing to allow an OAuth App to create or update workflow ... without 'workflow' scope`. Merging
  such a PR needs a token carrying `workflow`, or a human clicking merge.

  **Those two combine into a genuine dead end.** A workflow-only PR (e.g. a Dependabot action bump)
  cannot be merged by the API for lack of scope, and cannot be fast-forwarded either, because CodeQL
  reports `skipping` on a change with nothing analyzable in it — so `code_scanning` waits forever for
  results that will never exist. GitHub's own merge button treats `skipping` as satisfied; nothing
  else does. Such a PR needs a human click or a `workflow`-scoped token. `langchain-opensandbox#2` sat
  in exactly this state.

The umbrella repo cannot have CodeQL — GitHub reports `languages: []` for it, so default setup is
unavailable. It gets guardrails only. Don't keep re-trying it.

Things that are easy to get wrong here:

- **Never add a `paths` / `paths-ignore` filter to a workflow that is a required status check.** A
  filtered workflow simply never reports on a PR that misses the filter, and the PR is then blocked
  forever on a check that will never arrive.
- **Enable `PUT /repos/{o}/{r}/vulnerability-alerts` before `automated-security-fixes`** — the latter
  returns 204 and silently does nothing without it. A `PATCH` of `security_and_analysis` also returns
  200 while changing nothing.
- **Land a quality workflow on `main` before making it a required check**, or every PR blocks.
- **A Dependabot version bound can be a safety guard, and Dependabot does not know that.** It widened
  muffin-agent's deliberate `mcp<2` to `<3` in #145 and it merged unverified. Deliberate caps get an
  `ignore` entry plus a comment saying why — that is why the Expo SDK family is excluded in
  `muffin-ui` (`expo install` picks those as a set) and both git-URL fork pins in `muffin-agent`.
- **…but first check the bound does anything at all.** The `mcp` cap turned out to be a no-op:
  `langchain-mcp-adapters` already declares `mcp<2.0.0`, which is strictly stronger, and `mcp<3`
  *permitted* mcp 2.0.0 — the exact version that caused the outage. It was deleted rather than
  guarded. **A bound that cannot block the thing it names is worse than no bound**, because reviewers
  read it as protection. When a cap is inherited transitively, pin the *floor of the package that
  carries it* and say so; don't restate the cap locally where it can drift or mislead.
- **Don't cancel `main` builds.** `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`, not
  `true` — two merges seconds apart used to kill the first one's verification run.

Full rationale, the per-repo ecosystem table, and the #145 post-mortem:
[docs/superpowers/specs/2026-08-08-repo-hardening-and-typing-design.md](docs/superpowers/specs/2026-08-08-repo-hardening-and-typing-design.md).

## Extracting a piece of muffin as a LangChain integration

`langchain-opensandbox` is the first of these; the conventions cost nothing to follow and a lot to
retrofit.

- **Independent PyPI package, `langchain-<provider>`.** LangChain's
  [integrations guide](https://docs.langchain.com/oss/python/contributing/integrations-langchain) is
  explicit that new integrations are **not** merged into langchain-ai repos — they are published
  independently and then listed. Listing is a row in `integration_external_docs.yaml`; a hosted MDX
  page is reserved for 50k+ monthly downloads.
- **Class name follows `<Provider>Sandbox`** (`E2BSandbox`, `ModalSandbox`, `DaytonaSandbox`), even
  when it reads worse than the internal name did. Reviewer familiarity is worth more than the stutter.
- **License MIT, not GPLv3.** The muffin components are GPLv3; a library meant for other people's
  agents cannot be.
- **Open an alignment issue before a PR** that adds a dependency or touches more than one package —
  that is what [deepagents#1739](https://github.com/langchain-ai/deepagents/issues/1739) did for E2B.
- **A live run finds what mocks cannot.** The extraction surfaced a bug that had been in muffin since
  the sandbox was written: OpenSandbox emits one message per output line with the newline stripped,
  the backend joined them on `""`, and `ls` therefore returned zero entries — `error=None`, so it
  read as an empty directory — for any directory with 2+ files. Every test passed, because the
  fixtures embedded newlines the real protocol never sends. Stand the real dependency up and drive the
  actual wire before trusting a port — see below for how to get an OpenSandbox server.

## Market reference data (SEC N-PORT → `market` schema)

The stock universe comes from **fund holdings**, not a screener: the tracked ETFs file SEC N-PORT
quarterly, which is public, keyless, and carries name/LEI/CUSIP/ISIN/country/weight per holding.
`market.tracked_fund` is the control surface (adding an ETF is a row in Studio, never a migration),
`market.ingest_run` is the log. **38 of 39 funds → 9,786 securities / 16,424 holdings in ~25 s**,
against the 35 hand-authored tickers it replaces.

Things here that are easy to get wrong, all measured 2026-08-10:

- **`<cusip>000000000</cusip>` is SEC's placeholder for "no CUSIP", not a value — and 72% of
  holdings carry it** (EWJ: 176 of 182). Because `security_identifier` is `PRIMARY KEY (kind, value)`,
  treating it as real collapses every one of them into a SINGLE security — Accenture, Seagate, TE
  Connectivity and NXP all became one row, with no error anywhere. Reject placeholder and
  malformed identifiers; the only symptom you get otherwise is a weight total slightly off 100.
- **An LEI identifies the ISSUER, not the security.** GOOG and GOOGL share one, as do two share
  classes in one filing, so resolving on it merges distinct securities the same way. Resolution is
  **ISIN → CUSIP → FIGI/`<other>`**; the LEI populates `market.issuer` (whose `lei` is UNIQUE).
- **Find a fund's filing with EDGAR full-text search**
  (`efts.sec.gov/LATEST/search-index?q="<seriesId>"&forms=NPORT-P`), not by walking the trust's
  submissions. A trust files one N-PORT per series per quarter, so iShares' 1,433-filing CIK buries
  a given fund deeper than any sane probe budget — a 24-probe walk could not reach MCHI or EWU at all.
- **SEC throttling looks like absence.** A 39-fund pass reported "no filing found" for EPP and ILF;
  both ingested perfectly alone. A non-ok response turned into `null` reads as "this fund does not
  file" — a permanent condition inferred from a transient one. Retry, and never let a fetch failure
  return the same value as an empty result.
- **Weights do NOT sum to 100** — EWT's own filing sums to 110.38. Anything drawing a donut must
  normalise. Every fund's stored total matches its filing exactly; the funds are simply like that.
- **A PostgREST `in.()` filter is a URL, so its chunk size is a LENGTH budget, not a row budget.**
  500 ISINs is a ~6.5 KB URL and the proxy answers a **bare 502** with nothing pointing at the cause.
  Keep `in.()` chunks ~100; write chunks (POST bodies) can stay at 500.
- **N-PORT uses `XX` for "country unknown"**, which is not a country and aborts a whole 584-holding
  fund on a foreign-key violation. Validate against `market.countries` and null the rest.
- **`market-verify.yml` asserts shape, not exceptions**, because every one of the above returned
  HTTP 200. Both guard types were proven by injecting the failure (one all-zero CUSIP → exit 1;
  deleting 6,000 securities → three floors breached). Keep it that way: a guard that cannot fail
  reads as protection without being it.

Note on hardening: **`gh pr merge` merged a workflow-only PR fine** (muffin-deployment#24,
2026-08-10). The "OAuth App … without `workflow` scope" dead end recorded above did not reproduce —
try the merge before assuming it needs a human click.

## Running an OpenSandbox server locally

- **`docker run -d -p 8080:8080 -v /var/run/docker.sock:/var/run/docker.sock opensandbox/server:latest`.**
  Docker Hub, tags through `v0.2.2`. This is the same image `muffin-deployment/stack/docker-compose.yaml`
  deploys.
- **`ghcr.io/alibaba/opensandbox/server:latest` does not exist** — it returns `denied: denied`. That path
  is in [muffin-agent/README.md](muffin-agent/README.md) § "Start OpenSandbox" and is wrong; the Swarm
  stack has always used the Docker Hub one.
- Alternative with no image at all: `pip install opensandbox-server`, then
  `opensandbox-server init-config ~/.sandbox.toml --example docker` and `opensandbox-server`. It still
  spawns sandbox containers through `docker.sock`. On macOS this needs
  `OPENSANDBOX_USE_SERVER_PROXY=false` on the *client*, because a host-native server cannot reach a
  container's bridge IP through Docker Desktop's VM — the sandbox is only reachable on its published
  port. In the Swarm deployment the server is itself a container, so proxy mode (the default) is correct.
- **`docker manifest inspect` is not a valid availability check.** It fails with "unsupported manifest
  media type" on any OCI-format image, which reads as "missing" and is not. Use `docker pull`.

## Conventions

- **License: GNU GPL v3.0** ([LICENSE](LICENSE)). Each submodule is GPLv3 — **except
  `langchain-opensandbox`, which is MIT** because it is a library published for other people's agents;
  third-party images the submodules wrap keep their upstream licenses.
- **All published images are arm64** (Oracle A1 / aarch64). Anything new that runs on the node must
  have an arm64 build.
- Coding conventions, collaboration preferences, and "memorize lessons in CLAUDE.md" rules are
  defined per-submodule — for the agent, follow [muffin-agent/CLAUDE.md](muffin-agent/CLAUDE.md).

## Collaboration Preferences

These rules govern how Claude approaches planning, implementation, and communication in this project.

1. **Deep planning first** — Always do deep planning and trade-off evaluation before writing any code. Explore the solution space thoroughly before committing to an approach.

2. **Prefer out-of-the-box solutions** — Before implementing custom logic, research available library features by reading internet documentation and/or library source code. Consider alternative options even if they are not an exact match to the ask. Surface interesting options proactively.

3. **Propose options, don't decide** — When facing a design decision or when multiple approaches exist, present the options and ask for a decision rather than picking one unilaterally. Ask questions before writing substantial code if no existing library/utility has been found — the user may be able to provide documentation pointers.

4. **Explicit approval before implementation** — Always ask for explicit approval before starting implementation. Never exit plan mode unless the user explicitly says to exit or switch mode.

5. **Keep documentation up to date** — After every implementation, update README.md, docs/, roadmap.md, and any other relevant docs as applicable. Add VSCode launch configurations where reasonable. Always include documentation updates as the last step of implementation plans. When trade-offs or tech debt are accepted, document the limitations and add action items to roadmap.

6. **Memorize lessons in CLAUDE.md** — If the user shares information that will be useful in future sessions (e.g. future roadmap tasks, corrections, disagreements, repeating feedback patterns, new constraints), record it in CLAUDE.md. When in plan mode, include the CLAUDE.md memory update as an explicit plan step.
