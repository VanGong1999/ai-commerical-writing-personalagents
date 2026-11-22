import type { StageNode } from "./types.js";

/** 九格漫剧金牌路径：人设先于大纲 + 100字测试 + 人工大纲闸 + 衰减硬停 */
export const MANJU_STAGES: StageNode[] = [
  {
    id: "S0_SETUP",
    name: "格式/题材删减",
    agentIds: ["orch.writing", "topic.market_brief", "topic.genre_trim"],
    next: ["S1_HOOK_BATCH"],
  },
  {
    id: "S1_HOOK_BATCH",
    name: "核心梗批量",
    agentIds: ["topic.core_hook_batch"],
    next: ["S2_HOOK_CRITIC"],
  },
  {
    id: "S2_HOOK_CRITIC",
    name: "核心梗评审",
    agentIds: ["topic.core_hook_critic"],
    next: ["S2_HOOK_SELECT"],
  },
  {
    id: "S2_HOOK_SELECT",
    name: "人工采纳核心梗",
    agentIds: [],
    requiresUserAck: true,
    next: ["S2_LOGLINE_100"],
  },
  {
    id: "S2_LOGLINE_100",
    name: "100字测试",
    agentIds: [],
    requiresUserAck: true,
    next: ["S2_COOL_BATCH"],
  },
  {
    id: "S2_COOL_BATCH",
    name: "爽虐点批量",
    agentIds: ["struct.cool18", "struct.cool_expand"],
    next: ["S3_BIO"],
  },
  {
    id: "S3_BIO",
    name: "人物小传",
    agentIds: ["char.bio_manju", "char.relation_net"],
    next: ["S3_BIO_ACK"],
  },
  {
    id: "S3_BIO_ACK",
    name: "小传人工确认",
    agentIds: [],
    requiresUserAck: true,
    next: ["S4_EP10_OUTLINE"],
  },
  {
    id: "S4_EP10_OUTLINE",
    name: "前十集大纲",
    agentIds: ["struct.episode_outline", "hook.episode_alts"],
    next: ["S4_OUTLINE_ACK"],
  },
  {
    id: "S4_OUTLINE_ACK",
    name: "大纲人工确认",
    agentIds: ["struct.story_graph"],
    requiresUserAck: true,
    next: ["S5_EP_BODY_BATCH"],
  },
  {
    id: "S5_EP_BODY_BATCH",
    name: "分集正文串行（Bible注入·衰减硬停）",
    agentIds: [
      "orch.batch_writer",
      "qc.bible_guard",
      "prose.episode_body",
      "struct.episode_graph",
      "hook.foreshadow_ledger",
      "mem.chapter_summary",
    ],
    next: ["S6_QA"],
  },
  {
    id: "S6_QA",
    name: "规格校正 / 字数衰减修复",
    agentIds: ["prose.qa_correct", "prose.length_decay_fix"],
    next: ["S7_STORYBOARD"],
  },
  {
    id: "S7_STORYBOARD",
    name: "去小说化 / 分镜化",
    agentIds: ["prose.storyboard"],
    next: ["S8_DIALOGUE"],
  },
  {
    id: "S8_DIALOGUE",
    name: "台词加压",
    agentIds: ["prose.dialogue_pressure"],
    next: ["S9_DE_AI"],
  },
  {
    id: "S9_DE_AI",
    name: "去 AI 味",
    agentIds: ["qc.de_ai"],
    next: ["S10_HUMAN_QC"],
  },
  {
    id: "S10_HUMAN_QC",
    name: "人工校稿 / LogicAck",
    agentIds: ["char.soul_check", "qc.logic_heuristic", "qc.human_checklist"],
    requiresUserAck: true,
    next: ["S11_EXTEND", "S11_PITCH"],
  },
  {
    id: "S11_EXTEND",
    name: "扩展后续大纲",
    agentIds: [
      "struct.story_graph",
      "hook.foreshadow_ledger",
      "struct.extend_outline",
      "struct.act100_manju",
    ],
    next: ["S5_EP_BODY_BATCH"],
  },
  {
    id: "S11_PITCH",
    name: "投稿打包（四件套）",
    agentIds: ["deliver.pitch_pack"],
    next: ["S11_DONE"],
  },
  {
    id: "S11_DONE",
    name: "交稿完成",
    agentIds: [],
  },
];

/** 旧漫剧 Stage → 新 Stage（兼容已存项目） */
export const MANJU_STAGE_MIGRATE: Record<string, string> = {
  S4_BIO: "S3_BIO",
  S4_CHAR_BIO: "S3_BIO",
  S3_EP10_OUTLINE: "S4_EP10_OUTLINE",
  S6_AI_CORRECT: "S6_QA",
  S7_DE_AI: "S9_DE_AI",
  S8_HUMAN_QC: "S10_HUMAN_QC",
  S9_EXTEND: "S11_EXTEND",
  S9_EXTEND_OUTLINE: "S11_EXTEND",
  S10_PITCH: "S11_PITCH",
  S10_DONE: "S11_DONE",
};

/**
 * 迁移旧漫剧项目 Stage 状态。
 * 若已有大纲产物但未走过小传 ack：落到 S3_BIO_ACK，保留大纲不删除。
 */
export function migrateManjuLockState(state: {
  format: string;
  currentStageId: string;
  completed: string[];
  forceJumps?: Array<{ from: string; to: string; at: string; reason?: string }>;
  hasOutlineArtifact?: boolean;
  hasBioArtifact?: boolean;
}): {
  format: string;
  currentStageId: string;
  completed: string[];
  forceJumps: Array<{ from: string; to: string; at: string; reason?: string }>;
  migrationHint?: string;
} {
  const mapId = (id: string) => MANJU_STAGE_MIGRATE[id] || id;
  let current = mapId(state.currentStageId);
  const completed = [...new Set(state.completed.map(mapId))];
  let hint: string | undefined;

  const bioAcked = completed.includes("S3_BIO_ACK") || completed.includes("S3_BIO");
  const outlinePresent =
    Boolean(state.hasOutlineArtifact) ||
    completed.includes("S4_EP10_OUTLINE") ||
    completed.includes("S4_OUTLINE_ACK");

  if (outlinePresent && !bioAcked) {
    current = "S3_BIO_ACK";
    hint =
      "检测到旧顺序「先大纲后人设」项目：请确认/补全人物小传后再继续；已有大纲保留不删除。";
  } else if (
    !ManjuStageExists(current) &&
    MANJU_STAGES.some((s) => s.id === mapId(state.currentStageId))
  ) {
    current = mapId(state.currentStageId);
  } else if (!ManjuStageExists(current)) {
    current = MANJU_STAGES[0]!.id;
    hint = `未知 Stage「${state.currentStageId}」已重置到起点`;
  }

  return {
    format: "manju",
    currentStageId: current,
    completed,
    forceJumps: state.forceJumps || [],
    migrationHint: hint,
  };
}

function ManjuStageExists(id: string): boolean {
  return MANJU_STAGES.some((s) => s.id === id);
}

export const DUANJU_STAGE_SKELETON: StageNode[] = [
  {
    id: "S0_PRODUCT",
    name: "产品锁",
    agentIds: ["orch.writing", "biz.product_align"],
    next: ["S1_TOPIC"],
  },
  {
    id: "S1_TOPIC",
    name: "选题（想看/爽点/壳）",
    agentIds: ["topic.want_how", "topic.cool_point_5", "topic.story_shell", "topic.genre_trim"],
    next: ["S1_TOPIC_ACK"],
  },
  {
    id: "S1_TOPIC_ACK",
    name: "选题人工确认",
    agentIds: [],
    requiresUserAck: true,
    next: ["S2_BIO"],
  },
  {
    id: "S2_BIO",
    name: "人设",
    agentIds: ["char.mini_bio", "char.empathy_3", "qc.gender_path"],
    next: ["S3_BEAT20"],
  },
  {
    id: "S3_BEAT20",
    name: "二十节拍+中点+付费+桥段",
    agentIds: ["struct.beat20", "struct.midpoint", "struct.paywall", "struct.bridge8"],
    next: ["S4_EP10_DRAFT"],
  },
  {
    id: "S4_EP10_DRAFT",
    name: "十集大纲生成",
    agentIds: ["struct.ep_outline_duanju"],
    next: ["S4_EP10"],
  },
  {
    id: "S4_EP10",
    name: "十集大纲（人工确认）",
    agentIds: ["struct.ep_outline_duanju", "qc.human_qc_duanju"],
    requiresUserAck: true,
    next: ["S5_SCENE"],
  },
  {
    id: "S5_SCENE",
    name: "场级正文",
    agentIds: [
      "scene.opening7",
      "scene.triple",
      "scene.triangle",
      "prose.dialogue_formula",
      "hook.one_plus_one",
      "hook.suspense_design",
      "scene.comedy",
      "scene.location_budget",
    ],
    next: ["S6_REVISE20"],
  },
  {
    id: "S6_REVISE20",
    name: "Revise20",
    agentIds: ["qc.revise20", "qc.ai_question"],
    next: ["S7_SUBMIT"],
  },
  {
    id: "S7_SUBMIT",
    name: "红线+交付",
    agentIds: ["qc.redline", "deliver.submission_pack", "topic.logline_title", "qc.human_checklist"],
    requiresUserAck: true,
  },
];

/** 男频中长篇 Stage 图 */
export const MALE_LONG_STAGES: StageNode[] = [
  {
    id: "S0_SETUP",
    name: "项目设置",
    agentIds: ["orch.writing", "topic.genre_trim"],
    next: ["S1_TOPIC_SCAN"],
  },
  {
    id: "S1_TOPIC_SCAN",
    name: "刷榜选题+开篇钩",
    agentIds: ["male.opening", "topic.book_pack", "topic.genre_trim"],
    next: ["S2_GOLD_FINGER"],
  },
  {
    id: "S2_GOLD_FINGER",
    name: "金手指设定",
    agentIds: ["male.gold_finger"],
    next: ["S3_CHARACTER"],
  },
  {
    id: "S3_CHARACTER",
    name: "人设",
    agentIds: ["char.bible_big5", "char.soul_check"],
    next: ["S4_VOLUME"],
  },
  {
    id: "S4_VOLUME",
    name: "卷纲升级循环",
    agentIds: ["male.upgrade_loop"],
    next: ["S5_CHAPTER"],
  },
  {
    id: "S5_CHAPTER",
    name: "章纲",
    agentIds: ["struct.chapter_cap"],
    next: ["S6_BEAT"],
  },
  {
    id: "S6_BEAT",
    name: "细纲",
    agentIds: ["struct.face_slap", "struct.expectation", "male.no_stuck"],
    next: ["S7_BODY"],
  },
  {
    id: "S7_BODY",
    name: "正文分章（Bible注入·章摘要·衰减硬停）",
    agentIds: [
      "orch.batch_writer",
      "qc.bible_guard",
      "hook.foreshadow_ledger",
      "prose.novel_body",
      "prose.length_decay_fix",
      "mem.chapter_summary",
    ],
    next: ["S8_COOL_DENSITY"],
  },
  {
    id: "S8_COOL_DENSITY",
    name: "爽点密度+升级循环质检",
    agentIds: ["male.cool_density", "male.upgrade_loop", "struct.cool18"],
    next: ["S9_RISK"],
  },
  {
    id: "S9_RISK",
    name: "雷区+去AI味",
    agentIds: ["male.risk", "char.soul_check", "qc.de_ai", "qc.human_checklist"],
    requiresUserAck: true,
    next: ["S10_DONE"],
  },
  { id: "S10_DONE", name: "完成", agentIds: [] },
];

/** 女频中长篇 Stage 图 */
export const FEMALE_LONG_STAGES: StageNode[] = [
  {
    id: "S0_SETUP",
    name: "项目设置",
    agentIds: ["orch.writing", "topic.genre_trim"],
    next: ["S1_TOPIC"],
  },
  {
    id: "S1_TOPIC",
    name: "选题",
    agentIds: ["struct.chase_wife", "topic.book_pack", "topic.genre_trim", "inspiration.expand"],
    next: ["S1_FOUR_SWAP"],
  },
  {
    id: "S1_FOUR_SWAP",
    name: "四换三（换元保主线）",
    agentIds: ["swap.master"],
    requiresUserAck: true,
    next: ["S2_CHARACTER"],
  },
  {
    id: "S2_CHARACTER",
    name: "人设",
    agentIds: ["char.bible_big5", "char.soul_check", "female.tension"],
    next: ["S3_VOLUME"],
  },
  {
    id: "S3_VOLUME",
    name: "卷纲",
    agentIds: ["female.pace", "struct.chase_wife"],
    next: ["S4_CHAPTER"],
  },
  {
    id: "S4_CHAPTER",
    name: "章纲",
    agentIds: ["struct.chapter_cap"],
    next: ["S5_BEAT"],
  },
  {
    id: "S5_BEAT",
    name: "细纲",
    agentIds: ["struct.expectation", "female.tension", "struct.paywall", "male.no_stuck"],
    next: ["S6_BODY"],
  },
  {
    id: "S6_BODY",
    name: "正文（Bible注入·章摘要·衰减硬停）",
    agentIds: [
      "orch.batch_writer",
      "qc.bible_guard",
      "hook.foreshadow_ledger",
      "prose.novel_body",
      "prose.length_decay_fix",
      "mem.chapter_summary",
    ],
    next: ["S7_RHYTHM"],
  },
  {
    id: "S7_RHYTHM",
    name: "节奏情绪",
    agentIds: ["female.pace", "qc.immersion", "ip.emotion_quant"],
    next: ["S8_TABOO"],
  },
  {
    id: "S8_TABOO",
    name: "雷区",
    agentIds: ["female.risk", "char.soul_check"],
    next: ["S9_PAYWALL"],
  },
  {
    id: "S9_PAYWALL",
    name: "付费点+去AI味",
    agentIds: ["struct.paywall", "qc.de_ai", "qc.human_checklist"],
    requiresUserAck: true,
    next: ["S10_DONE"],
  },
  { id: "S10_DONE", name: "完成", agentIds: [] },
];

/** 短篇 Stage 图 */
export const SHORT_NOVEL_STAGES: StageNode[] = [
  {
    id: "S0_SETUP",
    name: "设置",
    agentIds: ["orch.writing", "topic.genre_trim"],
    next: ["S1_DISSECT"],
  },
  {
    id: "S1_DISSECT",
    name: "拆书",
    agentIds: ["kb.report_pipeline"],
    next: ["S2_SWAP"],
  },
  {
    id: "S2_SWAP",
    name: "换元",
    agentIds: ["swap.master", "qc.similarity"],
    next: ["S3_SYNOPSIS"],
  },
  {
    id: "S3_SYNOPSIS",
    name: "梗概",
    agentIds: ["inspiration.expand", "struct.expectation"],
    next: ["S4_CHAPTER_OUTLINE"],
  },
  {
    id: "S4_CHAPTER_OUTLINE",
    name: "章纲",
    agentIds: ["struct.chapter_cap"],
    next: ["S5_BEAT"],
  },
  {
    id: "S5_BEAT",
    name: "细纲",
    agentIds: ["struct.expectation", "struct.face_slap"],
    next: ["S6_BODY_CHAPTER"],
  },
  {
    id: "S6_BODY_CHAPTER",
    name: "正文",
    agentIds: ["prose.short_opening", "prose.novel_body", "orch.batch_writer"],
    next: ["S7_POLISH"],
  },
  {
    id: "S7_POLISH",
    name: "润色去AI味",
    agentIds: ["qc.de_ai", "qc.show_dont_tell"],
    next: ["S8_QC"],
  },
  {
    id: "S8_QC",
    name: "质检",
    agentIds: ["qc.human_checklist", "qc.ai_question", "qc.similarity"],
    requiresUserAck: true,
    next: ["S9_DONE"],
  },
  { id: "S9_DONE", name: "完成", agentIds: [] },
];

/** IP 改编 Stage 图 */
export const IP_ADAPT_STAGES: StageNode[] = [
  {
    id: "S0_SETUP",
    name: "设置",
    agentIds: ["orch.writing", "topic.genre_trim"],
    next: ["S1_IP_EVAL"],
  },
  {
    id: "S1_IP_EVAL",
    name: "IP评估",
    agentIds: ["ip.select_score", "kb.report_pipeline"],
    next: ["S2_UNIT_SPLIT"],
  },
  {
    id: "S2_UNIT_SPLIT",
    name: "单元拆解",
    agentIds: ["ip.unit_cut", "swap.master"],
    next: ["S3_EMOTION"],
  },
  {
    id: "S3_EMOTION",
    name: "情绪量化",
    agentIds: ["ip.emotion_quant"],
    next: ["S4_COMPRESS"],
  },
  {
    id: "S4_COMPRESS",
    name: "压缩重构",
    agentIds: ["ip.rebuild"],
    next: ["S5_EPISODE_RHYTHM"],
  },
  {
    id: "S5_EPISODE_RHYTHM",
    name: "单集节奏",
    agentIds: ["struct.episode_outline", "struct.kartian"],
    next: ["S6_BEATS"],
  },
  {
    id: "S6_BEATS",
    name: "卡点",
    agentIds: ["struct.kartian", "struct.paywall", "hook.one_plus_one"],
    next: ["S7_SCRIPT"],
  },
  {
    id: "S7_SCRIPT",
    name: "剧本输出",
    agentIds: ["prose.episode_body", "orch.batch_writer", "qc.de_ai"],
    next: ["S8_DONE"],
  },
  {
    id: "S8_DONE",
    name: "完成",
    agentIds: ["qc.human_checklist", "deliver.pitch_pack"],
    requiresUserAck: true,
  },
];

export function stagesForFormat(format: string): StageNode[] {
  if (format === "duanju") return DUANJU_STAGE_SKELETON;
  if (format === "male_long") return MALE_LONG_STAGES;
  if (format === "female_long") return FEMALE_LONG_STAGES;
  if (format === "short_novel") return SHORT_NOVEL_STAGES;
  if (format === "ip_adapt") return IP_ADAPT_STAGES;
  return MANJU_STAGES;
}

export function nextStages(format: string, stageId: string): StageNode[] {
  const stages = stagesForFormat(format);
  const current = stages.find((s) => s.id === stageId);
  if (!current?.next?.length) return [];
  return current.next
    .map((id) => stages.find((s) => s.id === id))
    .filter((s): s is StageNode => Boolean(s));
}

// —— Stage Lock（交换流）——

export type StageLockState = {
  format: string;
  currentStageId: string;
  completed: string[];
  forceJumps: Array<{ from: string; to: string; at: string; reason?: string }>;
};

export type StageAdvanceResult =
  | {
      ok: true;
      nextStageIds: string[];
      locked: false;
      state: StageLockState;
      message: string;
    }
  | {
      ok: false;
      locked: true;
      reason: string;
      requiresUserAck?: boolean;
      state: StageLockState;
    };

function nowIso() {
  return new Date().toISOString();
}

export function getStageNode(format: string, stageId: string): StageNode | undefined {
  return stagesForFormat(format).find((s) => s.id === stageId);
}

export function isStageLocked(
  format: string,
  stageId: string,
  state: Pick<StageLockState, "completed">,
): { locked: boolean; reason?: string; requiresUserAck?: boolean } {
  const node = getStageNode(format, stageId);
  if (!node) return { locked: true, reason: `未知 Stage：${stageId}` };
  if (node.requiresUserAck && !state.completed.includes(stageId)) {
    return {
      locked: true,
      requiresUserAck: true,
      reason: `Stage「${node.name}」需要人工确认后才能前进`,
    };
  }
  return { locked: false };
}

export function canJumpTo(
  format: string,
  state: StageLockState,
  targetStageId: string,
  opts?: { force?: boolean },
): { ok: boolean; reason?: string } {
  const stages = stagesForFormat(format);
  const curIdx = stages.findIndex((s) => s.id === state.currentStageId);
  const tgtIdx = stages.findIndex((s) => s.id === targetStageId);
  if (tgtIdx < 0) return { ok: false, reason: `未知目标 Stage：${targetStageId}` };
  if (tgtIdx <= curIdx) return { ok: true };
  for (let i = curIdx; i < tgtIdx; i += 1) {
    const id = stages[i]?.id;
    if (!id) continue;
    if (!state.completed.includes(id) && id !== state.currentStageId && !opts?.force) {
      return {
        ok: false,
        reason: `禁止跳过未完成 Stage「${stages[i]?.name || id}」`,
      };
    }
  }
  return { ok: true };
}

export function ackStage(state: StageLockState, stageId?: string): StageLockState {
  const id = stageId || state.currentStageId;
  const completed = state.completed.includes(id) ? state.completed : [...state.completed, id];
  return { ...state, completed };
}

export function advanceStage(
  state: StageLockState,
  opts?: { force?: boolean; reason?: string },
): StageAdvanceResult {
  const lock = isStageLocked(state.format, state.currentStageId, state);
  if (lock.locked && !opts?.force) {
    return {
      ok: false,
      locked: true,
      reason: lock.reason || "Stage 已锁定",
      requiresUserAck: lock.requiresUserAck,
      state,
    };
  }
  const completed = state.completed.includes(state.currentStageId)
    ? state.completed
    : [...state.completed, state.currentStageId];
  const next = nextStages(state.format, state.currentStageId);
  if (!next.length) {
    return {
      ok: true,
      nextStageIds: [],
      locked: false,
      state: { ...state, completed },
      message: "已到流程末端",
    };
  }
  const primary = next[0]!;
  const forceJumps = [...state.forceJumps];
  if (opts?.force && lock.locked) {
    forceJumps.push({
      from: state.currentStageId,
      to: primary.id,
      at: nowIso(),
      reason: opts.reason || "force advance",
    });
  }
  return {
    ok: true,
    nextStageIds: next.map((n) => n.id),
    locked: false,
    state: {
      ...state,
      completed,
      currentStageId: primary.id,
      forceJumps,
    },
    message: `前进到 ${primary.name}`,
  };
}

export function createInitialLockState(
  format: string,
  currentStageId?: string,
): StageLockState {
  const stages = stagesForFormat(format);
  return {
    format,
    currentStageId: currentStageId || stages[0]?.id || "S0_SETUP",
    completed: [],
    forceJumps: [],
  };
}

export function exportStageGraph(format: string) {
  return stagesForFormat(format).map((s) => ({
    id: s.id,
    name: s.name,
    agentIds: s.agentIds,
    next: s.next || [],
    requiresUserAck: Boolean(s.requiresUserAck),
    mode: s.mode || "ordered",
  }));
}
