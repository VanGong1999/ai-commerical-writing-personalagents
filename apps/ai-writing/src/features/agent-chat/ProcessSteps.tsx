import { ContextManifest } from "./ContextManifest";
import type { RunStepItem } from "../../api/client";
import {
  actorName,
  describeFields,
  entryResultText,
  entryTitle,
  pairSteps,
  shortId,
  timeLabel,
  type StepEntry,
} from "./stepFormat";
import { teamColor, useAgentDirectory } from "./useAgentDirectory";

function entryState(e: StepEntry): "running" | "ok" | "warn" {
  if (e.kind === "watchdog" || e.kind === "error" || e.raw.payload?.ok === false || e.raw.payload?.result === "fail") return "warn";
  if (e.kind === "tool_call" && !e.done) return "running";
  return "ok";
}

function rawText(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ProcessSteps({
  steps,
  limit = 120,
  newestFirst = false,
  showRun = false,
}: {
  steps: RunStepItem[];
  limit?: number;
  newestFirst?: boolean;
  showRun?: boolean;
}) {
  const { resolve } = useAgentDirectory();
  const entries = pairSteps(steps);
  const visible = newestFirst ? entries.slice(-limit).reverse() : entries.slice(-limit);
  if (!visible.length) return <div className="empty">暂无执行记录。</div>;
  return (
    <ol className="step-list">
      {visible.map((e) => {
        const state = entryState(e);
        const fields = describeFields(e.args, 4);
        const manifest = e.raw.payload?.manifest;
        const result = manifest ? "" : entryResultText(e);
        const who = actorName(e.actor, resolve);
        const team = e.actor === "system" ? "其他" : resolve(e.actor).team;
        return (
          <li key={e.key} className={`step-item step-item--${state}`}>
            <span className="step-item__dot" />
            <div className="step-item__body">
              <div className="step-item__head">
                <strong>{entryTitle(e)}</strong>
                <span className="step-item__actor" style={{ color: teamColor(team) }}>
                  {who}
                </span>
                {state === "running" ? <span className="step-item__running">进行中</span> : null}
                <time>{timeLabel(e.createdAt).split(" ").pop()}</time>
              </div>
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
              {result ? <div className="step-item__result">{result}</div> : null}
              {showRun && e.runId ? (
                <small className="step-item__run">任务 {shortId(e.runId)}</small>
              ) : null}
              {manifest ? <ContextManifest value={manifest} /> : e.args || e.result != null ? (
                <details className="step-item__detail">
                  <summary>查看完整参数与结果</summary>
                  {e.args ? (
                    <div>
                      <strong>参数</strong>
                      <pre>{rawText(e.args)}</pre>
                    </div>
                  ) : null}
                  {e.result != null ? (
                    <div>
                      <strong>返回</strong>
                      <pre>{rawText(e.result)}</pre>
                    </div>
                  ) : null}
                </details>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
