import { MasterOutlineBodySchema, type Artifact } from "@xiezuomanju/domain";
import { notifyDeepHydrated } from "./usePersistedState";

function deepKey(projectId: string, key: string) {
  return `deep:${projectId}:${key}`;
}

function isEmptyLike(raw: string | null): boolean {
  if (!raw) return true;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "{}" || trimmed === "[]" || trimmed === '""' || trimmed === "null") {
    return true;
  }
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (value == null) return true;
    if (typeof value === "string") return !value.trim();
    if (Array.isArray(value)) {
      return (
        value.length === 0 ||
        value.every((item) => {
          if (item == null) return true;
          if (typeof item === "string") return !item.trim();
          if (typeof item !== "object") return false;
          return Object.values(item as Record<string, unknown>).every(
            (v) => v == null || v === "" || v === false,
          );
        })
      );
    }
    if (typeof value === "object") {
      const vals = Object.values(value as Record<string, unknown>);
      if (!vals.length) return true;
      return vals.every((v) => {
        if (v == null || v === "") return true;
        if (typeof v === "boolean") return true; // 默认 false 不算「已填写」
        if (typeof v === "object") {
          return Object.values(v as Record<string, unknown>).every(
            (x) => x == null || x === "" || x === false,
          );
        }
        return false;
      });
    }
  } catch {
    return !trimmed;
  }
  return false;
}

function writeIfEmpty(projectId: string, key: string, value: unknown): boolean {
  let existing: string | null = null;
  try {
    existing = localStorage.getItem(deepKey(projectId, key));
  } catch {
    existing = null;
  }
  if (!isEmptyLike(existing)) return false;
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? null);
  if (isEmptyLike(text)) return false;
  try {
    localStorage.setItem(deepKey(projectId, key), text);
    return true;
  } catch {
    return false;
  }
}

function firstOf(artifacts: Artifact[], types: string[]): Artifact | undefined {
  const matches = artifacts.filter(a => types.includes(a.type) && (a.bodyMarkdown?.trim() || a.bodyJson));
  return matches.find(a => a.status === "adopted") ?? matches[0];
}

/**
 * 当九格 deep:* 本地草稿为空时，用已落库 Artifact / coverMeta 回填，
 * 修复「流程已完成但打开面板空白」的跨端/清缓存场景。
 * 不覆盖用户已有草稿。
 */
export function hydrateDeepFromArtifacts(
  projectId: string,
  artifacts: Artifact[],
  coverMeta?: Record<string, unknown> | null,
): { filled: string[] } {
  const filled: string[] = [];
  const mark = (key: string, ok: boolean) => {
    if (ok) filled.push(key);
  };

  const hook = firstOf(artifacts, ["core_hook", "logline"]);
  const hookJson = (hook?.bodyJson || {}) as {
    coreHook?: string;
    logline?: string;
    title?: string;
    titleHook?: string;
  };
  const hookText =
    hook?.bodyMarkdown?.trim() ||
    String(hookJson.logline || hookJson.coreHook || "").trim() ||
    String(coverMeta?.logline || coverMeta?.coreHook || "").trim();

  const character = firstOf(artifacts, ["character"]);
  const world = firstOf(artifacts, ["world", "world_setting"]);
  const manuscript = firstOf(artifacts, ["manuscript", "scene"]);

  if (hookText) {
    mark(
      "pitch-spec-v2",
      writeIfEmpty(projectId, "pitch-spec-v2", {
        title: String(coverMeta?.title || ""),
        logline: hookText.slice(0, 200),
        genre: "",
        audience: "",
        episodeCount: "",
        wordsPerEp: "",
        notes: hookText,
      }),
    );
  }

  if (character?.bodyMarkdown?.trim()) {
    mark(
      "char-seven",
      writeIfEmpty(projectId, "char-seven", {
        name: character.title || "主角",
        want: "",
        need: "",
        ghost: "",
        lie: "",
        flaw: "",
        strength: "",
        arc: character.bodyMarkdown.trim().slice(0, 4000),
      }),
    );
  }

  if (world?.bodyMarkdown?.trim()) {
    mark(
      "setting-world",
      writeIfEmpty(projectId, "setting-world", {
        rules: world.bodyMarkdown.trim().slice(0, 6000),
        dilemmaLow: "",
        dilemmaHigh: "",
        omitNotes: "",
      }),
    );
    mark(
      "setting-five",
      writeIfEmpty(projectId, "setting-five", {
        who: "",
        world: world.bodyMarkdown.trim().slice(0, 1200),
        power: "",
        conflict: "",
        reward: "",
      }),
    );
  }

  const master = firstOf(artifacts, ["master_outline"]);
  const parsed = MasterOutlineBodySchema.safeParse(master?.bodyJson);
  if (parsed.success && Object.entries(parsed.data).some(([k,v]) => k !== "formatHint" && (typeof v === "string" ? v.trim() : Array.isArray(v) ? v.length : Boolean(v)))) {
    mark("master-outline", writeIfEmpty(projectId, "master-outline", parsed.data));
  }

  if (manuscript?.bodyMarkdown?.trim()) {
    mark(
      "dialogue-triple",
      writeIfEmpty(projectId, "dialogue-triple", [
        {
          role: "旁白",
          line: manuscript.bodyMarkdown.trim().slice(0, 800),
          beat: manuscript.status === "adopted" ? "来自已采纳正文" : "来自正文草稿",
        },
      ]),
    );
  }

  // synopsis 独立 key（创作台梗概框）
  if (hookText) {
    try {
      const synKey = `synopsis:${projectId}`;
      if (localStorage.getItem(synKey) === null) {
        localStorage.setItem(synKey, hookText.slice(0, 2000));
        filled.push("synopsis");
      }
    } catch {
      /* ignore */
    }
  }

  if (filled.length) notifyDeepHydrated(projectId);
  return { filled };
}
