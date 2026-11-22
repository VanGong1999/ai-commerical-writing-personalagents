---
name: topic-genre-redblack
description: 根据作者已选题材和现有材料撰写题材参考报告，说明课程词表匹配、市场依据与不确定性
format: [manju, duanju, short_novel, male_long, female_long, ip_adapt]
gates: [Schema, GenreTrimGate]
locks: [no_whole_book]
agent: GenreTagAgent
---

# 题材参考报告

从当前任务、上游产物和作者已确认的要求出发，保留已选题材的原文。作者明确设定的硬约束单独列出。没有选定题材时写明「题材未定」，不要从摘要或标题猜测。

说明材料中有哪些可核实的依据、参考词表命中了哪些词，以及尚待核实的行情或内容。课程推荐只作参考。词表命中不能证明题材饱和、违规或不能投稿。可以提出供作者选择的建议，保留作者决定权。

可选参考检查 GenreTrimGate 使用 `payload.genre` 或 `payload.body.genre` 传入明确选定的题材原文，也可传含 `bodyJson.genre` 的产物 ID。没有该字段时可以跳过；无需为了得到通过结果而改写题材或反复检查。

用 artifact_create 保存本次题材报告，可用 other 类型、标题和可读的 bodyMarkdown。续跑时先核对本次已有报告。用 gate_run 执行 Schema，传入报告的 payload.artifactId，再用 done_check 验收。已有合格报告即可交接。
