# AI 商业写作台 · 把灵感带到交稿的多智能体工作台(ai-commerical-writing-always-on-personal-multiAgents)

**把一句模糊灵感交给一支会拆题、会记忆、会协作、会自检、能从中断中恢复的 AI 写作创作团队，让选题、人物、大纲、正文、质检与投稿整理从分散聊天变成一条可追踪、可修改、可交付的创作流水线。**

> **开发中 · Early Preview**：项目仍在快速迭代，欢迎 Star、Fork、提交 Issue 和真实作品反馈。当前更适合研究、试用和二次开发，不应被当作已经完成商业化验收的 SaaS 产品。

**作者**：VanGong · [gongfan1213@163.com](mailto:gongfan1213@163.com)

从一句核心梗，到人物小传、分集大纲、正文与投稿包，这个项目尝试把商业写作中反复发生的工作，组织成一套作者可以指挥、检查、修改和继续推进的一句话批量生成生产流程。

它面向漫剧、短剧、短篇网文、男频长篇、女频长篇与 IP 改编。你可以在 Web 创作台里逐步写，也可以让总编派活、让专职 AI 同事协作，再从飞书接收进度与确认请求。

> **147 个注册 Agent · 137 项 Skill · 82个Tools· 多种智能流水线· 六种创作格式**  
> 数量来自当前仓库目录快照，代表职责与方法的覆盖，不代表每个岗位都经过同等强度的真实任务验收。

[快速启动](#快速启动) · [功能全景](#功能全景) · [AI 同事](#ai-同事) · [多智能体能力全景](#多智能体能力全景从一句需求到可检查交付) · [Agent 工作台](#agent-工作台) · [工程如何约束模型](#工程如何约束模型) · [模型选型与限流](#模型选型限流并发与成本) · [技术债与下一步](#技术债与下一步)

English: [README.en.md](./README.en.md)

![六种格式的创作台与项目进度](./docs-public/assets/readme-picture/主界面.png)

*截图来自本地联调环境，其中的项目数量、进度与用量是历史测试数据，不是产品性能或成稿数量承诺。*

### 产品巡览视频

[观看 AI 商业写作台产品巡览（WebM，约 30 秒）](./docs-public/assets/video/ai-writing-workbench-tour.webm)

视频展示项目列表、创作台、AI 同事、历史对话浏览和知识库页面；历史对话部分仅浏览已有记录，没有发送新消息。页面中的项目、用量和会话来自本地开发联调数据，不代表线上服务承诺。

## 你可以怎样用它

你带来一个想法：“夜班装卸工发现一箱标着五十公斤的货，实际上重七十七公斤。”

接下来，工作台可以帮助你：

1. **把灵感变成候选**：围绕动机、危机、金手指、题材和开篇，生成可比较的选题与核心梗。
2. **把候选变成项目事实**：由作者选择方向，建立人物、世界规则、核心冲突和项目 bible。
3. **把故事拆成可执行的单元**：生成总纲、集纲、章纲、节拍与场景；按当前格式的创作地图推进。
4. **把正文写到可修改的地方**：按集、场、章交付；产物有版本，不必在聊天记录里寻找“最后那一稿”。
5. **把检查变成证据**：字数、结构、必填字段等交给程序检查；逻辑、审美和关键采纳保留人工判断。
6. **把中断变成续跑**：查看已完成的工具与产物，暂停、追问、修订或恢复任务，而不是每次从头再来。

这里最值得保留的分工是：**AI 扩展方案与承担执行，作者保留选择、审美和最终发布的权力。** 系统可以生成初稿，不能承诺它天然可卖、可拍或符合所有平台的最新规则。

## 为什么这样设计

普通聊天适合讨论一个点；一部作品还需要管理约束、版本、前后依赖和完成状态。本项目把这些工作放进可见的系统中。

| 写作中的麻烦 | 项目的设计 | 对作者的价值 |
| --- | --- | --- |
| 大纲、人物和正文散在多个窗口 | 项目、产物、bible、Ontology 对象集中管理 | 找得到依据，改得动版本 |
| 一次生成很长，后半段开始漂移 | 六格式 Stage 图、按集场章分块、长度与结构检查 | 把失控范围缩小到可返工的单元 |
| 一个提示词承担所有工作 | 专职 Agent + 按需读取的 Skill + Prompt pack | 选题、人物、正文与质检各有工作方法 |
| 模型说“完成”，数据库里却没有东西 | Done Contract、Gate、receipt 与持久化证据 | 交付看事实，不只看一句回复 |
| 每次换窗口都得重讲设定 | 项目事实、分层记忆、引用、压缩与 Handoff | 降低重复交代与设定漂移 |
| 多个 Agent 同时修改同一件东西 | 版本校验、CAS、Action 日志、候选与采纳分离 | 保留修改来源，减少无声覆盖 |
| 任务跑一半断了，不知道该不该重试 | Session 日志、租约、心跳、checkpoint、写操作账本 | 区分可重试请求与结果存疑的写入 |
| 模型频繁调用，把账号打到限流 | 共享请求闸、冷却、退避、可选 Provider 切换 | 控制负载，让容量不足成为可解释状态 |

## 功能全景

### 六种写作流程，共用同一套项目底盘

| 格式 | 主要工作 | 重点约束 |
| --- | --- | --- |
| 漫剧 `manju` | 核心梗、小传、十集大纲、分集正文、分镜与投稿整理 | 可视化动作、场景、人物一致性、分块交付 |
| 短剧 `duanju` | 选题、爽点、节拍、卡点、分场剧本与改稿 | 冲突推进、可拍动作、情绪链与付费预期 |
| 短篇 `short_novel` | 选题、结构、成稿、修订 | 篇幅、开篇冲突、兑现与收束 |
| 男频长篇 `male_long` | 金手指、升级循环、卷章规划、正文与质检 | 主角动机、爽点落地、追更节奏 |
| 女频长篇 `female_long` | 微塑、卷纲、节奏、人物关系与正文 | 情绪递进、人物选择与关系变化 |
| IP 改编 `ip_adapt` | 源作分析、单元故事、情绪线与剧本压缩 | 来源边界、改编目标、人物与情节取舍 |

每种格式都有创作地图与阶段条件。关键节点通过作者确认后再推进；强制操作需要留下依据。**流程走到末尾不等于终稿质量达标**，仍以真实产物、人工采纳与编辑复核为准。

换元、拆解与参考素材用于研究结构和生成新方案，不代替版权判断，也不自动保证改编权或作品原创性。

### 总编、AI 同事、任务组与子智能体

- **Personal Agent 总编**：接收自然语言需求，读取项目状态，提议、派单、回答进度、请求确认；支持 Web 与飞书入口。
- **AI 同事**：按岗位、身份、技能、历程、信任与例程组织；支持单聊、群聊、引用资料和定向协作。
- **Fleet / 任务组**：把若干专职岗位组织为可追踪的任务；独立工作可以并列，有依赖的工作按顺序执行。
- **Subagents**：单个 Run 内拆出侦查、规划、执行或评审子任务。每次 parallel 调用最多 3 个，嵌套深度 1；部分流水线成员禁止再拆子任务。
- **批量编排**：按当前任务合同组织分集工作，优先保证输入依赖、授权和交付证据，避免盲目让整本书同时开写。
- **主动提案与例程**：缺口扫描形成待办或提案；定时器负责唤醒和入队，具体可执行范围由信任、审批与任务权限决定。

**通讯录成员数、正在运行的顶层任务数、同时发出的模型请求数，是三件不同的事。** 148 个 Agent 是可选岗位目录，不是开机就常驻 148 个模型。

查看 AI 同事工作区

![同事、编组、例程与群聊入口](./docs-public/assets/readme-picture/ai同事舰队和提议.png)

截图中的群聊成员数不等于 Fleet 执行并发，也不等于在途模型请求数。



### AI 同事

AI 同事不是一组只能聊天的角色名称，而是绑定了岗位职责、技能、工具权限、记忆范围、信任等级和交接关系的可执行 Agent。作者可以像联系一组真实编辑和编剧一样使用它们，也可以只让总编替自己安排工作。

#### 面向作者的功能

- **具名岗位**：每位同事有名称、职责、风格、适用阶段和上下游岗位；漫剧、短剧、短篇、男频、女频和 IP 改编使用不同的岗位组合。
- **单聊与群聊**：可以直接和一个岗位讨论，也可以 @ 多位同事组成群聊；群聊成员、发言策略和项目范围会被记录。
- **资料引用**：从知识库、项目产物或编辑器选中一段文字，作为带来源、版本和范围的 `@资料` 引用交给同事，支持优化段落、总结情节、核对人物或改写指定范围。
- **技能按需加载**：同事默认只看到技能名称和摘要，需要时才读取对应 Skill，减少无关提示词和工具 Schema。
- **编组与接力**：独立任务可以并行，存在依赖的任务按顺序接力；上一位同事交付的产物、版本和交接卡成为下一位的输入。
- **例程与主动提案**：可以设置定时检查、缺口扫描和反馈提案；提案不会自动替代作者确认，具体动作仍受信任等级和授权门槛约束。
- **过程回放**：会话、工具调用、产物、确认、失败、暂停和恢复都显示在工作台中，不需要只从最后一段聊天猜发生了什么。

#### AI 同事的执行边界

AI 同事可以检索、分析、生成候选、编排任务和汇报进度，但关键写入、采纳、批量生成和发布仍经过项目权限、版本校验、Gate、Done Contract 或人工确认。历史文档里的“待确认”等文字只代表记录时点，当前审批状态必须以指定 QA Run 的持久化凭据和当前稿件版本对照为准。

同事的上下文按范围装配：当前项目共享事实、本人岗位记忆、用户明确指令和本次任务指针可以进入上下文；其他 Agent 私有记忆、其他项目原始对话和无关历史不会自动混入。工具调用采用“已知能力直接调用、未知能力再搜索”的策略，避免用 `tool_search` 代替真正工作。

### 多智能体能力全景：从一句需求到可检查交付

这个项目的多智能体能力，不是把同一个模型复制成很多聊天窗口，而是把一项长任务拆成**有职责、有输入、有工具、有产物、有验收条件的协作单元**。总编负责理解目标和组织任务，专职 Agent 负责某一种工作，工具负责读取或写入事实，Gate 负责确定性检查，作者负责关键选择与最终采纳。

```text
作者目标
  → 总编识别格式、阶段、项目范围和交付物
  → 规划依赖：哪些岗位可并行，哪些必须接力
  → 为每个岗位装配最小上下文、Skill、工具和权限
  → Agent 执行：检索 → 分析 → 生成候选 → 写入产物
  → Gate / Schema / Done Contract 检查结构与证据
  → 版本、记忆、审计和 receipt 持久化
  → 作者比较候选、确认采纳，或继续修订与恢复
```

#### 1. 任务理解与拆解能力

- **自然语言目标解析**：把“帮我写一部漫剧”“检查这一集是否能交稿”等模糊请求转换成格式、阶段、项目和交付物约束。
- **任务边界识别**：区分选题、人物、世界观、大纲、正文、质检、投稿整理等不同工作，避免一个 Agent 试图包办全流程。
- **依赖图规划**：知道人物设定要先于正文，核心梗要先于大纲，人工选定换元方案后才能继续下游写作。
- **交付缺口判断**：根据已有产物、版本和 Gate 证据决定是继续执行、修订、等待确认还是结束，而不是只根据模型说“完成”来判断。

#### 2. 专业角色协作能力

项目将不同写作职责拆成可复用岗位，而不是只维护一个“万能写作 Agent”。主要覆盖：

| 协作层 | 能力示例 |
| --- | --- |
| 选题与市场 | 热点转化、核心梗、片名与卖点、题材筛选、IP 选书 |
| 人物与世界 | 人物小传、关系网、灵魂三问、世界观、金手指边界、Bible Guard |
| 结构与节奏 | 总纲、卷纲、章纲、十集大纲、20 拍、情绪曲线、升级循环、伏笔台账 |
| 正文与场景 | 漫剧分集、短剧分场、短篇章节、对白、分镜、场景三件套、续写与改写 |
| 质检与风险 | 逻辑、格式、长度、爽点、钩子、AI 味、相似度、合规红线、人工清单 |
| 研究与交付 | 拆书、桥段、知识图谱、投稿包、翻译、导出和数据评测 |

每个岗位都可以绑定自己的 Skill、工具白名单、记忆空间、完成合同和适用格式；岗位数量代表覆盖面，不代表所有岗位都能独立完成任意任务。

#### 3. 并行、接力与子智能体能力

- **并行协作**：没有前后依赖的岗位可以同时运行，例如片名、人物和世界观候选。
- **有序接力**：有依赖的岗位按照产物版本交接，例如“核心梗 → 人物/世界 → 大纲 → 正文 → 质检”。
- **Fleet 编组**：把多个岗位组织为一个有 roster、任务、运行 ID 和汇总策略的团队；支持 `union` 并行汇总与 `ordered` 依赖接力。
- **Subagent 分解**：在一个 Run 内拆出侦查、规划、执行或评审子任务；子任务有独立上下文和结果通道，避免把所有历史塞给同一个模型。
- **边界控制**：默认限制并发、嵌套深度和成员数量；子任务不是越多越好，任务空转时应修复策略而不是盲目增加 Agent。

#### 4. 上下文工程与提示词缓存能力

- 固定系统规则、岗位协议和工具顺序，形成稳定 Prompt Cache 前缀。
- 只把当前项目事实、用户指令、必要产物引用和相关资料送入模型，避免跨项目串稿。
- 通过 `docId / artifactId / version / offset` 精确读取长文，不反复发送整本资料。
- 长任务采用微压缩、结构化摘要、Handoff 和 Reset；压缩保留用户指令、产物引用、完成证据和未知写入状态。
- 对工具结果做紧凑摘要，必要时再按 `full=true` 或分页读取正文。

这套设计能减少重复 Token 和上下文漂移，但不能消除模型遗忘、误解指令或创作质量波动。

#### 5. 工具使用与可控执行能力

Agent 可以使用项目、产物、知识库、记忆、文件、检索、评测、Ontology 和生命周期工具。工具调用受到以下约束：

- 已知工具直接调用，未知工具才进行按需搜索；
- 工具参数经过 Schema 和权限检查，错误会返回结构化原因与下一步建议；
- 写入统一经过 `artifact_create`、`artifact_update` 或 Ontology Action，避免不同路径各写一份事实；
- 高风险写操作可以要求人工确认；
- 工具结果、耗时、用量、错误和来源都写入 Session / Run 证据；
- 连续未知工具、非法参数或无进展会触发熔断和停滞保护。

#### 6. 记忆、知识库与事实一致性能力

- **项目事实**：已确认的人物、世界规则、核心梗和故事阶段。
- **项目 Bible**：用于约束正文和后续 Agent，不把聊天猜测直接当成事实。
- **岗位私有记忆**：记录某个 Agent 的经验与教训，不自动泄漏给其他岗位。
- **共享事实与提案**：允许整理和复用，但通过 CAS、版本和人工采纳避免无声覆盖。
- **知识库引用**：搜索方法论、上传文档、拆书报告、桥段和图谱，并保留来源范围。
- **版本追踪**：每个产物都可以关联创建者、Run、父版本、当前版本和采纳状态。

因此，Agent 的“记住”不是把所有历史聊天永久塞回 Prompt，而是把可验证的事实、引用和经验分层保存。

#### 7. 质量门禁与完成合同能力

模型负责提出内容，程序负责检查内容是否满足当前交付条件。现有防线包括：

- Schema：检查 JSON、字段、产物类型和必填结构；
- Stage / Format / Chunk：检查当前阶段、格式和单块范围；
- LengthBand：检查字数、场景和分集长度；
- Logic / Hook / Paywall / Emotion 等业务 Gate：检查故事约束和可复核信号；
- 占位符检测：拒绝“待填”“[内容]”“TODO”等空壳；
- Done Contract：要求目标产物、Gate 结果、版本和完成证据齐全；
- LogicAck、采纳和高风险合规确认：保留作者的最终判断。

门禁通过只代表结构和约束达到要求，不等于作品一定好看、原创、可拍、可售或符合平台最新规则。

#### 8. 长任务、并发与故障恢复能力

任务以持久化 `Job / AgentRun / Session` 运行，而不是依赖浏览器页面一直开着。系统提供：

- Redis 队列与跨进程全局 LLM 并发闸；
- AgentRun 租约、心跳、lease version fencing 和 checkpoint；
- Worker 掉线后的回收、重入队和僵尸任务清理；
- 429、5xx、连接错误的 Retry-After 与指数退避；
- 暂停、恢复、停止、追问和人工介入；
- 写入结果未知时先核查账本，不把“没收到响应”当成“肯定没写入”；
- 失败重跑时注入已有产物和完成证据，避免从零开始重复消耗。

这使项目适合运行十几分钟到数小时的流水线任务，但当前仍是单机、本地单用户架构，不等同于高可用生产集群。

#### 9. 人机协作与主动工作能力

- 作者可以逐步确认，也可以使用一键自动模式；
- 总编可以提出缺口、建立任务组、请求确认和汇报进度；
- 飞书、Web、CLI 共享同一项目控制面；
- 例程和定时任务可以在到期时唤醒 Agent；
- 信任等级、权限和审批门槛限制自动写入、批量执行和外部动作；
- 所有关键动作留下 Action Audit，便于回放、撤销和追责。

“Always-on”表示系统随时可以接收和恢复任务，不表示模型会持续后台调用，也不表示所有动作都会自动批准。

#### 10. 评测、成本与模型适配能力

- 按 Agent、岗位、项目、Run 和 Provider 统计 Token、缓存命中、耗时和成本估算；
- 支持评测集、Case、运行、人工标注和 A/B 对比，但目前还没有足以替代人工的统一质量排行榜；
- 可切换 DeepSeek、MiniMax、Ollama 等 OpenAI-compatible Provider；
- 网关统一处理模型协议、重试、限流、超时、错误分类和回执；
- 对本地弱模型通过 Prompt 契约、工具白名单、Schema 和 Gate 进行约束；
- 对供应商额度、并发和 429/502/529 做退避与故障转移，但不能增加供应商账号本身的权益。

历史实测表明：云端模型适合多轮 Agent 编排；本地 qwen3:1.7b 更适合冒烟验证，qwen3:14b 在 M4 32GB 上可以单次写作，但多轮工具编排会明显变慢。

#### 11. 能力边界：它不承诺什么

- 不承诺模型永远正确，也不承诺一次生成终稿；
- 不承诺通过 Gate 就等于文学质量、商业收入或平台过审；
- 不承诺自动判断版权、授权、事实时效或法律结论；
- 不承诺任意模型都能遵循复杂工具协议；
- 不承诺当前本地 SQLite / Redis 方案适合多租户和高可用部署；
- 不承诺历史 Session 中每个失败都能还原到真实供应商 HTTP attempt；
- 不承诺“目录中的 Agent 同时运行”，岗位数量、任务并发和模型请求并发是三种不同指标。

综合来看，这套多智能体系统的核心能力不是“让模型变聪明”，而是把模型放进一个**可拆解、可授权、可观测、可校验、可恢复、可继续修改**的写作生产流程中。模型负责扩展方案和执行局部工作，工程系统负责边界、证据、版本和失败处理，作者保留选择、审美和最终发布权。

### Agent 工作台

Agent 工作台是执行控制面，不只是一个聊天页面。它把一次自然语言请求变成可暂停、可检查、可恢复的 `AgentRun / Job / Session`，并把模型、工具、产物和质量门禁连接成一条可回放的执行链。

#### 工作台能看到什么

| 面板 | 内容 |
| --- | --- |
| 对话指挥 | 给总编下达任务、选择项目、查看历史会话和继续未完成请求 |
| 智能体图鉴 | 浏览岗位目录、职责、上下游、技能、工具权限和适用格式 |
| 任务记录 | 查看 Job、AgentRun、阶段、尝试次数、当前模型、耗时和终态 |
| 过程时间线 | 查看模型请求、工具调用、工具结果、确认卡、Gate、产物写入和交接事件 |
| 守护任务中心 | 查看后台任务、定时任务、暂停/恢复/停止、租约和 watchdog 状态 |
| 上下文清单 | 查看本轮实际装配的项目事实、记忆、资料引用、压缩和 handoff 记录 |
| 产物与版本 | 查看候选、当前版本、来源 Run、QA 签阅、回滚和采纳状态 |

#### 一次 Agent 任务怎样执行

```text
作者请求
  → 总编识别任务与项目范围
  → 装配最小上下文与可用工具
  → 检查确认、权限和版本条件
  → 创建持久化 Job / AgentRun
  → Node Agent Worker 获取租约并执行模型循环
  → 调用工具、写入产物或派生 Subagent
  → Gate / Done Contract 校验结果
  → 记录 receipt、版本和过程事件
  → 交付候选，必要时等待作者确认
```

#### 多智能体、Subagent 与后台任务

- **Fleet** 适合多个相互独立的岗位；`union` 表示并行收集结果，`ordered` 表示有依赖的接力。
- **Subagent** 适合在单个 Run 内拆分侦查、规划、执行和评审；子任务有独立上下文、工具白名单和父子结果通道。
- **后台任务** 使用持久化 Job、Redis 队列、租约、心跳和 checkpoint；前端关闭或网络中断不会自动丢弃已完成的工具结果。
- **暂停与恢复** 会先读取已有产物和写入账本；写操作结果未知时先核查，不盲目重复写入。
- **定时任务** 负责到期唤醒和入队，真正能做什么仍由项目、岗位、信任等级和确认门槛决定。

#### 上下文、缓存与成本控制

Agent Worker 和 Personal Agent 使用同一套上下文原则，但根据交互式对话与长任务分别配置阈值。两者都会：

- 优先固定系统规则和岗位协议，保持 Prompt Cache 稳定前缀；
- 先搜索小片段，再按 `docId / artifactId / version / offset` 精确读取；
- 对过长工具结果做微压缩，去除重复读取；
- 在完整工具调用组边界进行结构化压缩；
- 保留当前指令、版本、审批 receipt、失败和未知写入证据；
- 压缩没有实际变小，或上下文仍超预算时停止，而不是重复发送同一份长上下文；
- 达到 handoff 条件时只交接目标、完成缺口、产物 ID、版本和必要证据。

#### 技术组成

| 层 | 作用 |
| --- | --- |
| Web / 飞书 / CLI | 输入请求、展示过程、确认和恢复入口 |
| Personal Agent | 路由任务、读取项目、搜索知识、派单和汇报 |
| API 控制面 | Conversation、Job、AgentRun、Artifact、Memory、Approval 和 Audit 持久化 |
| Node Agent Worker | 执行模型循环、工具调用、Subagent、上下文压缩和 checkpoint |
| LLM Gateway | Provider 选择、请求闸、限流、退避、用量和模型回执 |
| Ontology / Gate | 校验对象类型、版本关系、结构、字数、来源和业务条件 |
| SQLite + Redis | 本地项目账本与跨进程队列/租约；当前方案面向单用户本地运行 |

工作台记录的是产品可观测的执行过程：模型请求、工具、产物、版本和状态可回放；供应商私有推理、外部系统不可逆操作和最终商业结果不在“可完全回放”的承诺内。

## 页面导览与功能截图

下面的截图来自本地开发联调环境，用来说明页面结构和功能入口。截图中的项目数量、用量、会话、热点条目和报告内容属于历史测试数据，不代表线上服务规模、模型质量或商业收入。

### 各题材正文

| | | | |
| :---: | :---: | :---: | :---: |
| ![漫剧正文](./docs-public/assets/readme-picture/minimax-manju-saved-body.png) | ![短剧正文](./docs-public/assets/readme-picture/创作台短剧正文.png) | ![章节/短篇正文](./docs-public/assets/readme-picture/创作台章节正文小说效果.png) | ![男频长篇正文](./docs-public/assets/readme-picture/minimax-male_long-saved-body.png) |
| ![女频长篇正文](./docs-public/assets/readme-picture/minimax-female_long-saved-body.png) | ![IP 改编正文](./docs-public/assets/readme-picture/minimax-ip_adapt-saved-body.png) | ![正文版本与历史建议](./docs-public/assets/readme-picture/正文版本与历史建议.png) | ![比较采纳 AI 建议](./docs-public/assets/readme-picture/比较采纳ai建议.png) |
| ![情节优化](./docs-public/assets/readme-picture/情节优化.png) | ![选中片段优化](./docs-public/assets/readme-picture/创作台选中片段优化.png) | ![文件引用](./docs-public/assets/readme-picture/文件饮用机制.png) | ![创作台 Eval](./docs-public/assets/readme-picture/创作台eval.png) |

### 工作台与其它页面

| | | | |
| :---: | :---: | :---: | :---: |
| ![主界面](./docs-public/assets/readme-picture/主界面.png) | ![创作台首页](./docs-public/assets/readme-picture/创作台首页.png) | ![灵感选题](./docs-public/assets/readme-picture/灵感选题界面.png) | ![测试多书](./docs-public/assets/readme-picture/测试多书.png) |
| ![智能体全景图鉴](./docs-public/assets/readme-picture/智能体全景图鉴.png) | ![智能体图鉴](./docs-public/assets/readme-picture/智能体图鉴.png) | ![漫剧主线编组](./docs-public/assets/readme-picture/agent工作台-漫剧主线编组30个智能体协作.png) | ![守护任务中心](./docs-public/assets/readme-picture/agent工作台后台任务-守护任务中心.png) |
| ![运行中任务](./docs-public/assets/readme-picture/运行中任务.png) | ![Agent 窗口 1](./docs-public/assets/readme-picture/agent-window-1.png) | ![Agent 窗口 2](./docs-public/assets/readme-picture/agent-window-2.png) | ![Agent 窗口 3](./docs-public/assets/readme-picture/agent-window-3.png) |
| ![多智能体交接](./docs-public/assets/readme-picture/多智能体交接.png) | ![多智能体 handoff](./docs-public/assets/readme-picture/多智能体handoff.png) | ![多智能体质量评测](./docs-public/assets/readme-picture/多智能体质量评测.png) | ![右下角 AI 助手](./docs-public/assets/readme-picture/右下角AI助手.png) |
| ![AI 同事资料](./docs-public/assets/readme-picture/AI同事当中同事资料.png) | ![新增 AI 同事](./docs-public/assets/readme-picture/ai同事当中新增同事.png) | ![信任设置](./docs-public/assets/readme-picture/ai同事-song-right-信任.png) | ![同事记忆](./docs-public/assets/readme-picture/colleague-song-right-记忆.png) |
| ![同事例程](./docs-public/assets/readme-picture/ai同事例程.png) | ![编组预设](./docs-public/assets/readme-picture/ai同事编组预设.png) | ![舰队和提议](./docs-public/assets/readme-picture/ai同事舰队和提议.png) | ![舰队提议](./docs-public/assets/readme-picture/ai同事-舰队提议部分.png) |
| ![知识库](./docs-public/assets/readme-picture/kb.png) | ![知识库分析报告](./docs-public/assets/readme-picture/知识库分析报告.png) | ![拆书换元](./docs-public/assets/readme-picture/知识库拆书换元.png) | ![桥段库](./docs-public/assets/readme-picture/kb-tropes.png) |
| ![热点采集](./docs-public/assets/readme-picture/热点采集.png) | ![爬虫数据源](./docs-public/assets/readme-picture/知识库爬虫数据源.png) | ![热点榜单](./docs-public/assets/readme-picture/热点榜单.png) | ![爬虫报告](./docs-public/assets/readme-picture/知识库爬虫报告.png) |
| ![写作指令](./docs-public/assets/readme-picture/写作指令面板prompt.png) | ![Skills](./docs-public/assets/readme-picture/助手方法库skills界面.png) | ![记忆](./docs-public/assets/readme-picture/memory.png) | ![AI 用量](./docs-public/assets/readme-picture/AI用量页面.png) |
| ![数据看板](./docs-public/assets/readme-picture/数据看板.png) | ![设置](./docs-public/assets/readme-picture/settings.png) | ![飞书 Personal Agent](./docs-public/assets/readme-picture/飞书personalagent.png) | ![飞书自动执行提案](./docs-public/assets/readme-picture/飞书自动执行提案.png) |

### 七类榜单数据源

当前页面展示七类数据源，其中六类是公开平台榜单，另一类是手动录入源，并不是七个都能无条件自动联网抓取的网络平台。采集器只处理公开可访问的榜单元数据，遵守来源、授权、robots 和频率边界，不抓取付费章节、登录后全文或绕过访问控制的内容。报告是选题辅助，不是平台推荐或收入预测。

| 数据源 | 采集内容 | 主要用途 | 当前边界 |
| --- | --- | --- | --- |
| 番茄小说 | 公开榜单、题材、标题、作者和摘要 | 网文题材与开篇趋势 | 公开页面和摘要，不抓付费全文 |
| 飞卢小说 | 公开点击/热度榜单元数据 | 男频题材、节奏和标题研究 | 以公开可访问字段为准 |
| 红果/抖音漫剧 | 公开漫剧热榜和题材信息 | 漫剧选题、短周期热点和分发参考 | 不绕过登录或平台限制 |
| 晋江文学城 | 公开榜单摘要和题材信息 | 女频关系、情绪线和题材研究 | 仅使用公开元数据 |
| 起点中文网 | 公开月票/排行摘要 | 长篇男频、升级和追更趋势 | 不抓取付费章节 |
| 七猫小说 | 公开排行和题材信息 | 大众网文题材与商业化观察 | 以公开页面字段为准 |
| 手动录入榜单/社会热点 | 用户补充的榜单、链接或观察 | 纳入无法自动采集的来源和个人判断 | 需要用户确认来源和时效 |

### 产物、版本、Ontology 与验收

| 能力 | 已有设计与用途 |
| --- | --- |
| 候选与采纳 | 生成内容先作为候选；作者决定哪些内容进入正式项目事实 |
| 产物版本 / 回滚 | 保存修订历史、版本与关联 Run，支持回看与恢复 |
| 项目快照 / 复制 / 回放 | 试另一条故事路线前留存状态，复盘从输入到交付的过程 |
| Writing Ontology | 用对象与关系表达核心梗、人物、大纲、伏笔、期待与故事图 |
| Action 写路径 | 已映射核心类型经校验 Action 修改并物化；拒绝绕过约定的直接写入 |
| 确定性 Gate | 检查结构、字段、字数、引用和业务条件；具体覆盖随岗位而异 |
| Done Contract | 完成需要满足当前 Run 的产物与检查条件；不能靠口头“done”替代 |
| Receipt | 将产物、版本和完成证据关联到执行结果，便于回放与核查 |
| 人工确认位 | LogicAck、采纳及关键决策保留人工判断，不能把模型自评当终审 |

**Ontology 的作用**：把核心梗、人物、大纲、伏笔、故事图收成可查询的对象与关系；关键改动走校验过的 Action 再物化产物，并与 Gate / 版本 / 采纳配合。它增强的是**项目事实与写路径的可检查确定性**（谁改了什么、引用哪一版、依赖是否失效），不是让 LLM 采样更准，也不是因果推断引擎。详见 [Writing Ontology](./docs/architecture/06-writing-ontology.md)。

### 知识库、参考资料与记忆

- **方法论知识库**：`knowledge/` 保存课程与写作方法的蒸馏内容，供 Agent 搜索和按需读取，不把全部材料塞进每次请求。
- **上传与拆书**：文档、标签、文件夹、分析报告、桥段、相似内容与图谱；知识库可嵌入主应用，也有独立薄壳。
- **项目绑定与引用**：把参考材料绑定到项目；支持按来源和范围读取，缩小串项目、用错版本的风险。
- **项目 bible**：存放已确认设定，和聊天推测、候选写作、个人偏好分开。
- **记忆分层**：项目事实、用户偏好、岗位经验分域；热温冷组织、搜索、CAS 合并与提案机制支持跨 Run 工作。
- **长任务上下文**：稳定前缀、工具结果微压缩、摘要、Handoff 和近期工具往返保护；压缩后仍需保留约束与证据。
- **热点与联网**：返回可核验的来源链接和时间；搜索不可用或缺少来源时如实暴露状态。抓取限公开、授权与摘要场景，不把付费全文抓取作为默认功能。

#### 导出到 LLM Wiki

仓库内置了一个无外部服务依赖的导出适配器。它读取 `knowledge/`，不改写原文，将 113 篇分类蒸馏文档导出为带 frontmatter 的 LLM Wiki `raw/` 来源包，同时生成 manifest、分类索引和提示词/版权边界报告。

```bash
node scripts/llmwiki-export.mjs --out llmwiki-export --force
node scripts/llmwiki-export.mjs check --out llmwiki-export
```

把 `llmwiki-export/raw/` 交给 LLM Wiki 的 raw/ingest 流程。`00-meta` 不作为知识正文导入；`15-prompts` 会标记为 `kind: prompts`，只能作为受控参考资料，不能当作系统指令执行。详见 [LLM Wiki 导出包](./llmwiki-export/README.md) 和 [来源边界报告](./llmwiki-export/reports/content-boundaries.md)。

# 私有 LLM Wiki 导出包（不随本仓库分发）

导入项目的蒸馏知识库

https://github.com/VanGong1999/ai-commerical-writing-knowledgebase

方法参考此仓库当中的README

### 工作台、评测与交付

| 入口 | 可以做什么 |
| --- | --- |
| Web 创作台 | 按格式创建项目、查看阶段地图、编辑产物、管理素材和质量检查 |
| Agent / Run / Job 面板 | 看执行步骤、上下文清单、工具结果、用量与任务状态；暂停、停止、追问和恢复 |
| 质量评测 | 评分细则、评测集、运行、Case 池、人工标注与 A/B 对比；有入口不等于已有可靠模型排行榜 |
| 用量 / 看板 / 活动 | 按项目、岗位和运行记录消耗与活动，辅助定位重复返工 |
| Prompt / Skill 管理 | 六格式 Prompt pack、锁定规则与可调指令、技能按需加载 |
| 导出与翻译 | 投稿内容支持 TXT / Markdown / DOCX / PDF 导出，另有英文翻译接口；终稿与翻译仍需校对 |
| 飞书 | 私聊、群聊 @、进度、任务提议和确认卡片；与 Web 使用同一项目底盘 |
| 本机 CLI `xzm` | 栈启停、项目、产物、Agent、对话、任务、记忆、知识库、导出和用量 |

## 工程如何约束模型

**可以显著降低错误发生与扩散的概率，但不能保证模型不犯错。** 更实际的目标是：错误尽量在执行前被发现，失败能说明原因，已完成的工作可保留，危险动作不能靠一句模型输出就发生。

Session 暴露过的问题（参数漂移、空转不交付、假完成、上下文串版、写入结果未知、429 放大、多 Agent 转述无依据等）、当前防线与「接下来值得完善」见：

→ [现存问题 · Session 暴露的问题与防线](./docs-public/现存问题.md#3-session-暴露的问题与防线)

方法论与实现入口：[Runtime 契约](./docs/agents/12-runtime-contract.md)、[上下文与可靠性](./docs/agents/13-context-engineering-and-reliability-notes.md)、[历史加固复盘](./docs/agents/15-goal-hardening-incident-report.md)。

## 一次写作任务怎样运行

```mermaid
flowchart TD
    A[作者 · Web / 飞书 / CLI] --> B[总编 / 项目控制面]
    B --> C[确认与授权]
    C --> D[持久化 Job / AgentRun]
    D --> E[Node Agent Worker]
    E --> F[加载岗位 Skill 与项目事实]
    F --> G[全局 LLM 请求闸]
    G --> H[模型 API]
    H --> I[参数与权限校验]
    I --> J[业务工具 / Ontology Action]
    J --> K[产物版本 / 记忆 / 运行证据]
    K --> L{完成合同满足?}
    L -->|尚未满足且可修复| G
    L -->|满足| M[收据 / 候选交付 / 作者确认]
    E --> N[Session 日志 / checkpoint / 心跳]
```

Agent loop、网关、编排、队列与定时采用仓库自研实现；不以 LangGraph、DeepSeek Harness 或 Pi SDK 作为运行时依赖。可以借鉴 Agent Harness 的设计思想，但框架名字不是交付可靠性的证据。

### Always-on：随时能接任务，不等于一直烧 Token

收件箱、调度器和通知机制保持待命；有消息、到期任务或运行结果时再推进工作。模型调用发生在具体处理轮次中。自动扫描、自动回复、审批超时和信任等级会影响实际行为，部署前应核对设置；**不能把“有人工确认设计”理解为所有动作都必然手动批准**。

Web、飞书与 CLI 共享控制面。跨进程模型容量通过 Redis 协调；Redis 不可用时的内存回退仅保证当前进程内控制，不是跨机器限流器。

## 模型选型、限流、并发与成本

正式写稿推荐 **DeepSeek**（日常 `deepseek-flash`）。本仓库短时间多轮 tool loop 对易限流 API（如 MiniMax）压力很大；DeepSeek 日常建议全局闸 **8**、Worker **4**，其它易限流 API 先 **≤2**。

完整说明（四种并发数量、本机请求频率与 429 口径、M4 配置、任务成本、自动回复/确认卡、是否换 Kimi/GLM）见：

→ [模型选型、限流、并发与自动回复](./docs-public/模型选型限流并发与自动回复.md)

## 快速启动

主交付是**本地单用户 Web 工作台**，飞书为可选入口；`apps/desktop` 保留旧壳，不作为本次推荐的桌面安装路径。部分早期文档仍有桌面、多租户或重复执行路径的历史描述，以现行执行器和本 README 的范围说明为准。

需要 Node.js 22.6+、pnpm、Python 3.12+、uv；默认基础设施只启动 Redis。

### 需要配置哪些 API

写稿链路本质上走 **OpenAI 兼容** 的 Chat Completions（`base_url` + `api_key` + `model`）。只要服务商提供同类接口，大部分云端模型都可以接进来；也支持本机 Ollama 等兼容端点。网关额外对 DeepSeek / MiniMax 做了命名路由，其它厂商一般用「OpenAI 兼容」槽位或设置页自定义服务商即可。

| 配置项 | 是否必需 | 怎么配 | 说明 |
| --- | --- | --- | --- |
| **聊天模型（LLM）** | **必需** | `.env` 的 `DEEPSEEK_*` / `MINIMAX_*` / `OPENAI_COMPAT_*`，或 Web **设置 → AI 服务商** | 填 Base URL、API Key、模型 ID；启动后以设置页当前默认为准 |
| Redis | 本地推荐 | `pnpm docker:up`（读 `REDIS_URL`） | 跨进程队列与流量闸；无 Redis 时能力会降级 |
| 联网搜索 | 可选 | 优先用已启用且带搜索能力的 Provider；或 `BOCHA_API_KEY` / `SERPER_API_KEY` | 未配置时界面会显示「联网搜索未启用」 |
| Embedding | 可选 | `EMBEDDING_BASE_URL` + `EMBEDDING_API_KEY` + `EMBEDDING_MODEL` | 知识库语义检索；未配时走内存/hash 回退，不等于完整向量库 |
| 飞书 | 可选 | `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 另开 `pnpm dev:feishu`；与模型 Key 无关 |
| MinIO / Milvus | 可选 | `pnpm docker:up:heavy` | 对象存储与向量库；默认本地上传即可跑通 |
| 榜单爬虫 Cookie | 可选 | `CRAWLER_COOKIE_*` 或爬虫页粘贴 | 仅公开榜摘要；遇反爬再填 |

**推荐起步（DeepSeek）**——正式写稿更稳；限流与并发说明见上文链接：

```dotenv
DEEPSEEK_API_KEY=填写你的密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
LLM_DEFAULT_PROVIDER=deepseek
```

**其它 OpenAI 兼容模型**（Kimi、智谱 GLM、通义、硅基流动、OpenRouter、自建 vLLM/Ollama 等）：

```dotenv
OPENAI_COMPAT_API_KEY=填写你的密钥
OPENAI_COMPAT_BASE_URL=https://你的兼容端点/v1
OPENAI_COMPAT_MODEL=填写模型ID
LLM_DEFAULT_PROVIDER=openai_compat
```

也可在 **设置 → AI 服务商** 直接新增/启用 Provider（Base URL + Key + 模型列表），不必只改 `.env`。已有数据库时，以设置页里的默认服务商为准；`.env.example` 仍可能保留历史 MiniMax 默认值。不要把密钥写进命令行历史、前端 `VITE_` 变量或文档。

兼容接口只保证请求形态接近；工具调用、严格 JSON、流式、`usage`/缓存字段、限流码仍因厂商而异。多 Agent 场景请先降本机并发再试，详见 [模型选型文档](./docs-public/模型选型限流并发与自动回复.md)。

```bash
pnpm install
cp .env.example .env
# 按上一节填好至少一组 LLM Key
```

```bash
# 基础设施
pnpm docker:up

# 分别在终端运行
pnpm dev:api
pnpm dev:worker
pnpm dev:agent-worker
pnpm dev:web
```

- Web：[http://127.0.0.1:5173](http://127.0.0.1:5173)
- API 文档：[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- Node `agent-worker` 执行 Agent；Python `job-worker` 处理知识库等非 Agent 后台任务，不承担同一套 Agent 的备用执行器。
- 无 Redis 时 Node Worker 可通过 API 领取持久化 Job，但跨进程流量治理与通知能力不能假装等同 Redis 模式。
- MinIO / Milvus 为可选 heavy 基础设施；回退的本地上传、内存/hash 检索不应宣称等同完整对象存储和语义向量服务。

本机 API 默认回环访问。Docker app profile 需要配置至少 32 字符的 `LOCAL_API_TOKEN`；访问控制、代理与端口规则见 [本机访问边界](./docs/agents/11-local-access.md)。

### 可选：飞书与定时任务

在飞书创建企业自建应用、启用机器人、申请收发消息与卡片所需权限，订阅 `im.message.receive_v1` 和 `card.action.trigger`，采用 WebSocket 长连接。密钥只填 `.env` 的 `FEISHU_APP_ID / FEISHU_APP_SECRET`。

```bash
pnpm dev:feishu
pnpm dev:scheduler
```

飞书通过出站 HTTPS/WSS 连接，不必为收消息额外开放公网 Webhook。群聊默认 `mention` 策略，需要 @ 机器人。自动回复、确认超时与信任等级请按自己的授权边界配置。详见 [飞书说明](./services/feishu/README.md)。

## 给开发者的地图

| 目录 | 职责 |
| --- | --- |
| `apps/ai-writing` | 主 Web：项目、创作台、同事、评测、设置与用量 |
| `apps/knowledge-base` | 可独立启动的知识库薄壳，与主应用共用能力 |
| `packages/domain` | 共享类型、业务 Schema 与规则 |
| `packages/agent-runtime` | Agent / Skill 目录、Stage、完成合同、Session 与安全策略 |
| `packages/ontology` | 写作对象、关系与 Action 注册表 |
| `packages/prompt-registry` | Prompt 模板、格式包与锁定规则 |
| `packages/llm-gateway` | 模型协议、重试、Provider 路由与响应解析 |
| `packages/ui` | 设计变量与共用界面组件 |
| `packages/cli` | 本机控制与 Headless 对话 |
| `services/api` | 项目控制面、任务生命周期、Ontology、知识库与流量治理 |
| `services/agent-worker` | Node 模型工具循环、子任务与交付证据 |
| `services/job-worker` | 知识库与非 Agent 后台作业 |
| `services/feishu` / `services/scheduler` | 可选 IM 与定时唤醒 |
| `knowledge` | 写作方法论蒸馏材料 |

共享 Gate 的执行与兼容规则见 [唯一规则实现](./docs/agents/10-shared-gate-engine.md)。更多入口见 [文档索引](./docs/README.md)、[Agent 拆分规格](./docs/agents/04-fine-grained-agents-skills-tools.md)。

### CLI 与验证命令

```bash
pnpm dev:cli
pnpm xzm --help
pnpm xzm projects list
pnpm xzm providers list
pnpm xzm settings llm-traffic
pnpm xzm tasks summary
pnpm xzm usage summary

# 开发检查：按改动范围选择，不代表本次文档更新重新跑过全量用例
pnpm check:agents-launchable
pnpm check:skill-gates
pnpm check:stage-graphs
pnpm --filter @xiezuomanju/agent-worker check:syntax
pnpm --filter @xiezuomanju/agent-worker test
pnpm test:agent-runtime
pnpm test:api
pnpm typecheck
pnpm build
```

有真实 API 的 E2E 会产生费用和测试项目。静态目录检查、Mock 测试、实际供应商调用和作者质量验收应分开报告；曾经全绿的历史记录不保证当前任意分支都全绿。

## 技术债与下一步

→ [现存问题与下一步](./docs-public/现存问题.md) · [已经修复问题](./docs-public/已经修复问题.md)

## 项目定位：值得关注，但请带着预期阅读

这不是一个把聊天窗口换成漂亮外壳的 Demo。它选择的是一个更难、也更有长期价值的方向：**把商业写作拆成项目事实、创作阶段、专职 Agent、可追踪产物、质量门禁和可恢复运行**。这个选材有技术吸引力，因为它同时触及 Agent 编排、状态机、工具调用、持久化、版本控制、成本与限流治理，以及创作者真正关心的“能不能继续改、能不能找回依据”。

诚实地说，它的吸引力目前主要来自 **问题选择和工程野心**，而不是“已经证明生成内容比所有模型都好”。148 个 Agent、137 个 Skill 和六种格式是覆盖面，不是质量保证；写作审美、长篇一致性、平台适配和最终商业价值仍需要人工验收。项目也仍有契约统一、可观测性、并发长跑和真实作品 A/B 评测等技术债。

因此，最适合给它的定位是：**一个面向 AI 写作生产流程的、正在开发中的工程型开源项目**。如果你关心“怎样把模型的不确定性约束在可检查的工作流里”，它值得 Star 和 Fork；如果你只想要开箱即用、稳定交付的成稿服务，则应先看清当前的 Early Preview 边界。

## 支持作者与后续更新

如果这个项目对你的研究、创作或工程实践有帮助，欢迎：

- 给仓库点一个 **Star**，让更多关注 AI Agent 工程的人看到它；
- Fork 后提交可复现的改进、测试或文档；
- 通过 Issue 或邮件反馈具体 Session、错误日志和真实作品结果。

也可以通过以下方式联系或支持作者：

| 个人微信 | 公众号 | 微信支付 | 支付宝 |
| :---: | :---: | :---: | :---: |
| ![个人微信](./docs-public/sponsor/wechat-friend.jpg) | ![公众号](./docs-public/sponsor/wechat-official.jpg) | ![微信支付](./docs-public/sponsor/wechat-pay.jpg) | ![支付宝](./docs-public/sponsor/alipay.jpg) |
