/**
 * 主写作应用入口地址：
 * 1) 显式配置 VITE_WRITING_APP_BASE（部署/桌面场景）
 * 2) 开发环境默认 5173
 * 3) 生产环境默认同源
 */
export function writingAppBase(): string {
  const configured = (import.meta.env.VITE_WRITING_APP_BASE as string | undefined)?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (import.meta.env.DEV) return "http://127.0.0.1:5173";
  return window.location.origin;
}
