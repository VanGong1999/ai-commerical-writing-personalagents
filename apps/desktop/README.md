# AI 商业写作台 · Tauri 2 桌面壳

与 `apps/ai-writing` 共用同一套 React UI。桌面端通过 WebView 加载本地 Vite 开发服或打包后的 `dist`。

## 里程碑状态

| 阶段 | 状态 |
|------|------|
| WebView 壳 + 加载本机前端 | ✅ 已有 |
| 手启 FastAPI / workers | ✅ 当前方式 |
| **FastAPI + agent-worker sidecar 一键打包** | ⏳ **独立里程碑**（不阻塞本机 Web 联调） |

当前交付形态以 **本机 Web 联调** 为主；桌面壳用于窗口与打包验证，不假装「单安装包开箱即用」。

## 前置

- Node ≥ 20、pnpm
- Rust（`rustup`）
- macOS：Xcode CLT；Windows：WebView2

## 开发

```bash
# 终端 1：Web
pnpm dev:web

# 终端 2：API（必需，HTTP 模式）
pnpm dev:api

# 终端 3–4：workers（Agent 路径）
pnpm dev:worker
pnpm dev:agent-worker

# 终端 5：桌面壳
pnpm --filter @xiezuomanju/desktop install
pnpm --filter @xiezuomanju/desktop dev
```

`tauri.conf.json` 默认 `devUrl` 指向 `http://127.0.0.1:5173`。

> **Sidecar 未打包**：桌面端运行时需单独启动 API（及 Redis + workers），再通过 `VITE_API_BASE` 指向它。  
> 后续 sidecar 需引入 Python/Node 运行时与进程编排，见架构审查阶段 D。

## 生产打包

```bash
pnpm --filter @xiezuomanju/ai-writing build
pnpm --filter @xiezuomanju/desktop build
```

产物在 `apps/desktop/src-tauri/target/release/bundle/`。  
注意：当前产物仍依赖本机或远端已部署的 API，**不是**自包含后端。

## 权限边界

- 仅允许加载本机前端与配置的 API 源
- 本地草稿/密钥保险箱后续经 Tauri 命令扩展；本期壳层先打通窗口与打包
