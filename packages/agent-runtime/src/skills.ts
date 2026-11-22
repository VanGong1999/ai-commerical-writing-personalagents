import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { listAgents } from "./registry.ts";
import { normalizeGateName } from "./gates.extended.ts";
import type { SkillMeta } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SKILLS_ROOT = join(HERE, "..", "skills");

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---")) {
    return { meta: {}, body: raw };
  }
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { meta: {}, body: raw };
  const fm = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).trim();
  const meta: Record<string, unknown> = {};
  for (const line of fm.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value: unknown = m[2].trim();
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
    meta[key] = value;
  }
  return { meta, body };
}

export function loadSkill(skillPath: string): SkillMeta {
  const abs = skillPath.startsWith("/")
    ? skillPath
    : join(SKILLS_ROOT, skillPath.replace(/^skills\//, ""));
  if (!existsSync(abs)) {
    throw new Error(`Skill not found: ${abs}`);
  }
  const raw = readFileSync(abs, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  return {
    name: String(meta.name || relative(SKILLS_ROOT, abs)),
    description: String(meta.description || ""),
    path: abs,
    locks: Array.isArray(meta.locks) ? (meta.locks as string[]) : undefined,
    gates: Array.isArray(meta.gates) ? (meta.gates as string[]) : undefined,
    body,
  };
}

export function listSkillFiles(root = SKILLS_ROOT): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name === "SKILL.md") out.push(p);
    }
  };
  walk(root);
  return out;
}

/** 渐进式披露：仅 name + description（NC，永不压缩）；正文按需 skill_read */
export type SkillIndexEntry = {
  name: string;
  description: string;
  relativePath: string;
  gates?: string[];
  locks?: string[];
  /** 顶层目录，如 manju / duanju / character */
  category?: string;
};

export function listSkillIndex(root = SKILLS_ROOT): SkillIndexEntry[] {
  return listSkillFiles(root).map((abs) => {
    const skill = loadSkill(abs);
    const rel = relative(SKILLS_ROOT, abs);
    const category = rel.split(/[\\/]/)[0] || "";
    return {
      name: skill.name,
      description: skill.description || "(no description)",
      relativePath: rel,
      gates: skill.gates,
      locks: skill.locks,
      category,
    };
  });
}

function editDistance(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return 0;
  const rows = x.length + 1;
  const cols = y.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[x.length][y.length];
}

/**
 * 解析技能引用：relativePath / frontmatter name / 目录 slug / 模糊匹配。
 * 成功返回 { ok:true, entry, skill }；失败返回 { ok:false, close, message }。
 */
const GATE_LIKE = new Set(
  [
    "gates",
    "gate",
    "LengthBand",
    "HookPresence",
    "ShowDontTell",
    "Format",
    "Chunk",
    "Logic",
    "Ep1Hook",
    "BeatCompleteness",
    "PaywallCoverage",
  ].map((s) => s.toLowerCase()),
);

function relativeSkillPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^skills\//i, "");
}

function normalizeSkillPath(value: string): string {
  return relativeSkillPath(value).toLowerCase();
}

export function resolveSkill(
  ref: string,
  entries?: SkillIndexEntry[],
):
  | { ok: true; entry: SkillIndexEntry; skill: SkillMeta }
  | { ok: false; close: SkillIndexEntry[]; message: string } {
  const raw = String(ref || "").trim();
  const index = entries || listSkillIndex();
  if (!raw) {
    return {
      ok: false,
      close: index.slice(0, 3),
      message: "缺少技能引用。请传 relativePath（如 manju/core-hook/SKILL.md）或 name。",
    };
  }

  const reference = relativeSkillPath(raw);
  const normalized = reference.toLowerCase();
  const segments = reference.split("/");
  if (segments.some(part => !part || part === "." || part === ".." || part.toLowerCase() === "skills")) {
    return { ok: false, close: [], message: "请使用技能目录中的完整 relativePath 或技能名。" };
  }
  // Only a full path present in the index can open a file in the gates directory.
  let hit = index.find(entry => normalizeSkillPath(entry.relativePath) === normalized);
  if (!hit) {
    const gateNamespace = GATE_LIKE.has(segments[0].toLowerCase());
    const exactName = index.find(entry => entry.name.toLowerCase() === normalized);
    // runGateBattery also accepts names with the optional Gate suffix.
    const gate = normalizeGateName(segments[0]).toLowerCase().replace(/gate$/, "");
    const indexedGate = index.some(entry => entry.gates?.some(name => name.toLowerCase().replace(/gate$/, "") === gate));
    if (gateNamespace || (!exactName && (GATE_LIKE.has(gate) || indexedGate))) {
      return {
        ok: false,
        close: [],
        message: `「${raw}」不能作为技能引用。门禁名请用 gate_run；读取技能请使用目录中的完整 relativePath。`,
      };
    }
    hit = exactName || index.find(entry => normalizeSkillPath(entry.relativePath) === `${normalized}/skill.md`);
  }

  // 3) directory slug（末段目录名）
  if (!hit) {
    const slug = basename(normalized.replace(/\/SKILL\.md$/i, ""));
    const slugHits = index.filter((e) => {
      const dir = basename(dirname(join(SKILLS_ROOT, e.relativePath)));
      return dir === slug || dir.toLowerCase() === slug.toLowerCase();
    });
    if (slugHits.length === 1) hit = slugHits[0];
    else if (slugHits.length > 1) {
      return {
        ok: false,
        close: slugHits.slice(0, 5),
        message: `「${raw}」匹配到多个技能，请用完整 relativePath：${slugHits
          .slice(0, 5)
          .map((e) => e.relativePath)
          .join(" / ")}`,
      };
    }
  }

  // 4) 模糊：仅当编辑距离很近且查询足够长，避免短词乱匹配
  if (!hit) {
    const needle = basename(normalized.replace(/\/SKILL\.md$/i, ""));
    const scored = index
      .map((e) => {
        const slug = basename(dirname(join(SKILLS_ROOT, e.relativePath)));
        const d = Math.min(
          editDistance(normalized, e.relativePath),
          editDistance(normalized, e.name),
          editDistance(needle, slug),
          editDistance(needle, e.name),
        );
        return { e, d };
      })
      .sort((a, b) => a.d - b.d);
    const close = scored.slice(0, 3).map((s) => s.e);
    const maxDist = needle.length >= 8 ? 3 : needle.length >= 5 ? 2 : 0;
    if (scored[0] && maxDist > 0 && scored[0].d <= maxDist) {
      hit = scored[0].e;
    } else {
      return {
        ok: false,
        close,
        message: `找不到技能「${raw}」。最接近：${close
          .map((e) => `${e.name} (${e.relativePath})`)
          .join(" / ")}。请用 skill_list 确认后传 relativePath。`,
      };
    }
  }

  try {
    const skill = loadSkill(hit.relativePath);
    return { ok: true, entry: hit, skill };
  } catch (err) {
    return {
      ok: false,
      close: [hit],
      message: `技能文件不可读：${(err as Error).message}`,
    };
  }
}

// A skill can serve multiple formats, including roles registered outside its directory.
function projectSkills(entries: SkillIndexEntry[], format?: string, activePath?: string): SkillIndexEntry[] {
  if (!format || format === "*") return entries;
  const registered = new Set(listAgents().map(agent => normalizeSkillPath(agent.skillPath)));
  const compatible = new Set(listAgents(format).map(agent => normalizeSkillPath(agent.skillPath)));
  return entries.filter(entry => {
    const path = normalizeSkillPath(entry.relativePath);
    return path === activePath || !registered.has(path) || compatible.has(path);
  });
}

/** 按 format / 类别过滤技能目录 */
export function filterSkillsForAgent(
  entries: SkillIndexEntry[],
  opts: { format?: string; categories?: string[]; limit?: number; activePath?: string } = {},
): SkillIndexEntry[] {
  const rawFormat = Array.isArray(opts.format) ? opts.format[0] : opts.format;
  const format = String(rawFormat || "").toLowerCase();
  const cats = new Set((opts.categories || []).map((c) => c.toLowerCase()));
  // format → 优先类别
  const formatCats: Record<string, string[]> = {
    manju: ["manju", "character", "structure", "swap"],
    duanju: ["duanju", "character", "structure"],
    short_novel: ["short_novel", "male_long", "female", "character", "structure"],
    male_long: ["male_long", "character", "structure"],
    female_long: ["female_long", "character", "structure"],
    female: ["female", "character", "structure"],
    ip_adapt: ["ip", "character"],
    ip: ["ip", "character"],
  };
  const prefer = new Set(
    [...(formatCats[format] || []), ...cats].map((c) => c.toLowerCase()),
  );

  const activePath = opts.activePath && normalizeSkillPath(opts.activePath);
  const ranked = [...projectSkills(entries, format, activePath)];
  if (prefer.size || activePath) {
    ranked.sort((a, b) => {
      const aActive = normalizeSkillPath(a.relativePath) === activePath;
      const bActive = normalizeSkillPath(b.relativePath) === activePath;
      if (aActive !== bActive) return aActive ? -1 : 1;
      const ap = prefer.has((a.category || "").toLowerCase()) ? 0 : 1;
      const bp = prefer.has((b.category || "").toLowerCase()) ? 0 : 1;
      return ap - bp || a.relativePath.localeCompare(b.relativePath);
    });
  }
  return ranked.slice(0, Math.max(0, opts.limit ?? 40));
}

/** Rank a small task-relevant shortlist rather than the first directory rows.
 * The active skill is always included; ties are stable across file enumeration.
 */
export function selectRelevantSkills(
  entries: SkillIndexEntry[],
  opts: { activePath: string; query?: string; format?: string; limit?: number },
): SkillIndexEntry[] {
  const activePath = normalizeSkillPath(opts.activePath);
  const candidates = projectSkills(entries, opts.format, activePath);
  const active = candidates.find(e => normalizeSkillPath(e.relativePath) === activePath);
  const category = active?.category || activePath.split("/")[0];
  const words = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter(word => word.length > 1 && !["skill", "skills", "md"].includes(word));
  const query = new Set(words(`${opts.query || ""} ${active?.name || ""} ${activePath}`));
  const ranked = candidates.map(entry => {
    const path = normalizeSkillPath(entry.relativePath);
    const sameDomain = (entry.category || path.split("/")[0]) === category;
    const terms = new Set(words(`${entry.name} ${path} ${entry.description}`));
    const relevance = [...query].filter(word => terms.has(word)).length;
    const isActive = path === activePath;
    return { entry, score: (isActive ? 10000 : 0) + (sameDomain ? 20 : 0) + relevance * 5,
      relevant: isActive || sameDomain || relevance > 0 };
  }).filter(row => row.relevant)
    .sort((a, b) => b.score - a.score || a.entry.relativePath.localeCompare(b.entry.relativePath));
  return ranked.slice(0, Math.max(1, Math.min(10, opts.limit ?? 8))).map(row => row.entry);
}

/** 系统提示用的技能目录短表（含 relativePath，避免模型猜路径） */
export function formatSkillCatalogForPrompt(
  entries: SkillIndexEntry[],
  limit = 40,
  opts: { format?: string; categories?: string[]; activePath?: string; query?: string; fullList?: boolean } = {},
): string {
  const filtered = opts.activePath && !opts.fullList
    ? selectRelevantSkills(entries, { ...opts, activePath: opts.activePath, limit })
    : filterSkillsForAgent(entries, { ...opts, limit });
  const rows = filtered.map(
    (e) => `- ${e.name} | ${e.relativePath} | ${e.description}`,
  );
  return [
    "## Available Skills (progressive disclosure)",
    "Call skill_read with relativePath（或 name）。路径见每行中间一列。",
    "关联门禁名（如 LogicAck）用 gate_run 查询；目录列出的 SKILL.md 路径用 skill_read 读取。",
    ...rows,
    entries.length > filtered.length ? "…更多技能可用 skill_list 提高 limit 查看；传 allFormats: true 可跨格式浏览。" : "",
  ]
    .filter(Boolean)
    .join("\n");
}
