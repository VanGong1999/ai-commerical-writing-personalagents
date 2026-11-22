import { ContextManifest } from "../agent-chat/ContextManifest";
import { useQuery } from "@tanstack/react-query";
import { Badge, StatusBadge, type StatusTone } from "@xiezuomanju/ui";
import { useState, type CSSProperties } from "react";
import { api, type RunStepItem } from "../../api/client";
import {
  STEP_KIND_TITLES,
  describeFields,
  describeWatchdog,
  statusLabel,
  summarizeResult,
  timeLabel,
  toolLabel,
} from "../agent-chat/stepFormat";

const RUN_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  queued: { label: "排队中", tone: "pending" },
  running: { label: "进行中", tone: "running" },
  processing: { label: "处理中", tone: "running" },
  succeeded: { label: "已完成", tone: "ok" },
  completed: { label: "已完成", tone: "ok" },
  done: { label: "已完成", tone: "ok" },
  failed: { label: "失败", tone: "fail" },
  error: { label: "出错", tone: "fail" },
  dead: { label: "已终止", tone: "fail" },
  cancelled: { label: "已取消", tone: "idle" },
  canceled: { label: "已取消", tone: "idle" },
  paused: { label: "已暂停", tone: "warn" },
  waiting_approval: { label: "待审批", tone: "pending" },
  pending_deps: { label: "等待依赖", tone: "pending" },
};

export function runStatusOf(status?: string | null): { label: string; tone: StatusTone } {
  const s = String(status ?? "");
  return RUN_STATUS[s] ?? { label: statusLabel(s), tone: "idle" };
}

const TERMINAL = new Set([
  "succeeded",
  "completed",
  "done",
  "failed",
  "error",
  "dead",
  "cancelled",
  "canceled",
]);

const KIND_LABEL: Record<string, string> = {
  ...STEP_KIND_TITLES,
  thinking: "思考",
  tool_call: "调用工具",
  tool_result: "工具结果",
  reply: "回复",
  bash: "执行命令",
  agent_status: "状态",
  watchdog: "看门狗",
  error: "出错",
};

const KIND_TONE: Record<string, "default" | "ok" | "warn" | "fail"> = {
  thinking: "default",
  tool_call: "default",
  tool_result: "default",
  reply: "ok",
  bash: "default",
  agent_status: "default",
  watchdog: "warn",
  error: "fail",
};

function rawJson(value: unknown): string {
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** 文本类 step 的正文：thinking/reply 取 payload.text。 */
function stepText(step: RunStepItem): string {
  const p = step.payload ?? {};
  if (step.kind === "thinking" || step.kind === "reply") {
    return typeof p.text === "string" ? p.text : rawJson(p);
  }
  return "";
}

function stepTitle(step: RunStepItem): string {
  const p = step.payload ?? {};
  switch (step.kind) {
    case "tool_call":
    case "bash":
      return toolLabel(p.name);
    case "tool_result":
      return toolLabel(p.name ?? p.tool);
    case "thinking":
      return "思考";
    case "reply":
      return "回复";
    case "agent_status":
      return "任务状态";
    case "watchdog":
      return describeWatchdog(p).title;
    case "error":
      return "出错";
    default:
      return STEP_KIND_TITLES[step.kind] || step.kind || "步骤";
  }
}

const CLAMP: CSSProperties = {
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  whiteSpace: "pre-wrap",
};

/** 长文本默认折叠到前 3 行，点「查看全文」展开，展开后点「收起」折叠。 */
function TraceText({ text }: { text: string }) {
  const trimmed = String(text ?? "").trim();
  const [open, setOpen] = useState(false);
  if (!trimmed) return <div className="step-item__result faint">（空）</div>;
  const long = trimmed.length > 200 || trimmed.split("\n").length > 3;
  return (
    <div>
      <div className="step-item__result" style={long ? CLAMP : undefined}>
        {trimmed}
      </div>
      {long ? (
        <details
          className="step-item__detail"
          onToggle={(e) => setOpen(e.currentTarget.open)}
        >
          <summary>{open ? "收起" : "查看全文"}</summary>
          <pre>{trimmed}</pre>
        </details>
      ) : null}
    </div>
  );
}

function StepBody({ step }: { step: RunStepItem }) {
  const p = (step.payload ?? {}) as Record<string, unknown>;
  if (p.manifest) return <ContextManifest value={p.manifest} />;
  switch (step.kind) {
    case "reply":
      return <TraceText text={stepText(step)} />;
    case "tool_call":
    case "bash": {
      const fields = describeFields(p.args, 4);
      return (
        <>
          {fields.length ? (
            <div className="step-item__args">
              {fields.map((f) => (
                <span key={f.label}>
                  <em>{f.label}</em>
                  {f.value}
                </span>
              ))}
            </div>
          ) : null}
          {p.args != null ? (
            <details className="step-item__detail">
              <summary>查看完整参数</summary>
              <pre>{rawJson(p.args)}</pre>
            </details>
          ) : null}
        </>
      );
    }
    case "tool_result": {
      const result = p.result ?? p.detail ?? p.content ?? p.preview;
      if (typeof result === "string" && result.trim()) {
        return <TraceText text={result} />;
      }
      const st = p.status != null ? statusLabel(p.status) : "";
      const sum = result != null ? summarizeResult(result, 140) : "已完成";
      return (
        <div className="step-item__result">
          {[st, sum].filter(Boolean).join(" · ") || "已完成"}
        </div>
      );
    }
    case "agent_status": {
      const st = p.status != null ? statusLabel(p.status) : "";
      const summary = typeof p.summary === "string" ? p.summary : "";
      const extraKeys = Object.keys(p).filter(
        (k) => k !== "status" && k !== "summary" && p[k] != null,
      );
      return (
        <>
          <div className="step-item__result">
            {[st, summary].filter(Boolean).join(" · ") || "已更新"}
          </div>
          {extraKeys.length ? (
            <details className="step-item__detail">
              <summary>查看详情</summary>
              <pre>{rawJson(p)}</pre>
            </details>
          ) : null}
        </>
      );
    }
    case "watchdog": {
      const wd = describeWatchdog(p);
      return <div className="step-item__result">{wd.detail}</div>;
    }
    default: {
      const summary = summarizeResult(p, 140);
      return summary ? <div className="step-item__result">{summary}</div> : null;
    }
  }
}

export function RunTraceTimeline({ runId }: { runId: string }) {
  const runQ = useQuery({
    queryKey: ["run", runId],
    queryFn: () => api.getRun(runId),
  });
  const replayQ = useQuery({
    queryKey: ["runReplay", runId],
    queryFn: () => api.getRunReplay(runId),
    refetchInterval: (q) =>
      q.state.data?.run.status && TERMINAL.has(q.state.data.run.status) ? false : 3000,
  });

  const run = runQ.data;
  const replay = replayQ.data;
  const steps = [...(replay?.steps ?? [])].sort((a, b) => a.seq - b.seq);
  const st = runStatusOf(replay?.run.status ?? run?.status);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <StatusBadge tone={st.tone} label={st.label} />
        {replay?.run.model ? <span className="faint">{replay.run.model}</span> : null}
        {(replay?.run.attempt ?? 0) > 1 ? (
          <Badge tone="warn">第 {replay?.run.attempt} 次尝试</Badge>
        ) : null}
        <span className="faint">
          提示 {replay?.run.tokenPrompt ?? run?.tokenPrompt ?? 0} · 补全{" "}
          {replay?.run.tokenCompletion ?? run?.tokenCompletion ?? 0}
        </span>
        <span className="faint">共 {steps.length} 步</span>
      </div>

      {replayQ.isLoading ? (
        <div className="empty">加载执行轨迹…</div>
      ) : replayQ.isError ? (
        <div className="empty">执行轨迹加载失败</div>
      ) : steps.length === 0 ? (
        <div className="empty">暂无执行记录</div>
      ) : (
        <ol className="step-list">
          {steps.map((step) => (
            <li key={step.id} className="step-item">
              <span className="step-item__dot" />
              <div className="step-item__body">
                <div className="step-item__head">
                  <strong>{stepTitle(step)}</strong>
                  <Badge tone={KIND_TONE[step.kind] ?? "default"}>
                    {KIND_LABEL[step.kind] ?? step.kind}
                  </Badge>
                  <time>{timeLabel(step.createdAt)}</time>
                </div>
                <StepBody step={step} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
