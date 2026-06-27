# Muffin UI 🧁

Cross-platform (**Web · iOS · Android**) [Expo](https://expo.dev) +
[Expo Router](https://docs.expo.dev/router/introduction) client for the
[`muffin-agent`](https://github.com/gururafiki/muffin-agent) LangGraph agents.

**Democratise wealth building** — bring your own LLM + OpenBB keys (injected per
run, kept private on-device); the data and research generated is reused for
everyone. Purple flat-design bakery aesthetic.

> Deployed at `muffin.<domain>`, alongside the legacy chat UI at
> `muffin-chat.<domain>`. See [`ROADMAP.md`](./ROADMAP.md) for milestones.

## Stack
- Expo SDK 56, Expo Router (typed routes), TypeScript (strict)
- [NativeWind v4](https://www.nativewind.dev/) (Tailwind) for styling, Reanimated
- [`@langchain/langgraph-sdk`](https://www.npmjs.com/package/@langchain/langgraph-sdk)
  for agents, [TanStack Query](https://tanstack.com/query) for server state,
  [Zustand](https://github.com/pmndrs/zustand) for client state,
  [MMKV](https://github.com/mrousavy/react-native-mmkv) / localStorage for storage

## Develop
```bash
npm install
npx expo start      # press w (web), i (iOS), a (Android)
```

Point the app at a LangGraph server in **Settings**:
- Local agent: run `langgraph dev` in `muffin-agent` and set API URL to
  `http://localhost:8123` (`http://10.0.2.2:8123` on Android emulator). Enter an
  LLM key. Then run the **Deep Research** agent from the Agents tab.
- Web defaults to the same-origin `/api` proxy (see the Docker build).

```bash
npx tsc --noEmit         # type-check
npx expo export -p web   # static web build → dist/
docker build -t muffin-ui .   # web export + nginx (/api proxy)
```

## Architecture
- `src/app/` — routes (tabs: Globe/Markets/Agents/Settings; `agents/[assistantId]`,
  `stock/[ticker]`).
- `src/lib/agent/` — `client.ts` (SDK + `expo/fetch` native streaming),
  `use-agent-run.ts` (stream + polling fallback), `registry.ts` (one graph → one
  page), `renderers/` (pluggable message / structured-output rendering).
- `src/lib/settings/` — on-device keys → `config.configurable` (mirrors
  muffin-agent's `ModelConfiguration` field names).
- `src/components/ui/` — bakery design-system primitives.
- `src/features/council/` — custom council screen (M1 stub for the M3 showcase).

Adding an agent = add one entry to `src/lib/agent/registry.ts`.
