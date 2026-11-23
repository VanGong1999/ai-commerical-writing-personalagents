# 课程 → Agent / Skill 映射

细粒度以 [`04-fine-grained-agents-skills-tools.md`](./04-fine-grained-agents-skills-tools.md) 为准；短剧更深见 [`05-duanju-charlie-agents-skills-tools.md`](./05-duanju-charlie-agents-skills-tools.md)。  
「AI 批量出候选、人筛选」落地对照见 [`../prd/30-batch-inspiration-audit.md`](../prd/30-batch-inspiration-audit.md)。

---

## 一、九格 Nines AI 写作训练营

| 课次/资料 | 主题 | 主要 Agents / Skills |
|-----------|------|---------------------|
| 1.md | 开营心态 | 产品文案 |
| 2.md | 提示词、工作流、拆书、核心梗、七步法 | `prompt.safe_edit`, `dissect.*`, `topic.core_hook_batch`, `struct.beat_sheet`, Skill `prompt-4part` |
| 3.md / 换元法 | 洗稿定基调、六元素、一度/二度七步、节奏量化、情绪上下行、质检优先级 | `swap.*`, `imitate.wash`, `qc.similarity`, `qc.de_ai`；领域见 `nines-workflow` + PRD `14-lesson3-business-logic.md` |
| 4.md | 期待感、冲突（1+3 / 六要素 / 爽点反推 / AI 筛选分） | `struct.expectation`, `struct.conflict`, `hook.*`；领域见 `nines-workflow` + PRD `15-lesson4-business-logic.md` |
| 5.md | 情绪节奏 | Skill show-dont-tell；情绪曲线 |
| 6/7.md | 爽点打脸代入感 | `struct.face_slap`, `struct.cool12`, `qc.immersion` |
| 8.md | 灵感、追妻、人设、换元 | `topic.*`, `char.*`, chase-wife skill |
| 9.md | 短篇选题 | `topic.market_brief`, `topic.hook_critic` |
| 10.md | 人设 | `char.bible_big5`, `char.soul_check` |
| 11–12,16–17 + 手册 + ai漫剧流程 | 漫剧全流 | `topic.core_hook_batch`, `struct.episode_outline`, `prose.*`, `qc.de_ai` |
| 13.md | IP 改编 | `ip.*` |
| 14–15.md | 女频长篇 | `struct.female_pace`, `female.*` |
| 去ai味儿.md | V3.8 | `qc.de_ai`, Skill `de-ai-v3.8` |

---

## 二、查理短剧编剧课 · 爆款短剧创作流程

| 课次 | 主题 | 主要 Agents / Skills |
|------|------|---------------------|
| 1.1–1.4 | 市场/运营/付费/变现思维 | `biz.product_align`, Skill `decompress-first`, `three-principles` |
| 2.1 | 选题逻辑 | `topic.formula` |
| 2.2 | 五大爽点 | `topic.cool_point_5` |
| 2.3 | 共鸣 | `topic.resonance_yy` |
| 2.4 | 五种故事模板 | `topic.story_shell`, `PuzzleShellGate` |
| 3.1 | 人物 | `char.mini_bio`, `char.empathy_3` |
| 3.2 | 二十节拍 | `struct.beat20` |
| 3.3 | 场 | `scene.triple`, `SceneTripleGate` |
| 3.4 | 台词 | `prose.dialogue_formula`, Skill `attitude-info-subtext` |
| 3.5 | 预期管理 | `hook.suspense_design`（一加一） |
| 3.6 | 八桥段 | `struct.bridge8`, `struct.witness_amp` |
| 3.7 | 修改20法则 | `qc.revise20`, `qc.gender_path`, Skill `revise-20` |
| 3.8 | AI 效率一 | Skills `ai-collab/*` 四法 |
| 4.1 | 规格规范 | `deliver.spec8`, `deliver.submission_pack` |
| 4.2 | 审查尺度 | `qc.redline`, Skill `redline-cn` |
| 4.3–4.4 | 接活/趋势 | `deliver.contract_notes`；市场 brief |
| 5.1 | 选题指导 | `topic.account_tier`, `topic.pitch_deck` |
| 5.2 | 最新注意 | 付费明确爽点；悬疑八步可挂 `hook.*` |
| 5.3 | 男频拉片 | `dissect.pull_male` |
| 5.4 | 女频拉片 | `dissect.pull_female` |
| 6.1 | 市场动向 | `topic.market_brief` |
| 6.2 | 解放天性 | 创作心理提示（非强制 Agent） |
| 6.3 | 三角+开场 | `scene.triangle`, `scene.opening8` |
| 6.4 | 转折 | `struct.midpoint` |
| 6.5 | 喜剧 | `scene.comedy` |
| 6.6 | 章回体 | `struct.unit_arc` |
| 6.7 | AI 效率二 | `scene.solution_fanout`, `scene.expand_ladder`, `scene.visualize`, `prose.dialogue_voice` |
| 6.8 | 爽剧公式 | `topic.want_how`, `GoldFingerMinimalGate` |

---

## 三、其他课程（补充映射）

> 细拆与吸收程度见 [`07-course-ingestion-gap-report.md`](./07-course-ingestion-gap-report.md)。主链 Agents 以 [`registry.ts`](../../packages/agent-runtime/src/registry.ts) / [`09-remaining-closed.md`](./09-remaining-closed.md) 为准（≈104）。下列为补充课程映射；**未 1:1 全量注册者按别名/合并声明**，非「多数未注册」。

### 3.1 查理老师的十五步写一个好故事

| 主题 | 主要 Agents / Skills（规划） |
|------|------------------------------|
| 故事十五步骨架 | 对照 `struct.beat20`；新增 Skill `story-15-steps`（与 20 节拍对照表） |
| 好故事判定 | `qc.logic_heuristic` + 人工 LogicAck |

### 3.2 查理老师的编剧孵化营 / 短视频商业训练营

| 主题 | 主要 Agents / Skills（规划） |
|------|------------------------------|
| 孵化营选题/改稿节奏 | `topic.formula`、`qc.revise20`、人工卡点 |
| 短视频投放与线索 | `clip_candidate_extract`、运营 brief（并入 `topic.market_brief`） |

### 3.3 知乎-短篇创作营

| 主题 | 主要 Agents / Skills（规划） |
|------|------------------------------|
| 短篇结构 / 开篇 / 一波三折 | `struct.beat_sheet`、`scene.opening*`、short_novel Prompt pack |
| 商业带货模板 / 风险规避 | 运营模块 + `qc.redline` |
| 运营与变现 / 全媒体 | 非正文主链；知识库主题桶「运营变现」 |
| AI 创作专题 | `ai_collab/*` Skills |

### 3.4 馒头商学院哈佛故事课

| 主题 | 主要 Agents / Skills（规划） |
|------|------------------------------|
| 故事原理 / 人物欲望 | 知识库原理层；可增强 `char.soul_check`、`struct.expectation` |

### 3.5 狂更猫 / 小说零基础 / 0基础实战课

| 主题 | 主要 Agents / Skills |
|------|----------------------|
| 男频长篇引擎（顺序闸/五段简介/主线≠核心/不卡文十条/循环倒推/搭台子/里程碑） | 领域 `MaleLongEngineWorkflow` + UI `KgmMaleLongPanels`；`male.opening` / `male.upgrade_loop` / `male.gold_finger` / `male.risk`；PRD [`../prd/31-kuanggengmao-male-long-deepen.md`](../prd/31-kuanggengmao-male-long-deepen.md) |
| 女频四换三（挂 Depth） | `FemaleLongDepth.fourSwapThree` → `swap.master` / `swap.plan` |
| 日更节奏、信息差期待 | `hook.suspense_design`、LengthDecay；里程碑人工勾选（不接番茄 API） |
| 总纲 / 细纲 / 开篇吸引力 | `struct.master_outline`、`struct.beat_sheet`、`male.opening` |
| 爽点 / 金手指 / 卡文 | `male.cool_density`、`male.gold_finger`、`stuck_at_step`→`male.upgrade_loop`、`scene.solution_fanout` |

### 3.6 红娘子 / 迷蒙 / 北大故事变现等

| 课程 | 挂钩 |
|------|------|
| 红娘子 | `female.*`、拉扯感、女频雷区 |
| 迷蒙 | 待主题抽取后进 knowledge |
| 北大博士故事变现 | 首页变现路径文案、`biz.product_align` 补充 |

---

## 四、双课叠加的「必做差异化」

短剧交付：**Revise20 + GenderPath + Beat20 + SceneTriple + LogicAck**  
漫剧交付：**CoreHook 批量筛选 + DeAI + HookPresence + FormatContract**  
全能卡点：**SolutionFanout + Visualize + DialogueVoice**（查理 AI 课）  
全能防崩：**ChunkPolicy + BibleGuard + 人工采纳位**（九格）
