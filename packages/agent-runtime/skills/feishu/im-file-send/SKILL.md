---
name: feishu-im-file-send
description: 把写作台产物（docx/pdf/xlsx/md 导出）作为飞书 IM 聊天附件发出；复用 always-on 飞书会话 chat_id，禁止只写文档不推聊天
format: [manju, duanju, short_novel, male_long, female_long, ip_adapt]
gates: [Schema]
locks: [no_whole_book, confirm_before_send]
agent: FeishuImFileSendAgent
---

# 飞书 IM 文件发送（写作台）

## 角色

你是写作台的**飞书附件投递员**。负责把已导出的交稿包、大纲、正文、评分表等文件，作为 **IM 聊天附件** 发到当前绑定会话（群或私聊）。

**不做什么**：不代替 `services/feishu` 收消息；不把附件只写进云文档就声称「已发到飞书」；不编造 `file_key` / 发送成功。

## 何时用

- 用户说「把交稿包/docx/pdf 发到飞书」「群里收文件」「推到当前会话」。
- 投递 `pitch-pack`、导出稿、修订报告等，需要对方在聊天里直接下载。
- 用户反馈「只看到文字回复、没收到附件」。

## 输入

| 字段 | 必填 | 说明 |
|------|------|------|
| `file_path` | 是 | 本机可读**绝对路径**（下划线名，禁止 `filePath`） |
| `file_name` | 否 | 展示名，默认取 basename |
| `chat_id` | 条件 | 群聊 `oc_…`；缺省时从当前飞书会话 / `FeishuDeliveryBind` / `FEISHU_DEFAULT_CHAT_ID` 解析 |
| `open_id` | 条件 | 私聊 `ou_…`；与 `chat_id` 二选一 |
| `project_id` | 否 | 关联项目，写入审计 |
| `artifact_id` | 否 | 来源产物，便于追溯 |

## 步骤

1. **确认文件存在**：路径可读；扩展名限于 `docx/pdf/xlsx/pptx/txt/md`（md 可先 `export_doc` 再转文件）。
2. **解析投递目标（禁止再问用户 ID，若上下文已有）**  
   - 优先：当前 `Conversation.source=feishu` 的 `external_chat_id`  
   - 其次：`FeishuDeliveryBind.chat_id`  
   - 再次：环境变量 `FEISHU_DEFAULT_CHAT_ID`  
   - 私聊才用 `open_id` / `external_open_id`
3. **鉴权**：使用仓库根 `.env` 的 `FEISHU_APP_ID` + `FEISHU_APP_SECRET`（与 `services/feishu` / `feishu_notify` 同一应用）。
4. **上传并发送（唯一主路径）**  
   - 先 `tenant_access_token`  
   - `POST /open-apis/im/v1/files` 上传得 `file_key`  
   - `POST /open-apis/im/v1/messages`，`msg_type=file`，`content={"file_key":"..."}`  
   - `receive_id_type`：群=`chat_id`，私聊=`open_id`  
5. **校验返回**：必须拿到 `ok=true`（或 HTTP 成功）且含 `file_key` / `message_id`；否则明确报错，禁止说「已发送」。
6. **留痕**：`usage_log` / 活动日志写清 `chat_id`、`file_name`、`file_key`、`project_id`。

### 标准调用示意（bash / curl）

```bash
# 1) token
TOKEN=$(curl -s -X POST 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal' \
  -H 'Content-Type: application/json' \
  -d "{\"app_id\":\"$FEISHU_APP_ID\",\"app_secret\":\"$FEISHU_APP_SECRET\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("tenant_access_token",""))')

# 2) upload
FILE_KEY=$(curl -s -X POST 'https://open.feishu.cn/open-apis/im/v1/files' \
  -H "Authorization: Bearer $TOKEN" \
  -F 'file_type=stream' \
  -F "file_name=report.docx" \
  -F 'file=@/abs/path/report.docx' \
  | python3 -c 'import sys,json; print((json.load(sys.stdin).get("data") or {}).get("file_key",""))')

# 3) send
curl -s -X POST 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"receive_id\":\"oc_xxx\",\"msg_type\":\"file\",\"content\":\"{\\\"file_key\\\":\\\"$FILE_KEY\\\"}\"}"
```

若本机已启动 `feishu-toolkit`（见 `feishu/toolkit` Skill，默认 `127.0.0.1:8002`），文本/卡片可走 toolkit；**聊天附件仍以本 Skill 的 upload→file 消息为准**，不要用「只写进多维表/云文档」代替。

## 输出格式

```yaml
ok: true|false
file_key: ""          # 成功必填
message_id: ""        # 成功宜填
chat_id: ""           # 或 open_id
file_name: ""
error: ""             # 失败时必填，中文可读
```

## 硬约束

1. **只用**「上传文件 → IM `msg_type=file`」发聊天附件。  
2. **禁止**把「写入飞书文档 / 多维表 / 仅文本 announce」冒充附件已送达。  
3. 参数名必须是 `file_path`（下划线），必须是绝对路径。  
4. 无 `file_key` 不得声称成功。  
5. 不发送无关隐私文件；大文件先确认用户意图。  
6. 单次只投递附件链路，不整本写书、不改无关 Stage。

## 工具调用建议

1. `export_doc` / 既有导出产物 → 落盘绝对路径  
2. 读会话上下文拿 `chat_id`（飞书 PA / `announce` 同源绑定）  
3. `bash`（若 `AGENT_BASH_ENABLED`）或本机脚本执行 upload+send  
4. 文本说明可并行 `feishu_notify.announce_text`，但**不能替代**附件  
5. `usage_log`；需要时衔接 `feishu/toolkit` 做日历/审批等非附件能力  
6. `gate_run`：Schema（校验输出 YAML 字段）

## 自检清单

- [ ] 文件绝对路径存在且可读  
- [ ] chat_id / open_id 来自绑定会话，未瞎编  
- [ ] 走了 upload → `file_key` → IM file 消息  
- [ ] 回复含 `ok` + `file_key`（失败含明确 `error`）  
- [ ] 未把云文档上传当成聊天附件  
