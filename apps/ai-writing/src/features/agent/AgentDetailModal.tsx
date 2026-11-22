import { Badge, Button, MarkdownDocument, Modal, Tabs } from "@xiezuomanju/ui";
import { Bot } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  type AgentCatalogItem,
  type AgentsOverview,
  type SkillItem,
  type ToolCatalogItem,
} from "../../api/client";
import { teamColor } from "../agent-chat/useAgentDirectory";

type DetailTarget =
  | { kind: "personal" }
  | { kind: "agent"; agentId: string }
  | { kind: "tool"; toolId: string };

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  overview: AgentsOverview | null;
  target: DetailTarget | null;
  onDispatch?: (agentId: string, label: string) => void;
  onSwitchAgent?: (agentId: string) => void;
};

export function AgentDetailModal({
  open,
  onOpenChange,
  overview,
  target,
  onDispatch,
  onSwitchAgent,
}: Props) {
  const [tab, setTab] = useState("overview");
  const [skillResult, setSkill] = useState<{path: string; item?: SkillItem; failed?: boolean} | null>(null);
  const [skillAttempt, setSkillAttempt] = useState(0);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  const personal = overview?.personalAgent;
  const agent: AgentCatalogItem | null = useMemo(() => {
    if (!overview || !target || target.kind !== "agent") return null;
    return overview.agents.find((a) => a.id === target.agentId) || null;
  }, [overview, target]);

  const result = skillResult?.path === agent?.skillPath ? skillResult : null;
  const skill = result?.item;

  const toolFocus: ToolCatalogItem | null = useMemo(() => {
    if (!overview || !target || target.kind !== "tool") return null;
    return (
      overview.toolsCatalog.find((t) => t.id === target.toolId) ||
      personal?.tools.find((t) => t.id === target.toolId) ||
      null
    );
  }, [overview, target, personal]);

  useEffect(() => {
    setTab(target?.kind === "tool" ? "tools" : "overview");
    setExpandedTool(target?.kind === "tool" ? target.toolId : null);
  }, [target]);

  useEffect(() => {
    if (!open || !agent?.skillPath) {
      setSkill(null);
      return;
    }
    let active = true;
    setSkill(null);
    const path = agent.skillPath;
    const id = path.replace(/^skills\//, "").replace(/\/SKILL\.md$/, "");
    void api
      .getSkill(id)
      .then(value => { if (active) setSkill({path, item:value}); })
      .catch(() => { if (active) setSkill({path, failed:true}); });
    return () => { active = false; };
  }, [open, agent?.skillPath, skillAttempt]);

  const title =
    target?.kind === "personal"
      ? `${personal?.name || "总编"} · Personal Agent`
      : target?.kind === "tool"
        ? `工具 · ${toolFocus?.label || target.toolId}`
        : agent
          ? (agent.custom ? agent.name : `${agent.persona || agent.name} · ${agent.name}`)
          : "智能体详情";

  const tools: ToolCatalogItem[] =
    target?.kind === "personal"
      ? personal?.tools || []
      : agent?.toolDetails ||
        (agent?.tools || []).map((id) => ({
          id,
          label: id,
          category: "工具",
          description: id,
        }));

  const workflowHits = useMemo(() => {
    if (!overview || !agent) return [];
    const hits: Array<{ format: string; stageId: string; stageName: string; peers: string[] }> = [];
    for (const [fmt, wf] of Object.entries(overview.workflows || {})) {
      for (const st of wf.stages || []) {
        if ((st.agentIds || []).includes(agent.id)) {
          hits.push({
            format: fmt,
            stageId: st.id,
            stageName: st.name,
            peers: (st.agentIds || []).filter((x) => x !== agent.id),
          });
        }
      }
    }
    return hits;
  }, [overview, agent]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      className="agent-detail-modal"
      bodyClassName="agent-detail-modal__body"
      title={title}
      description={
        target?.kind === "personal"
          ? personal?.summary
          : agent?.summary || toolFocus?.description || ""
      }
      footer={
        <div className="row" style={{ gap: 8, justifyContent: "flex-end", width: "100%" }}>
          {agent && onDispatch ? (
            <Button
              variant="primary"
              onClick={() => {
                onDispatch(agent.id, agent.persona || agent.name);
                onOpenChange(false);
              }}
            >
              在工作台派单
            </Button>
          ) : null}
          <Button onClick={() => onOpenChange(false)}>关闭</Button>
        </div>
      }
    >
      {target?.kind === "personal" && personal ? (
        <>
          <div className="agent-detail-modal__hero" data-team="编排">
            <div className="agent-detail-modal__avatar" style={{ background: teamColor("编排") }}>
              <Bot size={22} />
            </div>
            <div>
              <strong>{personal.name}</strong>
              <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                <Badge tone="ok">{personal.persona}</Badge>
                <Badge>{personal.role}</Badge>
                <Badge tone="default">异步原语 {personal.asyncPrimitives.length}</Badge>
              </div>
            </div>
          </div>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "overview", label: "能力画像" },
              { id: "tools", label: `工具 (${tools.length})` },
            ]}
          />
          {tab === "overview" ? (
            <div className="agent-detail-modal__section">
              <div className="agent-atlas__cap-grid">
                {personal.capabilities.map((c) => (
                  <div key={c.id} className="agent-atlas__cap-card">
                    <strong>{c.title}</strong>
                    <p>{c.desc}</p>
                  </div>
                ))}
              </div>
              <h4>VFS 路径</h4>
              <ul className="agent-detail-modal__list">
                {personal.vfsPaths.map((p) => (
                  <li key={p}>
                    <code>{p}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ToolList
              tools={tools}
              expanded={expandedTool}
              onExpand={setExpandedTool}
            />
          )}
        </>
      ) : null}

      {target?.kind === "agent" && agent ? (
        <>
          <div className="agent-detail-modal__hero" data-team={agent.team || "其他"}>
            <div
              className="agent-detail-modal__avatar"
              style={{ background: teamColor(agent.team) }}
            >
              {(agent.persona || agent.name).slice(0, 1)}
            </div>
            <div>
              <strong>{agent.name}</strong>
              <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {!agent.custom && <Badge tone="ok">{agent.persona || agent.name}</Badge>}
                {agent.team ? <Badge>{agent.team}</Badge> : null}
                {agent.modelProfile ? <Badge tone="default">{agent.modelProfile}</Badge> : null}
                {(agent.formats || []).slice(0, 4).map((f) => (
                  <Badge key={f} tone="default">
                    {f}
                  </Badge>
                ))}
              </div>
              <p className="agent-detail-modal__when">适用时机：{agent.when || "—"}</p>
            </div>
          </div>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "overview", label: "画像与契约" },
              { id: "tools", label: `工具 (${tools.length})` },
              { id: "skills", label: "技能书" },
              { id: "workflows", label: "工作流" },
            ]}
          />
          {tab === "overview" ? (
            <div className="agent-detail-modal__section">
              <p>{agent.summary}</p>
              {agent.documentCount !== undefined && <p>适用项目　{agent.projectTitle || "本人所选项目"} · {agent.stage || "所有阶段"} · 已授权 {agent.documentCount} 份知识文档</p>}
              <h4>验收契约 Done Contract</h4>
              {(agent.doneContract || []).length === 0 ? (
                <p className="muted">
                  目录未列出本岗位契约明细。请按本次任务的运行时契约交付产物并完成必需检查。
                </p>
              ) : (
                <ul className="agent-detail-modal__list">
                  {(agent.doneContract || []).map((c, i) => (
                    <li key={i}>
                      {agent.custom && c.type === "artifact_count" && c.artifact === "qc_report"
                        ? "提交一份带原文引用的知识核查报告（qc_report）"
                        : agent.custom && c.type === "gate_pass" ? "通过 Schema 检查，核对报告版本与引用来源"
                        : <code>{JSON.stringify(c)}</code>}
                    </li>
                  ))}
                </ul>
              )}
              {skill && <p className="muted">技能书列出可调用的检查，其中包括可跳过的写作建议。必需项以本次任务契约为准。</p>}
              {skill ? (
                <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {(skill.gates || []).map((g) => (
                    <Badge key={g} tone="warn">
                      gate:{g}
                    </Badge>
                  ))}
                  {(skill.locks || []).map((l) => (
                    <Badge key={l} tone="default">
                      lock:{l}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {tab === "tools" ? (
            <ToolList tools={tools} expanded={expandedTool} onExpand={setExpandedTool} />
          ) : null}
          {tab === "skills" ? (
            <div className="agent-detail-modal__section">
              {skill ? (
                <>
                  <p className="muted">以下检查包括可选建议。必需项以本次任务契约为准。</p>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {(skill.gates || []).map((g) => (
                      <Badge key={g} tone="warn">
                        {g}
                      </Badge>
                    ))}
                    {(skill.locks || []).map((l) => (
                      <Badge key={l}>{l}</Badge>
                    ))}
                  </div>
                  <MarkdownDocument source={skill.body || skill.description || ""} />
                </>
              ) : (
                <p className="muted">{!agent.skillPath ? "暂无技能正文" : result?.failed ? <>技能读取失败 <button onClick={() => setSkillAttempt(n => n + 1)}>重试</button></> : "正在读取技能…"}</p>
              )}
            </div>
          ) : null}
          {tab === "workflows" ? (
            <div className="agent-detail-modal__section">
              {workflowHits.length === 0 ? (
                <p className="muted">未绑定到具体 Stage 图节点（可能为通用/* Agent）。</p>
              ) : (
                <ul className="agent-detail-modal__wf-list">
                  {workflowHits.map((h) => (
                    <li key={`${h.format}-${h.stageId}`}>
                      <strong>
                        {h.format} · {h.stageId}
                      </strong>
                      <span>{h.stageName}</span>
                      {h.peers.length ? (
                        <div className="row" style={{ gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                          {h.peers.map((p) => (
                            <button
                              key={p}
                              type="button"
                              className="agent-atlas__chip"
                              onClick={() => onSwitchAgent?.(p)}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </>
      ) : null}

      {target?.kind === "tool" && toolFocus ? (
        <div className="agent-detail-modal__section">
          <Badge>{toolFocus.category}</Badge>
          <Badge tone="default">{toolFocus.security || "safe"}</Badge>
          <p>{toolFocus.description}</p>
          <h4>参数</h4>
          <pre className="agent-detail-modal__pre">
            {JSON.stringify(toolFocus.parameters || {}, null, 2)}
          </pre>
        </div>
      ) : null}
    </Modal>
  );
}

function ToolList({
  tools,
  expanded,
  onExpand,
}: {
  tools: ToolCatalogItem[];
  expanded: string | null;
  onExpand: (id: string | null) => void;
}) {
  const byCat = useMemo(() => {
    const m = new Map<string, ToolCatalogItem[]>();
    for (const t of tools) {
      const c = t.category || "其他";
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(t);
    }
    return m;
  }, [tools]);

  return (
    <div className="agent-detail-modal__section">
      {Array.from(byCat.entries()).map(([cat, list]) => (
        <div key={cat} className="agent-detail-modal__tool-cat">
          <h4>{cat}</h4>
          {list.map((t) => (
            <div key={t.id} className="agent-detail-modal__tool-row">
              <button
                type="button"
                className="agent-detail-modal__tool-btn"
                onClick={() => onExpand(expanded === t.id ? null : t.id)}
              >
                <strong>{t.label}</strong>
                <code>{t.id}</code>
                <span>{t.description}</span>
              </button>
              {expanded === t.id ? (
                <div className="agent-detail-modal__tool-expand">
                  <Badge tone="default">{t.security || "safe"}</Badge>
                  {t.parameters ? (
                    <pre className="agent-detail-modal__pre">
                      {JSON.stringify(t.parameters, null, 2)}
                    </pre>
                  ) : (
                    <p className="muted">无额外参数 Schema</p>
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
