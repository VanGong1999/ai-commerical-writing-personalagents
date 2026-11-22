import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, EmptyBlock, Panel } from "@xiezuomanju/ui";
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { pct, VERDICT_TONE } from "./evalUtils";

export function EvalRunsPanel() {
  const qc = useQueryClient();
  const suites = useQuery({ queryKey: ["eval-suites"], queryFn: () => api.listEvalSuites() });
  const runs = useQuery({ queryKey: ["eval-runs"], queryFn: () => api.listEvalRuns({ limit: 40 }) });
  const [suiteId, setSuiteId] = useState("");
  const [includeLlm, setIncludeLlm] = useState(false);
  const [asyncMode, setAsyncMode] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [trialId, setTrialId] = useState<string | null>(null);

  const runDetail = useQuery({
    queryKey: ["eval-run", activeRunId],
    queryFn: () => api.getEvalRun(activeRunId!),
    enabled: !!activeRunId,
    refetchInterval: (q) => {
      const st = q.state.data?.status;
      return st === "queued" || st === "running" ? 2000 : false;
    },
  });

  const trial = useQuery({
    queryKey: ["eval-trial", trialId],
    queryFn: () => api.getEvalTrial(trialId!),
    enabled: !!trialId,
  });

  const create = useMutation({
    mutationFn: () =>
      api.createEvalRun({
        suiteId,
        includeLlm,
        async: asyncMode,
        trialsK: undefined,
      }),
    onSuccess: (r) => {
      setActiveRunId(r.id);
      void qc.invalidateQueries({ queryKey: ["eval-runs"] });
    },
  });

  const override = useMutation({
    mutationFn: (body: { rubricKey: string; verdict: string }) =>
      api.overrideEvalJudgment(trialId!, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["eval-trial", trialId] }),
  });

  useEffect(() => {
    if (!suiteId && suites.data?.suites?.[0]) {
      setSuiteId(suites.data.suites[0].id);
    }
  }, [suites.data, suiteId]);

  const matrix = runDetail.data?.matrix;
  const metrics = runDetail.data?.metrics || {};
  const comparison = metrics.compare as { comparable?: boolean; reason?: string } | undefined;

  return (
    <div className="stack-lg">
      <Panel title="新建运行">
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={suiteId} onChange={(e) => setSuiteId(e.target.value)} style={{ minWidth: 240 }}>
            {(suites.data?.suites || []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="row" style={{ gap: 4 }}>
            <input type="checkbox" checked={includeLlm} onChange={(e) => setIncludeLlm(e.target.checked)} />
            启用 LLM 评委
          </label>
          <label className="row" style={{ gap: 4 }}>
            <input type="checkbox" checked={asyncMode} onChange={(e) => setAsyncMode(e.target.checked)} />
            异步队列
          </label>
          <Button
            onClick={() => create.mutate()}
            disabled={!suiteId || create.isPending}
          >
            {create.isPending ? "运行中…" : "开始评测"}
          </Button>
        </div>
        <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
          建议第一次关掉 LLM，只跑代码闸（零 token）。异步模式需 job-worker 在跑。
        </div>
      </Panel>

      <div className="grid-2">
        <Panel title="历史运行">
          {(runs.data?.runs || []).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setActiveRunId(r.id);
                setTrialId(null);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 4px",
                border: "none",
                background: activeRunId === r.id ? "var(--surface-2,#f3f4f6)" : "transparent",
                cursor: "pointer",
              }}
            >
              <div className="row" style={{ gap: 6 }}>
                <Badge tone={r.gateVerdict === "pass" ? "ok" : r.gateVerdict === "blocked" ? "fail" : "default"}>
                  {r.gateVerdict === "not_assessed" ? "无必评项" : r.gateVerdict === "needs_review" ? "待复核" : r.gateVerdict || r.status}
                </Badge>
                <span style={{ fontSize: 13 }}>{r.id.slice(0, 8)}</span>
                <span className="faint" style={{ fontSize: 12 }}>
                  {r.progressPct}% · {String((r.metrics as { passRate?: number })?.passRate != null ? pct((r.metrics as { passRate?: number }).passRate) : "—")}
                </span>
              </div>
            </button>
          ))}
          {!runs.data?.count && <EmptyBlock title="还没有运行" description="上面选套件后开始。" />}
        </Panel>

        <Panel title="运行结果">
          {!activeRunId && <EmptyBlock title="选择或新建一次运行" />}
          {activeRunId && runDetail.data && (
            <div className="stack-sm">
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <Badge>{runDetail.data.status}</Badge>
                <Badge tone={runDetail.data.gateVerdict === "pass" ? "ok" : runDetail.data.gateVerdict === "blocked" ? "fail" : "default"}>
                  门禁 {runDetail.data.gateVerdict === "not_assessed" ? "无必评项" : runDetail.data.gateVerdict === "needs_review" ? "待复核" : runDetail.data.gateVerdict || "—"}
                </Badge>
                <span className="faint">
                  pass {pct(metrics.passRate as number)} · pass@k {pct(metrics.passAtK as number)} ·
                  pass^k {pct(metrics.passHatK as number)} · unknown {pct(metrics.unknownRate as number)}
                </span>
              </div>

              {comparison?.comparable === false && <div>基线不可比较 · {comparison.reason}</div>}
              {matrix && matrix.rubricKeys?.length > 0 ? (
                <div style={{ overflow: "auto" }}>
                  <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: 4 }}>Case \\ Rubric</th>
                        {matrix.rubricKeys.map((rk) => (
                          <th key={rk} title={rk} style={{ padding: 4, maxWidth: 72, overflow: "hidden" }}>
                            {rk.split(".").slice(-1)[0]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.caseIds.map((cid) => (
                        <tr key={cid}>
                          <td style={{ padding: 4 }}>
                            {matrix.cases?.[cid]?.title || cid.slice(0, 6)}
                            <div>
                              {(matrix.trials || [])
                                .filter((t) => t.caseId === cid)
                                .map((t) => (
                                  <button
                                    key={t.id}
                                    type="button"
                                    style={{ fontSize: 10, marginRight: 4 }}
                                    onClick={() => setTrialId(t.id)}
                                  >
                                    t{t.trialIdx}
                                  </button>
                                ))}
                            </div>
                          </td>
                          {matrix.rubricKeys.map((rk) => {
                            const cell = matrix.cells.find((c) => c.caseId === cid && c.rubricKey === rk);
                            const v = cell?.verdict || "unknown";
                            return (
                              <td key={rk} style={{ padding: 4, textAlign: "center" }}>
                                <Badge tone={VERDICT_TONE[v] || "default"}>{v[0]?.toUpperCase()}</Badge>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="faint">等待矩阵…（{runDetail.data.progressPct}%）</div>
              )}
            </div>
          )}
        </Panel>
      </div>

      {trialId && trial.data && (
        <Panel title={`试验详情 · ${trialId.slice(0, 8)}`}>
          <div className="grid-2">
            <div>
              <div className="faint">正文快照（证据高亮见判定列表）</div>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 320, overflow: "auto" }}>
                {trial.data.outputSnapshot || "(空)"}
              </pre>
            </div>
            <div className="stack-sm">
              <div>
                {trial.data.passed != null && `必评分 ${trial.data.score.toFixed(3)} · `}
                {trial.data.processMetrics?.assessment === "needs_review" ? "待复核" : trial.data.passed == null ? "无必评项" : trial.data.passed ? "通过" : "未通过"}
              </div>
              {(trial.data.judgments || []).map((j) => (
                <div key={j.id} className="card" style={{ padding: 8 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <Badge tone={VERDICT_TONE[j.verdict] || "default"}>{trial.data?.processMetrics?.advisoryKeys?.includes(j.rubricKey) ? "可选建议 · " : ""}{j.verdict}</Badge>
                    <Badge>{j.grader}</Badge>
                    <span style={{ fontSize: 12 }}>{j.rubricKey}</span>
                  </div>
                  {j.evidenceQuote && (
                    <div style={{ fontSize: 12, marginTop: 4 }}>
                      证据：「{j.evidenceQuote}」
                    </div>
                  )}
                  <div className="faint" style={{ fontSize: 12 }}>
                    {j.reasoning}
                  </div>
                  <div className="row" style={{ gap: 4, marginTop: 4 }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => override.mutate({ rubricKey: j.rubricKey, verdict: "pass" })}
                    >
                      人工判过
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => override.mutate({ rubricKey: j.rubricKey, verdict: "fail" })}
                    >
                      人工判败
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
