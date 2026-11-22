import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Button,
  Card,
  ConfirmDialog,
  PageHeader,
  ProgressBar,
  StatusBadge,
  Toolbar,
  ViewToggle,
  toast,
} from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { Download, LayoutGrid, List, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { api, formatLabel } from "../../api/client";
import { EmptyState } from "../../components/motion";
import { formatCnNumber } from "../../lib/format";
import { stageProgressFor, stageProgressText } from "../studio/stageConfig";
import { ProjectSnapshotsDrawer } from "./ProjectSnapshotsDrawer";

const STATUS_LABEL: Record<string, string> = {
  active: "进行中",
  paused: "已暂停",
  archived: "已归档",
  submitted: "已投稿",
};

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins < 1 ? "刚刚" : `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return new Date(iso).toLocaleDateString();
}

/** 截止日临近/逾期提示：逾期红、3 天内橙，否则无。 */
export function deadlineInfo(
  deadline?: string,
): { label: string; tone: "fail" | "warn" | "idle" } | null {
  if (!deadline) return null;
  const due = new Date(deadline).getTime();
  if (Number.isNaN(due)) return null;
  const days = (due - Date.now()) / 86400000;
  if (days < 0) return { label: `已逾期 ${Math.ceil(-days)} 天`, tone: "fail" };
  if (days < 3) return { label: `剩 ${Math.max(0, Math.ceil(days))} 天`, tone: "warn" };
  return { label: `截止 ${deadline}`, tone: "idle" };
}

export function ProjectsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [format, setFormat] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"updated" | "opened" | "title">("updated");
  const [view, setView] = useState<"card" | "list">("card");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [snapProjectId, setSnapProjectId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const exportAll = async () => {
    setExporting(true);
    try {
      const projects = await api.listProjects();
      const withArtifacts = await Promise.all(
        projects.map(async (p) => ({ ...p, artifacts: await api.listArtifacts(p.id) })),
      );
      const payload = {
        exportedAt: new Date().toISOString(),
        projectCount: withArtifacts.length,
        projects: withArtifacts,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "xiezuomanju-projects-export.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.ok(`已导出 ${withArtifacts.length} 个项目`);
    } catch (e) {
      toast.fail(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const { data = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["projects", format, status, q],
    queryFn: () =>
      api.listProjects({
        format: format || undefined,
        status: status || undefined,
        q: q || undefined,
      }),
  });

  const sorted = useMemo(() => {
    const list = [...data];
    list.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title, "zh");
      if (sort === "opened") return b.lastOpenedAt.localeCompare(a.lastOpenedAt);
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    return list;
  }, [data, sort]);

  const stats = useMemo(() => {
    const active = data.filter((item) => item.status === "active").length;
    const flowDone = data.filter(
      (item) => stageProgressFor(item.format, item.stage).done,
    ).length;
    const tokens = data.reduce((sum, item) => sum + item.tokenUsed, 0);
    return { active, flowDone, tokens };
  }, [data]);

  const urgentDeadlines = useMemo(() => {
    const rank = (t: string) => (t === "fail" ? 0 : 1);
    return data
      .map((p) => ({ project: p, info: deadlineInfo(p.coverMeta.deadline) }))
      .filter((x) => x.info && x.info.tone !== "idle")
      .sort((a, b) => rank(a.info!.tone) - rank(b.info!.tone));
  }, [data]);

  const del = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.ok("项目已删除");
    },
    onError: () => toast.fail("删除失败"),
  });

  return (
    <div className="page page--wide">
      <PageHeader
        title="项目管理"
        description="管理创作项目、进度与投稿状态"
        actions={
          <div className="row" style={{ gap: 8 }}>
            <Button
              variant="ghost"
              disabled={exporting}
              onClick={() => void exportAll()}
            >
              <Download size={15} />
              {exporting ? "导出中…" : "导出全部"}
            </Button>
            <Button
              variant="primary"
              onClick={() => nav({ to: "/projects/new", search: { format: undefined } })}
            >
              <Plus size={15} />
              新建项目
            </Button>
          </div>
        }
      />

      <div className="project-stat-strip" aria-label="项目概览">
        <span><strong>{data.length}</strong> 个项目</span>
        <span><strong>{stats.active}</strong> 进行中</span>
        <span><strong>{stats.flowDone}</strong> 流程完成</span>
        <span><strong>{stats.tokens.toLocaleString()}</strong> AI 用量</span>
        <span className="project-stat-strip__note">
          流程完成不等于交稿齐全，进入创作台核对「交稿主线」。
        </span>
      </div>

      {urgentDeadlines.length > 0 && (
        <div
          className="help-callout help-callout--warn deadline-alert"
          style={{ marginBottom: 12 }}
        >
          <div className="help-callout__title">截止提醒</div>
          {urgentDeadlines.map(({ project, info }) => (
            <div
              key={project.id}
              style={{ color: info!.tone === "fail" ? "var(--danger)" : "var(--warn)" }}
            >
              《{project.title}》 {info!.label}
            </div>
          ))}
        </div>
      )}

      <Toolbar>
        <input
          className="input"
          placeholder="搜索标题 / 题材"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select className="select" value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="">全部格式</option>
          <option value="manju">漫剧</option>
          <option value="duanju">短剧</option>
          <option value="short_novel">短篇</option>
          <option value="male_long">男频中长篇</option>
          <option value="female_long">女频中长篇</option>
          <option value="ip_adapt">IP 改编</option>
        </Select>
        <Select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          <option value="active">进行中</option>
          <option value="paused">暂停</option>
          <option value="archived">已归档</option>
          <option value="submitted">已投稿</option>
        </Select>
        <Select
          className="select"
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          <option value="updated">最近更新</option>
          <option value="opened">最近打开</option>
          <option value="title">按标题</option>
        </Select>
        <ViewToggle
          value={view}
          onChange={(v) => setView(v as "card" | "list")}
          options={[
            { id: "card", label: "卡片", icon: LayoutGrid },
            { id: "list", label: "列表", icon: List },
          ]}
        />
      </Toolbar>

      <div className="projects-results scroll-region list-scroll-region">
      {isLoading && <div className="empty">加载中…</div>}

      {!isLoading && isError && (
        <div className="empty" style={{ gap: 8 }}>
          <div>项目列表加载失败（本地服务可能刚重启）。</div>
          <Button variant="primary" onClick={() => void refetch()} loading={isFetching}>
            重新加载
          </Button>
        </div>
      )}

      {!isLoading && !isError && !sorted.length && (
        <EmptyState
          icon={<Plus size={26} />}
          title="还没有项目"
          description="选择题材新建，或从灵感选题开始。"
          action={
            <Button
              variant="primary"
              onClick={() => nav({ to: "/projects/new", search: { format: undefined } })}
            >
              新建项目
            </Button>
          }
        />
      )}

      {!isLoading && view === "card" && sorted.length > 0 && (
        <div className="card-grid card-grid--projects">
            {sorted.map((p) => {
              const prog = stageProgressFor(p.format, p.stage);
            return (
              <Card key={p.id} className="project-card">
                <div
                  className="project-card__top"
                  style={{ cursor: "pointer" }}
                  onClick={() => nav({ to: "/projects/$id", params: { id: p.id } })}
                >
                  <div className="project-card__mark" data-format={p.format}>
                    {p.title.slice(0, 1)}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="project-card__title">{p.title}</div>
                    <div className="project-card__meta">
                      <span className="badge">{formatLabel(p.format)}</span>
                      <StatusBadge
                        tone={
                          p.status === "active"
                            ? "running"
                            : p.status === "paused"
                              ? "warn"
                              : p.status === "submitted"
                                ? "ok"
                                : "idle"
                        }
                        label={STATUS_LABEL[p.status] ?? p.status}
                      />
                    </div>
                    {(p.coverMeta.deadline ||
                      p.coverMeta.targetWords != null ||
                      p.coverMeta.platform) && (
                      <div className="faint" style={{ fontSize: "var(--fs-2xs)", marginTop: 4 }}>
                        {p.coverMeta.targetWords != null
                          ? `目标 ${Number(p.coverMeta.targetWords).toLocaleString()} 字`
                          : ""}
                        {p.coverMeta.platform ? ` · ${p.coverMeta.platform}` : ""}
                        {p.budgetTokens ? ` · 用量上限 ${p.budgetTokens.toLocaleString()}` : ""}
                      </div>
                    )}
                    {(() => {
                      const d = deadlineInfo(p.coverMeta.deadline);
                      if (!d) return null;
                      const color =
                        d.tone === "fail"
                          ? "var(--danger)"
                          : d.tone === "warn"
                            ? "var(--warn)"
                            : "var(--faint)";
                      return (
                        <div
                          className="row"
                          style={{ gap: 4, marginTop: 4, fontSize: "var(--fs-2xs)", color }}
                        >
                          {d.label}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                <div>
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                    <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                      {prog.done ? "流程已完成" : prog.label}
                    </span>
                    <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                      {prog.done ? `${prog.total}/${prog.total} 步` : `第 ${prog.index + 1}/${prog.total} 步`}
                    </span>
                  </div>
                  <ProgressBar value={prog.pct} />
                </div>
                <div className="project-card__foot">
                  <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                    {relativeTime(p.updatedAt)} ·{" "}
                    <span title={`${p.tokenUsed.toLocaleString()} tokens`}>
                      AI 用量 {formatCnNumber(p.tokenUsed)}
                    </span>
                  </span>
                  <div className="row" style={{ gap: 4 }}>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => nav({ to: "/projects/$id", params: { id: p.id } })}
                    >
                      打开
                    </Button>
                  </div>
                  <div className="row project-card__actions" style={{ gap: 4 }}>
                    <Button
                      size="sm"
                      onClick={() => {
                        const next = p.status === "archived" ? "active" : "archived";
                        void api.patchProject(p.id, { status: next }).then(() => {
                          qc.invalidateQueries({ queryKey: ["projects"] });
                          toast.ok(next === "archived" ? "已归档" : "已恢复");
                        });
                      }}
                    >
                      {p.status === "archived" ? "恢复" : "归档"}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setDeleteId(p.id)}>
                      删除
                    </Button>
                    <Button size="sm" onClick={() => setSnapProjectId(p.id)}>
                      快照
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {!isLoading && view === "list" && sorted.length > 0 && (
        <div className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>标题</th>
                <th>格式</th>
                <th>进度</th>
                <th>当前阶段</th>
                <th>AI 用量</th>
                <th>状态</th>
                <th>更新</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const prog = stageProgressFor(p.format, p.stage);
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.title}</td>
                    <td>{formatLabel(p.format)}</td>
                    <td style={{ minWidth: 140 }}>
                      <ProgressBar value={prog.pct} />
                      <div className="faint" style={{ fontSize: "var(--fs-2xs)", marginTop: 4 }}>
                        {stageProgressText(prog)}
                      </div>
                    </td>
                    <td className="muted">{prog.label}</td>
                    <td className="muted">{p.tokenUsed.toLocaleString()}</td>
                    <td>
                      <StatusBadge
                        tone={p.status === "active" ? "running" : "idle"}
                        label={STATUS_LABEL[p.status] ?? p.status}
                      />
                    </td>
                    <td className="faint">{relativeTime(p.updatedAt)}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <Button
                          size="sm"
                          onClick={() => nav({ to: "/projects/$id", params: { id: p.id } })}
                        >
                          打开
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setDeleteId(p.id)}>
                          删除
                        </Button>
                        <Button size="sm" onClick={() => setSnapProjectId(p.id)}>
                          快照
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </div>

      <ConfirmDialog
        open={!!deleteId}
        title="删除项目？"
        description="将删除项目及其产物，不可恢复。"
        danger
        confirmLabel="删除"
        onOpenChange={(o) => !o && setDeleteId(null)}
        onConfirm={() => deleteId && del.mutate(deleteId)}
      />
      <ProjectSnapshotsDrawer projectId={snapProjectId} onClose={() => setSnapProjectId(null)} />
    </div>
  );
}
