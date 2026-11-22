import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  EmptyBlock,
  PageHeader,
  Panel,
  ViewToggle,
} from "@xiezuomanju/ui";
import {
  ClipboardCheck,
  FlaskConical,
  GitCompare,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import type { ProjectFormat } from "@xiezuomanju/domain";
import { api, formatLabel } from "../../api/client";
import { FormatBar, TrendArea } from "../../components/charts";
import { EvalGuide } from "./EvalGuide";
import { EvalRubricsPanel } from "./EvalRubricsPanel";
import { EvalSuitesPanel } from "./EvalSuitesPanel";
import { EvalRunsPanel } from "./EvalRunsPanel";
import { EvalCasePoolPanel } from "./EvalCasePoolPanel";
import { EvalAnnotatePanel } from "./EvalAnnotatePanel";
import { EvalPairwisePanel } from "./EvalPairwisePanel";
import { EvalSettingsPanel } from "./EvalSettingsPanel";
import { pct } from "./evalUtils";

const TABS = [
  { id: "guide", label: "评测入门", icon: Sparkles },
  { id: "overview", label: "总览", icon: LayoutDashboard },
  { id: "rubrics", label: "评分细则", icon: ListChecks },
  { id: "suites", label: "评测集", icon: ClipboardCheck },
  { id: "runs", label: "评测运行", icon: FlaskConical },
  { id: "pool", label: "Case 池", icon: Inbox },
  { id: "annotate", label: "标注台", icon: ClipboardCheck },
  { id: "pairwise", label: "A/B 对比", icon: GitCompare },
  { id: "settings", label: "设置", icon: Settings2 },
] as const;

type TabId = (typeof TABS)[number]["id"];

function OverviewPanel() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["eval-overview"],
    queryFn: () => api.evalOverview(),
  });
  const seed = useMutation({
    mutationFn: () => api.evalSeed(),
    onSuccess: () => refetch(),
  });

  if (isLoading) return <div className="page">加载评测总览…</div>;
  if (!data) return <EmptyBlock title="暂无评测数据" description="点击播种种子评测集。" />;

  const dims = data.maturity?.dimensions || {};
  const trend = (data.trend || [])
    .filter((t) => typeof t.passRate === "number")
    .map((t) => ({
      day: String(t.createdAt || "").slice(0, 10) || "—",
      value: Math.round(Number(t.passRate) * 100),
    }));

  const formatBars = (data.scorecards || []).map((s) => ({
    format: String(s.format || "*"),
    label: s.format && s.format !== "*" ? formatLabel(s.format as ProjectFormat) : "通用",
    value: Math.round(Number(s.passRate || 0) * 100),
  }));

  return (
    <div className="stack-lg">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" onClick={() => seed.mutate()} disabled={seed.isPending}>
          {seed.isPending ? "播种中…" : "同步种子数据"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => refetch()}>
          刷新
        </Button>
        {data.recentRegressionGate && (
          <Badge tone={data.recentRegressionGate.gateVerdict === "pass" ? "ok" : "warn"}>
            最近回归门禁：{data.recentRegressionGate.gateVerdict || "—"}
          </Badge>
        )}
      </div>

      <div className="kpi-grid">
        <div className="card kpi-card">
          <div className="kpi-card__label">评分细则</div>
          <div className="kpi-card__value">{data.counts?.rubrics ?? 0}</div>
        </div>
        <div className="card kpi-card">
          <div className="kpi-card__label">评测集</div>
          <div className="kpi-card__value">{data.counts?.suites ?? 0}</div>
        </div>
        <div className="card kpi-card">
          <div className="kpi-card__label">人机一致率</div>
          <div className="kpi-card__value">
            {pct(data.agreement?.humanMachineAgreement as number | null)}
          </div>
        </div>
        <div className="card kpi-card">
          <div className="kpi-card__label">本月评测 Token</div>
          <div className="kpi-card__value">{String(data.cost?.tokensUsedThisMonth ?? 0)}</div>
          <div className="faint" style={{ fontSize: 12 }}>
            剩余 {String(data.cost?.budgetRemaining ?? "—")}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <Panel title="各格式得分卡（最近成功运行）">
          {formatBars.length ? (
            <FormatBar data={formatBars} />
          ) : (
            <EmptyBlock title="还没有成功的评测运行" description="去「评测运行」跑一套回归集。" />
          )}
          <div className="stack-sm" style={{ marginTop: 12 }}>
            {(data.scorecards || []).map((s) => (
              <div key={String(s.format)} className="row" style={{ justifyContent: "space-between" }}>
                <span>{s.format === "*" ? "通用" : formatLabel(String(s.format) as ProjectFormat)}</span>
                <span className="faint">
                  通过 {pct(s.passRate as number)} · pass^k {pct(s.passHatK as number)} · 否决{" "}
                  {String(s.vetoHits ?? 0)}
                </span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="通过率趋势">
          {trend.length ? (
            <TrendArea data={trend} />
          ) : (
            <EmptyBlock title="暂无趋势" description="多跑几次评测后会出现。" />
          )}
        </Panel>
      </div>

      <div className="grid-2">
        <Panel title="必评项失败率">
          {data.judgmentScopeCounts && (
            <div className="faint">
              必评 {data.judgmentScopeCounts.required} 条 · 可选建议 {data.judgmentScopeCounts.advisory} 条 ·
              缺少评测口径记录 {data.judgmentScopeCounts.unscoped} 条
            </div>
          )}
          {(data.topFailingRubrics || []).length === 0 && (
            <EmptyBlock title="暂无失败项" description="有明确必评记录后可查看各项统计。" />
          )}
          <ul className="stack-sm">
            {(data.topFailingRubrics || []).map((r) => (
              <li key={String(r.rubricKey)}>
                <strong>{String(r.name || r.rubricKey)}</strong>
                <div className="faint" style={{ fontSize: 12 }}>
                  失败率 {pct(r.failRate as number)} · {String(r.question || "")}
                </div>
                {r.sourceRef ? (
                  <div className="faint" style={{ fontSize: 11 }}>
                    出处：{String(r.sourceRef)}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="W 缺陷分布 / 成熟度自查">
          <div className="stack-sm">
            {Object.entries(data.wCodeDistribution || {}).length === 0 && (
              <span className="faint">暂无 W 编码命中</span>
            )}
            {Object.entries(data.wCodeDistribution || {}).map(([w, n]) => (
              <div key={w} className="row" style={{ justifyContent: "space-between" }}>
                <Badge>{w}</Badge>
                <span>{n}</span>
              </div>
            ))}
          </div>
          <hr />
          <div className="stack-sm">
            <div className="faint">最短板：{data.maturity?.shortestBoard}</div>
            <div className="faint" style={{ fontSize: 12 }}>
              {data.maturity?.hint}
            </div>
            {Object.entries(dims).map(([k, lv]) => (
              <div key={k} className="row" style={{ justifyContent: "space-between" }}>
                <span>{k}</span>
                <Badge tone={lv >= 2 ? "ok" : lv >= 1 ? "warn" : "fail"}>L{lv}</Badge>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function EvalPage() {
  const [tab, setTab] = useState<TabId>("guide");
  return (
    <div className="page page--wide">
      <PageHeader
        title="质量评测"
        description="用评分细则 + 黄金集/错题集持续衡量 Agent 写稿质量。离线守已知，线上发现未知，Case 池驱动双环迭代。"
      />
      <ViewToggle
        options={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))}
        value={tab}
        onChange={(id) => setTab(id as TabId)}
      />
      <div style={{ marginTop: 16 }}>
        {tab === "guide" && <EvalGuide onGo={(id) => setTab(id as TabId)} />}
        {tab === "overview" && <OverviewPanel />}
        {tab === "rubrics" && <EvalRubricsPanel />}
        {tab === "suites" && <EvalSuitesPanel />}
        {tab === "runs" && <EvalRunsPanel />}
        {tab === "pool" && <EvalCasePoolPanel />}
        {tab === "annotate" && <EvalAnnotatePanel />}
        {tab === "pairwise" && <EvalPairwisePanel />}
        {tab === "settings" && <EvalSettingsPanel />}
      </div>
    </div>
  );
}

