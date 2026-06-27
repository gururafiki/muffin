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

## M3 — Council showcase
Emotional avatar/debate visualization (Reanimated): live persona fan-out, a
per-persona popup of what each is doing, judge synthesis. Render the graph as a
conversation / N people debating.

## M4 — Custom agent UIs + rich renderers
Trading-decision dashboard, criteria-analysis score breakdown, a chart-building
subagent, data-collected/-failed surfaces, hierarchical sub-graph execution view,
token-level message streaming.

## M5 — Globe & Pie navigation
Interactive world map → region → country → sector → sub-sector → stock drill-down;
macro and relative-performance analysis entry points.

## M6 — Asset & ticker model
Ticker metadata (sector, sub-sector, country dev/emerging, addressable markets,
growth/value) for filtering & analysis. Multi-asset support: etf, equity,
commodities, crypto, derivatives, options, futures, bonds, real estate, cash,
mutual funds, MMF.

## M7 — Wealth management
SIPP / ISA / Mortgage / other wrappers, budgeting & holdings across tools, goals
(retirement, house deposit).

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
