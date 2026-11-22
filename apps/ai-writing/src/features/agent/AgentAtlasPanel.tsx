import { Badge, Button } from "@xiezuomanju/ui";
import { Bot, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import type { AgentsOverview } from "../../api/client";
import { teamColor } from "../agent-chat/useAgentDirectory";
import { AgentDetailModal } from "./AgentDetailModal";

const FORMAT_LABEL: Record<string, string> = {
  manju: "漫剧",
  duanju: "短剧",
  male_long: "男频",
  female_long: "女频",
  short_novel: "短篇",
  ip_adapt: "IP 改编",
};

type Props = {
  overview: AgentsOverview | null;
  loading?: boolean;
  onRetry: () => void;
  onDispatch: (agentId: string, label: string) => void;
};

export function AgentAtlasPanel({ overview, loading, onRetry, onDispatch }: Props) {
  const [team, setTeam] = useState<string>("全部");
  const [format, setFormat] = useState<string>("全部");
  const [q, setQ] = useState("");
  const [wfFormat, setWfFormat] = useState("manju");
  const [detail, setDetail] = useState<
    | { kind: "personal" }
    | { kind: "agent"; agentId: string }
    | { kind: "tool"; toolId: string }
    | null
  >(null);

  const stats = overview?.stats;
  const teams = useMemo(() => {
    const entries = Object.entries(stats?.byTeam || {});
    return entries;
  }, [stats]);

  const filtered = useMemo(() => {
    let list = overview?.agents || [];
    if (team !== "全部") list = list.filter((a) => (a.team || "其他") === team);
    if (format !== "全部") {
      list = list.filter(
        (a) => (a.formats || []).includes(format) || (a.formats || []).includes("*"),
      );
    }
    const qq = q.trim().toLowerCase();
    if (qq) {
      list = list.filter((a) =>
        `${a.id} ${a.name} ${a.persona || ""} ${a.summary} ${a.when}`.toLowerCase().includes(qq),
      );
    }
    return list;
  }, [overview, team, format, q]);

  const wf = overview?.workflows?.[wfFormat];

  if (loading && !overview) {
    return <div className="agent-atlas empty">加载智能体全景…</div>;
  }
  if (!overview) {
    return <div className="agent-atlas empty">无法加载智能体目录。 <button onClick={onRetry}>重试</button></div>;
  }

  const teamTotal = teams.reduce((s, [, n]) => s + n, 0) || 1;

  return (
    <div className="agent-atlas">
      <header className="agent-atlas__banner">
        <div>
          <h2>智能体全景图鉴</h2>
          <p>
            {stats?.personalAgents || 1} 位总管 · {stats?.domainAgents || 0} 位专职智能体 ·{" "}
            {stats?.skills || 0} 项专业技能 · {stats?.tools || 0} 专用工具 ·{" "}
            {stats?.workflows || 0} 套工业化工作流
          </p>
        </div>
        <div className="agent-atlas__bar">
          {teams.map(([t, n]) => (
            <button
              key={t}
              type="button"
              title={`${t} ${n}`}
              style={{
                width: `${Math.max(4, (n / teamTotal) * 100)}%`,
                background: teamColor(t),
              }}
              onClick={() => setTeam(t)}
            />
          ))}
        </div>
      </header>

      <section className="agent-atlas__chief" onClick={() => setDetail({ kind: "personal" })}>
        <div className="agent-atlas__chief-mark" style={{ background: teamColor("编排") }}>
          <Bot size={28} />
        </div>
        <div className="agent-atlas__chief-body">
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <h3>{overview.personalAgent.name}</h3>
            <Badge tone="ok">Personal Agent</Badge>
            <Badge>全双工</Badge>
          </div>
          <p>{overview.personalAgent.summary}</p>
          <div className="agent-atlas__cap-grid">
            {overview.personalAgent.capabilities.slice(0, 6).map((c) => (
              <div key={c.id} className="agent-atlas__cap-card">
                <strong>{c.title}</strong>
                <p>{c.desc}</p>
              </div>
            ))}
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {overview.personalAgent.asyncPrimitives.map((p) => (
              <button
                key={p}
                type="button"
                className="agent-atlas__chip"
                onClick={(e) => {
                  e.stopPropagation();
                  setDetail({ kind: "tool", toolId: p });
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <Button
          variant="primary"
          onClick={(e) => {
            e.stopPropagation();
            setDetail({ kind: "personal" });
          }}
        >
          查看总编能力
        </Button>
      </section>

      <section className="agent-atlas__workflows">
        <div className="agent-atlas__section-head">
          <h3>
            <Sparkles size={16} /> 创作工作流
          </h3>
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            {Object.keys(overview.workflows || {}).map((f) => (
              <button
                key={f}
                type="button"
                className={`agent-atlas__pill ${wfFormat === f ? "active" : ""}`}
                onClick={() => setWfFormat(f)}
              >
                {FORMAT_LABEL[f] || f}
                <small>{overview.workflows[f]?.stageCount || 0}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="workflow-rail">
          {(wf?.stages || []).map((st) => (
            <div key={st.id} className="workflow-rail__node">
              <div className="workflow-rail__head">
                <strong>{st.name}</strong>
                <code>{st.id}</code>
              </div>
              <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                {st.requiresUserAck ? <Badge tone="warn">需确认</Badge> : null}
                {st.mode ? <Badge tone="default">{st.mode}</Badge> : null}
              </div>
              <div className="row" style={{ gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                {(st.agentIds || []).slice(0, 6).map((aid) => {
                  const a = overview.agents.find((x) => x.id === aid);
                  return (
                    <button
                      key={aid}
                      type="button"
                      className="agent-atlas__avatar-chip"
                      style={{ borderColor: teamColor(a?.team) }}
                      title={a?.persona || aid}
                      onClick={() => setDetail({ kind: "agent", agentId: aid })}
                    >
                      {(a?.persona || aid).slice(0, 1)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="agent-atlas__filters">
        <div className="agent-atlas__search">
          <Search size={14} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索智能体名称 / 能力 / 时机…"
          />
        </div>
        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
          <button
            type="button"
            className={`agent-atlas__pill ${team === "全部" ? "active" : ""}`}
            onClick={() => setTeam("全部")}
          >
            全部 {stats?.domainAgents || 0}
          </button>
          {teams.map(([t, n]) => (
            <button
              key={t}
              type="button"
              className={`agent-atlas__pill ${team === t ? "active" : ""}`}
              onClick={() => setTeam(t)}
              style={{ ["--pill-color" as string]: teamColor(t) }}
            >
              {t} {n}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
          <button
            type="button"
            className={`agent-atlas__pill ${format === "全部" ? "active" : ""}`}
            onClick={() => setFormat("全部")}
          >
            全体裁
          </button>
          {Object.keys(FORMAT_LABEL).map((f) => (
            <button
              key={f}
              type="button"
              className={`agent-atlas__pill ${format === f ? "active" : ""}`}
              onClick={() => setFormat(f)}
            >
              {FORMAT_LABEL[f]}
            </button>
          ))}
        </div>
      </section>

      <div className="agent-atlas__grid">
        {filtered.map((a) => (
          <article key={a.id} className="agent-atlas__card">
            <header>
              <div
                className="agent-atlas__avatar"
                style={{ background: teamColor(a.team) }}
              >
                {(a.persona || a.name).slice(0, 1)}
              </div>
              <div>
                <strong>{a.persona || a.name}</strong>
                <small>{a.name}</small>
              </div>
              {a.team ? <Badge tone="default">{a.team}</Badge> : null}
            </header>
            <p>{a.summary}</p>
            <div className="muted">时机：{a.when || "—"}</div>
            <div className="row" style={{ gap: 4, flexWrap: "wrap", marginTop: 6 }}>
              {(a.formats || []).slice(0, 3).map((f) => (
                <Badge key={f}>{FORMAT_LABEL[f] || f}</Badge>
              ))}
              <Badge tone="default">工具 {a.toolCount ?? a.tools?.length ?? 0}</Badge>
            </div>
            <footer>
              <Button size="sm" variant="ghost" onClick={() => setDetail({ kind: "agent", agentId: a.id })}>
                查看完整能力
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => onDispatch(a.id, a.persona || a.name)}
              >
                立即派单
              </Button>
            </footer>
          </article>
        ))}
      </div>

      <AgentDetailModal
        open={Boolean(detail)}
        onOpenChange={(v) => {
          if (!v) setDetail(null);
        }}
        overview={overview}
        target={detail}
        onDispatch={onDispatch}
        onSwitchAgent={(id) => setDetail({ kind: "agent", agentId: id })}
      />
    </div>
  );
}
