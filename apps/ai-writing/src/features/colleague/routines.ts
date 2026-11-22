import type { ProjectFormat } from "@xiezuomanju/domain";

/** 六格式最小闭环例程：可在「AI 同事」页一键执行（逐步运行 + 人工闸自动确认）。 */
export type RoutineStep =
  | { kind: "advanceTo"; target: string }
  | { kind: "ack" }
  | { kind: "run"; agent: string; grow?: boolean }
  | { kind: "adopt"; type: string }
  | { kind: "adoptCoreHook" }
  | { kind: "assertStage"; target: string };

export type Routine = {
  label: string;
  desc: string;
  steps: RoutineStep[];
  expectTypes?: string[];
};

export const ROUTINES: Record<ProjectFormat, Routine> = {
  manju: {
    label: "漫剧九格主线",
    desc: "核心梗 → 强采纳 → 100 字测试 → 人设 → 十集大纲 → 分集正文",
    steps: [
      { kind: "advanceTo", target: "S1_HOOK_BATCH" },
      { kind: "run", agent: "topic.core_hook_batch", grow: true },
      { kind: "adoptCoreHook" },
      { kind: "assertStage", target: "S2_LOGLINE_100" },
      { kind: "ack" },
      { kind: "advanceTo", target: "S3_BIO" },
      { kind: "run", agent: "char.bio_manju", grow: true },
      { kind: "adopt", type: "character" },
      { kind: "ack" },
      { kind: "advanceTo", target: "S4_EP10_OUTLINE" },
      { kind: "run", agent: "struct.episode_outline", grow: true },
      { kind: "adopt", type: "episode_outline" },
      { kind: "advanceTo", target: "S5_EP_BODY_BATCH" },
      { kind: "run", agent: "prose.episode_body", grow: true },
    ],
    expectTypes: ["core_hook", "character", "episode_outline", "manuscript"],
  },
  duanju: {
    label: "短剧查理闭环",
    desc: "选题三问 → 20 节拍 → 十集大纲 → 场戏三件套 → Revise20",
    steps: [
      { kind: "advanceTo", target: "S1_TOPIC" },
      { kind: "run", agent: "topic.want_how" },
      { kind: "advanceTo", target: "S3_BEAT20" },
      { kind: "run", agent: "struct.beat20", grow: true },
      { kind: "advanceTo", target: "S4_EP10_DRAFT" },
      { kind: "run", agent: "struct.ep_outline_duanju", grow: true },
      { kind: "advanceTo", target: "S5_SCENE" },
      { kind: "run", agent: "scene.triple", grow: true },
      { kind: "advanceTo", target: "S6_REVISE20" },
      { kind: "run", agent: "qc.revise20" },
    ],
  },
  short_novel: {
    label: "短篇换元成稿",
    desc: "换元方案 → 期待/冲突 → 人设卡 → 正文初稿",
    steps: [
      { kind: "advanceTo", target: "S2_SWAP" },
      { kind: "run", agent: "swap.master", grow: true },
      { kind: "advanceTo", target: "S3_SYNOPSIS" },
      { kind: "run", agent: "struct.expectation", grow: true },
      { kind: "run", agent: "char.bible_big5", grow: true },
      { kind: "advanceTo", target: "S6_BODY_CHAPTER" },
      { kind: "run", agent: "prose.novel_body", grow: true },
    ],
    expectTypes: ["manuscript"],
  },
  male_long: {
    label: "男频长篇循环",
    desc: "开篇钩 → 金手指 → 升级循环 → 人设卡 → 正文",
    steps: [
      { kind: "advanceTo", target: "S1_TOPIC_SCAN" },
      { kind: "run", agent: "male.opening", grow: true },
      { kind: "advanceTo", target: "S2_GOLD_FINGER" },
      { kind: "run", agent: "male.gold_finger", grow: true },
      { kind: "advanceTo", target: "S4_VOLUME" },
      { kind: "run", agent: "male.upgrade_loop", grow: true },
      { kind: "run", agent: "char.bible_big5", grow: true },
      { kind: "advanceTo", target: "S7_BODY" },
      { kind: "run", agent: "prose.novel_body", grow: true },
    ],
    expectTypes: ["manuscript"],
  },
  female_long: {
    label: "女频长篇节奏",
    desc: "追妻五部曲 → 四换三 → 节奏配比 → 人设卡 → 正文",
    steps: [
      { kind: "advanceTo", target: "S1_TOPIC" },
      { kind: "run", agent: "struct.chase_wife", grow: true },
      { kind: "advanceTo", target: "S1_FOUR_SWAP" },
      { kind: "ack" },
      { kind: "advanceTo", target: "S3_VOLUME" },
      { kind: "run", agent: "female.pace", grow: true },
      { kind: "run", agent: "char.bible_big5", grow: true },
      { kind: "advanceTo", target: "S6_BODY" },
      { kind: "run", agent: "prose.novel_body", grow: true },
    ],
    expectTypes: ["manuscript"],
  },
  ip_adapt: {
    label: "IP 改编链路",
    desc: "选书评分 → 单元拆分 → 人设卡 → 剧本正文",
    steps: [
      { kind: "advanceTo", target: "S1_IP_EVAL" },
      { kind: "run", agent: "ip.select_score", grow: true },
      { kind: "advanceTo", target: "S2_UNIT_SPLIT" },
      { kind: "run", agent: "ip.unit_cut", grow: true },
      { kind: "run", agent: "char.bible_big5", grow: true },
      { kind: "advanceTo", target: "S7_SCRIPT" },
      { kind: "run", agent: "prose.episode_body", grow: true },
    ],
    expectTypes: ["manuscript"],
  },
};

export function stepLabel(step: RoutineStep): string {
  switch (step.kind) {
    case "advanceTo":
      return `推进到 ${step.target}`;
    case "ack":
      return "确认当前人工闸";
    case "run":
      return `运行 ${step.agent}`;
    case "adopt":
      return `采纳 ${step.type}`;
    case "adoptCoreHook":
      return "从候选里选定一条核心梗（强采纳）";
    case "assertStage":
      return `校验阶段 ${step.target}`;
  }
}
