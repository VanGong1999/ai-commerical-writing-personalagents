import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge, Button, Panel } from "@xiezuomanju/ui";
import { useState } from "react";
import { api, type EvalScoreResult } from "../../api/client";
import { pct, VERDICT_TONE } from "./evalUtils";

export function ArtifactEvalPanel({
  artifactId,
  projectId,
  text,
  format,
  artifactType,
}: {
  artifactId?: string;
  projectId?: string;
  text?: string;
  format?: string;
  artifactType?: string;
}) {
  const [result, setResult] = useState<EvalScoreResult | null>(null);
  const cfg = useQuery({ queryKey: ["eval-config"], queryFn: () => api.evalConfig() });

  const score = useMutation({
    mutationFn: () =>
      api.scoreArtifact({
        artifactId,
        text: artifactId ? undefined : text,
        format,
        artifactType,
        includeLlm: true,
      }),
    onSuccess: (r) => setResult(r),
  });

  const flag = useMutation({
    mutationFn: (good: boolean) => {
      if (!artifactId) throw new Error("需要 artifactId");
      return api.flagEvalArtifact({ artifactId, projectId, good });
    },
  });

  return (
    <Panel
      title="质量评测"
      actions={
        <div className="row" style={{ gap: 6 }}>
          <Button size="sm" onClick={() => score.mutate()} disabled={score.isPending || (!artifactId && !text)}>
            {score.isPending ? "评测中…" : "评测本篇"}
          </Button>
          {artifactId && (
            <>
              <Button size="sm" variant="ghost" onClick={() => flag.mutate(true)} disabled={flag.isPending}>
                标为好例
              </Button>
              <Button size="sm" variant="ghost" onClick={() => flag.mutate(false)} disabled={flag.isPending}>
                标为坏例
              </Button>
            </>
          )}
        </div>
      }
    >
      {!result && (
        <div className="faint" style={{ fontSize: 13 }}>
          用课程提炼的 Rubric + 硬闸给这篇打分。低分时可把失败项反馈给改稿 Agent。
          {cfg.data?.autoReviseEnabled ? "（已开启自动驾驶低分返修）" : ""}
        </div>
      )}
      {result && (
        <div className="stack-sm">
          <div className="row" style={{ gap: 8 }}>
            <Badge tone={result.passed ? "ok" : result.detail.assessment === "blocked" ? "fail" : "default"}>
              {result.detail.assessment === "not_assessed" ? "无必评项" : result.detail.assessment === "needs_review" ? "待复核" : result.passed ? "必评项通过" : "未通过"}{result.detail.assessment !== "not_assessed" && ` · ${pct(result.score)}`}
            </Badge>
            <span className="faint" style={{ fontSize: 12 }}>
              {result.judgments?.length || 0} 条判定
              {typeof result.detail.advisoryPassRate === "number" && ` · 可选项通过比例 ${pct(result.detail.advisoryPassRate)}`}
            </span>
          </div>
          <ul className="stack-sm" style={{ paddingLeft: 0, listStyle: "none" }}>
            {(result.judgments || []).map((j) => (
              <li key={j.id || j.rubricKey} style={{ fontSize: 13 }}>
                <Badge tone={j.severity === "advisory" ? "default" : VERDICT_TONE[j.verdict] || "default"}>{j.severity === "advisory" ? "可选建议 · " : ""}{j.verdict}</Badge>{" "}
                <span>{j.rubricKey}</span>
                {j.evidenceQuote ? (
                  <div className="faint" style={{ fontSize: 12 }}>
                    「{j.evidenceQuote}」
                  </div>
                ) : null}
                {j.reasoning ? (
                  <div className="faint" style={{ fontSize: 12 }}>
                    {j.reasoning}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {result.detail.assessment === "blocked" && (
            <div className="faint" style={{ fontSize: 12 }}>
              失败项可复制到改稿指令；自动驾驶开启返修时会自动喂给修改 Agent。
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
