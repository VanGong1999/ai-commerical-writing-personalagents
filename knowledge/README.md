# 私有知识语料（不随本仓库分发）

本目录正文不在公开仓库中。请从伴生仓库拉取后放到此处：

https://github.com/VanGong1999/ai-commerical-writing-personalagents

```bash
# 克隆伴生仓库，再拷入本仓库 knowledge/
git clone https://github.com/VanGong1999/ai-commerical-writing-personalagents.git /tmp/ai-writing-kb
rsync -a /tmp/ai-writing-kb/knowledge/ ./knowledge/
```

无伴生仓库权限时，Agent 的 `kb_search` / `kb_read` 将缺少方法论语料。

拉取后可用：

```bash
node scripts/build-knowledge-index.mjs --check
```
