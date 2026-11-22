import { mergeSteps, watchConversation } from "./conversationStream";
import { acknowledgedClientIds, reconcileMessage } from "./messageReconciliation";
import type { ContextRef } from "../references/selection";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type ConversationEvent,
  type ConversationMessage,
  type ConversationRuntime,
  type InboxEventItem,
  type RunStepItem,
  type ThreadSubItem,
} from "../../api/client";
import { streamConversationChat, subscribeJobEvents, type JobEvent } from "../../api/sse";

export type UiMsg = ConversationMessage & {
  pending?: boolean;
  confirm?: boolean;
  inboxEvent?: boolean;
  optimisticClientMessageId?: string;
};

type ConversationScope = { conversationId: string | null | undefined };
type ActiveSend = {
  conversationId: string;
  scope: ConversationScope | null;
  clientId: string;
  pendingId: string;
};

function localMessages(messages: UiMsg[], sends: Set<ActiveSend>, scope: ConversationScope) {
  const clientIds = new Set<string>();
  const pendingIds = new Set<string>();
  for (const send of sends) {
    if (send.scope === scope) {
      clientIds.add(send.clientId);
      pendingIds.add(send.pendingId);
    }
  }
  if (!clientIds.size) return [];
  return messages.filter((message) => {
    if (message.conversationId !== scope.conversationId) return false;
    if (clientIds.has(message.id) || pendingIds.has(message.id)) return true;
    // SSE may have already replaced the optimistic ID before this snapshot.
    for (const clientId of acknowledgedClientIds(message)) {
      if (clientIds.has(clientId)) return true;
    }
    return false;
  });
}

export type PlanStep = {
  stage?: string;
  name?: string;
  agents?: string[];
  requiresAck?: boolean;
};

export type RunningJob = {
  jobId: string;
  runId?: string;
  label: string;
  persona?: string;
  agentId?: string;
  status: string;
  text: string;
  startedAt: number;
};

const base = (import.meta.env.VITE_API_BASE as string) || "";

export function useAgentSession(conversationId: string | null | undefined) {
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [steps, setSteps] = useState<RunStepItem[]>([]);
  const [plan, setPlan] = useState<{ goal?: string; steps: PlanStep[] } | null>(null);
  const [runningJobs, setRunningJobs] = useState<RunningJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [runtime, setRuntime] = useState<ConversationRuntime | null>(null);
  const [inbox, setInbox] = useState<InboxEventItem[]>([]);
  const [subscriptions, setSubscriptions] = useState<ThreadSubItem[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<{
    messageId?: string;
    message?: string;
  } | null>(null);
  const unsubs = useRef<Array<() => void>>([]);
  const scope = useMemo(() => ({ conversationId }), [conversationId]);
  const active = useRef<typeof scope | null>(null);
  const sends = useRef(new Set<ActiveSend>());
  const selectedRefresh = useRef<(() => Promise<void>) | null>(null);
  const refreshVersion = useRef(0);

  const applyRuntime = useCallback((snap: ConversationRuntime) => {
    setRuntime(snap);
    setSubscriptions(snap.subscriptions || []);
    // 用 activeRuns 重建派工卡片（刷新不丢）
    setRunningJobs((prev) => {
      const byRun = new Map(prev.map((j) => [j.runId || j.jobId, j]));
      const next: RunningJob[] = [];
      for (const r of snap.activeRuns || []) {
        const key = r.runId || r.jobId || "";
        const old = byRun.get(key);
        next.push({
          jobId: r.jobId || r.runId,
          runId: r.runId,
          label: r.agentId,
          agentId: r.agentId,
          status: r.status,
          text: old?.text || "",
          startedAt: old?.startedAt || (r.startedAt ? Date.parse(r.startedAt) : Date.now()),
        });
      }
      // 保留刚结束但还在展示的
      for (const j of prev) {
        if (["succeeded", "failed", "error", "cancelled", "dead"].includes(j.status)) {
          if (!next.some((n) => n.jobId === j.jobId)) next.push(j);
        }
      }
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (active.current !== scope) return;
    if (!conversationId) return;
    const version = ++refreshVersion.current;
    try {
      const [msgs, stepRes, rt, inboxRes] = await Promise.all([
        api.listMessages(conversationId),
        api.listConversationSteps(conversationId).catch(() => ({ steps: [] as RunStepItem[] })),
        api.getConversationRuntime(conversationId).catch(() => null),
        api.getConversationInbox(conversationId, { limit: 40 }).catch(() => ({ events: [] })),
      ]);
      if (active.current !== scope || refreshVersion.current !== version) return;
      const mapped = msgs.map((m) => ({
        ...m,
        confirm:
          Boolean((m as { confirm?: boolean }).confirm) ||
          (m.actions || []).some((a) => a?.type === "confirm_required"),
        inboxEvent: (m.actions || []).some((a) => a?.type === "inbox_event"),
      }));
      setMessages((prev) => {
        let local = localMessages(prev, sends.current, scope);
        for (const message of mapped) {
          if (!local.length) break;
          // A snapshot may acknowledge an optimistic user row before SSE does.
          local = reconcileMessage<UiMsg>(local, message).filter((row) => row !== message);
        }
        return [...mapped, ...local];
      });
      // 刷新/重进页面时恢复待确认卡片（此前只依赖 SSE，刷新后按钮会消失）
      const pending = mapped.find((m) => m.confirm);
      if (pending) {
        setPendingConfirm({ messageId: pending.id, message: pending.content });
      } else {
        setPendingConfirm(null);
      }
      setSteps((prev) => mergeSteps(prev, stepRes.steps || []));
      setInbox(inboxRes.events || []);
      if (rt) applyRuntime(rt);
    } catch {
      // Keep any events already received while a snapshot request failed.
    }
  }, [conversationId, applyRuntime, scope]);

  // 会话级 SSE stream：续传 steps / runtime
  useLayoutEffect(() => {
    active.current = scope;
    selectedRefresh.current = refresh;
    for (const send of sends.current) {
      if (send.conversationId === conversationId && (!send.scope || send.scope === scope)) {
        send.scope = scope;
      } else {
        sends.current.delete(send);
      }
    }
    setMessages((prev) => localMessages(prev, sends.current, scope));
    setSteps([]);
    setPlan(null);
    setRunningJobs([]);
    setPendingConfirm(null);
    setRuntime(null);
    setInbox([]);
    setSubscriptions([]);
    setBusy(sends.current.size > 0);
    const ac = new AbortController();
    void refresh();
    if (conversationId) void watchConversation(
      `${base}/api/v1/conversations/${encodeURIComponent(conversationId)}/stream`, ac.signal, (evt) => {
        if (active.current !== scope) return;
        const event = String(evt.event || "");
        if (event === "step") {
          const step: RunStepItem = {
            id: String(evt.id),
            seq: Number(evt.seq || 0),
            actor: String(evt.actor || ""),
            kind: String(evt.kind || ""),
            payload: (evt.payload as Record<string, unknown>) || {},
            runId: (evt.runId as string) || null,
            turnId: (evt.turnId as string) || null,
            createdAt: String(evt.createdAt || new Date().toISOString()),
          };
          setSteps((prev) => mergeSteps(prev, [step]));
        } else if (event === "message") {
          if (typeof evt.id !== "string" || !evt.id) return;
          const id = evt.id;
          setMessages((prev) => {
            const cached = prev.find((m) => m.id === id);
            // Older streams omit fields present in the persisted snapshot.
            const row = { ...cached, ...evt } as Partial<ConversationMessage>;
            const actions = row.actions || [];
            const msg: UiMsg = {
              id, conversationId,
              role: row.role || "assistant",
              content: row.content || "",
              toolCalls: row.toolCalls || [],
              actions,
              confirm: typeof evt.confirm === "boolean" ? evt.confirm : actions.some((a) => a?.type === "confirm_required") ||
                (evt.actions === undefined && Boolean(cached?.confirm)),
              botId: row.botId,
              runId: row.runId,
              mentions: row.mentions || [],
              contextRefs: row.contextRefs ?? (row.evidence || []).filter(
                (e) => e.kind === "context_ref",
              ).map((e) => e.ref as ContextRef),
              evidence: row.evidence || [],
              createdAt: row.createdAt || new Date().toISOString(),
              inboxEvent: actions.some((a) => a?.type === "inbox_event"),
            };
            return reconcileMessage(prev, msg);
          });
        } else if (event === "runtime") {
          applyRuntime(evt as unknown as ConversationRuntime);
        } else if (event === "inbox") {
          void api
            .getConversationInbox(conversationId, { limit: 40 })
            .then((r) => { if (active.current === scope) setInbox(r.events || []); })
            .catch(() => {});
        }
      },
    );
    return () => {
      active.current = null;
      selectedRefresh.current = null;
      ac.abort();
      unsubs.current.forEach((u) => u());
      unsubs.current = [];
    };
  }, [conversationId, refresh, applyRuntime, scope]);

  const trackJob = useCallback((jobId: string, runId: string | undefined, label: string, extra?: Partial<RunningJob>) => {
    setRunningJobs((prev) => {
      if (prev.some((j) => j.jobId === jobId)) return prev;
      return [
        ...prev,
        {
          jobId,
          runId,
          label,
          persona: extra?.persona,
          agentId: extra?.agentId,
          status: "queued",
          text: "",
          startedAt: Date.now(),
        },
      ];
    });
    const jobScope = active.current;
    const stop = subscribeJobEvents(jobId, {
      onEvent: (evt: JobEvent) => {
        if (active.current !== jobScope) return;
        setRunningJobs((prev) =>
          prev.map((j) => {
            if (j.jobId !== jobId) return j;
            const status = evt.status ?? j.status;
            const text = evt.text ?? evt.message ?? j.text;
            return {
              ...j,
              status,
              text: text ? `${j.text}\n${text}`.slice(-2000) : j.text,
            };
          }),
        );
      },
      onError: () => {
        if (active.current !== jobScope) return;
        setRunningJobs((prev) =>
          prev.map((j) => (j.jobId === jobId ? { ...j, status: "error" } : j)),
        );
      },
    });
    unsubs.current.push(stop);
  }, []);

  const handleEvent = useCallback(
    (ev: ConversationEvent, pendingId: string) => {
      const event = ev.event;
      if (event === "plan") {
        const stepsArr = Array.isArray(ev.steps) ? (ev.steps as PlanStep[]) : [];
        setPlan({ goal: String(ev.goal ?? ""), steps: stepsArr });
        const stepText = stepsArr.map((s) => `• ${String(s.stage ?? s.name ?? "")}`).join("\n");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? { ...m, content: `计划：${String(ev.goal ?? "")}\n${stepText}`, pending: true }
              : m,
          ),
        );
      } else if (event === "tool_call") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? { ...m, content: `调用工具：${String(ev.tool ?? "")}…`, pending: true }
              : m,
          ),
        );

      } else if (event === "tool_result") {
        const detail = (ev.detail ?? {}) as Record<string, unknown>;
        const jobId = typeof detail.job_id === "string" ? detail.job_id : undefined;
        const runId = typeof detail.run_id === "string" ? detail.run_id : undefined;
        const label = String(detail.label ?? detail.agent_id ?? ev.tool ?? "任务");
        const persona = typeof detail.persona === "string" ? detail.persona : undefined;
        const agentId = typeof detail.agent_id === "string" ? detail.agent_id : undefined;
        if (jobId) trackJob(jobId, runId, label, { persona, agentId });

      } else if (event === "confirm") {
        setPendingConfirm({
          messageId: ev.messageId as string | undefined,
          message: String(ev.message ?? ""),
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? { ...m, content: String(ev.message ?? "需要确认"), contextRefs:Array.isArray(ev.contextRefs)?ev.contextRefs as ContextRef[]:[], confirm: true, pending: false }
              : m,
          ),
        );
      } else if (event === "done") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? {
                  ...m,
                  content: String(ev.reply ?? (ev.queued ? "已加入队列" : "已完成")),
                  contextRefs: ev.queued ? [] : Array.isArray(ev.contextRefs) ? ev.contextRefs as ContextRef[] : [],
                  pending: false,
                }
              : m,
          ),
        );
      } else if (event === "error") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? { ...m, content: String(ev.message ?? "出错了"), contextRefs:[], pending: false }
              : m,
          ),
        );
      }
    },
    [trackJob],
  );

  const send = useCallback(
    async (
      text: string,
      projectId?: string,
      overrideConversationId?: string,
      opts?: { mentionBotIds?: string[]; forceContinue?: boolean; botId?: string; contextRefs?: ContextRef[] },
    ) => {
      const cid = overrideConversationId || conversationId;
      // 全双工：不再因 busy 禁用发送（后端会排队 / 直通）
      if (!cid || !text.trim()) return;
      // A caller may start the first send in the same event that selects its
      // new conversation. The next layout commit adopts this request by id.
      if (!active.current || (active.current !== scope &&
          !(overrideConversationId && active.current.conversationId === cid))) return;
      const request: ActiveSend = {
        conversationId: cid,
        scope: active.current.conversationId === cid ? active.current : null,
        clientId: crypto.randomUUID(),
        pendingId: crypto.randomUUID(),
      };
      sends.current.add(request);
      const isCurrentSend = () => sends.current.has(request) &&
        active.current === (request.scope || scope);
      const clientMessageId = request.clientId;
      try {
        const contextRefs = opts?.contextRefs?.length ? (await api.resolveContextRefs(opts.contextRefs)).refs : [];
        if (!isCurrentSend()) return;
        setBusy(true);
        setPendingConfirm(null);
        setPlan(null);
        const userMsg: UiMsg = {
          id: clientMessageId,
          optimisticClientMessageId: clientMessageId,
          conversationId: cid,
          role: "user",
          content: text.trim(),
          toolCalls: [],
          actions: [],
          mentions: opts?.mentionBotIds || [],
          contextRefs,
          createdAt: new Date().toISOString(),
        };
        const pendingMsg: UiMsg = {
          id: request.pendingId,
          conversationId: cid,
          role: "assistant",
          content: "",
          toolCalls: [],
          actions: [],
          botId: opts?.botId || null,
          contextRefs: [],
          createdAt: new Date().toISOString(),
          pending: true,
        };
        setMessages((prev) => [...prev, userMsg, pendingMsg]);
        for await (const ev of streamConversationChat(cid, {
          message: text.trim(),
          clientMessageId,
          projectId,
          mentionBotIds: opts?.mentionBotIds,
          forceContinue: opts?.forceContinue,
          contextRefs,
        })) {
          if (isCurrentSend()) handleEvent(ev, pendingMsg.id);
        }
      } catch (e) {
        if (!isCurrentSend()) throw e;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === request.pendingId
              ? {
                  ...m,
                  pending: false,
                  contextRefs: [],
                  content: `失败：${e instanceof Error ? e.message : String(e)}`,
                }
              : m,
          ),
        );
        throw e;
      } finally {
        const selected = isCurrentSend();
        sends.current.delete(request);
        if (selected) {
          setBusy(sends.current.size > 0);
          if (active.current?.conversationId === cid) void selectedRefresh.current?.();
        }
      }
    },
    [conversationId, handleEvent, scope],
  );

  const respond = useCallback(
    async (approve: boolean, editedArgs?: Record<string, unknown>) => {
      if (!conversationId) return;
      const res = await api.respondConversation(conversationId, {
        approve,
        messageId: pendingConfirm?.messageId,
        editedArgs,
      });
      if (active.current !== scope) return res;
      setPendingConfirm(null);
      await refresh();
      return res;
    },
    [conversationId, pendingConfirm?.messageId, refresh, scope],
  );

  const steer = useCallback(
    async (runId: string, message: string) => {
      await api.steerRun(runId, message);
      await refresh();
    },
    [refresh],
  );

  const stopJob = useCallback(
    async (jobId: string) => {
      await api.cancelJob(jobId);
      if (active.current !== scope) return;
      setRunningJobs((prev) =>
        prev.map((j) => (j.jobId === jobId ? { ...j, status: "cancelled" } : j)),
      );
      await refresh();
    },
    [refresh, scope],
  );

  const setSubMode = useCallback(
    async (subId: string, mode: string) => {
      if (!conversationId) return;
      await api.updateSubscription(conversationId, subId, { mode });
      await refresh();
    },
    [conversationId, refresh],
  );

  return {
    messages,
    setMessages,
    steps,
    plan,
    runningJobs,
    busy,
    pendingConfirm,
    runtime,
    inbox,
    subscriptions,
    send,
    respond,
    refresh,
    trackJob,
    steer,
    stopJob,
    setSubMode,
  };
}
