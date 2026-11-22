import {useQuery} from "@tanstack/react-query";
import { findChiefConversation } from "../agent-chat/chiefConversation";
import { ReferenceComposer } from "../references/ReferenceComposer";
import { mergeReferences, type ContextRef } from "../references/selection";
import { Badge, Button, Modal, toast } from "@xiezuomanju/ui";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  Activity,
  AlarmClock,
  BookOpen,
  FolderOpen,
  History,
  Inbox,
  ListChecks,
  MessageSquarePlus,
  Radio,
  Send,
  Server,
  ShieldAlert,
  Workflow,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type AgentsOverview,
  type BackendOverview,
  type Conversation,
  type InboxEventItem,
  type RunStepItem,
  type ThreadSubItem,
} from "../../api/client";
import { EmptyState } from "../../components/motion";
import { ChatThread } from "../agent-chat/ChatThread";
import { ProcessSteps } from "../agent-chat/ProcessSteps";
import {
  actorName,
  cronLabel,
  describeInboxPayload,
  describeWatchdog,
  durationLabel,
  shortId,
  sinceLabel,
  sourceLabel,
  statusLabel,
  statusTone,
  timeLabel,
} from "../agent-chat/stepFormat";
import { useAgentDirectory } from "../agent-chat/useAgentDirectory";
import { useAgentSession } from "../agent-chat/useAgentSession";
import { JobsHistory } from "../jobs/JobsPage";
import { ProjectReplayPanel } from "../studio/ProjectReplayPanel";
import { AgentAtlasPanel } from "./AgentAtlasPanel";
import { DaemonTasksPanel } from "./DaemonTasksPanel";
import {FleetRosterPanel} from './FleetRosterPanel';

type RightTab = "process" | "inbox" | "backend" | "files" | "replay";
type WorkbenchView = "chat" | "atlas" | "tasks";

export function AgentWorkbenchPage() {
  const { q, c, view: viewSearch } = useSearch({ from: "/agent" });
  const nav = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [current, setCurrent] = useState<Conversation | null>(null);
  const [filter, setFilter] = useState("");
  const [input, setInput] = useState("");
  const [contextRefs, setContextRefs] = useState<ContextRef[]>([]);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>("process");
  const [focusRunId, setFocusRunId] = useState<string | undefined>();
  const [actorFilter, setActorFilter] = useState("");
  const [view, setView] = useState<WorkbenchView>(
    viewSearch === "atlas" || viewSearch === "tasks" ? viewSearch : "chat",
  );
  const [atlasProject,setAtlasProject]=useState<string>();
  const projects=useQuery({queryKey:["projects"],queryFn:()=>api.listProjects(),enabled:view==="atlas"});
  const atlasProjectId=(atlasProject ?? current?.projectId) || undefined;
  const [overview, setOverview] = useState<AgentsOverview | null>(null);
  const [atlasAttempt, setAtlasAttempt] = useState(0);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const autoSent = useRef(false);

  const session = useAgentSession(current?.id);

  useEffect(() => {
    if (viewSearch === "atlas" || viewSearch === "tasks" || viewSearch === "chat") {
      setView(viewSearch);
    }
  }, [viewSearch]);

  const switchView = (v: WorkbenchView) => {
    setView(v);
    void nav({
      to: "/agent",
      search: (prev) => ({ ...prev, view: v === "chat" ? undefined : v }),
    });
  };

  const refreshConversations = async () => {
    try {
      setConversations(await api.listConversations());
    } catch {
      setConversations([]);
    }
  };

  useEffect(() => {
    void refreshConversations();
  }, []);

  useEffect(() => {
    if (view !== "atlas") return;
    let active=true;
    setOverview(null);
    setOverviewLoading(true);
    void api
      .getAgentsOverview(atlasProjectId)
      .then(data=>{if(active)setOverview(data);})
      .catch(() => {if(active)setOverview(null);})
      .finally(() => {if(active)setOverviewLoading(false);});
    return ()=>{active=false;};
  }, [view, atlasProjectId, atlasAttempt]);

  useEffect(() => {
    if (!c) return;
    void (async () => {
      try {
        const conv = await api.getConversation(c);
        setCurrent(conv);
      } catch {
        toast.fail("找不到该会话");
      }
    })();
  }, [c]);

  useEffect(() => {
    if (!pinnedRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.messages, session.runningJobs]);

  useEffect(() => {
    pinnedRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [current?.id]);

  const handleMessagesScroll = () => {
    const el = messagesRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const ensureConversation = async () => {
    if (current) return current;
    try {
      const list = await api.listConversations({ source: "assistant" });
      const conv = findChiefConversation(list) ?? (await api.createConversation({ title: "新对话" }));
      setCurrent(conv);
      return conv;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (!q || autoSent.current) return;
    autoSent.current = true;
    void (async () => {
      const conv = await ensureConversation();
      if (conv) {
        setCurrent(conv);
        try {
          await session.send(q, undefined, conv.id);
        } catch {
          toast.fail("对话请求失败");
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const newConversation = async () => {
    try {
      const conv = await api.createConversation({ title: "新对话" });
      setConversations((prev) => [conv, ...prev]);
      setCurrent(conv);
      void nav({ to: "/agent", search: { c: conv.id } });
      switchView("chat");
    } catch (e) {
      toast.fail(`新建失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const send = async (text?: string) => {
    const value = (text ?? input).trim();
    const conv = current ?? (await ensureConversation());
    if (!value || !conv) return;
    if (!current) setCurrent(conv);
    pinnedRef.current = true;
    setInput("");
    const sentRefs = contextRefs;
    setContextRefs([]);
    try {
      await session.send(value, sentRefs[0]?.projectId, conv.id, {contextRefs:sentRefs});
      void refreshConversations();
    } catch {
      setInput(prev => prev || value);
      setContextRefs(prev => mergeReferences(prev,sentRefs));
      toast.fail("对话请求失败，引用已保留");
    }
  };

  const respond = async (approve: boolean) => {
    try {
      await session.respond(approve);
      void refreshConversations();
      toast.info(approve ? "已批准" : "已拒绝");
    } catch (e) {
      toast.fail(`操作失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const dispatchAgent = (agentId: string, label: string) => {
    if (overview?.agents.find(a=>a.id===agentId)?.custom && atlasProjectId) {
      void api.createConversation({botId:agentId,projectId:atlasProjectId,kind:"dm",title:label}).then(conv=>{setCurrent(conv);switchView("chat");}).catch(e=>toast.fail(String(e)));
      return;
    }
    switchView("chat");
    setInput(`请用 ${label}（${agentId}）帮我：`);
  };

  const filtered = useMemo(() => {
    const qstr = filter.trim().toLowerCase();
    if (!qstr) return conversations;
    return conversations.filter(
      (c) => c.title.toLowerCase().includes(qstr) || c.source.toLowerCase().includes(qstr),
    );
  }, [conversations, filter]);

  const state = session.runtime?.state || (session.busy ? "thinking" : "idle");
  const pendingN = session.runtime?.pending ?? 0;

  return (
    <div className="agent-workbench" data-view={view}>
      <div className="agent-workbench__views">
        <button
          type="button"
          className={view === "chat" ? "active" : ""}
          onClick={() => switchView("chat")}
        >
          <MessageSquarePlus size={14} /> 对话指挥
        </button>
        <button
          type="button"
          className={view === "atlas" ? "active" : ""}
          onClick={() => switchView("atlas")}
        >
          <BookOpen size={14} /> 智能体图鉴
        </button>
        <button
          type="button"
          className={view === "tasks" ? "active" : ""}
          onClick={() => switchView("tasks")}
        >
          <Server size={14} /> 守护任务中心
        </button>
      </div>

      {view === "atlas" ? (
        <div className="agent-workbench__full">
          <label>图鉴项目 <select value={atlasProjectId || ""} onChange={e=>setAtlasProject(e.target.value)}><option value="">通用</option>{projects.data?.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
          <AgentAtlasPanel
            overview={overview}
            loading={overviewLoading}
            onRetry={() => setAtlasAttempt(value => value + 1)}
            onDispatch={dispatchAgent}
          />
        </div>
      ) : null}

      {view === "tasks" ? (
        <div className="agent-workbench__full">
          <DaemonTasksPanel conversationId={current?.id} />
        </div>
      ) : null}

      {view === "chat" ? (
        <>
          <aside className="agent-workbench__rail">
            <div className="agent-workbench__rail-head">
              <strong>对话</strong>
              <div className="row" style={{ gap: 2 }}>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="任务记录"
                  title="任务记录"
                  onClick={() => setJobsOpen(true)}
                >
                  <ListChecks size={15} />
                  任务
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="新建对话"
                  onClick={() => void newConversation()}
                >
                  <MessageSquarePlus size={15} />
                </Button>
              </div>
            </div>
            <input
              className="agent-workbench__search"
              placeholder="搜索会话…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ margin: "6px 8px", width: "calc(100% - 16px)" }}
            />
            <ul className="agent-workbench__list">
              {filtered.length === 0 ? (
                <li className="empty">暂无对话，点击右上角新建。</li>
              ) : (
                filtered.map((c) => {
                  const isActive = c.id === current?.id;
                  const badge =
                    isActive && state === "thinking"
                      ? "运行"
                      : isActive && state === "waiting_confirm"
                        ? "确认"
                        : isActive && pendingN > 0
                          ? `排队${pendingN}`
                          : null;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={isActive ? "active" : ""}
                        onClick={() => {
                          setCurrent(c);
                          void nav({ to: "/agent", search: { c: c.id } });
                        }}
                      >
                        <span className="agent-workbench__conv-title">
                          {c.title}
                          {badge ? <Badge tone="default">{badge}</Badge> : null}
                        </span>
                        <small>
                          {c.source === "feishu" ? "飞书" : "网页"} ·{" "}
                          {new Date(c.updatedAt).toLocaleString("zh-CN")}
                        </small>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </aside>

          <section className="agent-workbench__main">
            {current ? (
              <>
                <div className="agent-workbench__head">
                  <h2>{current.title}</h2>
                  <div className="row" style={{ gap: 6 }}>
                    <Badge tone="default">{current.source === "feishu" ? "飞书" : "网页"}</Badge>
                    <StatusPill state={state} pending={pendingN} />
                    <Button variant="ghost" size="sm" onClick={() => switchView("atlas")}>
                      <BookOpen size={14} />
                      图鉴
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setJobsOpen(true)}>
                      <ListChecks size={14} />
                      任务记录
                    </Button>
                  </div>
                </div>
                <div
                  className="agent-workbench__messages"
                  ref={messagesRef}
                  onScroll={handleMessagesScroll}
                >
                  <ChatThread
                    messages={session.messages}
                    steps={session.steps}
                    plan={session.plan}
                    runningJobs={session.runningJobs}
                    pendingConfirm={session.pendingConfirm}
                    busy={session.busy}
                    onRespond={(a) => void respond(a)}
                    onSteer={(runId, msg) =>
                      void session.steer(runId, msg).then(() => toast.info("已追加指令"))
                    }
                    onStop={(jobId) =>
                      void session.stopJob(jobId).then(() => toast.info("已请求停止"))
                    }
                    onFocusRun={(runId) => {
                      setFocusRunId(runId);
                      setRightTab("process");
                    }}
                    emptyHint={
                      <p>
                        用自然语言指挥总编：检索知识、生成核心梗、规划多阶段写作、运行 Agent、采纳产物。
                        也可同时写多本书/多章节（start_async_task）。运行中也可继续发消息（全双工）。
                      </p>
                    }
                  />
                  <div ref={bottomRef} />
                </div>
                <ReferenceComposer refs={contextRefs} onChange={setContextRefs} />
                <div className="agent-workbench__input">
                  <textarea
                    rows={2}
                    value={input}
                    placeholder={
                      state === "thinking"
                        ? "任务进行中，可继续追加指令…"
                        : "例如：同时开写三本短篇的前三章"
                    }
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <Button variant="primary" disabled={!input.trim()} onClick={() => void send()}>
                    <Send size={15} />
                  </Button>
                </div>
              </>
            ) : (
              <EmptyState
                icon={<MessageSquarePlus size={26} />}
                title="选择或新建一个对话开始"
                description="自然语言指挥：检索 / 写作 / 多书多章守护编排 / 定时 / 爬虫。"
              />
            )}
          </section>

          <aside className="agent-workbench__timeline">
            <div className="agent-workbench__timeline-head">
              <DaemonTasksPanel
                compact
                conversationId={current?.id}
                onOpenFull={() => switchView("tasks")}
              />
              <div className="agent-workbench__tabs">
                <TabBtn
                  active={rightTab === "process"}
                  onClick={() => setRightTab("process")}
                  icon={<Workflow size={13} />}
                  label="过程"
                />
                <TabBtn
                  active={rightTab === "inbox"}
                  onClick={() => setRightTab("inbox")}
                  icon={<Inbox size={13} />}
                  label="收件箱"
                />
                <TabBtn
                  active={rightTab === "backend"}
                  onClick={() => setRightTab("backend")}
                  icon={<Server size={13} />}
                  label="后台"
                />
                <TabBtn
                  active={rightTab === "files"}
                  onClick={() => setRightTab("files")}
                  icon={<FolderOpen size={13} />}
                  label="文件"
                />
                <TabBtn
                  active={rightTab === "replay"}
                  onClick={() => setRightTab("replay")}
                  icon={<History size={13} />}
                  label="回放"
                />
              </div>
            </div>
            <div className="agent-workbench__timeline-body">
              <FleetRosterPanel projectId={current?.projectId} />
              {rightTab === "process" ? (
                <ProcessPanel
                  steps={session.steps}
                  focusRunId={focusRunId}
                  actorFilter={actorFilter}
                  onActorFilter={setActorFilter}
                  onClearFocus={() => setFocusRunId(undefined)}
                />
              ) : null}
              {rightTab === "inbox" ? <InboxPanel events={session.inbox} /> : null}
              {rightTab === "backend" ? (
                <BackendPanel
                  runtime={session.runtime}
                  subscriptions={session.subscriptions}
                  onMode={(id, mode) =>
                    void session
                      .setSubMode(id, mode)
                      .then(() =>
                        toast.info(mode === "wake" ? "已改为完成后唤醒总编" : "已改为仅观察"),
                      )
                  }
                  onOpenConversation={(id) => {
                    void nav({ to: "/agent", search: { c: id } });
                  }}
                />
              ) : null}
              {rightTab === "files" ? <FilesPanel /> : null}
              {rightTab === "replay" ? (
                <ProjectReplayPanel
                  projectId={current?.projectId || undefined}
                  selectedRunId={focusRunId}
                />
              ) : null}
            </div>
          </aside>
        </>
      ) : null}

      <Modal
        open={jobsOpen}
        onOpenChange={setJobsOpen}
        className="jobs-modal"
        bodyClassName="jobs-modal__body"
        title="Agent 与后台任务记录"
        description="这里包含 Agent 写作，以及文档分析、热点采集、用量统计等后台任务。可按状态重试或取消。"
        footer={<Button onClick={() => setJobsOpen(false)}>关闭</Button>}
      >
        <JobsHistory />
      </Modal>
    </div>
  );
}

function StatusPill({ state, pending }: { state: string; pending: number }) {
  if (state === "waiting_confirm") return <Badge tone="warn">待确认</Badge>;
  if (state === "thinking") return <Badge tone="ok">总编思考中</Badge>;
  if (pending > 0) return <Badge tone="default">排队 {pending}</Badge>;
  return <Badge tone="default">空闲</Badge>;
}

function TabBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      className={`agent-workbench__tab ${active ? "active" : ""}`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function ProcessPanel({
  steps,
  focusRunId,
  actorFilter,
  onActorFilter,
  onClearFocus,
}: {
  steps: RunStepItem[];
  focusRunId?: string;
  actorFilter: string;
  onActorFilter: (v: string) => void;
  onClearFocus: () => void;
}) {
  const { resolve } = useAgentDirectory();
  const filtered = steps.filter((s) => {
    if (focusRunId && s.runId !== focusRunId) return false;
    if (actorFilter && s.actor !== actorFilter) return false;
    return true;
  });
  const actors = Array.from(new Set(steps.map((s) => s.actor))).slice(0, 12);
  return (
    <div className="agent-workbench__panel">
      <div className="agent-workbench__filters">
        <select value={actorFilter} onChange={(e) => onActorFilter(e.target.value)}>
          <option value="">全部执行者</option>
          {actors.map((a) => (
            <option key={a} value={a}>
              {actorName(a, resolve)}
            </option>
          ))}
        </select>
        {focusRunId ? (
          <Button size="sm" variant="ghost" onClick={onClearFocus}>
            只看任务 {shortId(focusRunId)} · 清除
          </Button>
        ) : null}
      </div>
      <ProcessSteps steps={filtered} newestFirst showRun />
    </div>
  );
}

function InboxPanel({ events }: { events: InboxEventItem[] }) {
  if (!events.length) return <div className="empty">收件箱为空。</div>;
  return (
    <ol className="wb-cards">
      {events.map((e) => {
        const stale = e.status === "processing" && (e.waitMs || 0) > 5 * 60_000;
        return (
          <li key={e.id} className="wb-card">
            <div className="wb-card__head">
              <strong>{sourceLabel(e.source)}</strong>
              <Badge tone={stale ? "fail" : statusTone(e.status)}>
                {stale ? "处理超时" : statusLabel(e.status)}
              </Badge>
            </div>
            <p className="wb-card__text">{describeInboxPayload(e.source, e.payload) || "（无内容）"}</p>
            <small className="wb-card__meta">
              {timeLabel(e.createdAt)}
              {e.waitMs != null
                ? ` · ${e.status === "done" || e.status === "failed" ? "耗时" : "已等待"} ${durationLabel(e.waitMs)}`
                : ""}
            </small>
          </li>
        );
      })}
    </ol>
  );
}

type BackendScope = "conversation" | "global";

function BackendPanel({
  runtime,
  subscriptions,
  onMode,
  onOpenConversation,
}: {
  runtime: ReturnType<typeof useAgentSession>["runtime"];
  subscriptions: ThreadSubItem[];
  onMode: (id: string, mode: string) => void;
  onOpenConversation: (id: string) => void;
}) {
  const { resolve } = useAgentDirectory();
  const [overview, setOverview] = useState<BackendOverview | null>(null);
  const [scope, setScope] = useState<BackendScope | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void api
        .getBackendOverview()
        .then((o) => alive && setOverview(o))
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const local = {
    activeRuns: runtime?.activeRuns || [],
    subscriptions,
    timers: runtime?.timers || [],
    alerts: runtime?.alerts || [],
  };
  const localCount =
    local.activeRuns.length + local.subscriptions.length + local.timers.length + local.alerts.length;
  const globalCount = overview
    ? overview.activeRuns.length +
      overview.subscriptions.length +
      overview.timers.length +
      overview.alerts.length
    : 0;
  const effective: BackendScope = scope ?? (localCount > 0 ? "conversation" : "global");
  const data = effective === "conversation" ? local : overview || local;
  const isGlobal = effective === "global";

  const convLink = (id?: string | null, title?: string | null) =>
    isGlobal && id ? (
      <button type="button" className="wb-link" onClick={() => onOpenConversation(id)}>
        {title || `会话 ${shortId(id)}`}
      </button>
    ) : null;

  return (
    <div className="agent-workbench__panel">
      <div className="wb-seg">
        <button
          type="button"
          className={effective === "conversation" ? "active" : ""}
          onClick={() => setScope("conversation")}
        >
          本会话 {localCount}
        </button>
        <button
          type="button"
          className={effective === "global" ? "active" : ""}
          onClick={() => setScope("global")}
        >
          全部后台 {globalCount}
        </button>
      </div>
      {effective === "conversation" && localCount === 0 ? (
        <div className="wb-hint">
          本会话目前没有后台活动。总编派出的子任务、订阅、闹钟和告警都会出现在这里；切到「全部后台」可看其他会话和系统任务。
        </div>
      ) : null}

      <section>
        <strong>
          <Activity size={12} /> 正在运行的任务 · {data.activeRuns.length}
        </strong>
        {data.activeRuns.length === 0 ? (
          <div className="empty">没有正在运行的子任务</div>
        ) : (
          <ul className="wb-cards">
            {data.activeRuns.map((r) => {
              const who = resolve(r.agentId);
              return (
                <li key={r.runId} className={`wb-card ${r.stuck ? "wb-card--warn" : ""}`}>
                  <div className="wb-card__head">
                    <strong>{r.label || who.persona}</strong>
                    <Badge tone={r.stuck ? "fail" : statusTone(r.status)}>
                      {r.stuck ? "疑似卡住" : statusLabel(r.status)}
                    </Badge>
                  </div>
                  <p className="wb-card__text">
                    {who.persona}
                    {who.name && who.name !== who.persona ? ` · ${who.name}` : ""}
                    {r.projectTitle ? ` · 项目「${r.projectTitle}」` : ""}
                  </p>
                  {r.progressPct ? (
                    <div className="daemon-progress">
                      <div className="daemon-progress__bar" style={{ width: `${r.progressPct}%` }} />
                    </div>
                  ) : null}
                  <small className="wb-card__meta">
                    {r.progressStage ? `${r.progressStage} · ` : ""}
                    已运行 {sinceLabel(r.startedAt)}
                    {isGlobal && !r.conversationId ? " · 未关联会话" : ""}
                  </small>
                  {convLink(r.conversationId, r.conversationTitle)}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <strong>
          <Radio size={12} /> 订阅跟踪 · {data.subscriptions.length}
        </strong>
        {data.subscriptions.length === 0 ? (
          <div className="empty">没有订阅。总编派活后会自动订阅对应项目，子任务结束时唤醒总编。</div>
        ) : (
          <ul className="wb-cards">
            {data.subscriptions.map((s) => (
              <li key={s.id} className="wb-card">
                <div className="wb-card__head">
                  <strong>{s.projectTitle ? `项目「${s.projectTitle}」` : threadLabel(s.threadKey)}</strong>
                  <Badge tone={s.mode === "wake" ? "ok" : "default"}>
                    {s.mode === "wake" ? "完成后唤醒总编" : "仅观察"}
                  </Badge>
                </div>
                <p className="wb-card__text">
                  {s.agentId ? resolve(s.agentId).persona : "子 Agent"}
                  {s.runStatus ? ` · 任务${statusLabel(s.runStatus)}` : ""}
                </p>
                <div className="wb-card__actions">
                  {convLink(s.conversationId, s.conversationTitle)}
                  {!isGlobal ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onMode(s.id, s.mode === "wake" ? "observe" : "wake")}
                    >
                      改为{s.mode === "wake" ? "仅观察" : "完成后唤醒"}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <strong>
          <AlarmClock size={12} /> {isGlobal ? "定时任务与闹钟" : "跟进闹钟"} · {data.timers.length}
        </strong>
        {data.timers.length === 0 ? (
          <div className="empty">
            {isGlobal ? "没有启用的定时任务" : "本会话没有闹钟。可以让总编「两小时后提醒我检查进度」。"}
          </div>
        ) : (
          <ul className="wb-cards">
            {data.timers.map((t) => (
              <li key={t.id} className="wb-card">
                <div className="wb-card__head">
                  <strong>{t.name}</strong>
                  <Badge tone="default">{scopeLabel(t.ownerScope)}</Badge>
                </div>
                {t.note && t.note !== t.name ? <p className="wb-card__text">{t.note}</p> : null}
                <small className="wb-card__meta">
                  {cronLabel(t.cron)}
                  {t.nextRunAt ? ` · 下次 ${timeLabel(t.nextRunAt)}` : ""}
                  {t.lastRunAt ? ` · 上次 ${timeLabel(t.lastRunAt)}` : ""}
                </small>
                {convLink(t.conversationId, t.conversationTitle)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <strong>
          <ShieldAlert size={12} /> 看门狗告警 · {data.alerts.length}
        </strong>
        {data.alerts.length === 0 ? (
          <div className="empty">一切正常。看门狗每隔几秒巡检一次，发现卡住的任务或超时消息会记在这里。</div>
        ) : (
          <ul className="wb-cards">
            {data.alerts.map((a) => {
              const d = describeWatchdog(a.payload, resolve);
              return (
                <li key={a.id} className="wb-card wb-card--warn">
                  <div className="wb-card__head">
                    <strong>{d.title}</strong>
                    <small className="wb-card__meta">{timeLabel(a.createdAt)}</small>
                  </div>
                  <p className="wb-card__text">{d.detail}</p>
                  {convLink(a.conversationId, a.conversationTitle)}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {isGlobal && overview && overview.inflightEvents.length ? (
        <section>
          <strong>
            <Inbox size={12} /> 待处理消息 · {overview.inflightEvents.length}
          </strong>
          <ul className="wb-cards">
            {overview.inflightEvents.map((e) => (
              <li key={e.id} className="wb-card">
                <div className="wb-card__head">
                  <strong>{sourceLabel(e.source)}</strong>
                  <Badge tone={statusTone(e.status)}>{statusLabel(e.status)}</Badge>
                </div>
                <small className="wb-card__meta">
                  已等待 {e.waitMs != null ? durationLabel(e.waitMs) : "—"}
                </small>
                {convLink(e.conversationId, e.conversationTitle)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function threadLabel(key: string): string {
  const [kind, id] = key.split(":");
  const name = { project: "项目", artifact: "产物", feishu: "飞书话题" }[kind] || kind;
  return `${name} ${shortId(id)}`;
}

function scopeLabel(scope?: string): string {
  return { assistant: "总编创建", system: "系统", user: "用户" }[scope || ""] || scope || "";
}

function FilesPanel() {
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<Array<Record<string, unknown>>>([]);
  const [err, setErr] = useState("");
  const [opened, setOpened] = useState<{ path: string; name: string } | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.fsLs(path);
        const list =
          (res as { entries?: Array<Record<string, unknown>> }).entries ||
          (Array.isArray(res) ? res : []);
        setEntries(list as Array<Record<string, unknown>>);
        setErr("");
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setEntries([]);
      }
    })();
  }, [path]);

  const openFile = async (p: string, name: string) => {
    setOpened({ path: p, name });
    setContent("");
    setErr("");
    setLoading(true);
    try {
      const res = await api.fsRead(p);
      setContent(res.raw ?? "");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const closeFile = () => {
    setOpened(null);
    setContent("");
    setErr("");
  };

  if (opened) {
    return (
      <div className="agent-workbench__panel">
        <div className="agent-workbench__filters">
          <Button size="sm" variant="ghost" onClick={closeFile}>
            ← 返回
          </Button>
          <code title={opened.path}>{opened.name}</code>
        </div>
        {err ? (
          <div className="empty">{err}</div>
        ) : loading ? (
          <div className="empty">读取中…</div>
        ) : (
          <pre
            style={{
              margin: 0,
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 12,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              color: "var(--ink-soft)",
            }}
          >
            {content || "（空文件）"}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div className="agent-workbench__panel">
      <div className="agent-workbench__filters">
        <code>{path}</code>
        {path !== "/" ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const parts = path.split("/").filter(Boolean);
              parts.pop();
              setPath(parts.length ? `/${parts.join("/")}` : "/");
            }}
          >
            上级
          </Button>
        ) : null}
      </div>
      {err ? <div className="empty">{err}</div> : null}
      <ul className="agent-workbench__simple-list">
        {entries.map((e) => {
          const p = String(e.path || "");
          const name = String(e.name || p);
          const isDir = e.type === "dir";
          return (
            <li key={p}>
              <button
                type="button"
                className="agent-workbench__file-link"
                onClick={() => {
                  if (isDir) setPath(p);
                  else void openFile(p, name);
                }}
              >
                {isDir ? "📁" : "📄"} {name}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
