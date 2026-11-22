/**
 * 查理短剧课深化：常量 + DuanjuCharlieOps 中间态。
 * 权威：查理课 notes/精华 + knowledge/03-duanju；对齐 DuanjuStage，不另建 Stage。
 * ≠ 漫剧手册 COOL18/Kartian；≠ L17 TropeDrill；≠ L13 IP paywall。
 */
import { z } from "zod";

/* ───────────────────── 常量 ───────────────────── */

export const CHARLIE_BEAT20 = [
  { no: 1, act: "起" as const, name: "环境规则", tip: "时空+世界规则切片" },
  { no: 2, act: "起" as const, name: "主角登场", tip: "共情谁、听谁的" },
  { no: 3, act: "起" as const, name: "激励事件", tip: "压力下新选择" },
  { no: 4, act: "起" as const, name: "外部目标", tip: "要解决什么问题" },
  { no: 5, act: "起" as const, name: "走出舒适区", tip: "离开稳定态" },
  { no: 6, act: "承" as const, name: "初尝红利", tip: "先爽一把" },
  { no: 7, act: "承" as const, name: "伙伴/爱情", tip: "相遇或萌发感情" },
  { no: 8, act: "承" as const, name: "起始对手", tip: "有目标就有对手" },
  { no: 9, act: "承" as const, name: "阻力对抗", tip: "环境/对手/自身" },
  { no: 10, act: "承" as const, name: "故事拐点", tip: "约一半：虚假胜/败" },
  { no: 11, act: "转" as const, name: "调整目标", tip: "原目标不准" },
  { no: 12, act: "转" as const, name: "确认对手", tip: "重新认识对手" },
  { no: 13, act: "转" as const, name: "冲突升级", tip: "任务更难" },
  { no: 14, act: "转" as const, name: "第一次决战", tip: "正面干，往往未准备好" },
  { no: 15, act: "转" as const, name: "遭受重挫", tip: "灵魂黑夜" },
  { no: 16, act: "合" as const, name: "疗伤反省", tip: "外伤或内伤" },
  { no: 17, act: "合" as const, name: "找到解决方案", tip: "须牺牲/成长" },
  { no: 18, act: "合" as const, name: "最终决战", tip: "成功或险胜" },
  { no: 19, act: "合" as const, name: "胜利后不狂", tip: "勿屠龙者成恶龙" },
  { no: 20, act: "合" as const, name: "回到原点", tip: "归来仍是少年" },
] as const;

export const CHARLIE_BRIDGE8 = [
  { id: "打脸", tip: "秩序/优势反转" },
  { id: "碾压", tip: "优势展示" },
  { id: "运气", tip: "好运、开挂感" },
  { id: "地位", tip: "阶层/身份" },
  { id: "集体", tip: "归属" },
  { id: "因果", tip: "善恶有报" },
  { id: "极限", tip: "极限情境" },
  { id: "哲思", tip: "轻量想通了（慎过度）" },
] as const;

export const CHARLIE_COOL5 = [
  { id: "两性", tip: "离婚、赘婿、霸总、宠爱包围" },
  { id: "征服", tip: "战王、暴富、金手指、穿越征服" },
  { id: "优势", tip: "神医、官场、阶层碾压" },
  { id: "归属", tip: "帮派、门派、家国情" },
  { id: "秩序", tip: "复仇打脸、善恶有报、重生改命" },
] as const;

export const CHARLIE_STORY_SHELLS = [
  { id: "人物导向", allowed: true, tip: "这人太特别" },
  { id: "目标导向", allowed: true, tip: "要去干成某事" },
  { id: "困境导向", allowed: true, tip: "陷入大麻烦" },
  { id: "奇遇导向", allowed: true, tip: "穿越/重生/开挂" },
  { id: "谜题导向", allowed: false, tip: "易理性冷静，不利充值（禁主壳）" },
] as const;

export const CHARLIE_REVISE20 = [
  "男频/女频是否跑偏（办事路径）",
  "八爽点落脚是否用开",
  "经典叙事：一主角一视角一线形",
  "设定最多两个且合逻辑",
  "每集/场有吸睛点（第一集必须有）",
  "悬念贯穿期一次只揣一件事",
  "只共情一个人",
  "主角正直、有原则",
  "主角出场有场面有辨识度",
  "中后段大问题主角主动解",
  "约50集后可用两难调剂",
  "乏力时加反派或挖背叛",
  "配角有外形/行为/语言记忆点",
  "单场起承转合、每集独立能打",
  "不明处/情绪处可补独白旁白",
  "片名直白说清爽点赛道",
  "有关键道具",
  "别怕俗——先完成场目标",
  "喜剧不强求",
  "悲剧最多末尾含泪一次",
] as const;

export const CHARLIE_OPENING7 = [
  "环境",
  "技能",
  "共情",
  "激励",
  "动作",
  "悬念",
  "回忆",
] as const;

export const CHARLIE_PRODUCT_PRINCIPLES = [
  { id: "decompress", label: "解压" },
  { id: "immersion", label: "强代入" },
  { id: "viscosity", label: "强粘度" },
] as const;

export const CHARLIE_LAPIAN_DIMS = [
  "爽点密度",
  "付费钩",
  "人设辨识",
  "节奏张弛",
  "信息差",
  "见证/围观",
] as const;

/* ───────────────────── Schema ───────────────────── */

export const CharlieBeatRowSchema = z.object({
  no: z.number().int().min(1).max(20),
  name: z.string().default(""),
  act: z.enum(["起", "承", "转", "合"]).default("起"),
  conflict: z.string().default(""),
  emotion: z.string().default(""),
  payHint: z.boolean().default(false),
  intensity: z.number().int().min(1).max(5).default(3),
});
export type CharlieBeatRow = z.infer<typeof CharlieBeatRowSchema>;

export function defaultCharlieBeatRows(): CharlieBeatRow[] {
  return CHARLIE_BEAT20.map((b) =>
    CharlieBeatRowSchema.parse({
      no: b.no,
      name: b.name,
      act: b.act,
      conflict: "",
      emotion: "",
      payHint: b.no === 10 || b.no === 19,
      intensity: 3,
    }),
  );
}

export const ProductLockSchema = z.object({
  demandOrderAck: z.boolean().default(false),
  decompress: z.boolean().default(false),
  immersion: z.boolean().default(false),
  viscosity: z.boolean().default(false),
  payPsychology: z.string().default(""),
});
export type ProductLock = z.infer<typeof ProductLockSchema>;

export const TopicFormulaSchema = z.object({
  wantHow: z.string().default(""),
  viaWhat: z.string().default(""),
  cool5Ids: z.array(z.string()).default([]),
  shell: z.string().default(""),
  accountTier: z.enum(["full", "small", "unknown"]).default("unknown"),
});
export type TopicFormula = z.infer<typeof TopicFormulaSchema>;

export const GenderPathSchema = z.object({
  band: z.enum(["male", "female", "unset"]).default("unset"),
  pathNote: z.string().default(""),
  pathAck: z.boolean().default(false),
});
export type GenderPath = z.infer<typeof GenderPathSchema>;

export const Bridge8CoverageItemSchema = z.object({
  id: z.string(),
  usedInEpOrScene: z.string().default(""),
  note: z.string().default(""),
});
export type Bridge8CoverageItem = z.infer<typeof Bridge8CoverageItemSchema>;

export const OnePlusOneRowSchema = z.object({
  id: z.string(),
  ep: z.number().int().positive().default(1),
  expected: z.string().default(""),
  payoff: z.string().default(""),
  plusOne: z.string().default(""),
});
export type OnePlusOneRow = z.infer<typeof OnePlusOneRowSchema>;

export const SuspenseBudgetSchema = z.object({
  longSuspenseCount: z.number().int().min(0).default(0),
  fourAttrAck: z.boolean().default(false),
});
export type SuspenseBudget = z.infer<typeof SuspenseBudgetSchema>;

export const SceneTripleDraftSchema = z.object({
  sceneId: z.string(),
  info: z.string().default(""),
  advance: z.string().default(""),
  change: z.string().default(""),
  done: z.boolean().default(false),
});
export type SceneTripleDraft = z.infer<typeof SceneTripleDraftSchema>;

export const TriangleDrillSchema = z.object({
  goal: z.string().default(""),
  reverseSetup: z.string().default(""),
  logicFall: z.string().default(""),
  arrive: z.string().default(""),
});
export type TriangleDrill = z.infer<typeof TriangleDrillSchema>;

export const OpeningPickSchema = z.object({
  type: z.string().default(""),
  note: z.string().default(""),
});
export type OpeningPick = z.infer<typeof OpeningPickSchema>;

export const Revise20ItemSchema = z.object({
  id: z.string(),
  label: z.string().default(""),
  done: z.boolean().default(false),
  patch: z.string().default(""),
});
export type Revise20Item = z.infer<typeof Revise20ItemSchema>;

export const LapianLiteSchema = z.object({
  band: z.enum(["male", "female", "unset"]).default("unset"),
  dims: z
    .array(z.object({ id: z.string(), done: z.boolean().default(false) }))
    .default(
      CHARLIE_LAPIAN_DIMS.map((d) => ({ id: d, done: false })),
    ),
});
export type LapianLite = z.infer<typeof LapianLiteSchema>;

export const DuanjuCharlieOpsSchema = z.object({
  schemaVersion: z.literal("charlie-duanju/1").default("charlie-duanju/1"),
  productLock: ProductLockSchema.default({}),
  topicFormula: TopicFormulaSchema.default({}),
  genderPath: GenderPathSchema.default({}),
  bridge8Coverage: z
    .array(Bridge8CoverageItemSchema)
    .default(CHARLIE_BRIDGE8.map((b) => ({ id: b.id, usedInEpOrScene: "", note: "" }))),
  onePlusOneRows: z.array(OnePlusOneRowSchema).default([]),
  suspenseBudget: SuspenseBudgetSchema.default({}),
  sceneTripleDraft: z.array(SceneTripleDraftSchema).default([]),
  triangleDrill: TriangleDrillSchema.default({}),
  openingPick: OpeningPickSchema.default({}),
  revise20: z
    .array(Revise20ItemSchema)
    .default(
      CHARLIE_REVISE20.map((label, i) => ({
        id: `r${i + 1}`,
        label,
        done: false,
        patch: "",
      })),
    ),
  lapianLite: LapianLiteSchema.default({}),
  comedyDoseAck: z.boolean().default(false),
  unitArcNoted: z.boolean().default(false),
  beatRows: z.array(CharlieBeatRowSchema).default([]),
  notes: z.string().default(""),
});
export type DuanjuCharlieOps = z.infer<typeof DuanjuCharlieOpsSchema>;

/* ───────────────────── 校验 / 完备度 ───────────────────── */

export function validateProductLock(p: ProductLock): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!p.demandOrderAck || !p.decompress || !p.immersion || !p.viscosity) {
    return { ok: false, level: "warn", message: "产品锁：需求序或三原则未齐" };
  }
  if (!p.payPsychology.trim()) {
    return { ok: false, level: "warn", message: "缺付费心理一句" };
  }
  return { ok: true, level: "pass", message: "产品锁通过" };
}

export function validateTopicFormula(t: TopicFormula): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (t.shell === "谜题导向") {
    return { ok: false, level: "warn", message: "谜题导向禁作主壳（PuzzleShell）" };
  }
  if (!t.wantHow.trim() || !t.viaWhat.trim()) {
    return { ok: false, level: "warn", message: "想怎样/通过啥未填" };
  }
  if (!t.shell.trim() || t.cool5Ids.length < 1) {
    return { ok: false, level: "warn", message: "故事壳或五爽点未选" };
  }
  return { ok: true, level: "pass", message: "选题公式齐" };
}

export function validateBridge8Coverage(rows: Bridge8CoverageItem[]): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const used = rows.filter((r) => r.usedInEpOrScene.trim()).length;
  if (used < 3) {
    return { ok: false, level: "warn", message: `八桥段落脚 ${used}/8（≥3）` };
  }
  return { ok: true, level: "pass", message: `八桥段已用 ${used}` };
}

export function validateSceneTripleRow(s: SceneTripleDraft): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!s.info.trim() || !s.advance.trim() || !s.change.trim()) {
    return { ok: false, level: "warn", message: "场三件套缺信息/推进/变化" };
  }
  return { ok: true, level: "pass", message: "场三件套齐" };
}

export function validateRevise20(
  items: Revise20Item[],
  opts?: { deliverReady?: boolean },
): { ok: boolean; level: "pass" | "warn"; message: string } {
  const done = items.filter((i) => i.done).length;
  const need = opts?.deliverReady ? 20 : 16;
  if (done < need) {
    return { ok: false, level: "warn", message: `修改20 ${done}/${need}` };
  }
  return { ok: true, level: "pass", message: `修改20 ${done}/20` };
}

export function summarizeDuanjuCharlieToMaster(ops: DuanjuCharlieOps): {
  duanjuCharlieSummary: string;
} {
  const parts = [
    validateProductLock(ops.productLock).ok ? "产品锁" : "",
    validateTopicFormula(ops.topicFormula).ok ? "选题公式" : "",
    ops.genderPath.pathAck ? `GenderPath:${ops.genderPath.band}` : "",
    validateBridge8Coverage(ops.bridge8Coverage).ok ? "bridge8" : "",
    ops.onePlusOneRows.some((r) => r.payoff.trim() && r.plusOne.trim()) ? "一加一" : "",
    ops.sceneTripleDraft.some((s) => validateSceneTripleRow(s).ok) ? "场三件套" : "",
    validateRevise20(ops.revise20).ok ? "修改20" : "",
  ].filter(Boolean);
  return { duanjuCharlieSummary: parts.join(" · ") };
}

export function duanjuCharlieOpsCompleteness(ops: DuanjuCharlieOps): {
  filledSteps: number;
  totalSteps: number;
  missing: string[];
} {
  const missing: string[] = [];
  const stepDone: boolean[] = [];
  stepDone[0] = validateProductLock(ops.productLock).ok;
  if (!stepDone[0]) missing.push("产品锁");
  stepDone[1] = validateTopicFormula(ops.topicFormula).ok;
  if (!stepDone[1]) missing.push("选题公式");
  stepDone[2] = ops.genderPath.pathAck && ops.genderPath.band !== "unset";
  if (!stepDone[2]) missing.push("GenderPath");
  stepDone[3] = validateBridge8Coverage(ops.bridge8Coverage).ok;
  if (!stepDone[3]) missing.push("八桥段");
  stepDone[4] = ops.onePlusOneRows.some((r) => r.payoff.trim() && r.plusOne.trim());
  if (!stepDone[4]) missing.push("一加一");
  stepDone[5] =
    ops.suspenseBudget.fourAttrAck && ops.suspenseBudget.longSuspenseCount <= 1;
  if (!stepDone[5]) missing.push("悬念预算");
  stepDone[6] = ops.sceneTripleDraft.some((s) => validateSceneTripleRow(s).ok);
  if (!stepDone[6]) missing.push("场三件套");
  stepDone[7] = validateRevise20(ops.revise20).ok;
  if (!stepDone[7]) missing.push("修改20");
  stepDone[8] = ops.lapianLite.dims.filter((d) => d.done).length >= 3;
  if (!stepDone[8]) missing.push("拉片轻勾");
  stepDone[9] = Boolean(summarizeDuanjuCharlieToMaster(ops).duanjuCharlieSummary.trim());
  if (!stepDone[9]) missing.push("回写摘要");
  return {
    filledSteps: stepDone.filter(Boolean).length,
    totalSteps: 10,
    missing,
  };
}

/* ───────────────────── 章回体单元剧 / 探案任务（查理 6.5/6.6） ───────────────────── */

/** 单元剧 / 探案任务的两种章回骨架。 */
export const CHARLIE_UNIT_ARCHETYPES = [
  { id: "unit_sitcom", label: "章回体单元剧", tip: "每集一个独立单元冲突，主线串珠（喜剧/情景常驻班底）" },
  { id: "detective_procedural", label: "探案任务", tip: "案发→排查→反转→破案，每案一个单元，主角有硬任务" },
] as const;
export type CharlieUnitArchetype = (typeof CHARLIE_UNIT_ARCHETYPES)[number]["id"];

export const UnitSitcomPlanSchema = z.object({
  schemaVersion: z.literal("charlie-unit/1").default("charlie-unit/1"),
  archetype: z.enum(["unit_sitcom", "detective_procedural"]).default("unit_sitcom"),
  /** 常驻班底：单元剧靠固定人设/场景跑量，每集换「单元事件」而非换主角 */
  residentCast: z.string().default(""),
  residentScene: z.string().default(""),
  /** 单元公式：每集一目标一冲突一收束（探案则：案发/排查/反转/破案） */
  unitFormula: z.string().default(""),
  /** 主线串珠：单元之间靠主线升级钩串联，避免纯单元散装 */
  throughLine: z.string().default(""),
  /** 第一单元示范 */
  pilotUnit: z.string().default(""),
});
export type UnitSitcomPlan = z.infer<typeof UnitSitcomPlanSchema>;

export function validateUnitSitcomPlan(p: UnitSitcomPlan): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const missing: string[] = [];
  if (!p.residentCast.trim()) missing.push("常驻班底");
  if (!p.unitFormula.trim()) missing.push("单元公式");
  if (!p.throughLine.trim()) missing.push("主线串珠");
  if (!p.pilotUnit.trim()) missing.push("第一单元");
  if (p.archetype === "detective_procedural" && !/案发|排查|反转|破案/.test(p.unitFormula)) {
    missing.push("探案须点明案发→排查→反转→破案");
  }
  if (missing.length) {
    return { ok: false, level: "warn", message: `缺：${missing.join("、")}` };
  }
  return { ok: true, level: "pass", message: "单元剧/探案骨架齐" };
}
