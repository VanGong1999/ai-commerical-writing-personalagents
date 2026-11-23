# 功能补全与拆解 — 九格 Nines 方法论全景映射

> 目标：把 `写作课程录音稿1/九格智能Nines ai写作训练营/` 的全部有效方法论，
> 拆到「可直接生成页面 / API / Agent / Gate」的粒度，作为前端重设计与后端实现的唯一依据。
> 本文是 `00/01/02` 三份 PRD 的**补全版**：标注「现状已覆盖 / 新增 / 待细化」三类。  
> **AI 批量候选 vs 素材积累**专项审计见 [`30-batch-inspiration-audit.md`](./30-batch-inspiration-audit.md)（核心梗×10 已落实；爽点剧情池 / 百量级 fanout / 集尾钩多备选仍缺）。

---

## 0. 方法论源清单

| 源 | 内容 | 用途 |
|----|------|------|
| `1.md` | 开营：变现路径 / 单元故事 / 题材分层 / 拆书+换元总纲 | 产品定位、用户分层、首页引导 |
| `2.md` | 基础一：任务拆解 / 规则+指令 / 拆书参数 / 核心梗 vs 情节卡 / 七步法 | 核心创作台、Prompt 结构、拆书报告 |
| `3.md` | 基础二：洗稿/仿写/融梗/改编谱系 / 定基调 / 换元一度二度 | 换元工作台、相似度风险 |
| `4.md` | 期待感 / 冲突升级 / 情绪节奏 | 期待冲突引擎、卡点 |
| `5.md` | 情绪：Show don't tell / 以事见人 / 爽虐公式 / 节奏四维度 | 情绪曲线、文笔质检 |
| `6.md` | 爽点十二套路 / 装逼打脸 / 代入感五问 / 文字表现力 | 爽点引擎、代入感 Gate |
| `7.md` | 爽点五类型 / 三阶打脸 / 代入感 / 文字表现力（0131 期） | 同上，作为复用校验 |
| `8.md` | 灵感四层级 / 故事线 / 核心事件反推 / 追妻火葬场五部曲 / 人设七步法 / 情节三要素 / 商品思维 | 灵感工作台、人设工作台 |
| `9.md` | 商业化短篇选题 / 扒榜与受众 / 导语与 11–13 情节 / 处刑改稿（画面五觉标点） | 选题工作台、改稿 QC |
| `10.md` | 大五人格 / 欲望恐惧秘密 / 人设清单 / 灵魂三问 / 短篇手搓十二步 | 人设深度工作台、改稿工作台 |
| `11.md` | 漫剧基础：差异 / 制作公司需求 / 字数 / 题材红黑榜 / 100 字测试 / 剧本格式 / 大纲 / 台词 / 投稿规范 | 漫剧创作台全流程 |
| `12.md` | 加餐：故事梗五要素 / 金手指 / 世界观 / 主角团 / 升级流·反套路·后悔流 / 数据判断 | 设定工作台、题材判断 |
| `13.md` | IP 改编：选书四指标 / 减法 / 情绪量化 / 搭积木 / 单集节奏 / 卡点付费点 / 导语公式 | IpAdaptWorkbench（≠漫剧四件套） |
| `14.md` | 女频中长篇上半：选题赛道 / 人设四技巧 / 主副线架构 / 留存节点 / 八类写前报告 | FemaleLongDepthWorkbench |
| （考拉漫剧12步） | 见 `11.md`+`12.md` 与 ManjuPipeline/GenreTrack | 漫剧 Stage |
| `15.md` | 女频长篇下半：节奏曲线/情绪/细节/雷区/变现/连载监控 | FemaleLongDepth.paceDepth |
| `16.md` | 漫剧小灶：考拉十二步/滚动交稿/五维铁律（≠男频长篇） | ManjuPipeline 深化 |
| `17.md` | 漫剧进阶二：四步组合法 / 100 集四幕结构 / 开场结尾钩子 / 桥段练习 / 题材红线 | ManjuAdvanced + Act100Workbench |
| `文件资料/AI漫剧实操手册（提示词）.md` | 核心梗提示词模板 / 卡点类型大全 / 爽点维度 | Prompt 包、卡点库 |
| `文件资料/换元法.txt` + `去ai味儿.md` | 换元 / 去 AI 味 V3.8 | 换元、去 AI 味 |

---

## 1. 创作生命周期全景（按九格方法论）

```
变现路径认知（1课）
  → 题材选择 + 分层（1/11/12/17课）
  → 灵感捕捉（8课四层级）
  → 选题 / 核心梗（2/11/12/17课，实操手册）
  → 拆书对标（2/8课）
  → 换元仿写（3/8课）
  → 设定（12课：故事梗/金手指/世界观/主角团）
  → 人设（8/9/10课：七步法/大五人格/欲望恐惧秘密/关系网）
  → 结构（2/8/11/12/17课：总纲/卷纲/章纲/细纲/集纲/100集四幕）
  → 爽点·情绪·冲突·期待（4/5/6/7课）
  → 正文（11课剧本格式/台词）
  → 质检·去AI味·人工校稿（5/6/9/11课，去ai味儿.md）
  → 投稿交稿（11/13课：格式/信息表/导语）
  → 数据复盘（12课：点击/评论/收藏）
```

---

## 2. 功能全景矩阵

### 图例
- ✅ = 文档已覆盖、前端已有骨架
- 🟡 = 文档已覆盖、前端缺失或极简
- ❌ = 文档与前端都缺（本文新增）

| 模块 | 能力 | 状态 | 前端落点 | 关键 Agent/Skill/Gate |
|------|------|------|----------|----------------------|
| 首页 | 产品定位 + 题材 CTA | ✅ | `/` | — |
| 首页 | 继续创作 / 最近项目 | ✅ | `/` | — |
| 首页 | **创作地图（全流程可视化）** | ✅ | `/` WorkflowMap 五阶段+闸标 | — |
| 首页 | **今日目标 / 小而具体任务（1课）** | ✅ | `/` 顶部 | mem.curator |
| 灵感 | 灵感四层级（8课） | ✅ | `/inspiration` | inspiration.* |
| 灵感 | 故事线出发路径 | ✅ | `/inspiration` | inspiration.* |
| 灵感 | 核心事件反推（8课） | ✅ | `/inspiration` | inspiration.* |
| 灵感 | 情节三要素拆解（8课） | ✅ | `/inspiration` | inspiration.* |
| 灵感 | 商品思维校验（8课） | ✅ | `/inspiration` | TopicFormulaGate |
| 选题 | 核心梗批量 + 筛选评分 | ✅ | `/studio/manju` | CoreHookBatchAgent |
| 选题 | **100 字测试（11课）** | ✅ | Stage `S2_LOGLINE_100` + Logline100Ack | hook_100word_check |
| 选题 | **题材红黑榜（11/12课）** | ✅ | 新建项目 + 灵感页 | GenreTrimGate |
| 选题 | **数据判断（收藏标准，12课）** | ✅ | AnalyticsPanel / 灵感候选分 | topic.score / analytics.review |
| 选题 | **升级流/反套路/后悔流模板（12课）** | ✅ | Inspiration SHELLS + ManjuGenreTrack | manju_genre_track（≠ topic.story_shell 短剧四壳） |
| 拆书 | 上传 / 解析 / 标签 | ✅ | `/kb` | kb.auto_tag |
| 拆书 | 拆书参数报告（2课） | ✅ | `/kb/docs/:id` | kb.report_pipeline |
| 拆书 | **单元故事拆解（2/13课）** | ✅ | `/kb/docs/:id` 报告 Tab | kb.unit_cut |
| 拆书 | **七步法报告（2课）** | ✅ | `/kb/docs/:id` 报告 Tab | kb.seven_steps |
| 拆书 | **核心梗提取报告（2课）** | ✅ | `/kb/docs/:id` 报告 Tab | kb.core_hook_extract |
| 拆书 | **情绪曲线报告（5/13课）** | ✅ | 报告页 | kb.emotion_quant |
| 拆书 | **爽点/虐点分布报告（6/7课）** | ✅ | `/kb/docs/:id` 报告 Tab | kb.cool_point_map |
| 拆书 | **期待感/钩子报告（4课）** | ✅ | `/kb/docs/:id` 报告 Tab | kb.hook_map |
| 拆书 | **文风要素报告（抽文风不抄内容）** | ✅ | `/kb/docs/:id` 报告 Tab | kb.style_extract |
| 拆书 | **风险红线报告（15/17课）** | ✅ | 报告页 redline_report | kb.report_pipeline |
| 拆书 | **对标差距报告（对比爆款）** | ✅ | `/kb/docs/:id` 报告 Tab | kb.gap_report |
| 换元 | 一度/二度换元（3/8课） | ✅ | `/kb/docs/:id` 换元 Tab | swap.master |
| 换元 | **映射表（事件/人物/道具置换）** | ✅ | `/kb/docs/:id` 换元 Tab | swap.map |
| 换元 | **洗稿 vs 仿写边界提示** | ✅ | 换元面板 Similarity 估算+阻断 | SimilarityRiskGate / qc.similarity |
| 设定 | 故事梗五要素（12课） | ✅ | `/studio/*/setting` | synopsis.* |
| 设定 | 金手指三大要求/四大类型（12课） | ✅ | SettingWorkbench 金手指 Tab | topic.world_setting / male.gold_finger |
| 设定 | 世界观（12课） | ✅ | SettingWorkbench 世界观 Tab | topic.world_setting |
| 设定 | 主角团/开头情绪（12课） | ✅ | SettingWorkbench 开头情绪 Tab | topic.world_setting |
| 人设 | 七步法（8课） | ✅ | SevenStepCharWorkbench | char.seven_step |
| 人设 | 大五人格 + 欲望恐惧秘密（10课） | ✅ | 人设深度台 / bible_big5 | char.bible_big5 |
| 人设 | 人物关系网（8/10课） | ✅ | 图谱 / L8 关系网 | graph.build |
| 人设 | **女频情节扩展（误会梗/英雄救美，8课）** | ✅ | FemaleLongWorkbench + 灵感模板 | female.plot_expand |
| 人设 | **拉扯感训练（8课）** | ✅ | 女频工作台 `female.tension` | tension.train |
| 结构 | 总纲/卷纲/章纲/细纲/集纲 | ✅ | `/studio/*/outline` | outline.* |
| 结构 | **100 集四幕结构（17课）** | ✅ | Act100Panel + `struct.act100_manju` | manju.100_acts |
| 结构 | **20 节拍（短剧）** | ✅ | Beat20Workbench（duanju；未挂 ip_adapt） | struct.beat20 |
| 结构 | **IP 单集节奏/情绪卡点（13课）** | ✅ | IpAdaptWorkbench EpisodeRhythmLite | ip.* + AdaptPitchPack |
| 结构 | **追妻火葬场五部曲（8课）** | ✅ | 女频工作台 `struct.chase_wife` | chase_wife_pentalogy |
| 爽点 | 爽点十二套路 / 五类型（6/7课） | ✅ | CoolPointWorkbench | struct.cool12 / topic.cool_point_5 |
| 爽点 | 装逼打脸四前提 + 三阶打脸 | ✅ | 质检面板 | face_slap_tiers |
| 爽点 | 代入感五问（6课） | ✅ | 质检面板 | qc.immersion |
| 情绪 | 以事见人 / Show don't tell | ✅ | 质检面板 | qc.show_dont_tell |
| 情绪 | 情绪曲线 -10~+10 | ✅ | 情绪面板 | emotion_curve |
| 冲突 | 期待感 / 冲突升级（4课） | ✅ | 伏笔面板 | expectation_1plus3 |
| 正文 | 分镜 + 台词（11课） | ✅ | `/studio/*/manuscript` | manuscript.* |
| 正文 | **台词设计方法论（态度/信息/潜台词）** | ✅ | DialogueTripleWorkbench | prose.dialogue_formula |
| 正文 | **字数衰减校正（14课）** | ✅ | Worker 硬停 cancel jobs + `prose.length_decay_fix` | length_decay |
| 质检 | 去 AI 味 V3.8 | ✅ | 质检面板 | qc.de_ai |
| 质检 | 人工校稿清单 | ✅ | 质检面板 | qc.human_checklist |
| 质检 | **手搓修改流（9/10课）** | ✅ | S10 十二检 + LogicAck | revise.* / gates/logic-ack |
| 质检 | **AI 质检反问（8课）** | ✅ | `qc.ai_self_question` Skill | qc.ai_question |
| 交付 | 投稿四件套 / 交稿包 | ✅ | PitchFourPackPanel + `deliver.pitch_pack` | deliver.submission_pack |
| 交付 | **投稿规范 + 信息表（11课）** | ✅ | PitchSpecWorkbench | deliver.pitch_pack |
| 交付 | **导语公式（13课）** | ✅ | Pitch 包 + `deliver/logline` Skill | deliver.logline |
| 数据 | **点击/评论/收藏复盘（12课）** | ✅ | AnalyticsPanel + `analytics.review` | analytics.* |
| 选题 | **四步组合法（17课）** | ✅ | HookPanel FourStepCombo | topic.core_hook_batch |
| 编排 | **Bible 注入 + 章摘要 journal** | ✅ | worker `batchLifecycle` | qc.bible_guard / mem.chapter_summary |
| 编排 | **Stage migrationHint** | ✅ | StudioPage + stageLock | migrateManjuLockState |
| 知识库 | 爬虫/榜单热点合规配置 | ✅ | `/kb/crawler` | crawler.* |

---

## 3. 新增功能详细规格

### 3.1 灵感工作台 `/inspiration`

**来源**：8 课「灵感四层级、故事线、核心事件反推、情节三要素、商品思维」。

- **四层级**：一念 / 灵感 / 创意 / 选题，逐层升维。
  - 每层卡片：输入一句话 → 生成扩写候选 → 打分（共鸣/爽点/壳）。
- **三种创作路径**：
  1. 从故事线出发（人物+目标+阻力）
  2. 从核心事件出发（反推故事线）
  3. 从情节出发（情节点三要素：事件+因果+变化）
- **模板库**：升级流 / 反套路 / 后悔流 / 追妻火葬场五部曲 / 误会梗 / 英雄救美。
- **输出**：候选选题卡，可「一键创建项目」并预填 `format + genreTags + logline`。

### 3.2 换元工作台（并入短篇 / 独立面板）

**来源**：3 课 + `换元法.txt`。

- 输入对标拆书报告 → 生成 **一度换元**（时间/空间/身份置换）与 **二度换元**（动机/冲突/结局重构）。
- **映射表**：事件 / 人物 / 道具 / 情绪点 四列对照，逐条勾选置换。
- **相似度风险提示**：洗稿边界、换元不足时提示二度换元。
- 输出候选章节映射，进入 `short_novel` 流程。

### 3.3 人设工作台强化

**来源**：8/9/10 课。

- 七步法生成小传；大五人格（O/C/E/A/N）雷达；欲望/恐惧/秘密三栏。
- **关系网矩阵**：角色 × 角色，标注关系类型、强度、秘密/公开。
- **拉扯感训练**：生成高张力对白/两难选择练习卡。
- **女频情节扩展**：误会梗、英雄救美等 8 课清单一键插入细纲。

### 3.4 结构工作台强化

**来源**：11/12/13/17 课。

- 漫剧 **100 集四幕结构**：四幕分区、每幕 25 集、高潮与钩子点标定。
- 短剧 **20 节拍 + 付费点地图**：每 10 集强钩子、8–9 集加压、单集 1–3 爽点（Beat20 挂 duanju，不挂 ip_adapt）。
- IP **单元节奏/情绪断章 + AdaptPitchPack**（13 课；≠ 漫剧四件套）。
- 女频 **追妻火葬场五部曲** 与节奏配比；选题/人设/架构/八报告见 14 课深度台。

### 3.5 知识库细化

#### 3.5.1 报告类型全表（对应知识库 PRD 扩充）

| reportType | 内容 | 来源 | 前端状态 |
|-----------|------|------|---------|
| `dissect_params` | 拆书参数（七步法/情绪/单元） | 2课 | ✅ |
| `unit_story` | 单元故事大中小层级 | 2/13课 | ✅ |
| `seven_steps` | 目标-阻碍-行动-结果-意外-转折-结局 | 2课 | ✅ |
| `core_hook` | 核心梗 vs 情节卡提取 | 2课 | ✅ |
| `emotion_curve` | 情绪 -10~+10 | 5/13课 | ✅ |
| `cool_point_map` | 爽点/虐点分布 | 6/7课 | ✅ |
| `hook_map` | 期待感/钩子/卡点 | 4课 | ✅ |
| `style_profile` | 文风要素（抽文风） | 提示词技巧 | ✅ |
| `redline_report` | 风险红线 | 15/17课 | ✅ |
| `gap_report` | 对标差距（vs 爆款结构） | 13课 | ✅ |
| `char_graph` | 人设关系 | 8/9课 | ✅ |

#### 3.5.2 爬虫 / 榜单热点（合规）

**来源**：11 课「扫榜与市场调研」+ 知识库 PRD §8。

- 页面 `/kb/crawler`：
  - 数据源配置（番茄/晋江**公开榜单摘要级**）、抓取频率、robots/服务条款开关、失败重试。
  - 合规声明：仅公开页面元数据/榜单摘要，禁止整本盗爬、付费章、绕过登录。
  - 「题材波动」简单统计 + 「根据热点生成核心梗方向」按钮。
- 后端新增实体 `CrawlerSource`（来源名 / 列表 URL 白名单 / 频率 / 开关 / 最后抓取 / 状态）。

### 3.6 投稿交稿包强化

**来源**：11/13 课。

- 交稿包组件增加：投稿信息表（作品名/类型/题材/集数/每集字数/卖点/对标/作者备注）、导语公式生成、八类制作规格备注。
- `deliver.logline` Agent：按「身份+矛盾+转折+金手指」生成导语。

### 3.7 数据复盘

**来源**：12 课「点击/评论/收藏判断一部剧好不好」。

- 项目详情加「数据复盘」标签：收藏率标准提示（收藏/点击）、章节留存曲线、改进建议。
- 已落地：`AnalyticsSnapshot` CRUD + AnalyticsPanel + `analytics.review` Agent（人工录入快照，**非**平台自动拉数）。

---

## 4. 前端页面清单（重设计）

### 4.1 改造页面

| 路由 | 现状 | 改造 |
|------|------|------|
| `/` | 营销式 hero | 创作驾驶舱：继续创作 + 创作地图 + 格式入口 + 今日目标 + 最近项目 |
| `/projects` | 普通表格 | 密度列表 + 进度条 + 状态色 + 空态引导 |
| `/studio/:format` | 已有三栏 | 视觉重设计，保持功能 |
| `/kb` | 极简 | 上传流程 UI + 报告入口 + 爬虫入口 |
| `/kb/docs/:id` | 单报告 | 多报告 Tab 浏览 + 应用到项目 |
| `/kb/hotspots` | 极简 | 加爬虫配置入口 + 来源/状态 |
| `/kb/tropes` | 极简 | 加生成变体 / 收藏交互 |
| `/prompts` | 已有 | 视觉重设计 |
| `/colleague` | 极简 | 组队可视化 + 提案动作 |
| `/tokens` | 极简 | 预算条 + 汇总卡 |
| `/memory` | 已有 | 视觉重设计 |
| `/settings` | 已有 | 加爬虫合规开关 + 模型路由 |

### 4.2 新增页面

| 路由 | 页面 | 优先级 |
|------|------|--------|
| `/inspiration` | 灵感选题工作台 | P0 |
| `/kb/crawler` | 爬虫/榜单合规配置 | P0 |
| `/kb/reports/:docId` | 多报告浏览（或并入 doc 页 Tab） | P1 |

---

## 5. API / 实体补充（已实现）

> 2026-11 已落地于 `services/api`：实体 + 路由 + 幂等种子 + API 测试（`tests/test_workbench_api.py`，6 passed）。

```
GET/POST  /inspirations              灵感卡 CRUD + 扩写
POST      /inspirations/{id}/expand  调用对应 Agent
GET/POST  /swap-plans                换元方案 + 映射表
GET/POST  /crawler-sources           爬虫源配置
POST      /crawler-sources/{id}/run  手动抓取
GET       /analytics/projects/{id}   数据复盘（mock）
POST      /kb/docs/{id}/reports/{type}  按需生成指定报告
```

实体补充（`packages/domain`）：
- `Inspiration`（id/level/sourceText/candidates/tags/createdAt）
- `SwapPlan`（id/projectId/sourceDocId/degree/mappingJson/createdAt）
- `CrawlerSource`（id/name/baseUrls/interval/enabled/robotsAck/lastRunAt/status）
- `AnalyticsSnapshot`（id/projectId/views/favs/retention/meta）

### 5.1 前端交互落地（本轮）

> 2026-11 前端已把四个高频流程做成可交互闭环，组件化避免重复实现。

| 流程 | 路由 / 落点 | 交互闭环 | 关键文件 |
|------|------------|---------|---------|
| 分析报告 | `/kb/docs/:id` 报告 Tab | 报告列表 + Markdown/JSON 双视图 + 重新分析 + 应用到写作台（拆书/换元/仿写） | `features/kb/KbDocPage.tsx` |
| 换元 | `/kb/docs/:id` 换元 Tab | 一度/二度切换 + 五维映射表（人物/场景/金手指/冲突/题材）+ 原作/换元稿对照 + 流式生成 + 推送 swap_plan | `features/kb/SwapWorkspace.tsx` |
| 爬虫 | `/kb/crawler` | 合规边界 + 数据源开关 + robots 门禁 + 手动抓取（运行态/最近抓取记录）+ 题材波动 mini 图 | `features/kb/KbCrawlerPage.tsx` |
| 去 AI 味质检 | `/studio/manju` 交稿物 qc / Stage S7 | 五维精修门禁 + 去 AI 味自查 + AI 稿/去味稿对照 + 流式重生成 | `features/studio/DeAiWorkbench.tsx` |

- 去 AI 味质检收敛为单一 `DeAiWorkbench`，同时供 `deliverables.tsx`（交稿物 qc）与 `ManjuPanels.tsx`（S7_DE_AI）复用，不再各自维护一份清单。
- 换元工作台 `SwapWorkspace` 为知识库文档页内置 Tab，输出 `swap_plan` 交稿物进入写作台对应 Stage。

---

## 6. 分期 backlog

### P0（前端为主，本迭代）
1. ✅ 设计系统 v3：中性精确、紧凑/舒适密度、明暗主题、创作台编辑区中心。
2. ✅ 首页重设计为创作驾驶舱 + 今日目标 + WorkflowMap。
3. ✅ `/inspiration` 灵感工作台（四层级 + 三路径 + 模板库）。
4. ✅ `/kb/crawler` 爬虫合规配置 + 题材环比。
5. ✅ 知识库上传流程 UI + 多报告浏览（含红线报告）。
6. ✅ 项目列表、Prompt、同事组队、Tokens 预算、记忆热温冷、设置密度。

### P1（后端起步）
1. ✅ `Inspiration` / `SwapPlan` / `CrawlerSource` / `AnalyticsSnapshot` 实体 + FastAPI 路由 + SQLite + 种子 + 测试。
2. ✅ 换元工作台对接 `swap.master` + Similarity 阻断。
3. ✅ 100 集四幕 / 20 节拍 / 追妻火葬场 / 设定七步 / 爽点台词 / 投稿信息表 均进结构与交稿物面板。

### P2
1. ✅ 数据复盘 AnalyticsPanel + 爬虫题材环比波动。
2. ✅ Tauri 2 桌面壳（`apps/desktop`）+ 记忆热/温/冷完整 UI（分层/搜索/冻结/归档）。

---

## 7. 验收标准（P0）

1. `/` 首屏能看出「在写哪部 + 到哪一 Stage + 下一步」。
2. `/inspiration` 能从四层级走到「创建项目」并预填格式。
3. `/kb/crawler` 能开关合规爬虫源并展示抓取状态。
4. 知识库文档页可切换 ≥3 种报告类型。
5. 全站明暗主题一致、无紫白渐变套路、无奶油衬线土气感。
6. `pnpm typecheck` 与 `pnpm build` 通过。
