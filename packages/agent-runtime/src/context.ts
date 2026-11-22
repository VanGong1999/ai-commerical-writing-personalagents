import { ContextBudgetError } from "./contextSlots.ts";

/**
 * 上下文压缩（ Hermes 启发）。
 * NC（永不压缩）：system / tools / skills meta / memory files / date / cwd
 * C（可压缩）：user / assistant / tool 历史
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
  [k: string]: unknown;
};

export type CompactionConfig = {
  /** 触发压缩的估算 token 阈值（默认 ~24k） */
  triggerTokens?: number;
  /** 保留尾部最近估算 tokens（默认 ~2k） */
  keepTailTokens?: number;
  /** Exact suffix boundary supplied only for a reconstructed provider history. */
  preserveFrom?: ChatMessage;
  /** 保护头部前 N 条 user 消息 */
  keepHeadUserMessages?: number;
  /** 模型有效窗口（上下文长 − 最大输出）；与 triggerRatio 联用，取更早者触发 */
  effectiveWindowTokens?: number;
  /** 占有效窗口比例触发（Hermes 50%） */
  triggerRatio?: number;
  /** 累计压缩多少次后改走 Handoff/Reset（保持锐度） */
  handoffAfterCompactions?: number;
  /** 压缩后仍高于有效窗口该比例时直接 Handoff */
  resetRatio?: number;
};

export type CompactionResult = {
  messages: ChatMessage[];
  compacted: boolean;
  summary?: string;
  estimatedBefore: number;
  estimatedAfter: number;
};

/** Conservative mixed-script estimate, not a provider tokenizer. ASCII prose
 * averages four chars/token; non-ASCII text and emoji need larger budgets.
 */
export function estimateTextTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    const point = char.codePointAt(0)!;
    tokens += point <= 0x7f ? 0.25 : (point >= 0x1f000 || /\p{Extended_Pictographic}/u.test(char)) ? 3 : 1.5;
  }
  return Math.ceil(tokens);
}

export function estimateTokens(messages: ChatMessage[]): number {
  let tokens = 0;
  for (const m of messages) {
    tokens += 4; // role/message framing
    if (typeof m.content === "string") tokens += estimateTextTokens(m.content);
    if (Array.isArray(m.content)) {
      for (const part of m.content as Array<{ type?: string; text?: string }>) {
        if (part.type === "image_url") tokens += 1200;
        else if (part.text) tokens += estimateTextTokens(part.text);
      }
    }
    if (m.tool_calls) tokens += estimateTextTokens(JSON.stringify(m.tool_calls));
    if (m.tool_call_id) tokens += estimateTextTokens(m.tool_call_id);
    if (typeof m.reasoning_content === "string") tokens += estimateTextTokens(m.reasoning_content);
    if (m.reasoning_details) tokens += estimateTextTokens(JSON.stringify(m.reasoning_details));
  }
  return tokens;
}

function isCompressible(m: ChatMessage): boolean {
  return m.role === "user" || m.role === "assistant" || m.role === "tool";
}

/**
 * 切割边界：只能在 user/assistant 边界切，绝不能让尾部以孤立 tool result 开头。
 * 若切点落在 tool 消息上，向前回退到所属 assistant，完整保留最近工具组。
 */
function findSafeCutIndex(messages: ChatMessage[], keepFromEnd: number): number {
  if (messages.length === 0) return 0;
  let cut = Math.max(0, messages.length - keepFromEnd);
  while (cut > 0 && messages[cut]?.role === "tool") {
    cut -= 1;
  }
  return cut;
}

export const COMPACTION_HEADER = "## Compacted Context";

export function isCompactionSummary(text: string): boolean {
  return text.startsWith(COMPACTION_HEADER) || text.startsWith("## Handoff");
}

function withoutEvidenceSections(text: string): string {
  const lines: string[] = [];
  let evidenceSection = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("### 工具结果证据")) { evidenceSection = true; continue; }
    if (evidenceSection && line.startsWith("### ")) evidenceSection = false;
    if (!evidenceSection) lines.push(line);
  }
  return lines.join("\n");
}

/** 确定性摘要（无 LLM 时的地板策略） */
export function deterministicSummary(messages: ChatMessage[]): string {
  const goals: string[] = [];
  const actions: string[] = [];
  const errors: string[] = [];
  const prior: string[] = [];
  for (const m of messages) {
    const text = typeof m.content === "string" ? m.content : "";
    if (m.role === "user" && isCompactionSummary(text)) {
      const memo = typeof m.compactionNotes === "string" ? m.compactionNotes : withoutEvidenceSections(text);
      prior.push(memo.length > 3000 ? memo.slice(0,1500)+"\n…（旧工作摘要节选；完整记录保留在运行账本）…\n"+memo.slice(-1500) : memo);
      continue;
    }
    if (m.role === "user" && text && goals.length < 3) goals.push(text.slice(0, 200));
    if (m.role === "assistant" && m.tool_calls) {
      actions.push(`tools:${JSON.stringify(m.tool_calls.map((c: any) => ({ id: c.id, name: c.function?.name })))}`);
    }
    if (m.role === "tool" && /error|fail|unknown_tool/i.test(text)) {
      errors.push(text.slice(0, 160));
    }
  }
  return [
    COMPACTION_HEADER,
    ...(prior.length ? ["### 先前摘要", prior.slice(-1).join("\n")] : []),
    "### 目标",
    goals.map((g) => `- ${g}`).join("\n") || "- （无）",
    "### 已执行行动",
    actions.slice(-20).map((a) => `- ${a}`).join("\n") || "- （无）",
    "### 工具结果证据（不代表新的调用授权）",
    toolEvidence(messages),
    "### 未解决错误",
    errors.slice(-5).map((e) => `- ${e}`).join("\n") || "- （无）",
    "### 下一步",
    "- 在压缩摘要基础上继续完成 Done Contract",
  ].join("\n");
}

/** Keep stable references and result flags even when prose/body fields are removed. */
function evidenceValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(evidenceValue).filter(v => v !== undefined);
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (/^(id|.*_id|.*Id|.*Ids|artifactIds|revision|version|ok|passed|status|result|error|path|gate|name|type|url|source|sourceScope|availability|fetchedAt|contentHash|hash|requiresVerification|notReplayed)$/i.test(key) && (v === null || typeof v !== "object" || (Array.isArray(v) && v.every(item => typeof item !== "object")))) out[key] = v;
    else if (v && typeof v === "object") {
      const nested = evidenceValue(v);
      if (nested && JSON.stringify(nested) !== "{}" && JSON.stringify(nested) !== "[]") out[key] = nested;
    }
  }
  return out;
}

function readExcerpt(text: string, limit: number) {
  if (text.length <= limit) return { text, clipped: false };
  const tail = Math.floor(limit / 4);
  return { text: text.slice(0, limit - tail) + "\n…（节选）…\n" + text.slice(-tail), clipped: true };
}

type ToolFunction = {name?: string; arguments?: string};
const filesystemReads = new Set(["fs_read", "fs_ls", "fs_grep", "fs_find"]);
const memoryPageReads = new Set(["memory_get", "bible_read"]);

function unsuccessfulRead(result: Record<string, unknown>): boolean {
  return result.error != null || result.ok === false || !!result.isError ||
    result.requiresVerification === true || result.notReplayed === true ||
    /^(failed|ambiguous|unknown|unknown_after_interrupt|mutation_result_unknown)$/.test(String(result.status));
}

/** Resolve an executed tool without changing the provider's original call. */
export function executedToolFunction(fn?: ToolFunction): ToolFunction | undefined {
  if (!fn?.name) return;
  const normalize = (name:string) => name.trim().replace(/\./g, "_").toLowerCase();
  const name = normalize(fn.name);
  if (name !== "tool_invoke") return {...fn, name};
  try {
    const arg = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments;
    if (typeof arg?.name === "string")
      return {name:normalize(arg.name), arguments:typeof arg.args === "string" ? arg.args : JSON.stringify(arg.args)};
  } catch { /* Invalid wrappers do not establish a read. */ }
}

function resultFunctions(messages: ChatMessage[]): Map<ChatMessage, ToolFunction> {
  const owners = new Map<ChatMessage, ToolFunction>();
  const round = new Map<string, ToolFunction>();
  for (const m of messages) {
    if (m.role === "assistant") {
      round.clear();
      for (const call of (m.tool_calls || []) as {id:string; function?:ToolFunction}[]) {
        const executed = executedToolFunction(call.function);
        if (!executed || !call.id) continue;
        round.set(call.id, executed);
      }
    } else if (m.role === "tool" && m.tool_call_id) {
      const owner = round.get(m.tool_call_id);
      if (owner) owners.set(m, owner);
      round.delete(m.tool_call_id);
    }
  }
  return owners;
}

function filesystemReadObservation(text: string, call: ToolFunction) {
  const args = JSON.parse(call.arguments || "{}");
  const path = typeof args?.path === "string" ? args.path : undefined;
  if (call.name === "fs_read") {
    if (!path) return;
    const header = /^内容版本 hash=([a-f0-9]{64})(（只读）)?\n/.exec(text);
    const numbered = header ? text.slice(header[0].length) : text;
    const lines = numbered.split("\n");
    const start = Number(/^([1-9]\d*)\|/.exec(lines[0])?.[1]);
    const end = start + lines.length - 1;
    if (!Number.isSafeInteger(end) || !lines.every((line, i) => line.startsWith(`${start + i}|`))) return;
    return {
      historical: true,
      requested: {path, offset:args.offset, limit:args.limit},
      observedLines: [start, end],
      excerpt: readExcerpt(numbered, 1200),
      ...(header ? {hash:header[1], ...(header[2] ? {readOnly:true} : {})} : {}),
    };
  }

  const page = JSON.parse(text);
  if (!page || unsuccessfulRead(page)) return;
  const matches = call.name === "fs_ls" ? page.entries : call.name === "fs_grep" ? page.hits : page.paths;
  if (!Array.isArray(matches)) return;
  const paths = [...new Set(matches.map(item => typeof item === "string" ? item : item?.path)
    .filter(path => typeof path === "string"))].slice(0, 6);
  return {
    historical: true,
    requested: {path, pattern:args?.pattern, glob:args?.glob},
    path: typeof page.path === "string" ? page.path : undefined,
    returnedCount: matches.length,
    paths,
  };
}

function memoryPageObservation(page: Record<string, unknown>, call: ToolFunction) {
  const args = JSON.parse(call.arguments || "{}");
  const { path, content, truncated, nextOffset } = page;
  if (typeof args?.path !== "string" || !args.path.trim() || typeof path !== "string" ||
      !path.startsWith("/memories/") || typeof content !== "string" || typeof truncated !== "boolean") return;

  // Match the worker and sliceLines defaults, floors and bounds.
  const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
  const limit = Math.max(1, Math.floor(Number(args.limit) || 800));
  const lines = content.split("\n").length;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(limit) || lines > limit) return;
  if (truncated ? !Number.isSafeInteger(nextOffset) || lines !== limit || nextOffset !== offset + lines
                : nextOffset !== null) return;

  return {
    historical: true, path, requested: { offset, limit }, truncated, nextOffset,
    ...(typeof page.hash === "string" && page.hash ? { hash: page.hash } : {}),
    ...(typeof page.isHypothesis === "boolean" ? { isHypothesis: page.isHypothesis } : {}),
    ...(typeof page.sourceRunId === "string" ? { sourceRunId: page.sourceRunId } : {}),
    ...(typeof page.updatedAt === "string" ? { updatedAt: page.updatedAt } : {}),
    // An empty final string may be an empty line or an offset beyond EOF.
    ...(!content && !truncated ? { empty: true } : {}),
    excerpt: readExcerpt(content, 2300),
  };
}

/** Use the actual read page for working notes before micro-compaction drops its body. */
function readObservation(raw: ChatMessage, call?: { name?: string; arguments?: string }) {
  if (raw.failedRead || unsuccessfulRead(raw) || raw.role !== "tool" || typeof raw.content !== "string" || !call?.name) return;
  try {
    if (filesystemReads.has(call.name)) return filesystemReadObservation(raw.content, call);
    const memoryPage = memoryPageReads.has(call.name);
    if (!memoryPage && call.name !== "skill_read" && call.name !== "artifact_list") return;
    const page = JSON.parse(raw.content);
    if (!page || unsuccessfulRead(page)) return;
    if (memoryPage) return memoryPageObservation(page, call);
    if (call.name === "skill_read") {
      if (typeof page.body === "string" && typeof page.relativePath === "string") {
        return { relativePath: page.relativePath, body: readExcerpt(page.body, 1800) };
      }
      return;
    }
    if (!Array.isArray(page.artifacts)) return;
    const args = JSON.parse(call.arguments || "{}");
    const selected: Record<string, unknown>[] = page.artifacts.slice(0, 3);
    const excerptLimit = Math.floor(2300 / Math.max(1, selected.length));
    return {
      query: { artifactId: args.artifactId, type: args.type },
      offset: page.offset, count: page.count, returnedCount: page.returnedCount,
      hasMore: page.hasMore, nextOffset: page.nextOffset,
      omittedFromNotes: page.artifacts.length - selected.length,
      artifacts: selected.map(item => {
        let body: { markdown?: ReturnType<typeof readExcerpt>; jsonExcerpt?: ReturnType<typeof readExcerpt> } | undefined;
        if (typeof item.bodyMarkdown === "string" && item.bodyMarkdown) {
          body = { markdown: readExcerpt(item.bodyMarkdown, excerptLimit) };
        } else if (typeof item.bodyJsonText === "string" && item.bodyJsonText) {
          body = { jsonExcerpt: readExcerpt(item.bodyJsonText, excerptLimit) };
        } else if (item.bodyJson != null) {
          body = { jsonExcerpt: readExcerpt(JSON.stringify(item.bodyJson), excerptLimit) };
        }
        return {
          id: item.id, version: item.version, type: item.type,
          title: typeof item.title === "string" ? item.title.slice(0, 200) : undefined,
          bodyCoverage: item.bodyCoverage,
          ...body,
        };
      }),
    };
  } catch { /* Errors and nonstandard results keep the ordinary receipt path. */ }
}

type ReadFact = {
  id: string; version: number; type: string;
  pages: { field: string; unit: string; total: number; ranges: number[][] }[];
  episode?: { episodeNo: number; summary: string; beats: string[]; cliffDetail: string };
};

// Only native tool results and previously derived internal facts enter this index.
// Intervals describe delivered bytes at a version. Only episode fields carry prose.
function groundedReadFacts(messages: ChatMessage[], calls: Map<ChatMessage, ToolFunction>): ReadFact[] {
  const facts = new Map<string, ReadFact>();
  function add(fact: ReadFact) {
    const key = JSON.stringify([fact.id, fact.version]);
    const prior = facts.get(key);
    const pages = (prior?.pages || []).map(page => ({...page}));
    for (const page of fact.pages) {
      const existing = pages.find(p => p.field === page.field && p.unit === page.unit && p.total === page.total);
      if (!existing) { pages.push({...page, ranges:page.ranges.map(r => [...r])}); continue; }
      const merged: number[][] = [];
      for (const [start, end] of [...existing.ranges, ...page.ranges].sort((a,b) => a[0]-b[0])) {
        const last = merged.at(-1);
        if (last && last[1] >= start) last[1] = Math.max(last[1], end);
        else merged.push([start, end]);
      }
      existing.ranges = merged;
    }
    facts.delete(key);
    facts.set(key, {...prior, ...fact, pages});
  }
  for (const m of messages) {
    if (Array.isArray(m.groundedReads)) m.groundedReads.forEach(add);
    if (m.failedRead || m.role !== "tool" || calls.get(m)?.name !== "artifact_list" || !m.content) continue;
    let page;
    try { page = JSON.parse(m.content); } catch { continue; }
    if (!page || page.error || page.ok === false || !Array.isArray(page.artifacts)) continue;
    for (const item of page.artifacts) {
      if (!item || typeof item.id !== "string" || !Number.isSafeInteger(item.version)) continue;
      const fact: ReadFact = {id:item.id, version:item.version, type:item.type, pages:[]};
      for (const field of ["markdown","json"]) {
        const c = item.bodyCoverage?.[field];
        if (c?.offsetUnit !== "UTF-16" || ![c.offset,c.end,c.totalChars].every(Number.isSafeInteger) ||
            c.offset < 0 || c.end <= c.offset || c.end > c.totalChars) continue;
        fact.pages.push({field,unit:c.offsetUnit,total:c.totalChars,ranges:[[c.offset,c.end]]});
      }
      const body = item.bodyJson;
      if (item.type === "episode_outline" && Number.isSafeInteger(body?.episodeNo) &&
          typeof body.summary === "string" && body.summary && Array.isArray(body.beats) &&
          body.beats.every((b: unknown) => typeof b === "string")) {
        const episode = {episodeNo:body.episodeNo, summary:body.summary, beats:body.beats,
          cliffDetail:typeof body.cliffDetail === "string" ? body.cliffDetail : ""};
        if (JSON.stringify(episode).length <= 1800) fact.episode = episode;
      }
      if (fact.pages.length || fact.episode) add(fact);
    }
  }
  return [...facts.values()];
}

function toolEvidenceRows(messages: ChatMessage[]) {
  const calls = resultFunctions(messages);
  return messages.filter(m => m.role === "tool").map(m => {
    const name = calls.get(m)?.name || m.name;
    const isFilesystemRead = filesystemReads.has(String(name));
    const observation = m.compactionReadObservation;
    let failedRead = isFilesystemRead && m.failedRead === true;
    let result: unknown;
    if (isFilesystemRead && observation) {
      result = {};
    } else {
      try {
        const parsed = JSON.parse(String(m.content || ""));
        result = evidenceValue(parsed);
        if (isFilesystemRead) {
          failedRead ||= parsed?.isError === true;
          if (parsed?.truncated === true && typeof parsed.excerpt === "string" &&
              (failedRead || /\bERROR\b/i.test(parsed.excerpt))) {
            failedRead = true;
            result = {...(result as object), excerpt:parsed.excerpt.slice(0, 200)};
          }
        }
      } catch { result = { excerpt: String(m.content || "").slice(0, 200) }; }
    }
    return {tool_call_id:m.tool_call_id, name, result, observation, ...(failedRead ? {failedRead} : {})};
  });
}

function toolEvidence(messages: ChatMessage[]): string {
  return toolEvidenceRows(messages).map(row => JSON.stringify(row)).join("\n");
}

/**
 * 预压缩旧工具结果：把长 tool 输出改写成短描述（零 LLM 成本）。
 */
export function microCompactToolResults(
  messages: ChatMessage[],
  maxToolChars = 1200,
): ChatMessage[] {
  let latestAssistant = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "assistant") { latestAssistant = i; break; }
  return messages.map((m, index) => {
    if (index >= latestAssistant && latestAssistant >= 0) return m;
    if (m.role !== "tool" || typeof m.content !== "string") return m;
    if (m.content.length <= maxToolChars) return m;
    let evidence: unknown;
    try { evidence = evidenceValue(JSON.parse(m.content)); } catch { /* prose output */ }
    const head = m.content.slice(0, 400);
    const tail = m.content.slice(-200);
    return {
      ...m,
      content: JSON.stringify({ evidence, truncated: true, originalChars: m.content.length, excerpt: `${head}\n…[tool output truncated]…\n${tail}` }),
    };
  });
}

type CompactionPlan = {
  nc: ChatMessage[];
  head: ChatMessage[];
  middle: ChatMessage[];
  retired: ChatMessage[];
  tail: ChatMessage[];
  estimatedBefore: number;
  reads: ReadFact[];
};

/** 有效触发阈值：绝对 token 阈值与「窗口比例」取更早者 */
export function resolveTrigger(cfg: CompactionConfig = {}): number {
  const abs = cfg.triggerTokens ?? 24_000;
  if (cfg.effectiveWindowTokens && cfg.triggerRatio) {
    return Math.min(abs, Math.floor(cfg.effectiveWindowTokens * cfg.triggerRatio));
  }
  return abs;
}

function planCompaction(messages: ChatMessage[], cfg: CompactionConfig): CompactionPlan | { skip: ChatMessage[]; estimatedBefore: number } {
  const trigger = resolveTrigger(cfg);
  const keepTail = cfg.keepTailTokens ?? 2_000;
  // User instructions are authoritative; never silently clip later steering.

  const estimatedBefore = estimateTokens(messages);
  // The worker sends the original transcript when compaction is skipped.
  if (estimatedBefore < trigger) return { skip: messages, estimatedBefore };
  const boundary = cfg.preserveFrom ? messages.indexOf(cfg.preserveFrom) : -1;
  const prefix = boundary < 0 ? messages : messages.slice(0, boundary);
  const suffix = boundary < 0 ? [] : messages.slice(boundary);
  const working = microCompactToolResults(prefix);

  const nc: ChatMessage[] = [];
  const compressible: ChatMessage[] = [];
  for (const m of working) {
    if (m.role === "system" || !isCompressible(m)) nc.push(m);
    else compressible.push(m);
  }

  // 保护头部 user（先前的压缩摘要不占头部名额，以便被迭代合并）
  const head: ChatMessage[] = [];
  const rest: ChatMessage[] = [];
  const followUps = new Set<ChatMessage>();
  for (const m of compressible) {
    const isSummary = m.role === "user" && typeof m.content === "string" && isCompactionSummary(m.content);
    if (m.role === "user" && !isSummary) {
      if (head.length || rest.length) followUps.add(m);
      else head.push(m);
    } else {
      rest.push(m);
    }
  }

  // 从尾部按 token 预算保留
  const tailBuf: ChatMessage[] = [];
  let tailTokens = 0;
  for (let i = rest.length - 1; i >= 0; i -= 1) {
    const t = estimateTokens([rest[i]]);
    if (tailBuf.length && tailTokens + t > keepTail) break;
    tailBuf.unshift(rest[i]);
    tailTokens += t;
  }

  const keepCount = Math.min(rest.length, Math.max(1, tailBuf.length));
  let cutStart = boundary < 0 ? findSafeCutIndex(rest, keepCount) : rest.length;
  const calls = resultFunctions(prefix);
  const originals = new Map<ChatMessage, ChatMessage>();
  for (const [index, m] of working.entries()) {
    if (m !== messages[index]) originals.set(m, messages[index]);
  }
  function withReadObservation(m: ChatMessage): ChatMessage {
    const raw = originals.get(m) || m;
    const observation = readObservation(raw, calls.get(raw));
    // A nonstandard tool result can contain arbitrarily long metadata. Keep
    // the ordinary receipt path for it, without expanding the summary request.
    return observation && JSON.stringify(observation).length <= 4800
      ? { ...m, compactionReadObservation: observation } : m;
  }
  // Once a clipped result enters the native tail its original page is gone.
  // Summarize through its whole round now. The newest round is never clipped.
  for (let i = rest.length - 1; i >= cutStart; i--) {
    if (!originals.has(rest[i]) || withReadObservation(rest[i]) === rest[i]) continue;
    cutStart = i + 1;
    while (rest[cutStart]?.role === "tool") cutStart++;
    break;
  }
  // Keep later user directions in sequence with retained native tool rounds.
  const tail = new Set(rest.slice(cutStart));
  const middle = rest.slice(0, cutStart);
  // A large pinned task or latest tool group can exceed the trigger by
  // itself. Re-summarizing only a prior memo cannot retire another round.
  if (!middle.some(m => m.role === "assistant" || m.role === "tool")) {
    return { skip: messages, estimatedBefore };
  }
  const retired = middle.map(m => originals.get(m) || m);
  return {
    nc,
    head,
    reads: groundedReadFacts(retired, calls),
    middle: middle.map(withReadObservation),
    retired,
    tail: [...compressible.filter(m => tail.has(m) || followUps.has(m)), ...suffix],
    estimatedBefore,
  };
}

/** Consolidate grounded evidence, not a recursive archive of every old memo. */
function finishCompaction(plan: CompactionPlan, summaryText: string): CompactionResult {
  const records = new Map<string, unknown>();
  const remember = (value: unknown) => {
    if (value && typeof value === "object" && "tool_call_id" in value) records.set(JSON.stringify(value), value);
  };
  for (const m of plan.middle) {
    if (Array.isArray(m.compactionEvidence)) m.compactionEvidence.forEach(remember);
    else if (m.role === "user" && typeof m.content === "string" && isCompactionSummary(m.content)) {
      // Migrate older persisted summaries without nesting their whole text.
      for (const line of m.content.split("\n")) {
        try { remember(JSON.parse(line)); } catch { /* ordinary prose */ }
      }
    }
  }
  for (const line of toolEvidence(plan.middle).split("\n")) {
    try { remember(JSON.parse(line)); } catch { /* no tool evidence */ }
  }
  // Budget stable receipts first. A long read excerpt must never evict a write
  // or the references and verification status of another retained receipt.
  const observations = new Map<Record<string, unknown>, unknown>();
  const allEvidence = [...records.values()].map(value => {
    const { observation, ...receipt } = value as Record<string, unknown>;
    if (observation) observations.set(receipt, observation);
    return receipt;
  });
  const readNames = new Set(["artifact_list","bible_read","memory_get","memory_search","memory_grep","memory_list","kb_read","kb_search","skill_read","skill_list","tool_search","tool_schema_get","project_get",...filesystemReads]);
  const uncertain = (row: Record<string, unknown>) =>
    row.failedRead === true || /"ok":false|"passed":false|"requiresVerification":true|"error":|conflict|mutation_result_unknown|"result":"fail"|"status":"(?:failed|ambiguous|unknown|unknown_after_interrupt)"|\bERROR\b/i.test(JSON.stringify(row.result));
  const reads = allEvidence.filter(row => readNames.has(String(row.name || "")) && !uncertain(row));
  const recentReads = new Set(reads.slice(-8));
  function entityKey(row: Record<string, unknown>): string | undefined {
    const r = row.result as Record<string, unknown> | undefined;
    if (!r || uncertain(row)) return;
    const id = r.artifactId ?? r.artifact_id ?? r.id;
    if (typeof id === "string" && typeof (r.version ?? r.revision) === "number") return JSON.stringify([row.name,id]);
  }
  const seen = new Set<string>();
  let chars = 0;
  const retained = new Set<Record<string,unknown>>();
  const retain = (row: Record<string,unknown>) => {
    retained.add(row);
    chars += JSON.stringify(row).length + 1;
  };
  const recentFailures = new Set(allEvidence.filter(uncertain).slice(-6));
  for (const row of allEvidence.filter(uncertain)) {
    const name = String(row.name);
    if (recentFailures.has(row) || filesystemReads.has(name) || (!readNames.has(name) && name !== "gate_run")) retain(row);
  }
  const newestFirst = [...allEvidence].reverse();
  const nonReads = newestFirst.filter(row => !readNames.has(String(row.name)));
  const candidates = nonReads.filter(row => entityKey(row)).concat(nonReads.filter(row => !entityKey(row)), reads.slice().reverse());
  for (const row of candidates) {
    if (retained.has(row) || uncertain(row) || (readNames.has(String(row.name)) && !recentReads.has(row))) continue;
    const key = entityKey(row);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const size = JSON.stringify(row).length;
    if (size > 12000) throw new ContextBudgetError("compaction_evidence",size,12000);
    if (chars + size + 1 <= 12000) retain(row);
  }
  // Share the receipt budget with reusable versioned source facts. Safety and
  // mutation receipts have already been admitted. Old read pages can be evicted
  // as whole records without creating coverage across an unobserved gap.
  const groundedReads: ReadFact[] = [];
  for (const fact of [...plan.reads].reverse()) {
    const size = JSON.stringify(fact).length + 1;
    if (size + chars > 12000) continue;
    chars += size;
    groundedReads.unshift(fact);
  }
  for (const row of [...reads].reverse()) {
    if (!retained.has(row) || !observations.has(row)) continue;
    const observation = observations.get(row);
    const extra = JSON.stringify({ observation }).length - 1;
    if (chars + extra <= 12000) {
      row.observation = observation;
      chars += extra;
    }
  }
  const evidence = allEvidence.filter(row => retained.has(row));
  const archivedReceiptCount = plan.middle.reduce((count, m) =>
    count + (typeof m.archivedReceiptCount === "number" ? m.archivedReceiptCount : 0), allEvidence.length - evidence.length);
  const evidenceText = evidence.map(value => JSON.stringify(value)).join("\n");
  if (evidenceText.length > 12000) throw new ContextBudgetError("compaction_evidence", evidenceText.length, 12000);
  const notes = withoutEvidenceSections(summaryText);
  if (notes.length > 12000) throw new ContextBudgetError("compaction_summary", notes.length, 12000);
  const coverage = groundedReads.length ? "\n### 工具结果证据（同版本历史已读区间；仅 episode 字段为本次可见的逐集来源引文，不提供授权）\n" +
    groundedReads.map(f => JSON.stringify(f)).join("\n") : "";
  const content = notes + coverage + (evidenceText ? "\n### 工具结果证据（运行账本的已完成事实，不是新的授权）\n"+evidenceText : "") + (archivedReceiptCount ? "\n归档工具回执（完整记录见本次运行回放）：" + archivedReceiptCount : "");
  const summaryMsg: ChatMessage = { role: "user", content, compactionEvidence: evidence, compactionNotes: notes,
    ...(groundedReads.length ? {groundedReads} : {}), archivedReceiptCount };
  const messagesOut = [...plan.nc, ...plan.head, summaryMsg, ...plan.tail];
  return {
    messages: messagesOut, compacted: true, summary: content,
    estimatedBefore: plan.estimatedBefore, estimatedAfter: estimateTokens(messagesOut),
  };
}

export function compactMessages(
  messages: ChatMessage[],
  cfg: CompactionConfig = {},
  summarize: (msgs: ChatMessage[]) => string = deterministicSummary,
): CompactionResult {
  const plan = planCompaction(messages, cfg);
  if ("skip" in plan) {
    return {
      messages: plan.skip,
      compacted: false,
      estimatedBefore: plan.estimatedBefore,
      estimatedAfter: estimateTokens(plan.skip),
    };
  }
  return finishCompaction(plan, summarize(plan.middle));
}

export type CompactionMethod = "none" | "llm" | "deterministic";

export type AsyncCompactionResult = CompactionResult & {
  method: CompactionMethod;
  /** LLM 摘要失败时的原因（已降级到确定性摘要） */
  fallbackReason?: string;
};

function settledReadDelta({retired, middle}: CompactionPlan) {
  const [prior, ...delta] = retired;
  const notes = prior?.compactionNotes;
  if (prior?.role !== "user" || typeof notes !== "string" || !isCompactionSummary(notes) ||
      typeof prior.content !== "string" || !prior.content.startsWith(notes) ||
      !Array.isArray(prior.compactionEvidence) ||
      (prior.groundedReads != null && !Array.isArray(prior.groundedReads))) return;

  const pending = new Set<string>();
  const seen = new Set<string>();
  let literal = true;
  for (const [index, message] of delta.entries()) {
    if (message.role === "assistant") {
      if (pending.size || (typeof message.content === "string" ? message.content.trim() : message.content) ||
          message.reasoning_content || message.reasoning_details || !message.tool_calls?.length) return;
      for (const call of message.tool_calls as {id:string; function?:ToolFunction}[]) {
        const name = executedToolFunction(call.function)?.name;
        if (!call.id || seen.has(call.id) || !name ||
            !(memoryPageReads.has(name) || name === "artifact_list" || name === "fs_read" || name === "skill_read")) return;
        seen.add(call.id);
        pending.add(call.id);
      }
      continue;
    }
    const id = message.tool_call_id;
    const observation = middle[index + 1].compactionReadObservation as ReturnType<typeof readObservation>;
    if (message.role !== "tool" || !id || !pending.delete(id) ||
        !observation || observation === message.compactionReadObservation) return;

    if ("artifacts" in observation && observation.artifacts) {
      const page = JSON.parse(String(message.content));
      if (page.returnedCount !== page.artifacts.length || page.artifacts.some((item: Record<string, unknown> | null) =>
        item === null || typeof item !== "object" || typeof item.id !== "string" ||
        !Number.isSafeInteger(item.version) || typeof item.type !== "string")) return;
    }
    if (!("excerpt" in observation)) {
      // Skill and artifact observations omit native constraints or catalog
      // fields. Keep the original successful response on the soft path.
      literal = false;
      continue;
    }
    literal &&= !observation.excerpt.clipped;
    if (literal && "truncated" in observation) {
      // bible_read can also return metadata from the original memory row.
      const {content, ...metadata} = JSON.parse(String(message.content));
      const observed: Record<string, unknown> = observation;
      literal = content === observation.excerpt.text && Object.entries(metadata).every(([key, value]) =>
        observed[key] === value || (value === null && observed[key] === undefined &&
          (key === "hash" || key === "sourceRunId" || key === "updatedAt")));
    }
  }
  if (seen.size && !pending.size) return {prior, notes, literal};
}

function compactSettledReads(plan: CompactionPlan, messages: ChatMessage[], cfg: CompactionConfig): AsyncCompactionResult | undefined {
  // The soft trigger is proactive. Preserve the semantic path for a forced
  // retry or when the configured effective-window reset bound is at risk.
  const hardWindow = cfg.effectiveWindowTokens === undefined ? undefined
    : Math.floor(cfg.effectiveWindowTokens * Math.min(cfg.resetRatio || 1, 1));
  if (cfg.triggerTokens === 0 || (hardWindow !== undefined && plan.estimatedBefore >= hardWindow)) return;
  const delta = settledReadDelta(plan);
  if (!delta) return;
  if (delta.literal && plan.tail.every(message => messages.includes(message))) {
    try {
      const candidate = finishCompaction(plan, delta.notes);
      const memo = candidate.messages[plan.nc.length + plan.head.length];
      const admitted = new Set((memo.compactionEvidence as unknown[]).map(row => JSON.stringify(row)));
      const grounded = new Set(((memo.groundedReads ?? []) as ReadFact[]).map(fact => JSON.stringify(fact)));
      const priorGrounded = (delta.prior.groundedReads ?? []) as ReadFact[];
      if (memo.compactionNotes === delta.notes &&
          [...delta.prior.compactionEvidence as unknown[], ...toolEvidenceRows(plan.middle)]
            .every(row => admitted.has(JSON.stringify(row))) &&
          [...priorGrounded, ...plan.reads].every(fact => grounded.has(JSON.stringify(fact)))) {
        return { ...candidate, method: "deterministic" };
      }
    } catch (error) {
      if (!(error instanceof ContextBudgetError)) throw error;
    }
  }
  // A prose summary cannot recreate an omitted literal source. Leave the
  // original transcript intact until a later round or forced context repair.
  return {messages, method:"none", compacted:false,
    estimatedBefore:plan.estimatedBefore, estimatedAfter:plan.estimatedBefore};
}

/**
 * 结构化压缩：已保留的纯读取证据优先本地处理，语义变化走 LLM 摘要。
 * 切点规则与同步版完全一致（绝不在 tool result 处切）。
 */
export async function compactMessagesAsync(
  messages: ChatMessage[],
  cfg: CompactionConfig = {},
  summarizeLlm?: (msgs: ChatMessage[], prompt: { system: string; user: string }) => Promise<string>,
): Promise<AsyncCompactionResult> {
  const plan = planCompaction(messages, cfg);
  if ("skip" in plan) {
    return {
      messages: plan.skip,
      compacted: false,
      method: "none",
      estimatedBefore: plan.estimatedBefore,
      estimatedAfter: estimateTokens(plan.skip),
    };
  }
  const settled = compactSettledReads(plan, messages, cfg);
  if (settled) return settled;
  if (summarizeLlm && plan.middle.length) {
    try {
      const text = (await summarizeLlm(plan.middle, buildCompactionPrompt(plan.middle))).trim();
      if (text && text.length >= 40 && text.length <= 12_000) {
        const body = isCompactionSummary(text) ? text : `${COMPACTION_HEADER}\n${text}`;
        return { ...finishCompaction(plan, body), method: "llm" };
      }
      return {
        ...finishCompaction(plan, deterministicSummary(plan.middle)),
        method: "deterministic",
        fallbackReason: "llm_summary_empty_or_oversize",
      };
    } catch (err) {
      return {
        ...finishCompaction(plan, deterministicSummary(plan.middle)),
        method: "deterministic",
        fallbackReason: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return { ...finishCompaction(plan, deterministicSummary(plan.middle)), method: "deterministic" };
}

export const COMPACTION_SECTIONS = [
  "目标与用户意图",
  "硬约束与偏好",
  "已完成（含产物 id）",
  "当前状态",
  "阻塞与错误",
  "关键决策与理由",
  "已解决问题",
  "相关文件/产物/记忆路径",
  "背景事实",
  "未决问题",
  "下一步",
] as const;

function renderForSummary(m: ChatMessage): string {
  const text = typeof m.content === "string" ? m.content : "";
  if (m.role === "tool" && m.compactionReadObservation) {
    return `[tool ${m.tool_call_id}] ${JSON.stringify(m.compactionReadObservation)}`;
  }
  if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
    const names = (m.tool_calls as Array<{ function?: { name?: string; arguments?: string } }>)
      .map((c) => `${c.function?.name || "?"}(${String(c.function?.arguments || "").slice(0, 160)})`)
      .join("; ");
    return `[assistant→tools] ${text.slice(0, 300)} ${names}`.trim();
  }
  return `[${m.role}] ${text.slice(0, 1500)}`;
}

/** LLM 摘要提示（system + user）。要求只总结事实，不新增任务，不丢产物 id / 路径。 */
export function buildCompactionPrompt(middle: ChatMessage[]): { system: string; user: string } {
  const system = [
    "你是上下文压缩器。把下面的对话片段压缩成给同一个智能体继续工作用的结构化摘要。",
    "规则：只陈述已发生的事实；不要新增任务；保留所有产物 id、文件/记忆路径、门禁结论、错误信号；",
    "原任务、追加指令和控制面审批不在待压缩片段中，不对用户意图或阶段授权作任何裁定。已读范围以同版本工具覆盖区间为准。",
    "保留已读取技能的执行步骤和产物正文中的关键事实；标明节选和未读页。每段只写要点，总长度不超过 900 字。",
    `必须按以下 ${COMPACTION_SECTIONS.length} 段输出（无内容写“（无）”）：`,
    ...COMPACTION_SECTIONS.map((t, i) => `${i + 1}. ${t}`),
    `输出第一行必须是：${COMPACTION_HEADER}`,
  ].join("\n");
  const user = middle.map(renderForSummary).join("\n");
  return { system, user };
}

export type HandoffInput = {
  runId: string;
  agentId: string;
  /** 本次 run 的原始目标（首条 user 内容） */
  goal: string;
  /** Done Contract 评估的未通过条款提示 */
  doneGap?: string;
  /** 已产出的 artifact id */
  artifactIds?: string[];
  /** 最近一次压缩摘要或确定性摘要 */
  summary?: string;
  /** 最近若干条 assistant 结论（已截断） */
  recentConclusions?: string[];
  compactions: number;
};

/**
 * Handoff 包：只含「目标 + 差距 + 已产出 + 近期结论」，用于开全新上下文续跑。
 * 不是压缩摘要：不携带工具调用历史、不携带中间推理。
 */
export function buildHandoffPack(h: HandoffInput): string {
  const lines = [
    "## Handoff（全新上下文续跑）",
    `- run: ${h.runId} / agent: ${h.agentId} / 已压缩 ${h.compactions} 次后重置`,
    "### 目标",
    h.goal || "（无）",
    "### Done Contract 差距",
    h.doneGap || "（未知，先调用 done_check）",
    "### 已产出 artifact",
    h.artifactIds?.length ? h.artifactIds.map((id) => `- ${id}`).join("\n") : "（无）",
    "### 近期结论",
    h.recentConclusions?.length ? h.recentConclusions.slice(-5).map((c) => `- ${c.slice(0, 300)}`).join("\n") : "（无）",
  ];
  if (h.summary) {
    lines.push("### 压缩摘要", h.summary);
  }
  lines.push(
    "### 指令",
    "- 沿用已读技能和产物证据，继续补齐 Done Contract 差距。仅在缺少所需内容、版本可能已变或证据冲突时定向复查。",
    "- 完成后调用 done_check。",
  );
  return lines.join("\n");
}

export type HandoffDecisionInput = {
  compactionsSoFar: number;
  estimatedAfter: number;
  cfg: CompactionConfig;
};

/** 是否应改走 Handoff/Reset：累计压缩次数达标，或压缩后仍高于 resetRatio × 有效窗口 */
export function shouldHandoff(i: HandoffDecisionInput): { handoff: boolean; reason?: string } {
  const after = i.cfg.handoffAfterCompactions;
  if (after && i.compactionsSoFar >= after) {
    return { handoff: true, reason: `compactions>=${after}` };
  }
  if (i.cfg.effectiveWindowTokens && i.cfg.resetRatio) {
    const limit = Math.floor(i.cfg.effectiveWindowTokens * i.cfg.resetRatio);
    if (i.estimatedAfter >= limit) {
      return { handoff: true, reason: `after>=${limit}` };
    }
  }
  return { handoff: false };
}
