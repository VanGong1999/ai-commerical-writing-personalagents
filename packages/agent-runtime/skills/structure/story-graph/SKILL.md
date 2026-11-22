---
name: story-graph
description: 从已确认大纲初始化/更新全剧连续性图（JSON 真相 + Mermaid 视图）
gates: [Schema, GraphConsistency]
locks: [no_whole_book]
---

# story-graph

根据本次派单范围，把大纲中的角色、地点、事件及因果整理为一份可审阅的 `story_graph` 候选。节点、边及角色状态以 JSON 为准，Mermaid 由系统生成。

## 确认本次范围

- 在需要人工确认的阶段，以当前任务输入的 `pipelineStageApproval` 为依据。核对它的 stageId 与 pipelineStageId，保留 messageId 和作者备注。旧派单没有此字段时，查看本次任务“已确认”中是否有操作者明确同意用该大纲继续建图的决定。缺少所需确认时，说明缺哪项，交由原流程处理。
- 已确认继续建图即可交付图谱候选。上游稿件保存时的“待人工确认”、candidate 状态和转述这些文字的压缩摘要只描述当时的稿件。其他阶段沿用当前派单及分支授权范围。项目的 LogicAck 和逐集正文版本确认仍由后续人工流程处理。

## 取证与建图

1. 以当前范围内的逐集大纲为主要依据，总表用于梳理跨集线索。区分上游交付收据的 id/version、本次实际读取的 id/version 和作者备注；记录实际采用的来源。若总表与逐集稿有分歧，采用作者指定的逐集内容，在 openQuestions 记录分歧。若只有交付后改动的版本且无法判定应采用哪版，标明待核的差异。保留作者修改，不将读取新版本当作版本已获审批。
2. 优先使用已取得的内容。只为缺少的事件、关系或角色状态定向读取对应产物；已有图谱供本次修订参考。需要核对未收伏笔时读取 payoff_ledger。各集核心冲突、主要角色和有依据的因果关系已清楚时，下一次调用 artifact_create 保存本次范围的完整候选。剩余创作选择写入 openQuestions。
3. 调用 `artifact_create`，传 `type="story_graph"`、`title`、`bodyMarkdown` 和对象 `bodyJson`。Markdown 简述范围、来源版本及待核事项。JSON 按以下字段填写真实内容：
   - `kind="story_graph"`。在 nodes 为主要角色、关键地点和各集核心事件分配唯一 id，填 kind（character/location/event 等）、label；episodeSpan 为含整数 from、可选 to 的对象，status 取 active/resolved/dormant。
   - edges 的 from、to 均引用已列节点，填写 kind、episode 及有依据的 note。关系可用 causes、enables、blocks、foreshadows、payoff、knows、owns、located。未收的 foreshadows 填 open=true。
   - characterStates 以 characterId 引用角色节点，填写 episode，可按来源填写 location、inventory、knownFacts、emotion 等。同集有转场时写清先后，避免给同一时点互斥的地点。
   - openQuestions、contradictions 分别存放待核问题、已发现的矛盾，均为字符串数组。
4. 用保存成功返回的 artifactId 依次运行 `gate_run` 的 Schema、GraphConsistency（payload.artifactId），再调用 `done_check({})`。按实际回执交接候选和待核事项。保留人工确认权，禁止一次重写全书正文。
