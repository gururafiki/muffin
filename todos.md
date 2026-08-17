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

    **SUPERSEDED — fundamentals are NOT blocked, and the conclusion above was drawn from the wrong
    search.** Every finding in it is true and beside the point: I probed the providers we hold
    KEYS for, rather than the providers that could answer. **Keyless yfinance serves
    `equity/fundamental/metrics`** for the whole universe, non-US local listings included
    (`005930.KS`, `7203.T`, `KGH.WA`), with no key and no per-symbol gate. Measured 2026-08-14:
    **11,395 of 12,348 equities have fundamentals (92%), `pending_fundamentals` = 0.** Twice in
    two days the answer was already inside a response we were fetching — market cap was the first,
    the operating country the third. Left here rather than deleted because the FMP measurements
    are still the reason not to buy an FMP key.
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
- [x] **`OPENFIGI_API_KEY` — SET SINCE 2026-08-10 AND WORKING.** This entry said "it just needs a
      value" long after the value was there, and I relayed it to Alex as an outstanding action.
      Verified 2026-08-13 by running the resource: `resolved: 2279, requestsUsed: 24` — about 95
      ISINs per request, which is the KEYED rate (anonymous is 10, and would have needed ~228
      requests). `remaining: 0` in a single pass, exactly as the keyed limit promises.
      **Check a secret by exercising it, not by reading a note about it.**

**Provider keys: what is actually usable (measured 2026-08-13)**
- [ ] **FMP is DEAD for this stack, and no key fixes it.** OpenBB's fmp provider calls the **v3**
      API, which now answers `403 Legacy Endpoint: only available for legacy users who have valid
      subscriptions prior August 31, 2025` — for AAPL as readily as for anything else, so it is not
      the per-symbol gating recorded previously. FMP's current `stable` API does work
      (`/stable/key-metrics?symbol=AAPL` → 200), but **SAP and BHP still 402 Premium** there, so the
      original reason fundamentals was reverted holds on the new API too. Nothing in the pipeline
      asks for `provider=fmp`, so there is no breakage to fix — but do not expect an FMP key to
      unblock anything without an openbb upgrade AND a paid plan.
- [ ] **Alpha Vantage** is wired and keyed, but 25 calls/day, US listings only — a per-security
      lookup for a page someone opens, never a universe-wide refresh.
- [x] **FMP re-tested with the live key, 2026-08-15 — DO NOT BUY IT for this.** Two separate walls:
      - **v3 is dead**: `403 Legacy Endpoint` for anyone without a pre-August-2025 subscription.
        openbb's fmp provider calls v3, so an FMP key cannot reach this pipeline through openbb at
        all, paid or not.
      - **`stable` works but gates PER SYMBOL, harder than recorded.** `stable/splits?symbol=AAPL`
        returns real data (4-for-1 on 2020-08-31); `7203.T`, `SAP.DE`, `005930.KS`, `NESN.SW`,
        `BHP.AX` — and **`ROST` and `TPR`, ordinary US large caps** — all return
        `402 Premium Query Parameter`. The free tier is a short allowlist, not "US only".
      So FMP would need BOTH a paid plan AND a direct client bypassing openbb, to buy something
      Tiingo already gives for the US universe. Tiingo is the right choice; this is recorded so the
      option is not re-explored.
- [x] FRED and Biztoc keys are set. Unused by the market pipeline.
- [x] **Tiingo is now USED** (2026-08-15, deployment#139) — `security-corporate-actions` reads its
      daily EOD for `splitFactor` and `divCash`. The key had been sitting in GitHub secrets since
      08-10 while this file said it was unusable. See the correction below.

**Classifications not pulled**
- [ ] **GICS proper** — PAID, needs a licence. yfinance/finviz taxonomies are the proxy, which
      is why `provider_sector` sits beside the curated `sector_id`.
- [x] **Sub-industry depth — level 2 IS populated** (corrected 2026-08-14; this entry claimed
      "only level 1" long after it stopped being true). Measured: **11 level-1 sectors, 151
      level-2 industries, 7,577 equities carrying one**, from `equity/profile.industry_category`.
      What remains unpopulated is level **3+**:
      - [ ] **Industry group / sub-industry (levels 3–4)** — `taxonomy_node.parent_id` models the
            full GICS-shaped tree and level 3 is empty (measured: 0 nodes). yfinance gives one
            industry level and no more, so this needs GICS proper or another taxonomy source —
            it is the same blocker as the entry above, not a separate backlog item.
- [x] **Style (growth/value/blend) — the fake heuristic is DELETED (2026-08-12, muffin-ui #76).**
      `taxonomy.ts` derived it from the price move (`changePct > 15 ? 'growth'`), which is not what
      growth and value mean, and nothing rendered or filtered on it. Removed rather than sourced:
      a real style classification needs a factor or fundamentals source, and inventing one from a
      return is worse than having none. Still open as a thing we do not pull:
      - [ ] **Style (growth/value/blend)** — needs a real factor/style source
      (`changePct > 15 ? 'growth'`). Needs a real factor source.
- [ ] **Size bands, factor exposures, ESG, credit ratings, per-fund currency exposure.**

**ETFs not CATALOGUED — different problem from "not tracked", and it was total (found 2026-08-17)**
- [x] **The exchange directory contained ZERO funds** (deployment#144, migration 69). Of 102,390
      rows in `exchange_listing`: 99,673 Common Stock, 2,717 Depositary Receipts, **0 funds** —
      against the 74 ETFs the universe held, every one hand-added. Nothing could report it: every
      coverage number is computed over `security_type_code = 'equity'`, so an entire missing asset
      class moves no metric. **The failure was an ABSENCE, and absences do not raise.**
      The trap, worth not rediscovering: OpenFIGI has TWO type vocabularies and only the fine one
      works here. `securityType2: 'Mutual Fund'` returns **44,119** for the US (FEUCX, WATFX —
      open-end funds, not exchange-traded, and over the 15,000 paging ceiling), while
      `securityType: 'ETP'` returns **6,664** actual ETFs. SPY is `securityType: 'ETP'` INSIDE
      `securityType2: 'Mutual Fund'`. `exchange_sweep_type.figi_field` now records which field a
      type uses. A typo there does NOT error — **OpenFIGI ignores an unknown filter key and returns
      the venue unfiltered**, which is how "Samsung Electronics" once returned 8,725 mostly options.
- [ ] **Decide which newly-catalogued funds to TRACK.** Cataloguing makes ~6,664 US ETPs searchable
      and promotable; it deliberately does NOT ingest their holdings. Tracking all of them would
      mean 6,664 N-PORT filings against SEC's ~10 req/s fair-access limit and would swamp every
      downstream backlog — and most are not US-registered so they file no N-PORT at all.
      `tracked_fund` stays curated; this just makes choosing the next one a query instead of a
      memory. **Blocked on a product call, not on engineering.**

**ETFs not tracked** (a row in `market.tracked_fund` each)
- [x] **Style/size and thematic ADDED 2026-08-13** (migration 48): IWF, IWD, IWM, RSP, SMH, ICLN.
      IWM alone brought 1,922 small caps no other tracked fund holds. **MDY was REJECTED** — it is
      a unit investment trust, and UITs file no N-PORT.
- [x] **Fixed income ADDED 2026-08-13**: AGG, LQD, HYG, TIP, EMB. AGG brought 13,266 securities and
      is why `market.security` is now majority BONDS (15,159 vs 12,348 equities).
- [ ] **Commodity: DBC, USO, SLV — STRUCTURALLY IMPOSSIBLE, not deferred.** SLV is a commodity
      trust and USO/DBC are commodity pools filing 10-K; none files N-PORT. Needs a different
      source entirely.
- [ ] Still not tracked: cyber-security and AI/data-centre thematics (the "Sectors: AI
      infrastructure, cyber security" item above).
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
      FMP free gates PER SYMBOL (BHP/SAP/NEE 402); ~~Tiingo free is **limited to the DOW 30**~~
      **— THAT WAS WRONG, measured 2026-08-15.** Tiingo answered for every US-listed name tried
      (ROST, STX, TPR, ISRG, SNDK) plus ADRs, and a 28-symbol sample of our OWN tickers came back
      **26 covered (93%)**, thin OTC foreign-ordinary lines included. What it genuinely does not
      cover is LOCAL FOREIGN listings — 7203.T, SAP.DE, 005930.KS, NESN.SW all 404. The claim cost
      weeks: corporate actions and total return were both filed under "blocked on money" while a
      working key sat in GitHub secrets. **Re-test a provider claim before building a roadmap on
      it**
      ("Free and Power plans are limited to the DOW 30"); Alpha Vantage has NO per-symbol gating
      (SAP, BHP, NEE all return P/E, revenue and margin) but covers **US listings only** — every
      local symbol tested came back empty — and caps at **25 calls/day**, which is ~160 days for
      the US names alone. Needs a paid tier, or a small curated US set refreshed slowly.
- [x] **Market cap** — NOT blocked after all. yfinance returns it in the `equity/profile` response
      `security-profiles` already reads; the resource was discarding it. Shipped 2026-08-11 at no
      extra request.
- [ ] **Market cap** — same gap; the sector page currently ranks by fund weight instead, which is
      a fact from a filing rather than an estimate.

**OPEN (2026-08-12) — what the reference-model work did NOT finish**
- [x] **`security-fundamentals` drains — PROVEN 2026-08-12 after #88 deployed.** Two runs wrote
      470 and 207 rows where it had written **0 all day**; backlog 6,108 → 5,258, rows 2,937 →
      3,614. `missing` is now ~53 per run rather than 600, so the outage rule is holding: a batch
      that fails no longer negative-caches the page.
- [ ] **The 8 editorial ADR links are unset.** `TSM`/`SAP`/`NVO`/`HSBC`/`RIO`/`BHP`/`SHEL` have no
      `security_id` because the fund-derived universe knows them only as OTC lines (`TSMWF`,
      `SAPGF`) and auto-matching on an alias cannot bridge that. Settable by hand in Studio — the
      table is seeded `on conflict do nothing`, so an edit survives a redeploy.
- [ ] **`instrument-prices` (curated) still downsamples into `market.prices`** while
      `security-prices` stores daily into `security_price`. Both are served through `price_series`,
      which prefers the security series, so this is duplication rather than a defect — but the
      curated resource could be retired for anything that has a `security_id`.
- [x] **Constituent % coverage re-measured 2026-08-12: 23% → 37%** (56 of the same 150 IT
      constituents now carry a 1y return, up from 34). The earlier figure WAS partly an artefact of
      asking under the OTC name, as suspected.
- [ ] **Price coverage 2026-08-13: 1,252,553 bars across ~4,600 securities** (was 331,441 across
      ~1,325). Backlog 6,228 and NOT draining on its own — it grew when migration 50 unlocked the
      4,801 equities whose `prices_missing_at` a corrected symbol had never cleared. Needs the
      paced drain to work through it.
- [x] **Those ETFs were added 2026-08-13** — 11 of them, taking tracked funds 63 → 74 and the
      universe 10,060 → 27,627 securities. The caveat in the original note turned out to be the
      right one and was accepted deliberately: the new holdings DO sit in the backlogs, which is
      why prices is 6,228 and fundamentals 4,973. Adding funds is cheap; draining them is not.

**RECURRING (2026-08-12) — a rule at one call site is not a rule**
- [ ] The same defect shape appeared FOUR times in one day, each time in code that had just been
      written or reviewed:
      1. `fetchWithIsolation` did not carry `security-performance`'s "a whole batch failing is an
         outage" rule, and negative-cached **1,369** good securities during a drain.
      2. `security-yahoo-symbols` shipped unreachable — a resource must be registered in the
         handler AND in the `EXTRA` allow-list.
      3. The currency lookup was learned from filings in `ingest.ts` and not in the fundamentals
         path, so an unseen code failed the whole resource on a foreign key.
      4. #87 applied isolation to `security-fundamentals`, then let the EMPTY-ANSWER branch
         negative-cache **600** securities on a batch that had failed — the same mistake as (1),
         shipped by the fix for it.
      Three now have guards (`logic-check.ts` for the outage rule, the registry check, the
      reachability test). What has no guard is the general shape: **a request that FAILED and a
      request that ANSWERED NOTHING are different facts**, and every branch acting on an empty
      result has to know which it is looking at.

**DONE (2026-08-13) — universe correctness: what was wrong and how ingestion now handles it**
- [x] **Egypt, Nigeria and Portugal reported +0.0% on EVERY period, dated today.** Their ETFs
      (EGPT/NGE/PGAL) are liquidated — last N-PORT 2022, 2023, 2024 — and the price provider serves a
      dead fund's final bars forever, so each period was measured between two identical closes.
      +0.0% reads as "the market was flat". Fixed GENERALLY in `returnsFor`, which refuses any series
      whose last bar is over 10 days old (not a list of dead tickers: **Colombia's GXG still trades**
      and its +42.5% is real, only its filings stopped). 212 stored flat rows cleared; the funds
      carry `retired_at`; EG/NG/PT lost their country pages, since `drillable` derives from
      `etf_symbol` and a page with no number is worse than none.
- [x] **N-PORT's `curCd` mislabelled currencies.** It is the currency the FUND valued the position
      in — often USD for a US-domiciled fund — not the security's quote currency. Measured: of 1,000
      securities with fundamentals, 14 disagreed and every one was `stored=USD` vs
      `provider=PEN/CLP/BRL/EUR`. The provider now wins.
- [x] **`security-industries` was discarding the currency** in the same `equity/profile` response it
      reads for market cap, leaving 1,675 securities with a cap and no currency. Now captured — no
      extra request, and the codes are learned before being referenced.
- [x] **Three live funds were never ingested** (Singapore, Qatar, Kuwait) — now in, with holdings.
- [x] **The universe reached only large-cap equities.** Eleven style/size/thematic/fixed-income funds
      added, each CHECKED against SEC's ticker file first. Four were rejected structurally: SLV is a
      commodity trust, USO and DBC are commodity pools filing 10-K, and MDY is a UNIT INVESTMENT
      TRUST — UITs file no N-PORT.
- [x] **The ISIN resolver could not see securities with NO symbol** — nothing had tried to fetch
      them, so no `*_missing_at` flag was set, so they never entered any backlog. 485 securities,
      including Exxon Mobil. Now first in the queue; already naming Honeywell and several Gulf banks.

- [x] **Every non-share holding was typed `other`** — 15,205 bonds, futures, repos and money-market
      positions sharing one type, so "E MINI RUSS 1000 VJUN26" (a futures contract) sat beside
      "Saudi Government International Bonds" as the same kind of thing. `ingest.ts` typed from
      N-PORT's `units` alone (`NS` → equity, everything else → other) and a comment asserted that
      reading `assetCat` "would be a fiction". It is not: `assetCat` is a REQUIRED N-PORT field with
      a closed vocabulary, was already captured on `fund_holding.asset_category_code`, and
      `market.security_type` already carried bond/cash/derivative. Both vocabularies existed; only
      the ingest was not using them. Fixed at ingest + backfilled (migration 49). Deployed
      2026-08-13: **`other` 15,205 → 0** (15,159 bond, 44 derivative, 2 cash), equity untouched.
      The backfill only widens from `other` and declines when two funds disagree — both guards
      mutation-tested, against production-shaped rows rather than an empty database (which is how
      migration 38 broke a deploy: its `update` matched nothing there, so its guards went
      unexercised).
- [x] **`market-verify` floored the TOTAL, which is no longer a proxy for the universe.** Bonds now
      outnumber equities (15,159 vs 12,348) while every backlog and serving view filters
      `security_type_code = 'equity'` — so a bug that retyped equities would empty the app and leave
      check 1 green. Added an explicit equity floor.
- [x] **FIFTH `*_missing_at` defect: a corrected symbol never cleared `prices_missing_at`.** The
      resolver clears negative caches because a flag recording "we asked and got nothing" is not
      evidence once the name we asked under was wrong — but it cleared a hand-written list of five
      columns, and `prices_missing_at` (migration 42) arrived later. Measured: **4,801 of 12,348
      equities** locked out of `pending_prices` after their symbol was fixed, with no error and
      `ok: true` throughout. Adding a sixth line would leave the seventh resource to fail
      identically, so the list moved into `market.clear_symbol_caches` next to the columns, and
      `market.symbol_cache_classification` states for all nine which a new symbol invalidates and
      why (figi/local_symbol are keyed on the ISIN, not the symbol; clearing them would re-ask a
      rate-limited provider for an answer we hold). `tests/negative-caches-are-classified.sql` now
      fails CI when a `%_missing_at` column is added that nobody classified.
- [x] **`market.one_shot` — data repairs in a migration set that re-runs in full.** Re-applying
      every migration on every deploy is what makes the schema self-healing, but re-applying a data
      REPAIR is different: clearing `prices_missing_at` each deploy would permanently defeat the
      negative cache, i.e. reintroduce the exact failure the flag prevents, as the fix for it.
      There was nowhere to say "run once"; now there is.

- [x] **Search returned eight symbol-less bond rows above every real bank.** The universe comes
      from fund holdings, so adding AGG/LQD/HYG/TIP/EMB made `market.security` majority BONDS
      (15,159 vs 12,348 equities) and the app's search had no type filter. Ordering is alphabetical
      (PostgREST cannot rank), so `AFRICAN DEVELOPMENT BANK` × 8 — no symbol, no price series, no
      page to open — crowded out the entire first page for "bank". Filtered to `equity`/`etf` at the
      query, not in `security_current`, which is the security record and is right as it stands.
      Only fixable once securities carried a real type.
- [x] **The drain became its own outage.** Running six resources back to back tripped
      `YFRateLimitError: Too Many Requests` within three cycles. `fetchWithIsolation` decided by
      TALLY — all-failed means the provider, otherwise the symbols — which is blind to a
      PROGRESSIVE throttle: yfinance refuses some symbols while answering others, so `rows.length
      > 0`, the rule never fires, and the refused ones get negative-cached as unanswerable. Exactly
      the mechanism that cost 1,369 ordinary tickers. Now classified from the wire text, which said
      so all along. The drain loop paces 45s/resource, 90s/cycle, and backs off 6 min on a throttle.
- [x] **A wrong theory, recorded because it was nearly shipped.** On the truncated message
      (`Error getting data for ITGR -> YFR…`, which reads as a symbol failure) I built a rule to
      blame the symbols whenever the provider had answered earlier in the run — theorising that a
      draining backlog concentrates unanswerable symbols into uniformly-bad batches. Disproved by
      measurement: once throttling stopped, `security-industries` reported `remaining: 0, note:
      every security has an industry`. The "stuck" batches had drained. It was also unsafe on its
      own terms, since a progressive rate limit makes "it answered earlier" no evidence it is up now.

- [x] **`security-profiles` could never finish, and it looked like a provider outage.** An empty
      answer shared a branch with a thrown failure, so a batch the provider ANSWERED nothing for
      was counted failed and skipped its negative-cache write — returning every run forever — and
      the "all batches failed" guard then failed the resource at exactly the point where only
      unanswerable securities remained. `pending_profile` froze at 2,437 while three sibling
      resources on the same endpoint reported ok. Fifth instance of throw-vs-empty; the first two
      were fixed and this call site was not, so it is now asserted against the source in
      `logic-check.ts` rather than left to review.

- [x] **~8,300 securities wrongly negative-cached in one afternoon, by my own drain.** Running six
      resources back to back tripped yfinance's rate limit, and a throttled yfinance answers
      **200-with-no-rows** rather than erroring — which every outage rule in the pipeline was blind
      to, because they are all THROW checks. Six marking sites then recorded "the provider has
      nothing for this security": industry 1,414 (INTC, PEP, XOM, TXN, EA, SCCO), statements 5,613
      (EQH, TOST, CRBG, ACM, RKT), performance 1,205 (EMR, TPL, REGN, UPS), fundamentals 122,
      prices 40. `pending_industry` went to 0 and read as *drained*. All six now gate on the
      endpoint having answered for someone in the run; the marks were cleared afterwards.
- [x] **The guard I wrote for it was decorative, and I nearly shipped it as proven.** It walked each
      branch to its closing brace looking for a gate — brace depth counts braces in comments and
      template literals, so it caught one of four deleted gates while printing "all six marking
      sites gated". The first mutation run also used `sed` with mis-escaped `&&` and changed
      nothing, so four passes meant four no-ops. Now a named list of the six exact gate expressions.

- [x] **"A few bond-fund holdings are typed equity" — MEASURED AND MOSTLY WRONG.** I recorded this
      as evidence that `security_type_code` was untrustworthy where a filing omits `assetCat`. It is
      not: only **372 of 39,886 holdings (0.9%)** lack a category, and the `units` fallback types
      those correctly — Airports of Thailand, Indorama Ventures, Banpu and Dubai Residential REIT
      are all genuinely equities. AGG's first 1,000 holdings are 728 DBT, 263 ABS-MBS, 9 ABS-O and
      **zero** typed equity. The `unclassified 100%` slice comes from a handful of equity-typed
      holdings somewhere in its 13,267, which is a bond fund holding a few equities — not a typing
      defect. Nothing renders a bond fund's donut anyway.

- [ ] **Statements coverage is ~12.5%, not the ~60% a row count suggests.**
      `security_statement_current` returns one row per (security, statement, period) — about twelve
      per security — so 12,928 rows is ~1,544 securities. Measured 2026-08-13 from the backlog
      arithmetic: 12,348 equities − 8,355 pending − 2,449 negative-cached. The resource fetches ONE
      security per call (the provider does not batch income/balance/cash), so this drains slowly;
      `security-refresh` covers anything a user opens on demand, which is what makes the depth
      tolerable rather than fixed.

- [ ] **muffin-ui's 3 Dependabot alerts are DELIBERATELY not fixed — investigated 2026-08-13.**
      Left open with a reason, because an unexplained alert invites someone to "fix" it with an
      override that breaks the build.
      - `image-size` (2 HIGH, DoS via malformed ICNS/JXL/HEIF) — **no patched version exists**
        (`first_patched_version: none`). It arrives via `expo → @expo/metro → metro`, i.e. the
        BUNDLER. Nothing to upgrade to, and nothing to do but wait for metro.
      - `uuid` (MEDIUM, missing buffer bounds check in v3/v5/v6 when `buf` is supplied) — installed
        at **7.0.3** via `expo-splash-screen → @expo/config-plugins → xcode@3.0.1`, and patched in
        **11.1.1**. Forcing four major versions into a package pinned to v7 is a real risk to
        `expo prebuild` in exchange for a DoS in a tool that only runs at build time.
      Both are BUILD-TIME dependencies — the bundler and the native-project generator. Neither ships
      in the web bundle or the app, and exploiting either needs malicious input into our own repo.
      Revisit when Expo bumps `metro` or `@expo/config-plugins`.

**OPEN (2026-08-13) — known limits, not bugs**
- [ ] **`market_cap` is stored in the security's own currency**, so ordering by it mixes ¥, ₩ and $ —
      191 securities exceed "5T" purely for that reason. Correct per security, wrong for ranking.
      Needs FX rates, which no keyless provider here supplies.
- [ ] **Commodity and UIT funds cannot be ingested from N-PORT at all** (SLV, USO, DBC, MDY). A
      different filing type or provider would be required; not a backlog item.
- [x] **~1,900 securities cannot get fundamentals — DRAINED** (corrected 2026-08-14). The symbol
      backlog that caused it went 8,532 → 0, and with it this one. Measured today:
      **`pending_fundamentals` = 0, 11,395 of 12,348 equities have fundamentals (92%)**, and 492
      carry `fundamentals_missing_at` — negative-cached as genuinely unanswerable rather than
      stuck. The Bloomberg-spelling diagnosis was right and the ISIN resolver was the fix.

**DONE (2026-08-12) — the reference-model rebuild.** Alex asked what should be captured in the
universe rather than derived at runtime. Identifiers were already a real catalog (9,865 ISINs,
4,350 tickers, 1,495 CUSIPs; the LEI on `issuer`, because an LEI identifies the ISSUER); the
EXCHANGE layer was not. Six PRs, each verified live:

- [x] **`market.exchange` — one venue catalog** (deployment #77). The map (exchange code → country →
      provider suffix) existed in `exchanges.ts` AND in `exchange_cursor`'s seed, and had drifted to
      **54 rows against 38** — so `security-local-symbols` resolved symbols on sixteen venues
      (China, Canada, Australia, Brazil, UAE, Colombia) that `exchange-listings` never swept. The
      seed was extracted from the code programmatically, not retyped.
- [x] **`market.listing` — where a security trades** (#78). `exchange_listing` holds 59,324 venue
      rows and has no `security_id`; only 536 securities carry a FIGI, so 99% floated unattached.
      Built on the provider-symbol suffix instead (**8,522 reachable**), because the FIGI join would
      have made the table look built and stay empty. **9,575 linked.** The ISIN resolver now keeps
      every venue it sees rather than discarding all but one — that is the ADR data.
- [x] **The primary listing NAMES the security** (#79). The display symbol was
      `coalesce(ticker, provider_symbol)` — ticker first — and that ticker is OpenFIGI's *US* lookup,
      a thin OTC line for a foreign company. **365 of 900 sampled non-US securities (41%)** were
      labelled `SAABF`/`HXGBF` while priced off `SAAB-B.ST`/`HEXA-B.ST`. Prices were never wrong;
      the label was. `performance.scope_id` had to be re-keyed by hand — anything keyed on
      `security_id` needed nothing, which is why `security_price` is.
- [x] **`market.instruments` kept as a curated OVERLAY** (#80), not retired as originally planned.
      Measuring first showed 8 rows are editorial ADR picks (`TSM`, `SAP`, `RIO`) and 12 are not
      securities at all (`USD`, `US10Y`, `BTC`, `WTI`, `GLD`). `priced = false` is what makes cash
      and a bond yield render NO number. It now carries a nullable `security_id`, and
      `instrument_current` merges the two: curated wins for editorial fields, the security supplies
      provider-refreshed ones. **32 of 47 auto-linked**; AAPL and NESN now carry live market caps.
- [x] **`market.security_price` — prices for the whole universe** (#81, re-keyed in #82). Fetched
      INCREMENTALLY from the newest stored bar: **20 rows in ~1s** against 10,737 in 52s for a first
      pass. Stored daily in a 400-day window rather than downsampled, because downsampling and
      appending fight (a bar that was daily never becomes weekly as it ages) and the chart's longest
      range is 1Y. **0 → 194,347 bars.**
- [x] **Reachability guard** (#83). The migration tests apply DDL as a SUPERUSER, so they prove a
      table can be created and nothing about whether anyone can reach it. `security_price` shipped
      with no grant; the new test found two more the moment it was written, including `listing`,
      which the ISIN resolver writes on every run.

**DONE (2026-08-12) — ingestion throughput and health**
- [x] **Pages are now bounded by the DEADLINE, not by their size** (#84). Every resource was
      finishing inside its 55s budget, so at 4 runs/day prices needed **20 days** to drain and
      statements **32**. Measured, then raised: prices 120→400 (52s), statements 60→200 (54s),
      fundamentals/industries 300→600. Cron every 3 hours instead of 6.
- [x] **A durable resource-health check** (#86). Every other check asserts data SHAPE, which cannot
      see a resource failing on every run — the table just stops growing. Fires only after 12h
      without a success, so a provider blip does not cry wolf.
- [x] **Isolation applied to `security-fundamentals` and `security-profiles`** (#87). Fundamentals
      was 100% stuck: all 60 batches of a 600-row page 400'd on one bad symbol (`2689.HK`).

**IN PROGRESS (2026-08-12) — resolving symbols from ISINs via Yahoo search**
- [x] Alex chose the Yahoo ISIN route. `security-yahoo-symbols` resolves a security's provider
      symbol from `query2.finance.yahoo.com/v1/finance/search?q=<ISIN>` (public, keyless; we hold
      9,865 ISINs). The HOME MARKET is required — matched on the suffix table already verified
      against the provider — because Yahoo's ISIN index is inconsistent: Televisa's returns the
      local `TLEVISACPO.MX`, Walmex's returns ONLY a Frankfurt line. Taking the first hit would
      price a Mexican retailer off a thin German listing.
      A resolved symbol CLEARS `industry/profile/performance/fundamentals/statements_missing_at`,
      or the spelling would be fixed while the security stayed excluded from every backlog for 30
      days.
- [x] **First runs measured 2026-08-12: it works, and it vindicates using a SOURCE over rules.**
      81 symbols resolved across 4 paced runs of 40, `failed: 0` — no rate limiting at that pace.
      The translations are ones I could not have written from memory:

      | | |
      |---|---|
      | Saudi + Malaysia are NUMERIC | `ARAMCO.SR -> 2222.SR`, `SABIC.SR -> 2010.SR`, `MAY.KL -> 1155.KL`, `CIMB.KL -> 1023.KL` |
      | Ireland is an unrelated code | `AIBG.IR -> A5G.IR`, `KSP.IR -> KRX.IR`, `KYGA.IR -> KRZ.IR` |
      | Chile renames outright | `BSAN.SN -> BSANTANDER.SN`, `MALLPLAZ.SN -> MALLPLAZA.SN` |
      | Nordics hyphenate the class | `NOVOB.CO -> NOVO-B.CO`, `ERICB.ST -> ERIC-B.ST`, `MAERSKB.CO -> MAERSK-B.CO` |
      | Hong Kong pads to four | `388.HK -> 0388.HK`, `2.HK -> 0002.HK` |
      | Bloomberg forms | `BRK/B -> BRK-B`, `BP/.L -> BP.L`, `NG/.L -> NG.L` |

      **A rules-from-memory approach would have covered HK padding and the Nordic hyphen and
      silently missed Saudi, Malaysia, Ireland and Chile entirely** — the exact failure mode of the
      hand-written exchange table that dropped Taiwan.
      Resolution CLEARED the negative caches as designed: `industry_missing_at` is down to 76 and
      `pending_industry` went back UP (6,192 -> 6,244) as recovered securities re-entered the queue.
      That is the intended direction — a backlog growing because securities became answerable again.
- [ ] It shipped UNREACHABLE first (`unknown resource`), because a resource must be added to the
      `EXTRA` allow-list as well as the handler. Now guarded in `logic-check.ts`, which reads the
      cron workflow and the handler as text and asserts every resource the cron calls is accepted.

**RESOLVED (2026-08-12) — half the sector list was UNTAPPABLE**
- [x] The serving views took `symbol` from `kind_code = 'ticker'` only, so a security addressable
      only by a local provider symbol (`005930.KS`) had no symbol — and the list sets
      `disabled: !s.symbol`. Measured before: 3,821 of 7,940 constituent rows carried a symbol,
      against 8,521 securities holding a yfinance provider symbol.
      Fixed in muffin-deployment #73 (`coalesce(ticker, provider_symbol)`, the same precedence the
      ingest backlogs use) + muffin-ui #75. **Measured after: 7,934 of 7,940.**
      The UI half was NOT optional: `use-fundamentals` and `use-statements` filtered on
      `kind_code = 'ticker'` themselves, so shipping only the view change would have turned 3,400
      dead rows into 3,400 blank pages. `useInstrument` also falls back to `security_current`,
      which is what stops those pages rendering a bare ticker over blank space.

**RESOLVED (2026-08-12) — the extreme returns: 6 fabricated, 34 real**
- [x] Settled by re-fetching the daily series for all 40 securities with a 1y return >= +300% and
      taking each one's largest single-day ratio. The populations separate with NOTHING in between:
      discontinuous — AMRM.TA 96.6x, ISHO.TA 101.0x, ARZTF 30.3x, PBMRF 28.7x, YZOFF 25.5x,
      KLTHF 6.0x; real — ASAAF 2.04x, KXHCF 1.45x, 009150.KS 1.30x, SNDK 1.28x, MU 1.19x.
      AMRM.TA and ISHO.TA jump ~100x on **the same day** (2026-05-18) and are both quoted in `ILA`:
      Yahoo switched Tel Aviv quotes from shekels to agorot. The USD names are OTC lines carrying an
      unadjusted ratio change; a reverse split looks identical and is equally not comparable.
      Fixed in #70: `returnsFor` omits any period whose anchor predates the most recent >5x move —
      per PERIOD, so after a break the short windows survive. Migration 33 clears the six.
      **The 34 real ones are deliberately untouched.** SNDK really is up ~2,700%; capping it would
      replace a right number with a different wrong one. This is why the guard in `market-verify.yml`
      is a TRIPWIRE on the count (25) rather than an assertion that no number may be large.

**OPEN (2026-08-11) — symbols are BLOOMBERG-format where the provider wants its own**
- [ ] `security_identifier.kind_code = 'ticker'` is written from OpenFIGI, whose `ticker` is the
      Bloomberg spelling. Measured in a 1,000-symbol sample of `pending_industry`: 10 carry `*`
      (`WALMEX*.MX`, `AC*.MX`, `PINFRA*.MX`), 8 carry `/` (`BRK/B`, and the UK convention `BP/.L`
      `RR/.L` `AV/.L` `NG/.L`), 1 carries `&` (`PE&OLES*.MX`).
      muffin-deployment #69 makes the URL well-formed (they were corrupting whole batches), but an
      ENCODED wrong symbol is still a wrong symbol — yfinance will answer for none of these.
      **Do not author the translation table from memory.** A SOURCE EXISTS, and probing it
      2026-08-12 already caught a rule I would have got wrong:

      `GET https://query2.finance.yahoo.com/v1/finance/search?q=<ISIN>` — public, keyless, and it
      accepts an ISIN, which `market.security_identifier` already holds for 9,865 securities.

      | ISIN | Yahoo returns | the rule I would have written |
      |---|---|---|
      | `US0846707026` (Berkshire B) | `BRK-B` | `BRK-B` ✓ |
      | `GB00B63H8491` (Rolls-Royce) | `RR.L` | `RR.L` ✓ |
      | `MXP810081010` (Walmex) | **`4GNB.F`** — Frankfurt, and the ONLY hit | ~~`WALMEX.MX`~~ ✗ |
      | `MXP4987V1378` (Televisa) | `TLEVISACPO.MX` — local, correct | — |

      So the endpoint works but its ISIN index is INCONSISTENT: sometimes the local line, sometimes
      only a foreign cross-listing. **Taking the first hit would price a Mexican retailer off a thin
      German listing** — precisely what `exchanges.ts` says not to do ("picking arbitrarily would
      price a Korean bank off its Frankfurt line"). Any implementation must require the hit's
      `exchange` to match the security's country and negative-cache the rest, rather than accept
      whatever comes back. Searching the malformed symbol itself is useless and actively
      misleading: `q=BRK/B` returns four unrelated leveraged ETFs.

      **Design decision for Alex before building:** this would be a NEW direct dependency on Yahoo,
      alongside (not through) OpenBB. Alternatives: probe `openbb equity/profile` with candidate
      spellings and keep what answers (no new dependency, but it is a guess-and-check over rules I
      invented), or leave these ~2% unresolved.
      Cheap to bound either way — roughly 2% of symbols, and they negative-cache themselves via
      `industry_missing_at` meanwhile, so nothing is stuck.

**OPEN (2026-08-11) — 19 instrument returns at ≥ +1000%, undiagnosed**
- [ ] The extremes are two Tel Aviv listings at +9453.7% (`AMRM.TA`) and +8946.9% (`ISHO.TA`),
      then `ARZTF` +2928%, `SNDK` +2692%, `ODINE.IS` +2299%. 31 rows are ≥ +500%.
      **Not claimed to be wrong.** A micro-cap really can do this, and a denomination change or an
      unadjusted split would look identical from the outside — TASE quotes in agorot (1/100 ILS),
      which is exactly the kind of unit change that produces a fake 100x. Distinguishing them needs
      the actual series, which means reaching `openbb-api` on the private overlay.
      Note the asymmetry with the -100% cluster, which WAS provably wrong: every period agreed,
      including `1d`, and no market moves identically over one day and one year. These do not have
      that signature, so they get investigated rather than deleted.

**RESOLVED (2026-08-12) — `security-industries` 502s were a DUPLICATE CONFLICT KEY**
- [x] Root-caused from the edge-runtime logs on the node, not by bisecting:
      `[Error] market-refresh(security-industries) failed: security_taxonomy upsert failed:
      ON CONFLICT DO UPDATE command cannot affect row a second time`.
      Postgres refuses an upsert whose statement carries the same conflict key twice (SQLSTATE
      21000) and fails the WHOLE statement. `pending_industry` yields one row per (security,
      level-1 sector), so a security classified into two sectors arrived twice and produced two
      identical `security_taxonomy` writes.
      **That is why it looked like a page-size problem** — the duplicated securities only fall
      inside the larger slices, so `limit` 10 and 20 returned 200 while 40/100/300 returned a bare
      502. Both of my candidate theories (the market-cap write loop, slow foreign lookups) were
      wrong, and neither would ever have been disproved by more black-box bisecting. **Read the
      worker logs first when a bare 502 is reproducible.**
      Third occurrence of this shape: `ingest.ts` already dedupes fund holdings (one position,
      several lots) and the sector views had to `distinct on`. Fixed in muffin-deployment #70 with a
      shared `dedupeBy` at every `DO UPDATE` upsert fed by a provider, a backlog or a filing, plus a
      dedupe at the source. `ignoreDuplicates` (DO NOTHING) has no such restriction.

**OPEN (2026-08-11) — half the sector list is UNTAPPABLE, because the view only knows `ticker`**
- [ ] `sector_constituents.symbol` comes from a lateral over `security_identifier` with
      `kind_code = 'ticker'` only, so a security whose only address is a local provider symbol
      (`005930.KS`) has no symbol in the view — and `sector/[sectorId].tsx` sets
      `disabled: !s.symbol`, so the row cannot be opened at all.
      Measured 2026-08-11: **3,821 of 7,940** constituent rows carry a symbol, while **8,521**
      securities have a yfinance provider symbol; of a 900-row sample of those, **40% have no
      `ticker` identifier**. So roughly 3,400 securities are addressable by the price provider,
      have returns, and are unreachable in the UI.
      Fix is two halves, and the second is the one that is easy to forget:
        1. The serving views expose `coalesce(ticker, provider_symbol)` — which is exactly what
           `pending_industry` already does (`coalesce(ps.symbol, t.value)`).
        2. `use-fundamentals.ts` / `use-statements.ts` / `use-instrument.ts` resolve a symbol via
           the ticker identifier **or** the provider symbol. Today they filter
           `security_identifier.kind_code = 'ticker'` alone, so a page opened on `005930.KS` would
           render empty — the server already has this fallback in `security-refresh`
           (`index.ts`, "Fall back to the PROVIDER symbol").
      Shipping (1) without (2) turns 3,400 dead rows into 3,400 blank pages.

**RESOLVED (2026-08-11) — a backlog that could never be satisfied, freezing market cap at 386**
- [x] `pending_industry` asked "has a level-1 sector, has no level-2 industry" and wrote the second
      half as a left join plus `where ind_n.node_id is null`. The first join was UNRESTRICTED, so it
      matched every taxonomy row a security had — including the level-1 sector rows the view itself
      required — and each of those joins the level-2-restricted node table as NULL and survives the
      filter. **A `where` filters ROWS, not securities**, so one qualifying row cannot suppress
      another: every security with a sector stayed queued forever, classified or not.
      Measured: AMZN was written `consumer-discretionary--internet-retail` at 21:41:39 and was still
      returned by the backlog in the same minute; the count was 7,911 before a run and 7,911 after
      one reporting `classified: 282, capped: 282`; **345** securities had an industry against 8,412
      with a sector. The resource takes the top 300 by fund weight per run, so it re-fetched the
      SAME 300 names on every run since migration 23 and never reached row 301 — and
      `security.market_cap` was stuck at **386 of 10,060** because the cap rides along on that same
      `equity/profile` response.
      **Nothing errored.** It reported success and progress on every run, and the counts were
      plausible and simply never moved — invisible to every floor-style check.
      Fixed by muffin-deployment #67 (migration 31, a real `not exists` per security). Every other
      backlog view null-checks the FIRST left-joined table, which is why they drain; the signature
      to recognise is a predicate on a SECOND table reached through an unrestricted first join.
      Guarded twice, each verified to FAIL with the bug reintroduced:
      `stack/supabase/tests/backlogs-are-satisfiable.sql` (offline, empty DB, run by quality.yml)
      and `market-verify.yml` check 7b (production data, service-role key since the `pending_*`
      views are not granted to anon).
- [ ] **Total return / dividends** — everything is price return, which understates high-yield markets.
- [ ] **Corporate actions — splits are DETECTED but stored prices are never ADJUSTED.** Written
      down properly 2026-08-14; it had only ever been implied by the guards that work around it.
      `firstComparableIndex` refuses to report a return whose anchor predates a >5x single-bar
      move, per period, so a split cannot fabricate a +900% — that part works and is measured
      (largest legitimate one-day move 2.04x, smallest illegitimate 6.0x, nothing between).
      What does NOT happen is any correction: the stored closes stay unadjusted, so the pre-split
      history is silently **excluded rather than fixed**, and a chart drawn across the break shows
      a cliff. Consequences worth stating so nobody rediscovers them:
      - the 3Y/5Y numbers for a security that split inside the window are simply absent, not wrong
      - `market.security_price` is a ~400-day window, so a split ages out of it in about 13 months
        and the problem quietly disappears rather than being resolved
      - the same guard fires on **redenominations** (Tel Aviv moving quotes from shekels to
        agorot, 2026-05-18) which are not corporate actions at all and would need different handling
      The fix needs a split/dividend feed — `equity/fundamental/splits` or similar — and a
      back-adjustment pass over `security_price`.
      **THE FEED NOW EXISTS** (2026-08-15, deployment#139): `market.security_corporate_action`
      records splits and dividends from Tiingo for the ~6,645 US-tickered securities, verified
      against known history (NVDA 4-for-1 and 10-for-1, TSLA 3-for-1, GOOGL 20-for-1, WMT 3-for-1).
      What remains is the SECOND half — a back-adjustment pass that applies those splits to stored
      closes, and a total-return calculation from `divCash`. Both are now ordinary work rather than
      blocked. Local foreign listings stay uncovered (Tiingo 404s them), so a Japanese split is
      still invisible.
- [ ] **Symbol changes** — the identifier model tolerates a rename, nothing detects one.
- [ ] **Index membership** (S&P 500 etc.) — FMP premium; partially substitutable by fund holdings.
- [ ] **The reporting currency of a STATEMENT is unknown for 376 securities** (audit 2026-08-15).
      `security_statement.currency` is null on all 83,211 rows; the view falls back to
      `security.currency_code`, which is the QUOTE currency. That is right for a local listing and
      wrong for an ADR: Alibaba's CNY 1,023,670,000,000 revenue read **$1.02 TRILLION**, larger
      than Walmart. 565 non-US companies are quoted in USD, 376 of them with statements.
      deployment#135 + muffin-ui#85 WITHHOLD the label rather than invent one, which is correct but
      is not the same as knowing. To actually fix it, one of:
      - `quoteSummary.financialCurrency` — the real answer; needs a crumb/cookie, currently
        `Unauthorized: Invalid Crumb`
      - an openbb release that surfaces a currency on `equity/fundamental/income|balance|cash`
      **Already ruled out, do not retry:** `equity/fundamental/metrics.currency` and Yahoo chart
      meta are both the QUOTE currency; a country→currency guess is wrong (VALE and NU are
      Brazilian and genuinely report in USD); and deriving it from `enterprise_to_revenue` FAILS —
      Yahoo computes that ratio inside the reporting currency, so BABA reads 1.00 while VALE (0.18)
      and Samsung (0.69) false-positive.
- [x] ~~**NESN.SW and SAP.DE drift ~1% from Yahoo's closes**~~ **RESOLVED 2026-08-15, and it is not
      a defect.** The dividend-adjustment hypothesis was wrong — raw and `adjclose` give an
      identical difference. Measuring the drift PER DATE showed the shape: **every settled bar
      matches to 0.000%**, and only the single most recent bar differs (2026-08-13 for both). That
      is a provisional last close, not bad data — European markets settle at 17:30 CET and our
      fetch caught a different moment than Yahoo's final print. Recorded because "1% off from
      Yahoo" reads as a data-quality problem and is instead the ordinary cost of a daily pipeline:
      the latest bar can move after we read it. **Compare a whole series before believing a
      single aggregate difference** — `max diff` over 25 days hid the fact that 24 of them were
      exact.

**RESOLVED (2026-08-11) — statements rendered in the WRONG CURRENCY on non-US stocks**
- [x] The income-statement card prefixed every figure with `$` (`formatCap` hardcoded it) and the
      currency header was EMPTY, because `security_statement.currency` is null for every row — the
      income/balance/cash responses carry no currency field at all, so `reported_currency` was a
      wrong guess when migration 29 was written.
      Alibaba's FY2026 revenue is **CNY 1,023,670,000,000** and rendered as **"$1.02T"**, which
      would make it the largest company on earth by revenue (it is ~$141B). Samsung's is
      97,146,675,000,000 KRW → "$97.15T".
      Fixed in muffin-ui #73: `features/markets/money.ts` takes a currency, and the hooks carry
      `security.currency_code` (N-PORT `curCd` first, the yfinance metrics response second) read
      SECOND so a provider that starts sending a real per-statement currency wins. Coverage
      measured: **3,221 of 3,233** statement rows resolve a currency, 1,077 of 1,081 income rows.
      Three things that had to be measured, not assumed:
        * `$` is ambiguous even when right — USD/CAD/AUD/HKD/SGD/MXN/CLP all print as `$` and all
          are held by tracked funds. Of a 1,000-security sample with a currency, 663 are USD and
          337 are not.
        * **The locale must be pinned.** The formatter appends the scale suffix itself, and `de-DE`
          puts the symbol last — `215,94 $` — so the append yields `215,94 $B`; `fr-FR` yields
          `215,94 $USB`. Only `en-US`/`ja-JP` happen to compose. My machine's default is `en-US`.
        * An unknown code makes `Intl` THROW, and a throw during render takes a native build down.
      With no currency the figure is left unlabelled — defaulting to dollars is how this started.

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

**Found by using the deployed app (2026-08-10) — re-verified 2026-08-12**
- [x] **A country page showed GLOBAL sector performance, unlabelled.** Fixed: the page reads
      `market.country_sector_performance` (a weighted mean of the country's own constituents) and
      names the fund it came from. Where a country has no coverage it still falls back to the US
      panel, but titled **"US sector performance"** — the original complaint was that it was
      unlabelled, not that it existed.
- [x] **A sector inside a non-US country was always empty.** Fixed by per-security provider
      classification. Verified live 2026-08-12: `/sector/information-technology?countryId=south-korea`
      renders Korean constituents with `.KS` symbols and real sub-sector chips (Consumer
      Electronics, Semiconductor Equipment & Materials).
- [ ] **Most constituents still show no % change — 34 of 150 sampled IT constituents (23%).**
      The incremental resource this asked for EXISTS (`security-performance`, wall-clock bounded,
      writing 20,399 rows), so this is no longer "only the 35 curated". What limits it now is
      SYMBOL CORRECTNESS: 3,037 securities carry `performance_missing_at` because yfinance had no
      series for the name we sent, and many of those names were the Bloomberg spelling.
      **This should improve on its own** — `security-yahoo-symbols` clears `performance_missing_at`
      when it resolves a better symbol, so those securities are re-fetched under the right name.
      Worth re-measuring once the resolver has worked through its 3,579 backlog. No key mismatch:
      `security_symbol` uses `coalesce(ticker, provider_symbol)`, the same key
      `pending_performance` writes `performance.scope_id` under (checked, because the serving view
      changed on 2026-08-12 and this was the obvious way to break it).
- [x] **"Also in this group" listed countries with no page.** Largely fixed — 46 countries are
      drillable, up from 19. Measured against MSCI's tier lens 2026-08-12:
      **developed 22 members / 0 without a page; emerging 24 / 4** (CZ, HU, QA, KW — was 14).
      **Qatar and Kuwait added 2026-08-12** (muffin-deployment #76: QAT and KWT exist, confirmed
      against the provider), leaving emerging at 2. **Czechia and Hungary stay** — no liquid
      single-country ETF exists, so there is no price series to derive, and a regional proxy would
      put a number under a country's name that is not that country's.
      **Frontier is 21 / 19 and stays that way**: single-country ETFs mostly do not exist for those
      markets, so there is nothing to derive a page from. That is a structural limit, not a backlog.

**Asked for 2026-08-10 — all but one now built**
- [x] **A "refresh" button on every data page.** Shipped on markets, country, sector and stock
      (`refresh-button.tsx` + `PAGE_RESOURCES`), each with an `i` affordance naming the data and
      the provider per resource.
- [x] **Restrict refresh to ADMIN users.** `market-refresh` checks `app_metadata.role` on the
      verified token (never `user_metadata`, which a user can write themselves), and the button
      renders nothing for a non-admin. The client boolean decides what is OFFERED; the server check
      is the permission.
- [x] **Infinite scroll on the sector constituents list.** `onEndReached` drives it; the "Load
      more" button stays as the fallback for platforms where the scroll event does not fire.
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