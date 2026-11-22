---
name: duanju-four-shells
description: 故事壳和中点选型，记录付费模式与理由
format: [duanju]
gates: [Schema, ShellGate]
locks: [no_whole_book]
agent: StoryShellAgent
---

# 故事壳选型

对照 want_how、via_what、作者给定的 pay_model 和目标受众，选择故事壳与中点。渠道未定时说明假设或请作者提供付费模式。常见搭配可作为起点，人物壳可围绕成长，目标壳可揭示真实目标，困境壳可改变应对方式，奇遇壳可揭示代价，谜题壳可分层解答。作者可依剧情交叉搭配，也可为付费悬疑设计逐集揭示。

## 输出

用 artifact_create 保存 topic_card，bodyJson 写入以下字段。

```yaml
story_shell: 人物|目标|困境|奇遇|谜题
shell_reason: "本剧选用该壳的具体理由"
pay_model: 重付费|轻付费
midpoint_type: 成长回自己|假目标真目标|错应对对应对|红利代价|找答案→解谜面
```

用返回的 artifactId 运行 Schema 验证字段。ShellGate 可选，用于提示付费模式、中点与故事壳的搭配供作者复核。
