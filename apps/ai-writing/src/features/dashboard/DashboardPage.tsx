import { useQuery } from "@tanstack/react-query";
import { BarChart3, CheckCircle2, FileText, Flame, Coins } from "lucide-react";
import { Badge, EmptyBlock, PageHeader, Panel, ViewToggle } from "@xiezuomanju/ui";
import { FormatBar, StatusDonut, TrendArea } from "../../components/charts";
import { api, formatLabel } from "../../api/client";
import { useState } from "react";
import { formatCnNumber } from "../../lib/format";

const STATUS_LABEL: Record<string, string> = {
  active: "进行中",
  paused: "已暂停",
  archived: "已归档",
  submitted: "已投稿",
};

function formatTokens(n: number) {
  return formatCnNumber(n);
}

function formatWords(n: number) {
  return formatCnNumber(n);
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Flame;
  label: string;
  value: string;
  sub?: string;
  tone?: "ok" | "warn" | "idle";
}) {
  return (
    <div className="card kpi-card" data-tone={tone ?? "idle"}>
      <div className="kpi-card__icon">
        <Icon size={18} />
      </div>
      <div>
        <div className="kpi-card__label">{label}</div>
        <div className="kpi-card__value">{value}</div>
        {sub && <div className="faint" style={{ fontSize: 12 }}>{sub}</div>}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const [days, setDays] = useState(14);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", days],
    queryFn: () => api.dashboardSummary(days),
  });

  if (isLoading) return <div className="page">加载数据看板…</div>;
  if (!data) return <div className="page">暂无看板数据</div>;

  const t = data.totals;

  return (
    <div className="page page--wide">
      <PageHeader
        title="数据看板"
        description="选题 / 交稿的全局概览：格式、状态、字数、采纳率与 AI 用量。"
      />

      <div className="kpi-grid">
        <KpiCard icon={FileText} label="项目总数" value={String(t.projects)} sub={`进行中 ${t.active}`} />
        <KpiCard
          icon={CheckCircle2}
          label="交稿主线完成"
          value={`${t.packageDone}/${t.projects}`}
          sub="真实产物齐全才计完成"
          tone="ok"
        />
        <KpiCard icon={Flame} label="累计正文" value={formatWords(t.wordCount)} sub={`${t.manuscripts} 篇`} />
        <KpiCard
          icon={BarChart3}
          label="正文采纳率"
          value={`${Math.round(t.adoptionRate * 100)}%`}
          sub={`采纳 ${t.adopted} / ${t.manuscripts}`}
          tone={t.adoptionRate >= 0.5 ? "ok" : "warn"}
        />
        <KpiCard icon={Coins} label="AI 用量" value={formatTokens(t.tokenUsed)} sub="tokens" />
      </div>

      <div className="dashboard-grid">
        <Panel title="按格式汇总">
          {data.byFormat.length === 0 ? (
            <EmptyBlock
              icon={FileText}
              title="还没有项目"
              description="新建项目并推进后，这里会按格式汇总交稿进度。"
            />
          ) : (
            <div className="stack" style={{ gap: 16 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>格式</th>
                    <th>项目</th>
                    <th>流程完成</th>
                    <th>交稿完成</th>
                    <th>正文</th>
                    <th>字数</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byFormat.map((r) => (
                    <tr key={r.format}>
                      <td style={{ fontWeight: 600 }}>{formatLabel(r.format as never) ?? r.label}</td>
                      <td>{r.projects}</td>
                      <td>{r.flowDone}</td>
                      <td>
                        <Badge tone={r.packageDone > 0 ? "ok" : "default"}>{r.packageDone}</Badge>
                      </td>
                      <td>{r.adopted}/{r.manuscripts}</td>
                      <td className="muted">{formatWords(r.wordCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <FormatBar
                data={data.byFormat.map((r) => ({
                  format: r.format,
                  label: formatLabel(r.format as never) ?? r.label,
                  value: r.wordCount,
                }))}
                height={160}
              />
            </div>
          )}
        </Panel>

        <Panel title="按状态分布">
          {data.byStatus.length === 0 ? (
            <div className="empty">暂无状态数据</div>
          ) : (
            <StatusDonut
              data={data.byStatus.map((s) => ({
                status: s.status,
                label: STATUS_LABEL[s.status] ?? s.status,
                value: s.count,
              }))}
            />
          )}
        </Panel>

        <Panel
          title={
            <div className="stack" style={{ gap: 8 }}>
              近 {days} 天 AI 用量
              <ViewToggle
                value={String(days)}
                onChange={(v) => setDays(Number(v) || 14)}
                options={[
                  { id: "14", label: "14 天" },
                  { id: "30", label: "30 天" },
                  { id: "90", label: "90 天" },
                ]}
              />
            </div>
          }
        >
          {data.usageTrend.length ? (
            <TrendArea
              data={data.usageTrend.map((d) => ({ day: d.day, value: d.tokens }))}
            />
          ) : (
            <div className="empty">暂无用量</div>
          )}
        </Panel>
      </div>
    </div>
  );
}
