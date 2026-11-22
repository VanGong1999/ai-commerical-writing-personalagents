/**
 * session 事件 → 控制面 RunStep 的纯映射（全量 trace 落库）。
 *
 * runSession.js 里有两个并行记录通道：
 *  - emit(sessionStore, …) 写本地 JSONL（字段以 emit 调用为准，payload 一律挂在 payload 上）
 *  - api.appendRunStep(runId, …) 落库 RunStep（POST /runs/{id}/steps，body 含 kind/actor/payload）
 *
 * 本文件只做第二步的映射，不产生副作用。无法映射的事件返回 null，
 * 由调用方决定是否跳过（未知事件）。
 *
 * @param {object} event  session 事件（{ type, payload?, text? }）
 * @param {string} runId  运行 ID（保留参数，与调用点签名对齐）
 * @param {string} agentId Agent ID
 * @returns {{ kind: string, actor: string, payload: object } | null}
 */
export function runStepForEvent(event, runId, agentId) {
  if (!event || typeof event !== "object" || !event.type) return null;
  const type = event.type;
  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  const actor = event.executionActor || `agent:${agentId}`;

  switch (type) {
    case "reply":
      return {
        kind: "reply",
        actor,
        payload: { ...payload, text: payload.text ?? event.text ?? "" },
      };
    case "thinking":
      return {
        kind: "thinking",
        actor,
        payload: { ...payload, text: payload.text ?? event.text ?? "" },
      };
    case "tool_result":
      // 全量落库：payload 原样透传（不再截断 400 字 preview）
      return { kind: "tool_result", actor, payload };
    case "tool_call": {
      const name = payload.name;
      return {
        kind: name === "bash" ? "bash" : "tool_call",
        actor,
        payload: { ...payload, name, args: payload.args, id: payload.id },
      };
    }
    case "bash":
      return {
        kind: "bash",
        actor,
        payload: { ...payload, name: payload.name, args: payload.args, id: payload.id },
      };
    default:
      if (new Set([
        "context", "gate", "gates", "policy", "subagent", "usage", "recovery",
        "ledger", "steer", "model_call", "model_response", "compaction", "handoff",
        "done_check", "repair", "tool_clear", "dispatch", "agent_status", "watchdog",
        "run_start", "run_end", "receipt",
      ]).has(type)) return { kind: type, actor, payload: { ...payload } };
      return null;
  }
}

/** Never continue an execution after an unacknowledged ledger append. Do not
 * expose transport error text (which may contain credentials or request data).
 * Ambiguous writes are left for recovery, rather than retried as side effects.
 */
export async function persistRunStep(api, runId, event, agentId, jobId) {
  const step = runStepForEvent(event, runId, agentId);
  if (!step) return;
  try {
    await api.appendRunStep(runId, { ...step, job_id:jobId, ...(step.payload.turn_id != null ? { turn_id: step.payload.turn_id } : {}) });
  } catch {
    const error = new Error(`执行账本写入失败（${step.kind}），已停止执行，请检查控制面连接后恢复`);
    error.code = "RUN_STEP_PERSIST_FAILED";
    throw error;
  }
}
