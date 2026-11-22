# 私有 LLM Wiki 导出包（不随本仓库分发）

本目录导出正文不在公开仓库中。可任选其一：

## 方式 A：从伴生仓库拉取

https://github.com/VanGong1999/ai-commerical-writing-personalagents

```bash
git clone https://github.com/VanGong1999/ai-commerical-writing-personalagents.git /tmp/ai-writing-kb
rsync -a /tmp/ai-writing-kb/llmwiki-export/ ./llmwiki-export/
```

## 方式 B：本地从 knowledge/ 生成

需先准备好 `knowledge/`（见 [`../knowledge/README.md`](../knowledge/README.md)），再执行：

```bash
node scripts/llmwiki-export.mjs --out llmwiki-export --force
node scripts/llmwiki-export.mjs check --out llmwiki-export
```

将 `raw/` 交给 LLM Wiki 的 raw/ingest 流程；先阅读生成后的 `reports/content-boundaries.md`。
