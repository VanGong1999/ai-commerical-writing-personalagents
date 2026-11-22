import { REFERENCE_EVENT } from "../features/references/selection";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Suspense, useEffect, useState } from "react";
import { PolicyBanner } from "../features/studio/PolicyBanner";
import { Button, HelpProvider, ToastProvider } from "@xiezuomanju/ui";
import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  Brain,
  ClipboardCheck,
  Coins,
  Flame,
  FolderKanban,
  Globe,
  Home,
  Library,
  Lightbulb,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeft,
  PenLine,
  Server,
  Settings,
  Sparkles,
  Sun,
  Users,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { AssistantPanel } from "../features/assistant/AssistantPanel";
import { CommandPalette } from "../features/assistant/CommandPalette";
import { useDaemonNotifications } from "../features/agent/useDaemonNotifications";

type NavItem = {
  to: string;
  label: string;
  match?: string;
  icon: LucideIcon;
  hint?: string;
};

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "创作",
    items: [
      { to: "/", label: "首页", match: "/", icon: Home },
      { to: "/agent", label: "Agent 工作台", icon: Bot, hint: "自然语言指挥你的 Personal Agent" },
      { to: "/inspiration", label: "灵感选题", icon: Lightbulb },
      { to: "/projects", label: "项目", icon: FolderKanban },
      { to: "/studio", label: "创作台", match: "/studio", icon: PenLine },
    ],
  },
  {
    title: "知识库",
    items: [
      { to: "/kb", label: "知识库", icon: Library },
      { to: "/kb/tropes", label: "桥段库", icon: BookOpen },
      { to: "/kb/hotspots", label: "热点榜单", icon: Flame },
      { to: "/kb/crawler", label: "热点采集", icon: Globe, hint: "从公开榜单找热门题材" },
    ],
  },
  {
    title: "管理",
    items: [
      { to: "/prompts", label: "写作指令", icon: Sparkles, hint: "告诉 AI 这一次具体怎么写" },
      { to: "/skills", label: "助手方法", icon: Workflow, hint: "了解每位 AI 助手怎么工作" },
      { to: "/colleague", label: "AI 同事", icon: Users, hint: "具名同事、群聊与技能" },
      { to: "/tokens", label: "AI 用量", icon: Coins, hint: "查看用量和大概费用" },
      { to: "/dashboard", label: "数据看板", icon: BarChart3, hint: "选题与交稿进度、采纳率、用量" },
      {
        to: "/eval",
        label: "质量评测",
        icon: ClipboardCheck,
        hint: "评分细则、黄金集/错题集、回归门禁与 Case 池",
      },
      { to: "/memory", label: "写作记忆", icon: Brain, hint: "保存人物、设定和写作要点" },
      { to: "/settings", label: "设置", icon: Settings },
    ],
  },
];

function crumbFor(pathname: string): string {
  if (pathname === "/") return "首页";
  if (pathname.startsWith("/projects/new")) return "项目 / 新建";
  if (pathname.startsWith("/projects")) return "项目";
  if (pathname.startsWith("/studio")) return "创作台";
  if (pathname.startsWith("/kb/tropes")) return "知识库 / 桥段库";
  if (pathname.startsWith("/kb/hotspots")) return "知识库 / 热点榜单";
  if (pathname.startsWith("/kb/crawler")) return "知识库 / 热点采集";
  if (pathname.startsWith("/kb")) return "知识库";
  if (pathname.startsWith("/inspiration")) return "灵感选题";
  if (pathname.startsWith("/prompts")) return "写作指令";
  if (pathname.startsWith("/skills")) return "助手方法";
  if (pathname.startsWith("/colleague") || pathname.startsWith("/bots")) return "AI 同事";
  if (pathname.startsWith("/routines")) return "AI 同事";
  if (pathname.startsWith("/tokens")) return "AI 用量";
  if (pathname.startsWith("/jobs")) return "任务记录";
  if (pathname.startsWith("/runs")) return "运行中";
  if (pathname.startsWith("/dashboard")) return "数据看板";
  if (pathname.startsWith("/eval")) return "质量评测";
  if (pathname.startsWith("/memory")) return "写作记忆";
  if (pathname.startsWith("/settings")) return "设置";
  if (pathname.startsWith("/agent")) return "Agent 工作台";
  return "";
}

export function AppShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchParams = useRouterState({ select: (s) => s.location.search });
  const nav = useNavigate();
  const projectPath = pathname.match(/^\/projects\/(?!new(?:\/|$))([^/]+)/);
  const routeProjectId = projectPath?.[1] ?? (searchParams as { projectId?: string } | undefined)?.projectId;
  const isStudio = pathname.startsWith("/studio");
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem("xmj-theme") as "light" | "dark") || "light",
  );
  const [compactPref, setCompactPref] = useState(
    () => localStorage.getItem("xmj-nav-compact-pref") === "1",
  );
  const compact = isStudio ? true : compactPref;
  const [navOpen, setNavOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth > 820,
  );
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const { summary, assistantUnread, clearAssistantUnread } = useDaemonNotifications({
    enableDesktop: true,
  });

  useEffect(() => {
    const open = () => setAssistantOpen(true);
    window.addEventListener(REFERENCE_EVENT, open);
    return () => window.removeEventListener(REFERENCE_EVENT, open);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("xmj-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("xmj-nav-compact-pref", compactPref ? "1" : "0");
  }, [compactPref]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("xmj-settings");
      const density =
        (raw ? (JSON.parse(raw) as { density?: string }).density : null) || "compact";
      document.documentElement.dataset.density = density;
    } catch {
      document.documentElement.dataset.density = "compact";
    }
  }, [pathname]);

  return (
    <HelpProvider>
      <ToastProvider>
        <div
          className="app-shell"
          data-compact={compact ? "true" : "false"}
          data-nav-open={navOpen ? "true" : "false"}
          data-studio={isStudio ? "true" : "false"}
        >
          {navOpen ? (
            <button
              type="button"
              className="app-nav__backdrop"
              aria-label="关闭导航"
              onClick={() => setNavOpen(false)}
            />
          ) : null}
          <nav className="app-nav">
            <div className="app-nav__brand">
              <span className="logo-mark">九</span>
              <div>
                AI 商业写作台
                <span>九格方法论 · 多形态写作</span>
              </div>
            </div>
            {NAV_GROUPS.map((group) => (
              <div key={group.title}>
                <div className="app-nav__group">{group.title}</div>
                {group.items.map((item) => {
                  const base = item.match ?? item.to;
                  const active =
                    base === "/"
                      ? pathname === "/"
                      : pathname === base || pathname.startsWith(`${base}/`);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to as "/"}
                      title={item.hint ?? item.label}
                      data-active={active}
                      onClick={() => {
                        if (window.innerWidth <= 820) setNavOpen(false);
                      }}
                    >
                      <span className="nav-icon">
                        <Icon size={16} />
                      </span>
                      <span className="nav-label">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
            <div className="divider" style={{ marginTop: "auto" }} />
            <Button
              variant="ghost"
              size="sm"
              className="app-nav__theme"
              onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
            >
              {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
              <span className="app-nav__theme-label">
                {theme === "light" ? "深色" : "浅色"}
              </span>
            </Button>
          </nav>
          <div className="app-main">
            <header className="app-header">
              <div className="app-header__left">
                <Button
                  variant="ghost"
                  size="sm"
                  className="app-nav__mobile-toggle"
                  aria-label="菜单"
                  onClick={() => setNavOpen((v) => !v)}
                >
                  {navOpen ? <X size={16} /> : <Menu size={16} />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={compact ? "展开导航" : "收起导航"}
                  onClick={() => setCompactPref((v) => !v)}
                >
                  {compact ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
                </Button>
                <div className="app-header__titles">
                  <span className="app-header__kicker">AI 商业写作台</span>
                  <span className="app-header__crumb">{crumbFor(pathname)}</span>
                </div>
              </div>
              <div className="app-header__right">
                <Link
                  to="/runs"
                  className="daemon-capsule"
                  style={{ position: "relative" }}
                  title="运行中任务组"
                >
                  <Activity size={13} />
                  <span>运行任务</span>
                  {summary.activeGroups > 0 ? (
                    <span
                      style={{
                        position: "absolute",
                        top: -6,
                        right: -6,
                        minWidth: 18,
                        height: 18,
                        padding: "0 4px",
                        borderRadius: 999,
                        background: "var(--danger, #c46d70)",
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 700,
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      {summary.activeGroups > 9 ? "9+" : summary.activeGroups}
                    </span>
                  ) : null}
                </Link>
                <button
                  type="button"
                  className="daemon-capsule"
                  title="打开守护任务中心"
                  onClick={() => void nav({ to: "/agent", search: { view: "tasks" } })}
                >
                  <Server size={13} />
                  <span>
                    运行中 {summary.running}
                    {summary.waitingApproval > 0 ? ` · 待审批 ${summary.waitingApproval}` : ""}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="app-header__command"
                  onClick={() => setCommandOpen(true)}
                >
                  <Sparkles size={14} />
                  <span>命令</span>
                  <kbd>⌘K</kbd>
                </Button>
              </div>
            </header>
            <div className="app-content">
              <PolicyBanner />
              <Suspense fallback={<div className="page">页面加载中…</div>}>
                <Outlet />
              </Suspense>
            </div>
            <button
              type="button"
              className="assistant-fab"
              aria-label="打开 AI 助手"
              aria-expanded={assistantOpen}
              onClick={() => {
                setAssistantOpen((v) => !v);
                clearAssistantUnread();
              }}
            >
              <Sparkles size={18} />
              <span>AI 助手</span>
              {assistantUnread > 0 ? (
                <span className="assistant-fab__badge">{assistantUnread > 9 ? "9+" : assistantUnread}</span>
              ) : null}
            </button>
            <AssistantPanel
              open={assistantOpen}
              onClose={() => {
                setAssistantOpen(false);
                clearAssistantUnread();
              }}
            />
            <CommandPalette
              open={commandOpen}
              onOpenChange={setCommandOpen}
              currentProjectId={routeProjectId}
            />
          </div>
        </div>
      </ToastProvider>
    </HelpProvider>
  );
}
