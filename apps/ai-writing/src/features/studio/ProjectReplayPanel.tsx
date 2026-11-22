import { ContextManifest } from "../agent-chat/ContextManifest";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, EmptyBlock } from "@xiezuomanju/ui";
import { History, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { api, type ProjectReplay, type RunReplay } from "../../api/client";

function toneFor(kind: string, status?: string): "ok" | "fail" | "warn" | "default" {
  if (status === "failed" || status === "dead") return "fail";
  if (status === "succeeded") return "ok";
  if (status === "running" || status === "queued") return "warn";
  if (kind.startsWith("step:tool_")) return "default";
  if (kind === "run_end") return status === "succeeded" ? "ok" : "warn";
  if (kind === "stage") return "default";
  if (kind === "audit") return "warn";
  return "default";
}

function formatAt(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** 创作台 / 工作台共用：项目全链路回放（Stage + Run + Step + 审计）。 */
export function ProjectReplayPanel({
  projectId,
  selectedRunId,
}: {
  projectId?: string;
  selectedRunId?: string;
}) {
  const [runId, setRunId] = useState(selectedRunId || "");
  const replayQ = useQuery({
    queryKey: ["project-replay", projectId],
    queryFn: () => api.getProjectReplay(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: 12_000,
  });
  const runReplayQ = useQuery({
    queryKey: ["run-replay", runId],
    queryFn: () => api.getRunReplay(runId),
    enabled: Boolean(runId),
  });

  const events = useMemo(() => {
    const data = replayQ.data as ProjectReplay | undefined;
    return data?.events ?? [];
  }, [replayQ.data]);

  if (!projectId) {
    return <EmptyBlock title="未选择项目" description="打开项目后可回放输入→执行→产物全过程。" />;
  }

  const runDetail = runReplayQ.data as RunReplay | undefined;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
        <div>
          <strong style={{ fontSize: 13 }}>全链路回放</strong>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
            复现任务从输入到结果：Stage、AgentRun、工具步骤、审计。
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void replayQ.refetch();
            if (runId) void runReplayQ.refetch();
          }}
        >
          <RefreshCw size={14} />
          刷新
        </Button>
      </div>

      {replayQ.isLoading ? <p className="faint">拉取回放账本…</p> : null}
      {replayQ.data ? (
        <p className="faint" style={{ margin: 0, fontSize: 12 }}>
          {replayQ.data.runCount} 次 Run · {replayQ.data.stepCount} 步 · 当前{" "}
          {replayQ.data.stage}
        </p>
      ) : null}

      {(replayQ.data?.runs?.length ?? 0) > 0 ? (
        <div className="stack" style={{ gap: 4 }}>
          <span style={{ fontSize: 12 }}>选择 Run 查看工具细节</span>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {replayQ.data!.runs
              .slice()
              .reverse()
              .slice(0, 12)
              .map((r) => (
                <Button
                  key={r.id}
                  size="sm"
                  variant={runId === r.id ? "primary" : "ghost"}
                  onClick={() => setRunId(r.id)}
                >
                  {r.agentId.split(".").slice(-1)[0]} · {r.status}
                </Button>
              ))}
          </div>
        </div>
      ) : null}

      {runDetail ? (
        <div className="stack" style={{ gap: 6, padding: 8, border: "1px solid var(--border)", borderRadius: 8 }}>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <Badge tone={toneFor("run_end", runDetail.run.status)}>{runDetail.run.status}</Badge>
            <span style={{ fontSize: 12 }}>{runDetail.run.agentId}</span>
            <span className="faint" style={{ fontSize: 12 }}>
              steps {runDetail.steps.length}
              {runDetail.run.model ? ` · ${runDetail.run.model}` : ""}
            </span>
          </div>
          {runDetail.run.execCheckpoint && Object.keys(runDetail.run.execCheckpoint).length > 0 ? (
            <p className="faint" style={{ margin: 0, fontSize: 12 }}>
              checkpoint turn={String(runDetail.run.execCheckpoint.turn ?? "—")} · artifacts=
              {Array.isArray(runDetail.run.execCheckpoint.artifactIds)
                ? runDetail.run.execCheckpoint.artifactIds.length
                : "—"}
            </p>
          ) : null}
          <ol style={{ margin: 0, paddingLeft: 18, maxHeight: 220, overflow: "auto" }}>
            {runDetail.steps.length === 0 ? (
              <li className="faint" style={{ fontSize: 12 }}>
                暂无步骤（旧 Run 可能未落账；新 Run 会写入 project: 伪会话）
              </li>
            ) : (
              runDetail.steps.map((s) => (
                <li key={s.id} style={{ fontSize: 12, marginBottom: 4 }}>
                  <code>{s.kind}</code>{" "}
                  {String(
                    (s.payload?.name as string) ||
                      (s.payload?.summary as string) ||
                      "",
                  ).slice(0, 80)}
                  {s.payload?.manifest ? <ContextManifest value={s.payload.manifest} /> : null}
                </li>
              ))
            )}
          </ol>
        </div>
      ) : null}

      <div className="stack" style={{ gap: 6, maxHeight: 360, overflow: "auto" }}>
        {events.length === 0 && !replayQ.isLoading ? (
          <EmptyBlock
            icon={History}
            title="还没有回放事件"
            description="跑一次 Agent 或推进 Stage 后，这里会按时间线展示全过程。"
          />
        ) : (
          events
            .slice()
            .reverse()
            .map((ev, idx) => {
              const status = String(ev.payload?.status || "");
              const runRef = String(ev.payload?.runId || "");
              return (
                <button
                  key={`${ev.at}-${ev.kind}-${idx}`}
                  type="button"
                  className="row"
                  style={{
                    gap: 8,
                    alignItems: "flex-start",
                    textAlign: "left",
                    border: "none",
                    background: "transparent",
                    padding: "4px 0",
                    cursor: runRef ? "pointer" : "default",
                  }}
                  onClick={() => {
                    if (runRef) setRunId(runRef);
                  }}
                >
                  <Badge tone={toneFor(ev.kind, status)}>{ev.kind.replace(/^step:/, "")}</Badge>
                  <span style={{ flex: 1, fontSize: 12 }}>
                    <strong>{ev.summary}</strong>
                    <br />
                    <span className="faint">
                      {ev.actor} · {formatAt(ev.at)}
                    </span>
                  </span>
                </button>
              );
            })
        )}
      </div>
    </div>
  );
}
