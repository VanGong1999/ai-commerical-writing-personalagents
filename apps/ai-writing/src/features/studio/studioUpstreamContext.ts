import type { Artifact, MemoryMeta } from "@xiezuomanju/domain";
import { api } from "../../api/client";

const BIBLE_HINTS = ["bible", "world", "character", "persona", "PROJECT.md", "decisions"];
const JOURNAL_HINTS = ["journal", "chapter", "episode", "summary"];

function pathScore(path: string, hints: string[]): number {
  const lower = path.toLowerCase();
  return hints.reduce((score, hint) => (lower.includes(hint.toLowerCase()) ? score + 1 : score), 0);
}

async function readSnippets(
  files: MemoryMeta[],
  limitChars: number,
): Promise<string> {
  const chunks: string[] = [];
  let used = 0;
  for (const file of files) {
    if (used >= limitChars) break;
    try {
      const meta = await api.getMemory(file.path);
      const content = String((meta as { content?: string }).content || "").trim();
      if (!content) continue;
      const slice = content.slice(0, Math.min(1800, limitChars - used));
      chunks.push(`## ${file.path.split("/").pop() || file.path}\n${slice}`);
      used += slice.length;
    } catch {
      /* 单文件失败不阻断 */
    }
  }
  return chunks.join("\n\n");
}

/**
 * 创作台 / Autopilot 上游上下文：复用项目记忆（bible/journal）与已采纳产物，
 * 不另造上下文系统；worker 侧仍走既有 contextSlots / bible_read。
 */
export async function buildStudioUpstreamContext(
  projectId: string,
  opts?: {
    artifacts?: Artifact[];
    includeMemory?: boolean;
  },
): Promise<{
  bible?: string;
  journal?: string;
  setting?: string;
  emotion?: string;
  foreshadow?: string;
}> {
  const out: {
    bible?: string;
    journal?: string;
    setting?: string;
    emotion?: string;
    foreshadow?: string;
  } = {};

  const artifacts =
    opts?.artifacts ??
    (await api.listArtifacts(projectId).catch(() => [] as Artifact[]));

  const settingArt = artifacts.find(
    (a) =>
      (a.type === "world" || a.type === "world_setting") &&
      (a.bodyMarkdown?.trim() || a.bodyJson),
  );
  if (settingArt?.bodyMarkdown?.trim()) {
    out.setting = settingArt.bodyMarkdown.trim().slice(0, 4000);
  }

  const emotionArt = artifacts.find(
    (a) => a.type === "emotion_curve" && (a.bodyMarkdown?.trim() || a.bodyJson),
  );
  if (emotionArt) {
    out.emotion =
      emotionArt.bodyMarkdown?.trim().slice(0, 2000) ||
      JSON.stringify(emotionArt.bodyJson).slice(0, 2000);
  }

  const foreshadowArt = artifacts.find(
    (a) =>
      a.type === "foreshadow_ledger" ||
      (a.type === "other" && (a.bodyJson as { kind?: string } | undefined)?.kind === "foreshadow_ledger"),
  );
  if (foreshadowArt) {
    out.foreshadow =
      foreshadowArt.bodyMarkdown?.trim().slice(0, 2000) ||
      JSON.stringify(foreshadowArt.bodyJson).slice(0, 2000);
  }

  if (opts?.includeMemory === false) return out;

  try {
    const tree = await api.memoryTree({ projectId });
    const projectFiles = tree.filter(
      (m) => m.projectId === projectId || m.path.includes(projectId),
    );
    const bibleFiles = [...projectFiles]
      .filter((m) => pathScore(m.path, BIBLE_HINTS) > 0)
      .sort((a, b) => pathScore(b.path, BIBLE_HINTS) - pathScore(a.path, BIBLE_HINTS))
      .slice(0, 3);
    const journalFiles = [...projectFiles]
      .filter((m) => pathScore(m.path, JOURNAL_HINTS) > 0)
      .sort((a, b) => pathScore(b.path, JOURNAL_HINTS) - pathScore(a.path, JOURNAL_HINTS))
      .slice(0, 3);
    const bible = await readSnippets(bibleFiles, 3500);
    const journal = await readSnippets(journalFiles, 2500);
    if (bible) out.bible = bible;
    if (journal) out.journal = journal;
  } catch {
    /* 记忆可选 */
  }

  return out;
}
