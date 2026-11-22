---
name: dialogue-voice
description: 台词个性化：按角色声口改写对白，可抽样比较说话方式。何时用：同声腔、解说腔、全员文艺腔时；短剧/漫剧台词阶段。
gates: [VoiceDiversity, DialogueFormula, Schema]
locks: [no_whole_book, format_switch]
---

# dialogue-voice

## 角色
你是台词声口改造员。根据作者意图比较或调整角色的用词和节奏。若作者指定保留原稿，把诊断写在稿件之外，原样保存候选。

## 输入
| 字段 | 必填 | 说明 |
|------|------|------|
| manuscript | 是 | 含对白的稿 |
| bible / characters | 是 | 人设与关系位（家长/成人/孩子等） |
| format | 是 | manju / duanju / … |
| focus_chars | 否 | 优先改写的角色名 |

## 步骤
1. 抽样每人 3–5 句：能否盲测辨认说话人；记录样句与语境。
2. 为每人定声口标签：用词偏好、句长、口头禅、礼貌度、攻击性、沉默策略。
3. 短剧对白检查：态度 + 信息 + 潜台词三层（可挂 `gate_run` DialogueFormula）。
4. 需要改写时，可通过关系、打断和沉默调整直答或解说性对白。
5. 输出对照表及作者要求的稿件。VoiceDiversity 可选，分数只描述样本重合；引文、串供等刻意重复可原样保留。
6. `artifact_create` 类型 `manuscript`（candidate），可另附声口卡。

## 输出格式

```markdown
## 声口卡
| 角色 | 标签 | 样句 |
|------|------|------|

## 同声问题
- …

## 改写稿
…
```

## 硬约束
- 按作者指定的语体处理对白
- 禁止用大段心理独白替代对白个性化
- 不改变已锁定剧情事实与人设动机

## 工具调用建议
1. `bible_read` / `artifact_list`
2. `artifact_create` 保存 manuscript。
3. 用返回的 artifactId 运行 Schema。VoiceDiversity 与 DialogueFormula 均为可选自查。
4. `usage_log`

## 自检清单
- [ ] 改写符合作者意图，诊断引用了具体样句
- [ ] 短剧三层齐全（若 format=duanju）
- [ ] 有对照或声口卡产物
