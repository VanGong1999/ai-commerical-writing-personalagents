/**
 * 九格 16.md 漫剧小灶课 · 考拉工作流：滚动交稿（3集正文+10集大纲 → 10集正文+30集大纲 → 60集大纲）
 * + 每集校正清单（爽点/危机逐集勾）+ 工具配对（DS 与豆包分工）。
 */
import { MANJU_PIPELINE_CHECKPOINTS, type RollingMilestone } from "@xiezuomanju/domain";
import { Badge, CollapsibleSection, Panel } from "@xiezuomanju/ui";
import { usePersistedState } from "./usePersistedState";

const ROLLING_LABELS: Record<RollingMilestone, string> = {
  pitch: "投稿包：3集正文 + 10集大纲",
  post_10_30: "滚动：10集正文 + 30集大纲",
  outline_60: "长线：60集大纲",
};

const ROLLING_ORDER: RollingMilestone[] = ["pitch", "post_10_30", "outline_60"];

type CheckState = Record<string, boolean>;

export function KaolaRollingWorkbench({ projectId }: { projectId?: string }) {
  const [milestone, setMilestone] = usePersistedState<RollingMilestone>(
    projectId,
    "kaola-rolling",
    "pitch",
  );
  const [checks, setChecks] = usePersistedState<CheckState>(
    projectId,
    "kaola-pipeline",
    {},
  );
  const [epReview, setEpReview] = usePersistedState<Record<number, { cool: boolean; crisis: boolean }>>(
    projectId,
    "kaola-ep-review",
    {},
  );

  const doneCount = MANJU_PIPELINE_CHECKPOINTS.filter((c) => checks[c.id]).length;

  return (
    <CollapsibleSection
      title="考拉工作流 · 滚动交稿（16.md）"
      badge={`${doneCount}/${MANJU_PIPELINE_CHECKPOINTS.length} 步`}
      summary="BioAck 先于大纲；先交 3+10 滚动到 10+30 再到 60 大纲，禁一次性整本"
      storageKey={projectId ? `deliverable-${projectId}-kaola` : undefined}
      defaultOpen={false}
    >
      <Panel title="滚动里程碑">
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {ROLLING_ORDER.map((m) => (
            <button
              key={m}
              type="button"
              className="badge"
              onClick={() => setMilestone(m)}
              style={{
                cursor: "pointer",
                borderColor: milestone === m ? "var(--accent)" : undefined,
                background: milestone === m ? "var(--accent-soft)" : undefined,
              }}
            >
              {ROLLING_LABELS[m]}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="考拉十二步管线">
        <div className="stack" style={{ gap: 6 }}>
          {MANJU_PIPELINE_CHECKPOINTS.map((c) => (
            <label key={c.id} className="row" style={{ gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={!!checks[c.id]}
                onChange={() => setChecks((prev) => ({ ...prev, [c.id]: !prev[c.id] }))}
              />
              <span style={{ flex: 1 }}>
                {c.label}
                <span className="faint" style={{ fontSize: 12, marginLeft: 8 }}>
                  {c.userAction}
                </span>
              </span>
              <Badge>{c.level}</Badge>
            </label>
          ))}
        </div>
      </Panel>

      <Panel title="每集校正（爽点/危机逐集勾）">
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((ep) => {
            const r = epReview[ep] ?? { cool: false, crisis: false };
            return (
              <div
                key={ep}
                className="stack"
                style={{ gap: 4, padding: 8, border: "1px solid var(--line)", borderRadius: 8, minWidth: 96 }}
              >
                <strong style={{ fontSize: 12 }}>EP{ep}</strong>
                <label className="row" style={{ gap: 4, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={r.cool}
                    onChange={() =>
                      setEpReview((prev) => ({
                        ...prev,
                        [ep]: { ...r, cool: !r.cool },
                      }))
                    }
                  />
                  爽点
                </label>
                <label className="row" style={{ gap: 4, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={r.crisis}
                    onChange={() =>
                      setEpReview((prev) => ({
                        ...prev,
                        [ep]: { ...r, crisis: !r.crisis },
                      }))
                    }
                  />
                  危机/卡点
                </label>
              </div>
            );
          })}
        </div>
      </Panel>
    </CollapsibleSection>
  );
}
