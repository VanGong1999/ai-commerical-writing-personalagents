import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  PageHeader,
  Panel,
  ProgressBar,
  StatusBadge,
  toast,
  type StatusTone,
} from "@xiezuomanju/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { api, type TaskGroup, type TaskGroupRun } from "../../api/client";
import { canResumeBatch, EditorialRetryDialog } from "./EditorialRetryDialog";
import { RunTraceTimeline, runStatusOf } from "./RunTraceTimeline";

const GROUP_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  running: { label: "进行中", tone: "running" },
  waiting_approval: { label: "待审批", tone: "pending" },
  paused: { label: "已暂停", tone: "warn" },
  completed: { label: "已完成", tone: "ok" },
  partial_failed: { label: "部分失败", tone: "warn" },
  cancelled: { label: "已取消", tone: "idle" },
};

const GROUP_KIND_LABELS: Record<string, string> = {
  multi_book: "多本书",
  multi_chapter: "多章节",
  multi_agent: "多智能体",
  single: "单任务",
};

function statusOf(group: TaskGroup): { label: string; tone: StatusTone } {
  return GROUP_STATUS[group.status] ?? { label: group.status, tone: "idle" };
}

function fmtTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN");
}

function defaultGroupOpen(g: TaskGroup): boolean {
  return g.status === "running" || g.status === "waiting_approval" || g.status === "paused";
}

const GROUP_TERMINAL = new Set(["completed", "partial_failed", "cancelled"]);

function RunActions({ run }: { run: TaskGroupRun }) {
  const qc = useQueryClient();
  const approve = useMutation({
    mutationFn: (approveValue: boolean) =>
      api.approveTaskRun(run.runId, { approve: approveValue }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["taskGroups"] });
      toast.ok("已提交审批意见");
    },
    onError: (e: Error) => toast.fail(e.message),
  });
  const recover = useMutation({
    mutationFn: () => api.resumeTaskRun(run.runId),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["taskGroups"] }),
        qc.invalidateQueries({ queryKey: ["runReplay", run.runId] }),
        qc.invalidateQueries({ queryKey: ["run", run.runId] }),
      ]);
      toast.ok("已恢复任务");
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const waiting = run.approvalState === "waiting";
  const paused = run.status === "paused";
  const retryJobId = run.status === "failed" || run.status === "dead" ? run.jobId : null;
  if (!waiting && !paused && !retryJobId) return null;

  return (
    <div className="row" style={{ gap: 8, alignItems: "center" }}>
      {waiting ? (
        <>
          <Button
            size="sm"
            variant="primary"
            disabled={approve.isPending}
            loading={approve.isPending && approve.variables === true}
            onClick={() => approve.mutate(true)}
          >
            继续
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={approve.isPending}
            loading={approve.isPending && approve.variables === false}
            onClick={() => approve.mutate(false)}
          >
            驳回
          </Button>
        </>
      ) : null}
      {retryJobId ? <EditorialRetryDialog jobId={retryJobId} onComplete={() => {
        void qc.invalidateQueries({ queryKey: ["jobs"] });
        void qc.invalidateQueries({ queryKey: ["taskGroups"] });
        void qc.invalidateQueries({ queryKey: ["runReplay", run.runId] });
        void qc.invalidateQueries({ queryKey: ["run", run.runId] });
      }} /> : paused ? (
        <Button size="sm" variant="primary" loading={recover.isPending} onClick={() => recover.mutate()}>
          从断点续跑
        </Button>
      ) : null}
    </div>
  );
}

function RunRow({
  run,
  expanded,
  onToggle,
}: {
  run: TaskGroupRun;
  expanded: boolean;
  onToggle: () => void;
}) {
  const st = runStatusOf(run.status);
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 10,
        background: "var(--bg)",
        padding: 8,
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          width: "100%",
          background: "transparent",
          border: 0,
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <strong>{run.label || "未命名 run"}</strong>
        <StatusBadge tone={st.tone} label={st.label} />
        {run.approvalState === "waiting" ? <Badge tone="warn">待审批</Badge> : null}
        {run.progressStage ? <span className="faint">{run.progressStage}</span> : null}
        <ProgressBar value={run.progressPct ?? 0} style={{ width: 120 }} />
        <span className="faint">{run.progressPct ?? 0}%</span>
        {(run.attempt ?? 0) > 1 ? <Badge tone="warn">第 {run.attempt} 次</Badge> : null}
      </button>
      <RunActions run={run} />
      {expanded ? <RunTraceTimeline runId={run.runId} /> : null}
    </div>
  );
}

export function RunningTasksPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["taskGroups"],
    queryFn: () => api.listTaskGroups(),
    refetchInterval: 3000,
  });
  const groups = data?.groups ?? [];
  const activeGroups = groups.filter((g) => !GROUP_TERMINAL.has(g.status));
  const historyGroups = groups.filter((g) => GROUP_TERMINAL.has(g.status));
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  const cancelGroup = useMutation({
    mutationFn: (groupId: string) => api.cancelTaskGroup(groupId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["taskGroups"] });
      toast.ok("已取消任务组");
    },
    onError: (e: Error) => toast.fail(e.message),
  });
  const resumeGroup = useMutation({
    mutationFn: (groupId: string) => api.patchTaskGroup(groupId, { status: "running" }),
    onSuccess: async (group) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["taskGroups"] }),
        qc.invalidateQueries({ queryKey: ["jobs"] }),
        ...group.runs.flatMap(({ runId }) => [
          qc.invalidateQueries({ queryKey: ["runReplay", runId] }),
          qc.invalidateQueries({ queryKey: ["run", runId] }),
        ]),
      ]);
      toast.ok("已提交任务组恢复请求");
    },
    onError: (e: Error) => toast.fail(`任务组恢复失败。${e.message}`),
  });

  const isOpen = (g: TaskGroup) => openGroups[g.id] ?? defaultGroupOpen(g);
  const toggleGroup = (g: TaskGroup) =>
    setOpenGroups((p) => ({ ...p, [g.id]: !(p[g.id] ?? defaultGroupOpen(g)) }));
  const toggleRun = (runId: string) =>
    setExpandedRun((prev) => (prev === runId ? null : runId));

  const renderGroup = (g: TaskGroup, faded = false) => {
    const st = statusOf(g);
    const open = isOpen(g);
    const p = g.progress;
    const runs = g.runs ?? [];
    const canTryRecovery = canResumeBatch(g);
    return (
      <li key={g.id} className="daemon-group" style={faded ? { opacity: 0.6 } : undefined}>
        <div className="daemon-group__head">
          <button
            type="button"
            className="daemon-group__toggle"
            onClick={() => toggleGroup(g)}
          >
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <strong>{g.title || g.goal || "未命名任务"}</strong>
            <Badge>{GROUP_KIND_LABELS[g.kind] || g.kind}</Badge>
            <StatusBadge tone={st.tone} label={st.label} />
          </button>
          <ProgressBar value={p.pct} style={{ flex: 1, minWidth: 120 }} />
          <span className="daemon-group__pct">{p.pct}%</span>
          <span className="faint">{fmtTime(g.createdAt)}</span>
          {g.status === "paused" || canTryRecovery ? (
            <Button
              size="sm"
              disabled={resumeGroup.isPending}
              loading={resumeGroup.isPending && resumeGroup.variables === g.id}
              onClick={() => resumeGroup.mutate(g.id)}
            >
              {canTryRecovery ? "尝试恢复未开始任务" : "恢复任务组"}
            </Button>
          ) : null}
          {!GROUP_TERMINAL.has(g.status) ? (
            <Button
              size="sm"
              variant="danger"
              loading={cancelGroup.isPending && cancelGroup.variables === g.id}
              onClick={() => cancelGroup.mutate(g.id)}
            >
              取消
            </Button>
          ) : null}
        </div>
        {open ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "8px 12px 12px",
            }}
          >
            {runs.length === 0 ? (
              <div className="empty">暂无 run</div>
            ) : (
              runs.map((r) => (
                <RunRow
                  key={r.runId}
                  run={r}
                  expanded={expandedRun === r.runId}
                  onToggle={() => toggleRun(r.runId)}
                />
              ))
            )}
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <div className="page page--wide">
      <PageHeader
        title="运行中"
        description="一键补全与后台任务组的实时进度。点开任务组，再点某个 run 展开完整执行轨迹。"
      />
      <Panel>
        {isLoading ? (
          <div className="empty">加载中…</div>
        ) : groups.length === 0 ? (
          <div className="empty">暂无进行中的任务</div>
        ) : (
          <ul className="daemon-tasks__groups">
            {activeGroups.map((g) => renderGroup(g))}
            {historyGroups.length > 0 ? (
              <li className="daemon-group__history-title faint" style={{ fontWeight: 600 }}>
                历史
              </li>
            ) : null}
            {historyGroups.map((g) => renderGroup(g, true))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
