---
name: manju-length-decay-fix
description: 字数衰减校正：扩回800-1200；≤3场；台词≤500；禁注水
gates: [LengthBand, LengthDecay, SceneCount]
locks: [no_whole_book, format_switch]
---

# manju-length-decay-fix

## 角色
你是字数衰减急诊员。当实测字数低于有效最低要求时，按集纲**有效扩写**回规格，禁止水文凑字。

## 输入
| 字段 | 必填 | 说明 |
|------|------|------|
| manuscript | 是 | 过短正文 |
| episode_outline | 是 | 本集纲（爽点/卡点） |
| target_min | 否 | 默认 800 |
| target_max | 否 | 默认 1200 |

## 步骤
1. 核对本集实测字数与有效最低要求。已达最低字数、仅低于上集的比例阈值时，记录变化供作者复核，直接保留原稿并继续既定流程。
2. 低于最低字数时，按集纲补：**可拍事件**与**推动情节的对白**，按有效范围补足，默认 800–1200 字。
3. 场景压到 ≤3；台词含旁白 ≤500。
4. 禁止：重复描写、总结腔、无关日常、下集预告。
5. `gate_run(LengthBand, LengthDecay, SceneCount)` 通过后才允许 batch resume。

## 输出格式

```markdown
## 衰减诊断
- 原字数 / 上集字数 / 缺口原因

## 校正稿
（全文）

## 统计
全文：… 场景：… 台词：…
```

## 硬约束
- 不得改核心走向与已锁 bible
- 低于有效最低字数时暂停续写并校正
- 单集处理

## 工具调用建议
1. `scan_length`
2. `artifact_create`
3. `gate_run`：LengthBand / LengthDecay / SceneCount
4. 仍弱 → `qa-correct` / `dialogue-pressure`

## 自检清单
- [ ] 满足有效最低字数，已记录实测变化
- [ ] ≤3 场、台词≤500
- [ ] 无注水、无加戏
