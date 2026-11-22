import { toast } from "@xiezuomanju/ui";
import { api, type CreateRunOptions } from "../../api/client";
import type { JobEvent } from "../../api/sse";
import { setPolicyPending } from "./policyPending";
import { buildStudioUpstreamContext } from "./studioUpstreamContext";

export type RunAgentFeedbackOptions = CreateRunOptions & {
  label?: string;
  quiet?: boolean;
  signal?: AbortSignal;
  /** 默认 true：合并 bible/journal/设定等既有项目上下文，不覆盖调用方已传字段 */
  enrichContext?: boolean;
  onEvent?: (ev: JobEvent & { run?: unknown }) => void;
};

export type RunAgentFeedbackResult = {
  jobId?: string;
  runId?: string;
  status: string;
  aborted?: boolean;
  policy?: boolean;
};

function isPolicyAsk(ev: JobEvent): boolean {
  if (ev.type === "policy") {
    const action = String((ev as { action?: string }).action || "");
    return action === "ask_operator" || ev.status === "ask_operator";
  }
  return false;
}

/**
 * 可观察 Run：createRunAndStream + toast；识别 policy ask_operator。
 */
export async function runAgentFeedback(
  projectId: string,
  agentId: string,
  options: RunAgentFeedbackOptions = {},
): Promise<RunAgentFeedbackResult> {
  const label = options.label || agentId;
  let jobId: string | undefined;
  let runId: string | undefined;
  let status = "queued";
  let sawToken = false;

  let inputJson = { ...(options.inputJson || {}) };
  if (options.enrichContext !== false) {
    try {
      const upstream = await buildStudioUpstreamContext(projectId);
      for (const [key, value] of Object.entries(upstream)) {
        if (value && inputJson[key] == null) inputJson[key] = value;
      }
    } catch {
      /* 上下文增强失败不阻断开跑 */
    }
  }

  try {
    for await (const ev of api.createRunAndStream(projectId, agentId, {
      inputJson,
      operatorDecision: options.operatorDecision,
      signal: options.signal,
    })) {
      if (options.signal?.aborted) {
        if (jobId) void api.cancelJob(jobId).catch(() => {});
        return { jobId, runId, status: "cancelled", aborted: true };
      }

      if (ev.jobId) jobId = ev.jobId;
      if (ev.runId) runId = ev.runId;
      if (ev.run?.id) runId = ev.run.id;
      if (ev.run?.jobId) jobId = ev.run.jobId ?? jobId;

      options.onEvent?.(ev);

      if (isPolicyAsk(ev)) {
        const reason =
          String((ev as { reason?: string }).reason || ev.message || "it's in doubt：需操作员确认");
        setPolicyPending({
          projectId,
          agentId,
          reason,
          jobId,
          runId,
          inputJson,
        });
        if (!options.quiet) toast.info(`${label}：待人工确认`);
        return { jobId, runId, status: "ask_operator", policy: true };
      }

      const token =
        (typeof ev.token === "string" && ev.token) ||
        (typeof ev.text === "string" && ev.text) ||
        "";
      if (token) sawToken = true;

      if (ev.type === "status" && ev.status) {
        status = ev.status;
        if (!options.quiet && (ev.status === "queued" || ev.status === "running")) {
          if (!sawToken) toast.info(`${label} · ${ev.status}`);
        }
      }
      if (ev.type === "done") {
        status = ev.status || "succeeded";
      }
    }

    if (options.signal?.aborted) {
      if (jobId) void api.cancelJob(jobId).catch(() => {});
      return { jobId, runId, status: "cancelled", aborted: true };
    }

    if (!options.quiet) {
      if (status === "failed" || status === "dead") toast.fail(`${label} 失败`);
      else toast.ok(`${label} 完成`);
    }
    return { jobId, runId, status };
  } catch (e) {
    if (options.signal?.aborted) {
      if (jobId) void api.cancelJob(jobId).catch(() => {});
      return { jobId, runId, status: "cancelled", aborted: true };
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (!options.quiet) toast.fail(`${label}：${msg}`);
    throw e;
  }
}
