# TODOs

## Stock Evaluation (https://muffin.rafiki.guru/agents/stock_evaluation?threadId=019f2424-affe-7fb0-90dc-0afc0ff80c72)
- [ ] Rename stock evaluation and add "modes", based on mode change system prompt
- [ ] When agent is in progress it says "working" with a loader. Maybe it makes sense to display there what it's doing with a loader instead of displaying it as separate block at the top of the page?
- [ ] When I clock verbose I see couple extra "Execute". Is it all difference expected? Please adjust message that changes when user switches between "Summary" and "Verbose".
- [ ] I would like to see summary stats on tool execution for full run on the page with list of all tool runs and success/failed count per each tool. Once clicked I want to see used inputs, collected outputs (where visualisation makes sense - think on custom components to render them nicely) and error list if failed.

## Criteria analysis (https://muffin.rafiki.guru/agents/criteria_analysis?threadId=019f270c-91eb-7420-941d-cbaac3c6b6c7) overall page looks great, but:
- [ ] Criteria analysis graph works weirdly. It looks like it doesn't take inputs I provide from the page
- [ ] For each criterion i see evidence and raw reasoning, but i don't see sub steps (data collected, tools used, attempted data collections and failed, etc). As a user i want to be able to see it, maybe in a view of timeline (the same as plan/todo list we have for the agents), by default it should be collapsed. 
- [ ] Raw reasoning looks weird, it looks like one of messages, but doesn't fill like something that makes sense. I guess we lack other important information from the evaluation run.
- [ ] Sub-criteria looks weird for "iPhone ASP Stability/Decline". I'm not sure what it tries to show, maybe we lack some details there as well.
- [ ] I would like to see summary stats on tool execution for full run on the page with list of all tool runs and success/failed count per each tool. Once clicked I want to see used inputs, collected outputs (where visualisation makes sense - think on custom components to render them nicely) and error list if failed.

## On Trading decision page (e.g. https://muffin.rafiki.guru/agents/trading_decision?threadId=019f2328-3016-74a1-ab7e-293d648d7af9):
- [x] **[DONE 2026-07-14, muffin-agent #117 + muffin-ui M16]** Sub-agents rendered as plain text while there's json — both debates (bull/bear + risk) are now real `multi_agent` conference subgraphs, discovered as sub-agent rows and rendered as chat-bubble conversations (`detail: 'debate'`); AI message bodies that are raw JSON now render via `JsonBlock` (mirrors the chat-agent renderers). Sub-steps: each analyst sub-agent row shows its `tool_runs` (inputs/outputs/errors); full intermediate transcripts are not persisted backend-side (deferred — muffin-ui ROADMAP M16).
- [x] **[DONE 2026-07-14, muffin-agent #117 + muffin-ui M16]** Risk debate empty — the risk stage now maps to `risk_debate_messages` with a debate renderer; expanding it shows the 3 debater turns. (Verified on a fresh MSFT run: "Risk debate · 3 turns".) The bull/bear debate was previously NOT a subgraph so it had no sub-agent row at all — migrating it onto the conference framework gives it a symmetric `investment_debate` row.
- [x] **[DONE 2026-07-14, muffin-ui M16]** Debaters collapsed by default — `DebateView` is now a standard `Collapsible` (Card + title + "N turns"), collapsed until tapped.
- [x] **[DONE 2026-07-14]** Tool execution summary stats — the panel was already mounted; it now populates for trading runs (backend `tool_runs` capture, muffin-agent #108). Verified on a fresh MSFT run: "Tool execution · 65 calls · 23 failed". Old threads predating capture show an explanatory empty-state hint.
- [x] **[FIXED 2026-07-14, muffin-agent #117]** BUG found while investigating: the bull/bear debate turns were exactly duplicated (2 → 4) because the risk-debate conference subgraph (running after the investment debate) echoed the shared `operator.add` debate channels back through write-back, and the parent re-applied the reducer. Fixed by adding `output_schema=` to `build_conference_graph` and restricting both trading conferences to their own channels. Verified on a fresh run: `investment_debate_messages` = exactly 2 turns, no duplicates.

## On council page (https://muffin.rafiki.guru/agents/council?threadId=019f22ac-0182-7db0-bea2-83930b1183db): 
- [x] **[DONE 2026-07-12, muffin-ui M15]** I don't see specialists as icons, only as subagents at the bottom. I would like to see them in the same way as personas — specialists now sit in the arena grid with their own icons/animations; the bottom panel remains only as a fallback for unknown future nodes.
- [x] **[DONE 2026-07-12, muffin-ui M15]** Neither persona output nor specialist output looks useful… — new unified `MemberDetail` card for personas AND specialists: step timeline (collect → compute → verdict), reasoning as markdown, typed evidence via structured renderer, "Data collected" (per-member tool runs, cache-joined to full payloads), live transcript while streaming. Remaining gap: `technicals`/`sentiment` fetch via `cached_invoke` which bypasses capture — they show evidence but no tool list (muffin-ui ROADMAP backlog).
- [x] **[DONE 2026-07-12]** I would like to see summary stats on tool execution (the same as for Criteria Analysis) — the panel was already mounted; the backend now captures council tool_runs (muffin-agent #109 personas, #116 ReAct specialists), verified on a fresh run ("58 calls · 6 failed"). Old threads (like the one linked above) predate capture and show an explanatory empty state.

## Backend
- [ ] **Add tool telemetry for other graphs as added for criteria analysis**
- [ ] **Connect Ollama cloud as alternative provider for open router. Use Ollama Cloud as main model and openrouter as fallback. For Ollama Cloud we should have separate `llm_requests_per_second`, it should be provider specific and `llm_requests_per_second=0.3` is only for open router.**
- [ ] Setup Supabase realtime to send notfications when workflow is finished to user.
- [ ] Setup edge functions (with Deno) as endpoints for UI data (e.g. user wealth CRUD, country list, etc)


## Testing
- [ ] Check if all of features documented in README work
- [ ] I now have chart component, but i don't see it rendered anywhere.
- [ ] I don't see data gathered panel anywhere, is it rendered?

## CI/CD
- [ ] setup dependabot, branch protection, codeql, etc for other repos as it's setup for muffin-agent

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
- [ ] **Can we maybe instead of relying on setting something in metadata to define how to render runs use graph_id that is returned from langgraph api, i guess it's set by langgraph, so reliable, isn't it?** — Partly addressed (2026-07): the run views now derive stage/sub-agent structure from protocol-v2 `subgraphsByNode` discovery (node names from the graph itself) rather than metadata; `graph_id` is still used only for screen selection in the registry.
- [ ] How can i have in langfuse traces grouped by thread_id?

## Other P1
- [ ] Improve OpenBB MCP to cache results there. OpenBB MCP: extend server to cache data there instead of within agents.
- [ ] Develop point in time analysis
- [ ] AI wizard to which you can upload screenshots, receipts, PDFs and some text and it will fill the data in the system automatically (portfolio, holdings, etc)
- [ ] Add currency to settings
- [ ] Double check authorization rules to make sure users can't delete/amend something that they haven't created (e.g. store). And can't read memories that are not their. 

## Other P2
- [ ] Add new tab to donate to Ukraine with links to different funds
- [ ] Create agent similiar to criteria analysis, but for hypothesis analysis. The idea is that we firstly define multiple hypothesis and then define which data is needed to compute it's probability -> collect the data and define how probable it is.
- [ ] Features: Allow user to provide Google credentials and create for them Google sheets with stocks, calculations, retirement plan and/or other financial goals. Later add agents for tracking of expenses, projecting budgets, calculating mortgage, ISA, SIPP, etc. Check MCP servers for this. Potentially grant agent access to mcp to so stock related calculations in there (row per agent or row per stock with current price, project price, indicators, signals, column per agent, etc) and/or generate docs with detailed analysis
- [ ] Sectors: AI infrastructure (data centres), cyber security