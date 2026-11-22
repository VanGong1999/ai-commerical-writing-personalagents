import { Badge, Button, Panel, toast } from "@xiezuomanju/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";

type LastScore = {
  mode?: string;
  total?: number;
  breakdown?: Record<string, number>;
  notes?: string[];
  runId?: string;
  agentId?: string;
  trajectoryPath?: string;
};

/** 实验：程序化 RL 评分（score_only），不训练模型权重 */
export function RlScorePanel({ projectId }: { projectId?: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const rlMode = String((project?.coverMeta as { rlMode?: string } | undefined)?.rlMode || "off");

  const { data: lastScore } = useQuery({
    queryKey: ["rl-last-score", projectId],
    queryFn: async () => {
      const f = await api.getMemory(`/memories/projects/${projectId}/rl/last_score.json`);
      const raw = (f as { content?: string })?.content || "";
      if (!raw.trim()) return null;
      return JSON.parse(raw) as LastScore;
    },
    enabled: Boolean(projectId) && rlMode === "score_only",
    retry: false,
  });

  const setMode = async (mode: "off" | "score_only") => {
    if (!projectId || !project) return;
    setBusy(true);
    try {
      await api.patchProject(projectId, {
        coverMeta: { ...project.coverMeta, rlMode: mode },
      });
      await qc.invalidateQueries({ queryKey: ["project", projectId] });
      toast.ok(mode === "off" ? "已关闭程序化评分" : "已启用 score_only（轨迹+奖励，不训权重）");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="程序化评分（实验 · Hermes 子集）">
      <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
        只打 bible/图/伏笔/字数衰减/工具纪律等可验证项；不评剧情好坏，不替代 LogicAck。默认关闭。
      </p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <Badge tone={rlMode === "score_only" ? "ok" : "default"}>rl_mode={rlMode}</Badge>
        <Button size="sm" disabled={!projectId || busy || rlMode === "off"} onClick={() => void setMode("off")}>
          关闭
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!projectId || busy || rlMode === "score_only"}
          onClick={() => void setMode("score_only")}
        >
          启用 score_only
        </Button>
      </div>
      {rlMode === "score_only" && lastScore ? (
        <div className="stack" style={{ gap: 4, fontSize: 12 }}>
          <div>
            最近总分 <strong>{lastScore.total ?? "—"}</strong>
            {lastScore.agentId ? ` · ${lastScore.agentId}` : ""}
          </div>
          {lastScore.breakdown
            ? Object.entries(lastScore.breakdown).map(([k, v]) => (
                <div key={k} className="row" style={{ gap: 8 }}>
                  <span style={{ minWidth: 140 }}>{k}</span>
                  <Badge tone={v >= 0.99 ? "ok" : v >= 0.5 ? "warn" : "fail"}>{v}</Badge>
                </div>
              ))
            : null}
          {lastScore.notes?.length ? (
            <p className="muted" style={{ margin: 0 }}>
              {lastScore.notes.join("；")}
            </p>
          ) : null}
          {lastScore.trajectoryPath ? (
            <p className="muted" style={{ margin: 0 }}>
              轨迹：{lastScore.trajectoryPath}
            </p>
          ) : null}
        </div>
      ) : rlMode === "score_only" ? (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          尚无评分记录；跑一轮正文/图相关 Agent 后会出现。
        </p>
      ) : null}
    </Panel>
  );
}
