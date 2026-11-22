/**
 * 上下文 Slot 组装
 * 把 system prompt 拆成固定顺序、可单独哈希的 Slot，保证静态前缀对 KV cache 友好。
 *
 * NC（永不压缩）：role / skill_meta / skill_catalog / tool_index / contract / core_facts / lessons
 * C（可压缩）：messages / delta（不在本文件处理）
 */

import { createHash } from "node:crypto";

export type SlotId =
  | "role"
  | "skill_meta"
  | "skill_catalog"
  | "tool_index"
  | "contract"
  | "core_facts"
  | "lessons"
  | "personalization"
  | "runtime_context";

/** 固定顺序：任何调用方都不得改变，否则前缀缓存全部失效 */
export const SLOT_ORDER: readonly SlotId[] = [
  "role",
  "skill_meta",
  "tool_index",
  "contract",
  // Task-ranked catalog starts the dynamic suffix.
  "skill_catalog",
  "core_facts",
  "lessons",
  "personalization",
  "runtime_context",
] as const;

export type SlotInput = Partial<Record<SlotId, string>>;

export type SlotBudget = Partial<Record<SlotId, number>>;

/** 默认字符预算（必需约束超出时报错，可选槽位截断） */
export const DEFAULT_SLOT_BUDGET: Required<SlotBudget> = {
  role: 1200,
  skill_meta: 1200,
  skill_catalog: 6000,
  tool_index: 3000,
  contract: 2000,
  core_facts: 12_000,
  lessons: 1800,
  personalization: 1100,
  runtime_context: 200,
};

/** Critical constraints must survive verbatim or stop before a model call. */
export class ContextBudgetError extends Error {
  readonly code = "CONTEXT_BUDGET_EXCEEDED";
  readonly slot: string;
  readonly actualChars: number;
  readonly limitChars: number;
  constructor(slot: string, actualChars: number, limitChars: number) {
    super(`必需上下文 ${slot} 超出预算（${actualChars}/${limitChars} 字符）；请拆分任务，或整理已确认决策后重试，不能静默截断锁定约束`);
    this.name = "ContextBudgetError";
    this.slot = slot;
    this.actualChars = actualChars;
    this.limitChars = limitChars;
  }
}

export type AssembledSlot = {
  id: SlotId;
  text: string;
  hash: string;
  chars: number;
  truncated: boolean;
};

export type AssembledPrompt = {
  system: string;
  slots: AssembledSlot[];
  /** 全部 NC Slot 的联合哈希；跨 run 变化 = 缓存失效信号 */
  prefixHash: string;
  /** Stable role/skill/tool/contract bytes before task/project/date data. */
  staticPrefix: string;
  staticPrefixHash: string;
};

export function shortHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
}

/** 日期注入：按天稳定（同一天内前缀不变），保证「明天/下周」可解析 */
export function dateStamp(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

function clip(text: string, budget: number): { text: string; truncated: boolean } {
  if (text.length <= budget) return { text, truncated: false };
  return { text: `${text.slice(0, Math.max(0, budget - 12))}\n…(截断)`, truncated: true };
}

/**
 * 按固定顺序组装 system prompt。空 Slot 不产出文本，但**顺序不变**。
 * 同样输入必得同样输出（纯函数，无时间依赖——日期由调用方放进 runtime_context）。
 */
export function assembleSystemPrompt(
  input: SlotInput,
  budget: SlotBudget = {},
): AssembledPrompt {
  const slots: AssembledSlot[] = [];
  for (const id of SLOT_ORDER) {
    const raw = (input[id] || "").trim();
    if (!raw) continue;
    const limit = budget[id] ?? DEFAULT_SLOT_BUDGET[id];
    if ((id === "role" || id === "skill_meta" || id === "contract" || id === "core_facts") && (!Number.isFinite(limit) || limit < 0 || raw.length > limit)) {
      throw new ContextBudgetError(id, raw.length, limit);
    }
    const { text, truncated } = clip(raw, limit);
    slots.push({ id, text, hash: shortHash(text), chars: text.length, truncated });
  }
  const system = slots.map((s) => s.text).join("\n\n");
  const prefixHash = shortHash(slots.map((s) => `${s.id}:${s.hash}`).join("|"));
  const staticIds: SlotId[] = ["role", "skill_meta", "tool_index", "contract"];
  const staticPrefix = slots.filter(s => staticIds.includes(s.id)).map(s => s.text).join("\n\n");
  return { system, slots, prefixHash, staticPrefix, staticPrefixHash: shortHash(staticPrefix) };
}

/** 工具序列哈希：只依赖有序名称，用于检测 turn 间工具列表是否被重排/删除 */
export function hashToolOrder(names: string[]): string {
  return shortHash(names.join(","));
}

/** 判定相邻两轮工具序列是否「仅追加」（缓存友好）；返回 false 表示前缀被破坏 */
export function isAppendOnly(prev: string[], next: string[]): boolean {
  if (next.length < prev.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    if (prev[i] !== next[i]) return false;
  }
  return true;
}

/** 分段预算摘要，用于 session `context` 事件（只记哈希与长度，不记正文） */
export function describeSlots(p: AssembledPrompt): Record<string, unknown> {
  return {
    prefixHash: p.prefixHash,
    staticPrefixHash: p.staticPrefixHash,
    staticPrefixChars: p.staticPrefix.length,
    slots: p.slots.map((s) => ({ id: s.id, hash: s.hash, chars: s.chars, truncated: s.truncated })),
  };
}
