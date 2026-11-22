/**
 * Hermes 风格程序化奖励（score_only）：只打可验证合规信号，不评剧情好坏。
 */
export type RlMode = "off" | "score_only";

export type RlScoreBreakdown = {
  bibleGuard: number;
  graphSchema: number;
  foreshadowHygiene: number;
  lengthDecay: number;
  toolDiscipline: number;
};

export type RlScoreResult = {
  mode: RlMode;
  total: number;
  breakdown: RlScoreBreakdown;
  notes: string[];
};

export function resolveRlMode(raw?: string | null): RlMode {
  const v = String(raw || "off").trim().toLowerCase();
  if (v === "score_only" || v === "score-only" || v === "score") return "score_only";
  return "off";
}

/**
 * @param opts.signals 各信号 0|1（或 0–1 分数）
 */
export function computeProgrammaticReward(opts: {
  mode?: RlMode | string | null;
  biblePackReady?: boolean;
  bibleHasGraphSlice?: boolean;
  graphSchemaOk?: boolean;
  foreshadowHasDue?: boolean;
  foreshadowOverdueClear?: boolean;
  lengthDecayPass?: boolean;
  usedPayoffLedgerTool?: boolean;
  usedGraphRelatedTool?: boolean;
}): RlScoreResult {
  const mode = resolveRlMode(opts.mode);
  const notes: string[] = [];
  if (mode === "off") {
    return {
      mode,
      total: 0,
      breakdown: {
        bibleGuard: 0,
        graphSchema: 0,
        foreshadowHygiene: 0,
        lengthDecay: 0,
        toolDiscipline: 0,
      },
      notes: ["rl_mode=off"],
    };
  }

  const bibleGuard =
    (opts.biblePackReady ? 0.6 : 0) + (opts.bibleHasGraphSlice ? 0.4 : 0);
  if (!opts.biblePackReady) notes.push("bible_pack 未就绪");
  if (!opts.bibleHasGraphSlice) notes.push("bible 缺图切片");

  const graphSchema = opts.graphSchemaOk ? 1 : 0;
  if (!opts.graphSchemaOk) notes.push("GraphConsistency 未过");

  const foreshadowHygiene =
    (opts.foreshadowHasDue ? 0.5 : 0) + (opts.foreshadowOverdueClear ? 0.5 : 0);
  if (!opts.foreshadowHasDue) notes.push("伏笔缺 due_ep / 未植点");
  if (!opts.foreshadowOverdueClear) notes.push("存在逾期伏笔");

  const lengthDecay = opts.lengthDecayPass === false ? 0 : 1;
  if (opts.lengthDecayPass === false) notes.push("LengthDecay fail");

  const toolDiscipline =
    (opts.usedPayoffLedgerTool ? 0.5 : 0) + (opts.usedGraphRelatedTool ? 0.5 : 0);
  if (!opts.usedPayoffLedgerTool) notes.push("未调用 payoff_ledger");
  if (!opts.usedGraphRelatedTool) notes.push("未维护图相关工具/产物");

  const breakdown: RlScoreBreakdown = {
    bibleGuard,
    graphSchema,
    foreshadowHygiene,
    lengthDecay,
    toolDiscipline,
  };
  const vals = Object.values(breakdown);
  const total = vals.reduce((a, b) => a + b, 0) / vals.length;

  return { mode, total: Math.round(total * 1000) / 1000, breakdown, notes };
}

/** 将会话事件粗转为 ShareGPT conversations（供日后训练） */
export function sessionEventsToShareGPT(events: Array<{ type?: string; payload?: unknown; text?: string }>): {
  conversations: Array<{ from: string; value: string }>;
} {
  const conversations: Array<{ from: string; value: string }> = [];
  for (const ev of events) {
    const t = ev.type || "";
    if (t === "run_start") {
      conversations.push({
        from: "human",
        value: JSON.stringify(ev.payload || {}).slice(0, 4000),
      });
    } else if (t === "assistant" || t === "token") {
      const v = String((ev as { text?: string }).text || (ev.payload as { text?: string })?.text || "");
      if (v.trim()) conversations.push({ from: "gpt", value: v.slice(0, 8000) });
    } else if (t === "tool" || t === "tool_result") {
      conversations.push({
        from: "tool",
        value: JSON.stringify(ev.payload || ev).slice(0, 8000),
      });
    } else if (t === "receipt") {
      conversations.push({
        from: "gpt",
        value: `[RECEIPT] ${JSON.stringify(ev.payload || {}).slice(0, 4000)}`,
      });
    }
  }
  if (!conversations.length) {
    conversations.push({ from: "human", value: "(empty trajectory)" });
  }
  return { conversations };
}
