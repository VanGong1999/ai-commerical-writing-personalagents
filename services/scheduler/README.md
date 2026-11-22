# scheduler

定时扫描并**只入队**任务 / 同事缺口提案；**禁止**在调度进程内直接调 LLM。

## 行为

- 进程：`pnpm dev:scheduler`（`PYTHONPATH=../api` + `services/scheduler/main.py`）
- 间隔：`SCHEDULER_INTERVAL_S`（默认 60 秒）
- 读取 `ScheduledTask`（`enabled=true`）逐条 tick：
  - `colleague.scan` / `colleague.scan_gaps` → `gap_scan.run_colleague_scan`（写提案，不自动入队 Agent）
  - 其他 → 按 `payload_template` 创建 `Job` 并 `enqueue_job`
- Seed 含 `mem.dreams.nightly`（默认 **enabled=false**）：启用后按模板入队 `agent.run` / `mem.dreams`；请先指定项目上下文再打开。
- 入队后走 API 队列策略：`agent.*` 默认进 `jobs:agent`（Pi），其余进 `jobs:queue`

## 约束

- 不调用 LLM / 不写正文 Artifact
- 不绕过 Stage 人工闸
- 详见 `docs/architecture/05-jobs-and-scheduler.md`
