import { codepointCount } from "../../domain/src/gateRules.ts";
import type { GateCheck } from "./types.js";
export { allPassed, checkLengthDecay, codepointCount, manuscriptLength, checkPromptLockHash, simpleHash } from "../../domain/src/gateRules.ts";

export function checkFormatSelected(fmt?: string | null): GateCheck {
  const allowed = new Set([
    "manju",
    "duanju",
    "short_novel",
    "male_long",
    "female_long",
    "ip_adapt",
  ]);
  if (!fmt || !allowed.has(fmt)) {
    return {
      id: "format_selected",
      name: "格式开关",
      result: "fail",
      message: "未选择合法写作格式，禁止开跑",
    };
  }
  return {
    id: "format_selected",
    name: "格式开关",
    result: "pass",
    message: `格式已选定：${fmt}`,
  };
}

export function checkChunkPolicy(opts: {
  requestedChars?: number;
  maxChars?: number;
  wholeBook?: boolean;
}): GateCheck {
  const maxChars = opts.maxChars ?? 3000;
  if (opts.wholeBook) {
    return {
      id: "chunk_policy",
      name: "分块策略",
      result: "fail",
      message: "禁止一次生成全书/全剧",
    };
  }
  if (opts.requestedChars != null && opts.requestedChars > maxChars) {
    return {
      id: "chunk_policy",
      name: "分块策略",
      result: "fail",
      message: `单次生成超过 ${maxChars} 字上限`,
    };
  }
  return { id: "chunk_policy", name: "分块策略", result: "pass", message: "分块策略合规" };
}

export function checkLogicAck(acked: boolean): GateCheck {
  if (acked !== true) {
    return {
      id: "logic_ack",
      name: "逻辑人工确认",
      result: "fail",
      message: "逻辑门禁不可自动通过，需人工 LogicAck",
    };
  }
  return {
    id: "logic_ack",
    name: "逻辑人工确认",
    result: "pass",
    message: "人工已确认逻辑",
  };
}

/** 字数区间（漫剧分集常用）。±2% 或 ±25 字软边界，吸收 LLM 收尾抖动，避免 1201 反复 gate_run 空转。 */
export function checkLengthBand(text: string, minChars: number, maxChars: number): GateCheck {
  const n = codepointCount(text.trim());
  const slack = Math.max(25, Math.round(maxChars * 0.02));
  const softMin = Math.max(0, minChars - slack);
  const softMax = maxChars + slack;
  if (n < softMin || n > softMax) {
    const target = Math.round((minChars + maxChars) / 2);
    const hint = `请以${minChars === maxChars ? "" : "约"}${target}字为目标，一次${n > maxChars ? "精简" : "补足"}正文后再测量。`;
    return {
      id: "length_band",
      name: "字数区间",
      result: "fail",
      message: `字数 ${n} 不在 [${minChars}, ${maxChars}]（软界 [${softMin}, ${softMax}]）。${hint}`,
    };
  }
  if (n < minChars || n > maxChars) {
    return {
      id: "length_band",
      name: "字数区间",
      result: "pass",
      message: `字数 ${n} 在软边界内（目标 [${minChars}, ${maxChars}]）`,
    };
  }
  return { id: "length_band", name: "字数区间", result: "pass", message: `字数 ${n} 合规` };
}

export function checkHookPresence(_text: string, hookFlag?: boolean | null): GateCheck {
  if (hookFlag === false) {
    return {
      id: "hook_presence",
      name: "集尾钩子",
      result: "warn",
      message: "钩子标记为否，可结合情境复核",
    };
  }
  if (hookFlag === true) {
    return { id: "hook_presence", name: "集尾钩子", result: "pass", message: "已填写肯定钩子标记，效果可结合情境复核" };
  }
  // 关键词和标点都不能证明有无戏剧悬念，交由语义复核。
  return {
    id: "hook_presence",
    name: "集尾钩子",
    result: "warn",
    message: "集尾钩子待语义复核：检查未解决冲突、人物选择与后果；关键词或问号不能作为质量结论",
  };
}

/** 100 字测试人工确认 */
export function checkLogline100Ack(acked: boolean, logline?: string | null): GateCheck {
  const text = (logline || "").trim();
  if (!text) {
    return {
      id: "logline_100_ack",
      name: "100字测试",
      result: "fail",
      message: "缺少 100 字测试文案（须人写/人改，禁 AI 直出简介冒充）",
    };
  }
  // Human approval is mandatory even when an overlength advisory also applies.
  if (acked !== true) {
    return {
      id: "logline_100_ack",
      name: "100字测试",
      result: "fail",
      message: "100 字测试未人工确认，不可进人设/大纲",
    };
  }
  if (codepointCount(text) > 120) {
    return {
      id: "logline_100_ack",
      name: "100字测试",
      result: "warn",
      message: `测试文案 ${codepointCount(text)} 字偏长，建议压到约 100 字后再测受众`,
    };
  }
  return {
    id: "logline_100_ack",
    name: "100字测试",
    result: "pass",
    message: "100 字测试已人工确认",
  };
}

/** 投稿四件套：核心梗 + 小传 + 10 集大纲 + 前 3 集正文 */
export function checkPitchFourPack(counts: {
  coreHook?: number;
  character?: number;
  episodeOutline?: number;
  manuscript?: number;
  /** ip_adapt 时走 AdaptPitchPack，不要求漫剧 10+3 */
  format?: string | null;
  adaptAnchorDone?: boolean;
  adaptUnitCount?: number;
  adaptEmotionPoints?: number;
  adaptScriptCount?: number;
}): GateCheck {
  if (counts.format === "ip_adapt") {
    const missing: string[] = [];
    if (!counts.adaptAnchorDone) missing.push("锚定表");
    if ((counts.adaptUnitCount ?? 0) < 1) missing.push("单元表≥1");
    if ((counts.adaptEmotionPoints ?? 0) < 1) missing.push("情绪点≥1");
    if ((counts.adaptScriptCount ?? counts.manuscript ?? 0) < 1) missing.push("压缩剧本≥1");
    if (missing.length) {
      return {
        id: "adapt_pitch_pack",
        name: "IP改编交稿包",
        result: "fail",
        message: `缺：${missing.join("、")}`,
      };
    }
    return {
      id: "adapt_pitch_pack",
      name: "IP改编交稿包",
      result: "pass",
      message: "锚定+单元+情绪+剧本齐全（≠漫剧四件套）",
    };
  }
  const missing: string[] = [];
  if ((counts.coreHook ?? 0) < 1) missing.push("核心梗");
  if ((counts.character ?? 0) < 1) missing.push("人物小传");
  if ((counts.episodeOutline ?? 0) < 10) missing.push("前十集大纲");
  if ((counts.manuscript ?? 0) < 3) missing.push("前三集正文");
  if (missing.length) {
    return {
      id: "pitch_four_pack",
      name: "投稿四件套",
      result: "fail",
      message: `缺：${missing.join("、")}`,
    };
  }
  return {
    id: "pitch_four_pack",
    name: "投稿四件套",
    result: "pass",
    message: "核心梗+小传+10大纲+前3正文齐全",
  };
}

/** 大纲禁起承转合均分话术 */
export function checkOutlineNoEvenActs(text: string, _strict = true): GateCheck {
  const bad = [
    /平均分配/,
    /起承转合均/,
    /四幕平均/,
    /均匀推进/,
    /每集同等篇幅/,
  ];
  if (!text.trim()) return { id: "outline_no_even_acts", name: "大纲节奏用词", result: "warn", message: "未提供大纲，节奏用词未评估" };
  const hit = bad.find((p) => p.test(text));
  if (hit) {
    return {
      id: "outline_no_even_acts",
      name: "大纲节奏用词",
      result: "warn",
      message: `命中「${hit.source}」，可查看是否为对白或否定句，按实际事件判断节奏`,
    };
  }
  return {
    id: "outline_no_even_acts",
    name: "大纲节奏用词",
    result: "pass",
    message: "未检出均分摊平话术",
  };
}

/** 剧情连续性图程序化校验（不替代 LogicAck；与 domain/story-graph 对齐的轻量实现） */
export function checkGraphConsistency(opts: {
  graph?: Record<string, unknown> | null;
  ledger?: Record<string, unknown> | null;
  currentEp?: number;
  worldText?: string;
  requireNonEmpty?: boolean;
}): GateCheck {
  const graph = opts.graph;
  if (!graph || typeof graph !== "object") {
    if (opts.requireNonEmpty) {
      return {
        id: "graph_consistency",
        name: "剧情图一致性",
        result: "warn",
        message: "缺少 story/episode graph",
      };
    }
    return {
      id: "graph_consistency",
      name: "剧情图一致性",
      result: "pass",
      message: "无图可检（终审仍须人工 LogicAck）",
    };
  }
  const nodes = Array.isArray(graph.nodes) ? (graph.nodes as Array<Record<string, unknown>>) : [];
  const edges = Array.isArray(graph.edges) ? (graph.edges as Array<Record<string, unknown>>) : [];
  const issues: string[] = [];
  if (opts.requireNonEmpty && !nodes.length && !edges.length) {
    issues.push("[missing_graph] 缺少 story/episode graph");
  }
  const ids = new Set(nodes.map((n) => String(n.id || "")));
  for (const e of edges) {
    const from = String(e.from || "");
    const to = String(e.to || "");
    if (!ids.has(from) || !ids.has(to)) {
      issues.push(`[dangling_edge] ${from}→${to}`);
    }
  }
  const states = Array.isArray(graph.characterStates)
    ? (graph.characterStates as Array<Record<string, unknown>>)
    : [];
  const locMap = new Map<string, Set<string>>();
  for (const s of states) {
    const key = `${s.characterId}:${s.episode}`;
    const loc = String(s.location || "").trim();
    if (!loc) continue;
    const set = locMap.get(key) || new Set<string>();
    set.add(loc);
    locMap.set(key, set);
  }
  for (const [key, locs] of locMap) {
    if (locs.size > 1) issues.push(`[location_conflict] 同集地点有变化，可核对转场 ${key}: ${[...locs].join(" / ")}`);
  }
  const ledger = opts.ledger;
  const entries = Array.isArray(ledger?.entries) ? (ledger!.entries as Array<Record<string, unknown>>) : [];
  const currentEp = Number(opts.currentEp || 0);
  for (const ent of entries) {
    if (String(ent.status || "open") !== "open") continue;
    const due = Number(ent.dueEp || ent.due_ep || 0);
    if (currentEp > 0 && due > 0 && currentEp > due) {
      issues.push(`[foreshadow_overdue] ${ent.id}`);
    }
  }
  const world = String(opts.worldText || "");
  if (/上限|禁止|不可/.test(world)) {
    for (const e of edges) {
      if (String(e.kind) === "enables" && /无限|无敌|秒杀全场/.test(String(e.note || ""))) {
        issues.push(`[gold_finger] ${e.from}→${e.to}`);
      }
    }
  }
  if (!issues.length) {
    return {
      id: "graph_consistency",
      name: "剧情图一致性",
      result: "pass",
      message: "图结构校验通过（终审仍须人工 LogicAck）",
    };
  }
  const hasFail = issues.some((m) => m.startsWith("[dangling_edge]"));
  return {
    id: "graph_consistency",
    name: "剧情图一致性",
    result: hasFail ? "fail" : "warn",
    message: issues.join("；"),
  };
}

/** OOC / 人设漂移启发式（不自动绿终审） */
export function checkOocHeuristic(opts: {
  bibleSnippet?: string;
  text?: string;
  flagged?: boolean;
}): GateCheck {
  if (opts.flagged) {
    return {
      id: "ooc",
      name: "人设一致性",
      result: "warn",
      message: "调用方标记了人设疑点，可对照小传中的动机和例外核实",
    };
  }
  const bible = (opts.bibleSnippet || "").trim();
  const text = (opts.text || "").trim();
  if (!bible) {
    return {
      id: "ooc",
      name: "人设一致性",
      result: "warn",
      message: "未注入 bible，无法做 OOC 启发式",
    };
  }
  if (!text) {
    return {
      id: "ooc",
      name: "人设一致性",
      result: "warn",
      message: "无正文，人设漂移未评估",
    };
  }
  return {
    id: "ooc",
    name: "人设一致性",
    result: "pass",
    message: "未自动标红（终审仍须人工 LogicAck）",
  };
}

export function buildReceiptHandoff(agentId: string, checks: GateCheck[], notes: string): string {
  const fails = checks.filter((c) => c.result === "fail").map((c) => c.name);
  const warns = checks.filter((c) => c.result === "warn").map((c) => c.name);
  return [
    `# Handoff — ${agentId}`,
    "",
    notes.trim() || "（无附加说明）",
    "",
    fails.length ? `失败门禁：${fails.join("、")}` : "失败门禁：无",
    warns.length ? `警告：${warns.join("、")}` : "警告：无",
  ].join("\n");
}
