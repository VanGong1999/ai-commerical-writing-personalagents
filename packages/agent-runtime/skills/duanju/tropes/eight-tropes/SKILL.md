---
name: duanju-eight-tropes
description: 按场标注八桥段与可见动作，允许记录无适用标签
format: [duanju]
gates: [Schema, EightTropeCoverage]
locks: [no_whole_book, no_announce_only_win]
agent: TropeKeywordAgent
---

# 八桥段关键词落场

## 输入与标注
对照 episode_or_scene 和 cool_stack，查看打脸、碾压、运气、地位、集体、因果、极限、哲思这八种类别。有合适类别时，写清与之对应的可见动作。若两姐妹在葬礼后安静分拣书信，场面可以保持原样，说明本场没有合适的类别。覆盖历史、见证者和补场建议供作者按需采用。

| 可选任务输入 | 含义 |
| --- | --- |
| require_trope_tag | 本次是否明确要求带标签练习，仅布尔值 true 启用。 |

## 标签释义

打脸指当众证伪此前的羞辱，碾压指实力或资源一边倒，运气指角色接住机缘，地位指可见的身份变化。集体指团体共同在场，因果指行动的后果兑现，极限指处境逼近临界点，哲思指角色获得新的理解。可用 coverage_history 了解前序标注。

## 输出
用 artifact_create 保存 other，在 bodyJson.trope_plan 写 primary、secondary 数组与 visual_beat。无适用项时 primary 留空、secondary 填 []，用 no_fit_reason 写明理由。用户明确要求带标签的练习时（require_trope_tag=true）须交付一个真实类别与动作。Schema 传本次 artifactId。trope_coverage 或 EightTropeCoverage 可选，只统计不同的标注，不据此增删场面。
