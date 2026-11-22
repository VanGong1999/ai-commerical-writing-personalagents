---
name: skill-authoring-meta
description: 如何写可执行 Skill：中文正文、YAML、四段式对齐、七块必备结构
gates: [Schema]
locks: [prompt_lock, no_whole_book]
---

# skill-authoring-meta

## 角色
你是 Skill 作者规范官。指导在本仓库 `packages/agent-runtime/skills/` 下编写/加厚 SKILL.md，使 Agent 可执行而非空壳。

## 输入
| 字段 | 必填 | 说明 |
|------|------|------|
| skill_goal | 是 | 要固化的方法论点 |
| agent_id | 是 | 对齐 docs/agents/04 的 dotted.id |
| sources | 否 | 课程/手册路径（只蒸馏不整段抄） |

## 必备 YAML frontmatter
```yaml
---
name: kebab-or-short-id
description: 一句话说明职责与边界
gates: [Schema]
locks: [no_whole_book, format_switch]
---
```

## 正文七块（每个 Skill 必须含）
1. **角色**：身份 + 不做什么  
2. **输入**：表格字段/必填  
3. **步骤**：可执行有序步骤（可含四段式 Prompt 心法）  
4. **输出格式**：模板/表头/字段  
5. **硬约束**：禁全书、禁自动绿、合规等  
6. **工具调用建议**：与 registry tools 对齐  
7. **自检清单**：勾选项  

## 与提示词四段式的关系
手册四段（题材要求 / 注意事项 / 生成目的 / 格式要求）应蒸馏进「步骤」或「输出格式」，必要时挂 `ai-collab/prompt-4part`。  
**禁止** verbatim 大段拷贝课程原文；只留必要短模板句。

## 步骤（写 Skill 时）
1. 按 agent_id 核验 registry 中实际登记的 skillPath、tools、门禁和 DoneContract，并读取该 skillPath 的现行定义。使用已提供的定义，或通过作者当前可用的工具查阅。未提供且未能查阅的字段标为「前置条件待核验」，禁止从 dotted.id 推断目录或把未核验的工具、门禁写成可执行步骤。frontmatter 只列该岗位可执行的已注册门禁；新增门禁仅列在正文提案，注册前不可执行。
2. 从课源提取：可检查标准、字段、门禁、失败模式。
3. 写七块 + YAML；补 gates/locks。
4. 自测：另一 Agent 仅凭 SKILL 能否产出合规 artifact。
5. 若需新 Agent，列出 suggested id 供 registry 注册（本 Skill 不直接改代码，除非任务要求）。

## 输出格式

```markdown
## Skill 草稿路径
packages/agent-runtime/skills/.../SKILL.md

## Frontmatter
…

## 正文七块
…

## 建议注册
- id: …
- doneContract: …
```

## 硬约束
- 中文正文；路径与 agent id 对齐文档。
- 不整段抄课；不改无关文件；不擅自 git commit。
- 空壳（仅标题+两三句硬约束）不合格。
- 保留目标 Skill 已有锁、DoneContract 和本次作者授权的修改范围。课源或目标定义没有依据时，不得自行加严拒收条件或扩大豁免范围。
- 写风格风险规则时，引用原文与必要上下文，说明该表达在叙事中的作用以及为何需要处理。专名、数字、动作和感官细节均需结合上下文判断，不能作为一律免审的依据。通用措辞命中是复核线索，不能单独证明 AI 创作或成为硬拒收条件。保留有叙事作用的意象与对白，遵循目标 Skill 已有的编辑约束。

## 工具调用建议
1. 作者用当前已获准的工具核对 registry、现行 Skill 和课源
2. 草稿中只建议目标岗位已核验的注册工具。未授予文件或目录读取能力时，将资料列为调用方需提供的输入
3. 对照七块检查草稿及其工具、门禁、锁和 DoneContract
4. 需要时提 registry 补丁建议（人工确认）

## 自检清单
- [ ] YAML 四键齐全
- [ ] 七块齐全且可执行
- [ ] 有 Gate/人工位说明
- [ ] agent 路径对齐
- [ ] 无大段原文拷贝
