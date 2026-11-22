/**
 * 控制平面策略（：中断 + 副作用存疑时 resume/refuse。
 * 幂等键 = program(+input) hash，防止重复写副作用。
 */

import { createHash } from "node:crypto";

export type PolicyAction = "resume" | "refuse" | "ask_operator" | "safe_retry";

export type SideEffectKind =
  | "none"
  | "artifact_write"
  | "memory_write"
  | "external_api"
  | "payment"
  | "job_enqueue";

export type InDoubtContext = {
  lastEventType?: string;
  sideEffect?: SideEffectKind;
  idempotencyKey?: string;
  alreadyApplied?: boolean;
  operatorDecision?: "resume" | "refuse" | "mark_done";
};

export type PolicyDecision = {
  action: PolicyAction;
  reason: string;
  recordFact?: string;
};

export function makeIdempotencyKey(program: string, input: unknown): string {
  const h = createHash("sha256")
    .update(program, "utf8")
    .update(JSON.stringify(input ?? {}))
    .digest("hex");
  return `idem_${h.slice(0, 24)}`;
}

/**
 * 崩溃边界策略：存疑时禁止盲重试有副作用动作。
 */
export function decideResumePolicy(ctx: InDoubtContext): PolicyDecision {
  if (ctx.operatorDecision === "refuse") {
    return {
      action: "refuse",
      reason: "操作员拒绝恢复",
      recordFact: "operator_refused",
    };
  }
  if (ctx.operatorDecision === "mark_done") {
    return {
      action: "refuse",
      reason: "操作员标记已完成，禁止重放",
      recordFact: "operator_mark_done",
    };
  }
  if (ctx.operatorDecision === "resume") {
    return {
      action: "resume",
      reason: "操作员确认可恢复",
      recordFact: "operator_resume",
    };
  }

  const se = ctx.sideEffect || "none";
  if (ctx.lastEventType === "tool_call" && se !== "none") {
    if (ctx.alreadyApplied) {
      return {
        action: "refuse",
        reason: "副作用可能已生效且账本已有记录，禁止盲重试",
        recordFact: "in_doubt_already_applied",
      };
    }
    return {
      action: "ask_operator",
      reason: "it's in doubt：工具已调用但未见结果，需操作员确认",
      recordFact: "in_doubt",
    };
  }

  if (ctx.lastEventType === "model_call") {
    return {
      action: "safe_retry",
      reason: "仅模型调用中断，无世界副作用，可安全重试",
    };
  }

  return { action: "resume", reason: "无存疑信号，允许恢复" };
}

/** 简易副作用账本条目 */
export type LedgerEntry = {
  idempotencyKey: string;
  kind: SideEffectKind;
  ref?: string;
  ts: string;
  status: "pending" | "applied" | "failed";
};

export function ledgerHas(entries: LedgerEntry[], key: string): boolean {
  return entries.some((e) => e.idempotencyKey === key && e.status === "applied");
}

/** 从持久会话事件流中恢复副作用账本（供崩溃重启后查重）。 */
export function ledgerFromSessionEvents(
  events: Array<{ type?: string; payload?: Record<string, unknown> }>,
): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const e of events || []) {
    if (e.type === "ledger" && e.payload?.ledger) {
      out.push(e.payload.ledger as LedgerEntry);
    }
  }
  return out;
}
