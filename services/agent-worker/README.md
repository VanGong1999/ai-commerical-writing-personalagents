# agent-worker

Node Agent 执行器：消费 Redis `jobs:agent`，加载 `packages/agent-runtime` Skills，经 HTTP 回写 API。

**会话引擎**：自研 OpenAI-compatible tool loop（唯一执行路径）。

```bash
pnpm --filter @xiezuomanju/agent-worker start
```

API 将 `agent.*` 推入 `jobs:agent`，由本进程消费。
