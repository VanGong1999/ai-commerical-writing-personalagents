import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ProjectFormat } from "@xiezuomanju/domain";
import { FORMAT_LABELS } from "@xiezuomanju/domain";
import {
  AgentTimeline,
  Button,
  Card,
  EmptyBlock,
  ProgressBar,
  StatusBadge,
  toast,
} from "@xiezuomanju/ui";
import {
  ArrowRight,
  Flame,
  FolderOpen,
  Lightbulb,
  PenLine,
  Plus,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, formatLabel } from "../../api/client";
import { runAgentFeedback } from "../studio/runAgentFeedback";
import { stageProgressFor } from "../studio/stageConfig";
import { WorkflowMap } from "./WorkflowMap";

const CTAS: { format: ProjectFormat; desc: string }[] = [
  { format: "manju", desc: "核心梗 → 小传 → 大纲 → 正文 → 交稿" },
  { format: "duanju", desc: "冲突选题 → 节拍 → 卡点 → 剧本" },
  { format: "short_novel", desc: "拆书参数 → 换元 → 总纲 → 章纲细纲 → 初稿" },
  { format: "male_long", desc: "金手指 → 升级循环 → 爽点" },
  { format: "female_long", desc: "追妻火葬场 → 卷纲 → 留存" },
  { format: "ip_adapt", desc: "选书 → 单元情绪 → 压缩" },
];

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString();
}

function greetingFor(hour: number) {
  if (hour < 6) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export function HomePage() {
  const nav = useNavigate();
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });
  const { data: activity = [] } = useQuery({
    queryKey: ["activity"],
    queryFn: () => api.listActivity(undefined, 12),
  });

  const active = projects.filter((p) => p.status === "active");
  const recent = [...projects]
    .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
    .slice(0, 6);
  const last = recent[0];
  const [todayGoals, setTodayGoals] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("today-goals") || "[]");
    } catch {
      return [];
    }
  });
  const [greetingIndex, setGreetingIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setGreetingIndex((index) => index + 1);
    }, 4500);
    return () => window.clearInterval(timer);
  }, []);

  const penName = useMemo(() => {
    try {
      const settings = JSON.parse(localStorage.getItem("xmj-settings") || "{}") as {
        penName?: string;
      };
      return settings.penName?.trim() || "VanGong";
    } catch {
      return "VanGong";
    }
  }, []);
  const greeting = greetingFor(new Date().getHours());
  const greetingLines = useMemo(() => {
    const lines = [
      active.length
        ? `你有 ${active.length} 个项目正在推进，今天先完成最小的一步。`
        : "从一个小灵感开始，今天就能建立第一个创作项目。",
      last
        ? `上次写到《${last.title}》，可以用几分钟接着往下推进。`
        : "还没有草稿，先选题材或从热点里找一个值得写的故事。",
      todayGoals.length
        ? `今日目标已经准备好：先完成「${todayGoals[0]}」。`
        : "点右侧「整理 3 条」，让 AI 把今天要做的事拆小。",
      "不必一次写完，定一个小目标、改好一个场景，也算完成今天的创作。",
    ];
    return lines;
  }, [active.length, last, todayGoals]);
  const greetingLine = greetingLines[greetingIndex % greetingLines.length];

  const genGoals = useMutation({
    mutationFn: async () => {
      if (!last?.id) throw new Error("请先有一个项目");
      let out = "";
      await runAgentFeedback(last.id, "mem.curator", {
        label: "mem.curator",
        inputJson: { project: last.title, stage: last.stage },
        onEvent: (ev) => {
          const t =
            (typeof ev.token === "string" && ev.token) ||
            (typeof ev.text === "string" && ev.text) ||
            "";
          if (t) out += t;
        },
      });
      // 解析 curator YAML 契约里的 goals[].title；失败回退模板
      const titles = [...out.matchAll(/^\s*-\s*title:\s*(.+)$/gm)].map((m) =>
        m[1].trim(),
      );
      const goals =
        titles.length >= 3
          ? titles.slice(0, 3)
          : [
              `推进「${last.title}」当前步骤一步`,
              "人工确认一处大纲/人设闸",
              "校对一集去 AI 味清单",
            ];
      setTodayGoals(goals);
      localStorage.setItem("today-goals", JSON.stringify(goals));
      return goals;
    },
    onSuccess: () => toast.ok("已生成今日 3 条小目标"),
    onError: (e: Error) => toast.fail(e.message),
  });

  return (
    <div className="page page--wide">
      <section className="home-hero home-hero--dashboard">
        <div className="home-welcome">
          <div className="home-hero__brand">
            <Sparkles size={13} />
            AI 商业写作台 · 九格方法论
          </div>
          <h1>
            {greeting}，{penName}
          </h1>
          <p className="home-hero__lead home-welcome__rotator" key={greetingIndex}>
            {greetingLine}
          </p>
          <div className="home-quick-actions" aria-label="常用操作">
            <button
              type="button"
              className="home-quick-action home-quick-action--primary"
              onClick={() => nav({ to: "/projects/new", search: { format: undefined } })}
            >
              <span className="home-quick-action__icon"><Plus size={17} /></span>
              <span>
                <strong>新建项目</strong>
                <small>选一个题材开始写</small>
              </span>
              <ArrowRight size={15} />
            </button>
            {last ? (
              <button
                type="button"
                className="home-quick-action"
                onClick={() => nav({ to: "/projects/$id", params: { id: last.id } })}
              >
                <span className="home-quick-action__icon"><PenLine size={16} /></span>
                <span>
                  <strong>继续上次</strong>
                  <small>{last.title}</small>
                </span>
                <ArrowRight size={15} />
              </button>
            ) : (
              <button
                type="button"
                className="home-quick-action"
                onClick={() => nav({ to: "/studio" })}
              >
                <span className="home-quick-action__icon"><PenLine size={16} /></span>
                <span>
                  <strong>进创作台</strong>
                  <small>先熟悉创作流程</small>
                </span>
                <ArrowRight size={15} />
              </button>
            )}
            <button
              type="button"
              className="home-quick-action"
              onClick={() => nav({ to: "/inspiration" })}
            >
              <span className="home-quick-action__icon"><Lightbulb size={16} /></span>
              <span>
                <strong>找灵感</strong>
                <small>从选题和桥段开始</small>
              </span>
              <ArrowRight size={15} />
            </button>
            <button
              type="button"
              className="home-quick-action"
              onClick={() => nav({ to: "/kb/hotspots" })}
            >
              <span className="home-quick-action__icon"><Flame size={16} /></span>
              <span>
                <strong>看热点</strong>
                <small>找最近值得写的题材</small>
              </span>
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
        <Card className="home-goal-card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <strong>今日目标</strong>
              <div className="home-goal-card__hint">只做今天能完成的小事</div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={!last || genGoals.isPending}
              onClick={() => genGoals.mutate()}
            >
              {genGoals.isPending ? "生成中…" : "整理 3 条"}
            </Button>
          </div>
          {todayGoals.length ? (
            <ol className="home-goal-list">
              {todayGoals.map((g, index) => (
                <li key={`${index}-${g}`}>
                  <span>{index + 1}</span>
                  <p>{g}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted home-goal-card__empty">
              小而具体：例如「改完第 3 集钩子」「确认人物小传」。点「整理 3 条」，AI 会帮你拆成今天能完成的小目标。
            </p>
          )}
          <div className="home-goal-stats">
            <div className="home-goal-stat">
              <span className="home-goal-stat__value">{isLoading ? "—" : active.length}</span>
              <span className="home-goal-stat__label">进行中</span>
            </div>
            <div className="home-goal-stat">
              <span className="home-goal-stat__value">{isLoading ? "—" : projects.length}</span>
              <span className="home-goal-stat__label">全部项目</span>
            </div>
          </div>
        </Card>
      </section>

      <section className="home-section">
        <div className="home-section__head">
          <div>
            <h2>最近创作</h2>
            <p>继续未完成的项目，一键进入创作台</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => nav({ to: "/projects" })}>
            查看全部
          </Button>
        </div>
        {recent.length === 0 && !isLoading ? (
          <EmptyBlock
            icon={FolderOpen}
            title="还没有项目"
            description="新建一个创作项目，或从灵感选题开始。"
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
          <div className="card-grid">
            {recent.map((p) => {
              const progress = stageProgressFor(p.format, p.stage);
              return (
                <Card
                  key={p.id}
                  interactive
                  className="project-card"
                  onClick={() => nav({ to: "/projects/$id", params: { id: p.id } })}
                >
                  <div className="project-card__top">
                    <div className="project-card__mark" data-format={p.format}>
                      {p.title.slice(0, 1)}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="project-card__title">{p.title}</div>
                      <div className="project-card__meta">
                        <span className="badge">{formatLabel(p.format)}</span>
                        {p.coverMeta?.benchmark ? (
                          <span className="badge" title="对标书">
                            {p.coverMeta.benchmark}
                          </span>
                        ) : null}
                        <StatusBadge
                          tone={p.status === "active" ? "running" : "idle"}
                          label={p.status === "active" ? "进行中" : p.status}
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                      <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                        {progress.done ? "流程已完成" : progress.label}
                      </span>
                      <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                        {progress.done
                          ? `${progress.total}/${progress.total} 步`
                          : `第 ${progress.index + 1}/${progress.total} 步`}
                      </span>
                    </div>
                    <ProgressBar value={progress.pct} />
                  </div>
                  <div className="project-card__foot">
                    <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                      {relativeTime(p.lastOpenedAt || p.updatedAt)}
                    </span>
                    <span className="badge badge-accent">继续创作</span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="home-section">
        <div className="home-section__head">
          <div>
            <h2>创作流程</h2>
            <p>九格路径一览，点击进入对应能力</p>
          </div>
        </div>
        <WorkflowMap />
      </section>

      {activity.length > 0 && (
        <section className="home-section">
          <div className="home-section__head">
            <div>
              <h2>最近动态</h2>
              <p>谁在什么时候对什么做了什么</p>
            </div>
          </div>
          <div className="panel">
            <div className="panel__body">
              <AgentTimeline
                items={activity.map((a) => ({
                  id: a.id,
                  title: a.summary,
                  detail: `${a.actor} · ${a.action}${a.projectId ? ` · ${a.projectId.slice(0, 8)}` : ""}`,
                  time: relativeTime(a.createdAt),
                  tone:
                    a.action === "adopt" || a.action === "artifact_create"
                      ? "ok"
                      : a.action.includes("fail") || a.action.includes("error")
                        ? "fail"
                        : "idle",
                }))}
              />
            </div>
          </div>
        </section>
      )}

      <section className="home-section">
        <div className="home-section__head">
          <div>
            <h2>按题材开写</h2>
            <p>不同格式对应不同工作流</p>
          </div>
        </div>
        <div className="cta-grid">
          {CTAS.map((c) => (
            <button
              key={c.format}
              type="button"
              className="cta-tile"
              onClick={() => void nav({ to: "/projects/new", search: { format: c.format } })}
            >
              <strong>{FORMAT_LABELS[c.format]}</strong>
              <span>{c.desc}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
