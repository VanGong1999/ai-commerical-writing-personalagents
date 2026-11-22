import { ReferenceChips } from "../references/ReferenceComposer";
import { SelectionResult } from "../references/SelectionResult";
import { Badge, Button, CollapsibleSection, MarkdownDocument } from "@xiezuomanju/ui";
import { Bot, Check, Inbox, Loader2, Square, MessageSquarePlus, Wrench, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type FeishuReplyPart, type RunStepItem } from "../../api/client";
import { ProcessSteps } from "./ProcessSteps";
import {
  describeFields,
  shortId,
  sourceLabel,
  statusLabel,
  statusTone,
  summarizeResult,
  toolLabel,
} from "./stepFormat";
import { teamColor, useAgentDirectory } from "./useAgentDirectory";
import type { PlanStep, RunningJob, UiMsg } from "./useAgentSession";

function AgentAvatar({ persona, team, emoji, color }: {
  persona: string;
  team?: string;
  emoji?: string;
  color?: string;
}) {
  return (
    <span className="agent-avatar" style={{ background: color || teamColor(team) }} title={persona}>
      {emoji || (persona || "?").slice(0, 1)}
    </span>
  );
}

function FeishuDelivery({message}: {message: UiMsg}) {
  const action = message.actions?.find(a => a.type === "feishu_delivery");
  const snapshot = action?.parts as FeishuReplyPart[] | undefined;
  const delivery = useQuery({
    queryKey: ["feishu-delivery", message.conversationId, message.id],
    queryFn: () => api.getFeishuDelivery(message.conversationId, message.id),
    initialData: snapshot ? {parts: snapshot} : undefined,
    refetchInterval: query => {
      const parts = query.state.data?.parts;
      if (!parts) return 5000;
      const next = parts.find(p => p.status !== "delivered");
      return next && ["pending", "sending"].includes(next.status) ? 5000 : false;
    },
  });
  const parts = delivery.data?.parts || [];
  const [feedback, setFeedback] = useState("");
  const [sending, setSending] = useState(false);
  if (!parts.length) return null;
  const labels: Record<string, string> = {
    pending: "待发送", sending: "发送中", delivered: "已送达", failed: "失败",
    blocked: "来源目标冲突", uncertain: "回执未知，请在飞书核对", needs_target: "待绑定本会话飞书目标",
  };
  async function retry() {
    setSending(true);
    try {
      await api.retryFeishuReply(message.conversationId, message.id);
      await delivery.refetch();
      setFeedback("已请求重新投递");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "重试失败");
    } finally {
      setSending(false);
    }
  }
  return <details><summary>飞书投递 · {parts.filter(p => p.status === "delivered").length}/{parts.length}</summary>
    {parts.map(p => <div key={p.position}>第 {p.position} 部分 · {labels[p.status] || p.status} · 尝试 {p.attempts} 次
      {p.retries > 0 && ` · 人工重试 ${p.retries} 次`}{p.detail && ` · ${p.detail}`}{p.receipt && ` · 回执 ${p.receipt}`}</div>)}
    {parts.some(p => ["failed", "needs_target"].includes(p.status)) &&
      <button type="button" disabled={sending} onClick={retry}>重新投递</button>}
    {feedback && <span role="status">{feedback}</span>}
  </details>;
}

function elapsedLabel(startedAt: number): string {
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return `${s} 秒`;
}

function DispatchCard({
  job,
  resolve,
  onSteer,
  onStop,
  onFocus,
}: {
  job: RunningJob;
  resolve: ReturnType<typeof useAgentDirectory>["resolve"];
  onSteer?: (runId: string, message: string) => void;
  onStop?: (jobId: string) => void;
  onFocus?: (runId?: string) => void;
}) {
  const [, setTick] = useState(0);
  const [steerOpen, setSteerOpen] = useState(false);
  const [steerText, setSteerText] = useState("");
  useEffect(() => {
    if (job.status === "succeeded" || job.status === "failed" || job.status === "error") return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [job.status]);

  const info = resolve(job.agentId || job.label);
  const persona = job.persona || info.persona;
  const running = !["succeeded", "failed", "error", "cancelled", "dead"].includes(job.status);
  return (
    <div className="agent-dispatch">
      <div className="agent-dispatch__head">
        <AgentAvatar persona={persona} team={info.team} />
        <div>
          <strong>
            {persona}
            {info.name && info.name !== persona ? ` · ${info.name}` : ""}
          </strong>
          <small>
            {running ? (
              <>
                <span className="agent-dispatch__pulse" /> 正在工作 · 已运行 {elapsedLabel(job.startedAt)}
              </>
            ) : (
              <>状态：{statusLabel(job.status)}</>
            )}
          </small>
        </div>
        <Badge tone={statusTone(job.status)}>{statusLabel(job.status)}</Badge>
      </div>
      {running ? (
        <div className="agent-dispatch__actions">
          <Button size="sm" variant="ghost" onClick={() => setSteerOpen((v) => !v)}>
            <MessageSquarePlus size={13} /> 追加指令
          </Button>
          {job.jobId ? (
            <Button size="sm" variant="ghost" onClick={() => onStop?.(job.jobId)}>
              <Square size={13} /> 停止
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => onFocus?.(job.runId)}>
            查看过程
          </Button>
        </div>
      ) : null}
      {steerOpen && job.runId ? (
        <div className="agent-dispatch__steer">
          <input
            value={steerText}
            placeholder="追加给该 Agent 的指令…"
            onChange={(e) => setSteerText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && steerText.trim()) {
                onSteer?.(job.runId!, steerText.trim());
                setSteerText("");
                setSteerOpen(false);
              }
            }}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={!steerText.trim()}
            onClick={() => {
              if (!steerText.trim() || !job.runId) return;
              onSteer?.(job.runId, steerText.trim());
              setSteerText("");
              setSteerOpen(false);
            }}
          >
            发送
          </Button>
        </div>
      ) : null}
      {job.text ? (
        <CollapsibleSection title="执行日志" defaultOpen={running}>
          <pre className="agent-dispatch__log">{job.text}</pre>
        </CollapsibleSection>
      ) : null}
    </div>
  );
}

function ProcessTrail({ steps, busy }: { steps: RunStepItem[]; busy?: boolean }) {
  // 总编自己的工具调用已经内联在消息里，这里只展示子 Agent 与系统的执行过程
  const others = steps.filter((s) => s.kind === "model_call" || (s.actor !== "chief" && s.actor !== "assistant"));
  if (!others.length) return null;
  return (
    <CollapsibleSection
      title={`执行过程（${others.length} 步）`}
      summary={busy ? "正在实时更新 · 最新在前" : "最新在前"}
      defaultOpen
      className="chat-thread__process"
    >
      <div className="chat-thread__process-list">
        <ProcessSteps steps={others} limit={others.length} newestFirst showRun />
      </div>
    </CollapsibleSection>
  );
}

type ToolCall = { id?: string; function?: { name?: string; arguments?: string } };

function parseArgs(raw?: string): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function ToolCallsBlock({
  calls,
  results,
  pending,
}: {
  calls: ToolCall[];
  results: Map<string, string>;
  pending?: boolean;
}) {
  return (
    <ol className="chat-tools">
      {calls.map((c, i) => {
        const name = c.function?.name || "";
        const fields = describeFields(parseArgs(c.function?.arguments), 4);
        const result = c.id ? results.get(c.id) : undefined;
        const running = result === undefined && pending;
        return (
          <li key={c.id || i} className={`chat-tools__item ${running ? "is-running" : ""}`}>
            <div className="chat-tools__head">
              {running ? (
                <Loader2 size={13} className="assistant__spinner" />
              ) : (
                <Wrench size={13} />
              )}
              <strong>{toolLabel(name)}</strong>
              {fields.map((f) => (
                <span key={f.label} className="chat-tools__arg">
                  <em>{f.label}</em>
                  {f.value}
                </span>
              ))}
            </div>
            {result !== undefined ? (
              result.length > 160 ? (
                <details className="chat-tools__result">
                  <summary>{summarizeResult(result, 120)}</summary>
                  <MarkdownDocument source={result} />
                </details>
              ) : (
                <div className="chat-tools__result">{summarizeResult(result, 160) || "已完成"}</div>
              )
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

const INBOX_HEADER = /^以下是连续收到的多条消息[^\n]*\n?/;

function humanizeEventText(text: string): string {
  return text
    .replace(/\s*→\s*\/runs\/\S+/g, "")
    .replace(/^\?\s*→\s*/, "")
    .replace(/\brun=([\w-]+)/g, (_m, id: string) => `任务 ${shortId(id)}`)
    .replace(/\bproject=([\w-]+)/g, (_m, id: string) => `项目 ${shortId(id)}`)
    .replace(/\b(task_group_done|job_done)\b/g, (s) => sourceLabel(s))
    .replace(/\b(succeeded|failed|cancelled|running|queued|completed|dead|error)\b/g, (s) =>
      statusLabel(s),
    )
    .replace(/\s*\|\s*/g, " · ")
    .trim();
}

function InboxEventCard({ content }: { content: string }) {
  const body = content.replace(INBOX_HEADER, "");
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^-?\s*\[([^\]]+)\]\s*(.*)$/);
      return m ? { tag: m[1], text: m[2] } : { tag: "", text: l.replace(/^-\s*/, "") };
    });
  return (
    <div className="chat-thread__event">
      <Inbox size={14} />
      <div className="chat-thread__event-body">
        <strong>收到 {lines.length} 条新消息，总编合并处理</strong>
        <ul>
          {lines.map((l, i) => (
            <li key={i}>
              {l.tag ? <Badge tone="default">{sourceLabel(l.tag)}</Badge> : null}
              <span>{humanizeEventText(l.text)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function HandoffCard({ handoff }: { handoff: Record<string, unknown> }) {
  const fromName = String(handoff.fromBotName ?? "—");
  const toName = String(handoff.toBotName ?? "—");
  const stage = handoff.stageName ? String(handoff.stageName) : null;
  const instruction = handoff.instruction ? String(handoff.instruction) : "";
  const context = handoff.context ? String(handoff.context) : "";
  return (
    <CollapsibleSection
      title={`交接 · ${fromName} → ${toName}`}
      defaultOpen={false}
      className="chat-thread__handoff"
    >
      <div className="chat-thread__handoff-body">
        <Badge tone="default">{stage || "阶段"}</Badge>
        {instruction ? (
          <p>
            <strong>指令</strong>
            <br />
            {instruction}
          </p>
        ) : null}
        {context ? (
          <details className="chat-thread__handoff-context">
            <summary>上下文</summary>
            <MarkdownDocument source={context} />
          </details>
        ) : null}
        {handoff.requiresUserAck ? <Badge tone="warn">需你确认</Badge> : null}
      </div>
    </CollapsibleSection>
  );
}

function PipelineArtifact({ item }: { item: Record<string, unknown> }) {
  const [body, setBody] = useState<string>();
  const [loading, setLoading] = useState(false);
  const open = async () => {
    setLoading(true);
    try {
      const id = String(item.id);
      const live = await api.getContextArtifactText(id);
      if (live.projectId !== item.projectId) throw new Error("产物项目不匹配");
      if (live.version === item.version) setBody(live.text);
      else {
        const versions = await api.listArtifactVersions(live.projectId, id);
        const frozen = versions.find(v => v.version === item.version);
        if (!frozen) throw new Error("找不到交付版本");
        setBody(frozen.bodyMarkdown || JSON.stringify(frozen.bodyJson, null, 2));
      }
    } catch (e) {
      setBody(e instanceof Error ? e.message : "读取交付版本失败");
    } finally {
      setLoading(false);
    }
  };
  return <div><Button size="sm" variant="ghost" disabled={loading} onClick={() => body ? setBody(undefined) : void open()}>
    {String(item.title)} · v{String(item.version)} {loading ? "读取中" : "查看交付版本"}
  </Button>{body && <MarkdownDocument source={body} />}</div>;
}

function PipelineQaReview({ item }: { item: Record<string, unknown> }) {
  const [pages, setPages] = useState<Array<{id:string; title:string; text:string; version:number}>>([]);
  const [versions, setVersions] = useState<Record<string,number>>();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState(false);
  const inspect = async () => {
    setBusy(true);
    setVersions(undefined);
    setPages([]);
    setStatus("");
    try {
      const project = String(item.projectId);
      const rows = await api.listArtifacts(project);
      const required = {...item.sources as Record<string,number>, ...item.reports as Record<string,number>};
      const texts = await Promise.all(Object.entries(required).map(async ([id,version]) => {
        const row = await api.getContextArtifactText(id);
        if (row.projectId !== project || row.version !== version) throw new Error("稿件版本已变化，请重新核对 QA。");
        return {...row,id};
      }));
      setPages(texts);
      setVersions(Object.fromEntries(rows.map(r => [r.id,r.version])));
    } catch (error) { setStatus(error instanceof Error ? error.message : "无法读取 QA 稿件"); }
    finally { setBusy(false); }
  };
  const sign = async () => {
    if (!versions) return;
    setBusy(true);
    try {
      await api.signPipelineQa(String(item.projectId),String(item.runId),versions);
      setSigned(true);
      setStatus("已签署本次 QA 清单与对应稿件版本。");
    } catch (error) {
      setVersions(undefined);
      setStatus(error instanceof Error ? error.message : "签署失败，请重新核对版本。");
    } finally { setBusy(false); }
  };
  return <div>
    <Button size="sm" disabled={busy || signed} onClick={() => void inspect()}>审阅 QA 清单与稿件</Button>
    {pages.map(p => <details key={p.id} open><summary>{p.title} · v{p.version}</summary><MarkdownDocument source={p.text} /></details>)}
    {versions && !signed && <Button size="sm" disabled={busy} onClick={() => void sign()}>确认已审阅并签署本次 QA</Button>}
    {status && <p>{status}</p>}
  </div>;
}

function EvidenceBlock({ evidence }: { evidence: Array<Record<string, unknown>> }) {
  const handoffs = evidence.filter((e) => e?.type === "handoff");
  const artifacts = evidence.filter(e => e?.kind === "pipeline_artifact");
  const reviews = evidence.filter(e => e?.kind === "pipeline_qa");
  const rest = evidence.filter(e => e?.kind !== "pipeline_qa" && e?.type !== "handoff" && e?.kind !== "context_ref" && e?.kind !== "pipeline_artifact");
  if (!handoffs.length && !rest.length && !artifacts.length && !reviews.length) return null;
  return (
    <>
      {reviews.map(q => <PipelineQaReview key={String(q.runId)} item={q} />)}
      {artifacts.map(a => <PipelineArtifact key={String(a.id)} item={a} />)}
      {handoffs.map((h, i) => (
        <HandoffCard key={`h-${i}`} handoff={h} />
      ))}
      {rest.length ? (
        <details className="chat-thread__evidence">
          <summary>证据 · {rest.length}</summary>
          <ul>
            {rest.map((e, i) => (
              <li key={i}>
                <code>{JSON.stringify(e)}</code>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

function ConfirmCard({
  busy,
  editableArgs,
  onRespond,
}: {
  busy?: boolean;
  editableArgs?: Record<string, unknown> | null;
  onRespond?: (approve: boolean, editedArgs?: Record<string, unknown>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() =>
    editableArgs ? JSON.stringify(editableArgs, null, 2) : "",
  );
  return (
    <div className="chat-thread__confirm">
      {editableArgs && editing ? (
        <label className="field" style={{ flex: "1 1 100%" }}>
          <span>修改参数后批准</span>
          <textarea
            className="input"
            rows={5}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
      ) : null}
      <Button
        size="sm"
        variant="primary"
        disabled={busy}
        onClick={() => {
          if (editing && draft.trim()) {
            try {
              onRespond?.(true, JSON.parse(draft) as Record<string, unknown>);
              return;
            } catch {
              return;
            }
          }
          onRespond?.(true);
        }}
      >
        <Check size={13} /> 批准
      </Button>
      {editableArgs ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing((v) => !v)}>
          {editing ? "取消编辑" : "编辑后批准"}
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={() => onRespond?.(false)} disabled={busy}>
        <X size={13} /> 拒绝
      </Button>
    </div>
  );
}

function BotToBotFold({ messages }: { messages: UiMsg[] }) {
  if (messages.length < 2) {
    return (
      <>
        {messages.map((m) => (
          <div key={m.id} className="chat-thread__bot2bot-line">
            <MarkdownDocument source={m.content || ""} />
          </div>
        ))}
      </>
    );
  }
  return (
    <details className="chat-thread__bot2bot">
      <summary>Bot 互聊 · {messages.length} 条</summary>
      <div className="stack" style={{ gap: 8 }}>
        {messages.map((m) => (
          <div key={m.id} className="chat-thread__bot2bot-line">
            <MarkdownDocument source={m.content || ""} />
          </div>
        ))}
      </div>
    </details>
  );
}

export function ChatThread({
  messages,
  steps,
  plan,
  runningJobs,
  pendingConfirm,
  busy,
  emptyHint,
  botDirectory,
  onRespond,
  onSteer,
  onStop,
  onFocusRun,
}: {
  messages: UiMsg[];
  steps: RunStepItem[];
  plan: { goal?: string; steps: PlanStep[] } | null;
  runningJobs: RunningJob[];
  pendingConfirm: { messageId?: string; message?: string } | null;
  busy?: boolean;
  emptyHint?: React.ReactNode;
  /** botId → 显示名 / 头像字 */
  botDirectory?: Record<string, { name: string; emoji?: string; color?: string }>;
  onRespond?: (approve: boolean, editedArgs?: Record<string, unknown>) => void;
  onSteer?: (runId: string, message: string) => void;
  onStop?: (jobId: string) => void;
  onFocusRun?: (runId?: string) => void;
}) {
  const { resolve } = useAgentDirectory();

  const toolResults = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of messages) {
      if (m.role !== "tool") continue;
      const act = (m.actions || []).find((a) => a?.type === "tool_result") as
        | { tool_call_id?: string }
        | undefined;
      if (act?.tool_call_id) map.set(act.tool_call_id, m.content || "");
    }
    return map;
  }, [messages]);

  const visible = useMemo(
    () =>
      messages.filter((m) => {
        if (m.role === "tool") return false;
        if (m.role !== "assistant") return true;
        return Boolean(
          m.pending || m.confirm || (m.content || "").trim() || (m.toolCalls || []).length,
        );
      }),
    [messages],
  );

  const resolveBot = (botId?: string | null) => {
    if (botId && botDirectory && Object.hasOwn(botDirectory, botId)) return botDirectory[botId];
    const { name, avatar } = resolve(botId);
    return { name, emoji: avatar?.emoji, color: avatar?.color };
  };

  type RenderItem =
    | { type: "msg"; msg: UiMsg; idx: number }
    | { type: "bot2bot"; msgs: UiMsg[]; key: string };

  const renderItems = useMemo(() => {
    const items: RenderItem[] = [];
    let i = 0;
    while (i < visible.length) {
      const m = visible[i];
      const isBotDm =
        m.role === "assistant" &&
        Boolean(m.botId) &&
        (m.actions || []).some((a) => a?.type === "bot_to_bot" || a?.type === "bot_dm");
      if (isBotDm) {
        const group: UiMsg[] = [m];
        let j = i + 1;
        while (j < visible.length) {
          const n = visible[j];
          const nDm =
            n.role === "assistant" &&
            Boolean(n.botId) &&
            (n.actions || []).some((a) => a?.type === "bot_to_bot" || a?.type === "bot_dm");
          if (!nDm) break;
          group.push(n);
          j += 1;
        }
        if (group.length >= 2) {
          items.push({ type: "bot2bot", msgs: group, key: group[0].id });
          i = j;
          continue;
        }
      }
      items.push({ type: "msg", msg: m, idx: i });
      i += 1;
    }
    return items;
  }, [visible]);

  return (
    <div className="chat-thread">
      {plan ? (
        <div className="agent-workbench__plan chat-thread__plan">
          <div className="agent-workbench__plan-goal">{plan.goal || "执行计划"}</div>
          <ol className="agent-workbench__plan-steps">
            {plan.steps.map((s, i) => (
              <li key={i}>
                <span className="agent-workbench__plan-index">{i + 1}</span>
                <div>
                  <strong>{String(s.name ?? s.stage ?? "")}</strong>
                  <small>
                    {String(s.stage ?? "")}
                    {s.agents && s.agents.length ? ` · ${s.agents.map((a) => resolve(a).persona).join("、")}` : ""}
                    {s.requiresAck ? " · 需确认" : ""}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="chat-thread__welcome">
          <Bot size={22} />
          {emptyHint || <p>我是总编。用自然语言指挥写作工作台。</p>}
        </div>
      ) : (
        renderItems.map((item) => {
          if (item.type === "bot2bot") {
            return (
              <div key={item.key} className="chat-thread__msg chat-thread__msg--assistant">
                <div className="chat-thread__actor">
                  <AgentAvatar persona="互" team="编排" />
                  <span>Bot 互聊</span>
                </div>
                <BotToBotFold messages={item.msgs} />
              </div>
            );
          }
          const m = item.msg;
          const idx = item.idx;
          const inboxAct = (m.actions || []).find((a) => a?.type === "inbox_event") as
            | { sources?: string[] }
            | undefined;
          const sources = inboxAct?.sources || [];
          const isSystemEvent =
            m.role === "system" ||
            (sources.length > 0 && sources.some((s) => !["web", "feishu"].includes(s))) ||
            sources.length > 1;
          if (isSystemEvent) {
            return <InboxEventCard key={m.id} content={m.content || ""} />;
          }
          const isUser = m.role === "user";
          const calls = (m.toolCalls || []) as ToolCall[];
          const text = (m.content || "").trim();
          const sourceRefs = m.contextRefs || [];
          const prev = visible[idx - 1];
          const bot = resolveBot(m.botId);
          const showActor =
            !isUser && !(prev && prev.role === "assistant" && (prev.botId || null) === (m.botId || null));
          const confirmAction = (m.actions || []).find((a) => a?.type === "confirm_required") as
            | { args?: Record<string, unknown>; editableArgs?: Record<string, unknown> }
            | undefined;
          const editableArgs = confirmAction?.editableArgs || confirmAction?.args || null;
          return (
            <div key={m.id} className={`chat-thread__msg chat-thread__msg--${m.role}`}>
              {showActor ? (
                <div className="chat-thread__actor">
                  <AgentAvatar persona={bot.name} team="编排" emoji={bot.emoji} color={bot.color} />
                  <span>{bot.name}</span>
                  {m.pending ? <Loader2 size={14} className="assistant__spinner" /> : null}
                </div>
              ) : null}
              {text || (m.pending && !calls.length) ? (
                <div className="chat-thread__bubble">
                  {m.pending && !text ? (
                    "处理中…"
                  ) : isUser ? (
                    m.content
                  ) : (
                    <MarkdownDocument source={m.content || ""} />
                  )}
                </div>
              ) : null}
              {isUser && m.contextRefs?.length ? <ReferenceChips refs={m.contextRefs} /> : null}
              {!isUser && !m.pending && !m.confirm && sourceRefs.length ? <SelectionResult refs={sourceRefs} text={m.content || ""} /> : null}
              {(m.evidence || []).length ? <EvidenceBlock evidence={m.evidence || []} /> : null}
              {m.actions?.some(a => ["feishu_reply", "feishu_delivery"].includes(String(a.type))) && <FeishuDelivery message={m} />}
              {calls.length ? (
                <ToolCallsBlock calls={calls} results={toolResults} pending={busy || m.pending} />
              ) : null}
              {m.confirm || (pendingConfirm && m.content === pendingConfirm.message) ? (
                <ConfirmCard busy={busy} editableArgs={editableArgs} onRespond={onRespond} />
              ) : null}
            </div>
          );
        })
      )}

      {runningJobs.length > 0 ? (
        <div className="chat-thread__dispatches">
          {runningJobs.map((j) => (
            <DispatchCard
              key={j.jobId}
              job={j}
              resolve={resolve}
              onSteer={onSteer}
              onStop={onStop}
              onFocus={onFocusRun}
            />
          ))}
        </div>
      ) : null}

      <ProcessTrail steps={steps} busy={busy || runningJobs.length > 0} />
    </div>
  );
}
