# kb-core

知识库核心逻辑。文档 CRUD/向量检索由 `services/api` stub 提供；本包另提供 **knowledge 元数据索引** 的本地关键词检索（无向量依赖）。

## Knowledge 检索

索引文件：`knowledge/00-meta/search-index.json`（仅元数据，不重复正文）。

```python
from kb_core import load_knowledge_index, search_knowledge

articles = load_knowledge_index()  # 或 loadKnowledgeIndex()
hits = search_knowledge("开篇 悬念", {"category": "04-webnovel", "limit": 5})
# 或 searchKnowledge(...)
```

重新生成索引：`node scripts/build-knowledge-index.mjs`（`--check` 仅校验）。
