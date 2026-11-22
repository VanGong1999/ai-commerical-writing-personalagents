import { useQuery } from "@tanstack/react-query";
import { Badge, EmptyBlock, Panel } from "@xiezuomanju/ui";
import { useState } from "react";
import type { ProjectFormat } from "@xiezuomanju/domain";
import { api, formatLabel } from "../../api/client";
import { TIER_LABEL } from "./evalUtils";

export function EvalSuitesPanel() {
  const [tier, setTier] = useState("");
  const [suiteId, setSuiteId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["eval-suites", tier],
    queryFn: () => api.listEvalSuites(tier ? { tier } : undefined),
  });
  const cases = useQuery({
    queryKey: ["eval-cases", suiteId],
    queryFn: () => api.listEvalCases(suiteId!),
    enabled: !!suiteId,
  });

  if (isLoading) return <div>加载评测集…</div>;

  return (
    <div className="grid-2">
      <Panel
        title="评测集"
        actions={
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="">全部层级</option>
            {Object.entries(TIER_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        }
      >
        {(data?.suites || []).map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSuiteId(s.id)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "8px 6px",
              border: "none",
              background: suiteId === s.id ? "var(--surface-2, #f3f4f6)" : "transparent",
              cursor: "pointer",
            }}
          >
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <Badge>{TIER_LABEL[s.tier] || s.tier}</Badge>
              <Badge>{s.kind}</Badge>
              <span>{s.name}</span>
            </div>
            <div className="faint" style={{ fontSize: 12 }}>
              {s.format === "*" ? "通用" : formatLabel(s.format as ProjectFormat)} ·{" "}
              {s.caseCount ?? 0} cases · k={s.trialsK}
            </div>
          </button>
        ))}
        {!data?.count && <EmptyBlock title="暂无评测集" description="先同步种子。" />}
      </Panel>

      <Panel title={suiteId ? "用例详情" : "选择评测集"}>
        {!suiteId && <EmptyBlock title="点左侧评测集" description="查看 Case 输入、参考稿与期望行为。" />}
        {suiteId && (
          <div className="stack-sm">
            {(cases.data?.cases || []).map((c) => (
              <div key={c.id} className="card" style={{ padding: 12 }}>
                <div className="row" style={{ gap: 6 }}>
                  <Badge tone={c.label === "good" ? "ok" : "fail"}>{c.label}</Badge>
                  <strong>{c.title || c.id.slice(0, 8)}</strong>
                </div>
                <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
                  {c.expectedBehavior}
                </div>
                {c.sourceRef && (
                  <div className="faint" style={{ fontSize: 11 }}>
                    出处：{c.sourceRef}
                  </div>
                )}
                {(c.tags || []).length > 0 && (
                  <div className="row" style={{ gap: 4, marginTop: 4 }}>
                    {c.tags.map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </div>
                )}
                {c.referenceMarkdown && (
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 160, overflow: "auto" }}>
                    {c.referenceMarkdown.slice(0, 600)}
                    {c.referenceMarkdown.length > 600 ? "…" : ""}
                  </pre>
                )}
              </div>
            ))}
            {!cases.data?.count && !cases.isLoading && (
              <EmptyBlock title="该集暂无 Case" description="可从生产产物导入。" />
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
