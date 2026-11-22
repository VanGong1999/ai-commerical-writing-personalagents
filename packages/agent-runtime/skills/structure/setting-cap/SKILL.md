---
name: setting-cap
description: 盘点主要设定与次要细节，按需提供收敛建议
format: [duanju, short_novel, male_long, female_long, manju]
gates: [Schema, SettingCap]
locks: [no_whole_book]
agent: SettingCapAgent
---

# 设定收敛（SettingCap）

## 输入与盘点
读取 text 和可选 current_settings，区分支撑主要冲突的设定与次要细节。时间循环的车站、推动剧情的失物账簿和车票的颜色习俗可以分别记录。保留作者的有意选择。如作者给出具体上限，按其指定范围核对，并说明是否达成。

| 可选任务输入 | 含义 |
| --- | --- |
| max_main_settings | 本次提案明确要求的主设定数上限，填非负整数；次要项不计入。盘点已有作品时可省略。 |

## 输出
用 artifact_create 保存 other，在 bodyJson.settings_found 数组逐项写 name 和布尔值 is_main。确实没有设定时可保存空数组，并在 verdict 说明观察依据。可附 merge_hint、cut_hint 或保留理由。Schema 使用本次 artifactId。可选 SettingCap 提供原始数量及分类，默认参考值为两项；由作者决定是否收敛。
