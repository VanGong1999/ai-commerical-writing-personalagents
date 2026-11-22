import { useQuery } from "@tanstack/react-query";
import { Badge, Panel } from "@xiezuomanju/ui";
import { api } from "../../api/client";

/** 展示最近一次 AgentRun 的 receipt / gateResults（Done Contract 可解释）。 */
export function RunReceiptPanel({ runId }: { runId?: string }) {
  const { data: run, isLoading } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => api.getRun(runId!),
    enabled: Boolean(runId),
  });

  const { data: digest } = useQuery({
    queryKey: ["run-digest", runId],
    queryFn: async () => {
      try {
        return await api.getRunDigest(runId!);
      } catch {
        return null;
      }
    },
    enabled: Boolean(runId),
    // digest 是异步 job 生成，首次 404 后轮询直到出现
    refetchInterval: (query) => (query.state.data ? false : 3000),
  });

  if (!runId) return null;

  const gates = run?.gateResults ?? [];
  const fails = gates.filter((g) => g.result === "fail");
  const warns = gates.filter((g) => g.result === "warn");

  return (
    <Panel title="最近 Run 收据">
      {isLoading && <p className="faint">拉取中…</p>}
      {run && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            <Badge tone={run.status === "succeeded" ? "ok" : run.status === "failed" ? "fail" : "warn"}>
              {run.status}
            </Badge>
            <span className="faint" style={{ fontSize: "var(--fs-sm)" }}>
              {run.agentId}
            </span>
            {run.receiptId && (
              <Badge>
                receipt {run.receiptId.slice(0, 10)}…
              </Badge>
            )}
          </div>
          <p className="faint" style={{ margin: 0, fontSize: "var(--fs-sm)" }}>
            tokens {run.tokenPrompt ?? 0}+{run.tokenCompletion ?? 0}
            {run.outputArtifactIds?.length
              ? ` · artifacts ${run.outputArtifactIds.length}`
              : ""}
          </p>
          {gates.length > 0 ? (
            <div className="stack" style={{ gap: 4 }}>
              <span style={{ fontSize: "var(--fs-sm)" }}>
                Gates：{gates.length}（fail {fails.length} · warn {warns.length}）
              </span>
              {gates.slice(0, 8).map((g) => (
                <div key={g.id || g.name} className="row" style={{ justifyContent: "space-between" }}>
                  <span style={{ fontSize: "var(--fs-sm)" }}>{g.name || g.id}</span>
                  <Badge
                    tone={
                      g.result === "pass" ? "ok" : g.result === "fail" ? "fail" : "warn"
                    }
                  >
                    {g.result}
                  </Badge>
                </div>
              ))}
              {gates.length > 8 && (
                <span className="faint" style={{ fontSize: "var(--fs-sm)" }}>
                  …另有 {gates.length - 8} 项
                </span>
              )}
            </div>
          ) : (
            <p className="faint" style={{ margin: 0, fontSize: "var(--fs-sm)" }}>
              暂无 gateResults（worker 尚未回写或未跑 Done Contract）
            </p>
          )}
          {digest && (
            <div className="stack" style={{ gap: 6, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <p style={{ margin: 0, fontSize: "var(--fs-sm)" }}>{digest.narrative}</p>
              {digest.leftover && <Badge tone="warn">{digest.leftover}</Badge>}
              {(digest.artifacts.length > 0 || digest.memoryChanges.length > 0) && (
                <span className="faint" style={{ fontSize: "var(--fs-sm)" }}>
                  产物 {digest.artifacts.length} · 记忆变更 {digest.memoryChanges.length}
                  {digest.memoryChanges.slice(0, 3).map((m) => {
                    const p = (m as { path?: string }).path || "";
                    return ` · ${p.split("/").pop() || (m as { summary?: string }).summary || ""}`;
                  }).join("")}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
