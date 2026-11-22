# AI Commercial Writing — Always-On Personal Multi-Agents

中文版：[`README.md`](./README.md)

**Positioning**: A **visual, delivery-oriented writing workbench** for Chinese commercial platforms such as **Hongguo short drama**, **Tomato Novel**, and **Jinjiang** — helping authors turn topics, outlines, characters, and episode/chapter drafts into “shootable, submittable, polishable” first drafts, not filler prose or one-click unusable scripts. Supports one-click auto generation and always-on personal agents that assist while you edit.

**Model recommendation (read this)**: **DeepSeek only** for production writing (`deepseek-flash` day-to-day; `deepseek-v4-pro` when hard reasoning is needed). This repo’s multi-agent / multi-turn tool loops fire many model calls in a short window. **MiniMax and other vendor APIs rate-limit heavily in this scenario (429 / quota windows)** and are unsuitable as the primary writing model. Other providers can remain as failover in the gateway; docs and defaults assume DeepSeek.

| Audience | What you write | How “visual” is enforced |
|----------|----------------|--------------------------|
| **Hongguo / short drama / manhua-drama** | Core hook → bio → episode outline → scene body → submission pack | De-novelize; shootable scenes; space / action / shot language; human lens checklist |
| **Tomato / Jinjiang web fiction** | Male/female long-form & shorts: cold open, cliffhangers, pay walls, pacing | Saturated chapter outlines; visible payoff beats; platform rules still need human check |
| **Shared base** | Distilled writing-course KB; Agents / Gates / Feishu | Chunked delivery; bible consistency; Done Contract; final polish & platform judgment stay human |

Specs and agent catalog: [`docs/`](./docs/README.md). **Does not replace** editors or platform compliance review. Goal: fewer crashes, more “visual enough, on-spec” commercial first drafts.

**Design references** (principles absorbed into a writing product):

1. [Building always-on agents](https://claude.com/resources/articles/building-always-on-agents) (Anthropic / Claude) — inbox, timers, cross-run memory, permission waits, outbound delivery; agents mostly sleep and wake on events.
2. [DeepSeek Harness design article](https://zhuanlan.zhihu.com/p/2099987320443237060) (Zhihu) — skills / tools / gates / session & context engineering.

Implementation is a **custom** OpenAI-compatible tool loop + queue / scheduler / Gate (see Constraints). **No** DeepSeek Harness or LangGraph as a runtime dependency — principles only.

## Features

Local single-user workbench: Web studio first, optional Feishu IM. Not a multi-tenant SaaS. Inventory below is as complete as practical; authority remains `docs/` + code.

### Formats & pipelines

| Feature | Notes |
|---------|--------|
| **Six-format Stage graphs** | `manju`, `duanju`, `short_novel`, `male_long`, `female_long`, `ip_adapt` |
| **Stage lock / creation map** | Advance along the graph; `requiresUserAck` nodes block until confirmed; forced jumps are audited |
| **Chunked delivery** | Episode / scene / chapter units; no whole-book dumps; `chunk_policy` + length-band Gates |
| **Topic → hook → bio → outline → prose → pack** | Per-format specialist Agents + Skills + Prompt packs |
| **Visual / shootable constraints** | De-novelize; space/action/shot language; manju/duanju QC slots |
| **Web-fiction pacing** | Cold open, cliffhangers, pay points, emotional payoffs (platform rules still human) |
| **Element swap / tone-setting** | Methodology encoded (six elements, seven-step swap, etc.) via Agents/Gates, not bare prompts |
| **Batch inspiration / materials** | Hook batches, hotspot abstracts; compliance crawlers off by default |

### Multi-agent & orchestration

| Feature | Notes |
|---------|--------|
| **Agent catalog** | ~**148** registered Agents (orch / topic / structure / character / prose / QC / Charlie short-drama flow, …) |
| **Skills** | ~**137** Skills; progressive `skill_read` so prompts are not stuffed all at once |
| **Personal Agent (editor-in-chief)** | Web assistant + Feishu ingress; plan, dispatch, confirm, progress & completion announce |
| **AI colleagues / roster** | Persona-facing specialists; 1:1 or team collaboration |
| **Fleet task groups** | Up to **4** parallel colleagues; group concurrency capped by local LLM governor |
| **Subagents** | In-run `subagent_spawn` (scout / parallel split); default maxParallel **3**, depth **1** |
| **Batch writing orch** | Prefer serial enqueue (`orch.batch_writer`, etc.) over blind concurrency |
| **Gap scan / proposals** | `gap_scan` → `TaskProposal`; can push Feishu confirm cards |
| **Confirm gates** | Prose write / adopt / create Fleet can pause for human approve |

### Quality gates & Ontology

| Feature | Notes |
|---------|--------|
| **Hard Gates + Done Contract** | Agent self-claim is not done; deterministic checks issue the receipt |
| **LogicAck & human gates** | Logic review never auto-greens |
| **Writing Ontology** | Action-only writes; core types return **409** on raw Artifact write; query slices + audit log |
| **Artifact versions / CAS / adopt** | History, rollback, pending → human adopt |
| **Project snapshot / duplicate / replay** | Project-level snapshot & ops |
| **De-AI / OOC human slots** | Heuristic checks + final human judgment |

### Knowledge base & memory

| Feature | Notes |
|---------|--------|
| **Distilled KB** | `knowledge/` course distill + searchable index; Agent `kb_search` / `kb_read` |
| **KB app** | Upload TXT/MD, auto tags, book-breakdown reports, tropes, hotspots, graph, similar books, semantic search |
| **Embedded + thin shell** | In-app KB; `apps/knowledge-base` can run alone |
| **Project binding** | Bind KB docs/materials to a writing project |
| **Memory tiers** | Hot / warm / cold MemoryFile; bible slices into prompts |
| **Cross-run memory** | Project memory, Handoff, micro-compression; long jobs can resume |

### Surfaces, ops & cost

| Feature | Notes |
|---------|--------|
| **Web studio** | Projects, Stage map, artifacts, colleagues, settings, usage, Ontology panel |
| **Feishu WebSocket** | DM / group @; progress, confirm cards, completion summaries; egress-only server |
| **Local CLI `xzm`** | Stack, projects, artifacts, agents, runs, jobs, KB, export, settings, chat |
| **LLM gateway** | OpenAI-compatible; **production writing: DeepSeek only** |
| **`llm-traffic` governor** | Global concurrency 1–16; adaptive backoff on 429 |
| **Prompt-prefix cache layout** | Fixed Slots + append-only tools; target >95% hit rate within a Run |
| **Usage & activity** | Summary, dashboard, activity; per-project tokens |
| **Queue / scheduler** | Redis jobs; scheduled colleague scans; cancel / retry / watch |
| **Export** | Project export (e.g. Markdown) |
| **Prompt pack registry** | Default packs per format |
| **Optional heavy infra** | MinIO + Milvus; default Redis only with local/memory fallbacks |

### Intentionally out of scope

Third-party detectors (e.g. Zhuque), full-text platform scraping, multi-tenant SaaS, Mac/desktop packaging as a delivery path, LangGraph / DeepSeek Harness runtime.

## How we address “AI writing flaws”

See [`AI写作的缺点和问题汇总.md`](./AI写作的缺点和问题汇总.md) (Nines course framing: AI assists, does not replace judgment). **This project does not claim to fix every flaw**; it engineering-izes “use AI with fewer crashes” and amplifies the author.

| Let AI do | How |
|-----------|-----|
| Batch drafts / ideas / alternatives | Six-format Stage graphs + specialist Agents + Skills; Fleet / Subagent |
| Method-constrained generation | Distilled `knowledge/` retrieval, `kb_search` / `kb_read`, Prompt packs |
| Long jobs that resume, less amnesia | Project bible / memory, fixed Slot prefixes for cache, micro-compress / Handoff |
| Acceptable & rollback-able | Hard Gates + Done Contract; **Writing Ontology** + artifact versions / CAS; human confirm (Web / Feishu) |
| Controllable cost | Prompt-cache layout, `llm-traffic`, Flash default, resume |

| Keep human | Why |
|------------|-----|
| Topic / market bets | AI proposes; author chooses |
| Long-arc logic, emotion, foreshadow payoff | Gates catch format/local rules, not “is it good” |
| De-AI polish, dialogue craft, visual taste | QC helps; final craft is human |
| Compliance / plagiarism / platform reject | Crawl guards; third-party detectors **deliberately not built** |

One line: **nail AI to the first-draft/inspiration pipeline with agent engineering; keep judgment with Gates / memory / Ontology / human confirm.**

## Writing Ontology

An operations layer **above** Artifact / Memory / KB (Palantir Ontology-inspired). Authoritative docs: [`docs/architecture/06-writing-ontology.md`](./docs/architecture/06-writing-ontology.md), [`docs/prd/39-writing-ontology.md`](./docs/prd/39-writing-ontology.md). **Not another vector store** — the LLM may change writing state **only via validated Actions**.

| Role | Mechanism |
|------|-----------|
| **Single source of truth** | RID objects (`ri.writing.{Type}.{uuid}`) for hooks, characters, outlines, foreshadow, story graphs |
| **Only write path** | `ontology_action`; raw Artifact writes on core types → **409** |
| **Anti-amnesia / context control** | `ontology_query` (`sliceForBible` / `searchAround`) |
| **Foreshadow / expectation payoff** | Links on the story graph |
| **Human gates not bypassable** | LogicAck never auto-green; Scenario merge needs confirm |
| **Auditable** | Action Log + object versions |

Registry: `packages/ontology/ontology-registry.json`. Runtime: `services/api/app/ontology/` + `/api/v1/ontology/*`. CLI: `pnpm xzm ontology registry`.

## Quick start (HTTP local)

```bash
pnpm install
cp .env.example .env   # set DEEPSEEK_API_KEY (recommended); other vendors are failover-only / rate-limit prone

pnpm docker:up         # Redis by default
# optional heavy: pnpm docker:up:heavy

pnpm dev:api           # terminal 1
pnpm dev:worker        # terminal 2 — KB / non-agent jobs
pnpm dev:agent-worker  # terminal 3 — Node OpenAI tool loop
pnpm dev:web           # terminal 4
```

- Web: http://127.0.0.1:5173  
- API / OpenAPI: http://127.0.0.1:8000/docs  

## Feishu chat (config & server)

Feishu is the **Personal Agent IM ingress**: text in DM/group → Supervisor; progress, confirm cards, completion summaries return to Feishu. Uses **WebSocket long connection** (not a public webhook), so the server needs **egress** to Feishu; inbound ports for Feishu callbacks are usually unnecessary.

Details: [`services/feishu/README.md`](./services/feishu/README.md).

| Variable | Rule |
|----------|------|
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | Required for `pnpm dev:feishu` |
| `FEISHU_GROUP_POLICY` | `mention` (default) or `always` |
| `FEISHU_DEFAULT_CHAT_ID` | Default chat for proactive proposals |
| `DEEPSEEK_API_KEY` | Recommended model key on the server |

```bash
pnpm docker:up && pnpm dev:api && pnpm dev:worker && pnpm dev:agent-worker && pnpm dev:feishu
```

DM any text; in groups **@ the bot** by default. Commands: `/help` `/status` `/reset` `/project` `/followup`. Confirm via card buttons or reply 批准 / 拒绝.

### Switch models

Settings → AI providers → set **DeepSeek** (`deepseek-flash`) as current/default. **Do not** run MiniMax (or similar) as primary — this project’s busy Agent traffic often hits 429 / quota limits elsewhere.

## Pricing, rate limits & task cost

> **Recommended model: DeepSeek only.** Other APIs (including MiniMax) rate-limit hard under this multi-agent load; price tables for other vendors are comparison only.  
> Official docs change; excerpts below are ~2026-11 plus local token mixes (~**94% input / 6% output**). Cache hits can cut input cost ~10×. Hit rate depends on fixed Slots + append-only tools (see Prompt cache); continuous multi-turn runs can exceed **95%**.

| Vendor | Docs |
|--------|------|
| DeepSeek pricing (**recommended**) | https://api-docs.deepseek.com/quick_start/pricing/ |
| DeepSeek concurrency / rate limit | https://api-docs.deepseek.com/quick_start/rate_limit |
| MiniMax (comparison only) | https://platform.minimax.cn/docs/pricing/overview |

### DeepSeek list prices (USD / million tokens)

IDs: `deepseek-flash`, `deepseek-v4-pro`.

| Model | Window | Input (cache hit) | Input (miss) | Output |
|-------|--------|-------------------|--------------|--------|
| `deepseek-flash` | Off-peak | \$0.003 | \$0.15 | \$0.60 |
| `deepseek-flash` | Peak | \$0.006 | \$0.30 | \$1.20 |
| `deepseek-v4-pro` | Off-peak | \$0.022 | \$0.66 | \$1.98 |
| `deepseek-v4-pro` | Peak | \$0.044 | \$1.32 | \$3.96 |

Peak windows (UTC, weekdays excluding PRC holidays): `01:00–04:00`, `06:00–10:00`; otherwise off-peak (half price). Account concurrency: flash **2500**, pro **500** (HTTP 429 when exceeded).

### MiniMax & other APIs (not recommended as primary)

Free tier ~**20 RPM** can be exhausted by this project alone; paid ~**200 RPM** can still 429 under continuous Agent traffic / quota windows. **Do not** use as the default writing model.

Local governor: `pnpm xzm settings llm-traffic` / Web Settings. Prefer caps under DeepSeek (next section).

### Concurrency & Subagents

| Kind | What | Typical use | Cap (current) |
|------|------|-------------|----------------|
| **`llm-traffic`** | Global in-flight LLM requests | All PA / Agents / Fleet / children share one gate | **1–16** |
| **Fleet** | Parallel colleague Runs | “Three writers side by side” | ≤**4** members |
| **Subagents** | Tools inside one Run | Scout / parallel sub-questions | maxParallel **3**, depth **1** |

**Single-user recommendations**

| Model | `llm-traffic` | Fleet | Subagent | Notes |
|-------|---------------|-------|----------|-------|
| **DeepSeek Flash (recommended)** | **6–8** | **4** | keep **3** | Only recommended production path |
| Local Ollama smoke | **1–2** | **1** | **1–2** | Dev only |
| MiniMax / other cloud | **Not recommended**; if temporary **≤2** | **≤2** | **≤3** | RPM/quota limits; more concurrency → more 429 |

Do not open the local gate to DeepSeek’s advertised 2500 concurrency: single-user peak is roughly Fleet≤4 + PA — **~8 saturates**.

### Rough task costs (local tokens × list price, no-cache pessimistic)

| Scenario | ~tokens | DeepSeek Flash peak | DeepSeek Flash off-peak | (ref) MiniMax M3.1-Flash |
|----------|---------|---------------------|-------------------------|-------------------------|
| Manju: hotspot→hook→bio→outline→episodes (~2.7M measured) | 2.7M | **~\$0.95** | ~\$0.47 | ~¥3.2 |
| + first 10 episode bodies (est.) | ~3.9M | ~\$1.4 | ~\$0.7 | ~¥4.5 |
| Full manju to 10 eps + orch +20% rework | ~5.0M | **~\$1.8** | ~\$0.9 | ~¥5.9 |
| Short novel 2 chapters (measured) | 2.6M | ~\$0.9 | ~\$0.5 | ~¥3.1 |
| Short-drama multi-agent 4-step (measured) | 1.6M | ~\$0.55 | ~\$0.27 | ~¥1.8 |
| Fleet one small round | 150–400k | ~\$0.05–\$0.15 | lower | ~¥0.2–¥0.5 |
| PA heavy re-plan | 500k–1M+ | ~\$0.2–\$0.4 | lower | ~¥0.6–¥1.2 |

`deepseek-v4-pro` ≈ **~4×** Flash. Exact bills: `pnpm xzm usage summary`.

### Prompt cache (high hit-rate context)

Most spend is repeated system/tool prefixes. Layout targets **>95%** hit rate within a Run (DeepSeek `prompt_cache_hit_tokens`, etc.). Fixed Slot order; Slot 1–4 `staticPrefixHash` stable; tools **append-only**. Measured layout (2026-11-17): turn 1 ~4.5K miss → turn 6 ~83K with ~82K hits. Same layout applies to DeepSeek; **still recommend DeepSeek only for writing**. See [`docs/agents/13-context-engineering-and-reliability-notes.md`](./docs/agents/13-context-engineering-and-reliability-notes.md).

### How to save money

1. Write with **DeepSeek Flash** only; other cloud APIs rate-limit and are not recommended.  
2. Batch off-peak on DeepSeek when possible.  
3. Keep system/tool prefixes stable; prefer same-session resume.  
4. Cap `llm-traffic` at **6–8** on DeepSeek; drop to 2–3 if you must use a limited API.  
5. Avoid Gate thrash / repeated `artifact_create` / full restarts — resume Runs.  
6. Fleet ≤4; Subagent parallel ~3; keep PA chats purposeful.  
7. Small chunks; hard length bands.  
8. Ollama for smoke tests only.

## Agent path

`agent.*` jobs are consumed by **Node agent-worker** (`jobs:agent`). Python job-worker handles KB / crawl / usage only.

```bash
docker compose --profile app up -d --build   # optional app containers after infra
```

## Layout

| Path | Role |
|------|------|
| `apps/ai-writing` | Main Web app |
| `apps/knowledge-base` | Thin KB shell |
| `apps/desktop` | Legacy Tauri; **not a delivery path** |
| `packages/domain` | Shared types / Zod / Gate |
| `packages/ontology` | Writing Ontology registry |
| `packages/agent-runtime` | Agents / Skills / Stage graphs (**Gate/Skill source of truth**) |
| `packages/prompt-registry` | Prompt packs |
| `services/api` | FastAPI |
| `services/agent-worker` | Node Agent loop + Tools |
| `services/job-worker` | KB / crawl / vectors |
| `services/feishu` | Feishu WS (optional) |
| `services/scheduler` | Timed colleague scans, etc. |

## Constraints

- Delivery = **local Web** + **optional server Feishu**; no Mac/desktop packaging / sidecar as the product path  
- Agent **executor** = Node `services/agent-worker` (custom OpenAI-compatible tool loop)  
- Orch / Gate / gateway / queue / timer = **custom**; no LangGraph / DeepSeek Harness  
- Gate / Skill catalog truth = `packages/agent-runtime` (TS)  
- See `docs/AI_CODING_RULES.md`

## Common commands

```bash
pnpm docker:up | docker:up:heavy
pnpm sync:catalogs
pnpm check:stage-graphs
pnpm typecheck
pnpm test:agent-runtime
pnpm build
pnpm test:api
```

## Local CLI (`xzm`)

```bash
pnpm install && pnpm dev:cli
pnpm xzm --help

pnpm xzm stack up [--web] [--feishu] [--scheduler] [--heavy]
pnpm xzm projects list|create|…
pnpm xzm artifacts list|adopt|rollback -p <pid>
pnpm xzm agents list|fleet …
pnpm xzm run <agentId> -p <pid> [--stream]
pnpm xzm runs get|steer|replay <runId>
pnpm xzm kb search|docs|…
pnpm xzm chat [--new] "…"
pnpm xzm usage summary
pnpm xzm settings llm-traffic
```

Config: `XZM_API_BASE` (default `http://127.0.0.1:8000`) or `.xzmrc.json`. Logs/PIDs under `.xzm/`.

Done Contract counts artifacts created in the **current** Run (plus explicit same-project `reuseArtifactIds`). `orch.writing` / `orch.batch_writer` may aggregate persisted child successes; ordinary specialist Agents do not aggregate other Runs’ artifacts.

## Tip the author / contact

If this project helps you, please **tip / sponsor the author** via the payment QR codes below. You can also add WeChat or follow the official account.

| Alipay tip | WeChat Pay tip |
|:---:|:---:|
| ![Alipay](./docs/assets/sponsor/alipay.jpg) | ![WeChat Pay](./docs/assets/sponsor/wechat-pay.jpg) |

| Add WeChat friend | WeChat official account |
|:---:|:---:|
| ![WeChat friend](./docs/assets/sponsor/wechat-friend.jpg) | ![Official account](./docs/assets/sponsor/wechat-official.jpg) |

> Source images also live under [`output/playwright/pictures/`](./output/playwright/pictures/). README links use the stable path `docs/assets/sponsor/`.
