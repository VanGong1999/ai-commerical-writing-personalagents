import type { RunStepItem } from "../../api/client";

const TOOL_LABELS: Record<string, string> = {
  // 总编
  search_tools: "检索可用工具",
  invoke_tool: "调用扩展工具",
  search_agents: "检索创作 Agent",
  list_agents: "列出创作 Agent",
  search_knowledge: "检索写作知识库",
  list_projects: "列出项目",
  get_project: "读取项目详情",
  create_project: "新建项目",
  list_artifacts: "列出产物",
  adopt_artifact: "采纳产物",
  run_agent: "运行创作 Agent",
  create_fleet: "创建多智能体编排",
  subagent_spawn: "派生子智能体",
  get_stage_graph: "读取阶段图",
  list_proposals: "查看系统提案",
  approve_proposal: "批准系统提案",
  cowrite: "共写 / 润色",
  read_memory: "读取项目记忆",
  write_memory: "写入项目记忆",
  scratchpad: "会话草稿",
  schedule_task: "创建定时任务",
  crawl_hotspots: "抓取热点榜单",
  navigate: "跳转页面",
  plan: "制定分阶段计划",
  ls: "列出目录",
  read: "读取文件",
  write: "写入文件",
  edit: "编辑文件",
  grep: "搜索文件内容",
  find: "查找文件",
  follow_up: "设置跟进闹钟",
  agent_status: "查询任务状态",
  stop_agent: "停止子 Agent",
  steer_agent: "给子 Agent 追加指令",
  start_async_task: "启动后台任务",
  check_async_task: "查询后台任务进度",
  update_async_task: "调整后台任务",
  cancel_async_task: "取消后台任务",
  list_async_tasks: "列出后台任务",
  // 创作 Agent
  "artifact.create": "创建产物",
  "artifact.list": "列出产物",
  "artifact.update": "更新产物",
  "diff.artifacts": "产物对比",
  "export.doc": "导出文档",
  "gate.run": "运行门禁检查",
  done_check: "完成度检查",
  stage_lock: "锁定阶段",
  "bible.read": "读取设定圣经",
  "bible.write": "更新设定圣经",
  memory_search: "搜索记忆",
  memory_read: "读取记忆",
  memory_write: "写入记忆",
  payoff_ledger: "伏笔台账",
  kb_search: "检索知识库",
  kb_read: "读取知识库文档",
  kb_write_report: "撰写拆书报告",
  web_search: "联网搜索",
  skill_list: "查看技能目录",
  skill_read: "阅读技能书",
  tool_search: "搜索工具",
  tool_schema_get: "查看工具用法",
  tool_invoke: "调用工具",
  fs_ls: "列出目录",
  fs_read: "读取文件",
  fs_write: "写入文件",
  fs_edit: "编辑文件",
  fs_grep: "搜索文件内容",
  fs_find: "查找文件",
  "job.enqueue": "提交后台任务",
  job_cancel: "取消后台任务",
  "project.get": "读取项目",
  "usage.log": "记录用量",
  "scan.banned_phrases": "扫描 AI 套话",
  "scan.length": "检查字数",
};

export function toolLabel(name?: unknown): string {
  const raw = String(name ?? "").trim();
  if (!raw) return "未知操作";
  return (
    TOOL_LABELS[raw] ||
    TOOL_LABELS[raw.replace(/_/g, ".")] ||
    TOOL_LABELS[raw.replace(/\./g, "_")] ||
    raw
  );
}

const STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  succeeded: "已完成",
  completed: "已完成",
  failed: "失败",
  error: "出错",
  cancelled: "已取消",
  canceled: "已取消",
  dead: "已终止",
  pending: "待处理",
  processing: "处理中",
  done: "已处理",
  pending_deps: "等待前置任务",
  waiting_approval: "待审批",
  paused: "已暂停",
  active: "生效中",
  released: "已释放",
  expired: "已过期",
};

export function statusLabel(status?: unknown): string {
  const s = String(status ?? "");
  return STATUS_LABELS[s] || s || "未知";
}

export function statusTone(status?: unknown): "ok" | "warn" | "fail" | "default" {
  const s = String(status ?? "");
  if (["succeeded", "completed", "done"].includes(s)) return "ok";
  if (["failed", "error", "dead"].includes(s)) return "fail";
  if (["waiting_approval", "processing", "pending"].includes(s)) return "warn";
  return "default";
}

const SOURCE_LABELS: Record<string, string> = {
  web: "网页消息",
  feishu: "飞书消息",
  job_done: "子任务完成",
  task_group_done: "任务组完成",
  steer: "追加指令",
  timer: "定时唤醒",
  follow_up: "跟进闹钟",
  watchdog: "看门狗",
  proposal: "系统提案",
};

export function sourceLabel(source?: unknown): string {
  const s = String(source ?? "");
  return SOURCE_LABELS[s] || s || "未知来源";
}

const ARG_LABELS: Record<string, string> = {
  run_id: "任务",
  runId: "任务",
  task_group_id: "任务组",
  project_id: "项目",
  projectId: "项目",
  agent_id: "Agent",
  agentId: "Agent",
  instruction: "指令",
  message: "内容",
  query: "关键词",
  scope: "范围",
  path: "路径",
  pattern: "匹配",
  glob: "文件范围",
  goal: "目标",
  title: "标题",
  format: "体裁",
  kind: "类型",
  approval_mode: "审批模式",
  max_concurrency: "并发数",
  tasks: "子任务",
  members: "成员",
  role: "角色",
  task: "任务描述",
  text: "文本",
  mode: "模式",
  name: "名称",
  content: "内容",
  cron: "执行时间",
  job_type: "任务类型",
  when: "时间",
  note: "备注",
  route: "页面",
  op: "操作",
  key: "键",
  value: "值",
  update_strategy: "方式",
  release: "交回总编",
  artifact_id: "产物",
  proposal_id: "提案",
  type: "类型",
  status: "状态",
  entries: "条目",
  files: "文件",
  tools: "工具",
  agents: "Agent",
  passed: "结果",
  checks: "检查项",
  error: "错误",
  summary: "摘要",
  progress: "进度",
  job_id: "后台任务",
  label: "名称",
  persona: "执行者",
  limit: "数量上限",
  offset: "起始行",
};

const VALUE_LABELS: Record<string, Record<string, string>> = {
  scope: { conversation: "本会话", global: "全局" },
  update_strategy: { enqueue: "排队追加", interrupt: "硬中断重跑" },
  approval_mode: { auto_pilot: "自动推进", checkpoint_gate: "关键节点审批" },
  kind: { multi_book: "多本书", multi_chapter: "多章节", multi_agent: "多智能体" },
  status: STATUS_LABELS,
};

const HIDDEN_KEYS = new Set(["tool", "event", "toolCallId", "tool_call_id", "id"]);

function looksLikeId(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v);
}

export function shortId(v?: string | null): string {
  if (!v) return "";
  return looksLikeId(v) ? v.slice(0, 8) : v;
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export function formatValue(key: string, v: unknown, max = 80): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") {
    if (key === "passed") return v ? "通过" : "未通过";
    return v ? "是" : "否";
  }
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    const mapped = VALUE_LABELS[key]?.[v];
    if (mapped) return mapped;
    if (looksLikeId(v)) return v.slice(0, 8);
    return clip(v, max);
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return "无";
    if (v.every((x) => typeof x === "string" || typeof x === "number")) {
      return clip(v.slice(0, 5).join("、") + (v.length > 5 ? ` 等 ${v.length} 项` : ""), max);
    }
    return `${v.length} 项`;
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const name = obj.title || obj.name || obj.label;
    if (typeof name === "string") return clip(name, max);
    return `${Object.keys(obj).length} 个字段`;
  }
  return clip(String(v), max);
}

export type Field = { label: string; value: string };

export function describeFields(obj: unknown, limit = 6): Field[] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  const out: Field[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (HIDDEN_KEYS.has(k)) continue;
    if (v == null || v === "") continue;
    out.push({ label: ARG_LABELS[k] || k, value: formatValue(k, v) });
    if (out.length >= limit) break;
  }
  return out;
}

function tryParse(s: string): unknown {
  const t = s.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

/** 把工具结果（字符串 / JSON 字符串 / 对象）压成一句人话。 */
export function summarizeResult(value: unknown, max = 140): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const parsed = tryParse(value);
    if (parsed === undefined) return clip(value, max);
    return summarizeResult(parsed, max);
  }
  if (Array.isArray(value)) return value.length ? `返回 ${value.length} 条` : "无结果";
  if (typeof value !== "object") return clip(String(value), max);
  const o = value as Record<string, unknown>;
  for (const k of ["message", "summary", "reply", "text", "error"]) {
    if (typeof o[k] === "string" && o[k]) return clip(String(o[k]), max);
  }
  if (typeof o.passed === "boolean") {
    const checks = Array.isArray(o.checks) ? `（${o.checks.length} 项检查）` : "";
    return `${o.passed ? "检查通过" : "检查未通过"}${checks}`;
  }
  for (const k of ["tools", "agents", "entries", "files", "items", "results", "groups", "runs"]) {
    if (Array.isArray(o[k])) {
      const arr = o[k] as unknown[];
      const label = ARG_LABELS[k] || k;
      if (!arr.length) return `没有找到${label}`;
      const names = arr
        .slice(0, 3)
        .map((x) =>
          x && typeof x === "object"
            ? String((x as Record<string, unknown>).name ?? (x as Record<string, unknown>).title ?? "")
            : String(x),
        )
        .filter(Boolean);
      return `找到 ${arr.length} 个${label}${names.length ? `：${names.join("、")}` : ""}`;
    }
  }
  if (o.project && typeof o.project === "object") {
    const p = o.project as Record<string, unknown>;
    return `项目「${String(p.title ?? "")}」`;
  }
  const fields = describeFields(o, 3);
  return fields.map((f) => `${f.label}：${f.value}`).join("；");
}

export function actorName(actor: string, resolve: (id?: string | null) => { persona: string }): string {
  if (!actor || actor === "chief" || actor === "assistant") return "总编";
  if (actor === "system") return "系统";
  return resolve(actor).persona;
}

const WATCHDOG_REASONS: Record<string, string> = {
  stuck_run: "任务疑似卡住",
  stale_processing: "收件箱消息处理超时",
  subscription_unreleased: "订阅未释放",
};

export function describeWatchdog(
  payload: Record<string, unknown> | undefined,
  resolve?: (id?: string | null) => { persona: string },
): { title: string; detail: string } {
  const p = payload || {};
  const reason = String(p.reason || "");
  const title = WATCHDOG_REASONS[reason] || reason || "告警";
  const who = p.agentId && resolve ? resolve(String(p.agentId)).persona : "";
  let detail = "";
  if (reason === "stuck_run") {
    detail = `${who || "子 Agent"} 已运行超过 ${p.minutes ?? "?"} 分钟仍未结束${p.noProgress ? "，且长时间没有新进展" : ""}`;
  } else if (reason === "stale_processing") {
    detail = `一条「${sourceLabel(p.source)}」处理超过 ${p.timeoutMinutes ?? "?"} 分钟，已标记为失败`;
  } else if (reason === "subscription_unreleased") {
    detail = `告警记录时，任务已${statusLabel(p.runStatus)}，对「${String(p.threadKey ?? "")}」的订阅尚未释放`;
  } else {
    detail = describeFields(p, 3)
      .map((f) => `${f.label}：${f.value}`)
      .join("；");
  }
  return { title, detail };
}

export function describeInboxPayload(source: string, payload: Record<string, unknown> | undefined): string {
  const p = payload || {};
  if (typeof p.message === "string" && p.message) return clip(p.message, 120);
  if (typeof p.text === "string" && p.text) return clip(p.text, 120);
  if (source === "job_done" || p.run_id || p.runId) {
    const st = p.status ? statusLabel(p.status) : "";
    const run = shortId(String(p.run_id || p.runId || ""));
    return [run ? `任务 ${run}` : "", st].filter(Boolean).join(" · ");
  }
  if (source === "task_group_done") {
    const title = p.title || p.task_group_title || "";
    return `任务组${title ? `「${String(title)}」` : ""}${p.status ? ` ${statusLabel(p.status)}` : "已结束"}`;
  }
  const fields = describeFields(p, 3);
  return fields.map((f) => `${f.label}：${f.value}`).join("；");
}

export function durationLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} 小时 ${m % 60} 分`;
  return `${Math.floor(h / 24)} 天`;
}

export function sinceLabel(iso?: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  if (Number.isNaN(t)) return "";
  return durationLabel(Date.now() - t);
}

export function timeLabel(iso?: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString("zh-CN", { hour12: false });
}

export function cronLabel(cron?: string | null): string {
  if (!cron) return "";
  if (cron.startsWith("once:")) return `一次性 · ${timeLabel(cron.slice(5))}`;
  const every = cron.match(/^(\d+)([smhd])$/);
  if (every) {
    const unit = { s: "秒", m: "分钟", h: "小时", d: "天" }[every[2] as "s" | "m" | "h" | "d"];
    return `每 ${every[1]} ${unit}`;
  }
  const parts = cron.split(/\s+/);
  if (parts.length === 5) {
    const [min, hour, dom, mon, dow] = parts;
    if (dom === "*" && mon === "*" && /^\d+$/.test(min) && /^\d+$/.test(hour)) {
      const hhmm = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
      if (dow === "*") return `每天 ${hhmm}`;
      return `每周(${dow}) ${hhmm}`;
    }
    if (min === "0" && hour === "*") return "每小时整点";
  }
  return cron;
}

// —— 过程步骤：把 tool_call / tool_result 配对成一条 ——

export type StepEntry = {
  key: string;
  actor: string;
  kind: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  done: boolean;
  runId?: string | null;
  createdAt: string;
  raw: RunStepItem;
};

export function pairSteps(steps: RunStepItem[]): StepEntry[] {
  const out: StepEntry[] = [];
  const openByCallId = new Map<string, StepEntry>();
  for (const s of steps) {
    const p = s.payload || {};
    const tool = String(p.tool || p.name || "");
    const callId = String(p.toolCallId || p.id || "");
    if (s.kind === "tool_call") {
      const entry: StepEntry = {
        key: s.id,
        actor: s.actor,
        kind: s.kind,
        tool,
        args: (p.args as Record<string, unknown>) || undefined,
        done: false,
        runId: s.runId,
        createdAt: s.createdAt,
        raw: s,
      };
      out.push(entry);
      if (callId) openByCallId.set(callId, entry);
      continue;
    }
    if (s.kind === "tool_result") {
      const result = p.detail ?? p.preview ?? p.result ?? p.content;
      let target = callId ? openByCallId.get(callId) : undefined;
      if (!target) {
        for (let i = out.length - 1; i >= 0; i--) {
          const e = out[i];
          if (e.kind === "tool_call" && !e.done && e.actor === s.actor && e.tool === tool) {
            target = e;
            break;
          }
        }
      }
      if (target) {
        target.result = result;
        target.done = true;
        if (callId) openByCallId.delete(callId);
        continue;
      }
      out.push({
        key: s.id,
        actor: s.actor,
        kind: s.kind,
        tool,
        result,
        done: true,
        runId: s.runId,
        createdAt: s.createdAt,
        raw: s,
      });
      continue;
    }
    out.push({
      key: s.id,
      actor: s.actor,
      kind: s.kind,
      tool: tool || undefined,
      args: (p.args as Record<string, unknown>) || undefined,
      result: p.preview ?? p.message ?? p.text ?? p,
      done: true,
      runId: s.runId,
      createdAt: s.createdAt,
      raw: s,
    });
  }
  return out;
}

export const STEP_KIND_TITLES: Record<string, string> = {
  context:"本次上下文",
  gate:"质量检查",
  gates:"质量检查结果",
  policy:"恢复判断",
  subagent:"子任务协作",
  usage:"用量记录",
  recovery:"恢复执行",
  ledger:"操作记录",
  steer:"追加指令",
  model_call:"请求模型",
  model_response:"模型返回",
  compaction:"整理历史上下文",
  handoff:"任务交接",
  done_check:"完成条件检查",
  repair:"修复问题",
  tool_clear:"调整工具上下文",
  run_start:"开始任务",
  run_end:"结束任务",
  receipt:"交付记录",
  thinking: "思考",
  dispatch: "派发任务",
  agent_status: "任务状态更新",
  bash: "执行命令",
  reply: "回复",
  error: "出错",
  watchdog: "看门狗告警",
};

export function entryTitle(e: StepEntry): string {
  if (e.kind === "tool_call" || e.kind === "tool_result") return toolLabel(e.tool);
  if (e.kind === "watchdog") return describeWatchdog(e.raw.payload).title;
  return STEP_KIND_TITLES[e.kind] || (e.tool ? toolLabel(e.tool) : e.kind);
}

/** 工具返回的 detail 里常重复 tool 名，过滤后再总结 */
export function entryResultText(e: StepEntry): string {
  if (e.kind === "watchdog") return describeWatchdog(e.raw.payload).detail;
  if (e.kind === "model_response") return `已返回${Array.isArray(e.raw.payload?.tool_calls) ? e.raw.payload.tool_calls.length : 0} 个工具调用；完整内容可展开查看`;
  if (e.result == null) return "";
  if (e.result && typeof e.result === "object" && !Array.isArray(e.result)) {
    const { tool: _t, ...rest } = e.result as Record<string, unknown>;
    if (!Object.keys(rest).length) return "已完成";
    return summarizeResult(rest);
  }
  return summarizeResult(e.result);
}
