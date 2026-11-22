import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, EmptyBlock, Panel } from "@xiezuomanju/ui";
import { useMemo, useState } from "react";
import type { ProjectFormat } from "@xiezuomanju/domain";
import { api, formatLabel, type EvalRubric } from "../../api/client";
import { pct } from "./evalUtils";

export function EvalRubricsPanel() {
  const [format, setFormat] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["eval-rubrics", format],
    queryFn: () => api.listEvalRubrics(format ? { format } : undefined),
  });
  const stats = useQuery({
    queryKey: ["eval-rubric-stats", selected],
    queryFn: () => api.evalRubricStats(selected!),
    enabled: !!selected,
  });

  const cache = useQueryClient();
  const setting = useMutation({
    mutationFn: ({ key, severity }: { key: string; severity: string }) => api.patchEvalRubric(key, { severity }),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["eval-rubrics"] }),
  });

  const grouped = useMemo(() => {
    const map = new Map<string, Map<string, EvalRubric[]>>();
    for (const r of data?.rubrics || []) {
      if (!map.has(r.format)) map.set(r.format, new Map());
      const byType = map.get(r.format)!;
      if (!byType.has(r.artifactType)) byType.set(r.artifactType, []);
      byType.get(r.artifactType)!.push(r);
    }
    return map;
  }, [data]);

  if (isLoading) return <div>加载评分细则…</div>;

  return (
    <div className="grid-2">
      <Panel
        title="细则树"
        actions={
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="">全部格式</option>
            <option value="*">通用</option>
            <option value="manju">漫剧</option>
            <option value="duanju">短剧</option>
            <option value="male_long">男频</option>
            <option value="female_long">女频</option>
            <option value="short_novel">短篇</option>
            <option value="ip_adapt">IP</option>
          </select>
        }
      >
        {!data?.count && <EmptyBlock title="暂无细则" description="先到总览同步种子。" />}
        {[...grouped.entries()].map(([fmt, byType]) => (
          <div key={fmt} style={{ marginBottom: 16 }}>
            <strong>
              {fmt === "*" ? "通用" : formatLabel(fmt as ProjectFormat)}
            </strong>
            {[...byType.entries()].map(([atype, rows]) => (
              <div key={atype} style={{ marginLeft: 8, marginTop: 6 }}>
                <div className="faint" style={{ fontSize: 12 }}>
                  {atype}
                </div>
                {rows.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    className="row"
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "6px 4px",
                      background: selected === r.key ? "var(--surface-2, #f3f4f6)" : "transparent",
                      border: "none",
                      cursor: "pointer",
                      gap: 6,
                    }}
                    onClick={() => setSelected(r.key)}
                  >
                    <Badge tone={r.severity === "veto" ? "fail" : r.severity === "major" ? "warn" : "default"}>
                      {r.severity === "advisory" ? "可选建议" : r.severity}
                    </Badge>
                    <Badge>{r.grader}</Badge>
                    <span style={{ fontSize: 13 }}>{r.name}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        ))}
      </Panel>

      <Panel title={selected ? `细则详情 · ${selected}` : "选择一条细则"}>
        {!selected && <EmptyBlock title="点左侧一条 Rubric" description="查看问句、出处、示例与一致率。" />}
        {selected &&
          (() => {
            const r = data?.rubrics.find((x) => x.key === selected);
            if (!r) return null;
            const agr = stats.data?.humanMachineAgreement;
            return (
              <div className="stack-sm">
                <div>
                  <strong>{r.question}</strong>
                </div>
                <label>评测用途 <select value={r.severity} disabled={setting.isPending}
                  onChange={event => setting.mutate({ key: r.key, severity: event.target.value })}>
                  <option value="advisory">可选建议</option><option value="major">必评（主要）</option>
                  <option value="minor">必评（次要）</option><option value="veto">必评（一票否决）</option>
                </select></label>
                {setting.isError && <span role="alert">保存失败，请重试</span>}
                <div className="faint">{r.guidance}</div>
                <div className="faint" style={{ fontSize: 12 }}>
                  出处：{r.sourceRef || "—"} · 来源 {r.source} · v{r.version}
                </div>
                {r.codeGate && (
                  <div>
                    代码闸：<code>{r.codeGate}</code>
                  </div>
                )}
                <div>
                  <div className="faint">通过示例</div>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{r.passExample || "—"}</pre>
                </div>
                <div>
                  <div className="faint">失败示例</div>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{r.failExample || "—"}</pre>
                </div>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  {(r.wCodes || []).map((w) => (
                    <Badge key={w}>{w}</Badge>
                  ))}
                </div>
                {stats.data && (
                  <div className="stack-sm" style={{ marginTop: 8 }}>
                    <div>
                      通过率 {pct(stats.data.passRate)} · unknown {pct(stats.data.unknownRate)} · 样本{" "}
                      {stats.data.total}
                    </div>
                    <div>
                      人机一致 {pct(agr)}{" "}
                      {agr != null && agr < 0.85 ? (
                        <Badge tone="fail">需下钻改写（&lt;85%）</Badge>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
      </Panel>
    </div>
  );
}
