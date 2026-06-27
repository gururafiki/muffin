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

## Milestone 1 — Foundation + one live agent ✅ (this milestone)
- Expo SDK 56 + Expo Router app, TypeScript strict, web/iOS/Android.
- Purple bakery design system: NativeWind v4 theme, primitives (Button, Card,
  Screen, Field, Avatar, Badge, Chip, Text, muffin SVG logo).
- Tabs: Globe (home), Markets (pie), Agents, Settings.
- Functional Settings: API URL, auth token, LLM provider + keys, OpenBB key.
- LangGraph client layer with native streaming via `expo/fetch` + polling
  fallback; generic agent runner with live streamed timeline + structured output.
- Council custom-screen stub (13 investor avatars) proving the custom path.
- Deployment: Dockerfile (Expo web export + nginx `/api` proxy), Swarm service,
  Traefik routing, Cloudflare DNS/Access; `muffin.*` for the app, `muffin-chat.*`
  for the legacy chat UI (both kept).

## M2 — Configuration depth
Per-agent MCP servers, per-agent tool sets, role model chains, a custom
deep-agent builder UI. Register `trading_decision` in `muffin-agent/langgraph.json`.

## M3 — Council showcase ✅
Emotional avatar/debate visualization (Reanimated): 13 investor avatars with
personality (emoji + style), live per-persona stages streamed via
`streamSubgraphs` (collecting → scoring → deciding → done), tap-to-expand
reasoning, an animated bull/hold/bear vote tally, and the judge's deliberation +
synthesised verdict. `src/features/council/`.
- Follow-ups: richer debate transcript (persona-vs-persona), arena circle layout
  + connection lines, token-level streaming of reasoning.

## M4 — Custom agent UIs + rich renderers
Trading-decision dashboard, criteria-analysis score breakdown, a chart-building
subagent, data-collected/-failed surfaces, hierarchical sub-graph execution view,
token-level message streaming.

## M5 — Globe navigation ✅
Stylized tappable SVG world map → region → country → sector → sub-sector → stock
drill-down, with breadcrumbs, animated best/worst "movers" panels (seeded sample
data, clearly badged) and an "Analyse" action at every level that launches the
real `research` agent (templated, auto-started query) with a tailored result
renderer. Stock pages carry sector/country/market context into the agents.
`src/features/markets/`.
- Follow-ups: live market data (needs a backend screening/discovery graph), the
  sector **Pie** drill-down (M6), full markdown styling, richer sub-sector pages.

## M6 — Sector Pie + asset & ticker model ✅
Interactive SVG donut of sector weights on the Markets tab (tap a slice → drill
to sub-sectors → sector page). Asset/ticker metadata model: `AssetType`
(equity/etf/commodity/crypto/bond/real-estate/cash/mutual-fund/derivative),
ticker properties (sector, sub-sector, country, market dev/emerging, growth/value
style), a seeded multi-asset universe and an asset-type filter on Markets. Asset
context flows into the stock page. `src/features/markets/{sector-pie,taxonomy}.ts(x)`.
- Follow-ups: futures/options/MMF instruments, addressable-market tags, real
  holdings/weights, filtering by style/country across the universe.

## M7 — Wealth management ✅
Portfolio tab: net-worth card (assets − liabilities), animated allocation (by
asset type / by account), account wrappers (SIPP/ISA/GIA/Cash/Property/Mortgage)
with holdings, and goals (retirement, house deposit) with animated progress.
Seeded demo portfolio that's locally editable — add holdings, create/edit goals —
persisted on-device (zustand + MMKV/localStorage). `src/features/wealth/`.
- Follow-ups: multi-currency/FX, cash-flow budgeting, live prices / broker sync,
  account creation, contribution-limit logic.

## M8 — Supabase migration
Supabase auth (app login) and migrate `muffin-agent` checkpointer/store from
plain Postgres to Supabase. Evaluate aegra as a Supabase-friendly LangGraph
server here.

## M9 — Productionisation
Sentry, EAS build/submit pipelines, RevenueCat, Maestro + react-native-testing,
FlashList / Expo Image / Zeego polish, real illustrated muffin mascot assets.

## Tracked follow-ups from M1
- Replace the placeholder SVG muffin logo with a final illustrated mascot.
- Add token-level (`stream_mode: "messages"`) streaming to the runner.
- Extract `muffin-ui` into its own repo + re-add as an umbrella submodule
  (build.yml activates there).
