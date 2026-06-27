# Muffin UI — Roadmap

A cross-platform (Web · iOS · Android) Expo / Expo Router client for the
`muffin-agent` LangGraph agents, growing into a full wealth-management app.
**Brand:** democratise wealth building — bring your own keys (LLM + OpenBB),
share the research. Purple flat-design bakery aesthetic, muffin mascot.

## Principles
- **One graph → one page.** Each agent maps to a screen via a registry
  (`src/lib/agent/registry.ts`). Known graphs can have bespoke screens; the rest
  fall back to the generic runner. Adding an agent = one registry entry.
- **Pluggable rendering.** A renderer registry (`src/lib/agent/renderers/`) turns
  streamed state into UI; custom dashboards/charts are added by registering new
  renderers keyed on node / tool / output schema.
- **Keys stay private.** Settings persist on-device (MMKV / localStorage) and are
  injected into each run's `config.configurable`; never stored server-side.
- **Reuse over custom.** Talk to agents with the official
  `@langchain/langgraph-sdk`.

## Conventions & scope
- **Status:** ✅ done · 🟡 in progress · ⬜ planned. Checklists use `- [ ]`.
- **Repo scope.** Only `muffin-ui` (this app) is in our push scope. **`muffin-agent`**
  (the LangGraph backend) and **`muffin-deployment`** (Swarm/Traefik/Cloudflare) are
  separate repos — backend changes are delivered as **patches** for the owner to apply
  (see `deploy/muffin-deployment.patch` from M1 for the pattern). Tasks are tagged
  **[app]** (in-scope) or **[backend-patch]** accordingly.
- **Backend facts that shape these milestones** (from `muffin-agent`):
  - 4 graphs registered in `langgraph.json`: `stock_evaluation`, `criteria_analysis`,
    `research`, `council`. **`trading_decision` exists in code but is NOT registered.**
  - Config flows through `config.configurable`, parsed by `BaseConfiguration`
    subclasses (`src/muffin_agent/`): `ModelConfiguration` (model, temperature,
    `llm_provider`, per-provider API keys, `orchestrator_models`/`collector_models`/
    `reasoner_models`, `summariser_model`), `McpConfiguration` (`openbb_mcp_url`,
    `firecrawl_mcp_url`), `MemoryConfiguration` (`user_id`, `memory_debug_user_id`),
    `ResearchConfiguration`, `TradingDecisionConfiguration`, `StoreConfiguration`.
  - Per-agent tool sets are **hardcoded** `_MCP_TOOLS` lists; council reads
    `configurable.include_specialists`. Persistence = LangGraph-managed Postgres
    checkpointer + Store. Auth = `auth.py` (disabled / `MUFFIN_API_TOKEN` bearer /
    Cloudflare Access JWT → `user_id`).
- **Per-milestone verification** (the established loop): `npx tsc --noEmit` +
  `npx expo export -p web`, a headless-browser smoke test of the new flow with a
  screenshot, and assert zero Reanimated/worklet errors. Commit to the working branch.

---

## ✅ Milestone 1 — Foundation + one live agent
Expo SDK 56 + Expo Router (TS strict, web/iOS/Android); purple bakery design system
(NativeWind v4 + primitives + muffin SVG logo); tabs (Globe/Markets/Agents/Settings);
functional Settings (API URL, auth token, LLM provider + keys); LangGraph client with
native streaming via `expo/fetch` + polling fallback; generic agent runner (streamed
timeline + structured output); council stub; deployment Dockerfile + Swarm/Traefik/
Cloudflare wiring (`muffin.*` app, `muffin-chat.*` legacy chat UI).

## ✅ Milestone 3 — Council showcase
13 investor avatars with personality, live per-persona stages via `streamSubgraphs`
(collecting → scoring → deciding → done), tap-to-expand reasoning, animated vote tally,
judge deliberation + verdict. `src/features/council/`.

## ✅ Milestone 5 — Globe navigation
Stylized tappable SVG world map → region → country → sector → sub-sector → stock, with
breadcrumbs, animated best/worst "movers" panels (sample data, badged) and an "Analyse"
action at every level launching the real `research` agent (templated, auto-started) with
a tailored result renderer. `src/features/markets/`.

## ✅ Milestone 6 — Sector Pie + asset & ticker model
Interactive SVG donut of sector weights (tap → sub-sectors → sector page). Asset/ticker
metadata model (`AssetType`, sector/sub-sector/country/market/style), seeded multi-asset
universe + asset-type filter on Markets; asset context flows to the stock page.

## ✅ Milestone 7 — Wealth management
Portfolio tab: net-worth card, animated allocation (by asset/account), account wrappers
(SIPP/ISA/GIA/Cash/Property/Mortgage) with holdings, goals with animated progress.
Locally-editable seeded portfolio persisted on-device (zustand + storage).
`src/features/wealth/`.

---

## ⬜ Milestone 2 — Configuration depth (per-user agent customisation)

**Goal.** Let each user fully customise the agents from the app — provider/model per role,
per-agent MCP servers and tool sets, agent-specific knobs, and saved "assistant" presets —
delivering the brand promise that *everything is configurable, keys stay private*. Split
into what the app can do today against the existing `configurable` surface vs. backend
plumbing that must be added.

**[app] — surface the configurable knobs that already work**
- [ ] Add an **"Advanced configuration"** section to `src/app/(tabs)/settings.tsx`
      (collapsible): per-role model chains (`orchestrator_models` / `collector_models` /
      `reasoner_models` as comma lists), `summariser_model`, temperature, MCP URLs
      (`openbb_mcp_url`, `firecrawl_mcp_url`), research knobs (`research_default_mode`,
      `rerank_threshold`, `max_search_results`), `store_allowed_namespaces`.
- [ ] Extend `src/lib/settings/store.ts` (`Settings`) + `src/lib/settings/configurable.ts`
      (`buildConfigurable`) to persist and emit these (only non-empty values, as today).
- [ ] **Per-run overrides in the runner.** Add a collapsible "Advanced" block to
      `src/components/agent-runner.tsx` exposing agent-specific `configurable` (e.g.
      council `include_specialists` toggle; trading-decision debate-round counts; research
      mode) and merge them into that run's `config.configurable`.
- [ ] **Dynamic config forms from the graph schema.** Use the SDK
      `client.assistants.getSchemas(assistantId)` to read each graph's `config_schema` and
      render a form automatically; fall back to the static knobs above when a schema isn't
      published. (Lands fully once graphs declare schemas — see backend.)
- [ ] **Assistant presets.** Use `client.assistants.search/create/update` to save named
      configured assistants per graph (e.g. "Buffett-only council", "Fast research"); list
      them on the Agents tab and run a preset directly.
- [ ] Verification: a run reflects the chosen provider/models (confirm via LangSmith trace
      / server logs); the council specialists toggle changes the executed graph.

**[backend-patch] — `muffin-agent` plumbing (deliver as a patch)**
- [ ] **Register `trading_decision`** in `langgraph.json` (ensure a module-level `graph`
      export in `src/muffin_agent/agents/trading_decision/graph.py`); then add it to the
      app registry (`src/lib/agent/registry.ts`).
- [ ] **Declare `config_schema`** on each graph (wire the `BaseConfiguration` subclasses as
      the StateGraph config schema) so the app's dynamic forms work.
- [ ] **Per-agent tool sets.** Add a `ToolSelectionMiddleware` (or `configurable["{agent}_tools"]`)
      so the hardcoded `_MCP_TOOLS` lists in `src/muffin_agent/agents/data_collection/*` can
      be narrowed/extended at runtime.
- [ ] **Per-agent MCP servers.** Extend `McpConfiguration` to accept additional user MCP
      servers (name → transport) merged into `get_mcp_connections()`.
- [ ] **Custom deep-agent builder (stretch).** Define a JSON spec for a user-built agent
      (tools + middlewares + skills + MCP), stored in the LangGraph Store per user and
      instantiated by a factory graph; expose a builder screen in the app.

**Dependencies:** unblocks M4's trading-decision dashboard (needs the graph registered) and
M2 dynamic forms (needs `config_schema`). **Acceptance:** user configures provider/models +
agent knobs from the app and runs reflect them; `trading_decision` is runnable; (stretch)
saved presets and dynamic schema forms work.

---

## ⬜ Milestone 4 — Custom agent dashboards + rich renderers

**Goal.** Move beyond the generic structured-output view: bespoke, emotional dashboards per
agent and a richer renderer library, all hung off the existing renderer registry
(`src/lib/agent/renderers/`, selected via `AgentDef.resultRenderer` /
`AgentDef.custom`). Most of this is pure app work; the trading dashboard needs the graph
registered (M2).

**[app] — renderers & dashboards**
- [ ] **Criteria-analysis breakdown** renderer (`resultRenderer: 'criteria'`): weighted
      per-criterion score bars (reuse the animated-bar pattern from
      `src/features/wealth/allocation-bars.tsx`), a composite-score gauge, key
      positives/negatives, and the thesis — from `CriteriaAnalysisSynthesis` +
      `criterion_evaluations`.
- [ ] **Hierarchical sub-graph execution view.** Generalise the council's
      `streamSubgraphs` parsing (`src/features/council/use-council-run.ts`) into a reusable
      `useGraphTree` hook + a collapsible node tree showing each node/sub-node's live status
      — a universal "what the graph is doing" panel for any agent.
- [ ] **Tool-call & data-collection surface.** Render `tool_call` / `tool_result` as cards
      with success/failure badges, plus a "data collected vs. data missing" summary (parse
      `ToolMessage` results; surface the agent's tool-knowledge lessons).
- [ ] **Charts.** A lightweight `react-native-svg` line + bar chart component; a renderer
      that detects time-series tool outputs (price history, `get_indicators`) and draws
      them. (Optionally `victory-native` later.)
- [ ] **Token-level streaming.** Add `stream_mode: "messages"` to
      `src/lib/agent/use-agent-run.ts` and render incremental AI text (the M1/M3 follow-up).
- [ ] **Trading-decision dashboard** (`custom` screen): bull/bear cases, conviction gauge,
      the trader plan (action, entry/stop/take-profit, position sizing from `TraderOutput`),
      and the risk-debate transcript (name-tagged `risk_debate_messages`). Build against a
      sample payload first; wire live once the graph is registered (M2).
- [ ] **Stock-evaluation timeline** polish: render the deep-agent plan→collect→validate→
      analyse→reflect stages as a readable narrative.
- [ ] Verification: each renderer validated against a captured sample payload (committed as
      a fixture) and live where the graph is registered; screenshots in the smoke test.

**[backend-patch] — optional richer signals**
- [ ] Register `trading_decision` (shared with M2) for live dashboard data.
- [ ] Emit structured progress via `stream_mode: "custom"` (e.g. a chart-building subagent,
      explicit data-collection success/failure events) for higher-fidelity UI.

**Dependencies:** trading dashboard ← M2 registration. **Acceptance:** criteria, trading and
sub-graph views render richly from real (or fixture) payloads; charts draw from tool data.

---

## ⬜ Milestone 8 — Supabase auth + shared-research backend

**Goal.** Add real user accounts and deliver the brand's social half — *collected data &
research outputs are reused by everyone, while keys stay private*. App-side auth is in
scope; agent persistence/auth changes are backend patches. Evaluate **aegra** (a
Supabase/Postgres-friendly LangGraph-protocol server) vs. the current managed
`langgraph-api` as part of this milestone.

**[app] — auth & cloud sync**
- [ ] Add `supabase-js`; an **Auth screen** (email + OAuth) and a session store; gate the
      app or keep anonymous use with optional login.
- [ ] Send the Supabase access token as the API `Authorization: Bearer` (already supported
      via `settings.authToken` → client `defaultHeaders`) and set `configurable.user_id`
      from the Supabase user for per-user memory isolation.
- [ ] **Cloud backup (opt-in):** sync the local portfolio/goals/settings
      (`src/features/wealth/store.ts`, `src/lib/settings/store.ts`) to per-user Supabase
      tables with RLS — local-first, never storing API keys server-side.
- [ ] **Shared research library:** browse research outputs others have produced (Supabase
      table) and re-open them — the "reuse research" promise; surface on the Agents/Research
      area.
- [ ] Verification: login works on web + native; a run carries the Supabase `user_id`;
      (stretch) a shared research item from one account is visible to another.

**[backend-patch] — `muffin-agent` + `muffin-deployment`**
- [ ] `auth.py`: add a **Supabase JWT verification** mode (verify via Supabase JWKS / JWT
      secret; map `sub`/`email` → `user_id`), keeping the bearer/Cloudflare modes.
- [ ] **DB migration:** point `DATABASE_URI` at Supabase Postgres and run the LangGraph
      migrations; verify the checkpointer + Store work (it is Postgres, so likely a
      connection-string swap). **OR** adopt **aegra** and document the trade-off.
- [ ] **Persist collected data / research** to Supabase shared tables via a post-run hook /
      middleware with RLS, so outputs are reusable; ensure no API keys are ever written.
- [ ] `muffin-deployment`: add Supabase env/secrets; decide hosted vs self-hosted Supabase;
      update `stack/docker-compose.yaml` + Terraform; (optional) drop `langgraph-postgres`
      if fully on Supabase.

**Dependencies:** none hard, but pairs with M9 productionisation. **Acceptance:** Supabase
login drives `user_id` end-to-end; per-user memory works; shared research is readable
across accounts; keys remain on-device only.

---

## ⬜ Milestone 9 — Productionisation & launch

**Goal.** Make it shippable: own repo + CI image, store builds, monitoring, tests,
performance, monetisation, and final brand assets.

**[app/infra]**
- [ ] **Extract `muffin-ui`** into its own `gururafiki/muffin-ui` repo and re-add it as an
      umbrella submodule; activate the dormant arm64 GHCR image build
      (`.github/workflows/build.yml`).
- [ ] **EAS:** `eas.json` (development/preview/production profiles), credentials/signing,
      `eas build` + `eas submit` (App Store / Play), and **EAS Update** OTA channels.
- [ ] **Sentry** (`@sentry/react-native`): wrap the app, upload sourcemaps in EAS, capture
      run/render errors (incl. the agent-stream error paths).
- [ ] **Testing:** `react-native-testing-library` unit tests for the renderers, the
      `taxonomy`/`wealth` helpers and `use-agent-run`/`use-council-run` event parsing;
      **Maestro** E2E flows (drill-down, run an agent, add a holding, create a goal); run in
      CI.
- [ ] **Performance:** FlashList for long lists (asset universe, holdings, run timeline),
      Expo Image for remote images, memoisation; Reanimated `react-compiler` audit.
- [ ] **Polish UX:** Zeego context menus (long-press actions on holdings/agents),
      consistent loading/empty/error states, offline handling, accessibility (labels,
      contrast, dynamic type), i18n scaffold.
- [ ] **Monetisation:** RevenueCat scaffolding + a paywall for premium features, keeping the
      BYO-keys core free.
- [ ] **Brand:** replace the placeholder muffin SVG with a final illustrated mascot; finalise
      app icon, splash, and store assets.
- [ ] **Security review** of the diff (`/security-review`): confirm keys never leave the
      device except as the user's own `configurable`; no secrets in logs/artifacts.

**Acceptance:** signed builds in TestFlight/Play internal track; CI green (lint, types,
unit, image build); Sentry receiving events; Maestro suite passing; OTA updates working.

---

## Cross-cutting backlog (from completed milestones)
- **M1:** real illustrated muffin mascot; token-level (`stream_mode: "messages"`) streaming
  (now folded into M4); extract to own repo (now in M9).
- **M3:** persona-vs-persona debate transcript; circular arena layout with connection lines.
- **M5:** live market data (needs a backend screening/discovery graph) for the movers panels;
  full markdown styling for `research-result`; richer sub-sector pages.
- **M6:** futures/options/MMF instruments; addressable-market tags; real holdings/weights;
  filter the universe by style/country.
- **M7:** multi-currency / FX; cash-flow budgeting; live prices / broker sync; create
  accounts from scratch; tax / contribution-limit logic.
