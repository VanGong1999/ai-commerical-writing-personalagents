import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xiezuomanju/ui/styles.css";
import { KbShellHome } from "./pages";
import { writingAppBase } from "./appBase";

const rootRoute = createRootRoute({
  component: () => (
    <div className="app-shell">
      <nav className="app-nav">
        <div className="app-nav__brand">
          AI 商业写作台 · 知识库
          <span>独立入口 · 与写作台共享能力</span>
        </div>
        <Link to="/" data-active="true">
          首页
        </Link>
        <a href={`${writingAppBase()}/kb`}>打开主应用知识库</a>
        <a href={`${writingAppBase()}/studio/manju`}>返回写作台</a>
      </nav>
      <div className="app-main">
        <header className="app-header">
          <span className="muted">薄壳应用 · 完整 UI 在 ai-writing `/kb/*`</span>
        </header>
        <div className="app-content">
          <Outlet />
        </div>
      </div>
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: KbShellHome,
});

const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]) });
const qc = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
