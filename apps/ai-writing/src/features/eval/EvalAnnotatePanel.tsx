import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, EmptyBlock, Panel } from "@xiezuomanju/ui";
import { useState } from "react";
import { api } from "../../api/client";
import { pct } from "./evalUtils";

export function EvalAnnotatePanel() {
  const qc = useQueryClient();
  const queue = useQuery({
    queryKey: ["eval-annotate-queue"],
    queryFn: () => api.evalAnnotateQueue(15),
  });
  const agreement = useQuery({
    queryKey: ["eval-agreement"],
    queryFn: () => api.evalAgreement(),
  });
  const [idx, setIdx] = useState(0);
  const item = queue.data?.queue?.[idx];

  const submit = useMutation({
    mutationFn: (verdict: string) =>
      api.evalAnnotate({
        rubricKey: item!.rubricKey,
        trialId: item!.trialId,
        artifactId: item!.artifactId,
        verdict,
        blind: true,
        reasoning: "盲标",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["eval-annotate-queue"] });
      void qc.invalidateQueries({ queryKey: ["eval-agreement"] });
      setIdx((i) => i);
    },
  });

  return (
    <div className="grid-2">
      <Panel title="盲标队列（隐藏机评结论）">
        {!item && <EmptyBlock title="队列为空" description="先跑一些机评，再来对齐标准。" />}
        {item && (
          <div className="stack-sm">
            <div className="faint" style={{ fontSize: 12 }}>
              {idx + 1} / {queue.data?.count || 0} · {item.rubricKey}
            </div>
            <strong>{item.question}</strong>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 280, overflow: "auto" }}>
              {item.outputPreview || "(无正文预览)"}
            </pre>
            <div className="row" style={{ gap: 8 }}>
              <Button onClick={() => submit.mutate("pass")} disabled={submit.isPending}>
                通过
              </Button>
              <Button onClick={() => submit.mutate("fail")} disabled={submit.isPending}>
                失败
              </Button>
              <Button variant="ghost" onClick={() => submit.mutate("unknown")} disabled={submit.isPending}>
                未知
              </Button>
              <Button
                variant="ghost"
                onClick={() => setIdx((i) => Math.min(i + 1, (queue.data?.count || 1) - 1))}
              >
                跳过
              </Button>
            </div>
          </div>
        )}
      </Panel>
      <Panel title="一致率">
        <div className="stack-sm">
          <div>
            人机一致：{pct(agreement.data?.humanMachineAgreement)} · kappa{" "}
            {agreement.data?.cohenKappa?.toFixed?.(2) ?? "—"} · 配对{" "}
            {agreement.data?.pairedCount ?? 0}
          </div>
          {(agreement.data?.perRubric || []).map((r) => (
            <div key={r.rubricKey} className="row" style={{ justifyContent: "space-between" }}>
              <span style={{ fontSize: 12 }}>{r.rubricKey}</span>
              <span>
                {pct(r.agreement)}{" "}
                {r.needsRewrite ? <Badge tone="fail">需改写</Badge> : <Badge tone="ok">OK</Badge>}
              </span>
            </div>
          ))}
          {!agreement.data?.pairedCount && (
            <EmptyBlock title="还没有配对标注" description="盲标几条后会出现一致率。" />
          )}
        </div>
      </Panel>
    </div>
  );
}
