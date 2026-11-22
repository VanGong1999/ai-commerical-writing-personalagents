import {
  CHARLIE_BEAT20,
  CHARLIE_BRIDGE8,
  CHARLIE_REVISE20,
  CHARLIE_UNIT_ARCHETYPES,
  DuanjuCharlieOpsSchema,
  UnitSitcomPlanSchema,
  defaultCharlieBeatRows,
  duanjuCharlieOpsCompleteness,
  summarizeDuanjuCharlieToMaster,
  validateBridge8Coverage,
  validateProductLock,
  validateRevise20,
  validateTopicFormula,
  validateUnitSitcomPlan,
} from "./duanju-charlie";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(CHARLIE_BEAT20.length === 20, "beat20 len");
assert(CHARLIE_BEAT20[0]!.name === "环境规则", "beat1 name");
assert(CHARLIE_BEAT20[19]!.name === "回到原点", "beat20 name");
assert(CHARLIE_BRIDGE8.length === 8, "bridge8");
assert(CHARLIE_REVISE20.length === 20, "revise20");

const rows = defaultCharlieBeatRows();
assert(rows.length === 20 && rows[9]!.name === "故事拐点", "midpoint name");

const empty = DuanjuCharlieOpsSchema.parse({});
assert(duanjuCharlieOpsCompleteness(empty).totalSteps === 10, "ops ten");
assert(validateProductLock(empty.productLock).ok === false, "product fail");
assert(
  validateTopicFormula({ ...empty.topicFormula, shell: "谜题导向", wantHow: "a", viaWhat: "b", cool5Ids: ["两性"] }).ok ===
    false,
  "puzzle shell fail",
);

const full = DuanjuCharlieOpsSchema.parse({
  productLock: {
    demandOrderAck: true,
    decompress: true,
    immersion: true,
    viscosity: true,
    payPsychology: "充值=预期管理",
  },
  topicFormula: {
    wantHow: "打脸退婚",
    viaWhat: "系统极简",
    cool5Ids: ["秩序", "征服"],
    shell: "奇遇导向",
    accountTier: "full",
  },
  genderPath: { band: "male", pathNote: "自己动手", pathAck: true },
  bridge8Coverage: CHARLIE_BRIDGE8.map((b, i) => ({
    id: b.id,
    usedInEpOrScene: i < 3 ? `EP${i + 1}` : "",
    note: "",
  })),
  onePlusOneRows: [
    { id: "1", ep: 1, expected: "打脸", payoff: "亮身份", plusOne: "围观倒吸冷气" },
  ],
  suspenseBudget: { longSuspenseCount: 1, fourAttrAck: true },
  sceneTripleDraft: [
    { sceneId: "s1", info: "仇家上门", advance: "对峙", change: "金手指露头", done: true },
  ],
  revise20: CHARLIE_REVISE20.map((label, i) => ({
    id: `r${i + 1}`,
    label,
    done: true,
    patch: "",
  })),
  lapianLite: {
    band: "male",
    dims: [
      { id: "爽点密度", done: true },
      { id: "付费钩", done: true },
      { id: "人设辨识", done: true },
    ],
  },
});
assert(validateBridge8Coverage(full.bridge8Coverage).ok, "bridge ok");
assert(validateRevise20(full.revise20, { deliverReady: true }).ok, "revise full");
assert(
  duanjuCharlieOpsCompleteness(full).filledSteps === 10,
  `full ${duanjuCharlieOpsCompleteness(full).missing.join(",")}`,
);
assert(Boolean(summarizeDuanjuCharlieToMaster(full).duanjuCharlieSummary.trim()), "sum");

// 章回体单元剧 / 探案（查理 6.6）
assert(CHARLIE_UNIT_ARCHETYPES.length === 2, "unit archetypes");
const emptyUnit = UnitSitcomPlanSchema.parse({});
assert(validateUnitSitcomPlan(emptyUnit).ok === false, "unit plan fail on empty");
const sitcom = UnitSitcomPlanSchema.parse({
  archetype: "unit_sitcom",
  residentCast: "张三(麻烦制造者) 李四(解决者)",
  residentScene: "合租公寓",
  unitFormula: "每集一误会一和解",
  throughLine: "创业线升级钩",
  pilotUnit: "第一集：搬进公寓引发误会，起承转合",
});
assert(validateUnitSitcomPlan(sitcom).ok === true, "unit sitcom ok");
const detective = UnitSitcomPlanSchema.parse({
  archetype: "detective_procedural",
  residentCast: "侦探+搭档",
  residentScene: "警局",
  unitFormula: "案发→排查→反转→破案",
  throughLine: "连环案主线",
  pilotUnit: "第一案完整起承转合",
});
assert(validateUnitSitcomPlan(detective).ok === true, "detective ok");
const badDetective = UnitSitcomPlanSchema.parse({
  archetype: "detective_procedural",
  residentCast: "侦探",
  residentScene: "警局",
  unitFormula: "每集查一个案",
  throughLine: "主线",
  pilotUnit: "示范",
});
assert(validateUnitSitcomPlan(badDetective).ok === false, "detective needs 案发排查反转破案");

console.log("duanju-charlie ok");
