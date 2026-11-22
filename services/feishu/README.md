# 飞书通道（Personal Agent 手机入口）

本地写作工具的飞书 Bot：单聊 / 群聊指挥 Personal Agent，收进度、确认卡片与主动提案。

## 启动

```bash
# 根目录 .env 配置 FEISHU_APP_ID / FEISHU_APP_SECRET
pnpm dev:feishu
```

需同时跑 API / worker / agent-worker（写作任务入队执行）：

```text
pnpm dev:api | pnpm dev:worker | pnpm dev:agent-worker | pnpm dev:web | pnpm dev:feishu
```

`pnpm dev:stack` 会提示上述终端列表。

## 飞书开放平台

1. 创建企业自建应用，开启 **机器人** 能力。
2. 开通收发 IM / 发互动卡片等权限，并**发布应用版本**。
3. 事件订阅选 **长连接**（不要用公网 Webhook），订阅：
   - `im.message.receive_v1`
   - 卡片回调 `card.action.trigger`（互动确认）
4. 把 App ID / Secret 写入仓库根 `.env`（勿提交）。

主仓库总览与服务器步骤见根目录 [`README.md`](../../README.md)「飞书对话」。

## 环境变量

| 变量 | 说明 |
|------|------|
| `FEISHU_APP_ID` | 应用 ID |
| `FEISHU_APP_SECRET` | 应用密钥 |
| `FEISHU_GROUP_POLICY` | `mention`（默认，群聊需 @）或 `always` |
| `FEISHU_DEFAULT_CHAT_ID` | 主动推送默认 chat_id；空则用最近会话绑定 |
| `FEISHU_WATCHDOG_STUCK_MINUTES` | AgentRun 卡住告警分钟（默认 15） |
| `FEISHU_PROGRESS_VERBOSE` | `false` 合并进度；`true` 逐条 tool |

## 服务器部署（飞书对话）

与本地相同的进程模型：API + Python worker + agent-worker + 本服务；**Web 可选**。长连接由本进程主动连飞书，机器只需出网，一般不必为飞书开公网入站。

```bash
# 服务器上（systemd / tmux / pnpm xzm stack up --feishu 均可）
pnpm docker:up
pnpm dev:api && pnpm dev:worker && pnpm dev:agent-worker && pnpm dev:feishu
```

配好模型 Key；验收：私聊机器人 → 有回复 → 短任务有进度与完成推送。

## 行为摘要

- **单聊**：任意文本 → Supervisor。
- **群聊**：默认需 @ Bot；或命中「帮我写 / 生成核心梗…」等写作触发词。
- **控制命令**：`/help` `/status` `/reset` `/project` `/followup`
- **确认**：互动卡片批准/拒绝（也可用文字「批准」「拒绝」）；统一走 `respond_conversation_impl`。
- **主动**：scheduler `gap_scan` 提案 / 定时任务 / AgentRun 完成会 announce 到绑定 chat。
- **会话**：单用户 `demo_user`；按 `external_chat_id` 隔离；`/project` 绑定写作项目（跨 Web/飞书共享记忆）。
- **Markdown**：出站正文/报告用互动卡片 `lark_md` 渲染（纯 `text` 不渲染 MD）；短进度可仍为 text。`FEISHU_PROGRESS_VERBOSE` 控制是否逐条推 tool 进度。

## 模块

| 文件 | 职责 |
|------|------|
| `main.py` | WS 长连接入口 |
| `ingress.py` | 入站过滤与控制命令 |
| `session.py` | Conversation / FeishuIdentity |
| `delivery.py` | 文本/卡片/进度出站 |
| `cards.py` | 确认与提案卡片 |
| `handler.py` | 异步队列、Supervisor、Watchdog |

共享出站：`services/api/app/feishu_notify.py`（scheduler / jobs 也可调用）。
