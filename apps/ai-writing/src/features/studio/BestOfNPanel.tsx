import { Button, CollapsibleSection, toast } from "@xiezuomanju/ui";
import { useState } from "react";
import { api } from "../../api/client";

type Candidate = { id: string; text: string };
type Ranked = {
  id: string;
  rank: number;
  passed: boolean;
  score: number;
  failedRubrics: string[];
  assessment: string;
  advisoryJudgments: { rubricKey: string; reasoning?: string }[];
  chars: number;
};

const MAX = 4;

/**
 * best-of-N 选稿面板。候选稿可由同一步多次运行得到后粘贴进来；
 * 先用代码闸计分排序（不调 LLM 评委，控制本地耗时），用户选稿后，
 * 未选中的候选与选中稿配对写入 PreferencePair(bestofn_pick)。
 */
export function BestOfNPanel({
  projectId,
  artifactId,
  format,
  defaultOpen = false,
}: {
  projectId?: string;
  artifactId?: string;
  format?: string;
  defaultOpen?: boolean;
}) {
  const [cands, setCands] = useState<Candidate[]>([
    { id: "c1", text: "" },
    { id: "c2", text: "" },
  ]);
  const [ranked, setRanked] = useState<Ranked[] | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (id: string, text: string) =>
    setCands((prev) => prev.map((c) => (c.id === id ? { ...c, text } : c)));

  const filled = cands.filter((c) => c.text.trim());

  const rank = async () => {
    if (filled.length < 2) {
      toast.fail("至少需要 2 份非空候选稿");
      return;
    }
    setBusy(true);
    try {
      const r = await api.postBestOfNRank({
        candidates: filled,
        format: format ?? "*",
        includeLlm: false,
      });
      setRanked(r.ranked);
      toast.ok("已按必评项排序，请自行选稿");
    } catch (e) {
      toast.fail(e instanceof Error ? e.message : "计分失败");
    } finally {
      setBusy(false);
    }
  };

  const pick = async (pickedId: string) => {
    setBusy(true);
    try {
      const r = await api.postBestOfNPick({
        candidates: filled,
        pickedId,
        format: format ?? "*",
        projectId,
        artifactId,
        prompt: "best-of-N 选稿",
      });
      toast.ok(`已记录 ${r.count} 组偏好`);
    } catch (e) {
      toast.fail(e instanceof Error ? e.message : "记录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CollapsibleSection
      title="best-of-N 选稿"
      badge={`${filled.length} 稿`}
      summary={ranked ? "按必评项排序" : "粘贴候选稿后计分"}
      defaultOpen={defaultOpen}
    >
      <div className="stack">
        <div className="muted" style={{ fontSize: "var(--fs-xs)", lineHeight: 1.6 }}>
          本地模型耗时较长：同一步运行 N 次（默认 2）后，把候选稿粘贴到下方。计分只用代码闸，不调 LLM 评委。
        </div>
        {cands.map((c, i) => (
          <label key={c.id} className="field">
            <span>候选 {i + 1}</span>
            <textarea
              className="textarea"
              rows={4}
              value={c.text}
              onChange={(e) => update(c.id, e.target.value)}
              placeholder="粘贴一稿正文"
            />
          </label>
        ))}
        <div className="row" style={{ gap: 6 }}>
          {cands.length < MAX && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setCands((prev) => [...prev, { id: `c${prev.length + 1}`, text: "" }])
              }
            >
              + 候选
            </Button>
          )}
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void rank()}>
            计分排序
          </Button>
        </div>
        {ranked && (
          <div className="stack" style={{ gap: 6 }}>
            {ranked.map((r) => (
              <div key={r.id} className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 12 }}>
                  #{r.rank} {r.id} · {r.assessment === "not_assessed" ? "无必评项" : r.assessment === "needs_review" ? "待复核" : r.passed ? "通过" : "未过门禁"}{r.assessment !== "not_assessed" && ` · 必评分 ${r.score.toFixed(2)}`} · {r.chars} 字
                  {r.advisoryJudgments.length > 0 && <details><summary>可选建议（{r.advisoryJudgments.length}）</summary>{r.advisoryJudgments.map(j => <div key={j.rubricKey}>{j.rubricKey} · {j.reasoning}</div>)}</details>}
                  {r.failedRubrics.length > 0 && (
                    <span className="muted"> · 失败：{r.failedRubrics.slice(0, 3).join("、")}</span>
                  )}
                </span>
                <Button size="sm" disabled={busy} onClick={() => void pick(r.id)}>
                  选这稿
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
