---
name: feishu-toolkit
description: 飞书办公执行层（日历/消息/审批/多维表/通讯录/考勤）；与写作台 always-on 飞书渠道协作，复用 chat_id/open_id，经本地 toolkit 服务调用
format: [manju, duanju, short_novel, male_long, female_long, ip_adapt]
gates: [Schema]
locks: [no_whole_book, confirm_irreversible]
agent: FeishuToolkitAgent
---

# 飞书办公套件（写作台适配）

## 角色

你是写作台的**飞书能力执行者**：在总编 / PA / 交稿流程里，把「通知、排期、台账、审批」落到飞书 API。

与 `services/feishu`（WebSocket always-on）**分工协作，不是二选一**：

| 角色 | 负责 | 数据 |
|------|------|------|
| `services/feishu` + `feishu_notify` | 收消息、会话绑定、文本/卡片出站、进度 | 提供 `chat_id`、`open_id`、conversation |
| 本 Skill + `feishu-toolkit` 服务 | 日历/会议室、结构化消息、审批、多维表、通讯录、考勤 | **复用**上述 ID，勿再向用户索要 |

**不做什么**：不绕过 toolkit 私自乱调无关开放平台接口（附件发送见 `feishu/im-file-send`）；不 `pkill` 掉已在跑的 toolkit；不把写作正文整本贴进飞书。

## 何时用

- 「查我日程 / 约会议室 / 定交稿截止」  
- 「把结果发到这个群」（有 `chat_id` 时直接发）  
- 「立项跟踪表记一条」「查部门同事」  
- 「发起请假/出差审批」「看打卡」  
- 需要日历/多维表/审批/通讯录/考勤时；纯聊天附件改走 `feishu/im-file-send`

## 输入

| 字段 | 必填 | 说明 |
|------|------|------|
| `action` | 是 | 模块动作，如 `messaging.send` / `calendar.create` / `bitable.record_create` |
| `chat_id` | 条件 | 群投递；优先会话绑定 |
| `open_id` | 条件 | 个人；优先 `sender_open_id` |
| `payload` | 是 | 该动作的业务参数（见 references） |
| `project_id` | 否 | 写作项目关联 |

## 步骤

### 0. 确保 toolkit 服务在跑

仓库路径：`feishu-toolkit/server`。默认 `http://127.0.0.1:8002`。

凭证与写作台共用根目录 `.env`：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- 可选 `FEISHU_APPROVAL_CODES`（审批名→code JSON）

```bash
if curl -s http://127.0.0.1:8002/ping >/dev/null 2>&1; then
  echo "feishu-toolkit ok"
else
  cd feishu-toolkit/server
  # 从仓库根加载 .env 后启动；勿 kill 已有进程
  set -a && source ../../.env && set +a
  nohup uv run uvicorn feishu_toolkit.main:app --host 127.0.0.1 --port 8002 \
    >/tmp/feishu-toolkit-xmj.log 2>&1 &
  # 等待 /ping 就绪（首次装依赖可能较久）
fi
```

**严禁**：`pkill`/`killall` 终止 toolkit；容器里用 `bash` 不要用 `dash`/`sh` 跑 bash 语法。

### 1. 解析身份与会话

- 飞书进线：直接用消息里的 `open_id` / `chat_id`  
- 右下角 PA：查 `FeishuDeliveryBind` / `FEISHU_DEFAULT_CHAT_ID`  
- 「给张三发」：先通讯录搜 `open_id`，再发

### 2. 按模块调用（一律经 8002）

| 模块 | 基路径 | 详情 |
|------|--------|------|
| 日历/会议室 | `/calendar/*` | [calendar.md](../../../../../feishu-toolkit/references/calendar.md) |
| 消息 | `/messaging/*` | [messaging.md](../../../../../feishu-toolkit/references/messaging.md) |
| 审批 | `/approval/*` | [approval.md](../../../../../feishu-toolkit/references/approval.md) |
| 多维表 | `/bitable/*` | [bitable.md](../../../../../feishu-toolkit/references/bitable.md) |
| 通讯录 | `/contacts/*` | [contacts.md](../../../../../feishu-toolkit/references/contacts.md) |
| 考勤 | `/attendance/*` | [attendance.md](../../../../../feishu-toolkit/references/attendance.md) |

示例：

```bash
# 文本通知到当前群
curl -s -X POST http://127.0.0.1:8002/messaging/send \
  -H 'Content-Type: application/json' \
  -d '{"receive_id":"oc_xxx","receive_id_type":"chat_id","msg_type":"text","content":"{\"text\":\"交稿包已就绪\"}"}'

# 多维表记一条项目进度
curl -s -X POST http://127.0.0.1:8002/bitable/...   # 见 bitable.md
```

### 3. 写作台常见编排

1. **交稿提醒**：日历建截止日程（组织者=`open_id`）+ 群消息摘要。  
2. **项目台账**：多维表一行：`project_id` / 书名 / Stage / 字数 / 链接。  
3. **Run 完成**：短文本或卡片；大附件改走 `feishu/im-file-send`。  
4. **审批**：仅用户明确要求时发起；不可逆操作先确认。

### 4. 失败处理

- `/ping` 失败 → 按步骤 0 启动，读 `/tmp/feishu-toolkit-xmj.log`  
- 权限错误 → 提示补齐开放平台权限（见下表），保留请求摘要  
- toolkit 无该能力 → 告知用户，**不要**擅自直打 `open.feishu.cn` 绕过（附件上传例外见 im-file-send）

## 输出格式

```yaml
ok: true|false
module: messaging|calendar|approval|bitable|contacts|attendance
action: ""
request_summary: ""
response:
  # 关键 id 字段，如 message_id / event_id / record_id
error: ""
```

## 硬约束

1. 优先复用渠道已给的 `open_id`/`chat_id`，禁止无故追问。  
2. 办公 API 走 `127.0.0.1:8002`；聊天**文件附件**走 `feishu/im-file-send`。  
3. 不可逆操作（发群广播、提交审批、删日程）需用户确认或 PA 确认流。  
4. 禁止写入整本书正文；只发摘要、链接、台账字段。  
5. 禁止终止已运行的 toolkit 进程来「重启」。  
6. 凭证只读环境变量，禁止写入 Skill / artifact 明文。

## 配置与权限（摘要）

| 模块 | 权限示例 |
|------|----------|
| 消息 | `im:message:send_as_bot` |
| 日历 | `calendar:calendar`；会议室 `vc:room:readonly` |
| 审批 | `approval:approval` 等 |
| 多维表 | `bitable:app`；云空间 `drive:drive` |
| 通讯录 | `contact:contact.base:readonly` 等 |
| 考勤 | `attendance:task:readonly`；常需 `contact:user.employee_id:readonly` |

应用需开启机器人能力，通讯录范围覆盖目标成员，版本已发布。

## 工具调用建议

1. 确认 `/ping`；必要时启动 `feishu-toolkit/server`  
2. `bash` 或 HTTP 调对应模块（白名单内）  
3. 文本也可降级 `feishu_notify.announce_text`（无 toolkit 时）  
4. 附件：`skill_read` → `feishu/im-file-send`  
5. `usage_log`；`gate_run` Schema  
6. 详细字段以仓库 `feishu-toolkit/references/*.md` 为准

## 自检清单

- [ ] 未向用户重复索要已有 chat_id/open_id  
- [ ] 服务 `/ping` 就绪或已说明启动失败原因  
- [ ] 调用的是 8002 模块路径（附件除外）  
- [ ] 输出含 ok + 关键 id 或明确 error  
- [ ] 不可逆操作已经确认  
