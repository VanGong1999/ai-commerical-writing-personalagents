/**
 * 工具安全三层：
 * 1) tool call gating（allow / ask / deny）
 * 2) protected paths（永不写入）
 * 3) 模式：readonly / safe / yolo
 * 4) 可插拔 PolicyGate 栈（policy.gates）：不变量闸门，yolo 下也生效
 *    deny 立即短路；ask 取最严；顺序 = 数组顺序（稳定、可测）。
 */

export type SecurityMode = "readonly" | "safe" | "yolo";

export type SecurityDecision = "allow" | "ask" | "deny";

export type SecurityVerdict = {
  decision: SecurityDecision;
  reason: string;
  mode: SecurityMode;
};

export type SecurityPolicy = {
  mode: SecurityMode;
  /** 绝对禁止的工具名（正则） */
  denyToolPatterns?: RegExp[];
  /** 只读模式下仍允许的工具 */
  readonlyAllow?: string[];
  /** 受保护路径前缀（禁止 write/edit） */
  protectedPathPrefixes?: string[];
  /** 危险参数关键字 */
  denyArgPatterns?: RegExp[];
  /** 项目记忆命名空间根；命中 /memories/ 的写操作必须落在其下 */
  memoryRoot?: string;
  /** 当前执行者（Agent Definition id）：供私有记忆等闸门使用 */
  agentId?: string;
  /** 可插拔不变量闸门（在内置检查之后按序评估） */
  gates?: PolicyGate[];
};

export type PolicyGateInput = {
  toolName: string;
  args: Record<string, unknown>;
  policy: SecurityPolicy;
};

/** 返回 null 表示弃权（交给下一个闸门）。 */
export type PolicyGate = {
  id: string;
  check: (input: PolicyGateInput) => Omit<SecurityVerdict, "mode"> | null;
};

/** bash 默认 deny；AGENT_BASH_ENABLED=true 时由调用方策略放行（仍受沙箱/白名单约束）。 */
const DEFAULT_DENY_TOOLS = [
  /^shell$/i,
  /^exec$/i,
  /^rm$/i,
  /^force[_-]?push$/i,
  ...(typeof process !== "undefined" &&
  String((process as { env?: Record<string, string> }).env?.AGENT_BASH_ENABLED || "").toLowerCase() ===
    "true"
    ? []
    : [/^bash$/i]),
];

const DEFAULT_DENY_ARGS = [
  /\brm\s+-rf\b/i,
  /\bgit\s+push\s+.*--force\b/i,
  /\bDROP\s+TABLE\b/i,
  /\bTRUNCATE\b/i,
];

const DEFAULT_READONLY_ALLOW = new Set([
  "fs_ls", "fs_read", "fs_grep", "fs_find",
  "artifact_list",
  "project_get",
  "bible_read",
  "kb_read",
  "kb_search",
  "memory_search",
  "memory_get",
  "gate_run",
  "skill_list",
  "skill_read",
  "payoff_ledger",
  "prompt_render",
  "web_search",
  "usage_log",
]);

export function payoffLedgerAction(args?: Record<string, unknown>) {
  if (!args || Array.isArray(args) || typeof args !== "object") return undefined;
  if (args.entries !== undefined && !Array.isArray(args.entries)) return undefined;
  if (args.action === undefined) return args.entries?.length ? "replace" : "audit";
  switch (args.action) {
    case "load": case "audit": case "plant": case "payoff": case "replace":
      return args.action;
    default:
      return undefined;
  }
}

/** Explicit effects for catalog reads whose execution can write. Missing args
 * cannot prove a pending ledger call was read-only on its original worker. */
export function toolOperationEffect(name: string, args?: Record<string, unknown>) {
  if (name === "checklist_open") return "artifact_write";
  if (name === "payoff_ledger") {
    const action = payoffLedgerAction(args);
    return action === "load" || action === "audit" ? "none" : "memory_write";
  }
  return undefined;
}

const WRITEISH = new Set([
  "memory_merge",
  "memory_freeze",
  "lesson_note",
  "artifact_create",
  "artifact_update",
  "bible_write",
  "kb_write_report",
  "memory_put",
  "memory_write",
  "stage_lock",
  "job_enqueue",
  "table_write",
]);

export function defaultSecurityPolicy(
  mode: SecurityMode = "safe",
  opts: { projectId?: string } = {},
): SecurityPolicy {
  return {
    mode,
    denyToolPatterns: DEFAULT_DENY_TOOLS,
    readonlyAllow: [...DEFAULT_READONLY_ALLOW],
    protectedPathPrefixes: [
      "/etc",
      "/.git",
      "/.env",
      "/packages/agent-runtime/src/gates",
      "/packages/agent-runtime/src/doneContract",
      "/services/api/app/gates",
    ],
    denyArgPatterns: DEFAULT_DENY_ARGS,
    memoryRoot: opts.projectId ? `/memories/projects/${opts.projectId}` : undefined,
  };
}

function pathEscapesSandbox(path: string, workdir = process.cwd(), virtualFileTool = false): boolean {
  if (!path) return false;
  if (path.includes("\\") || path.includes("\0") || path.split("/").some(p => p === "..")) return true;
  if (virtualFileTool && (path === "/" || /^\/(memories|projects|kb|workspace|runs|threads|inbox|files)(\/|$)/.test(path))) return false;
  // 绝对路径且不在 workdir 下
  if (path.startsWith("/") || /^[A-Za-z]:\\/.test(path)) {
    const normalized = path.replace(/\\/g, "/");
    const root = workdir.replace(/\\/g, "/");
    if (!normalized.startsWith(root) && !normalized.startsWith("/memories/")) {
      // 允许记忆虚拟路径
      if (normalized.startsWith("/memories/")) return false;
      return true;
    }
  }
  if (path.includes("..")) return true;
  return false;
}

/** 内置检查 + 可插拔闸门栈：deny 短路，ask 取最严，其余 allow。 */
export function gateToolCall(
  toolName: string,
  args: Record<string, unknown> = {},
  policy: SecurityPolicy = defaultSecurityPolicy("safe"),
): SecurityVerdict {
  const base = gateCore(toolName, args, policy);
  if (base.decision === "deny") return base;
  let out = base;
  for (const gate of policy.gates || []) {
    const v = gate.check({ toolName, args, policy });
    if (!v) continue;
    if (v.decision === "deny") return { ...v, reason: `[${gate.id}] ${v.reason}`, mode: base.mode };
    if (v.decision === "ask" && out.decision === "allow") {
      out = { ...v, reason: `[${gate.id}] ${v.reason}`, mode: base.mode };
    }
  }
  return out;
}

function gateCore(
  toolName: string,
  args: Record<string, unknown>,
  policy: SecurityPolicy,
): SecurityVerdict {
  const mode = policy.mode || "safe";
  const denyTools = policy.denyToolPatterns || DEFAULT_DENY_TOOLS;
  const denyArgs = policy.denyArgPatterns || DEFAULT_DENY_ARGS;

  for (const re of denyTools) {
    if (re.test(toolName)) {
      return { decision: "deny", reason: `工具「${toolName}」在拒绝名单`, mode };
    }
  }

  const blob = JSON.stringify(args);
  for (const re of denyArgs) {
    if (re.test(blob)) {
      return { decision: "deny", reason: `参数命中危险模式：${re}`, mode };
    }
  }

  const pathKeys = ["path", "file", "filepath", "target"];
  for (const k of pathKeys) {
    const p = args[k];
    if (typeof p === "string") {
      if (pathEscapesSandbox(p,process.cwd(),/^fs_(ls|read|write|edit|grep|find)$/.test(toolName))) {
        return { decision: "deny", reason: `路径逃逸沙箱：${p}`, mode };
      }
      // 项目级隔离：/memories/ 写操作不得落到其它项目命名空间
      if (
        typeof p === "string" &&
        p.startsWith("/memories/") &&
        WRITEISH.has(toolName) &&
        policy.memoryRoot &&
        !p.startsWith(policy.memoryRoot)
      ) {
        return { decision: "deny", reason: `跨项目记忆路径禁止写入：${p}`, mode };
      }
      for (const pref of policy.protectedPathPrefixes || []) {
        if (p.includes(pref) && WRITEISH.has(toolName)) {
          return {
            decision: "deny",
            reason: `受保护路径禁止写入：${pref}`,
            mode,
          };
        }
      }
    }
  }

  if (mode === "readonly") {
    const allow = new Set(policy.readonlyAllow || [...DEFAULT_READONLY_ALLOW]);
    const effect = toolOperationEffect(toolName, args);
    if (!allow.has(toolName) || (effect && effect !== "none")) {
      return {
        decision: "deny",
        reason: `只读模式禁止「${toolName}」`,
        mode,
      };
    }
  }

  if (mode === "safe" && WRITEISH.has(toolName)) {
    // 写作域默认 allow 白名单写工具；危险写仍 ask
    if (/delete|drop|truncate|force/i.test(toolName) || /delete|drop|truncate/i.test(blob)) {
      return { decision: "ask", reason: `安全模式需人工确认危险写：${toolName}`, mode };
    }
  }

  if (mode === "yolo") {
    return { decision: "allow", reason: "YOLO 模式（仅沙箱内）", mode };
  }

  return { decision: "allow", reason: "通过安全门", mode };
}

/** 包装工具 execute：门控失败时返回 isError，不静默成功 */
export function withSecurityGate<TArgs extends Record<string, unknown>>(
  tool: {
    name: string;
    execute: (id: string, args: TArgs) => Promise<{ content: Array<{ type: string; text: string }>; details?: unknown }>;
  },
  policy: SecurityPolicy,
  onAsk?: (toolName: string, args: TArgs, reason: string) => Promise<boolean>,
) {
  return async (toolCallId: string, args: TArgs) => {
    const verdict = gateToolCall(tool.name, args || {}, policy);
    if (verdict.decision === "deny") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              isError: true,
              error: "security_denied",
              retryable: false,
              message: verdict.reason,
              next:
                "不要重试同一路径。改用 project_get / artifact_list / memory_search / bible_read / kb_search；写文件只用项目沙箱内相对路径。",
            }),
          },
        ],
        details: { security: verdict },
      };
    }
    if (verdict.decision === "ask") {
      const ok = onAsk ? await onAsk(tool.name, args, verdict.reason) : false;
      if (!ok) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: false,
                isError: true,
                error: "security_ask_denied",
                retryable: false,
                message: verdict.reason,
                next: "该操作需用户确认；改用只读工具或等待确认后再试。",
              }),
            },
          ],
          details: { security: verdict },
        };
      }
    }
    try {
      return await tool.execute(toolCallId, args);
    } catch (err) {
      // The runtime must persist uncertainty and require inspection before any
      // further write. Flattening it into a retryable tool error loses that barrier.
      if (err && typeof err === "object" && "code" in err && err.code === "mutation_result_unknown") throw err;
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: false,
              isError: true,
              error: "tool_crash",
              message,
            }),
          },
        ],
        details: { security: verdict },
      };
    }
  };
}

// —— 内置闸门 ——

const PROCEDURAL_RE = /\/procedural\/([^/]+)\//;

/**
 * 私有记忆边界：`/memories/.../procedural/{agentId}/…` 只属于该 Agent。
 * 读写他人的 procedural 目录一律 deny（共享事实应走 bible / 项目记忆）。
 */
export function agentPrivateMemoryGate(agentId: string): PolicyGate {
  return {
    id: "private_memory",
    check: ({ args }) => {
      for (const k of ["path", "file", "filepath", "target"]) {
        const p = args[k];
        if (typeof p !== "string") continue;
        const m = PROCEDURAL_RE.exec(p);
        if (m && m[1] !== agentId) {
          return {
            decision: "deny",
            reason: `「${m[1]}」的私有记忆不可访问（你是 ${agentId}）。共享事实请用项目记忆/圣经。`,
          };
        }
      }
      return null;
    },
  };
}

/**
 * 单次运行内的调用预算：防止写入/记笔记类工具被刷（有状态：每个 Instance 新建一份）。
 * limits 例：{ lesson_note: 5, memory_write: 60 }
 */
export function callBudgetGate(limits: Record<string, number>): PolicyGate & { counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  return {
    id: "call_budget",
    counts,
    check: ({ toolName }) => {
      const max = limits[toolName];
      if (max == null) return null;
      counts[toolName] = (counts[toolName] || 0) + 1;
      if (counts[toolName] > max) {
        return {
          decision: "deny",
          reason: `本次运行「${toolName}」已达上限 ${max} 次；请整合已有内容或下次运行再做。`,
        };
      }
      return null;
    },
  };
}
