import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  Copy,
  FilePlus2,
  FolderKanban,
  Globe,
  Library,
  PenLine,
  Play,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { toast } from "@xiezuomanju/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, formatLabel } from "../../api/client";
import { runAgentFeedback } from "../studio/runAgentFeedback";

type Command = {
  id: string;
  label: string;
  hint?: string;
  keywords: string;
  icon: LucideIcon;
  run: () => void;
};

const PAGE_COMMANDS: Array<Omit<Command, "run">> = [
  {
    id: "home",
    label: "首页",
    hint: "Dashboard",
    keywords: "首页 主页 home 驾驶舱",
    icon: Sparkles,
  },
  {
    id: "inspiration",
    label: "灵感选题",
    hint: "灵感与选题分析",
    keywords: "灵感 选题 创意 idea inspiration",
    icon: Sparkles,
  },
  {
    id: "projects",
    label: "项目",
    hint: "项目管理",
    keywords: "项目 工程 project",
    icon: FolderKanban,
  },
  {
    id: "dashboard",
    label: "数据看板",
    hint: "选题与交稿进度汇总",
    keywords: "看板 数据 统计 采纳率 用量 dashboard",
    icon: BarChart3,
  },
  {
    id: "studio",
    label: "创作台",
    hint: "九格创作工作台",
    keywords: "创作台 studio 工作台 写作",
    icon: PenLine,
  },
  {
    id: "kb",
    label: "知识库",
    hint: "拆解报告与资料",
    keywords: "知识库 资料 拆解 kb knowledge",
    icon: Library,
  },
  {
    id: "crawler",
    label: "热点采集",
    hint: "公开榜单采集",
    keywords: "热点采集 爬虫 榜单 采集 crawler",
    icon: Globe,
  },
  {
    id: "colleague",
    label: "AI 同事",
    hint: "多 Agent 协作",
    keywords: "同事 agent 助手 智能体 colleague",
    icon: Bot,
  },
  {
    id: "settings",
    label: "设置",
    hint: "模型与系统配置",
    keywords: "设置 配置 模型 偏好 settings",
    icon: Settings,
  },
];

const PAGE_PATH: Record<string, string> = {
  home: "/",
  inspiration: "/inspiration",
  projects: "/projects",
  dashboard: "/dashboard",
  studio: "/studio",
  kb: "/kb",
  crawler: "/kb/crawler",
  colleague: "/colleague",
  settings: "/settings",
};

export function CommandPalette({
  open,
  onOpenChange,
  currentProjectId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentProjectId?: string;
}) {
  const nav = useNavigate();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ["command-projects"],
    queryFn: () => api.listProjects(),
    enabled: open,
    staleTime: 30_000,
  });

  const projectId = currentProjectId;

  const close = () => {
    onOpenChange(false);
    setQuery("");
    setIndex(0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const pageCommands: Command[] = PAGE_COMMANDS.map((c) => ({
      ...c,
      run: () => nav({ to: PAGE_PATH[c.id] as "/" }),
    }));
    const projectCommands: Command[] = projects.slice(0, 12).map((p) => ({
      id: `project-${p.id}`,
      label: p.title,
      hint: `${formatLabel(p.format)} · ${p.stage}`,
      keywords: `项目 ${p.title} ${formatLabel(p.format)} ${p.genreTags.join(" ")}`,
      icon: FolderKanban,
      run: () => {
        nav({ to: "/projects/$id", params: { id: p.id } });
      },
    }));
    const createCommands: Command[] = [
      {
        id: "create-project",
        label: "新建创作项目",
        hint: "开始一个新项目",
        keywords: "新建 创建 项目 create new project",
        icon: FilePlus2,
        run: () => nav({ to: "/projects/new", search: { format: undefined } }),
      },
    ];

    const actionCommands: Command[] = projectId
      ? [
          {
            id: "action-adopt-latest",
            label: "采纳最新候选产物",
            hint: "把最新候选标记为已采纳",
            keywords: "采纳 候选 最新 adopt candidate",
            icon: Check,
            run: async () => {
              try {
                const arts = await api.listArtifacts(projectId);
                const candidate = arts
                  .filter((a) => a.status === "candidate")
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
                if (!candidate) {
                  toast.info("没有待采纳的候选产物");
                  return;
                }
                await api.adoptArtifact(projectId, candidate.id, "strong", candidate.version);
                toast.ok(`已采纳「${candidate.title}」`);
              } catch (e) {
                toast.fail(e instanceof Error ? e.message : "采纳失败");
              }
            },
          },
          {
            id: "action-rollback-snapshot",
            label: "回滚最近快照",
            hint: "恢复到最近一次项目快照",
            keywords: "回滚 快照 恢复 还原 rollback snapshot",
            icon: RotateCcw,
            run: async () => {
              try {
                const snaps = await api.listProjectSnapshots(projectId);
                if (!snaps.length) {
                  toast.info("该项目还没有快照");
                  return;
                }
                await api.restoreProjectSnapshot(projectId, snaps[0].id);
                toast.ok(`已回滚到「${snaps[0].name}」`);
              } catch (e) {
                toast.fail(e instanceof Error ? e.message : "回滚失败");
              }
            },
          },
          {
            id: "action-duplicate",
            label: "复制当前项目",
            hint: "复制项目及其产物",
            keywords: "复制 克隆 项目 duplicate clone",
            icon: Copy,
            run: async () => {
              try {
                const dup = await api.duplicateProject(projectId);
                toast.ok(`已复制为「${dup.title}」`);
                nav({ to: "/projects/$id", params: { id: dup.id } });
              } catch (e) {
                toast.fail(e instanceof Error ? e.message : "复制失败");
              }
            },
          },
          {
            id: "action-run-stage-agent",
            label: "运行当前阶段首个 Agent",
            hint: "执行当前阶段第一个 Agent",
            keywords: "运行 阶段 agent 执行 run stage",
            icon: Play,
            run: async () => {
              try {
                const proj = await api.getProject(projectId);
                const graph = await api.getStageGraph(proj.format);
                const stage =
                  graph.stages.find((s) => s.id === proj.stage) ?? graph.stages[0];
                const agentId = stage?.agentIds?.[0];
                if (!agentId) {
                  toast.info("当前阶段没有可运行的 Agent");
                  return;
                }
                await runAgentFeedback(projectId, agentId, { label: agentId });
              } catch (e) {
                toast.fail(e instanceof Error ? e.message : "运行失败");
              }
            },
          },
        ]
      : [];

    return [...createCommands, ...actionCommands, ...pageCommands, ...projectCommands];
  }, [projects, nav, projectId]);

  const filtered = useMemo(() => {
    const q = query.trim();
    // 自然语言入口：任何非空输入都能直接交给 Personal Agent（静态命令作兜底）。
    const agentCommand: Command | null = q
      ? {
          id: "agent-ask",
          label: `问 Personal Agent：${q}`,
          hint: "自然语言交给主管 agent 规划执行",
          keywords: q,
          icon: Bot,
          run: () => {
            close();
            nav({ to: "/agent", search: { q } });
          },
        }
      : null;
    const ql = q.toLowerCase();
    if (!ql) return agentCommand ? [agentCommand, ...commands] : commands;
    const matched = commands
      .map((c) => {
        const score = `${c.label} ${c.hint ?? ""} ${c.keywords}`.toLowerCase().includes(ql)
          ? c.label.toLowerCase().startsWith(ql)
            ? 0
            : 1
          : 2;
        return { c, score };
      })
      .filter((x) => x.score < 2)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.c);
    return agentCommand ? [agentCommand, ...matched] : matched;
  }, [commands, query, nav]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  const run = (cmd: Command) => {
    close();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = filtered[index];
      if (cmd) run(cmd);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay command-overlay" />
        <Dialog.Content className="command-palette" onOpenAutoFocus={(e) => e.preventDefault()}>
          <div className="command-palette__input">
            <Search size={16} />
            <input
              ref={inputRef}
              value={query}
              placeholder="搜索页面、项目或执行操作…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <kbd>ESC</kbd>
          </div>
          <div className="command-palette__list">
            {filtered.length === 0 ? (
              <div className="command-palette__empty">没有匹配的结果</div>
            ) : (
              filtered.map((cmd, i) => {
                const Icon = cmd.icon;
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    data-active={i === index}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => run(cmd)}
                  >
                    <span className="command-palette__icon">
                      <Icon size={16} />
                    </span>
                    <span className="command-palette__label">{cmd.label}</span>
                    {cmd.hint && <span className="command-palette__hint">{cmd.hint}</span>}
                    {i === index && <ArrowRight size={15} className="command-palette__arrow" />}
                  </button>
                );
              })
            )}
          </div>
          <div className="command-palette__foot">
            <span>
              <kbd>↑↓</kbd> 选择
            </span>
            <span>
              <kbd>↵</kbd> 打开
            </span>
            <span>
              <kbd>⌘K</kbd> 唤起
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
