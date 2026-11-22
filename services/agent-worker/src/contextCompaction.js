/**
 * 上下文压缩 / Handoff 的 worker 侧接线（纯逻辑在 @xiezuomanju/agent-runtime/context）。
 *
 * 三层：微压缩 → 结构化 LLM 压缩（失败降级确定性）→ Handoff/Reset（保持锐度）。
 */
import { buildHandoffPack, compactMessagesAsync, shouldHandoff, estimateTokens } from "@xiezuomanju/agent-runtime";

const envNum = (k, d) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : d;
};

/** 合并 harness 默认压缩配置与环境变量覆盖 */
export function resolveCompactionConfig(base = {}) {
  return {
    ...base,
    triggerTokens: envNum("AGENT_COMPACT_TRIGGER_TOKENS", base.triggerTokens ?? 24_000),
    effectiveWindowTokens: envNum("AGENT_EFFECTIVE_WINDOW_TOKENS", base.effectiveWindowTokens ?? 0) || undefined,
    triggerRatio: envNum("AGENT_COMPACT_TRIGGER_RATIO", base.triggerRatio ?? 0.5),
    handoffAfterCompactions: envNum("AGENT_HANDOFF_AFTER_COMPACTIONS", base.handoffAfterCompactions ?? 4),
    resetRatio: envNum("AGENT_RESET_RATIO", base.resetRatio ?? 0.8),
  };
}

export function llmCompactionEnabled() {
  return String(process.env.AGENT_LLM_COMPACTION || "true").toLowerCase() !== "false";
}

/** 用现有 /llm/chat 做摘要；失败由 compactMessagesAsync 降级 */
export function createLlmSummarizer(api, { projectId, agentId, runId }) {
  return async (_middle, prompt) => {
    if (prompt.user.length > 48_000) throw new Error("summary_input_exceeds_budget");
    const res = await api.chat(
      [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      { purpose: "context_summary", temperature: 0.2, maxTokens: 4096, projectId, agentId, runId },
    );
    const finish = res?.finishReason || res?.finish_reason;
    if (["length", "max_tokens", "content_filter"].includes(finish)) throw new Error(`summary_incomplete:${finish}`);
    return String(res?.content || "");
  };
}

/**
 * 每轮模型调用前运行。返回 { messages, event }：
 * - event.kind: "compaction" | "handoff" | null
 */
export async function maybeCompact({
  api,
  messages,
  cfg,
  state,
  projectId,
  agentId,
  runId,
  goal,
  getDoneGap,
  getArtifactIds,
}) {
  const summarizer = llmCompactionEnabled() ? createLlmSummarizer(api, { projectId, agentId, runId }) : undefined;
  const result = await compactMessagesAsync(messages, cfg, summarizer);
  if (!result.compacted) return { messages, event: null };

  state.compactions += 1;
  const decision = shouldHandoff({
    compactionsSoFar: state.compactions,
    estimatedAfter: result.estimatedAfter,
    cfg,
  });

  if (!decision.handoff) {
    return {
      messages: result.messages,
      event: {
        kind: "compaction",
        method: result.method,
        fallbackReason: result.fallbackReason,
        before: result.estimatedBefore,
        after: result.estimatedAfter,
        compactions: state.compactions,
      },
    };
  }

  // Handoff / Reset：全新上下文 = system（NC）+ handoff 包
  const recentConclusions = messages
    .filter((m) => m.role === "assistant" && typeof m.content === "string" && m.content.trim())
    .slice(-5)
    .map((m) => m.content);
  // The standalone journal needs the task and every admitted direction, even
  // when the provider receives them in separate chronological user turns.
  const goalParts = Array.isArray(goal) ? goal : [goal];
  const handoff = {
    runId,
    agentId,
    goal: goalParts.join("\n\n"),
    doneGap: getDoneGap ? await getDoneGap().catch(() => "") : "",
    artifactIds: getArtifactIds ? await getArtifactIds().catch(() => []) : [],
    summary: result.summary,
    recentConclusions,
    compactions: state.compactions,
  };
  const pack = buildHandoffPack(handoff);
  state.handoffs += 1;
  state.compactions = 0;
  const memo = result.messages.find(m => m.role === "user" && m.content === result.summary);
  const userContent = new Set(result.messages.filter(m => m.role === "user").map(m => m.content));
  const missing = goalParts.filter(part => !userContent.has(part));
  const providerPack = missing.length === goalParts.length ? pack
    : buildHandoffPack({...handoff, goal: missing.join("\n\n") || "见本次任务输入。"});
  const handed = result.messages.map(m => m === memo ? {...memo, content: providerPack} : m);
  return {
    messages: handed,
    event: {
      kind: "handoff",
      reason: decision.reason,
      method: result.method,
      fallbackReason: result.fallbackReason,
      before: result.estimatedBefore,
      after: estimateTokens(handed),
      handoffs: state.handoffs,
      pack,
    },
  };
}
