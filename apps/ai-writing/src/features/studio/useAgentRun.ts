import { useCallback, useRef, useState } from "react";
import { api } from "../../api/client";
import { runAgentFeedback, type RunAgentFeedbackOptions } from "./runAgentFeedback";

/**
 * 统一流式 Run hook（替代 FormatWorkspaces / ManjuPanels 内重复 useRunStream）。
 */
export function useAgentRun(projectId: string | undefined, agentId: string) {
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    const ac = abortRef.current;
    abortRef.current = null;
    ac?.abort();
    setStreaming(false);
  }, []);

  const start = useCallback(
    async (opts?: RunAgentFeedbackOptions) => {
      if (!projectId) {
        setError("缺少 projectId");
        return;
      }
      setError(null);
      setStreaming(true);
      setText("");
      setJobId(undefined);
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const result = await runAgentFeedback(projectId, agentId, {
          ...opts,
          quiet: true,
          signal: ac.signal,
          onEvent: (ev) => {
            opts?.onEvent?.(ev);
            if (ev.jobId) setJobId(ev.jobId);
            const run = ev.run as { jobId?: string | null } | undefined;
            if (run?.jobId) setJobId(run.jobId ?? undefined);
            const token =
              (typeof ev.token === "string" && ev.token) ||
              (typeof ev.text === "string" && ev.text) ||
              "";
            if (token) setText((t) => t + token);
            else if (ev.type === "status") {
              setText((t) => t || `入队 ${agentId} · ${ev.status ?? "queued"}\n`);
            }
            if (ev.type === "done") {
              setText((t) => t || `Run 完成 · ${ev.status ?? "done"}`);
            }
            if (ev.type === "policy") {
              const reason = String((ev as { reason?: string }).reason || ev.message || "需确认");
              setText((t) => `${t}\n[policy] ${reason}\n`);
            }
          },
        });
        if (result.jobId) setJobId(result.jobId);
        if (result.aborted && result.jobId) {
          await api.cancelJob(result.jobId).catch(() => {});
        }
      } catch (e) {
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        setStreaming(false);
      }
    },
    [projectId, agentId],
  );

  const abortAndCancel = useCallback(async () => {
    const id = jobId;
    abort();
    if (id) await api.cancelJob(id).catch(() => {});
  }, [abort, jobId]);

  return { text, streaming, error, jobId, start, abort: abortAndCancel };
}
