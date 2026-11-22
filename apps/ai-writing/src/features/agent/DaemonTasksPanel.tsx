import { canResumeBatch, EditorialRetryDialog } from "../runs/EditorialRetryDialog";
import { instancesInScope } from "./taskScope";
import { useMutation } from "@tanstack/react-query";
import { Badge, Button, Modal, toast } from "@xiezuomanju/ui";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  RefreshCw,
  Square,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AgentInstance, type TaskGroup, type TasksSummary } from "../../api/client";
import { statusLabel, statusTone } from "../agent-chat/stepFormat";
import { useAgentDirectory } from "../agent-chat/useAgentDirectory";
import { ActionAuditFeed } from "./ActionAuditFeed";

const ATTENTION_LABEL: Record<string, string> = {
  lease_expired: "租约过期",
  lease_expiring: "租约将过期",
  retrying: "检查点续跑中",
  dead: "重试耗尽",
};

const GROUP_KIND_LABELS: Record<string, string> = {
  multi_book: "多本书",
  multi_chapter: "多章节",
  multi_agent: "多智能体",
  single: "单任务",
};

type Props = {
  conversationId?: string | null;
  compact?: boolean;
  onOpenFull?: () => void;
};

export function DaemonTasksPanel({ conversationId, compact, onOpenFull }: Props) {
  const [scope, setScope] = useState("all");
  const selected = scope === "current" ? conversationId : undefined;
  return <div>{!compact && <label>任务范围 <select aria-label="任务范围" value={selected ? "current" : "all"} onChange={event => setScope(event.target.value)}>
    <option value="all">全部任务</option><option value="current" disabled={!conversationId}>当前会话</option>
  </select></label>}
    <TaskList key={selected ?? "all"} conversationId={selected} compact={compact} onOpenFull={onOpenFull} />
  </div>;
}

function TaskList({ conversationId, compact, onOpenFull }: Props) {
  const request = useRef(0);
  const [error, setError] = useState(false);
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [summary, setSummary] = useState<TasksSummary | null>(null);
  const [instances, setInstances] = useState<AgentInstance[]>([]);
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const [steer, setSteer] = useState<{ runId: string; label: string } | null>(null);
  const [steerMsg, setSteerMsg] = useState("");
  const [steerStrategy, setSteerStrategy] = useState<"enqueue" | "interrupt">("enqueue");
  const [loading, setLoading] = useState(false);
  const { resolve } = useAgentDirectory();

  const refresh = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      const [g, s, inst] = await Promise.all([
        api.listTaskGroups(conversationId || undefined),
        api.getTasksSummary(),
        api.listInstances({ includeFinished: true }),
      ]);
      if (id !== request.current) return;
      setError(false);
      setGroups(g.groups || []);
      setSummary(s);
      setInstances(instancesInScope(inst.instances, g.groups, conversationId));
      setOpenIds((prev) => {
        const next = { ...prev };
        for (const gr of g.groups || []) {
          if (next[gr.id] === undefined && gr.status === "running") next[gr.id] = true;
        }
        return next;
      });
    } catch {
      if (id === request.current) setError(true);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => { clearInterval(t); request.current++; };
  }, [refresh]);

  const runRecovery = useMutation({
    mutationFn: ({ runId }: { runId: string }) => api.resumeTaskRun(runId),
    onSuccess: async () => {
      toast.ok("已恢复任务");
      await refresh();
    },
    onError: (e: Error) => toast.fail(e.message),
  });
  const groupStatus = useMutation({
    mutationFn: ({ groupId, status }: { groupId: string; status: "running" | "paused" }) =>
      api.patchTaskGroup(groupId, { status }),
    onSuccess: async (_, { status }) => {
      toast.ok(status === "running" ? "已提交任务组恢复请求" : "已暂停任务组");
      await refresh();
    },
    onError: (e: Error, { status }) =>
      toast.fail(`任务组${status === "running" ? "恢复" : "暂停"}失败。${e.message}`),
  });

  const retry = <button disabled={loading} onClick={() => void refresh()}>重试</button>;
  if (!summary) return <div role="status">{error ? <>任务读取失败 {retry}</> : "正在读取任务…"}</div>;
  if (compact && error) return <div role="status">任务刷新失败 {retry}</div>;
  if (compact) {
    const running = summary?.running || 0;
    const waiting = summary?.waitingApproval || 0;
    const pct =
      groups.length === 0
        ? 0
        : Math.round(
            groups.reduce((s, g) => s + (g.progress?.pct || 0), 0) / Math.max(1, groups.length),
          );
    return (
      <button type="button" className="daemon-mini" onClick={onOpenFull}>
        <div className="daemon-mini__head">
          <strong>守护任务</strong>
          <Badge tone={waiting ? "warn" : running ? "ok" : "default"}>
            {running}/{summary?.slots || 4} 运行
          </Badge>
        </div>
        <div className="daemon-progress">
          <div className="daemon-progress__bar" style={{ width: `${pct}%` }} />
        </div>
        <small>
          {waiting > 0 ? `待审批 ${waiting} · ` : ""}
          活跃组 {summary?.activeGroups || 0}
        </small>
      </button>
    );
  }

  return (
    <div className="daemon-tasks">
      {error && <p role="status">刷新失败，以下为上次读取的任务。 {retry}</p>}
      <header className="daemon-tasks__head">
        <div>
          <h2>守护任务中心</h2>
          <p>全局运行概况</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Badge tone="ok">
            运行 {summary?.running || 0}/{summary?.slots || 4}
          </Badge>
          <Badge tone="default">排队 {summary?.queued || 0}</Badge>
          <Badge tone={summary?.waitingApproval ? "warn" : "default"}>
            待审批 {summary?.waitingApproval || 0}
          </Badge>
          <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={14} /> 刷新
          </Button>
        </div>
      </header>

      {instances.some((i) => i.attention || i.status === "paused" || i.status === "dead") ? (
        <div className="daemon-attention" style={{ marginBottom: 12 }}>
          <strong style={{ display: "block", marginBottom: 6 }}>需要关注的 Agent 实例</strong>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
            {instances
              .filter((i) => i.attention || i.status === "paused" || i.status === "dead")
              .slice(0, 8)
              .map((i) => (
                <li
                  key={i.runId}
                  className="row"
                  style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}
                >
                  <Badge tone="warn">
                    {i.attention ? ATTENTION_LABEL[i.attention] || i.attention : statusLabel(i.status)}
                  </Badge>
                  <span>
                    {resolve(i.agentId)?.name || i.label || i.agentId}
                    {i.checkpoint?.turn != null ? ` · turn ${i.checkpoint.turn}` : ""}
                  </span>
                  {i.status === "paused" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={runRecovery.isPending}
                      loading={runRecovery.isPending && runRecovery.variables?.runId === i.runId}
                      onClick={() => runRecovery.mutate({ runId: i.runId })}
                    >
                      <Play size={14} /> 续跑
                    </Button>
                  ) : null}
                  {i.status === "running" || i.status === "queued" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void api
                          .pauseTaskRun(i.runId)
                          .then(() => {
                            toast.info("已暂停");
                            void refresh();
                          })
                          .catch((err) => toast.fail(String(err)))
                      }
                    >
                      <Pause size={14} />
                    </Button>
                  ) : null}
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div className="empty">暂无任务组。让总编用 start_async_task 同时写多本书/多章即可出现在这里。</div>
      ) : (
        <ul className="daemon-tasks__groups">
          {groups.map((g) => {
            const open = openIds[g.id] !== false;
            const canTryRecovery = canResumeBatch(g);
            const changingStatus = groupStatus.isPending && groupStatus.variables?.groupId === g.id;
            return (
              <li key={g.id} className="daemon-group">
                <div className="daemon-group__head">
                  <button
                    type="button"
                    className="daemon-group__toggle"
                    onClick={() => setOpenIds((p) => ({ ...p, [g.id]: !open }))}
                  >
                    {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <strong>{g.title}</strong>
                    <Badge>{GROUP_KIND_LABELS[g.kind] || g.kind}</Badge>
                    <Badge tone={statusTone(g.status)}>{statusLabel(g.status)}</Badge>
                  </button>
                  <div className="daemon-progress" style={{ flex: 1, maxWidth: 220 }}>
                    <div
                      className="daemon-progress__bar"
                      style={{ width: `${g.progress?.pct || 0}%` }}
                    />
                  </div>
                  <span className="daemon-group__pct">{g.progress?.pct || 0}%</span>
                  <label className="daemon-mode">
                    <select
                      value={g.approvalMode}
                      onChange={(e) =>
                        void api
                          .patchTaskGroup(g.id, { approvalMode: e.target.value })
                          .then(() => {
                            toast.info(
                              e.target.value === "auto_pilot"
                                ? "已切换为自动推进"
                                : "已切换为关键节点审批",
                            );
                            void refresh();
                          })
                          .catch((err) => toast.fail(String(err)))
                      }
                    >
                      <option value="auto_pilot">自动推进</option>
                      <option value="checkpoint_gate">关键节点审批</option>
                    </select>
                  </label>
                  {g.status === "paused" || canTryRecovery ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={canTryRecovery ? undefined : "恢复任务组"}
                      title={canTryRecovery ? undefined : "恢复任务组"}
                      disabled={groupStatus.isPending}
                      loading={changingStatus}
                      onClick={() => groupStatus.mutate({ groupId: g.id, status: "running" })}
                    >
                      <Play size={14} />
                      {canTryRecovery ? "尝试恢复未开始任务" : null}
                    </Button>
                  ) : g.status === "running" || g.status === "waiting_approval" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="暂停任务组"
                      title="暂停任务组"
                      disabled={groupStatus.isPending}
                      loading={changingStatus}
                      onClick={() => groupStatus.mutate({ groupId: g.id, status: "paused" })}
                    >
                      <Pause size={14} />
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void api
                        .cancelTaskGroup(g.id)
                        .then(() => {
                          toast.info("已取消任务组");
                          void refresh();
                        })
                    }
                  >
                    <Square size={14} />
                  </Button>
                </div>
                {open ? (
                  <ul className="daemon-group__runs">
                    {(g.runs || []).map((r) => (
                      <li key={r.runId}>
                        <div className="daemon-run__main">
                          <strong>{r.label}</strong>
                          <span className="muted">{resolve(r.agentId).persona}</span>
                          <Badge tone={r.approvalState === "waiting" ? "warn" : statusTone(r.status)}>
                            {r.approvalState === "waiting" ? "待审批" : statusLabel(r.status)}
                          </Badge>
                          <span className="muted">{r.progressStage || ""}</span>
                          {(r.attempt || 0) > 1 ? (
                            <Badge tone="warn">第 {r.attempt} 次尝试</Badge>
                          ) : null}
                          {r.status === "running" && r.leaseExpiresInS != null ? (
                            <Badge tone={r.leaseExpiresInS < 20 ? "warn" : "default"}>
                              {r.leaseExpiresInS < 0 ? "心跳超时" : `租约 ${r.leaseExpiresInS}s`}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="daemon-progress">
                          <div
                            className="daemon-progress__bar"
                            style={{ width: `${r.progressPct || 0}%` }}
                          />
                        </div>
                        <span className="daemon-group__pct">{r.progressPct || 0}%</span>
                        <div className="row" style={{ gap: 4 }}>
                          {r.approvalState === "waiting" ? (
                            <>
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() =>
                                  void api
                                    .approveTaskRun(r.runId, { approve: true })
                                    .then(() => {
                                      toast.info("已批准");
                                      void refresh();
                                    })
                                }
                              >
                                <Check size={13} /> 批准
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  void api
                                    .approveTaskRun(r.runId, { approve: false })
                                    .then(() => {
                                      toast.info("已驳回");
                                      void refresh();
                                    })
                                }
                              >
                                <X size={13} /> 驳回
                              </Button>
                            </>
                          ) : null}
                          {r.status === "paused" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={runRecovery.isPending}
                              loading={runRecovery.isPending && runRecovery.variables?.runId === r.runId}
                              onClick={() => runRecovery.mutate({ runId: r.runId })}
                            >
                              <Play size={13} /> 恢复
                            </Button>
                          ) : null}
                          {(r.status === "failed" || r.status === "dead") && r.jobId ? (
                            <EditorialRetryDialog jobId={r.jobId} onComplete={() => void refresh()} />
                          ) : null}
                          {["queued", "running"].includes(r.status) ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                void api
                                  .pauseTaskRun(r.runId)
                                  .then(() => {
                                    toast.info("已发出暂停信号（下一次心跳生效）");
                                    void refresh();
                                  })
                                  .catch((e) => toast.fail(String(e)))
                              }
                            >
                              <Pause size={13} /> 暂停
                            </Button>
                          ) : null}
                          {["queued", "running", "pending_deps"].includes(r.status) ? (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setSteer({ runId: r.runId, label: r.label });
                                  setSteerMsg("");
                                  setSteerStrategy("enqueue");
                                }}
                              >
                                干预
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  void api.cancelTaskRun(r.runId).then(() => {
                                    toast.info("已取消");
                                    void refresh();
                                  })
                                }
                              >
                                停止
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <ActionAuditFeed onChanged={() => void refresh()} />

      <Modal
        open={Boolean(steer)}
        onOpenChange={(v) => {
          if (!v) setSteer(null);
        }}
        title={`干预 · ${steer?.label || ""}`}
        description="enqueue：排队追加；interrupt：硬中断当前推理并按新指令重跑。"
        footer={
          <div className="row" style={{ gap: 8, justifyContent: "flex-end", width: "100%" }}>
            <Button onClick={() => setSteer(null)}>取消</Button>
            <Button
              variant="primary"
              disabled={!steerMsg.trim()}
              onClick={() => {
                if (!steer) return;
                void api
                  .updateTaskRun(steer.runId, {
                    message: steerMsg.trim(),
                    updateStrategy: steerStrategy,
                  })
                  .then(() => {
                    toast.info(steerStrategy === "interrupt" ? "已硬中断并注入指令" : "已追加指令");
                    setSteer(null);
                    void refresh();
                  })
                  .catch((e) => toast.fail(String(e)));
              }}
            >
              发送
            </Button>
          </div>
        }
      >
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <label>
            <input
              type="radio"
              checked={steerStrategy === "enqueue"}
              onChange={() => setSteerStrategy("enqueue")}
            />{" "}
            追加队列
          </label>
          <label>
            <input
              type="radio"
              checked={steerStrategy === "interrupt"}
              onChange={() => setSteerStrategy("interrupt")}
            />{" "}
            硬中断重跑
          </label>
        </div>
        <textarea
          rows={4}
          style={{ width: "100%" }}
          value={steerMsg}
          onChange={(e) => setSteerMsg(e.target.value)}
          placeholder="例如：改用更强冲突开篇，少写旁白…"
        />
      </Modal>
    </div>
  );
}
