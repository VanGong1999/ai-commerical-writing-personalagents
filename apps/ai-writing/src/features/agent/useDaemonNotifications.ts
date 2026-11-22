import { toast } from "@xiezuomanju/ui";
import { useEffect, useRef, useState } from "react";
import { api, type TasksSummary } from "../../api/client";

const base = (import.meta.env.VITE_API_BASE as string) || "";

type TaskEvent = {
  type?: string;
  seq?: number;
  title?: string;
  runId?: string;
  taskGroupId?: string;
  progressPct?: number;
  progressStage?: string;
  conversationId?: string;
  agentId?: string;
  status?: string;
  approved?: boolean;
};

/**
 * 全局守护任务 SSE + 摘要轮询：
 * - AppShell 胶囊数字
 * - toast / 桌面 Notification
 * - Personal Agent 未读红点
 */
export function useDaemonNotifications(opts?: { enableDesktop?: boolean }) {
  const [summary, setSummary] = useState<TasksSummary>({
    running: 0,
    queued: 0,
    waitingApproval: 0,
    slots: 4,
    activeGroups: 0,
  });
  const [assistantUnread, setAssistantUnread] = useState(0);
  const lastSeq = useRef(0);
  const notified = useRef<Set<string>>(new Set());

  const refreshSummary = async () => {
    try {
      const s = await api.getTasksSummary();
      setSummary(s);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void refreshSummary();
    const t = setInterval(() => void refreshSummary(), 8000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (opts?.enableDesktop && typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission().catch(() => undefined);
    }
  }, [opts?.enableDesktop]);

  useEffect(() => {
    const ac = new AbortController();
    let after = lastSeq.current;

    (async () => {
      try {
        const res = await fetch(`${base}/api/v1/tasks/stream?afterSeq=${after}`, {
          headers: { Accept: "text/event-stream" },
          signal: ac.signal,
        });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) >= 0) {
            const chunk = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const line = chunk.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            try {
              const ev = JSON.parse(line.slice(5).trim()) as TaskEvent;
              if (ev.seq) {
                lastSeq.current = ev.seq;
                after = ev.seq;
              }
              if (!ev.type || ev.type === "ping" || ev.type === "progress") {
                if (ev.type === "progress") void refreshSummary();
                continue;
              }
              const key = `${ev.type}:${ev.runId || ev.taskGroupId || ev.seq}`;
              if (notified.current.has(key)) continue;
              notified.current.add(key);

              if (ev.type === "run_waiting_approval") {
                toast.warn(`任务待审批：${ev.agentId || ev.runId || ""}`);
                desktopNotify("任务待审批", String(ev.agentId || ev.title || "需要你确认"));
                setAssistantUnread((n) => n + 1);
                void refreshSummary();
              } else if (ev.type === "run_reclaimed") {
                toast.warn(`Agent 已从检查点恢复：${ev.agentId || ev.runId || ""}`);
                desktopNotify("Agent 续跑", String(ev.agentId || "租约回收后自动恢复"));
                setAssistantUnread((n) => n + 1);
                void refreshSummary();
              } else if (ev.type === "run_dead") {
                toast.error(`Agent 重试耗尽：${ev.agentId || ev.runId || ""}`);
                desktopNotify("Agent 失败", String(ev.agentId || "需要人工处理"));
                setAssistantUnread((n) => n + 1);
                void refreshSummary();
              } else if (ev.type === "run_policy_blocked" || ev.type === "policy") {
                toast.warn(`需确认后才能续跑：${ev.agentId || ev.runId || ""}`);
                desktopNotify("存疑中断", "写类工具结果未知，请在工作台选择继续/拒绝");
                setAssistantUnread((n) => n + 1);
                void refreshSummary();
              } else if (ev.type === "action_audit") {
                toast.info(`代操作：${ev.title || ev.agentId || "Personal Agent"}`);
                setAssistantUnread((n) => n + 1);
              } else if (ev.type === "group_done" || ev.type === "run_cancelled") {
                const title = ev.type === "group_done" ? "任务组完成" : "任务已取消";
                toast.info(`${title}：${ev.title || ev.taskGroupId || ""}`);
                desktopNotify(title, String(ev.title || ev.status || ""));
                setAssistantUnread((n) => n + 1);
                void refreshSummary();
              } else if (ev.type === "group_created") {
                toast.info(`已创建后台任务组（${ev.title || ""}）`);
                void refreshSummary();
              } else if (ev.type === "run_approval") {
                toast.info(ev.approved ? "已批准子任务继续" : "已驳回子任务");
                void refreshSummary();
              }
            } catch {
              /* ignore parse */
            }
          }
        }
      } catch {
        /* aborted or network */
      }
    })();

    return () => ac.abort();
  }, []);

  const clearAssistantUnread = () => setAssistantUnread(0);

  return { summary, assistantUnread, clearAssistantUnread, refreshSummary };
}

function desktopNotify(title: string, body: string) {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    if (typeof document !== "undefined" && !document.hidden) return;
    new Notification(title, { body, tag: `xmj-task-${title}` });
  } catch {
    /* ignore */
  }
}
