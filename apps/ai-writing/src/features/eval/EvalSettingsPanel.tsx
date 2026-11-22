import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Panel } from "@xiezuomanju/ui";
import { useEffect, useState } from "react";
import { api } from "../../api/client";

export function EvalSettingsPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["eval-config"], queryFn: () => api.evalConfig() });
  const [judgeModel, setJudgeModel] = useState("");
  const [budget, setBudget] = useState(500000);
  const [sampleRate, setSampleRate] = useState(0.2);
  const [autoRevise, setAutoRevise] = useState(false);
  const [threshold, setThreshold] = useState(0.7);
  const [tolerance, setTolerance] = useState(0.02);

  useEffect(() => {
    if (!data) return;
    setJudgeModel(data.judgeModel || "");
    setBudget(Number(data.monthlyBudgetTokens ?? 500000));
    setSampleRate(Number(data.onlineSampleRate ?? 0.2));
    setAutoRevise(Boolean(data.autoReviseEnabled));
    setThreshold(Number(data.autoReviseThreshold ?? 0.7));
    setTolerance(Number(data.regressionTolerance ?? 0.02));
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api.putEvalConfig({
        judgeModel: judgeModel || null,
        monthlyBudgetTokens: budget,
        onlineSampleRate: sampleRate,
        autoReviseEnabled: autoRevise,
        autoReviseThreshold: threshold,
        regressionTolerance: tolerance,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["eval-config"] }),
  });

  return (
    <Panel title="评测设置">
      <div className="stack-sm" style={{ maxWidth: 480 }}>
        <label>
          <div className="faint">评委模型（空=跟随默认；建议与写作模型不同厂商）</div>
          <input value={judgeModel} onChange={(e) => setJudgeModel(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label>
          <div className="faint">月度评测 Token 预算</div>
          <input
            type="number"
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            style={{ width: "100%" }}
          />
          <div className="faint" style={{ fontSize: 12 }}>
            本月已用 {data?.tokensUsedThisMonth ?? 0} · 剩余 {data?.budgetRemaining ?? "—"}
          </div>
        </label>
        <label>
          <div className="faint">线上抽检率（0–1）</div>
          <input
            type="number"
            step="0.05"
            min={0}
            max={1}
            value={sampleRate}
            onChange={(e) => setSampleRate(Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </label>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={autoRevise} onChange={(e) => setAutoRevise(e.target.checked)} />
          自动驾驶低分自动返修 1 轮
        </label>
        <label>
          <div className="faint">自动返修阈值（得分低于此值触发）</div>
          <input
            type="number"
            step="0.05"
            min={0}
            max={1}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </label>
        <label>
          <div className="faint">回归对比容忍度</div>
          <input
            type="number"
            step="0.01"
            min={0}
            max={0.2}
            value={tolerance}
            onChange={(e) => setTolerance(Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </label>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "保存中…" : "保存设置"}
        </Button>
      </div>
    </Panel>
  );
}
