import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ProjectFormat } from "@xiezuomanju/domain";
import { FORMAT_LABELS } from "@xiezuomanju/domain";
import { Button, EmptyBlock, PageHeader, ProgressBar, StatusBadge } from "@xiezuomanju/ui";
import { FolderOpen, Plus } from "lucide-react";
import { useMemo } from "react";
import { api } from "../../api/client";
import { formatCnNumber } from "../../lib/format";
import { stageProgressFor, type StageProgress } from "./stageConfig";

const FORMATS: { format: ProjectFormat; hint: string }[] = [
  { format: "manju", hint: "核心梗 → 小传 → 10 集大纲 → 3 集正文" },
  { format: "duanju", hint: "冲突选题 → 20 节拍 → 卡点 → 分场剧本" },
  { format: "short_novel", hint: "拆书换元 → 章纲 → 成稿 → 去 AI 味" },
  { format: "male_long", hint: "金手指 → 升级循环 → 爽点 → 男频体检" },
  { format: "female_long", hint: "欲望线 → 卷纲 → 节奏 → 女频体检" },
  { format: "ip_adapt", hint: "选书评分 → 单元故事 → 情绪 → 压缩剧本" },
];

function flowText(progress: StageProgress) {
  return progress.done
    ? `流程已完成 · ${progress.total}/${progress.total} 步`
    : `${progress.label} · 第 ${progress.index + 1}/${progress.total} 步`;
}

export function StudioHubPage() {
  const nav = useNavigate();
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });
  const recent = [...projects]
    .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
    .slice(0, 10);
  const stats = useMemo(() => {
    const active = projects.filter((project) => project.status === "active").length;
    const flowDone = projects.filter(
      (project) => stageProgressFor(project.format, project.stage).done,
    ).length;
    const tokens = projects.reduce((sum, project) => sum + project.tokenUsed, 0);
    return { active, flowDone, tokens };
  }, [projects]);

  return (
    <div className="page page--wide studio-hub">
      <PageHeader
        title="创作台"
        description="从项目继续写作，或选择作品格式开始创作。"
        actions={
          <Button
            variant="primary"
            onClick={() => nav({ to: "/projects/new", search: { format: undefined } })}
          >
            <Plus size={15} />
            新建项目
          </Button>
        }
      />

      <div className="project-stat-strip" aria-label="创作台概览">
        <span><strong>{projects.length}</strong> 个项目</span>
        <span><strong>{stats.active}</strong> 进行中</span>
        <span><strong>{stats.flowDone}</strong> 流程完成</span>
        <span title={stats.tokens.toLocaleString()}><strong>{formatCnNumber(stats.tokens)}</strong> AI 用量</span>
        <span className="project-stat-strip__note">
          流程完成 ≠ 交稿完成；交稿主线按真实采纳物计算。
        </span>
      </div>

      <div className="studio-hub-grid">
        {FORMATS.map(({ format, hint }) => {
          const formatProjects = projects.filter((project) => project.format === format);
          const latest = [...formatProjects].sort((a, b) =>
            b.lastOpenedAt.localeCompare(a.lastOpenedAt),
          )[0];
          return (
            <section key={format} className="studio-hub-format">
              <div className="studio-hub-format__head">
                <div>
                  <strong>{FORMAT_LABELS[format]}</strong>
                  <span>{hint}</span>
                </div>
                <StatusBadge
                  tone={formatProjects.length ? "running" : "idle"}
                  label={`${formatProjects.length} 项`}
                />
              </div>
              {latest ? (
                <button
                  type="button"
                  className="studio-hub-format__latest"
                  onClick={() =>
                    nav({
                      to: "/studio/$format",
                      params: { format },
                      search: { projectId: latest.id },
                    })
                  }
                >
                  <span className="studio-hub-format__latest-title">{latest.title}</span>
                  <span className="studio-hub-format__latest-meta">
                    {flowText(stageProgressFor(format, latest.stage))}
                  </span>
                  <ProgressBar value={stageProgressFor(format, latest.stage).pct} />
                </button>
              ) : (
                <p className="studio-hub-format__empty">还没有项目，按这条流程从 0 开始。</p>
              )}
              <div className="studio-hub-format__actions">
                {latest ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      nav({
                        to: "/studio/$format",
                        params: { format },
                        search: { projectId: latest.id },
                      })
                    }
                  >
                    继续创作
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant={latest ? "ghost" : "primary"}
                  onClick={() => nav({ to: "/projects/new", search: { format } })}
                >
                  新建{FORMAT_LABELS[format]}
                </Button>
              </div>
            </section>
          );
        })}
      </div>

      <section className="home-section">
        <div className="home-section__head">
          <div>
            <h2>最近项目</h2>
            <p>项目属于哪种格式，就进入对应流程；不会自动切换题材。</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => nav({ to: "/projects" })}>
            全部项目
          </Button>
        </div>
        {!isLoading && !recent.length ? (
          <EmptyBlock
            icon={FolderOpen}
            title="还没有项目"
            description="从上方选择格式，或先到灵感选题工作台。"
            action={
              <Button
                variant="primary"
                onClick={() => nav({ to: "/projects/new", search: { format: undefined } })}
              >
                新建项目
              </Button>
            }
          />
        ) : (
          <div className="studio-hub-projects">
            {recent.map((project) => {
              const progress = stageProgressFor(project.format, project.stage);
              return (
                <button
                  key={project.id}
                  type="button"
                  className="studio-hub-project"
                  onClick={() =>
                    nav({
                      to: "/studio/$format",
                      params: { format: project.format },
                      search: { projectId: project.id },
                    })
                  }
                >
                  <span className="studio-hub-project__mark" data-format={project.format}>
                    {project.title.slice(0, 1)}
                  </span>
                  <span className="studio-hub-project__body">
                    <span className="studio-hub-project__title">{project.title}</span>
                    <span className="studio-hub-project__meta">
                      {FORMAT_LABELS[project.format]} · {flowText(progress)}
                    </span>
                    <ProgressBar value={progress.pct} />
                  </span>
                  <span className="studio-hub-project__pct">
                    {progress.done ? "流程完成" : "继续"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
