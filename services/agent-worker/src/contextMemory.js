/**
 * 运行时记忆接线：把已有的 MemoryStore / mounts / Dream 能力真正挂进每一次 run。
 *
 * 共享 vs 私有（见 docs/agents/12-runtime-contract.md §5）：
 * - 共享：project.{id}.bible（decisions/人设/世界/伏笔）→ core_facts
 * - 私有：agent.{agentId}.lessons 中当前 project 的 procedural 文件 → lessons
 * - 跨项目：仅显式批准的同 Agent 经验路径；不会枚举整个私有 store
 * - org/user RO mounts：保留现有 VFS；用户偏好由 personalization 独立槽位加载
 */

import { ContextBudgetError } from "@xiezuomanju/agent-runtime";
import { readProjectBible } from "./bibleMemory.js";

const coreLimit = Number(process.env.AGENT_CORE_FACTS_CHARS || 12000);
export const CORE_FACTS_BUDGET = Number.isFinite(coreLimit) && coreLimit > 0 ? coreLimit : 12000;
export const LESSONS_BUDGET = Number(process.env.AGENT_LESSONS_CHARS || 1800);
export const LESSONS_FILE_MAX = Number(process.env.AGENT_LESSONS_FILE_MAX || 6000);

export function lessonsPath(projectId, agentId) {
  return `/memories/projects/${projectId}/procedural/${agentId}/lessons.md`;
}

export function lessonsStoreId(agentId) {
  return `agent.${agentId}.lessons`;
}

function clip(text, n) {
  const s = String(text || "").trim();
  return s.length > n ? `${s.slice(0, n - 8)}\n…(截断)` : s;
}

/**
 * 纯函数：把一条经验并入 lessons.md。
 * - 去重（同文忽略）
 * - 超过 maxChars 时丢弃最旧的条目（保留标题）
 */
export function mergeLesson(existing, note, { now = new Date(), maxChars = LESSONS_FILE_MAX, agentId = "" } = {}) {
  const text = String(note || "").replace(/\s+/g, " ").trim();
  if (!text) return { content: String(existing || ""), changed: false, reason: "empty" };
  const header = `# ${agentId || "agent"} 经验（私有，仅本 Agent 读取）`;
  const lines = String(existing || "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l && !l.startsWith("# "));
  if (lines.some((l) => l.replace(/^- \[[^\]]*\]\s*/, "") === text)) {
    return { content: String(existing || ""), changed: false, reason: "duplicate" };
  }
  const day = now.toISOString().slice(0, 10);
  lines.push(`- [${day}] ${text}`);
  let body = lines.join("\n");
  while (body.length + header.length + 1 > maxChars && lines.length > 1) {
    lines.shift();
    body = lines.join("\n");
  }
  return { content: `${header}\n${body}\n`, changed: true };
}

/**
 * 默认只读取当前项目的私有经验。跨项目经验必须由调用方显式筛选批准，
 * 并仍限定同一个 Agent 的 lessons 路径；复用现有 store / Dream / VFS。
 */
export async function loadAgentLessons(api, { projectId, agentId, budget = LESSONS_BUDGET, portableLessonPaths = [] }) {
  const own = lessonsPath(projectId, agentId);
  const approved = Array.isArray(portableLessonPaths) ? portableLessonPaths : [];
  const paths = [...new Set([own, ...approved.filter(path => {
    const segments = String(path || "").split("/");
    return segments.length === 7 && segments[1] === "memories" && segments[2] === "projects"
      && segments[3] && ![".", ".."].includes(segments[3]) && segments[4] === "procedural"
      && segments[5] === agentId && segments[6] === "lessons.md";
  })])];
  const parts = [];
  let used = 0;
  for (const path of paths) {
    const left = budget - used - (parts.length ? 1 : 0);
    if (left <= 0) break;
    let file;
    try { file = await api.getMemoryFile(path); } catch { continue; }
    const content = String(file?.content || "").trim();
    if (!content) continue;
    const piece = clip(content, left);
    parts.push(piece);
    used += piece.length + (parts.length > 1 ? 1 : 0);
  }
  return parts.join("\n");
}

/**
 * Run 启动时一次性装载记忆槽位：
 * 1. bootstrap mounts（org RO + user RO + project RW + agent lessons RW）
 * 2. 共享核心事实（decisions.md）
 * 3. 私有 lessons
 * 挂载/私有经验失败可降级；关键决策超出预算必须显式停止。
 */
export async function bootstrapRunMemory(api, { projectId, agentId, runId, conversationId, portableLessonPaths = [], nested = false, includePersonalization = true }) {
  const memoryOwner = nested ? runId : agentId;
  const out = { mounts: [], coreFacts: "", lessons: "", errors: [] };
  try {
    out.mounts = (await api.bootstrapMemoryMounts(projectId, { agentId: memoryOwner, runId, conversationId })) || [];
  } catch (err) {
    out.errors.push(`mounts:${err?.message || err}`);
  }
  try {
    const decisions = await readProjectBible(projectId, "decisions.md", api, { strictMissing: true });
    if (decisions?.content || decisions?.body) {
      const content = String(decisions.content || decisions.body);
      if (content.length > CORE_FACTS_BUDGET) throw new ContextBudgetError("decisions.md", content.length, CORE_FACTS_BUDGET);
      out.coreFacts = content;
      out.coreSource = { path: decisions.path, version: decisions.updatedAt ?? decisions.updated_at, sourceHash: decisions.hash };
    }
  } catch (error) {
    // Only a confirmed missing file is optional; unavailable locked facts stop the run.
    throw error;
  }
  try {
    if (!nested) out.lessons = await loadAgentLessons(api, { projectId, agentId, portableLessonPaths });
  } catch (err) {
    out.errors.push(`lessons:${err?.message || err}`);
  }
  if (includePersonalization && typeof api.getPersonalizationContext === "function") {
    try { out.personalization = String((await api.getPersonalizationContext(projectId))?.context || "").slice(0,1000); }
    catch (error) { out.errors.push(`personalization:${error?.message || error}`); }
  }
  return out;
}

/**
 * 私有 lessons 接近上限时，自动提一份 Dream 巩固提案（非破坏性：需人/eggbot 审查后合入）。
 * 复用现有 /memory/dreams；失败静默。
 */
export async function maybeProposeLessonsDream(api, { projectId, agentId, ratio = 0.8 }) {
  try {
    const cur = await api.getMemoryFile(lessonsPath(projectId, agentId));
    const size = String(cur?.content || "").length;
    if (size < LESSONS_FILE_MAX * ratio) return { proposed: false, size };
    const open = await api.listDreams({ storeId: lessonsStoreId(agentId) });
    if ((open || []).some((d) => d.status === "ready" || d.status === "running")) {
      return { proposed: false, size, reason: "dream_pending" };
    }
    const job = await api.createDream({
      store_id: lessonsStoreId(agentId),
      project_id: projectId,
      title: `${agentId} 经验巩固`,
    });
    return { proposed: true, size, dreamId: job?.id };
  } catch {
    return { proposed: false };
  }
}
