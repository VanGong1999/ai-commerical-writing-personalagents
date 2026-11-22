import { useQuery } from "@tanstack/react-query";
import { Badge, Button, HelpIcon, PageHeader, Panel, Tabs, ViewToggle, toast } from "@xiezuomanju/ui";
import { useMemo, useState } from "react";
import { BudgetRing, FormatBar, StatusDonut, TrendArea } from "../../components/charts";
import { api } from "../../api/client";
import { formatCnNumber, formatCnYuan } from "../../lib/format";
import { ownerBotsQuery } from "../bots/ownerBotsQuery";
import { usageActorId, usageActorNames, usageByAgent } from "./usageByAgent";

type Granularity = "day" | "week" | "month";

export function TokensPage() {
  const [view, setView] = useState("detail");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const { data: usage = [] } = useQuery({
    queryKey: ["usage"],
    queryFn: () => api.listUsage(),
    refetchInterval: 15_000,
  });
  const { data: summary } = useQuery({
    queryKey: ["usage-summary"],
    queryFn: () => api.getUsageSummary(),
    refetchInterval: 15_000,
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects({}),
  });
  const { data: bots = [] } = useQuery(ownerBotsQuery);
  const projectName = (id?: string | null) =>
    projects.find((p) => p.id === id)?.title || (id ? `项目 ${id.slice(0, 6)}` : "—");
  const botName = useMemo(() => usageActorNames(bots, summary?.byBot), [bots, summary?.byBot]);

  const totals = useMemo(() => {
    const prompt = usage.reduce((s, u) => s + u.promptTokens, 0);
    const completion = usage.reduce((s, u) => s + u.completionTokens, 0);
    const cost = usage.reduce((s, u) => s + (u.costEst ?? 0), 0);
    const costMissing = usage.some((u) => u.costEst == null);
    const cacheHit = usage.reduce((s, u) => s + (u.cacheHitTokens ?? 0), 0);
    const cacheMiss = usage.reduce((s, u) => s + (u.cacheMissTokens ?? 0), 0);
    return { prompt, completion, cost, costMissing, total: prompt + completion, cacheHit, cacheMiss };
  }, [usage]);

  const budget = summary?.budget;
  const remaining = summary?.remaining;
  const overBudget = summary?.over ?? false;

  const byModel = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of usage) m.set(u.model, (m.get(u.model) ?? 0) + u.promptTokens + u.completionTokens);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [usage]);

  const byAgent = useMemo(() => usageByAgent(usage, botName), [usage, botName]);

  const byProject = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of usage) {
      if (!u.projectId) continue;
      m.set(u.projectId, (m.get(u.projectId) ?? 0) + u.promptTokens + u.completionTokens);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [usage]);

  const byTime = useMemo(() => {
    const key = (d: Date) => {
      if (granularity === "day") return d.toISOString().slice(0, 10);
      if (granularity === "week") {
        const day = (d.getDay() + 6) % 7; // 周一为一周起点
        const start = new Date(d);
        start.setDate(d.getDate() - day);
        start.setHours(0, 0, 0, 0);
        return start.toISOString().slice(0, 10);
      }
      return d.toISOString().slice(0, 7); // 月 YYYY-MM
    };
    const m = new Map<string, number>();
    for (const u of usage) {
      const k = key(new Date(u.createdAt));
      m.set(k, (m.get(k) ?? 0) + u.promptTokens + u.completionTokens);
    }
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, value]) => ({ day, value }));
  }, [usage, granularity]);

  const cacheData = useMemo(
    () =>
      [
        { status: "hit", label: "缓存命中", value: totals.cacheHit },
        { status: "miss", label: "缓存未命中", value: totals.cacheMiss },
      ].filter((d) => d.value > 0),
    [totals.cacheHit, totals.cacheMiss],
  );

  const cacheRate = totals.cacheHit + totals.cacheMiss > 0
    ? Math.round((totals.cacheHit / (totals.cacheHit + totals.cacheMiss)) * 100)
    : 0;

  return (
    <div className="page page--wide">
      <PageHeader
        title="AI 用量"
        description="查看每个项目、每种 AI 服务、每个写作步骤用了多少，缓存命中情况，以及大概花了多少钱。"
        actions={
          <>
            <Button onClick={() => {
              void api.recalcTokenUsage().then((r) => toast.ok(`已重算 ${r.total} 个项目用量`)).catch((e) => toast.fail(e.message));
            }}>
              重算项目用量
            </Button>
            <Button onClick={() => exportCsv(usage)}>导出 CSV</Button>
          </>
        }
      />

      <div className="kpi-row" style={{ marginTop: 14 }}>
        <div className="kpi">
          <div className="kpi__value" title={totals.total.toLocaleString()}>{formatCnNumber(totals.total)}</div>
          <div className="kpi__label">
            历史合计用量
            <HelpIcon text="用量单位叫 Token，可以粗略理解成 AI 读写的字词数量。数字越大，通常费用越高。" />
          </div>
        </div>
        <div className="kpi">
          <div className="kpi__value" title={totals.prompt.toLocaleString()}>{formatCnNumber(totals.prompt)}</div>
          <div className="kpi__label">输入内容</div>
        </div>
        <div className="kpi">
          <div className="kpi__value" title={totals.completion.toLocaleString()}>{formatCnNumber(totals.completion)}</div>
          <div className="kpi__label">AI 输出</div>
        </div>
        <div className="kpi">
          <div className="kpi__value" title={totals.cacheHit.toLocaleString()}>{formatCnNumber(totals.cacheHit)}</div>
          <div className="kpi__label">
            缓存命中
            <HelpIcon text="命中了提示词缓存的输入量，通常计费更低。命中率越高，重复前缀越省钱。" />
          </div>
        </div>
        <div className="kpi">
          <div className="kpi__value" title={totals.cacheMiss.toLocaleString()}>{formatCnNumber(totals.cacheMiss)}</div>
          <div className="kpi__label">缓存未命中</div>
        </div>
        <div className="kpi">
          <div className="kpi__value" title={totals.cost.toFixed(4)}>{formatCnYuan(totals.cost)}</div>
          <div className="kpi__label">
            估算成本
            {totals.costMissing ? (
              <HelpIcon text="部分记录未配置单价，未计入估算。可在「设置 → AI 服务商」里配置单价。" />
            ) : null}
          </div>
        </div>
      </div>

      <Panel title="明细" style={{ marginTop: 12 }}>
        <Tabs
          tabs={[
            { id: "detail", label: "明细" },
            { id: "model", label: "按模型" },
            { id: "agent", label: "按 Agent（历史）" },
            { id: "bot", label: "按同事（本月）" },
            { id: "project", label: "按项目" },
            { id: "time", label: "按时间段" },
            { id: "cache", label: "按缓存" },
          ]}
          value={view}
          onChange={setView}
        />
        <div className="token-view-scroll scroll-region">
        {view === "detail" ? (
          <table className="table" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>时间</th>
                <th>写作步骤</th>
                <th>模型</th>
                <th>输入</th>
                <th>输出</th>
                <th>缓存命中</th>
                <th>缓存未命中</th>
                <th>成本</th>
                <th>项目</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.id}>
                  <td className="faint">{new Date(u.createdAt).toLocaleString()}</td>
                  <td title={u.agentId || u.botId || undefined}>{u.phase === "run.digest" && "运行摘要 · "}{botName(usageActorId(u))}</td>
                  <td>
                    <Badge title={u.model}>{modelLabel(u.model)}</Badge>
                  </td>
                  <td title={u.promptTokens.toLocaleString()}>{formatCnNumber(u.promptTokens)}</td>
                  <td title={u.completionTokens.toLocaleString()}>{formatCnNumber(u.completionTokens)}</td>
                  <td title={(u.cacheHitTokens ?? 0).toLocaleString()}>{formatCnNumber(u.cacheHitTokens ?? 0)}</td>
                  <td title={(u.cacheMissTokens ?? 0).toLocaleString()}>{formatCnNumber(u.cacheMissTokens ?? 0)}</td>
                  <td>{u.costEst == null ? <span className="faint">未配置单价</span> : formatCnYuan(u.costEst)}</td>
                  <td className="muted" title={u.projectId ?? undefined}>
                    {projectName(u.projectId)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : view === "model" ? (
          <div className="stack" style={{ gap: 12, marginTop: 10 }}>
            <FormatBar
              data={byModel.map(([model, total]) => ({
                format: model,
                label: modelLabel(model),
                value: total,
              }))}
              height={200}
            />
            <table className="table">
              <thead>
                <tr><th>模型</th><th>合计用量</th></tr>
              </thead>
              <tbody>
                {byModel.map(([model, total]) => (
                  <tr key={model}><td><Badge>{model}</Badge></td><td title={total.toLocaleString()}>{formatCnNumber(total)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : view === "agent" ? (
          <div className="stack" style={{ gap: 12, marginTop: 10 }}>
            {byAgent.length ? (
              <FormatBar data={byAgent.slice(0, 12)} height={200} />
            ) : (
              <div className="empty">暂无历史用量</div>
            )}
            {byAgent.length > 12 ? <div className="muted">图表显示用量最高的 12 项。</div> : null}
            <table className="table">
              <thead>
                <tr><th>执行者</th><th>合计用量</th></tr>
              </thead>
              <tbody>
                {byAgent.map(({ format: id, label, value }) => (
                  <tr key={id}>
                    <td title={id}>{label}</td>
                    <td title={value.toLocaleString()}>{formatCnNumber(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : view === "bot" ? (
          <div className="stack" style={{ gap: 12, marginTop: 10 }}>
            {(summary?.byBot || []).length ? (
              <>
                <FormatBar
                  data={(summary?.byBot || []).filter((r) => r.tokens > 0).slice(0, 12).map((r) => ({
                    format: r.botId,
                    label: r.name || botName(r.botId),
                    value: r.tokens,
                  }))}
                  height={200}
                />
                <div className="muted">本月全部同事；0 表示本月没有已记录的调用。系统服务和未归属记录单列，图表显示用量最高的 12 项。</div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>同事</th>
                      <th>合计用量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(summary?.byBot || []).map((r) => (
                      <tr key={r.botId}>
                        <td title={r.botId}>{r.name || botName(r.botId)}</td>
                        <td title={r.tokens.toLocaleString()}>{formatCnNumber(r.tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <div className="empty">暂无按同事汇总的用量（需后端 usage summary 返回 byBot）</div>
            )}
          </div>
        ) : view === "project" ? (
          <table className="table" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>项目</th><th>合计用量</th></tr>
            </thead>
            <tbody>
              {byProject.map(([pid, total]) => (
                <tr key={pid}><td>{projectName(pid)}</td><td title={total.toLocaleString()}>{formatCnNumber(total)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : view === "time" ? (
          <div className="stack" style={{ gap: 12, marginTop: 10 }}>
            <ViewToggle
              value={granularity}
              onChange={(v) => setGranularity(v as Granularity)}
              options={[
                { id: "day", label: "按天" },
                { id: "week", label: "按周" },
                { id: "month", label: "按月" },
              ]}
            />
            <TrendArea data={byTime} height={220} />
            <table className="table">
              <thead>
                <tr><th>时间段</th><th>合计用量</th></tr>
              </thead>
              <tbody>
                {[...byTime].reverse().map((p) => (
                  <tr key={p.day}><td>{p.day}</td><td title={p.value.toLocaleString()}>{formatCnNumber(p.value)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="stack" style={{ gap: 12, marginTop: 10 }}>
            <StatusDonut data={cacheData} height={200} />
            <div className="faint" style={{ fontSize: "var(--fs-xs)" }}>
              缓存命中率 {cacheRate}%（命中 {formatCnNumber(totals.cacheHit)} / 未命中 {formatCnNumber(totals.cacheMiss)}）
            </div>
            <table className="table">
              <thead>
                <tr><th>类型</th><th>Token 数</th></tr>
              </thead>
              <tbody>
                <tr><td>缓存命中</td><td title={totals.cacheHit.toLocaleString()}>{formatCnNumber(totals.cacheHit)}</td></tr>
                <tr><td>缓存未命中</td><td title={totals.cacheMiss.toLocaleString()}>{formatCnNumber(totals.cacheMiss)}</td></tr>
              </tbody>
            </table>
          </div>
        )}
        </div>
      </Panel>

      <Panel
        title={
          <span>
            {budget != null
              ? `本月用量上限 ${formatCnNumber(budget)}`
              : "本月用量上限（未设置）"}
            <HelpIcon text="在「设置 → 用量预算」里设置月度上限。用于展示与超限提醒；项目级预算仍会强控新任务入队。" />
          </span>
        }
        style={{ marginTop: 12 }}
      >
        {budget != null ? (
          <BudgetRing used={summary?.used ?? totals.total} budget={budget} />
        ) : (
          <div className="empty" style={{ padding: 18 }}>
            未设置月度上限。
            <a href="/settings" style={{ marginLeft: 6 }}>
              去设置
            </a>
          </div>
        )}
        <div className="faint" style={{ fontSize: "var(--fs-xs)", marginTop: 6 }}>
          {overBudget ? (
            <span style={{ color: "var(--warn, #f59e0b)" }}>
              本月用量已超过上限
              {budget != null ? `（超出 ${formatCnNumber(Math.max(0, totals.total - budget))}）` : ""}
              ，建议调整预算或控制新任务。
            </span>
          ) : remaining != null ? (
            `本月剩余 ${formatCnNumber(remaining)} tokens`
          ) : (
            "设置月度上限后，这里显示本月已用 / 剩余与超限提醒。"
          )}
        </div>
      </Panel>
    </div>
  );
}

function modelLabel(id: string): string {
  if (id === "MiniMax-M3.1-Flash") return "MiniMax 快速版";
  if (id === "deepseek-flash") return "DeepSeek 快速版";
  if (id === "deepseek-v4-pro") return "DeepSeek 增强版";
  return id;
}

function exportCsv(rows: { createdAt: string; agentId?: string; model: string; promptTokens: number; completionTokens: number; cacheHitTokens?: number; cacheMissTokens?: number }[]) {
  const header = "createdAt,agentId,model,prompt,completion,cacheHit,cacheMiss\n";
  const body = rows
    .map((r) => [r.createdAt, r.agentId ?? "", r.model, r.promptTokens, r.completionTokens, r.cacheHitTokens ?? 0, r.cacheMissTokens ?? 0].join(","))
    .join("\n");
  const blob = new Blob([header + body], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "AI用量.csv";
  a.click();
  URL.revokeObjectURL(url);
}
