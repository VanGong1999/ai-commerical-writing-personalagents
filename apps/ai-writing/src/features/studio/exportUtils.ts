import type { Artifact } from "@xiezuomanju/domain";

export type ExportFormat = "txt" | "docx" | "pdf";

export type ExportSection = {
  heading: string;
  body: string;
};

const API_BASE = (import.meta.env.VITE_API_BASE as string) || "";

/** 调用后端导出接口并触发浏览器下载。 */
export async function downloadExport(
  projectId: string,
  title: string,
  sections: ExportSection[],
  format: ExportFormat,
): Promise<string> {
  const res = await fetch(
    `${API_BASE}/api/v1/projects/${encodeURIComponent(projectId)}/export`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, format, sections }),
    },
  );
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || res.statusText);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const filename = match
    ? decodeURIComponent(match[1])
    : `${title || "export"}.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

export function episodeNoOf(artifact: Artifact): number {
  const body = (artifact.bodyJson ?? {}) as { episodeNo?: number; scene_header?: string };
  const n = Number(body.episodeNo ?? 0);
  if (n > 0) return n;
  // duanju 场级正文：scene_header "1|客厅|内|日" 首位数字为集号
  const m = String(body.scene_header || "").match(/^(\d+)/);
  return m ? Number(m[1]) : 0;
}

/** 正文文本：manuscript 取 bodyMarkdown；scene 取 script_body。 */
export function bodyTextOfExport(artifact: Artifact): string {
  if (artifact.type === "scene") {
    return ((artifact.bodyJson as { script_body?: string } | null)?.script_body ?? "");
  }
  return artifact.bodyMarkdown ?? "";
}

/** 大纲正文：优先 bodyMarkdown，否则由结构化字段重组成文字块。 */
export function outlineBodyOf(artifact: Artifact): string {
  const md = artifact.bodyMarkdown?.trim();
  if (md) return md;
  const body = (artifact.bodyJson ?? {}) as {
    episodeNo?: number;
    title?: string;
    summary?: string;
    beats?: string[];
    thrill?: string;
    trap?: string;
    hookAtEnd?: boolean;
  };
  if (!body.summary && !(body.beats?.length ?? 0)) return "";
  return [
    `第${body.episodeNo ?? "?"}集 ${body.title ?? ""}`,
    `摘要：${body.summary ?? ""}`,
    `情节点：${(body.beats ?? []).join("、")}`,
    `爽点：${body.thrill ?? "打脸反转"}`,
    `卡点：${body.trap ?? (body.hookAtEnd ? "集尾悬念" : "（缺钩）")}`,
  ].join("\n");
}

/** 核心梗正文。 */
export function hookBodyOf(artifact: Artifact): string {
  const md = artifact.bodyMarkdown?.trim();
  if (md) return md;
  const body = (artifact.bodyJson ?? {}) as {
    coreHook?: string;
    titleHook?: string;
    motivation?: string;
    crisis?: string;
  };
  return [
    body.titleHook ? `标题钩：${body.titleHook}` : "",
    body.coreHook ? `核心梗：${body.coreHook}` : "",
    body.motivation ? `动机：${body.motivation}` : "",
    body.crisis ? `危机：${body.crisis}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 人物小传正文：优先 bodyMarkdown，否则把结构化字段拼成文字。 */
export function characterBodyOf(artifact: Artifact): string {
  const md = artifact.bodyMarkdown?.trim();
  if (md) return md;
  const body = (artifact.bodyJson ?? {}) as Record<string, unknown>;
  const labelMap: Record<string, string> = {
    name: "姓名",
    role: "功能位",
    desire: "欲望",
    fear: "恐惧",
    secret: "秘密",
    motivation: "动机",
    appearance: "外貌",
    relationship: "关系",
    arc: "成长弧",
  };
  const lines = Object.entries(body)
    .filter(([key]) => !["episodeNo", "wordCount"].includes(key))
    .map(([key, value]) => {
      const text =
        typeof value === "string"
          ? value
          : Array.isArray(value)
            ? value.map(String).join("、")
            : typeof value === "object" && value !== null
              ? JSON.stringify(value)
              : String(value ?? "");
      return `${labelMap[key] ?? key}：${text}`;
    })
    .filter((line) => !line.endsWith("：") && !line.endsWith("：null"));
  return lines.join("\n");
}

export function englishOf(artifact: Artifact): string {
  const value = (artifact.bodyJson as { english?: unknown } | null)?.english;
  return typeof value === "string" ? value.trim() : "";
}

/** 正文章节导出：中文 + 已存在的英文译文。 */
export function manuscriptExportSections(
  manuscripts: Artifact[],
  titleLabel: string,
  unitWord: "集" | "章" = "集",
): ExportSection[] {
  const sorted = [...manuscripts].sort((a, b) => episodeNoOf(a) - episodeNoOf(b));
  const unitLabel = (m: Artifact) =>
    m.type === "scene"
      ? `场 ${(m.bodyJson as { scene_header?: string } | null)?.scene_header ?? (episodeNoOf(m) || "?")}`
      : `第${episodeNoOf(m) || "?"}${unitWord}`;
  const sections: ExportSection[] = sorted
    .filter((m) => bodyTextOfExport(m).trim())
    .map((m) => ({
      heading: `${titleLabel} · ${unitLabel(m)} ${m.title ?? ""}`,
      body: bodyTextOfExport(m),
    }));
  const englishSections = sorted
    .map((m) => {
      const en = englishOf(m);
      return en
        ? {
            heading: `English · ${unitLabel(m)} ${m.title ?? ""}`,
            body: en,
          }
        : null;
    })
    .filter((s): s is ExportSection => Boolean(s));
  return [...sections, ...englishSections];
}
