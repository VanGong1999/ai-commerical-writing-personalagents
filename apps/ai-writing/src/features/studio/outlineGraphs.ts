/** 从大纲 / 细纲的结构化产物本地生成 Mermaid（零 token）。 */

function esc(text: unknown): string {
  return String(text ?? "")
    .replace(/[\[\](){}<>"|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 28) || "—";
}

function safeId(prefix: string, n: number): string {
  return `${prefix}_${n}`;
}

export function episodeOutlinesToMermaid(rows: unknown[]): string {
  const eps = (rows || [])
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map((row) => ({
      no: Number(row.episodeNo ?? row.episode_no ?? 0) || 0,
      title: String(row.title ?? row.episode_title ?? `第${Number(row.episodeNo ?? 0) || "?"}集`),
      summary: String(row.summary ?? ""),
      beats: Array.isArray(row.beats) ? row.beats : [],
    }))
    .filter((row) => row.no > 0)
    .sort((a, b) => a.no - b.no);
  if (!eps.length) return "flowchart TD\n  empty([暂无大纲 — 先生成分集大纲])";

  const lines = ["flowchart TD"];
  let prev: string | null = null;
  for (const ep of eps) {
    const id = safeId("ep", ep.no);
    lines.push(`  ${id}[EP${ep.no} · ${esc(ep.title)}]`);
    if (prev) lines.push(`  ${prev} --> ${id}`);
    prev = id;
    ep.beats.slice(0, 12).forEach((beat, index) => {
      const beatId = `${id}b${index + 1}`;
      lines.push(`  ${beatId}(${esc(typeof beat === "string" ? beat : (beat as Record<string, unknown>)?.label ?? (beat as Record<string, unknown>)?.beat)})`);
      lines.push(`  ${id} --- ${beatId}`);
    });
  }
  return lines.join("\n");
}

type BeatRow = {
  n?: number | string;
  name?: string;
  beat?: string;
  intensity?: number | string;
  title?: string;
};

export function beatsToMermaid(rows: unknown[]): string {
  const list: BeatRow[] = [];
  for (const row of rows || []) {
    if (!row || typeof row !== "object") continue;
    const obj = row as Record<string, unknown>;
    const beatList = Array.isArray(obj.beat_20)
      ? obj.beat_20
      : Array.isArray(obj.beats)
        ? obj.beats
        : [];
    if (beatList.length) {
      for (const item of beatList) {
        if (item && typeof item === "object") {
          list.push(item as BeatRow);
        }
      }
    } else if (obj.name || obj.beat || obj.title) {
      list.push(obj as BeatRow);
    }
  }
  const sorted = list
    .map((item, index) => ({
      n: Number(item.n ?? item.title ?? 0) || index + 1,
      name: String(item.name ?? item.title ?? `拍 ${index + 1}`),
      beat: String(item.beat ?? ""),
      intensity: Number(item.intensity ?? 0) || 0,
    }))
    .sort((a, b) => a.n - b.n);
  if (!sorted.length) return "flowchart TD\n  empty([暂无细纲 — 先生成细纲/节拍])";

  const lines = ["flowchart TD"];
  let prev: string | null = null;
  for (const item of sorted) {
    const id = safeId("beat", item.n);
    const hot = item.intensity >= 4 ? "🔥" : item.intensity >= 3 ? "⚡" : "";
    lines.push(`  ${id}[${item.n}. ${esc(item.name)}${hot}]`);
    if (prev) lines.push(`  ${prev} --> ${id}`);
    prev = id;
  }
  return lines.join("\n");
}

export function outlineMermaidFor(
  artifactType: string,
  artifacts: { type: string; bodyJson?: unknown }[],
): string {
  const rows = artifacts
    .filter((a) => a.type === artifactType)
    .map((a) => a.bodyJson);
  if (artifactType === "episode_outline") return episodeOutlinesToMermaid(rows);
  return beatsToMermaid(rows);
}
