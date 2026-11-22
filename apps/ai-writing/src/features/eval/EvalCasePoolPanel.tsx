import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, EmptyBlock, Panel } from "@xiezuomanju/ui";
import { useState } from "react";
import { api } from "../../api/client";

const SIGNAL_LABEL: Record<string, string> = {
  rollback: "回滚",
  regenerate: "重生成",
  gate_fail: "门禁失败",
  low_score: "低分",
  random_sample: "随机抽检",
  user_flag_good: "用户标好",
  user_flag_bad: "用户标坏",
  adopted_unedited: "采纳抽检",
};

export function EvalCasePoolPanel() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("triage");
  const { data, isLoading } = useQuery({
    queryKey: ["eval-pool", status],
    queryFn: () => api.listEvalCasePool({ status: status || undefined, limit: 80 }),
  });
  const suites = useQuery({ queryKey: ["eval-suites"], queryFn: () => api.listEvalSuites() });

  const triage = useMutation({
    mutationFn: (args: { id: string; status: string; suiteId?: string; attribution?: string }) =>
      api.triageEvalCandidate(args.id, {
        status: args.status,
        suiteId: args.suiteId,
        attribution: args.attribution,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["eval-pool"] }),
  });

  const attr = useMutation({
    mutationFn: (id: string) => api.attributeEvalCandidate(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["eval-pool"] }),
  });

  const goldenSuite =
    suites.data?.suites.find((s) => s.tier === "golden")?.id ||
    suites.data?.suites[0]?.id;
  const badSuite =
    suites.data?.suites.find((s) => s.tier === "bad_case")?.id || goldenSuite;

  if (isLoading) return <div>加载 Case 池…</div>;

  return (
    <div className="stack-lg">
      <div className="row" style={{ gap: 8 }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="triage">待分诊</option>
          <option value="to_golden">已入黄金</option>
          <option value="to_bad_case">已入错题</option>
          <option value="to_rubric_fix">待改 Rubric</option>
          <option value="dismissed">已忽略</option>
          <option value="">全部</option>
        </select>
      </div>
      <Panel title="信号收件箱">
        {!data?.count && <EmptyBlock title="池子是空的" description="采纳/回滚/低分/抽检会进入这里。" />}
        <div className="stack-sm">
          {(data?.candidates || []).map((c) => (
            <div key={c.id} className="card" style={{ padding: 12 }}>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <Badge>{SIGNAL_LABEL[c.signal] || c.signal}</Badge>
                <Badge>{c.status}</Badge>
                <span className="faint" style={{ fontSize: 12 }}>
                  {c.artifactId?.slice(0, 8) || "—"} · {c.createdAt?.slice(0, 19)}
                </span>
              </div>
              {c.attributionSuggestion && (
                <div style={{ fontSize: 13, marginTop: 6 }}>建议归因：{c.attributionSuggestion}</div>
              )}
              {c.fixSuggestion && (
                <div className="faint" style={{ fontSize: 12 }}>
                  修改建议：{c.fixSuggestion}
                </div>
              )}
              <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                <Button size="sm" variant="ghost" onClick={() => attr.mutate(c.id)} disabled={attr.isPending}>
                  LLM 归因
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    triage.mutate({ id: c.id, status: "to_golden", suiteId: goldenSuite })
                  }
                >
                  入黄金集
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    triage.mutate({ id: c.id, status: "to_bad_case", suiteId: badSuite })
                  }
                >
                  入错题集
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => triage.mutate({ id: c.id, status: "to_rubric_fix" })}
                >
                  修正 Rubric
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => triage.mutate({ id: c.id, status: "dismissed" })}
                >
                  忽略
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
