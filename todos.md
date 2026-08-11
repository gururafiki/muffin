# TODOs

## External dependencies
- [x] I've received response to issue - https://github.com/langchain-ai/langgraph/issues/8470 . Could you respond to it? Share with me before posting.

## UI Improvements

### Agent Runner pages

#### Stock Evaluation
- [ ] Run https://muffin.rafiki.guru/agents/stock_evaluation?threadId=019f2424-affe-7fb0-90dc-0afc0ff80c72 (currently not available after wipe of DB, requires re-testing).
  - [ ] Rename stock evaluation and add "modes", based on mode change system prompt
  - [ ] When agent is in progress it says "working" with a loader. Maybe it makes sense to display there what it's doing with a loader instead of displaying it as separate block at the top of the page?
  - [ ] When I click verbose I see couple extra "Execute". Is it all difference expected? Please adjust message that changes when user switches between "Summary" and "Verbose".
  - [ ] I would like to see summary stats on tool execution for full run on the page with list of all tool runs and success/failed count per each tool. Once clicked I want to see used inputs, collected outputs (where visualisation makes sense - think on custom components to render them nicely) and error list if failed.
  - [ ] Maybe it makes sense to extend input textblock for stock evaluation to allow to create markdown (also it should be rendered properly).

#### Criteria analysis 
- [x] Run https://muffin.rafiki.guru/agents/criteria_analysis?threadId=019f270c-91eb-7420-941d-cbaac3c6b6c7 (currently not available after wipe of DB, requires re-testing).
  - [x] Criteria analysis graph works weirdly. It looks like it doesn't take inputs I provide from the page
  - [x] For each criterion i see evidence and raw reasoning, but i don't see sub steps (data collected, tools used, attempted data collections and failed, etc). As a user i want to be able to see it, maybe in a view of timeline (the same as plan/todo list we have for the agents), by default it should be collapsed. 
  - [x] Raw reasoning looks weird, it looks like one of messages, but doesn't fill like something that makes sense. I guess we lack other important information from the evaluation run.
  - [x] Sub-criteria looks weird for "iPhone ASP Stability/Decline". I'm not sure what it tries to show, maybe we lack some details there as well.
  - [x] I would like to see summary stats on tool execution for full run on the page with list of all tool runs and success/failed count per each tool. Once clicked I want to see used inputs, collected outputs (where visualisation makes sense - think on custom components to render them nicely) and error list if failed.
- [x] Run https://muffin.rafiki.guru/agents/criteria_analysis?threadId=019faada-a9a8-7470-b490-48d5cc41f532
  - [x] When i click on tool execution within Execution tree - it doesn't show the output for succeeded `etf_info` (i see only errored outputs) within Etf index sub-agent tool executions, do you know what is the reason?
- [ ] On Criteria Analysis page - i don't understand what under each criterion means, is it rendered properly? It doesn't lool intuitive
- [ ] Check if we still need `lift_classification_node` considering that we have `_StructuredResponseToStateMiddleware`

#### All agents
- [x] **[DONE 2026-08-02, muffin-ui M27]** Add more custom components/cards for stuctured outputs. Two layers, after inventorying all ~20 structured outputs across the five graphs:
  - **Semantic baseline** — reads field *meaning*: 0..1 `confidence` → gauge, `signal`/`rating` → toned pill, `weight` → share bar, `*_pct` → signed delta, `limitations`/`key_risks` → caveat list, `key_findings`/`catalysts` → checklist, prose → markdown. Headline fields rank first; **empty fields are dropped**. Keys on naming conventions, not a model registry, so future graphs are legible for free.
  - **Hero cards** for the headline payloads: classification, criteria definition, valuation methodology, synthesis, portfolio decision, investment judge, trade plan, resolved outcomes, council verdict (proportional vote bar), specialist strategy grid, research evidence. **18 channels registered, up from 5.**
  - Remaining: the Overview's own result renderers still have separate layouts — folding them onto these cards would remove the last duplication between the two views.
- [x] **[DONE 2026-08-01, muffin-ui M25]** **Work further on execution tree. It looks rough now and misses all the traces**. Replaced by the **run Timeline** (`features/agent-shared/run-timeline/`), built entirely from the LangGraph API — no backend change, no per-graph logic, no Store side-reads — so any graph renders with no UI change. Delivered:
  - **Parallel vs sequential** — LangGraph supersteps (`metadata.step`) are the unit, so steps that ran together are bracketed as "N in parallel" and sequential steps sit on a spine. Verified on prod: criteria `0:1 1:1 2:2∥ 3:1 4:10∥ 5:1`, trading's 4 analysts, council's **19-wide** fan, stock_evaluation's 9-wide sub-agent fan.
  - **Input · Plan · Timeline · Output per node, recursively** — a sub-agent/subgraph inside a timeline expands into its own full card. Deep agents get `values.todos` as the Plan and plan updates render as the resulting checklist; pipeline graphs get their child supersteps.
  - **Real durations** from checkpoint `created_at` + relative bars; **running/pending/failed** states at last (`next` is finally read); `stream.subagents` is now read, giving stock_evaluation live sub-agent visibility it never had.
  - **Custom components** dispatch on the **state channel** a node wrote (data-driven, so unknown channels degrade gracefully instead of mis-rendering).
  - **Tool executions panel is gone** — tool calls live on the step that made them; the dead run-wide roll-up and the Store cache join were deleted.
  - Remaining gap: **per-tool duration** still isn't available (messages carry no timing; it would need a backend change).
- [x] **[DONE 2026-08-01, muffin-ui M26]** Timeline review follow-ups:
  - **Loaders/skeletons** — each facet holds a labelled skeleton in its final place while its namespace is fetched, rows show a spinner instead of a chevron while loading, and the initial state says "Reading this run…".
  - **Input prompts render as markdown** once expanded (clamped plain text while collapsed — `Markdown` returns a Fragment and can't be line-clamped).
  - **"Package" no longer repeats the criterion** — a leaf writing the same state channel as its parent is a terminal pass-through; the row and its duration stay, the duplicate card becomes one line. Also stopped the transcript auto-expanding the final structured output that the Output facet already shows.
  - **Criterion cards now use the Overview's `CriterionDetails`** (evidence, data sources, sub-criteria, limitations, "no live data" warning, folded raw reasoning) — the require cycle that justified the lean duplicate no longer exists.
  - **Stuck plan explained**: on 019faada the ticker-classification agent wrote 4 todos at superstep 5 and **never called `write_todos` again**. The UI now labels a finished node's unrevised plan honestly instead of showing "1 of 4". **Agent-side follow-up below.**
  - **Motion**: exit fades, staggered lanes, a breathing rail on the running branch, count-up summary — all `useReducedMotion`-gated.
- [ ] **Deep agents don't maintain their `todos`** (found 2026-08-01). `TodoListMiddleware` gives them `write_todos`, but nothing in the prompts requires marking items complete, so a plan gets written once and abandoned — `ticker_classification` on 019faada wrote 4 todos at superstep 5 and never touched them again through 7 more supersteps. muffin-agent prompt/middleware change; the UI already reports it.
- [ ] **Explore current Criteria Analysis page. Check how all details for sub-agents and tool executions are read reccursively. Add the same for all other agents**.
- [ ] Tool failure list can be quite long (in tool execution panel) Let's collapse it by default

#### Trading decision
- [x] Run https://muffin.rafiki.guru/agents/trading_decision?threadId=019f2328-3016-74a1-ab7e-293d648d7af9  (currently not available after wipe of DB, requires re-testing).
  - [x] **[DONE 2026-07-14, muffin-agent #117 + muffin-ui M16]** Sub-agents rendered as plain text while there's json — both debates (bull/bear + risk) are now real `multi_agent` conference subgraphs, discovered as sub-agent rows and rendered as chat-bubble conversations (`detail: 'debate'`); AI message bodies that are raw JSON now render via `JsonBlock` (mirrors the chat-agent renderers). Sub-steps: each analyst sub-agent row shows its `tool_runs` (inputs/outputs/errors); full intermediate transcripts are not persisted backend-side (deferred — muffin-ui ROADMAP M16).
  - [x] **[DONE 2026-07-14, muffin-agent #117 + muffin-ui M16]** Risk debate empty — the risk stage now maps to `risk_debate_messages` with a debate renderer; expanding it shows the 3 debater turns. (Verified on a fresh MSFT run: "Risk debate · 3 turns".) The bull/bear debate was previously NOT a subgraph so it had no sub-agent row at all — migrating it onto the conference framework gives it a symmetric `investment_debate` row.
  - [x] **[DONE 2026-07-14, muffin-ui M16]** Debaters collapsed by default — `DebateView` is now a standard `Collapsible` (Card + title + "N turns"), collapsed until tapped.
  - [x] **[DONE 2026-07-14]** Tool execution summary stats — the panel was already mounted; it now populates for trading runs (backend `tool_runs` capture, muffin-agent #108). Verified on a fresh MSFT run: "Tool execution · 65 calls · 23 failed". Old threads predating capture show an explanatory empty-state hint.
  - [x] **[FIXED 2026-07-14, muffin-agent #117]** BUG found while investigating: the bull/bear debate turns were exactly duplicated (2 → 4) because the risk-debate conference subgraph (running after the investment debate) echoed the shared `operator.add` debate channels back through write-back, and the parent re-applied the reducer. Fixed by adding `output_schema=` to `build_conference_graph` and restricting both trading conferences to their own channels. Verified on a fresh run: `investment_debate_messages` = exactly 2 turns, no duplicates.
- [x] Run https://muffin.rafiki.guru/agents/trading_decision?threadId=019f6223-5de5-7f73-bf06-02bb0087acc3 (currently not available after wipe of DB, requires re-testing).
  - [x] Investor council's input block look different on the agent call page, can we standardize how agent input blocks look within trading decision, deep research and criteria analysis? When run is started or when I open past call I believe we can have some nice presentation of inputs passed to the agent instead of keeping them as text fields with option to update values for agents that doesn't support follow-up asks. If agent supports follow-up let's have other way to provide this information without amending intial input fields. Additionally I really like how screen looks like when i want to launch stock evaluation agent input textbox at the middle appearing with animation, some example configuration, etc. Can we may have all agents have similar starting screen, so it's emotional and produces some joy?
  - [x] When past run is opened for Trading decision I see that bull vs bear and risk debate are wrapped in rounded-muffin which is different from other stages, let's have it consistent.
  - [x] In subagents panel output of individual subagents doesn't look nice. For debators - it's almost ok, but I don't think it makse sense to have subagent debates wrapped in collapssible block, since they are anyway can be collapse and expanded as full subagent. For analysts it looks weird when i firstly open it - it show response as plain text with weird backgroun, then it makes call to history endpoint and once response is received it's rendered properly. If we already have response for that agent loaded - let's render it nicely and can we add some animated loaders (maybe with skeleton) on this page, so skeleton pulses on the blocks until content is fully loaded for a given container.
  - [x] Also in subagent's panel analyst input is rendered as a message, but they may contain markdown. Let's make sure we render input prompts for subagents properly.
  - [x] On this agent (as well as on other agents) - I see that tool response is marked as success even if the tool errored (e.g. Tool 'get_indicators' failed after 1 attempt with ToolException: OpenBB equity_price_historical response missing 'date' column.. Please try again. is faulty response, another example: Error calling tool 'news_company': HTTP error 400: Bad Request - {'detail': "Missing credential 'intrinio_api_key'. Check https://intrinio.com to get it. Refer to the documentation for setting provider credentials at https://docs.openbb.co/platform/settings/user_settings/api_keys."}. There are other possible faulty responses, please check). Let's make sure that we mark such failures as failures and not success. Maybe some backend change is needed? Let's be langgraph idiomatic here.
  - [x] In each sub-agent I see section "Tool calls", while on the page I see section "Tool execution" and they look a bit different. Why is it happening? Can we standardize and re-use the same component or is there any reason to have them separated? Please analyse, provide your findings and ask me on which one to use with your recommendation.
  - [x] Overall sub-agent flow in steps looks nice, however model reponse looks detached from the steps block. For Market Analyst i see panel with steps, then model response, then message "You have not produced the required structured output. Call the MarketAnalystOutput tool now with your final answer." and then panel with on item "MarketAnalystOutput". Let's think on how to render it better, so it feels like one flow.
- [ ] *TODO double-check UI if it still up-to date request*. On trading decision page we have blocks with information outputed by steps (e.g. Sentiment, Market / technicals, Bull vs Bear, etc). I don't like how it's displayed now, it's not joyful, emotional, nice, enjoyable. Investor council UI and Criteria Analysis is a bit cleaner. Can we improve UI somehow? Check skills and plugins available to you to learn more about UI/UX design and react native best practices


#### Investor Council
- [x] Run https://muffin.rafiki.guru/agents/council?threadId=019f22ac-0182-7db0-bea2-83930b1183db  (currently not available after wipe of DB, requires re-testing).
  - [x] **[DONE 2026-07-12, muffin-ui M15]** I don't see specialists as icons, only as subagents at the bottom. I would like to see them in the same way as personas — specialists now sit in the arena grid with their own icons/animations; the bottom panel remains only as a fallback for unknown future nodes.
  - [x] **[DONE 2026-07-12, muffin-ui M15]** Neither persona output nor specialist output looks useful… — new unified `MemberDetail` card for personas AND specialists: step timeline (collect → compute → verdict), reasoning as markdown, typed evidence via structured renderer, "Data collected" (per-member tool runs, cache-joined to full payloads), live transcript while streaming. Remaining gap: `technicals`/`sentiment` fetch via `cached_invoke` which bypasses capture — they show evidence but no tool list (muffin-ui ROADMAP backlog).
  - [x] **[DONE 2026-07-12]** I would like to see summary stats on tool execution (the same as for Criteria Analysis) — the panel was already mounted; the backend now captures council tool_runs (muffin-agent #109 personas, #116 ReAct specialists), verified on a fresh run ("58 calls · 6 failed"). Old threads (like the one linked above) predate capture and show an explanatory empty state.
- [ ] On investor council page - I don't see subagents panel (the same as i see for trading decision or criteria analysis)

## Backend
- [x] I don't see langgraph's db in my supabase. What should we do to have it accessible from studio?
- [x] **Connect Ollama cloud as alternative provider for open router. Use Ollama Cloud as main model and openrouter as fallback. For Ollama Cloud we should have separate `llm_requests_per_second`, it should be provider specific and `llm_requests_per_second=0.3` is only for open router.**
- [ ] Setup Supabase realtime to send notfications when workflow is finished to user.
- [~] **Setup edge functions (with Deno) as endpoints for UI data** — *partly done 2026-08-09.*
  The first edge function (`market-refresh`) and the `market` schema shipped, plus a new internal
  `openbb-api` service (same image as `openbb-mcp` — `openbb-core` already ships the FastAPI app).
  **Reads deliberately do NOT go through an edge function**: `market.*` is exposed over PostgREST,
  so the UI reads tables directly with supabase-js and the function is only the writer.
  Remaining: user wealth CRUD, and the country/classification tables (Phase 2).
- [x] **Market data Phases 1–3** (see `muffin-ui/ROADMAP.md` M5): sector performance +
  timeframe, classifications/countries/growth, and sector constituents + real sub-sectors are
  all server-backed. **DEPLOYED + verified live 2026-08-09** — 77 sector / 171 country / 315
  instrument rows; the country, group and sector screens render server data with provenance.
- [x] **`force` flag on market-refresh** — done 2026-08-09, service-role only (the anon key is
  public). Bypasses the TTL and error backoff, never the in-flight lock.
- [x] **`skeleton-check.mjs` path traversal** — fixed 2026-08-09 by extracting the shared
  `scripts/lib/serve-dist.mjs`; both smoke scripts now serve from an allowlist.
- [x] **Scheduled warm-up** — done 2026-08-09 as `market-warmup.yml` (02/08/14/20 UTC), verified
  by a real dispatch: 5/5 resources, exit 0. GitHub Actions rather than pg_cron — no DB change, no
  new infra, and the run is visible/disable-able in CI. Every 6h rather than per-TTL because
  yfinance rate-limits.
- [x] **Market data Phase 4** — asset universe + stock page DONE 2026-08-09. Every market
  surface is now server-backed or explicitly badged; the unbadged-invented-numbers gap is closed.
  - [ ] **Sector donut weights stay SAMPLE — blocked, not deferred.** `etf/sectors` is FMP-only
    and premium (402 on our key); `index/sectors` is TMX (Canada) only. Deriving weights from our
    own 35 curated tickers would be a different number wearing the index's name. Needs either an
    FMP upgrade or another provider.
- [x] **Anon key could read every user's LangGraph run content** (found + fixed 2026-08-09).
  Supabase's default `public` grants applied to LangGraph's tables, so `GET /rest/v1/thread` and
  `/rest/v1/checkpoint_blobs` returned real rows to anyone with the public anon key. Fixed in
  `03-security.sql`. **Not yet deployed** — verify after the next deploy that `/rest/v1/thread`
  returns a permission error while `user_backups` still works. (Related: the "Double check
  authorization rules" item under Other P1.)


## Testing
- [x] **Re-document everything in README.md (all the features available in UI). Explore which code is currently redundant. Document which pages currently use mocked data (or data that is hardcoded and not stored on backend). Check if all of features documented in README work** — muffin-ui M28. README rewritten and now verifiable by `scripts/verify-readme.mjs` (76 pass / 0 fail against a real build + the live deployment); 7 false claims corrected (chat edit/regenerate/branch are unwired; council is 19 seats not 13; the sign-in gate hides the whole form; ollama/Server default/Tool lessons/Ollama key were missing); `/verify`, the stepped auth flow and the M27 renderer layers documented for the first time; a "Real vs. sample data" table added (Globe/Markets/Portfolio touch no backend); dead code deleted (`tool-cache.tsx` was still polling the store for a context nothing read, plus the Expo template theme files); React #418 root-caused to nginx `try_files` vs Expo's bracket filenames.
- [x] I now have chart component, but I don't see it rendered anywhere.
- [x] I don't see data gathered panel anywhere, is it rendered?

## OpenBB providers / API keys

Verified 2026-08-10 against the installed registry (`RegistryLoader.from_extensions()`), not the
docs. **32 providers installed; 17 need no key at all.** The env var is the provider's declared
credential name upper-cased — which is NOT always `*_API_KEY`.

**Configured and verified working**

| Provider | Env var | Tier | Verified |
|---|---|---|---|
| fred | `FRED_API_KEY` | free | ✅ 318 rows (`economy/fred_series?symbol=GDPC1`) |
| tiingo | `TIINGO_TOKEN` | free | ✅ 250 rows — **token, not api_key**; the `.env.example` was right |
| biztoc | `BIZTOC_API_KEY` | via RapidAPI | ✅ 144 rows (`news/world`) |
| fmp | `FMP_API_KEY` | free | ⚠️ works, but gates **per symbol** on fundamentals (AAPL 200, BHP 402) and ETF/index endpoints are premium |
| alpha_vantage | `ALPHA_VANTAGE_API_KEY` | free | ⚠️ **key valid but unusable for price history** — OpenBB requests `outputsize=full`, which AV charges for; free is also ~25 req/day |

**No key required (17)** — `cboe deribit ecb famafrench federal_reserve finra finviz government_us
imf multpl oecd sec seeking_alpha stockgrid tmx wsj yfinance`

- [x] **FINRA needs no credentials** — the installed `finra` provider declares none, so the client
  id/password issued for FINRA's API portal are **not used by anything here**. They were shared in
  plaintext, so **rotate that password** regardless.

**Free keys still worth adding** (installed, currently unset)
- [ ] `BLS_API_KEY` — US Bureau of Labor Statistics (CPI, employment). Free.
- [ ] `EIA_API_KEY` — US Energy Information Administration (oil/gas/power). Free.
- [ ] `NASDAQ_API_KEY` — Nasdaq Data Link. Free tier.
- [ ] `CFTC_APP_TOKEN` — a **Socrata app token**, not an api_key. Free.
- [ ] `CONGRESS_GOV_API_KEY` — congressional trading/bills. Free.
- [ ] `ECONDB_API_KEY` — free tier (some endpoints work keyless).

**Paid only** (installed, unset — add only if a feature needs them)
- [ ] `BENZINGA_API_KEY` — paid. Would fix the council's `fetch_company_news(provider="benzinga")`,
  which currently fails.
- [ ] `INTRINIO_API_KEY` — paid. The other provider for fundamentals/ratios besides FMP.
- [ ] `TRADIER_API_KEY` + `TRADIER_ACCOUNT_TYPE` — free **sandbox**, paid production. Options data.
- [ ] `TRADINGECONOMICS_API_KEY` — paid.

**Not installed**
- [ ] `POLYGON_API_KEY` does **nothing** — `openbb[all]` does not ship `openbb-polygon`. Add the
  package to `openbb-mcp-docker/Dockerfile` first if you want it.

**Which paid key would actually buy the most:** `INTRINIO` (unblocks fundamentals, currently
reverted because FMP gates per symbol) or an **FMP paid tier** (also unblocks `etf/sectors` for
the donut weights and index constituents). Both are tracked above under the market-data items.

## CI/CD
- [ ] Setup dependabot, branch protection, codeql, etc for other repos as it's setup for muffin-agent
- [ ] Fix typing issues

## Deployment / infra
- [x] **[RESOLVED 2026-07-11] Deploys failing: hung `apt-get` held the apt lock on the Oracle node.**
  Every `deploy` since 2026-07-10 21:02 failed on the Ansible playbook's first apt task
  (`apt-get clean` → `E: Could not get lock /var/lib/apt/lists/lock … held by process 4057282`).
  Root cause: the systemd `apt.systemd.daily` `apt-get update` (PID 4057282) hung **2 days 8 hours**
  on an unreachable mirror because **no apt `Acquire` timeout was configured**, holding the lock the
  whole time. **Fixed:** SSH'd the node, SIGTERM'd the hung apt tree (freed the lock, `apt-get clean`
  verified), added `/etc/apt/apt.conf.d/99timeout` (`Acquire::http/https::Timeout 30`,
  `Acquire::Retries 3`) so `apt-get update` can never hang indefinitely again, then reran the deploy
  → **success**; new digests rolled out (agent `ff2ddcb5`, ui `abb659e4`), both services `1/1`.
  **Still TODO (muffin-deployment patches, out of push scope):**
  - Codify the apt timeout in the provisioning Ansible (so a re-provision keeps it) — mirror
    `/etc/apt/apt.conf.d/99timeout` as a template task.
  - Make the apt-cache task **non-fatal** / add `lock_timeout` so a held apt lock can never block the
    whole application deploy (the Swarm stack update doesn't depend on apt at all).
  - **nginx upstream-resolution race:** during the rolling update the `muffin-ui` container
    crash-looped a few times with `nginx: [emerg] host not found in upstream "langgraph-api"` because
    both services restarted simultaneously and nginx resolves its upstream at boot (hard-fail).
    Swarm auto-retried and it self-healed, but it delays convergence and logs scary errors. Fix in
    `deploy/nginx.conf`: use a `resolver` (Docker embedded DNS `127.0.0.11`) + a variable `proxy_pass`
    upstream so nginx resolves lazily at request time instead of failing at startup.
- [ ] **Investigate ~28s checkpoint reads on criteria_analysis threads (Oracle node / Supabase Postgres).**
  Measured 2026-07: `GET /threads/{id}/state`, `POST /threads/{id}/state/checkpoint`, and
  `/history` all take **~28s** on criteria threads while returning only tens of KB, whereas the same
  endpoints return in **0.1–0.2s** on research/other threads and `/info` is instant. So it's
  **server-side query latency, not payload size or network** — most likely the volume of
  per-thread subgraph checkpoint rows (criteria fans out N Send workers, each a 2-node subgraph)
  in the `langgraph` DB after the M8 Supabase cutover. The muffin-ui M12 migration removed the UI's
  dependence on these calls for run views (it no longer walks 15 checkpoints), so this is no longer
  user-visible on the run pages — but it still hurts any state read and is worth fixing.
  Steps: on the node, count rows in `checkpoints` / `checkpoint_blobs` / `checkpoint_writes` per
  `thread_id` + `checkpoint_ns` for a criteria vs a research thread; `EXPLAIN ANALYZE` the state
  query LangGraph runs; verify the checkpointer indexes survived the Supabase cutover (the managed
  `langgraph-api` schema ships specific indexes on `(thread_id, checkpoint_ns, checkpoint_id)`);
  check whether langgraph-api ≥0.11 / deepagents 0.6 **delta channels** (10–100× smaller
  checkpoints) reduce it once deployed. Requires SSH to the Oracle node.

## Other P0
- [x] **Can we maybe instead of relying on setting something in metadata to define how to render runs use graph_id that is returned from langgraph api, i guess it's set by langgraph, so reliable, isn't it?** — **Done (muffin-ui M17, 2026-07):** the Calls tab now renders each run entirely from the server's own `metadata.graph_id` (set by LangGraph on every run, 1:1 with a registry `id`) for title/icon/filter/reopen — the app-written `metadata.agentId` tag is gone (it had silently broken in the M12b `useStream` migration, which is why the deployed Calls list was showing every recent run as a generic "Agent run"). Run *structure* already came from protocol-v2 `subgraphsByNode` discovery. The Calls descriptor + council input-restore now read raw inputs from persisted state (search `extract`), and `searchThreads` uses `select` to drop `values` from the list payload (~100× lighter: 2086 KB → 16 KB / 50 threads). No client-side thread metadata is written anymore.
- [x] How can i have in langfuse traces grouped by thread_id?
- [ ] **When i trigger run and then open it from calls page it's initially shown as completed and then after some time it's back to running state.**
- [ ] **Figure out why and in what cases runs go to interrupted state and how to continue them.**
- [~] **Develop Stock page** — *partly done 2026-08-09.* It now shows name, sector, the
  provider's real industry (sub-sector), country, market cap, a performance strip across every
  period and a **price chart** (1M/3M/6M/1Y from `market.prices`).
  - [ ] **Financials are BLOCKED on the FMP tier — investigated and reverted 2026-08-09.**
    `equity/fundamental/metrics` looked promising (it returns EV/EBITDA, ROE, ROIC, FCF yield,
    net debt/EBITDA) and an early 3-symbol test batched fine. **That test did not generalise.**
    Measured per symbol on our key: AAPL/MSFT/NVDA/JPM/XOM/PFE/KO/NKE/TSLA return 200, while
    **NEE, PLD, BHP and SAP return 402** — FMP's free tier covers a SUBSET of symbols, and every
    non-US name tested is outside it. A metrics card that appears for Apple and silently vanishes
    for BHP is the kind of half-truth this whole workstream removed, so the code was reverted
    rather than shipped. Needs an FMP upgrade or another fundamentals provider.
  - [x] **Run/conclusion history for a ticker** — DONE + live 2026-08-09. Reuses the Calls tab's
    `threads.search` under the same query key; runs sit above the launchers. **Limit:** filters
    the 50 most recent threads, because `extract` is a display projection and not a queryable
    index. Making it complete means promoting `ticker` into thread metadata at run start
    (muffin-agent change).
- [ ] Add new UI style: `terminal` for bloomberg users.

## Mobile App
- [x] Build the app for Android
- [x] Enable building Android app via pipelines.
- [x] [BUG] I've opened Trading Decision (past call), then clicked on "Risk Debate" sub agent to expand and app has crashed. Why is it happening?
- [ ] additional small feedback for the next steps - when I'm not authenticated in app (cloudflare) - calls screen shows not meaningful error. Can we have a better error for such cases and for cases when auth is expired while user browses app/web
- [ ] On Android Countries SVG is not clickable.
- [ ] Build the app for iOS

## Other P1
- [ ] Improve OpenBB MCP to cache results there. OpenBB MCP: extend server to cache data there instead of within agents.
- [ ] **Develop point in time analysis**.
- [ ] AI wizard to which you can upload screenshots, receipts, PDFs and some text and it will fill the data in the system automatically (portfolio, holdings, etc)
- [ ] Add currency to settings
- [ ] Double check authorization rules to make sure users can't delete/amend something that they haven't created (e.g. store). And can't read memories that are not their. 
- [x] Currently when i open existing runs - page loading time is quite high. I guess it can be that way because we are loading everything at once from state. Our agents has subagents/subgraphs/etc. Can we maybe load firstly only parent graph information and then load remainin details when user interacts with page? E.g. On council page - we can postpone loading details from each individual persona until the user clicks on persona. For tool calls - maybe we can load firstly overall stats and load details only when user clicks on specific tool/execution. For criteria analysis - i guess we can load criterion information via separate call as well when user clicks on criterion (lack we do for subagents panel). For individual steps of trading decision maybe we can do the same?
- [x] Handle 401 when after idle browser tab and broken connection
- [x] **https://muffin.rafiki.guru/api/docs doesn't allow to do calls since when i click "Test request" it assumes that site is hosted at root uri (https://muffin.rafiki.guru/), not https://muffin.rafiki.guru/api/ . How can we approach it?**
- [ ] **Check how much data and under which logic gets pulled on market-refresh**. Check how data is strucutred in db. Consider having always option load more for data that is loaded in batches (e.g. history prices). Histroical data doesn't need refresh, we only need to pull latest data, make sure it's handled by data refreshers.
- [x] **Check why not all tickers are pulled** — answered 2026-08-09. The universe IS only the
  ~35 authored tickers (2-5 per sector); nothing is being dropped. The sector list is now paged
  (20/page, largest first, Load more) and the country filter is fixed, but a BIGGER universe is
  blocked on the providers:
  - **finviz screener** has the right columns (name/country/sector/industry/market cap in one
    call) but returns **MANGLED SYMBOLS** — `EEXFY` for Expensify (EXFY), `TTEAM`, `CCRSR` — the
    same first-character duplication as its broken `price_performance`, and its `country` filter
    is ignored. Unusable as an identifier source.
  - **yfinance screener** returns correct symbols + names but no country/sector/industry, and
    orders by day change rather than size.
  - **Scaling:** multi-period returns come from batched daily history (45 symbols ~9s); a few
    hundred will not fit the edge worker's 60s. Either performance covers a top-N subset (the UI
    already renders "no number" honestly) or it needs another source.
  - Likely shape: yfinance screener for symbols + batched `equity/profile` for country/industry,
    performance limited to the top N by market cap.
- [x] **I see tables with data are now unrestricted** and there are couple security treats. — fixed: RLS on every `market` table (public read on reference data, `refresh_log`/`ingest_run` denied to everyone but service_role), `public` locked down from anon/authenticated, and DEFAULT PRIVILEGES revoked so a new table is not exposed by accident. Verified by BEHAVIOUR, not flags: anon reads 200, anon writes 401, `ingest_run` 42501.

## Market reference data — deferred scope (recorded 2026-08-10)

The universe now comes from SEC N-PORT fund holdings: **38 funds → 9,786 securities,
16,424 holdings, 514 sector constituents**, replacing 35 hand-authored tickers.
`market.tracked_fund` is the control surface — everything below is a ROW, not a code
change, unless noted. Free/paid marked where a provider is involved.

**Set this up (free, 2 minutes, big win)**
- [ ] **`OPENFIGI_API_KEY`** — FREE, instant, no approval: https://www.openfigi.com/api/register.
      Ticker resolution (ISIN → symbol) is the one thing gating a complete sector page.
      Anonymous is 25 req/min × 10 ISINs, so it grinds through ~120 securities per run;
      a key makes it 250 × 100 and clears the whole backlog in a single pass. Plumbed
      already (`openfigi_api_key` in secrets.yaml → `OPENFIGI_API_KEY`); it just needs a value.

**Classifications not pulled**
- [ ] **GICS proper** — PAID, needs a licence. yfinance/finviz taxonomies are the proxy, which
      is why `provider_sector` sits beside the curated `sector_id`.
- [ ] **Sub-industry depth** — `taxonomy_node.parent_id` already models sector → industry group
      → industry → sub-industry; only level 1 is populated.
- [ ] **Style (growth/value/blend)** — still a fake heuristic in `taxonomy.ts`
      (`changePct > 15 ? 'growth'`). Needs a real factor source.
- [ ] **Size bands, factor exposures, ESG, credit ratings, per-fund currency exposure.**

**ETFs not tracked** (a row in `market.tracked_fund` each)
- [ ] Style/size: IWF, IWD, IWM, MDY, RSP · Thematic: SMH, ICLN, cyber-security, AI/data-centre
      (these are the "Sectors: AI infrastructure, cyber security" item above)
- [ ] Fixed income: AGG, LQD, HYG, TIP, EMB · Commodity: DBC, USO, SLV
- [ ] **Non-US UCITS funds — structurally impossible**, they file no N-PORT. Not a backlog item.
- [x] FM disabled — no NPORT-P since 2024-11-30, the fund was reorganised away.

**Securities not covered**
- [ ] **Non-US listings.** Ticker resolution asks OpenFIGI for the US line (`exchCode: 'US'`);
      a Japanese or Swiss local line needs an exchange → provider-suffix map (the thing
      `security_provider_symbol` exists for, e.g. NESN → NESN.SW). Until then a foreign
      holding is stored and classified but has no symbol.
- [ ] **Local lines vs ADRs** (SAP XETRA vs NYSE) — needs the `listing` table the model leaves
      room for.
- [ ] Anything **no tracked fund holds** — coverage grows by adding funds, not by scanning.
- [ ] Mutual/closed-end funds, individual bonds, futures/options/MMF, crypto beyond BTC/ETH, pre-IPO.

**Statements — verified available, not yet pulled (2026-08-11)**
- [ ] `equity/fundamental/income` / `balance` / `cash` / `dividends` all return real data from
      KEYLESS yfinance, for non-US listings too. Measured: AAPL income 4 periods x 34 fields,
      balance 4 x 63, cash 4 x 46, dividends 92 payments; Samsung (005930.KS) 4 x 48, 4 x 82,
      4 x 58, 60 payments. Pulling them is a SCHEMA decision (a statement is ~50 line items per
      period per security, so ~10k securities x 4 periods x 3 statements is millions of rows) —
      most likely a `security_statement(security_id, statement, period, data jsonb)` rather than a
      column per line item.

**Data not pulled**
- [ ] **Fundamentals (P/E, revenue, margins)** — every provider we hold a key for was measured
      2026-08-11 and none can serve this universe:
      FMP free gates PER SYMBOL (BHP/SAP/NEE 402); Tiingo free is **limited to the DOW 30**
      ("Free and Power plans are limited to the DOW 30"); Alpha Vantage has NO per-symbol gating
      (SAP, BHP, NEE all return P/E, revenue and margin) but covers **US listings only** — every
      local symbol tested came back empty — and caps at **25 calls/day**, which is ~160 days for
      the US names alone. Needs a paid tier, or a small curated US set refreshed slowly.
- [x] **Market cap** — NOT blocked after all. yfinance returns it in the `equity/profile` response
      `security-profiles` already reads; the resource was discarding it. Shipped 2026-08-11 at no
      extra request.
- [ ] **Market cap** — same gap; the sector page currently ranks by fund weight instead, which is
      a fact from a filing rather than an estimate.
- [ ] **Total return / dividends** — everything is price return, which understates high-yield markets.
- [ ] **Corporate actions** (splits, symbol changes) — the identifier model tolerates a rename,
      nothing detects one.
- [ ] **Index membership** (S&P 500 etc.) — FMP premium; partially substitutable by fund holdings.

**RESOLVED (2026-08-11) — the empty-batch regression**
- [x] `security-fundamentals` and `security-industries` failed every run once the answerable
      securities were done. Cause: an EMPTY provider answer was counted as a failure, so those
      securities were never negative-cached, returned in the next run, and the guard
      (`throw if batchesFailed > 0 && written === 0`) then failed the whole resource. The backlog
      had become entirely the rows it refused to record — which is why it looked like the provider
      breaking at exactly the moment the good work finished.
      The provider was healthy throughout: `metrics` 200 in 0.09s from inside the overlay, with
      real data for the exact queued symbols.
      Fixed: empty marks `*_missing_at` and moves on; neither resource throws when a run writes
      nothing; both now report `lastError`. Verified — 241 and 276 written, zero failures.
      **It took five attempts** (rate limiting, a crash at entry, "no data in the tail", a
      malformed URL, then this) because `catch (_e) { batchesFailed++ }` gave one message to a
      timeout, a refused connection, a bad URL and an empty answer alike. Every wrong theory was
      consistent with what the code was willing to say.

**Found by using the deployed app (2026-08-10) — these are BUGS, not just gaps**
- [ ] **A country page shows GLOBAL sector performance, unlabelled.** `/country/south-korea`
      renders `useSectorPerformance`, which is `scope=sector` from **finviz — US-listed only**.
      So a Korea page displays US sector returns under a "Sectors" heading. This is why "no sector
      shows the +121.9%": that number is EWY's real 1-year return (`KR 1y = 121.93`, correct), and
      the sector rows beside it are a different market entirely. Either label them as US, or drop
      them from country pages until per-country sector returns exist.
- [ ] **A sector inside a non-US country is always empty.** `/sector/information-technology?countryId=south-korea`
      filters `sector_constituents` on `country_iso2=KR` and gets nothing, because sector
      classification is derived from the **11 US sector SPDRs**, which hold no Korean securities.
      Needs either global sector ETFs or per-security provider classification.
- [ ] **Most constituents show no % change.** `market.performance` scope=`instrument` still covers
      only the 35 curated symbols, so 500+ real constituents render with no number. Needs an
      incremental, wall-clock-bounded per-security performance resource (same shape as
      `security-tickers`), because 500 symbols will not fit one 60 s worker.
- [ ] **"Also in this group" lists countries with no page.** MSCI Emerging has **24** members;
      only **12** of them are modelled with an ETF, so 14 (PL, ID, TH, TR, MY, PH, PE, GR, EG, CZ,
      HU, CO, KW, QA) appear as names with no drill-down. Not intentional — the original scope was
      19 countries. **Single-country ETFs exist for most of them** (EPOL Poland, EIDO Indonesia,
      THD Thailand, TUR Turkey, EWM Malaysia, EPHE Philippines, EPU Peru, GREK Greece). Adding one
      is a row in `market.countries.etf_symbol` + a row in `market.tracked_fund` — no deploy.

**Asked for, not yet built (2026-08-10)**
- [ ] **A "refresh" button on every data page**, triggering that page's resources.
- [ ] **Restrict refresh (button AND the edge function) to ADMIN users.** Today any valid JWT can
      trigger a refresh; only `force` is service-role gated. Needs an admin claim/role check in
      `market-refresh` plus UI gating.
- [ ] **Infinite scroll instead of "Load more"** on the sector constituents list.
- [ ] **Market data TTLs (revisit at launch).** Current values are deliberately LONG because
      nobody is watching yet and every refresh spends free-tier quota. Intended production values:
      sector/country/group performance 30-60 min, instrument performance 60 min, prices 24 h,
      profile 24 h, holdings 7 days, tickers 10 min.

**Known limits worth not rediscovering**
- **Fund weights do NOT sum to 100.** EWT's own filing sums to 110.38. `fund_sector_weight` /
  `fund_country_weight` renormalise; anything else drawing a donut must too.
- **N-PORT lags ~60 days.** Membership can be up to ~4 months old — fine for reference data, but
  the UI must show `as_of` and never imply live weights.

## Other P2
- [ ] Add new tab to donate to Ukraine with links to different funds
- [ ] Create agent similiar to criteria analysis, but for hypothesis analysis. The idea is that we firstly define multiple hypothesis and then define which data is needed to compute it's probability -> collect the data and define how probable it is.
- [ ] Features: Allow user to provide Google credentials and create for them Google sheets with stocks, calculations, retirement plan and/or other financial goals. Later add agents for tracking of expenses, projecting budgets, calculating mortgage, ISA, SIPP, etc. Check MCP servers for this. Potentially grant agent access to mcp to so stock related calculations in there (row per agent or row per stock with current price, project price, indicators, signals, column per agent, etc) and/or generate docs with detailed analysis
- [ ] Sectors: AI infrastructure (data centres), cyber security


## Clean-up of muffin-agent
- [x] Move OpenSandbox backend to separeate package: `langchain_opensandbox`. Share it with langchain community. — shipped 2026-08-08 as [gururafiki/langchain-opensandbox](https://github.com/gururafiki/langchain-opensandbox) (MIT, 8th submodule); muffin-agent consumes it via [PR #157](https://github.com/gururafiki/muffin-agent/pull/157). Remaining: publish `0.1.0` to PyPI, flip muffin's commit pin to a version bound, and submit the `integration_external_docs.yaml` listing to LangChain.
- [ ] Move `multi_agent` conversaion to separate package `langchain_llm_debate` (think on naming)
- [ ] Move skill suggestion middleware to separate package
- [x] Double check purpose of `SubagentRefinementMiddleware` — **removed 2026-08-09** ([muffin-agent#161](https://github.com/gururafiki/muffin-agent/pull/161)). It was never wired: `with_subagent_refinement()` appeared in exactly one file across its whole git history (the builder test). Built 2026-05-03 as Wave 4 of `improvements-v2.md`; the follow-up that would have wired it never happened, and the codebase then moved from deepagents `task` subagents (the only pattern it hooks) to compiled-agent-as-node. Its function is covered by `DataCollectionGuardMiddleware` (gaps/fabrication, all 21 collectors) + `ToolKnowledgeMiddleware` (provider-unavailable/upstream-error).
- [ ] Move middlewares from @muffin-agent/src/muffin_agent/utils/ to match the structure of other middlewares.
- [ ] Consolidate todos across 3 places:
  - [ ] Go over @muffin-agent/roadmap.md and check what still makes sense and what is outdated based on our latest development
  - [ ] Go over @muffin-ui/ROADMAP.md and check what still makes sense and what is outdated based on our latest development
  - [ ] Go over @todos.md and check what overlaps with roadmaps above. Split items across roadmaps for individual packages or one Roadmap in unmbrella package if features are cross-package.
- [ ] Clean up READMEs with all up-to-date features