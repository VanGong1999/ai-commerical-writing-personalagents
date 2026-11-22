import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { lazy, type ComponentType } from "react";
import { AppShell } from "./layout/AppShell";
import type { ProjectFormat } from "@xiezuomanju/domain";

/** 路由级懒加载：按页拆 chunk，减小首屏体积。 */
function lazyPage(
  importFn: () => Promise<Record<string, unknown>>,
  name: string,
) {
  const Lazy = lazy(() =>
    importFn().then((m) => ({ default: m[name] as ComponentType })),
  );
  return Lazy;
}

const HomePage = lazyPage(() => import("./features/home/HomePage"), "HomePage");
const InspirationPage = lazyPage(
  () => import("./features/inspiration/InspirationPage"),
  "InspirationPage",
);
const ProjectsPage = lazyPage(
  () => import("./features/projects/ProjectsPage"),
  "ProjectsPage",
);
const NewProjectPage = lazyPage(
  () => import("./features/projects/NewProjectPage"),
  "NewProjectPage",
);
const ProjectRedirect = lazyPage(
  () => import("./features/projects/ProjectRedirect"),
  "ProjectRedirect",
);
const StudioPage = lazyPage(() => import("./features/studio/StudioPage"), "StudioPage");
const StudioHubPage = lazyPage(
  () => import("./features/studio/StudioHubPage"),
  "StudioHubPage",
);
const KbHomePage = lazyPage(() => import("./features/kb/KbHomePage"), "KbHomePage");
const KbDocPage = lazyPage(() => import("./features/kb/KbDocPage"), "KbDocPage");
const KbGraphPage = lazyPage(() => import("./features/kb/KbGraphPage"), "KbGraphPage");
const TropesPage = lazyPage(() => import("./features/kb/TropesPage"), "TropesPage");
const HotspotsPage = lazyPage(() => import("./features/kb/HotspotsPage"), "HotspotsPage");
const KbCrawlerPage = lazyPage(
  () => import("./features/kb/KbCrawlerPage"),
  "KbCrawlerPage",
);
const PromptsPage = lazyPage(() => import("./features/prompts/PromptsPage"), "PromptsPage");
const BotsHomePage = lazyPage(
  () => import("./features/bots/BotsHomePage"),
  "BotsHomePage",
);
const TokensPage = lazyPage(() => import("./features/tokens/TokensPage"), "TokensPage");
const MemoryPage = lazyPage(() => import("./features/memory/MemoryPage"), "MemoryPage");
const SettingsPage = lazyPage(
  () => import("./features/settings/SettingsPage"),
  "SettingsPage",
);
const SkillsPage = lazyPage(() => import("./features/skills/SkillsPage"), "SkillsPage");
const JobsPage = lazyPage(() => import("./features/jobs/JobsPage"), "JobsPage");
const RunningTasksPage = lazyPage(
  () => import("./features/runs/RunningTasksPage"),
  "RunningTasksPage",
);
const DashboardPage = lazyPage(
  () => import("./features/dashboard/DashboardPage"),
  "DashboardPage",
);
const EvalPage = lazyPage(() => import("./features/eval/EvalPage"), "EvalPage");
const AgentWorkbenchPage = lazyPage(
  () => import("./features/agent/AgentWorkbenchPage"),
  "AgentWorkbenchPage",
);
export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const inspirationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inspiration",
  component: InspirationPage,
});

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  component: ProjectsPage,
});

export type NewProjectSearch = {
  format?: ProjectFormat;
  title?: string;
  logline?: string;
  tags?: string;
};

/** 导航到新建项目时的 search 归一化，避免各页手写缺字段。 */
export function newProjectSearch(partial: NewProjectSearch = {}): NewProjectSearch {
  return {
    ...(partial.format ? { format: partial.format } : {}),
    ...(partial.title ? { title: partial.title } : {}),
    ...(partial.logline ? { logline: partial.logline } : {}),
    ...(partial.tags ? { tags: partial.tags } : {}),
  };
}

const newProjectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/new",
  validateSearch: (s: Record<string, unknown>): NewProjectSearch =>
    newProjectSearch({
      format: (s.format as ProjectFormat | undefined) || undefined,
      title: typeof s.title === "string" ? s.title : undefined,
      logline: typeof s.logline === "string" ? s.logline : undefined,
      tags: typeof s.tags === "string" ? s.tags : undefined,
    }),
  component: NewProjectPage,
});

const projectIdRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$id",
  component: ProjectRedirect,
});

const studioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/studio/$format",
  validateSearch: (s: Record<string, unknown>) => ({
    projectId: typeof s.projectId === "string" ? s.projectId : undefined,
  }),
  component: StudioPage,
});

const studioHubRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/studio",
  component: StudioHubPage,
});

const kbRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/kb",
  component: KbHomePage,
});

const kbDocRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/kb/docs/$id",
  validateSearch: (s: Record<string, unknown>): { report?: string } => ({
    report: typeof s.report === "string" ? s.report : undefined,
  }),
  component: KbDocPage,
});

const kbGraphRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/kb/graph/$id",
  component: KbGraphPage,
});

const tropesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/kb/tropes",
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({
    q: typeof s.q === "string" ? s.q : undefined,
  }),
  component: TropesPage,
});

const hotspotsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/kb/hotspots",
  component: HotspotsPage,
});

const kbCrawlerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/kb/crawler",
  component: KbCrawlerPage,
});

const promptsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/prompts",
  component: PromptsPage,
});

const skillsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/skills",
  validateSearch: (s: Record<string, unknown>): { skill?: string } => ({
    skill: typeof s.skill === "string" ? s.skill : undefined,
  }),
  component: SkillsPage,
});

const colleagueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/colleague",
  component: BotsHomePage,
});

const botsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bots",
  beforeLoad: () => {
    throw redirect({ to: "/colleague" });
  },
});

const botsTemplatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bots/templates",
  beforeLoad: () => {
    throw redirect({ to: "/colleague" });
  },
});

const routinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/routines",
  beforeLoad: () => {
    throw redirect({ to: "/colleague" });
  },
});

const tokensRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tokens",
  component: TokensPage,
});

const memoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/memory",
  component: MemoryPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const jobsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/jobs",
  component: JobsPage,
});

const runsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs",
  component: RunningTasksPage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  component: DashboardPage,
});

const evalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/eval",
  component: EvalPage,
});

const agentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agent",
  validateSearch: (s: Record<string, unknown>): { q?: string; c?: string; view?: string } => ({
    q: typeof s.q === "string" ? s.q : undefined,
    c: typeof s.c === "string" ? s.c : undefined,
    view: typeof s.view === "string" ? s.view : undefined,
  }),
  component: AgentWorkbenchPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  inspirationRoute,
  projectsRoute,
  newProjectRoute,
  projectIdRoute,
  studioHubRoute,
  studioRoute,
  kbRoute,
  kbDocRoute,
  kbGraphRoute,
  tropesRoute,
  hotspotsRoute,
  kbCrawlerRoute,
  promptsRoute,
  skillsRoute,
  colleagueRoute,
  botsRoute,
  botsTemplatesRoute,
  routinesRoute,
  tokensRoute,
  memoryRoute,
  settingsRoute,
  jobsRoute,
  runsRoute,
  dashboardRoute,
  evalRoute,
  agentRoute,
]);

// silence unused import if tree-shaken wrongly
void createRouter;
void redirect;
