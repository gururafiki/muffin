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
  **That rule was only true again from 2026-08-13.** Until then `market-refresh` ALSO answered 502
  on an ordinary application failure, and the JSON body naming the reason never arrived: something
  in Cloudflare/Traefik/Kong owns that status and substitutes its own 16-byte `error code: 502`.
  Measured — a 400 from the same function arrives with its full 482-byte body, so it is the 502
  specifically that is synthesized. It cost four probes on a `security-profiles` failure whose
  cause (`profile provider returned nothing for all 30 batches`, i.e. the rate limit) was sitting
  in `refresh_log` the whole time, and it had been making the warm-up log
  `::warning::… failed (HTTP 502): error code: 502` — a monitoring line with no content. An
  application failure is now **200 with `"ok": false`**: the invocation succeeded and is reporting
  a failed outcome. Keep 5xx for genuine crashes, or the bare-502 rule stops meaning anything.
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
- **Classification needs no provider.** A sector SPDR's holdings ARE that sector's constituents,
  so sector/country membership is a join over `fund_holding` with the filing as provenance —
  not 9,786 per-security lookups returning one vendor's opinion each. Which fund means what is a
  column (`tracked_fund.represents_code`), so a new sector ETF stays a row.
- **Nothing in the stack bridges an ISIN to a ticker** — `equity/search` returns ZERO hits for an
  ISIN and `equity/profile` does not return one either, so it cannot be joined from either side.
  **OpenFIGI** does it, free and in bulk. Its rate limit (anon 25 req/min x 10) makes the resource
  incremental, so the ORDER matters: resolve by weight in a sector fund, not arbitrarily.
- **Bound a rate-limited loop by WALL CLOCK, not request count.** 15 anonymous OpenFIGI requests
  took ~40 s on a laptop and blew the 60 s worker on the Oracle node
  (`WorkerRequestCancelled: request has been cancelled by supervisor`). On an incremental
  resource, stopping early is free; overrunning loses the batch including what was already done.
- **A TTL expresses "the answer is still good" — which is false for an INCREMENTAL resource.**
  `security-tickers` deliberately does a slice per run, so the 7-day reference TTL meant one run
  resolved a page and the next week of runs were told the data was fresh; the backlog could never
  drain. Size a TTL by the resource's own behaviour, not by how often the underlying data changes.
- **A negative result is a result — cache it.** Ticker resolution asks OpenFIGI for the US line, so
  ~80% of a Japan or emerging-markets fund can never resolve. Without `security.figi_missing_at`
  those rows stayed in the backlog and would be re-sent four times a day forever, hammering a free
  API for a known answer AND starving the securities that could resolve. 30 days, not never — a
  security can gain a US listing.
- **A `.limit(n)` above `PGRST_DB_MAX_ROWS` is not an error, just a shorter answer.** The stack sets
  it to 1000, so a request for 4,000 silently got 1,000. Page explicitly when you need more.
  **Third instance, 2026-08-14: a `market-verify` guard asked for `limit=5000`, got exactly 1000,
  and would have reported "1000" for ever however bad things got — as a measurement.** Count with
  `Prefer: count=exact` + `Range: 0-0` and read `content-range`, which returns the true total
  without fetching rows and works through an `!inner` embed. **Never size a guard by measuring a
  page whose end you cannot see.**
- **Two PostgREST traps worth knowing before writing a query against `market`.** An embed can be
  AMBIGUOUS: `security?select=...,sector_constituents!inner(weight)` fails `PGRST201` because both
  are reachable through `fund_holding` as a many-to-many, and every disambiguation offered is that
  fund join rather than the direct `security_id` match — fetch the two sets and intersect instead
  (`.github/scripts/check_significant_holdings.py`). And **`urllib`'s default User-Agent gets a 403
  from Cloudflare** on `supabase.<domain>`, which reads exactly like an auth failure and is not;
  curl works, so set a User-Agent.
- **A TTL'd resource cannot be a hook for anything else.** Classification lived inside the
  fund-holdings handler, which correctly self-skipped on its 7-day TTL — so production had
  holdings, no sectors, and no way to ask for them short of waiting a week. Anything an operator
  might need on demand gets its own resource.
- **A many-to-many-over-SOURCES table needs the SERVING VIEW to pick.** `security_taxonomy` keeps
  a filing's classification and a provider's side by side on purpose. The views did not choose
  between them, so the moment yfinance profiles landed every US large cap appeared TWICE on the
  sector page and was counted twice in the donut. The donut percentages still looked right —
  renormalising cancels a uniform double count — which is luck, not correctness, and is exactly
  how this survives review. `distinct on (…) order by ds.priority desc`, before anything is listed
  or summed.
- **One dead symbol kills a batched provider call.** `group-performance` returned a bare 502 every
  time because its five symbols include FM, liquidated in 2025 — while `country-performance` was
  fine with 45 live ones. Batch, catch per batch, and skip funds already `enabled = false`.
- **Every backlog resource needs a NEGATIVE cache, and a failure must not look like an empty
  backlog.** `pending_profile` asked "has a ticker, has no sector", so securities yfinance cannot
  answer for were re-asked forever: run after run of `classified: 0, unmapped: 0, remaining: 1000`,
  indistinguishable from a provider outage because the fetch error was swallowed by
  `.catch(() => [])`. A throw and an empty answer are different facts. (Same defect as
  `figi_missing_at`, reintroduced two days later in a new resource — check for it whenever adding
  one.)
- **Country display metadata is DERIVED, not authored.** Flag is a pure function of the ISO-2 code
  (a regional-indicator pair); region comes from the **World Bank** lens because MSCI's regions are
  *investment* regions and file Poland under `em-emea` (Middle East & Africa); tier comes from
  MSCI's tier lens. `drillable` means "has a price series", not a hand-maintained boolean.
- **A binary conditional over a three-value type is a bug that type-checks.** Three call sites read
  `market === 'developed' ? 'Developed market' : 'Emerging market'`, so adding `frontier` would
  have labelled Vietnam and Nigeria "Emerging market". Use a lookup, not a ternary.
- **A registry populated by a hook does not survive a DEEP LINK.** Moving countries server-side
  made `/country/poland` render "Unknown country" on a cold load: `getCountry` reads a registry
  only a screen already running `useCountries` has filled. Any page resolving a route param must
  mount the query — and must distinguish PENDING from MISSING, or it calls a real thing
  nonexistent while still loading.
- **`create or replace view` can only APPEND columns** — it cannot rename, reorder or drop them.
  Two deploys died on this (`cannot change name of view column`, then `cannot drop columns from
  view`) because migrations re-run in order every deploy, so an earlier file kept trying to shrink
  a later file's definition back. Drop the view first; the later file wins.
- **Migrations are re-applied on EVERY deploy, so "works on an empty database" is half the
  contract.** `quality.yml`'s `migrations` job applies the whole set against a throwaway Postgres
  TWICE. All three migration failures that reached production — unsorted `with_fileglob`, a view
  column rename, a foreign key rejecting an ISO code — would have been caught by it.
- **A missing upstream timeout is a DEAD WORKER, not a slow response.** `openbbFetcher` had none,
  so `security-profiles` ran past the 60s limit the moment its symbols became foreign listings and
  returned a bare 502 — a resource that catches provider errors per batch never got the chance.
  Bound every upstream call; a timeout turns a hang into a skipped batch.
- **OpenFIGI `/v3/filter` enumerates a whole exchange** (London 4,346, Tokyo 3,948, KOSPI 2,803
  common stocks), which is how the universe stops being "whatever the tracked funds hold". Its join
  key is **FIGI, not ISIN** — the endpoint returns no ISIN at all — so the composite FIGI is
  captured while resolving local symbols. `securityType2: 'Common Stock'` is mandatory: unfiltered,
  "Samsung Electronics" returns 8,725 hits that are nearly all options.
- **Units can be MIXED inside one provider response.** In `equity/fundamental/metrics`,
  `profit_margin` (0.62966) and `return_on_equity` (1.14288) are FRACTIONS while `dividend_yield`
  is already a PERCENT (NVDA 0.46, Samsung 0.65) — and `dividend_yield_5y_avg` is a fraction again
  (0.0005), in the same object. One shared `pct()` rendered NVIDIA at a 46% dividend yield on the
  deployed page: wrong by two orders of magnitude and entirely plausible-looking. Format per
  field, and read the rendered page, not the diff.
- **A backlog view defined as "wants X and does not have X" re-asks FOREVER for the things that
  can never have X**, and they crowd out the ones that would resolve. Four columns exist for this
  (`figi_missing_at`, `profile_missing_at`, `local_symbol_missing_at`, `performance_missing_at`)
  because it was rediscovered four times. Every new backlog resource needs one.
- **…and a CORRECTED SYMBOL must clear every symbol-keyed one, which is now enforced rather than
  remembered.** Those flags record "we asked and got nothing" — but we asked under the wrong name,
  so leaving them set fixes the spelling and still excludes the security for 30 days.
  `security-yahoo-symbols` knew this and cleared a hand-written list of five columns;
  `prices_missing_at` arrived later (migration 42) and never joined it, locking **4,801 of 12,348
  equities** out of `pending_prices` with no error and `ok: true` throughout. Fifth instance. The
  list now lives in `market.clear_symbol_caches` next to the columns, `market.symbol_cache_
  classification` says which of the nine a new symbol invalidates and why, and
  `tests/negative-caches-are-classified.sql` fails CI on a `%_missing_at` column nobody classified.
  Do **not** "clear everything matching `%_missing_at`": `figi_missing_at` and
  `local_symbol_missing_at` are keyed on the ISIN, so a new symbol says nothing about them and
  clearing them re-asks a rate-limited provider for an answer already held.
- **A DATA REPAIR inside this migration set runs on every deploy — use `market.one_shot`.** Schema
  statements are idempotent by construction; a repair is not. Clearing `prices_missing_at` on every
  deploy would permanently defeat the negative cache — reintroducing the exact failure the flag
  prevents, as the fix for it.
- **N-PORT's `assetCat` types a security, and reading it is reading the filing, not guessing.**
  `ingest.ts` typed from `units` alone (`NS` → equity, everything else → `other`) behind a comment
  claiming `assetCat` "would be a fiction". It is a REQUIRED field with a closed vocabulary
  (`EC EP DBT ABS-MBS ABS-O LON DE DFE STIV RA`), it was already stored on
  `fund_holding.asset_category_code`, and `market.security_type` already had bond/cash/derivative —
  both vocabularies existed and only the ingest ignored them. 15,205 securities shared one type, so
  a futures contract and a sovereign bond were indistinguishable. Fixed at ingest + migration 49;
  `other` went 15,205 → 0.
- **Applying migrations to an EMPTY database proves nothing about a BACKFILL.** Its `update` matches
  zero rows there, so every guard inside it goes unexercised — which is exactly how migration 38
  reached production and broke the deploy. Seed the production shape and `\i` the real migration
  over it (`tests/securities-are-typed-from-the-filing.sql`). Note `data_source` and
  `asset_category` rows are LEARNED by the ingest at runtime, so no migration seeds them and a test
  that needs them must create them itself.
- **A provider that is REFUSING you says so — read the message, do not infer it from counts.**
  `fetchWithIsolation` decided by tally: if every symbol in a batch failed alone, blame the
  provider; otherwise blame the symbols. yfinance throttles PROGRESSIVELY, refusing some symbols
  while answering others, so `rows.length > 0`, the rule never fires, and the refused ones are
  negative-cached as permanently unanswerable — the same mechanism that once cost 1,369 ordinary
  tickers. The wire text said `YFRateLimitError: Too Many Requests` throughout. Classify on it.
- **ANON HAS A 3-SECOND STATEMENT TIMEOUT AND `service_role` DOES NOT, so a slow view fails for the
  APP while looking fine to you.** `fund_sector_weight` answered `service_role` in 7.2s and gave anon
  `57014 canceling statement due to statement timeout` — and `muffin-ui` reads it with the anon key,
  so the Markets donut had been failing in the deployed app while every service-role probe said it
  was healthy. It was correct at 10,060 securities and too slow at 27,627. **Time a view as ANON
  before believing it works**, and treat a role difference as a timeout question before reaching for
  RLS — I asserted RLS first here and it was wrong. The fix was not an index: restricting it to
  equity holdings (a *sector* weight over bonds is meaningless) and to level-1 taxonomy nodes cut it
  to 0.46s, and both halves were correctness fixes independently. The level filter also closed a
  latent wrong-answer bug — with 5,673 industries classified, `distinct on … order by ds.priority`
  could return an INDUSTRY as a security's sector.
- **THE BINDING CONSTRAINT IS REQUESTS PER UNIT TIME, so throughput improves only by cutting
  requests PER SECURITY — never by raising the page size.** The worker budget is not what limits
  these resources: `security-industries` uses 30 calls of its 90 seconds and `security-profiles` the
  same, so the pages look like they have room. They do not. Measured 2026-08-13, `security-fundamentals`
  at 60 calls a run tripped yfinance's limit while industries at 30 only partly did — raising a page
  raises calls per run and trips it sooner, buying nothing. The one optimisation that IS a win is
  the opposite shape: `security-statements` fetched one security at a time (3 calls each, 180 per
  run for 60 securities), and batching it to ten symbols a call made the same 90 requests cover five
  times the securities. Fewer requests per security, not more requests per run.
- **Draining faster than the provider allows drains LESS, and corrupts the backlog on the way.**
  Six resources back to back tripped the limit within three cycles. The drain loop now paces 45s
  between resources, 90s between cycles, and backs off 6 minutes on any throttle signature.
- **A truncated error message is not evidence — get the whole thing.** `Error getting data for
  ITGR -> YFR…` reads as an ordinary symbol failure; the full text was `YFRateLimitError`. On that
  misreading I designed a rule to blame the symbols whenever the provider had answered earlier in
  the run, which would have negative-cached innocent securities in exactly the 1,369 situation.
  Disproved by measurement: once the throttling stopped, `security-industries` reported
  `remaining: 0, note: every security has an industry` — the "permanently stuck" batches had drained.
- **An EMPTY answer counted as a FAILURE will kill a backlog the moment its answerable work is
  done.** `security-fundamentals` and `security-industries` both died this way: an empty batch
  incremented `batchesFailed` instead of negative-caching, so those securities came back every run
  until the guard failed the resource on them. It looks exactly like the provider breaking at the
  moment the good work finished. Fourth instance of throw-vs-empty in this file — and it cost five
  wrong theories, because `catch (_e)` gave one message to a timeout, a refused connection, a bad
  URL and an empty answer alike. Every backlog catch needs `lastError`.
- **THE FIX FOR THAT HAS ITS OWN VERSION OF IT: `written > 0` KILLS A BACKLOG THE SAME WAY.** The
  gate added to stop a throttled 200-with-no-rows marking a whole page — proof the endpoint produced
  something for SOMEONE in the run — is correct and, once every security left is one the provider
  does not carry, can never fire. `security-prices` reached exactly that state: measured 2026-08-14,
  `written: 0, emptySeries: 300, batchesFailed: 0, remaining: 393`, identical run after run, 301
  never priced at all. Confirmed rather than assumed — `security-refresh` at `ICT.PS` and `FAB.AE`
  returns `returns: 0, "not covered"`, the Philippines and the UAE being outside keyless yfinance.
  Nothing is wrongly marked and no data is wrong; it is pure waste against a rate-limited provider,
  eight times a day, forever. **A run-wide tally can only ever be a floor on the provider's health,
  never evidence about a symbol** — so marking takes per-symbol ISOLATION (as
  `security-performance` now does), bounded by the deadline so a throttled run marks nothing. And
  **isolation must KEEP what it recovers**: a batch is often empty because ONE member is bad, and
  discarding the others' bars turns the fix into a slower version of the bug.
- **…and `security-profiles` still had it, which is why the shape is now checked against the
  SOURCE.** Those two were fixed and this third call site was not: `if (providerFailed ||
  rows.length === 0)`, behind a comment calling the two "indistinguishable". They never are —
  `providerFailed` is the flag that distinguishes them, and OpenBB answers 204 when a provider
  genuinely has nothing. Measured 2026-08-13: `pending_profile` fell 2,665 → 2,437 and FROZE, while
  `security-industries`, `security-statements` and `security-fundamentals` — same `equity/profile`
  endpoint, same hour — all reported ok. I spent the afternoon treating it as a rate limit;
  `refresh_log` had already ruled that out. `logic-check.ts` now fails on any branch ORing a failure
  flag with an empty result, because a behavioural test cannot reach a decision inlined in a
  200-line handler and it is the SHAPE that keeps recurring.
- **OpenBB answers 204 NO CONTENT when the provider has nothing** — a legitimate answer, not a
  fault. Treating it as an error failed whole batches (22 of 24) over a few listings yfinance does
  not carry, losing the symbols alongside them. Strictness belongs at the caller that requires
  rows, not in the fetcher.
- **The 60s/150MB worker limits are OURS**, hardcoded in `functions/main/index.ts` — not a platform
  ceiling. Now 90s/256MB. The real ceiling is Cloudflare, which cuts a proxied request at ~100s, so
  going higher only moves where the failure happens. A per-call timeout must be bounded by the
  REMAINING budget, not a fixed value: a deadline that only gates whether to START a call lets one
  begin at 34.9s of a 35s budget and run 20s past it.
- **Admin is `app_metadata.role`, never `user_metadata`** — a user can write their own
  `user_metadata` through the ordinary auth API, so a role kept there is self-assignable. Refresh
  is admin-only, which is why the warm-up cron uses the service-role key rather than anon.
- **A backlog's exit condition must be an ANTI-JOIN OVER THE ENTITY, not a `where … is null` over
  rows.** `pending_industry` asked "has a level-1 sector, has no level-2 industry" and expressed the
  second half as an unrestricted `left join security_taxonomy` plus a level-2-restricted
  `left join taxonomy_node` and `where ind_n.node_id is null`. The security's own level-1 rows join
  the second table as NULL and survive the filter, so **a `where` filters rows, not securities** and
  one qualifying row cannot suppress another. Every security with a sector was queued forever.
  Measured 2026-08-11: AMZN classified at 21:41:39 and still returned by the backlog in the same
  minute; 7,911 rows before a run and 7,911 after one reporting `classified: 282`; **345** securities
  with an industry against 8,412 with a sector — the resource re-fetched the same top-300 by weight
  on every run since migration 23 and never reached row 301. `security.market_cap` was frozen at
  **386 of 10,060** because the cap rides along on the same `equity/profile` response. Nothing
  errored; it reported success and progress forever. The signature to recognise is a predicate on a
  **SECOND** table reached through an unrestricted first join — every backlog view that drains
  (`pending_profile`, `pending_fundamentals`, `pending_local_symbol`, `pending_performance`)
  null-checks the FIRST left-joined table. Guarded offline by
  `stack/supabase/tests/backlogs-are-satisfiable.sql` (quality.yml) and in production by
  `market-verify.yml` check 7b.
- **Money must carry its currency, and the symbol comes from CLDR.** The stock page hardcoded `$`,
  so Alibaba's CNY 1,023,670,000,000 revenue rendered as **"$1.02T"** — the largest company on earth
  by revenue, against a true ~$141B. `$` is ambiguous even where it is right: USD/CAD/AUD/HKD/SGD/
  MXN/CLP all print as `$` and all are held by tracked funds (of 1,000 securities with a currency,
  337 are non-USD). `muffin-ui/src/features/markets/money.ts` asks `Intl` — which knows KRW is ₩ and
  that MXN is `MX$` for an en-US reader — rather than an authored table. **Its locale is PINNED and
  that is load-bearing**: the function appends the scale suffix itself, and `de-DE` puts the symbol
  last (`215,94 $` → `215,94 $B`), `fr-FR` gives `215,94 $USB`. An unrecognised code makes `Intl`
  throw, which during render takes a native build down. With no currency the figure is left
  UNLABELLED — defaulting to dollars is how the bug started. `security_statement.currency` is null
  for every row (the income/balance/cash endpoints carry no currency field; `reported_currency` was
  a wrong guess), so the label comes from `security.currency_code` — N-PORT `curCd` first, the
  yfinance metrics response second.
- **The same conflict key twice fails the WHOLE upsert.** Postgres rejects an
  `INSERT … ON CONFLICT DO UPDATE` whose statement carries a key twice —
  `ON CONFLICT DO UPDATE command cannot affect row a second time` (SQLSTATE 21000) — and fails the
  statement, so the batch and the resource go with it. `pending_industry` yields one row per
  (security, level-1 sector), so a security in two sectors arrived twice; `security-industries`
  therefore returned a bare 502 on any page large enough to contain one, which is why `limit` 10 and
  20 succeeded and 40/100/300 did not. **It looked exactly like a size or timeout problem and was
  neither** — both black-box theories (the per-security market-cap write loop, slow foreign
  lookups) were wrong. The edge-runtime logs on the node named it in one line: when a bare 502 is
  reproducible, `docker service logs muffin_supabase-functions` first, bisecting second. Third
  instance of this shape (fund holdings dedupe lots; the sector views `distinct on`), so it is now a
  shared `dedupeBy` at every `DO UPDATE` upsert fed by a provider, a backlog or a filing.
  `ignoreDuplicates` (DO NOTHING) is exempt.
- **A DISCONTINUITY IN A PRICE SERIES IS NOT A MARKET MOVE, and a big number is not by itself
  wrong.** Measured 2026-08-12 across all 40 securities returning ≥ +300%, by re-fetching each
  series: the largest legitimate one-day move was **2.04x** and the smallest illegitimate one
  **6.0x**, with nothing between. AMRM.TA and ISHO.TA jump ~100x on the SAME day (2026-05-18), both
  quoted in `ILA` — Yahoo switched Tel Aviv quotes from shekels to agorot; the USD outliers are OTC
  lines with an unadjusted ratio change, which a reverse split would mimic exactly. `returnsFor`
  omits any period whose anchor predates the most recent >5x move, **per period**, so the short
  windows survive a break. The other 34 are left alone: SNDK really is up ~2,700%, and capping it
  would swap a right number for a different wrong one — which is why the guard is a tripwire on the
  count, not a ceiling on the value.
- **An upsert cannot retract.** A period the refresh stops producing keeps whatever was written last
  time, forever, looking freshly written. Any cache keyed on (entity, period) must DELETE what a
  successful run deliberately did not produce, or a number that is now known to be untrustworthy
  outlives the fix that stopped generating it.
- **Symbols are not URL-safe, and the silent one is `&`.** Batched calls interpolated `join(',')`
  raw. `BRK/B` (and the UK form `BP/.L`, `RR/.L`) 400s and takes its whole batch of 20 with it —
  noisy but survivable. `PE&OLES*.MX` unencoded **ends the `symbol` parameter and starts a new
  one**, so the provider answers 200 for a truncated list and every symbol after it vanishes with no
  error. Encode each symbol and keep the comma literal. `*` (`WALMEX*.MX`) is URL-legal and
  therefore untouched by encoding — that is a symbol-FORMAT problem: OpenFIGI's `ticker` is the
  Bloomberg spelling and yfinance wants its own. Yahoo's public search takes an ISIN
  (`query2.finance.yahoo.com/v1/finance/search?q=<ISIN>`) and gives the right answer, but its index
  is inconsistent — Televisa returns its local `.MX` line while Walmex returns ONLY a Frankfurt one,
  so any use of it must require the exchange to match the security's country rather than take the
  first hit.
- **A BAD SYMBOL RATE IS AMPLIFIED BY THE BATCH SIZE — 2.6% of symbols blocked 28% of the work.**
  Measured 2026-08-12 on the live `pending_industry` head: 26 of 1,000 symbols carry a Bloomberg
  spelling (`BRK/B`, `WALMEX*.MX`, `PE&OLES*.MX`), and because one 400 fails its whole batch of 20,
  **14 of 50 batches** were poisoned on the real ordering. It gets worse as a backlog drains,
  because the answerable securities leave and the unanswerable ones concentrate — consecutive drain
  runs went `batchesFailed` 1 → 10 → 15 of 15 and `classified` 241 → 77 → 0, which looks exactly
  like a provider outage or a rate limit and is neither. So: on a batch failure, retry the symbols
  individually and let the PROVIDER name the bad one (`fetchWithIsolation`), negative-cache only
  what fails alone, and never mark a symbol dead that the deadline stopped you asking about.
  "One dead symbol kills a batched provider call" had already appeared for `group-performance` (FM,
  liquidated 2025) and `security-profiles` (foreign listings); this is the generic fix.
- **A REQUEST THAT FAILED AND A REQUEST THAT ANSWERED NOTHING ARE DIFFERENT FACTS — at EVERY branch
  that acts on an empty result, not just the first one.** This shape appeared FOUR times on
  2026-08-12 alone: `fetchWithIsolation` missing `security-performance`'s outage rule (1,369
  securities wrongly negative-cached); `security-yahoo-symbols` shipping unreachable because a
  resource must be registered in two places; the currency lookup learned in `ingest.ts` and not in
  the fundamentals path; and finally the isolation fix itself, which correctly judged a failed batch
  an outage and returned no dead symbols — and then let the empty-answer branch one level down
  negative-cache all 600 anyway (`written: 0, missing: 600`). Each fix was correct and none
  generalised. **When you fix one of these, grep for the other call sites before shipping.**
- **A THROTTLED PROVIDER ANSWERS 200-WITH-NO-ROWS, WHICH EVERY OUTAGE RULE HERE WAS BLIND TO.**
  `fetchWithIsolation`'s outage rule, `security-prices`' "only when the batch did not fail", and
  `security-statements`' `failed === 0` are all THROW checks. yfinance under rate limit does not
  throw — it returns an empty 200 — so nothing failed, nothing answered, and six separate marking
  sites recorded "the provider has nothing for this security" when the truth was "the provider is
  not talking to us". Measured 2026-08-13 after one afternoon's over-eager drain: **industry 1,414
  (INTC, PEP, XOM, TXN, EA, SCCO), statements 5,613 (EQH, TOST, CRBG, ACM, RKT), performance 1,205
  (EMR, TPL, REGN, UPS), fundamentals 122, prices 40** — ~8,300 securities, silently, while
  `pending_industry` went to 0 and read as drained. **A backlog that empties by MARKING looks
  exactly like one that empties by WORKING**; compare the two populations, never one count. Every
  site now gates on a success counter proving the endpoint answered for someone in the run.
- **SIX call sites, four spellings — find them all before fixing any.** The empty-result test was
  written as `rows.length === 0`, `priceRows.length === 0`, `fetched` empty and
  `anyAnswer || failed === 0`; fixing the ones that matched a single grep certified the rest as
  safe. Three consecutive PRs each fixed a subset because each grep found only its own spelling.
- **A GUARD MUST BE PROVEN BY DELETING WHAT IT GUARDS, AND THE MUTATION MUST BE VERIFIED TO APPLY.**
  The first source check for the above walked from each empty-answer branch to its closing brace and
  looked for a gate inside. It caught **one of four** deleted gates: brace depth counts braces in
  comments and template literals, so most blocks ended early and the write fell outside the window
  — it printed `all six marking sites gated` while three were not. It was nearly shipped described
  as proven, because the first mutation run used `sed` with mis-escaped `&&` and silently changed
  nothing, so four "ok"s meant four no-ops. Replaced by a named list of the six exact gate
  expressions: brittle to refactoring on purpose, since rewording fails loudly while DELETING can
  never pass silently.
- **A GUARD THAT FAILS OPEN ON ITS OWN HEADLINE CASE IS WORSE THAN NO GUARD, BECAUSE IT IS NOW
  BELIEVED.** The statements view was given `country_iso2` so the app could withhold a currency
  label for a non-US company quoted in USD — Alibaba's CNY revenue was rendering as **$1.02
  TRILLION**. It exposed the FILED country, and BABA has none: promoted from the exchange directory,
  it has `provider_country_iso2 = CN` and `country_iso2 = NULL`. The caller's test is
  `USD AND country !== 'US'`; **NULL is falsy**, so the gate declined to fire on the exact security
  it was built for. Two rules fall out. Expose the EFFECTIVE value (`coalesce(provider, filed)`, the
  same one `security_current` answers with) so two views cannot disagree about where a company is —
  21 securities have statements, are quoted in USD and have no filed country, all of them promoted
  rather than ingested. And **write the test against the CALLER'S RULE, not the column**: asserting
  `country_iso2 is not null` would have passed while the UI mislabelled, whereas asserting "this
  security's label is withheld" fails for the reason the user would see.
- **A 200 FROM `market-refresh` IS NOT PROOF THE WORK HAPPENED.** `begin_refresh` answers
  `{ skipped: true, reason: 'fresh or in flight' }` when the TTL has not elapsed or another
  invocation holds the lock, and `promote-listing` answers `{ promoted: false }` when it resolves a
  FIGI it cannot build a security from. Both are 200s with no `error`, so a caller checking only for
  a thrown error reports success. Tolerable for a background warm-up; **wrong for an action a person
  took and is watching** — which is why `triggerRefresh` returns the body and the Track button
  requires `promoted === true`. Related: every early return AFTER `begin_refresh` must call
  `finish_refresh`, or a malformed request costs the resource a two-minute outage on top of its own
  400 (measured — a `promote-listing` call with no `figi` refused the next valid call 45s later).
- **A RESOURCE THAT IS NEVER INVOKED CANNOT FAIL, AND AN UNREAD VIEW CANNOT BE WRONG.** Two
  absences found 2026-08-14, both invisible to every count in the system. `exchange-listings` — the
  ONLY resource that grows the universe beyond what the tracked funds hold — was written, deployed,
  reachable and **absent from the cron**, so it ran when a human remembered: 16 venues had never
  been enumerated (Australia, Japan, China, Indonesia). The guard asked "does everything the cron
  calls exist?", which cannot see the reverse; the new one checks that every backlog resource is
  actually SCHEDULED, with on-demand ones named explicitly. It immediately caught a second defect in
  the cron PARSER — the list's last entry ends with `)` not `\`, so `derive-classifications` had
  never been verified. Separately, `untracked_listing` excluded only on a `figi` identifier that
  **547 of 27,628 securities have**, so it called 9,976 tracked companies untracked — Samsung
  Electronics included — and nothing noticed for weeks because nothing read it. **When a feature
  finally reads a view, re-measure what the view claims.**
- **MEASURE AN IDENTIFIER BEFORE KEYING ON IT — the two obvious ones here are both something else.**
  In `exchange_listing`, `country_iso2` is the **VENUE's** country, not the company's (TOYOTA BOSHOKU
  is JP/JP, GR/DE, JT/JP, US/US), and `composite_figi` is per **country of listing**, not per company
  (`BBG000BBRS83` for the two Japanese venues, `BBG000BS1B63` for Frankfurt, `BBG000C0L6P1` for the
  US line). A "is this the local line" test written on `country_iso2` is **true for every row while
  reading as logic** — which is worse than no test. Dedupe listings by NAME and prefer the
  suffix-bearing local symbol over a bare US OTC one.
- **A NEW COLUMN FILLED BY AN EXISTING RESOURCE NEEDS ITS BACKLOG WIDENED IN THE SAME CHANGE, OR IT
  IS INERT.** Migration 56 added `provider_country_iso2`, the resource wrote it correctly, the
  typecheck passed, three migration passes passed — and production sat at **0 rows populated**.
  `security-profiles` fills it and is driven by `pending_profile`, which asks for securities with no
  SECTOR; that backlog was drained, so the resource answered `every security has a sector` and
  returned success having fetched nothing. True, and useless. **Nothing could report this — the
  resource was succeeding.** Found by measuring the column after the deploy. The counterpart trap is
  over-correcting: re-queueing all 11,395 securities to collect one field would have spent eighteen
  runs of the rate limit to change nothing for securities already on a country page, and starved
  `security-statements`. Scope a backlog to the population the field actually serves — here 384.
- **THE ANSWER IS USUALLY ALREADY IN A RESPONSE YOU FETCH — check what it CONTAINS before concluding
  a field needs a provider or a paid key.** Four times now: market cap and the operating country
  both ride on `equity/profile`, and the currency and *another* market cap both ride on
  `equity/fundamental/metrics`. The last one was the starkest — `security.market_cap` sat at 8,163
  of 12,348 (66%) because `equity/profile` carries no cap for most non-US listings, while **2,871 of
  the 2,952 missing caps were already in `security_fundamentals.raw.market_cap`**, fetched and
  written to jsonb and never promoted to the column the app reads. Coverage went to ~89% with no new
  upstream call. When promoting out of provider jsonb, gate on `jsonb_typeof(...) = 'number'`: a
  numeric-looking string casts cleanly and writes a wrong type silently, while `"n/a"` raises and
  **aborts the whole deploy**, since migrations apply `--single-transaction`.
- **A TALLY IS NOT EVIDENCE ABOUT A SYMBOL, AND A NEGATIVE CACHE FREEZES THE DATA IT EXCLUDES.**
  Two defects, one cause, both measured 2026-08-14 and both invisible in every count.
  `security-performance` marked every symbol absent from a batched response, gated on
  `fetched.length > 0` — "if any of the 40 answered, blame the rest". yfinance defeats that by
  throttling **progressively**: it omits symbols from a 200 rather than erroring, so nothing throws
  and `fetchWithIsolation` — which only engages on a throw — never runs. **2,548 of 3,045
  securities carried `performance_missing_at` while `security-prices` was writing them daily bars
  off THE SAME endpoint**; MediaTek, Tapestry, Ferguson, Royalty Pharma, ACS. 2,297 in one pass.
  The second half is the one to remember: **marking excluded them from the backlog, and the
  retraction that deletes periods a run stops producing only runs for symbols a run ANSWERS** — so
  REA.AX, 1803.T and MRP.JO kept serving `1d/1w/1m = 0.00%` written four days earlier while their
  prices moved daily. The guard that stopped PRODUCING a number could never REMOVE it. Marking now
  requires the symbol to be asked ALONE, and marking retracts.
- **A BURST IS A PROVIDER EVENT — compare a rate against its own steady state.** The same incident
  hit `statements_missing_at`, where no contradiction is available (a security with no statements
  has none, so holding the data cannot disprove the mark). The RATE settles it: 518 + 725 + 1,032
  marks in three single hours against **~15/hour** either side. Re-driving ISRG, EXC and MLM
  returned 12 rows of statements each. Over-clearing such a window is the cheap direction — an
  honest mark is re-set on the next run, a false one costs 30 days.
- **MARKET CAP IS THE WRONG LENS ON THIS UNIVERSE, and the mega-cap canary has three blind spots.**
  It read `statements_missing_at = 0 of 213` on the morning 85 of the 221 securities that are a
  ≥1.5% sector-fund holding were marked. `country_iso2 = 'US' and market_cap > 50e9` cannot see:
  securities with **no market cap at all** (ISRG had none; 34% of the universe still does not),
  securities **below $50bn** (EXC $46bn, MLM $33bn, ESS $19bn), and **every non-US security**
  (Chubb is Swiss). It is US-only because `market_cap` is denominated in each security's own
  currency, and that constraint is real. **Fund WEIGHT has neither problem** — a percentage is free
  of currency, cap and country — so `check_significant_holdings.py` checks by weight instead. Keep
  both; they fail on different things.
- **AN EXACTLY-0.00% RETURN IS ARITHMETIC, NOT A DEFECT, ONCE THE UNIVERSE IS BIG.** `market-verify`
  cried wolf at 12 rows with "a delisted instrument is being priced off its final bars" — for
  Austrian Post, SpareBank 1 SMN and Bank Rakyat Indonesia, all trading normally. Most quotes sit
  on a coarse tick grid (Tokyo and Shenzhen in whole units, Seoul in won), so a price returning to
  exactly its anchor is ordinary: **10 of 18 were a provable exact round-trip**. "Vanishingly
  unlikely" was true for 35 curated instruments and false for 12,348 equities. The discriminator is
  **per symbol, not per row** — a frozen series is flat on EVERY window at once (Egypt, Nigeria and
  Portugal were flat on all nine) and coincidence cannot land on three. Measured: 36 symbols had
  one fresh zero, 2 had two, none had three.
- **WHEN NOTHING ANSWERS, BLAME THE PROVIDER, NOT THE UNIVERSE — and do not drain a backlog by
  hammering it.** Isolating bad symbols (above) is right until it is applied to an outage. Draining
  `security-industries` aggressively tripped yfinance's rate limit; every batch then failed; every
  symbol also failed when retried alone; and the isolation pass concluded that **1,369 securities
  were permanently unanswerable and negative-cached them for 30 days** — including `HTHT` (H World)
  and `LEGN` (Legend Biotech), ordinary Nasdaq tickers. It reported `classified: 0, noIndustry: 200`
  per run while doing it, which reads as progress; the only tell was `classified: 0` for four
  consecutive runs against a backlog that kept shrinking. Cleared by hand with a `PATCH … set
  industry_missing_at = null`. The rule now lives in `fetchWithIsolation`: a bad symbol is rare and
  isolated, so if EVERY symbol fails alone, mark nothing and let the next run try.
  **`security-performance` already carried this exact rule in a comment** — "if the whole batch
  fails, the provider is down or rate-limiting, mark nothing, or a single outage would
  negative-cache thousands of perfectly answerable securities for a month" — at one call site, where
  it did not travel to the helper that later generalised the batching. **A rule written at one call
  site is not a rule.** Pace a manual drain (the warm-up cron does ~4 runs/day for a reason), and
  treat a run that negative-caches more than it classifies as a red flag, not as throughput.
- **SEVERAL EXCHANGES NEED A SPELLING THIS PIPELINE DOES NOT PRODUCE, and they are not all
  obvious.** Beyond the `*` / `/` Bloomberg forms, measured 2026-08-12 against Yahoo directly:
  `6.HK` and `27.HK` return "No data found" because Hong Kong tickers are **zero-padded to four
  digits** (`0006.HK`), and `ESSITYB.ST` fails because Stockholm share classes take a **hyphen**
  (`ESSITY-B.ST`). So "the provider has no data for this security" is frequently "we asked using the
  wrong name" — do not read a `*_missing_at` population as a statement about the securities until
  the spelling has been ruled out.
- **A SYMBOL IS NOT A STABLE KEY, and the display symbol was the wrong one.** The app named a
  security `coalesce(ticker, provider_symbol)` — ticker FIRST — but that identifier is OpenFIGI's
  *US* lookup, which for a foreign company is a thin OTC foreign-ordinary line. Measured 2026-08-12:
  **365 of 900 sampled non-US securities (41%)** were displayed as `SAABF`/`HXGBF`/`SAPGF` while
  being priced off `SAAB-B.ST`/`HEXA-B.ST`/`SAP.DE`. The prices were never wrong — the FETCH key was
  always `coalesce(provider_symbol, ticker)` — only the label. `market.listing.is_primary` now
  decides it per security, because "local always wins" is wrong for a company whose ADR really is
  the primary market. Re-keying `performance.scope_id` needed a hand-written migration; anything
  keyed on `security_id` needed nothing, which is why `market.security_price` is.
- **`market.instruments` is a curated OVERLAY, not a redundant universe.** It was going to be
  retired; measuring first showed 8 of its rows are editorial ADR picks (`TSM`, `SAP`, `RIO`, where
  the fund-derived universe knows only `TSMWF`, `SAPGF`) and 12 are not securities at all (`USD`,
  `US10Y`, `BTC`, `WTI`, `GLD`). `priced = false` is what makes cash and a bond yield render NO
  number rather than "+0.0%". It now carries a nullable `security_id` and `instrument_current`
  merges the two: curated columns win for editorial fields, the security supplies provider-refreshed
  ones.
- **The same fact in two places WILL drift.** The venue map (exchange code → country → provider
  suffix) lived in `exchanges.ts` AND in `exchange_cursor`'s seed; measured 2026-08-12 they had
  drifted to **54 rows against 38**, so `security-local-symbols` resolved symbols on sixteen venues
  (China, Canada, Australia, Brazil, UAE, Colombia) that `exchange-listings` never swept.
  `market.exchange` is now the source and the functions read it. Where a rule genuinely must exist
  twice — suffix→venue is both SQL (the `listing` backfill) and TypeScript (`venueForSymbol`) —
  assert both.
- **Migrations re-run in full, so a view's DEPENDENTS must be dropped before it — and a
  hand-maintained list of them is wrong within hours.** Three views built on `security_symbol`
  (`pending_performance`, `instrument_current`, `price_series`) each broke every re-run until added
  to migration 35's drop list. The failure lands on the SECOND pass, after the first has already
  succeeded. Migration 35 now discovers dependents via `pg_depend` instead. Verify by applying the
  whole set **four times**, not twice.
- **"APPLIES TWICE ON AN EMPTY DATABASE" IS NOT "APPLIES TWICE ON THIS DATABASE".** Migration 38's
  backfill inserts a PRIMARY listing with `on conflict (security_id, exch_code) do nothing` — which
  names the primary key and NOT the partial unique index `listing_one_primary_idx`. On a fresh
  database that is fine, because nothing else has written a primary. In production
  `security-yahoo-symbols` had recorded securities' other venues, so the backfill tried to add a
  second primary on a different exchange and the statement errored, **failing the deploy on
  2026-08-13**. The three-pass migration test could not see it: the state that breaks it only exists
  after a resource has run. When a migration writes rows a RESOURCE also writes, reproduce the
  resource's rows in the test before believing it. The blast radius is the real lesson — migration
  35 drops the dependent views before 38 runs, so a failure there left production without
  `pending_prices` until the next successful pass; a mid-chain migration failure is not atomic.
- **A partial unique index is not covered by `on conflict`.** `upsert(..., { onConflict: 'a,b',
  ignoreDuplicates: true })` silences conflicts on `(a,b)` and nothing else, so a `unique … where
  is_primary` still throws and fails the whole statement. To move such a flag, insert non-primary
  and then demote-and-promote in two statements — an upsert cannot express "move this flag".
- **The migration tests run as SUPERUSER, so they prove nothing about grants.** A table can be
  created, apply cleanly four times, pass every check, and be unreachable in production:
  `security_price upsert failed: permission denied for table security_price` — migration 42 granted
  the two views and forgot the table they read. Same shape as the PGRST205 schema-cache incident.
  `stack/supabase/tests/every-table-is-reachable.sql` asserts `service_role` can read AND write
  every `market` table and `anon` can read every serving view; it found two more the moment it was
  written, including `listing`, which the ISIN resolver writes on every run.
- **CI never touched the edge functions until 2026-08-12** — every job was Postgres, Terraform or
  Ansible, so a Deno file could not even be typechecked. `quality.yml` now runs `deno check` plus a
  network-free `logic-check.ts` on every PR; `check.ts` still covers the same ground against a live
  openbb-api but needs one, so it only ran when someone remembered. The pure check caught a real gap
  the same hour it was written.
- **`market-verify.yml` asserts shape, not exceptions**, because every one of the above returned
  HTTP 200. Both guard types were proven by injecting the failure (one all-zero CUSIP → exit 1;
  deleting 6,000 securities → three floors breached). Keep it that way: a guard that cannot fail
  reads as protection without being it.
- **`create or replace function` PRESERVES THE EXISTING ACL, so a grant in a re-run migration can
  only ever ADD a privilege.** A line tightening permissions applies cleanly, reports success, and
  changes nothing. Measured 2026-08-19 on `aggregate_performance`: with the anon grant deleted the
  function still showed `anon=X/postgres` and `has_function_privilege('anon', …)` still returned
  true, because an earlier apply had granted it. Functions are therefore **drop-then-create**, for
  the same reason `03-security.sql` re-applies its revokes — that is what makes them self-healing.
  The same measurement showed the grant was **decorative anyway**: Postgres grants `execute` to
  PUBLIC by default and `03-security.sql` revokes only TABLES in `public`, so every role could
  already execute it. An explicit `revoke … from public` is what makes the grant load-bearing.
- **A MUTATION HARNESS CAN BE CONTAMINATED BY THE STATE IT MUTATES.** Seven guards on migration 78
  reported `MISSED` in one run: applying that migration alone fails at its own first `drop view`
  because `security_facets` depends on `security_style`, so the mutated file never applied and
  every "miss" was a no-op. This is the third form of "verify the mutation applied" (after `sed`
  mis-escaping and a pattern with the wrong indentation) — assert the mutated artifact actually
  reached the database, not just that the file changed.
- **A MUTATION THAT CHANGES NO BEHAVIOUR IS NOT AN UNPROVEN GUARD — measure before believing
  either.** Turning an `inner join` into a `left join` looked like a missed guard until the row
  counts were compared under both: identical, because the `where … > 0` predicate rejects the NULL
  the left join admits. The predicate is the guard and it *is* proven. But the first comparison ran
  against an EMPTY database and returned `0|0|0` for both — a vacuous measurement that would have
  "proved" anything.
- **A PERCENTILE IS MEANINGLESS WITHOUT A PEER GROUP, AND ACCURACY CANNOT TELL YOU SO.** The first
  `security_style` ranked book-to-price globally; the median Russell 1000 name sat at the **0.299**
  percentile of the world, because 70% of global equities are cheaper than the median US large cap
  — so a threshold that splits the Russell 1000 sensibly labelled **89% of all securities "value"**.
  Every candidate cohort scored ~0.71 accuracy, because the calibration set is 63% one class and
  accuracy is saturated by it. What discriminated was growth recall (0.55 → 0.70) and whether the
  labelled set sat mid-cohort (0.299 → 0.430). **When one class dominates, optimise for the error a
  user actually sees** — here matching the index's own proportions halved outright growth↔value
  swaps (4.5% → 2.5%) while *lowering* accuracy, and that is the version that shipped.
- **A CALIBRATION MEASURED ON A DIFFERENT SCALE THAN THE CODE COMPUTES IS FICTION.** The shipped
  thresholds scored 0.658, not the 0.709 written in the migration header, because the fit had
  percentiled over the calibration set while the view percentiles universe-wide. The header's
  confusion matrix was real, honest, and described nothing that existed. Re-derive the metric by
  running the SHIPPED expression, not the notebook's.
- **THE ANON TIMEOUT BITES ON THE CONJUNCTION, NOT ON ANY SINGLE PREDICATE — and that is why a view
  can pass every probe and still be broken.** `security_facets` answered anon in 0.72s filtered by
  country, 0.33s by sector and 0.58s by tier, and returned
  `57014 canceling statement due to statement timeout` for **tier AND sector together**: two filters
  collapse the planner's row estimate to 1, it switches to nested loops, and `security_current`'s
  per-row sector lookup runs **59,076 times** behind a `Seq Scan on security` costed at 538,553.
  Second occurrence of this shape after `fund_sector_weight`. **Probe the CONJUNCTIONS, not one
  filter at a time** — and note the plan was not what I predicted (I blamed `security_style`'s
  `percent_rank`, which costs real time but was not the binding constraint; the lens pivot I also
  suspected costs 21). Fixed by MATERIALISING the spine (migration 80): the failing query went
  2993ms → 0.47ms, a 3-way filter to 0.6ms, and — the actual point — the cost became BOUNDED for any
  combination, which plan-tuning one query never is.
- **`IF EXISTS` DOES NOT PROTECT AGAINST A RELKIND MISMATCH.** Measured: `drop view if exists` on a
  materialized view raises `"x" is not a view`, and `drop materialized view if exists` on a plain
  view raises `"x" is not a materialized view` — so **neither ordering of the two is safe** and the
  object survives both. Any migration that may meet either form needs a `relkind`-aware `do` block.
  Migration 13's `pg_depend` loop needed the same fix: a matview HAS a `pg_rewrite` entry, so it is
  discovered as a dependent and the plain `drop view` fails the deploy on pass 2. The four-pass test
  passed before that fix **only because migration 13 happened to run first and remove it** —
  accidental safety, and exactly the kind that stops being true when files are reordered.
- **`information_schema` OMITS MATERIALIZED VIEWS ENTIRELY** — it reports **0 columns** for one, so
  any check written against `information_schema.columns` fails for a reason unrelated to what it
  tests. Use `pg_attribute`. (Cost one false "the column is missing" while it was plainly there.)
- **A MATERIALIZED VIEW MAKES EVERY FIXTURE-BASED TEST A SNAPSHOT TEST.** Rows inserted in the test
  transaction are invisible until the view is rebuilt, so three existing tests began failing for a
  reason that had nothing to do with their subject. They now `refresh materialized view` after
  inserting — the **non-concurrent** form deliberately, because `refresh … concurrently` cannot run
  inside a transaction block and a test that cannot roll back is not a test.
- **COVERAGE AND CONCENTRATION ARE DIFFERENT QUESTIONS, AND A HIGH COVERAGE ACTIVELY IMPLIES THE
  WRONG ANSWER TO THE SECOND.** `aggregate_performance` returned developed/large-cap/value
  information technology at **+327.40%** with `constituents 77/80` and `weight_covered 0.98` — every
  completeness guard satisfied, the arithmetic correct, and **240 of those 327 points from two
  companies** (MU +670.8% at $1,088.7bn; SNDK +3,471.6% at $185.6bn). The returns were REAL, which
  was checked rather than assumed: MU has 276 smooth bars, largest single-bar move ×1.19, SNDK
  ×1.28 — far under this pipeline's ×6-in-one-bar corruption threshold. **Weight share alone does
  not detect it**: MU is 19% of the bucket by cap and SNDK only 3.2%, yet SNDK supplies a third of
  the answer. Concentration in a weighted mean lives in `weight × return`, so the measure is the
  largest single **|w·r|** over the summed **|w·r|**, absolute so a big faller cannot hide behind
  the risers. The 2.5× gap between the cap-weighted and equal-weighted means was the first hint —
  which is why both are returned.
- **A FIXTURE WHERE TWO RANKINGS AGREE CANNOT TELL THEM APART, AND THE MUTATION WILL PASS CLEAN.**
  The concentration test's top contributor was also its largest holding, so "rank by market cap" and
  "rank by influence" produced the same answer and a mutation swapping them was undetectable. The
  replacement makes all three plausible rankings pick **different** securities — WHALE ($100bn, +1%)
  by weight, RISER (+300) by signed contribution, CRASH (−1,000) by absolute influence. When a guard
  distinguishes between candidate rules, the fixture has to make those rules disagree.
- **ECONDB IS FREE, AND THE 204 IS ONE IP-BLOCKED ENDPOINT — not a paywall. I asserted the paywall
  from a 204 and was wrong; the correction came from reading the provider rather than the status
  code.** Measured 2026-08-19 against the deployed
  openbb-api: `economy/available_indicators?provider=econdb` returns **4,506 rows** (172 distinct
  indicator types, with `symbol_root`, `country`, `iso`, `frequency`, `scale`, `first_date`,
  `last_date`), while `economy/indicators` returns **204 NO CONTENT for every symbol tried** — with
  and without a date range, single- and multi-country, and with no `ECONDB` key configured on the
  container. An earlier session recorded "4,506 indicators / 192 countries / 174 types — all
  keyless and working" in the plan; what had been verified was the CATALOGUE. The same trap as
  probing an endpoint with symbols you expect to succeed.
  **What is actually happening** (traced 2026-08-19): `openbb_econdb` declares an `econdb_api_key`
  credential but SELF-PROVISIONS when none is set — `helpers.create_token()` fetches a free
  temporary token (24h, no account) from `econdb.com/user/create_token/`. From the Oracle node that
  call returns **403 on every User-Agent**, `create_token` swallows the failure and returns an
  EMPTY string, the data request then goes out with `token=`, and the whole thing surfaces as a
  bare 204. Measured from a different IP the same endpoint returns
  `{"api_key": "...", "expires": "<24h>"}` — HTTP 200.
  **The block is one ENDPOINT, not the domain, and not the data.** From the node:
  `econdb.com/` → 200, `/user/create_token/` → **403**, and
  `api/series/?token=<a token minted elsewhere>` → **200 with `count: 5170`**. So supplying
  `ECONDB_API_KEY` unblocks the full catalogue — the node can talk to econdb perfectly well, it
  just cannot mint its own credential. A free econdb account yields a permanent key; the temporary
  token works but expires daily and is not a deployment strategy.
  **The lesson is the inference, not econdb.** A 204 plus "no key configured" is not evidence of a
  paywall — it was two hypotheses stacked (needs a key, and the catalogue's 200 proves the data is
  free) and both were wrong. A UA workaround was tried next and also wrong. Reading the provider's
  own code answered it in one step.
  Two parameter facts worth not re-deriving: the query takes **`symbol_root` + `country`**, not the
  composite `symbol` (`RGDPUS` 400s with *"No valid combination of indicator symbols and countries
  were supplied"* — a genuinely informative error, unlike the 204), and `country` is the
  **lower-underscore** form (`united_states`), so passing the catalogue's own `"United States"`
  produces an unencoded space and curl fails before the request leaves.
  **What IS keyless, measured the same hour** (rows returned, not just a 200):
  `economy/cpi` oecd (multi-country works — 84 rows for 4 countries) · `economy/gdp/real` ·
  `economy/gdp/nominal` · `economy/unemployment` oecd · `fixedincome/government/yield_curve`
  federal_reserve (11 maturities) · `fixedincome/rate/effr` and `/sofr` (400+ rows) ·
  `derivatives/futures/historical` yfinance (`GC=F`, `CL=F`) · `crypto/price/historical` yfinance ·
  `index/price/historical` yfinance (`^GSPC`). **Confirmed NOT working:** econdb indicator data,
  and `yield_curve?provider=ecb` (500). A macro layer is buildable on OECD + the Fed + yfinance
  TODAY with no credential at all, and gains econdb's 4,506 indicators the moment `ECONDB_API_KEY`
  is set — those are two increments, not two designs.
- **`economy/available_indicators?provider=imf` OOM-KILLS openbb-api — I took the service down with
  one probe.** Measured 2026-08-19: the container `Exited (137)` (SIGKILL, i.e. OOM) against its
  **1 GB** limit, and every subsequent request got `Connection refused` until Swarm restarted it
  ~15s later. The IMF provider materialises its whole dataflow catalogue in memory. openbb-api is
  a SHARED production service — the agent's market tools and every `market-refresh` resource use
  it — so an exploratory call is not free. Probe unfamiliar catalogue endpoints with a bounded
  query (`?query=`/`limit=`) or against a local container, never bare against the node.
- **ECONDB HAS NO FREE PROGRAMMATIC TIER, so the token endpoint is not the way in.** The provider
  self-provisions a free 24h token, which is why the block looks like a bug — but a permanent key
  is paid, and the 403 from this node is a deliberate signal even if it is blanket cloud-IP
  blocking. Do not route around it. **FRED is the replacement and the key is ALREADY CONFIGURED**
  on openbb-api (`FRED_API_KEY`, verified set): `economy/fred_series` serves international macro by
  explicit series id — `LRHUTTTTDEM156S` (Germany harmonised unemployment) returns 42 rows, latest
  3.9 for 2026-06; `IRLTLT01DEM156N` (Germany long rate) 2.97. **`economy/fred_search` returns 204
  here**, so there is no working auto-discovery — a FRED catalogue must be CURATED series by
  series, which is precisely what `market.macro_indicator` being a control table makes cheap. Note
  FRED retires series: `JPNCPIALLMINMEI` returns 0 rows and is discontinued, so a seeded id needs
  its coverage checked rather than assumed.
- **PROMOTING BY POOL SIZE SPENDS A FIFTH OF THE BUDGET ON COMPANIES ALREADY HELD.** 92,826 of
  108,105 exchange listings are untracked across 59 venues, and every downstream backlog shares one
  rate-limited provider budget — so promotion is not "add securities", it is "decide what the next
  month of a fixed API budget buys", and the ORDER is the feature. Ranking by untracked count puts
  Frankfurt first (15,711, ahead of the US at 10,160). Measured 2026-08-19, 400 listings per venue
  matched by name against securities already held: **GR 18.3%**, IB 6.0%, LN 5.3%, HK 4.8%,
  **US 0.5%, JP 0.3%**. `untracked_listing` cannot see it because it excludes by composite FIGI and
  **`composite_figi` is per COUNTRY OF LISTING, not per company** — so the listing is genuinely
  untracked while the COMPANY is not, and promoting it mints a duplicate that then consumes profile,
  price and statement calls of its own. 18.3% is a LOWER BOUND (exact name matches only). Hence
  `market.exchange.promotion_tier` ranks home markets first, the name dedupe lives in the VIEW (a
  resource that fetched a listing and discarded it has already spent the call), and
  `promotion_enabled` is FALSE for every venue so a deploy can never start spending on its own.
- **`exchange_listing` CARRIES NO LIQUIDITY OR CAP SIGNAL — only identity.** So "promote by
  liquidity tier" cannot be gated on liquidity: you must promote a security to learn its cap, which
  is the chicken-and-egg the venue tier exists to sidestep. A cap floor can only PRUNE after
  promotion, never gate before it. Do not design a promotion order that assumes otherwise.
- **KILLING THE CLIENT DOES NOT KILL THE QUERY — I STALLED A PRODUCTION DEPLOY FOR 22 MINUTES THIS
  WAY.** An exploratory analysis over `untracked_listing` hit the 2-minute tool timeout, which
  killed `ssh`/`psql` and looked like the query had been abandoned. The SERVER kept executing it.
  It held locks for **1,375 seconds**, and the deploy that started 20 minutes later sat behind it:
  `insert into market.identifier_kind` blocked 567s, `create view market.security_current` 308s.
  The run showed only "Terraform apply, in progress" — nothing in CI says "blocked on a lock", so
  it read as a slow deploy. **Diagnose a slow deploy with `pg_blocking_pids`, not by waiting**, and
  set `statement_timeout` on any exploratory query against the node — a client timeout is not a
  server timeout.
  Two smaller traps in the cleanup: `pg_terminate_backend` filtered by `query like '%...%'` matches
  **its own text**, so without `pid <> pg_backend_pid()` the killer terminates itself and the target
  survives (measured — the first attempt died with `terminating connection due to administrator
  command` and the blocker lived). And one logical query occupied **two** backends, so the fix is to
  terminate the matched SET rather than a single pid.
- **"DOES IT RETURN ROWS" IS NOT "IS IT STILL PUBLISHED" — a series can answer and be a year
  stale.** Migration 83 drove all 42 FRED candidates before seeding, precisely so a retired id could
  not ship blind, and still shipped three defects that only the FIRST REAL RUN exposed. Ten CPI
  series (`CPALTT01*M659N`) end at **2025-04-01**: the probe used `start_date=2025-01-01`, saw 4
  rows and `latest 2.311289`, and that was read as current when it was April 2025. The resource's
  400-day window starts after the last observation, so it correctly got zero.
  `us-unemployment-fred` was worse — it ANSWERED, with data eleven months old, beside a current
  OECD series. **Check the DATE of the newest observation, not the row count.**
- **TWO SERIES FOR ONE FACT IS WORSE THAN NONE.** The FRED seed duplicated what migration 82 already
  had (US and German CPI, US unemployment), so a country panel would show two rows labelled the
  same thing, disagreeing, with no way to tell which to believe. Guarded by
  `one-fact-one-series.sql` on (country, category) — but NOT for `rates`, where a 10y yield, EFFR,
  SOFR and a yield curve are four INSTRUMENTS rather than four answers.
- **A UNIT IS A MEASUREMENT, NOT A GUESS.** `us-gdp-real` was catalogued `index`; OECD's
  `gdp/real` actually returns **25,575,729,500,000** (and `gdp/nominal` 32,475,210,000,000) — USD
  LEVELS at the right magnitude for US GDP. The panel prints a value it cannot name as a bare
  number, so the deployed US page read `25575729500000`. `macro_indicator.unit` now holds a
  THREE-LETTER CURRENCY CODE where the value is money, because OECD returns GDP in each country's
  NATIONAL currency — a boolean "is money" cannot carry that, and defaulting to dollars is how the
  currency bug started.
- **A TERM STRUCTURE IS ONE FACT, NOT ELEVEN ROWS.** `us-yield-curve` returns a point per maturity,
  so the first country panel rendered the US with **18 rows, 11 of them the curve**, against 2-3 for
  every other country. Anything rendering `macro_current` must collapse per SERIES, not per
  observation. Guarded offline in `macro-format.ts` + `scripts/macro-panel-check.ts` — the panel
  component itself imports react-native, which `tsx` cannot transform, so testable logic has to
  live outside it (the same split `money.ts` uses).
- **A DEAD APT MIRROR LOOKS LIKE A FLAKY NETWORK AND IS PERMANENT.** Two deploys failed with
  `Failed to update apt cache after 5 retries: ` — no cause in the message, and "after 5 retries"
  reads as transient, so the second deploy was run purely on that assumption. Oracle's cloud-init
  pins a REGIONAL Ubuntu mirror and Canonical retired those names: `uk-london-1-ad-3.clouds.ports.
  ubuntu.com` and the bare `uk-london-1.clouds.ports.ubuntu.com` both NXDOMAIN while
  `ports.ubuntu.com` resolves. **DNS itself was fine** (`download.docker.com` resolved from the same
  box), so no connectivity test could find it — only reading what apt said on the node. Repaired in
  `muffin_stack.yml`'s `pre_tasks`, keyed on "does the configured mirror resolve" rather than on the
  one hostname we know about, so a node replacement and the next retirement are both covered.
- **A RESOURCE THAT WRITES A NEW `source_code` MUST SEED IT IN THE SAME MIGRATION, AND NOTHING
  DOWNSTREAM CAN CATCH THE OMISSION.** Migration 88 made `security-statements` write
  `source_code: 'sec'` and never created the row — only `sec-nport` existed, which is a different
  filing (fund holdings, not company accounts). `security_statement.source_code` is a foreign key,
  so the FIRST REAL RUN in production died with `violates foreign key constraint
  "security_statement_source_code_fkey"` and took the whole resource with it, **including the
  yfinance rows batched alongside**. The migration tests apply to a database where no resource ever
  runs, so the constraint is never exercised and all four passes were green; `deno check` and every
  behaviour test passed too. Migration 67 had done it right for Tiingo a year earlier — seeding the
  source beside the resource — so this was a habit, not a rule. It is a rule now: `logic-check.ts`
  fails on any `source_code: '<x>'` literal in the functions that no migration seeds. (CLAUDE.md
  previously said `data_source` rows are "LEARNED by the ingest at runtime". They are **not** —
  nothing in the edge functions inserts one; migrations 10, 13 and 67 seed them all.)
- **THE TWO STATEMENT PROVIDERS SHARE ALMOST NO FIELD NAMES, so a metric's provider spelling is
  DATA.** Measured 2026-08-20 on the deployed openbb-api (AAPL, annual): `sec` and `yfinance`
  income statements share **4 of 40** field names and one of the four is `period_ending`, which is
  not data. Balance sheets share 14 of 52/70, cash flows 8 of 45/54. Pre-tax income is
  `total_pretax_income` on one and `total_pre_tax_income` on the other — **one character**, so it
  reads as a typo and "correcting" it silently empties the series for that provider. SEC reports no
  free cash flow line and no total debt at all; both are derived. Since migration 88 made SEC the
  preferred provider, `security_statement.data` genuinely holds two vocabularies, and
  `data->>'free_cash_flow'` returns null for every SEC period — **the better half of the data** —
  with no error. Hence `market.metric` + `market.metric_source_field` (migration 89): the metric and
  each provider's spelling are rows, so a third provider is a row. Every seeded field name was
  verified present in the measured wire response; none was transcribed from memory.
- **`remaining` MUST MEAN THE SAME THING IN EVERY RESOURCE, AND PAGE-SCOPED IS THE WRONG ONE.**
  `security-statements` reported `remaining: 0` on a run that had asked 20 of **8,633** — correct
  as "what is left of this page", indistinguishable from a drained backlog, and a different unit
  from `security-industries`' `remaining`, so comparing two runs was misleading by construction.
  Now counted with `Prefer: count=exact` + `head: true` (never a page — a limit above
  `PGRST_DB_MAX_ROWS` silently returns 1,000), with the page-scoped number kept as `unanswered`.
  The existing units guard was **extended, not weakened**: the exemption matches only
  `backlogSize(market, 'pending_*')`, and both a different helper and a bare page size still fail it.
- **SEC's STATEMENTS ARE GENUINELY MULTI-CURRENCY, which is why the label could never be guessed.**
  Of the first 522 rows: USD 333, **EUR 111, DKK 30, PEN 24, TWD 24** — foreign private issuers
  file 20-F in their own currency. 36% would have been wrong under a USD default. Depth landed as
  measured too: **2008-12-31 .. 2026-01-25**, 13.4 periods per security (min 8, max 18) against
  yfinance's 4. Note `security_statement_current` exposes the new `currency` only via `st.*`; the
  app still labels from `security.currency_code` (the QUOTE currency), so the view needs an
  effective `reporting_currency` before the UI can use it — correct data nothing consumes.
- **A MUTATION HARNESS'S FINGERPRINT MUST COVER WHAT THE MUTATION CHANGES.** Two of migration 89's
  guards were certified vacuous by my own harness: the fingerprint hashed `metric_source_field` and
  `security_metric`'s columns but not `metric.is_derived`, so flipping that flag registered as "no
  schema change, mutation proves nothing"; and a "10 or more spellings differ" floor could not see a
  SINGLE spelling being tidied into agreement — which is the realistic regression. Both were only
  visible because the harness reports a no-op mutation as loudly as a missed one.
- **THE FALSY-NULL GATE HAS A SQL TWIN: `x <> 'US'` IS *NULL*, NOT TRUE, WHEN `x` IS NULL.** The
  currency-labelling rule failed open once in the caller (`USD AND country !== 'US'`, and BABA's
  filed country is NULL, so it declined to fire on the security it was built for). Moving it into
  `security_statement_current.reporting_currency` would have reproduced the bug exactly if written
  as the same negation — a security with no country at all falls through `currency_code = 'USD' and
  country <> 'US'` because the conjunction is NULL rather than true, and gets labelled USD. Write
  such a rule in the POSITIVE form (`<> 'USD' → label`, `= 'US' → label`, `else null`) so an unknown
  country falls through to WITHHELD. And put the rule in the view: one expression, using the same
  EFFECTIVE country `security_current` answers with, is what stops a caller re-deriving it wrongly.
- **DERIVING NEEDS NO PROVIDER, so it is SQL — and that changes what the backlog MEANS.**
  `market.derive_security_metrics` turns 105,927 statement periods into a metric series in one
  statement: no worker limit, no rate limit, no batching, no negative cache, because it has none of
  those problems. Consequently `pending_metrics` is a DRIFT COUNTER (statement periods that produced
  no metric — i.e. the catalogue's field names no longer matching the provider), not a work queue:
  the function re-derives everything every run, so a queue would always be empty and say nothing.
  Expected non-zero and stable; the TREND is the signal.
- **CAPEX SIGN DIFFERS BY PROVIDER, and the wrong sign is not obviously wrong.** yfinance sends
  capital expenditure NEGATIVE (a cash outflow), SEC POSITIVE (a purchase). Free cash flow must use
  `abs()`: subtracting a negative ADDS the capex and reports free cash flow ABOVE operating cash
  flow — impossible, and it reads as merely optimistic. Likewise **a computed row must say so**:
  derived rows carry `source_code = 'derived'`, because `metric.is_derived` cannot answer the
  per-row question (free cash flow is REPORTED by yfinance and COMPUTED for SEC), and without a
  distinguishable marker a re-run cannot tell its own output from a provider's figure and replaces
  the provider's answer with arithmetic.
- **A FIXTURE WHERE THE CANDIDATE RULES AGREE CANNOT TELL THEM APART — THREE TIMES IN ONE DAY.**
  Every one was caught only because the harness reports a mutation that changes nothing as loudly
  as one that is missed. (1) Dropping `abs()` from the free-cash-flow derivation passed clean: the
  SEC fixture's capex was positive and the yfinance fixture reported its own FCF, so both agreed
  under either rule — a third period (yfinance spellings, negative capex, no reported figure) was
  needed. (2) Swapping the EFFECTIVE country for the FILED one passed clean, because no fixture row
  had them differ — a promoted American company (filed NULL, operating US) was needed. (3) A "10 or
  more spellings differ" floor could not see a SINGLE spelling being tidied into agreement, which is
  the realistic regression. **When a guard distinguishes between candidate rules, the fixture has to
  make those rules disagree** — and the fingerprint has to cover what the mutation changes, or the
  no-op is silently certified.
- **A `LIMIT` WITHOUT AN ANTI-JOIN IS NOT A PAGE — I SHIPPED THIS FILE'S OWN HEADLINE BUG.**
  `derive_security_metrics(p_limit)` selected `order by security_id, period_ending desc limit N`,
  which is the SAME first N rows on every call. Two production invocations returned byte-identical
  results (`written: 7386, remaining: 104925`), i.e. thousands of rows of "progress" and the same
  work for ever — exactly what `pending_industry` did for months. **The tell is a `written` that
  looks like throughput and never moves**, and the fix is that a page's source set must be an
  anti-join over what is already done, not an ordering. Note the ordering was the part that LOOKED
  deliberate. Unlimited was no better: 105,927 statements exceeded the statement timeout on the role
  PostgREST uses, so it correctly reported `ok: false` and did nothing. Guarded by
  `tests/a-page-must-advance.sql`, whose fixture uses three securities and a page of ONE so a
  non-advancing select is arithmetically unable to finish.
- **A DERIVATION'S BACKLOG MUST BE "NOT DONE **OR** RE-FETCHED SINCE", AS ONE PREDICATE SHARED WITH
  THE WORK.** `pending_metrics` first asked "has no metric at all", which would call a re-fetched
  statement done and keep the number derived from the old one — live risk, since
  `security-statements` is rewriting rows across the universe as SEC supersedes yfinance. The
  condition that covers both halves is "no metric for that (security, period) whose `fetched_at` is
  at least as new as the statement", and the VIEW and the FUNCTION now share it rather than being
  two descriptions free to disagree.
- **`now()` IS TRANSACTION TIME, so a test that writes and then "re-fetches" inside one transaction
  cannot tell them apart** — both get the same timestamp and the row reads as already processed for
  a reason unrelated to the rule under test. Say so explicitly in the fixture (`now() + interval
  '1 second'`) rather than reaching for `clock_timestamp()`, which makes the difference look like an
  accident of timing rather than the point.
- **A GUARD ANCHORED ON "THE FIRST MATCH IN THE FILE" IS ANCHORED ON NOTHING.** logic-check's sweep
  deadline guard matched the first `while (Date.now()...)` in `index.ts` — the sweep's only by
  accident of ordering. Adding a paged loop to an earlier resource made it read the wrong loop and
  fail for a reason unrelated to what it tests. Slice to the owning handler
  (`index.slice(index.indexOf('resource === X_RESOURCE'))`) first, the way the per-resource guards
  do. Its own comment already warned about this one level down, which is the point: the fix for
  "the pattern matched somewhere else" is not a better pattern.
- **A TIME WINDOW IS NOT A SCOPE — right after a drain, EVERYTHING is inside it.** The derived
  passes (free cash flow, total debt) were scoped `where fetched_at > now() - interval '10 minutes'`
  to stop them walking the whole table. Measured in production the moment the backlog settled:
  `{"written":576828,"pages":21,"remaining":28}` — 576,828 upserts with **28** statements left to
  derive, because the previous run had written those ~750,000 rows minutes earlier. On a 10-minute
  cron that is ~600k upserts and the matching WAL every ten minutes for ever, on one Always-Free
  node, while `written` and `pages` both read as throughput. **A pass that follows another must be
  scoped to what that one TOUCHED** — capture the keys with `returning` into a temp table and join
  them. Exact, no clock, and it cannot drift with how often the resource runs.
- **AN ANTI-JOIN MUST BE KEYED AT THE GRAIN OF THE WORK, NOT THE GRAIN OF THE ENTITY.**
  `derive_security_metrics` asked "does this security have any metric for this period" — and all
  three of a period's statements (income, balance, cash) share that key, so deriving the income
  statement marked the other two done **for ever**. Production did not show it, by luck: the first
  drain ran against an empty table so all three kinds sat in one page and were derived together. It
  bites at every PAGE BOUNDARY and whenever `security-statements` rewrites only some of a period's
  rows — which is precisely what SEC superseding yfinance does. Ask the question through the table
  that defines the grain (`metric_source_field` says which metrics a statement kind can produce)
  rather than inventing a key.
- **TIED SORT KEYS MAKE A PAGED TEST FLAKY, AND A FLAKY TEST IS WORSE THAN NO TEST.** The fixture
  gave several statements the same `as_of`, and the function pages with `order by st.as_of limit N`
  — so which rows a page of ONE picks is an arbitrary tie-break. Two identical mutation runs
  disagreed about which guard caught which mutation, which reads as a real difference and is noise.
  Make the ordering TOTAL in any fixture that exercises paging.
- **A FIXTURE MUST REACH EVERY BRANCH THE MUTATIONS TARGET — fifth instance.** The same fixture had
  only income statements, so the free-cash-flow and total-debt passes had nothing to compute and
  mutations unscoping them passed clean. Adding cash and balance rows is what made the two rules
  disagree. The pattern across all five: **before believing a guard, ask which fixture row would
  behave differently if the rule were wrong** — if the answer is "none", the guard is decorative.
- **ADDING A FILTER TO A VIEW CHANGES ITS PLAN, AND I BROKE THE CHART THIS WAY — third occurrence
  of the anon-timeout shape.** Migration 94 gave `price_series` a `grain` column so the app could
  ask for one resolution. Measured as ANON immediately after deploying: `symbol=eq.AAPL` **696 ms**,
  `symbol=eq.AAPL & grain=eq.daily` **57014 statement timeout**. The chart was broken by the filter
  it had just been given, and only for anon — every service-role probe was healthy.
  `EXPLAIN` named it: with `grain` fixed to a constant it folds out of the `distinct on` sort key,
  the row estimate changes, and the planner flips from hash-joining `security_symbol` ONCE to a
  nested loop evaluating that view's laterals **per row** — `Nested Loop Left Join (actual
  rows=3056435)` to answer a question about one symbol. **The fix is `with … as materialized`**,
  which forces the symbol resolution to be evaluated a single time: 3,056,435 → 27,629 rows,
  timeout → **258 ms**, row-identical. Reordering the `distinct on` was tried FIRST and changed
  nothing — "the filter changed the sort key" is the obvious story and is not the cause. Guarded by
  `check_anon_read_latency.py` (market-verify check 10), which times the CONJUNCTIONS the app
  actually sends, as anon, against a 2,000 ms budget rather than the 3,000 ms ceiling — a query
  that has crept to 2.9s is already broken for a user, and a guard that fires only at the ceiling
  reports an outage instead of a regression.
- **SEQUENCE A SCHEMA CHANGE AND ITS READER SO NEITHER HALF CAN BE ALONE AND BROKEN.** The backend
  (`grain` + the column) shipped BEFORE the app that filters on it, deliberately: until the app
  deploys, every bar is `daily` and the old query is unaffected. That ordering is what kept the
  above from being a user-visible outage — the regression existed in production for the length of
  one deploy and was found by probing as anon rather than by a user finding it.
- **HALF THE SEC FILERS REPORT IN IFRS, AND `companyfacts` PUTS THEM UNDER A DIFFERENT TAXONOMY.**
  The first real `security-xbrl` run returned `noFacts: 10` of 20 — every one a foreign private
  issuer (AB InBev, Ryanair, Equinor, Santander, Novo Nordisk, TSMC, BHP, Nokia). They file 20-F
  under IFRS, and AB InBev's taxonomies are exactly `['dei', 'ifrs-full']` — **no `us-gaap` node at
  all**. Reading one taxonomy marked ten good filers absent for 30 days with no error while the
  resource reported success. Concept names differ per taxonomy (`Revenue` vs
  `RevenueFromContractWithCustomer…`, `Equity` vs `StockholdersEquity`), measured across five
  filers at 14-15 of 15 metrics each. **AND THE UNIT KEY IS THE REPORTING CURRENCY** — Novo
  Nordisk's facts sit under `DKK`, Nokia's under `EUR`, TSMC's under `TWD` *and* `USD` (a
  convenience translation). So the currency arrives free and per filer; where several exist the one
  with the MOST data points wins, because picking USD by habit relabels kroner as dollars. Verified
  live: Banco Santander revenue €66,088,000,000, annual and quarterly.
- **A WRONG NAME IS NOT A MISSING SECURITY, AND ONLY THE PROVIDER CAN TELL YOU WHICH.** Measured:
  `ATCOA.ST`, `6.HK`, `BRK/B`, `WALMEX*.MX` and `RR/.L` all return ZERO bars while `ATCO-A.ST`,
  `0006.HK`, `BRK-B`, `WALMEX.MX` and `RR.L` return 190 — an empty response and a wrong spelling
  are indistinguishable from the caller, so the negative cache hides an ordinary company for 30
  days. `security-symbol-repair` generates candidates and **verifies each against the provider
  before adopting it**, because pattern-matching alone rewrites WORKING symbols: the Nordic rule
  matches `SAND.ST` (Sandvik), `ALFA.ST` (Alfa Laval) and `TELIA.ST`, which are complete company
  names ending in a letter the rule reads as a share class. `SAND.ST` therefore does generate
  `SAN-D.ST`; the provider refuses it and nothing is written. Never pattern-match and rewrite.
- **A WEIGHT-ORDERED BACKLOG STALLS ON ITS OWN HEAD IF A BATCH IS NOT ISOLATED — fourth instance.**
  `security-share-stats` reported `stats: 0, estimates: 0, remaining: 11136` on eight consecutive
  runs. One symbol: `openbb 400 on /equity/estimates/consensus?symbol=HUMANSFT.KW,ROST,…` took all
  40 with it, and because the backlog orders by fund weight the SAME poisoned head returned every
  run. "One dead symbol kills a batched provider call" was already recorded three times
  (`group-performance`, `security-profiles`, `security-industries`) and `fetchWithIsolation` exists
  for exactly this — I wrote a new batched resource without it. **Any new batched resource uses
  `fetchWithIsolation`, and a symbol the provider rejects ALONE gets marked so the head can advance.**
- **RESOLVING A SYMBOL THROUGH `security_symbol` COSTS A SCAN OF THE WHOLE UNIVERSE.** It is a view
  over two LATERAL subqueries per security, so a query filtered to ONE symbol still evaluates all
  27,629 — `Seq Scan on security (actual rows=27629)` with a `Limit` subplan per row. Measured after
  the weekly backfill: daily chart 260 ms, weekly **1,382 ms**, and anon timed out under ordinary
  load. `market.symbol_security` is the materialised map with an index on the symbol, refreshed
  inside `refresh_facets` beside the spine — a matview with no scheduled refresh is a stale view
  nobody notices. Note this is the SECOND fix to the same view: migration 096 removed the per-ROW
  cost, 102 the per-QUERY one.
- **`cmd | head` REPORTS HEAD'S EXIT CODE, AND I BELIEVED IT TWICE IN ONE DAY.**
  `npx tsc --noEmit 2>&1 | head -4; echo "tsc=$?"` always prints 0, so a genuine type error read as
  clean and CI caught what I had called verified. The same shape in a mutation harness —
  `echo "$(basename $f) exit=$?"`, where the command substitution runs first and resets `$?` —
  briefly convinced me a working guard was broken. **Redirect to a file and test the command's own
  status**, never a pipeline's tail.
- **A RATIO ACROSS CURRENCIES NEEDS A RATE PER BAR, AND `fx_rate` HELD THREE DAYS.** BHP and Shell
  report in USD and trade in AUD and GBP, so they had no P/E at all — correct, but not the last
  word: the conversion is arithmetic and the rates are free. Spot is enough to reprice a market cap
  TODAY and useless for a SERIES, because converting a 2021 bar with today's rate is wrong by every
  intervening move and looks ordinary. `fx-rates` now backfills ten years of WEEKLY rates (Yahoo's
  chart endpoint, `range=10y&interval=1wk`, ~520 bars) and the view joins each bar to the most
  recent rate AT OR BEFORE it — nothing interpolated, because a rate we did not observe is not a
  rate. It converts the METRIC, not the price: re-denominating the price would make this view
  disagree with `price_series` about what a share costs. `fx_converted` is its own column because
  "comparable" and "made comparable" are different facts. Subunits (ILA, ZAC, KWF) get history
  derived from the parent in the SAME pass, or a subunit whose parent has ten years and which has
  three days silently falls back to spot for every historical bar.
- **A BACKLOG PROBE MUST NOT BE A PAGE — I shipped this file's own headline bug again, one day
  later.** The FX history backlog asked "which currencies have a row older than 90 days" by
  SELECTING those rows; `PGRST_DB_MAX_ROWS` caps that at 1,000 and the backfill writes ~520 rows per
  currency, so after two currencies the probe could not see past its own page and re-fetched the
  same four for ever. Three consecutive production runs returned an identical `historyFor` with no
  failures, which reads as throughput. Every other backlog here is a VIEW for exactly this reason.
  A count (`Prefer: count=exact` + `Range: 0-0`) would also have been sound but needs one request
  per entity; the anti-join is one request total.
- **`pending_%` IS A LOAD-BEARING NAMING CONVENTION.** `every-table-is-reachable` classifies a view
  as a service-role work queue by that prefix and requires anon to read everything else, so naming a
  backlog `fx_pending_history` fails CI as an unreadable serving view. Name it `pending_fx_history`.
- **`market.currency` IS POPULATED BY THE INGEST AT RUNTIME, NOT BY A MIGRATION.** So USD does not
  exist on a fresh database, and a test asserting "USD is never queued for its own exchange rate"
  passes for the wrong reason — certifying an exclusion that may not be there. Seed it in the
  fixture. Same family as `data_source` and `asset_category`.
- **`pg_isready` REPORTS TRUE DURING POSTGRES INIT**, before the server accepts real connections. A
  local harness that waits on it races the container: role creation fails, and the entire suite then
  fails with `relation "market.security" does not exist`, which looks like a catastrophic migration
  break. Wait on an actual query (`psql -tAc 'select 1'`).
- **THE REPORTING CURRENCY WAS ALREADY FETCHED AND STORED — fifth instance of "the answer is
  already in a response you fetch".** Quarterly statements for foreign filers produced metrics and
  TTM and STILL no P/E, because the income/balance/cash endpoints carry no currency field, so every
  yfinance-derived metric has `currency_code` null and the gate correctly declined to divide.
  Samsung showed a net margin of 21.46% beside an empty P/E. `equity/fundamental/metrics` carries
  it and `security_fundamentals.raw->>'currency'` had held it all along. **It is the REPORTING
  currency, not the quote currency, and that was settled by probing the securities expected to
  DISAGREE**: BHP.AX quotes AUD and answers **USD**, SHEL.L quotes GBP and answers **USD**, while
  005930.KS and 7203.T answer their own KRW and JPY. Had it been the quote currency, using it would
  have made every ratio pass the gate that exists to stop dividing dollars by kroner. It is a
  FALLBACK and never an override — a metric that states its own currency states it from the filing.
- **A `\i` PATH RESOLVES AGAINST THE CLIENT'S WORKING DIRECTORY.** A test that runs a real
  migration with `\i /repo/stack/...` passes in the local container (repo mounted at `/repo`) and
  fails in CI, which runs psql from the checkout root. Use a repo-relative path — an absolute one
  fails only in the one place you cannot iterate quickly.
- **A MUTATION HARNESS THAT PIPES SQL THROUGH STDIN CANNOT REACH A TEST THAT READS THE FILE.**
  `a-promoted-currency-must-be-a-currency.sql` runs the migration with `\i`, so every mutation of
  the promotion statement was certified as guarded while the clean file was what actually ran. Write
  the mutated file to disk. Fifth form of "verify the mutation reached the thing under test", after
  `sed` mis-escaping, wrong indentation, a migration that never applied, and a fingerprint that
  returned an empty string.
- **THE PostgREST ROLE'S STATEMENT TIMEOUT IS EIGHT SECONDS, and it is a THIRD limit distinct from
  the 90s worker budget and the 3s anon ceiling.** Measured 2026-08-21 on `derive_ttm`: 100
  securities 2.7s, 200 4.1s, **400 8.1s and cancelled**. The cost is SUB-LINEAR (a fixed ~1.2s plus
  ~0.015s per security), so a bigger page looks tempting right up to the cliff. Size a page against
  the timeout that actually applies, and LOOP it to the worker deadline rather than enlarging it —
  looping drains more per run and cannot fall off the cliff as the data grows.
- **A PRICE-BASED RATIO WAS A US-ONLY FEATURE AND NOTHING SAID SO.** Measured 2026-08-21 against
  the deployed `security_ratio_series`: AAPL/MSFT/NVDA return a P/E; **SAP.DE, 7203.T, 005930.KS,
  ASML.AS, TSM and BABA return NO ROWS AT ALL**. SAP.DE has price bars and statements back to 2016
  and only ANNUAL metrics — `derive_ttm` needs four consecutive quarters, and quarters came only
  from SEC XBRL `companyfacts`, which needs a CIK. **3,516 securities have one against 12,350
  equities**, so 72% of the universe could not show a valuation ratio and the section simply did
  not render. The fix was one parameter: `equity/fundamental/{income,balance,cash}
  ?provider=yfinance&period=quarter` returns 5 quarterly periods for all of them (Nestlé excepted —
  Swiss issuers report SEMI-ANNUALLY, a fact, not a failure). **The SEC path is annual-only
  (`period=quarter` answers 422) and the yfinance statement call passed `limit=4` with no `period`
  at all**, so nobody had checked what fraction of the universe the feature could serve. Ask that
  question of any feature built on a provider-specific key.
- **QUARTERLY DOES NOT BATCH — two symbols in one request return ZERO rows**, which is the same
  reason `STMT_BATCH` is already 1. Three calls per security against a rate-limited provider makes
  `security-quarters` the most expensive backlog per security in the system, hence a scoped
  `pending_quarters`: SEC filers excluded (paying to overwrite a 17-year record with a 5-quarter
  one), securities with no annual statements excluded (nothing shows the provider answers for that
  symbol), ordered by FUND WEIGHT rather than market cap.
- **A FISCAL-YEAR END IS BOTH AN ANNUAL PERIOD AND A FOURTH-QUARTER ONE.** `security_statement` was
  keyed `(security_id, statement, period_ending)`, so SAP's 2025-12-31 arriving twice would have
  silently replaced the annual revenue with three months of it — **wrong by a factor of four, in
  the right units, with no error and an identical row count**. `period_type` had to join the key,
  and with it BOTH writers' `onConflict` **and both dedupe keys**: a stale dedupe key drops the
  quarterly row as a duplicate of the annual one before the upsert ever sees it.
- **A WHOLE-UNIVERSE PASS IS NOT A STATEMENT, AND IT PASSES UNTIL THE DATA GROWS.**
  `derive_ttm(null)` recomputed everything in one statement: 83,247 rows in ~14s when
  `security_metric` held 55,390 quarterly rows. The XBRL rebuild took that to **1,390,700** and
  every call began returning `canceling statement due to statement timeout` — and because
  `security-metrics` calls it last, the whole resource reported `ok: false` and the metric layer
  stopped. Found by driving the new resource and READING THE RESPONSE (`written: 103, ttm: 0`
  beside a timeout), not by a row count. I blamed the primary-key change from the previous PR
  first; the counts disproved it, and `security_statement` answered reads in 95ms throughout, so
  nothing was lock-blocked. **The input grew; the statement did not change.**
- **A PAGE OVER AN ANTI-JOIN ADVANCES HOWEVER IT IS ORDERED, WHICH MAKES THE OBVIOUS MUTATION
  USELESS.** Mutating `derive_ttm`'s page to `order by security_id limit 1` still PASSED — a
  derived security leaves `pending_ttm`, so any ordering terminates. The defect being guarded is a
  source set that never SHRINKS, so the mutation has to select straight from the metrics table.
  A mutation that changes the code without changing the behaviour certifies the guard falsely.
- **A FINGERPRINT READ THROUGH `psql -c` INSIDE A SHELL STRING RETURNED EMPTY, AND CERTIFIED FIVE
  MUTATIONS AS NO-OPS.** Every comparison was `'' == ''`. Read the fingerprint from a FILE
  (`psql -tAf`) and assert its length before using it — a fingerprint that cannot fail certifies
  everything. Fourth form of "verify the mutation actually reached the database", after `sed`
  mis-escaping, a pattern with the wrong indentation, and a migration that never applied.
- **`create or replace view` MEANS THE LAST FILE WINS OUTRIGHT — copy the CURRENT definition, not
  the one that introduced it.** Migration 106 rebuilt `symbol_cache_classification` from migration
  **050**'s nine entries, silently deleting the eight added by 059/067/087/088/094/095/097.
  `tests/negative-caches-are-classified.sql` named all eight; without it every negative cache added
  in three weeks would have stopped being cleared by a corrected symbol, invisibly.
- **A RATIO IS COMPUTED PER BAR, AND MIXING PERIOD TYPES IN ONE SPAN PARTITION IS A BUG THAT
  TYPE-CHECKS.** financecharts stores `ADJ close` + `DILUTED EPS TTM` and divides; storing P/E
  would be a row per security per day per ratio, all stale the moment a restatement lands. So
  `market.security_ratio_series` joins each metric to the bars in the range it governs
  (`[as_of, next as_of)`) — a metric is STEPWISE, and a P/E that drifted between reports would be
  market movement that never happened. The trap: selecting `ttm` AND `quarter` for one metric puts
  both in the same `lead()` partition, so they cut each other's spans into fragments and the
  pivot's `max()` silently takes whichever number is BIGGER — a P/E four times off, on a chart,
  with nothing to indicate it. A **flow** takes `ttm` and a **stock** takes the latest `quarter`,
  selected by joining `metric.is_flow` (the same column `derive_ttm` sums on) rather than by a
  local list that can drift from it. Two further rules the mutations forced out: **EPS must FALL
  across reports in the fixture**, because with a rising series an unbounded span still yields the
  newer value through `max()` and the bug is invisible; and **two unknown currencies are not a
  match** — `null = null` is not true, but writing the test as `is distinct from` makes them equal
  and a metric of unknown currency gets divided into a price of unknown currency.
- **`security-xbrl` IS BOUNDED BY MEMORY, NOT BY THE 90s BUDGET, AND THE PRESSURE IS CUMULATIVE.**
  Measured 2026-08-21: 40 filers = 13s of the 90s budget and 0 failures; 100 filers is killed by
  the supervisor at 15s (`WorkerRequestCancelled`) — companyfacts payloads are 3-7MB each, so the
  page is a memory budget wearing a time budget's clothes. Raising it is the obvious optimisation
  and it is the wrong one. Worse, three runs 31s apart AT the safe page still got the third worker
  killed, so the GAP between runs is as load-bearing as the page size (45s holds). And a killed
  worker never calls `finish_refresh`, so it holds the in-flight lock for ~2 minutes — hammering
  through that costs more than waiting it out, and the `skipped: fresh or in flight` it returns
  reads as a TTL skip rather than as the wreckage of the previous call.
- **A ONE-OFF TIMEOUT RIGHT AFTER A DEPLOY IS CONTENTION, NOT A PAGE SIZE — RE-MEASURE BEFORE
  FIXING.** `security-metrics` answered `canceling statement due to statement timeout` on its
  first post-deploy call at the default 4,000-row page, which reads exactly like the documented
  "unlimited exceeded the statement timeout" failure, and I reported it as a defect that would
  leave TTM permanently underived. Three subsequent runs at 4,000 and 2,000 completed in ~12s. The
  first call was competing with the deploy's own tail (matview refresh, PostgREST reload). One
  observation of a timeout is a measurement of that moment, not of the page.
- **A GUARD CAN FIRE ON ITS OWN BLIND SPOT, AND THAT IS NOT DRIFT.** `check_derived_metrics` began
  reporting `compared 0 values` the day `security-xbrl` started: it samples `security_metric` by
  recency, the newest rows were all `sec-xbrl`, and those are written straight from company facts
  with no `security_statement` to compare against. Failing loudly was correct — a check that
  verified nothing must never read as one that passed — but the fix is to scope the sample to what
  the check is ABOUT, and to derive that scope from the mapping table rather than "everything except
  X", so the next non-statement source cannot silently empty it again.

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
