# job-worker

消费 Redis `jobs:queue`：`kb.ingest` / `kb.analyze` / 向量化 / 用量汇总等非 agent 任务。

`agent.*` 只由 Node `services/agent-worker` 消费（`jobs:agent`），本进程不处理 agent 任务。

Gate/Skill 真相源在 `packages/agent-runtime`。

```bash
cd services/job-worker && PYTHONPATH=../api:. uv run --project ../api python main.py
```
