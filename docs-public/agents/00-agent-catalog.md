# Agents 完整目录


> 每个 Agent = Skill(SKILL.md) + Tools 白名单 + Done Contract；由 Orchestrator 经 Job 调起 Pi session。  
> **不用** DeepSeek Harness、**不用** LangGraph。  
> **细粒度完整清单、AI 短板对策、场景 Playbook：见 [`04-fine-grained-agents-skills-tools.md`](./04-fine-grained-agents-skills-tools.md)。**  
> **短剧更深规格（Duanju*）：见 [`05-duanju-charlie-agents-skills-tools.md`](./05-duanju-charlie-agents-skills-tools.md)。**

---

## 0. 分层

| 层 | 角色 | 例子 |
|----|------|------|
| L0 Orchestrator | 主控编排、Stage 推进 | `WritingOrchestrator` |
| L1 Colleague | Grok-like 找活/组队 | `GrokColleague` |
| L2 Domain Agents | 写作业务专家 | `CoreHookAgent` 等 |
| L3 Gate Agents | 确定性/半确定性验收 | `HookPresenceGate` |
| L4 Utility | 检索、记忆、格式、计量 | `KbSearchTool` 包装 Agent |

---

## 1. 主控与同事

### 1.1 WritingOrchestrator（写作编排器）

| 项 | 内容 |
|----|------|
| 职责 | 读 `project.format` + `stage`，装配 Agent 图，调度顺序/并行，写审计事件 |
| 触发 | 用户进入创作台、点「下一步」、同事批准计划 |
| 输入 | `project_id`, `goal?`, `force_skip?` |
| 输出 | `run_plan`, `spawned_run_ids`, `stage_delta` |
| Tools | project CRUD、run spawn、memory read、prompt pack load |
| 门禁 | 格式未选禁止；预算熔断；红线包未加载禁止开写 |
| Skills | `skills/orchestrator/manju.md` 等按格式 |
| 记忆 | 读 PROJECT.md；写 run 摘要到 session memory |

### 1.2 GrokColleague（主动同事）

| 项 | 内容 |
|----|------|
| 职责 | 扫描缺口、提议任务、组队（Synthesis/Union/Ordered） |
| 触发 | 定时 / 用户打开同事页 / 项目空闲 |
| 输入 | 用户偏好、项目列表摘要 |
| 输出 | `TaskProposal[]`（风险级别、预估 token、依赖） |
| Tools | 只读扫描默认；写需 approve |
| 门禁 | 高风险（删内容、覆盖采纳稿）必须人批 |
| 多次 | 可持续提议，去重 |

---

## 2. 选题与核心梗

### 2.1 MarketBriefAgent（题材市场简报）

- 职责：根据国内/海外、男/女频输出热门方向与红黑榜摘要  
- 输入：`market`, `channel`, `kb_hotspots?`  
- 输出：`brief.md` + `recommended_genres[]`  
- 课源：11/16/17、手册  
- 可多次生成

### 2.2 CoreHookAgent（核心梗生成）★

| 项 | 内容 |
|----|------|
| 职责 | 批量生成核心梗候选 |
| 触发 | S1；用户「再来 N 个」；同事找活 |
| 输入 | 删减后题材、格式、数量、对标、偏好、禁用元素 |
| 输出 | `CoreHook[]`（title_hook/core_hook/tags/motivation/crisis/opening_structure/opening_beats） |
| Tools | prompt_render, llm_chat, kb_search(可选), save_artifact |
| Skills | `manju.core_hook`, `short.core_hook` |
| 门禁 | GenreTrimGate；SchemaGate；RedlineGate |
| 多次 | **必须**；默认 10，最大分批 100 |
| Prompt | 锁定：格式与字段定义；可变：题材列表、数量、风格 |

### 2.3 CoreHookCriticAgent（核心梗评审）

- 职责：按代入感/爽感/差异化/动机/主线打分并短评  
- 输出：`scores` + `rank` + `risk_notes`  
- 可与生成并行（先生成后评，或双模型）

### 2.4 HookComboAgent（核心梗四步组合）

- 课源：17 课四步组合法 + 元素叠加库  
- 职责：人工组合逻辑的 AI 辅助（元素拼接而非纯随机）  
- 输出：组合方案 + 解释

---

## 3. 拆书 / 参数 / 猜书

### 3.1 DissectAgent（拆书参数）

- 输出：完整参数模板（基本信息/设定/脉络/情绪曲线/人物/七步法/层级）  
- Tools：read_doc, chunk, kb_index, grep  
- 门禁：原文过短警告；超长必须分章拆  

### 3.2 GuessBookAgent（猜书/对标分析）

- 模式：综合猜 / 合并猜 / 分章猜（6 课）  
- 输出：框架、节奏、人设、情绪点、5W1H  

### 3.3 StyleExtractAgent（文风抽取）

- 先抽文风规则，再用于仿写（禁止直接丢原文硬洗，除非用户选洗稿模式）

### 3.4 TropeMineAgent（桥段挖掘）

- 从文档抽 TropeClip 入库

---

## 4. 换元 / 洗稿 / 仿写

### 4.1 SwapDiagnoseAgent（六源诊断）

- 输出六大故事源分析表

### 4.2 SwapPlanAgent（换元方案）★

- 一度 / 二度；出 ≥3 方案  
- 输出：映射表 + 理由  
- Prompt：换元法 3.0 角色规则锁定

### 4.3 SwapApplyOutlineAgent（换元改纲）

- 梗概 → 章纲 → 细纲 分步；禁止一步改完全书

### 4.4 WashDraftAgent（洗稿）

- 定基调 + 分段迭代；适合批处理  
- 门禁：必须声明「洗稿模式」；与「仅仿节奏」模式互斥提示

### 4.5 ImitateRhythmAgent（仿节奏）

- 输入对标量化：章数/字数/情节点密度；输出仿写约束包

---

## 5. 人设 / 世界观 / 金手指

### 5.1 CharacterBibleAgent（人设清单）

- 大五人格、欲望、恐惧、秘密、行为模式等  
- 输出可直接喂正文

### 5.2 CharacterSoulCheckAgent（灵魂拷问三问）

- Gate 型：情节是否符合人设

### 5.3 RelationshipNetAgent（关系网）

- 产出关系表 + 推图谱

### 5.4 WorldBibleAgent（世界观）

- 课源：12 课世界观 / 金手指

### 5.5 GoldenFingerAgent（金手指设计）

- 规则边界、升级节奏、与主线动机绑定

### 5.6 CharacterBioAgent（人物小传·漫剧）

- 时机：**大纲前**完成并人工确认（考拉流）；交稿前再校对；含外貌形象经历

---

## 6. 结构 / 期待 / 冲突 / 情绪 / 爽点

### 6.1 ExpectationDesignAgent（期待感）

- 抛钩/收钩架构；开篇核心期待

### 6.2 ConflictDesignAgent（矛盾冲突）

- 冲谁、目标、凶险、升级路径、解决方式

### 6.3 EmotionBeatAgent（情绪与以事见人）

- Show don't tell；情绪类型；导语四要点

### 6.4 PacingAgent（节奏四维 + 量化）

- 长短篇差异；女频节奏配比；缓冲剧情

### 6.5 SatisfactionPointAgent（爽点十二套路 / 马斯洛）

- 指定需求层次 + 套路生成分场

### 6.6 FaceSlapAgent（装逼打脸）

- 四前提检查 + 初/中/高阶打脸结构

### 6.7 ImmersionAuditAgent（代入感五问）

- 失真/扁平/弧线/紧迫/反派威胁

### 6.8 HookCliffAgent（钩子/伏笔）

- 拆钩子；从后往前推伏笔（16 课）

### 6.9 PursuitWifePentalogyAgent（追妻火葬场五部曲）

- 课源：8 课结构模板

---

## 7. 大纲 Agents

### 7.1 SynopsisAgent（故事梗概）

### 7.2 MasterOutlineAgent（总纲/框架）

### 7.3 VolumeOutlineAgent（卷纲）

### 7.4 ChapterOutlineAgent（章纲）

### 7.5 BeatSheetAgent（细纲/情节点）

- 用情节点个数控长

### 7.6 EpisodeOutlineAgent（分集大纲·前十集）★

- 表格+文字；爽点模型注入  
- 禁「起承转合平均分配」指令写入锁定区

### 7.7 CoolPlotExpandAgent（爽点剧情扩展）

- 核心梗必填；生成 10/20/… 套路剧情再扩写单条
- **落地状态（2026-11）**：已注册 `struct.cool_expand`，挂 `S2_COOL_BATCH`；粗纲灌池见 [`../prd/30-batch-inspiration-audit.md`](../prd/30-batch-inspiration-audit.md)

### 7.8 OutlineExtendAgent（后续大纲扩展）

- 输入：核心梗+已有大纲+案例

### 7.9 Manju100ActAgent（100 集四幕模板）

- 课源：17 课

---

## 8. 正文 / 剧本

### 8.1 EpisodeBodyAgent（分集正文）★

- 分镜+台词；字数/场景/台词上限  
- 批量队列 10 集一轮

### 8.2 ChapterBodyAgent（章节正文）

### 8.3 SceneBodyAgent（分场）

### 8.4 DialoguePolishAgent（台词优化）

- 推动情节；符合人设；口语化

### 8.5 ShotListFormatAgent（分镜格式化）

- 小说腔 → 分镜画面+台词

### 8.6 BatchWriterSupervisor（批量编写监理）

- 管理队列、衰减检测、失败重试、预算

---

## 9. 校正 / 去 AI 味 / 质检

### 9.1 LengthDecayFixAgent（字数衰减校正）

### 9.2 EpisodeEnrichAgent（单集 enrichment）

- 补情节台词；集尾悬念

### 9.3 DeAITasteAgent（去 AI 味）★

- Skill：`去ai味儿.md` V3.8  
- 锁定：不改主题走向结局；不删关键要素  
- 输出稿 + checklist

### 9.4 HumanQCChecklistAgent（人工校稿清单）

- 逻辑/AI表述/镜头/人物语言/伏笔钩子 — **生成清单，不自动宣称通过**

### 9.5 LogicHeuristicGate（逻辑启发式）

- 仅警告；需用户确认

### 9.6 RedlineGate（题材红线）

### 9.7 HookPresenceGate（集尾钩子）

### 9.8 FormatContractGate（格式合同）

- 漫剧是否分镜格式；字数区间；场景数

### 9.9 SchemaGate（结构化输出）

### 9.10 AiDetectHintAgent（AI 味提示）

- 启发式标记；不承诺过朱雀等第三方

### 9.11 FemaleLongRiskAgent（女频雷区）

### 9.12 MonetizationFitAgent（付费点/变现适配）

---

## 10. IP 改编

### 10.1 IpSelectScoreAgent（选书四指标）

### 10.2 UnitStoryCutAgent（单元故事减法）

### 10.3 EmotionQuantAgent（情绪 -10～+10）

### 10.4 RebuildBlocksAgent（搭积木重构）

### 10.5 PaywallBeatAgent（卡点设计）

### 10.6 LoglineAgent（一句话/导语）

---

## 11. 知识库侧 Agents

### 11.1 AutoTagAgent

### 11.2 ReportPipelineAgent（多报告编排）

### 11.3 GraphBuildAgent

### 11.4 KbQaAgent（库内问答）

### 11.5 HotspotIngestAgent（合规热点）

### 11.6 PushToProjectAgent

---

## 12. 工具型 / 记忆型

### 12.1 MemoryCuratorAgent

- 维护 USER.md / PROJECT.md / 日记记忆；蒸馏 skill-candidates

### 12.2 PromptSafeEditAgent

- 用户改 Prompt 时保护锁定锚点

### 12.3 ModelRouterAgent

- 按任务选 DeepSeek/MiniMax/本地等

### 12.4 WebSearchAgent（可选联网）

---

## 13. Agent × 格式矩阵（MVP 必做标 ★）

| Agent | 漫剧 | 短篇 | 短剧 | 女频长篇 | IP |
|-------|:----:|:----:|:----:|:--------:|:--:|
| CoreHook ★ | ✓ | ✓ | ✓ | ✓ | ◐ |
| Dissect ★ | ✓ | ✓ | ✓ | ✓ | ✓ |
| SwapPlan ★ | ◐ | ✓ | ◐ | ◐ | ◐ |
| EpisodeOutline ★ | ✓ | | ✓ | | ✓ |
| EpisodeBody ★ | ✓ | | ✓ | | ✓ |
| ChapterOutline/Body | | ✓ | | ✓ | |
| DeAITaste ★ | ✓ | ✓ | ✓ | ✓ | ✓ |
| CharacterBible | ✓ | ✓ | ✓ | ✓ | ✓ |
| Gates 套件 ★ | ✓ | ✓ | ✓ | ✓ | ✓ |

◐ = 可选增强

---

## 14. 每个 Agent 的统一实现合同

```ts
type AgentDef = {
  id: string
  name: string
  skillPath: string           // SKILL.md
  tools: string[]             // allowlist
  inputSchema: ZodSchema
  outputSchema: ZodSchema
  doneContract: Check[]       // gate checks
  promptTemplateId: string
  memoryScopes: Array<'user'|'project'|'session'|'kb'>
  maxTurns: number
  defaultModelProfile: 'creative'|'logic'|'polish'|'cheap'
  supportsBatch: boolean
}
```

实现时：`packages/agent-runtime` 注册表 + `skills/**/SKILL.md`，禁止把大段方法论硬编码进多个散落 prompt 字符串。
