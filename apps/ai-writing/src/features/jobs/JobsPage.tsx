import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  HelpIcon,
  PageHeader,
  Panel,
  StatusBadge,
  Tabs,
  toast,
} from "@xiezuomanju/ui";
import { RefreshCcw, X } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";

const JOB_STATUS: Record<string, { label: string; tone: "idle" | "running" | "ok" | "warn" | "fail" }> = {
  queued: { label: "排队中", tone: "idle" },
  running: { label: "执行中", tone: "running" },
  succeeded: { label: "成功", tone: "ok" },
  failed: { label: "失败", tone: "fail" },
  cancelled: { label: "已取消", tone: "warn" },
  dead: { label: "已失效", tone: "fail" },
};

function projectName(
  projects: Array<{ id: string; title: string }>,
  id?: string | null,
): string {
  return projects.find((p) => p.id === id)?.title || (id ? `项目 ${id.slice(0, 6)}` : "—");
}

function jobTypeLabel(type: string): string {
  const map: Record<string, string> = {
    "agent.run": "AI 写作",
    "agent.batch": "批量写作",
    "kb.analyze": "分析文档",
    "kb.ingest": "导入知识库",
    "hotspot.refresh": "更新热点",
    "usage.rollup": "统计用量",
  };
  return map[type] || "后台处理";
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    "job.retry": "重新尝试任务",
    "job.cancel": "取消任务",
    "artifact.create": "新建稿件",
    "artifact.update": "修改稿件",
    "provider.save": "保存 AI 服务",
    "memory.write": "修改记忆",
    "memory.put": "修改记忆",
    "memory.delete": "删除记忆",
  };
  if (map[action]) return map[action];
  if (action.startsWith("job.")) return "任务操作";
  if (action.startsWith("artifact.")) return "稿件操作";
  if (action.startsWith("memory.")) return "记忆操作";
  if (action.startsWith("agent.")) return "AI 写作";
  return "系统操作";
}

export function JobsPage() {
  return (
    <div className="page page--wide">
      <PageHeader
        title="任务记录"
        description="查看正在处理、已完成或失败的写作与后台任务。失败的任务可以重试，每次操作都有记录。"
      />
      <JobsHistory />
    </div>
  );
}

export function JobsHistory() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("jobs");
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["jobs"],
    queryFn: () => api.listJobs(),
    refetchInterval: 5000,
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects({}),
  });
  const { data: activity = [] } = useQuery({
    queryKey: ["activity", "page"],
    queryFn: () => api.listActivity(undefined, 80),
    enabled: tab === "audit",
  });

  const retry = useMutation({
    mutationFn: (id: string) => api.retryJob(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      toast.ok("已重新入队");
    },
    onError: (e: Error) => toast.fail(e.message),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelJob(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      toast.ok("已取消");
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  return (
    <>
      <Tabs
        tabs={[
          { id: "jobs", label: `任务 (${jobs.length})` },
          { id: "audit", label: `操作记录 (${activity.length})` },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "jobs" ? (
        <Panel>
          {isLoading ? (
            <div className="empty">加载中…</div>
          ) : jobs.length === 0 ? (
            <div className="empty">还没有任务。开始写作、分析文档或更新热点后，会在这里显示。</div>
          ) : (
            <div className="scroll-region table-scroll-region">
            <table className="table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>状态</th>
                  <th>项目</th>
                  <th>
                    尝试
                    <HelpIcon text="第一次失败后会自动再试，最多尝试次数写在斜杠后面。" />
                  </th>
                  <th>问题</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const st = JOB_STATUS[j.status] ?? { label: j.status, tone: "idle" as const };
                  return (
                    <tr key={j.id}>
                      <td title={j.type}>
                        {jobTypeLabel(j.type)}
                      </td>
                      <td>
                        <StatusBadge tone={st.tone} label={st.label} />
                      </td>
                      <td className="faint" title={j.projectId ?? undefined}>
                        {projectName(projects, j.projectId)}
                      </td>
                      <td className="faint">{j.attempts}/{j.maxAttempts}</td>
                      <td className="muted" style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {j.error ?? "—"}
                      </td>
                      <td className="faint">{new Date(j.createdAt).toLocaleString("zh-CN")}</td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          {j.status === "failed" || j.status === "dead" ? (
                            <Button size="sm" onClick={() => retry.mutate(j.id)}>
                              <RefreshCcw size={13} />
                              重试
                            </Button>
                          ) : null}
                          {j.status === "queued" || j.status === "running" ? (
                            <Button size="sm" variant="ghost" onClick={() => cancel.mutate(j.id)}>
                              <X size={13} />
                              取消
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </Panel>
      ) : (
        <Panel title="操作记录 · 每次改动都可追溯">
          {activity.length === 0 ? (
            <div className="empty">还没有操作记录。</div>
          ) : (
            <div className="scroll-region table-scroll-region">
            <table className="table">
              <thead>
                <tr>
                  <th>谁</th>
                  <th>做了什么</th>
                  <th>详情</th>
                  <th>项目</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Badge>
                        {a.actor === "assistant"
                          ? "AI 助手"
                          : a.actor === "user"
                            ? "用户"
                            : a.actor.startsWith("agent:")
                              ? a.actor.slice(6)
                              : a.actor}
                      </Badge>
                    </td>
                    <td title={a.action}>
                      {actionLabel(a.action)}
                    </td>
                    <td>{a.summary}</td>
                    <td className="faint">{projectName(projects, a.projectId)}</td>
                    <td className="faint">{new Date(a.createdAt).toLocaleString("zh-CN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
