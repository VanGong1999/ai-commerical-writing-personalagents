# agent-runtime

Agent 注册表、Stage 图、Gate、Skills（`skills/**/SKILL.md`），以及生产级 **Harness** 内核：

| 模块 | 文件 | 作用 |
|------|------|------|
| Done Contract | `doneContract.ts` | 确定性完成门；失败踢回循环 |
| Receipt | `receipt.ts` | 收据 + attestation + narrative |
| Context | `context.ts` | 上下文压缩 / 工具结果微压缩 |
| Security | `security.ts` | readonly / safe / yolo + 路径沙箱 |
| Session | `session.ts` | JSONL 事件日志与崩溃边界 |
| Subagents | `subagents.ts` | scout/planner/worker/reviewer 合同 |
| Policy | `policy.ts` | in-doubt resume/refuse |
| Harness | `harness.ts` | 默认组装配置 |

Agent loop 在 `services/agent-worker`（自研 OpenAI-compatible tool loop）；Python `job-worker` 提供同等业务 Agents 的生产执行路径。

能力清单 API：`GET /api/v1/agents/harness/capabilities`  
方法论对照：`docs/agents/10-harness-production-upgrade.md`
