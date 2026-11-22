import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Panel, toast } from "@xiezuomanju/ui";
import { useState } from "react";
import { api } from "../../api/client";
import { runAgentFeedback } from "../studio/runAgentFeedback";
import { FormatBar, StatusDonut, TrendArea } from "../../components/charts";

/** 项目数据复盘：录入点击/收藏，触发 analytics.review 建议 */
export function AnalyticsPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data: charts } = useQuery({
    queryKey: ["analytics-charts", projectId],
    queryFn: () => api.getAnalyticsCharts(projectId),
    enabled: !!projectId,
  });
  const { data } = useQuery({
    queryKey: ["analytics", projectId],
    queryFn: () => api.getAnalytics(projectId),
    enabled: !!projectId,
  });
  const [views, setViews] = useState(0);
  const [favorites, setFavorites] = useState(0);

  const save = useMutation({
    mutationFn: () =>
      api.putAnalytics(projectId, {
        views,
        favorites,
        meta: { source: "manual" },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["analytics", projectId] });
      toast.ok("已保存数据快照");
    },
  });

  const [advice, setAdvice] = useState<string>("");
  const review = useMutation({
    mutationFn: async () => {
      let buf = "";
      await runAgentFeedback(projectId, "analytics.review", {
        quiet: true,
        label: "数据复盘",
        inputJson: {
          views: data?.views ?? views,
          favorites: data?.favorites ?? favorites,
        },
        onEvent: (ev) => {
          const token =
            (typeof ev.token === "string" && ev.token) ||
            (typeof ev.text === "string" && ev.text) ||
            "";
          if (token) buf += token;
        },
      });
      if (!buf) {
        const v = data?.views ?? views;
        const f = data?.favorites ?? favorites;
        const rateN = v > 0 ? (f / v) * 100 : 0;
        buf = [
          `## 复盘建议（本地启发式）`,
          `- 收藏率 ${rateN.toFixed(1)}%`,
          rateN < 3
            ? "- 收藏偏低：检查开篇钩子与核心梗卖点是否前置"
            : "- 收藏尚可：保持爽点密度，避免中段注水",
          "- 下一迭代：人工确认一处大纲闸 + 去 AI 味一集",
        ].join("\n");
      }
      setAdvice(buf);
      return buf;
    },
    onSuccess: () => toast.ok("复盘建议已生成"),
    onError: (e: Error) => toast.fail(e.message),
  });

  const rate =
    data && data.views > 0 ? ((data.favorites / data.views) * 100).toFixed(1) : "—";

  return (
    <div className="stack" style={{ gap: 12 }}>
      <Panel title="项目分析图表">
        <div className="dashboard-grid" style={{ marginTop: 0 }}>
          <Panel title="正文累计字数">
            <TrendArea
              data={(charts?.manuscriptTrend ?? []).map((p) => ({
                day: p.day,
                value: p.words,
              }))}
              color="#22c55e"
              height={170}
            />
            {charts && charts.targetWords != null && (
              <div className="faint" style={{ fontSize: 12 }}>
                当前 {charts.totalWords.toLocaleString()} 字 · 目标{" "}
                {charts.targetWords.toLocaleString()} 字（
                {Math.min(100, Math.round((charts.totalWords / charts.targetWords) * 100))}%）
              </div>
            )}
          </Panel>
          <Panel title="正文采纳率">
            <StatusDonut
              height={170}
              data={[
                {
                  status: "adopted",
                  label: "已采纳",
                  value: charts?.adoption.adopted ?? 0,
                },
                {
                  status: "candidate",
                  label: "候选",
                  value: charts?.adoption.candidates ?? 0,
                },
                {
                  status: "discarded",
                  label: "已淘汰",
                  value: charts?.adoption.discarded ?? 0,
                },
              ].filter((d) => d.value > 0)}
            />
            {charts && charts.adoption.total > 0 && (
              <div className="faint" style={{ fontSize: 12 }}>
                采纳率 {Math.round(charts.adoption.rate * 100)}%（
                {charts.adoption.adopted}/{charts.adoption.total}）
              </div>
            )}
          </Panel>
          <Panel title="各 Stage 停留时长（小时）">
            <FormatBar
              height={170}
              data={(charts?.stageDurations ?? []).map((s) => ({
                format: s.stage,
                label: s.stage,
                value: s.hours,
              }))}
            />
          </Panel>
        </div>
      </Panel>

      <Panel
        title="数据复盘"
        actions={
          <Button variant="primary" onClick={() => review.mutate()} disabled={review.isPending}>
            生成建议
          </Button>
        }
      >
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          手动录入公开后台摘要（不接爬数）。当前收藏率：{rate}%
          {data ? ` · 阅读 ${data.views} / 收藏 ${data.favorites}` : ""}
        </p>
        <div className="field-grid">
          <div className="field">
            <label>阅读/点击</label>
            <input
              className="input"
              type="number"
              value={views || data?.views || 0}
              onChange={(e) => setViews(Number(e.target.value) || 0)}
            />
          </div>
          <div className="field">
            <label>收藏</label>
            <input
              className="input"
              type="number"
              value={favorites || data?.favorites || 0}
              onChange={(e) => setFavorites(Number(e.target.value) || 0)}
            />
          </div>
        </div>
        {advice && (
          <pre
            style={{
              marginTop: 10,
              whiteSpace: "pre-wrap",
              fontSize: 12,
              fontFamily: "var(--font-ui)",
            }}
          >
            {advice}
          </pre>
        )}
        <Button style={{ marginTop: 8 }} onClick={() => save.mutate()} disabled={save.isPending}>
          保存快照
        </Button>
      </Panel>
    </div>
  );
}
