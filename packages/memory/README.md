# memory

分层 Markdown 记忆（Anthropic Memory Store + Dreaming）：项目 bible / decisions / journal / semantic / episodic / procedural。

**当前实现（本地单用户定稿）**：

- 内容落在 FastAPI SQLite：`MemoryStore` + `MemoryFile` + `MemoryVersion` + `DreamJob`/`DreamChange`
- 经 `/memory/*` 与 Agent Tools `memory_*` / `memory_merge` 读写
- **content-hash CAS** 乐观并发；Dreaming 为 PR 式 Diff 审查后合入原 Store
- MinIO / Milvus 为 **optional heavy** 增强，不是本地默认必依赖

本包提供路径约定与 Store id helper，避免业务散落 magic path。详见 `docs/architecture/01-memory-system.md`。
