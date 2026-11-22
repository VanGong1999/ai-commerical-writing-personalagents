import {
  DissectParamsBodySchema,
  UnitSevenStepsSchema,
  SwapImitateWorkflowSchema,
  ExpectationConflictWorkflowSchema,
  ExpectationDesign1Plus3Schema,
  ConflictDesignSchema,
  EmotionRhythmWorkflowSchema,
  CONFLICT_SIX_ELEMENT_IDS,
  DEFAULT_EXPECTATION_REVISE_ITEMS,
  DEFAULT_EMOTION_RENDER_ITEMS,
  SCREEN_SCORE_THRESHOLD,
  defaultSixElementsMapping,
  dissectParamsCompleteness,
  unitSevenStepsCompleteness,
  sixElementsCompleteness,
  emotionSlopeCompleteness,
  qcPriorityCompleteness,
  swapImitateCompleteness,
  rhythmQuantCompleteness,
  expectation1Plus3Completeness,
  conflictSixCompleteness,
  pairingCompleteness,
  computeAiCandidateScreenScore,
  expectationConflictWorkflowCompleteness,
  summarizeExpectationConflictToMaster,
  classifyWorkGenreByHarm,
  validateRanBoundToShuang,
  validateObstacleEscalation,
  validateTightLooseMatch,
  validateZhangChiSequence,
  threeRoundPullCompleteness,
  seePersonCompleteness,
  emotionRhythmWorkflowCompleteness,
  summarizeEmotionRhythmToMaster,
  CoolFaceSlapWorkflowSchema,
  cool12PlanCompleteness,
  faceSlapPremiseCompleteness,
  suggestEmotionIntensity,
  validateTierInfoGap,
  validateToolspersonStatus,
  validatePowerRevealLayers,
  coolFaceSlapWorkflowCompleteness,
  summarizeCoolFaceSlapToMaster,
  defaultBeatsForTier,
  DEFAULT_RHYTHM_QUANT,
  InspirationToStoryWorkflowSchema,
  recommendPathForLevel,
  inspirationClassifyCompleteness,
  plotThreeCompleteness,
  fiveActCompleteness,
  sceneFourCompleteness,
  aiReviseCompleteness,
  validateEarlyForgive,
  validateCoreEventDump,
  validateSceneFourDry,
  inspirationToStoryWorkflowCompleteness,
  summarizeInspirationToStoryToMaster,
  SCENE_FOUR_RAIN_HERB_TEMPLATE,
  TopicSelectionWorkflowSchema,
  topicSelectionWorkflowCompleteness,
  validateAudienceExclusive,
  validateIntroOverstuff,
  validateMasterBeatCount,
  validateFivePitfalls,
  summarizeTopicSelectionToMaster,
  CharacterDepthWorkflowSchema,
  characterDepthWorkflowCompleteness,
  validateSoulProbe,
  validateForeshadowRecover,
  validateShortSubmitGate,
  handEdit12Completeness,
  summarizeCharacterDepthToMaster,
  syncRelationNetFromCharacterSheet,
  SHORT_HAND_EDIT_12_LABELS,
  ManjuPipelineWorkflowSchema,
  manjuPipelineWorkflowCompleteness,
  parseCoolExpandToEvents,
  HOOK_BATCH_COUNTS,
  COOL_EXPAND_COUNTS,
  validateLoglineSocial,
  validateCoarseOutline,
  validateEpisodeRhythm,
  validateRejectThree,
  validatePitchEthics,
  summarizeManjuPipelineToMaster,
  ManjuGenreTrackWorkflowSchema,
  manjuGenreTrackWorkflowCompleteness,
  validateBenchmarkCollection,
  validateGenreTrackFill,
  validateKernelExtract,
  summarizeManjuGenreTrackToMaster,
  MANJU_DISCOURAGED_TOPICS,
  DIALOGUE_13_RULES,
  IpAdaptWorkflowSchema,
  ipAdaptWorkflowCompleteness,
  validateIpSelectGoNoGo,
  validateAdaptAnchor,
  validateAdaptPitchPack,
  validatePaywallEmotionCut,
  summarizeIpAdaptToMaster,
  deriveAdaptBudget,
  deriveAdaptPitchPack,
  validateUnitEmotionTrail,
  tomatoRefWarn,
  FemaleLongDepthWorkflowSchema,
  FemaleFourSwapThreeSchema,
  femaleLongDepthWorkflowCompleteness,
  validateFemaleFourSwapThree,
  MaleLongEngineWorkflowSchema,
  maleLongEngineCompleteness,
  validateTopicOrderGate,
  validateMainlineCoreGate,
  validateBlurbFiveParts,
  validateLoopPlan,
  summarizeMaleLongEngineToMaster,
  patchMasterFromMaleLongEngine,
  MasterOutlineBodySchema,
  validateTopicSixHazards,
  validateCharPractice,
  validateArchPractice,
  validateRetentionTargets,
  validateEightReports,
  summarizeFemaleLongDepthToMaster,
  EIGHT_PREWRITE_LABELS,
  FEMALE_HEROINE_CRAFT,
  FEMALE_HERO_CRAFT,
  femalePaceDepthCompleteness,
  validatePaceOutline,
  validateEmotionLab,
  validateMonetizePlan,
  summarizeFemalePaceDepthToMaster,
  FemalePaceDepthSchema,
  manjuKoalaCompleteness,
  validatePromptTrimAck,
  summarizeManjuKoalaToMaster,
  ManjuAdvancedWorkflowSchema,
  manjuAdvancedCompleteness,
  validateElementCombo,
  validateAct100Tasks,
  summarizeManjuAdvancedToMaster,
  DEFAULT_ACT100_SEGMENTS,
  MANJU_COOL18_MODELS,
  MANJU_KARTIAN_TYPES,
  MANJU_KARTIAN_TYPE_NAMES,
  ManjuHandbookOpsSchema,
  manjuHandbookOpsCompleteness,
  summarizeManjuHandbookToMaster,
  validateMarketGenreAck,
  validateScriptFormatGate,
  validateExtendForm,
} from "./nines-workflow";
import {
  EpisodeOutlineBodySchema,
  PitchPackBodySchema,
  validateEpisodeOutlineHandbookRow,
  validateEp10HandbookAccept,
  validatePitchPackBody,
} from "./entities";
import { checkCoreHookAdoption, canStrongAdopt } from "./gates";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const empty = DissectParamsBodySchema.parse({});
const emptyScore = dissectParamsCompleteness(empty);
assert(emptyScore.filled === 0 && emptyScore.total === 11, "empty dissect should be 0/11");
assert(emptyScore.missing.includes("七步法"), "should miss 七步法");

const filled = DissectParamsBodySchema.parse({
  basic: { synopsis: "重生复仇", genre: "都市", typeLabel: "短篇" },
  expectations: { big: "翻盘", small: ["保住股权"] },
  setting: { background: "都市", protagonist: "林川", supporting: ["苏晚"] },
  storyline: { coreContent: "夜袭→董事会→反杀", note: "≠核心梗" },
  conflicts: ["家族腐败"],
  emotionCurve: [{ beatLabel: "醒来", value: -6 }],
  relationships: [{ from: "林川", to: "苏晚", bond: "旧情" }],
  twists: ["白月光是推手"],
  qiChengZhuanHe: { qi: "起", cheng: "承", zhuan: "转", he: "合" },
  sevenSteps: {
    goal: "夺权",
    obstacle: "无证据",
    action: "装傻",
    result: "失败",
    accident: "发现备份",
    twist: "反杀",
    ending: "稳住",
  },
  rhythmStyle: { rhythm: "先抑后扬", style: "写实" },
});
const fullScore = dissectParamsCompleteness(filled);
assert(fullScore.filled === 11 && fullScore.pct === 100, "full dissect should be 100%");

const early = UnitSevenStepsSchema.parse({
  goal: "当皇后",
  obstacle: "只是商人",
  action: "招兵",
  result: "立刻成功登基",
  accident: "",
  twist: "",
  ending: "HE",
});
const earlyScore = unitSevenStepsCompleteness(early);
assert(earlyScore.earlySuccessRisk === true, "early success without accident should flag risk");
assert(earlyScore.missing.includes("意外"), "missing 意外");

/* ── 3.md：六元素 / 换元 / 质检 ── */

const onceMap = defaultSixElementsMapping("once");
assert(onceMap.degree === "once", "once degree");
const eventOnce = onceMap.rows.find((r) => r.key === "event");
assert(eventOnce && eventOnce.swappable === false, "一度事件不可换");

const twiceMap = defaultSixElementsMapping("twice");
const eventTwice = twiceMap.rows.find((r) => r.key === "event");
assert(eventTwice && eventTwice.swappable === true, "二度事件可换");

const sixScore = sixElementsCompleteness(onceMap);
assert(sixScore.missing.length > 0, "empty six elements should miss fields");

const slope = emotionSlopeCompleteness({
  items: [
    {
      chapterNo: 1,
      sourceSlope: "up",
      sourceNote: "温馨",
      newSlope: "down",
      newNote: "震惊",
      aligned: false,
      regenerated: false,
    },
    {
      chapterNo: 2,
      sourceSlope: "down",
      sourceNote: "",
      newSlope: "down",
      newNote: "",
      aligned: true,
      regenerated: false,
    },
  ],
  principleNote: "",
});
assert(slope.misaligned === 1 && slope.misalignedChapters[0] === 1, "slope misalign ch1");

const qcEmpty = qcPriorityCompleteness(
  SwapImitateWorkflowSchema.parse({}).qc,
);
assert(qcEmpty.readyToSubmit === false, "empty qc not ready");
assert(qcEmpty.p1.total >= 4, "p1 has framework items");

const rhythm = rhythmQuantCompleteness({
  ...DEFAULT_RHYTHM_QUANT,
  actualChapters: 20,
  actualPlotPointsPerChapter: [3],
});
assert(rhythm.ok === false && rhythm.warnings.length >= 1, "rhythm should warn");

const swapEmpty = SwapImitateWorkflowSchema.parse({});
assert(swapEmpty.beatBatchSize <= 5, "batch size capped at 5");
assert(swapEmpty.rhythmQuant.targetChapters === 12, "default 12 chapters");
const swapScore = swapImitateCompleteness(swapEmpty);
assert(swapScore.totalSteps === 7, "seven steps");
assert(swapScore.filledSteps < 7, "empty swap incomplete");

const swapPicked = SwapImitateWorkflowSchema.parse({
  method: { preferredDegree: "once", genrePreference: "爽文", avoidSciFi: true },
  fourLayers: {
    comprehensiveDone: true,
    beatAndRhythmDone: true,
    chapterOutlineDone: true,
    crossCheckPassed: true,
  },
  selectedSwapId: "s1",
  newSynopsis: "滑雪场甜文梗概",
  chapterOutlineReady: true,
  beatSwapProgress: [{ chapterNo: 1, done: true, note: "" }],
  castCount: 3,
  chapterReviseBeforeNext: true,
  chaptersRevised: [{ chapterNo: 1, generated: true, polished: true, humanRevised: true }],
  qc: {
    p1Framework: [
      { id: "logic", label: "逻辑", done: true },
      { id: "character_break", label: "人设", done: true },
      { id: "core_conflict", label: "矛盾", done: true },
      { id: "mainline", label: "主线", done: true },
      { id: "world_consistent", label: "世界观", done: true },
      { id: "foreshadow_p1", label: "伏笔", done: true },
    ],
    p2EmotionRhythm: [
      { id: "emotion", label: "情绪", done: true },
      { id: "rhythm", label: "节奏", done: true },
      { id: "foreshadow", label: "伏笔", done: true },
    ],
    humanReviewed: true,
  },
});
const swapFull = swapImitateCompleteness(swapPicked);
assert(swapFull.filledSteps === 7, `expected 7 filled, got ${swapFull.filledSteps}: ${swapFull.missing.join(",")}`);

/* ── 4.md：期待感 / 冲突 ── */

const empty1p3 = ExpectationDesign1Plus3Schema.parse({});
const empty1p3Score = expectation1Plus3Completeness(empty1p3);
assert(empty1p3Score.smallSlotCount === 0, "empty 1+3 has 0 small filled");
assert(empty1p3Score.missing.includes("核心期待"), "empty 1+3 misses core");

const full1p3 = ExpectationDesign1Plus3Schema.parse({
  core: { content: "翻盘夺权", castAt: "导语", layer: "core", size: "big", span: "far" },
  small: [
    { content: "保住股权", castAt: "第1节", layer: "small", maxCharsHint: 1000 },
    { content: "揭穿内鬼", castAt: "第2节", layer: "small", maxCharsHint: 1000 },
    { content: "董事会反杀", castAt: "第3节", layer: "small", maxCharsHint: 1000 },
  ],
  farNearStrategy: "远打底近拉满",
  openingRevealByChars: 3000,
  goldChapterChars: 400,
  noSidePlot: true,
});
const full1p3Score = expectation1Plus3Completeness(full1p3);
assert(full1p3Score.smallSlotCount === 3, "full 1+3 has 3 small");
assert(full1p3Score.missing.length === 0, `1+3 missing: ${full1p3Score.missing.join(",")}`);

const emptyConflict = ConflictDesignSchema.parse({});
const emptySix = conflictSixCompleteness(emptyConflict);
assert(emptySix.complete === false, "empty six incomplete");
assert(emptySix.total === 6, "six elements = 6");

const fullConflict = ConflictDesignSchema.parse({
  oneLiner: "老员工抢创意逼主角绝路",
  kind: "hostile",
  locus: "external",
  upgradeMode: "singleEvent",
  upgradeSteps: ["偷改方案", "抢先汇报", "逼其当场反驳"],
  chainUnbroken: true,
  antiDeusEx: true,
  noWinWin: true,
  six: {
    items: CONFLICT_SIX_ELEMENT_IDS.map((id) => ({ id, done: true, evidence: "ok" })),
  },
});
assert(conflictSixCompleteness(fullConflict).complete === true, "full six complete");

const pairFail = pairingCompleteness({
  coreExpectationId: "",
  coreConflictId: "c1",
  smallPairs: [],
  note: "",
});
assert(pairFail.complete === false && pairFail.missing.length >= 1, "pairing fails without core");

const pairOk = pairingCompleteness({
  coreExpectationId: "e0",
  coreConflictId: "c0",
  smallPairs: [
    { expectationId: "e1", conflictId: "c1", ok: true },
    { expectationId: "e2", conflictId: "c2", ok: true },
    { expectationId: "e3", conflictId: "c3", ok: true },
  ],
  note: "",
});
assert(pairOk.complete === true, "pairing ok");

const lowScore = computeAiCandidateScreenScore({
  expectClear: true,
  expect1Plus3: false,
  expectUrgency: false,
  expectEnding: false,
  conflictHitsProtagonist: true,
  conflictDeadEnd: false,
  conflictEscalates: false,
  note: "",
});
assert(lowScore.total === 2, "low score total 2");
assert(lowScore.lowScoreWarned === true, "low score warned");
assert(SCREEN_SCORE_THRESHOLD === 5, "threshold 5");

const highScore = computeAiCandidateScreenScore({
  expectClear: true,
  expect1Plus3: true,
  expectUrgency: true,
  expectEnding: true,
  conflictHitsProtagonist: true,
  conflictDeadEnd: true,
  conflictEscalates: true,
  note: "可过",
});
assert(highScore.total === 7 && highScore.lowScoreWarned === false, "high score ok");

const ecEmpty = ExpectationConflictWorkflowSchema.parse({});
const ecEmptyScore = expectationConflictWorkflowCompleteness(ecEmpty);
assert(ecEmptyScore.totalSteps === 9, "nine steps");
assert(ecEmptyScore.filledSteps === 0 || ecEmptyScore.filledSteps < 9, "empty ec incomplete");
assert(ecEmptyScore.canMarkReverseDone === false, "no cool point → cannot mark reverse");
assert(ecEmpty.reviseChecklist.length === DEFAULT_EXPECTATION_REVISE_ITEMS.length, "revise items");

const ecFull = ExpectationConflictWorkflowSchema.parse({
  synopsis: "重生夜袭董事会翻盘",
  logline: "被夺权的总裁重生一夜翻盘",
  design: full1p3,
  conflicts: [fullConflict],
  pairing: {
    coreExpectationId: "core",
    coreConflictId: fullConflict.id || "c0",
    smallPairs: [
      { expectationId: "s1", conflictId: "c1", ok: true },
      { expectationId: "s2", conflictId: "c2", ok: true },
      { expectationId: "s3", conflictId: "c3", ok: true },
    ],
  },
  coolReverse: {
    coolPointFirst: "董事会当场反杀",
    fourStep: {
      pull: "股权将失",
      intensify: "对手抢创意",
      feint: "差点被赶出",
      overpay: "证据砸场超额打脸",
      emotionChain: { protagonist: "冷笑", antagonist: "慌", atmosphere: "震惊" },
    },
    reverseHooks: [{ hook: "备份U盘", buryAt: "开篇", payoffAt: "董事会", linkedExpectationId: "s3" }],
    reverseDone: true,
  },
  reviseChecklist: DEFAULT_EXPECTATION_REVISE_ITEMS.map((i) => ({ ...i, done: true })),
});
// fix pairing core ids to non-empty for parse - already set
const ecFullFixed = {
  ...ecFull,
  pairing: {
    ...ecFull.pairing,
    coreExpectationId: "core",
    coreConflictId: "c0",
  },
  conflicts: [
    {
      ...ecFull.conflicts[0],
      id: "c0",
    },
  ],
};
const ecFullScore = expectationConflictWorkflowCompleteness(ecFullFixed);
assert(
  ecFullScore.filledSteps === 9,
  `expected 9 filled, got ${ecFullScore.filledSteps}: ${ecFullScore.missing.join(",")}`,
);
assert(ecFullScore.canMarkConflictDone === true, "six complete → can mark conflict");
assert(ecFullScore.canMarkReverseDone === true, "cool point → can mark reverse");

const masterThin = summarizeExpectationConflictToMaster(ecFullFixed);
assert(masterThin.bigExpectation === "翻盘夺权", "master big expect");
assert(masterThin.smallExpectations.length === 3, "master 3 small");
assert(masterThin.coreConflictOneLiner.includes("老员工"), "master conflict");

const dissectDeep = DissectParamsBodySchema.parse({
  expectations: { big: "翻盘", small: ["股权"], design: full1p3 },
  conflictDesigns: [fullConflict],
  conflicts: ["家族腐败"],
});
assert(dissectDeep.expectations.design?.core.content === "翻盘夺权", "dissect design nested");
assert(dissectDeep.conflictDesigns.length === 1, "conflict designs");

const qcWithL4 = SwapImitateWorkflowSchema.parse({}).qc;
assert(
  qcWithL4.p1Framework.some((i) => i.id === "expect_1plus3"),
  "qc p1 has 4.md expect item",
);
assert(
  qcWithL4.p2EmotionRhythm.some((i) => i.id === "show_dont_tell"),
  "qc p2 has 5.md show_dont_tell",
);
assert(
  qcWithL4.p2EmotionRhythm.some((i) => i.id === "three_round"),
  "qc p2 has 5.md three_round",
);
assert(
  qcWithL4.p2EmotionRhythm.some((i) => i.id === "face_slap_premise"),
  "qc p2 has 6.md face_slap_premise",
);
assert(
  qcWithL4.p2EmotionRhythm.some((i) => i.id === "immersion_five"),
  "qc p2 has 6.md immersion_five",
);

/* ───── 5.md 情绪与节奏 ───── */
assert(classifyWorkGenreByHarm("none_irreversible") === "纯爽", "harm→爽");
assert(classifyWorkGenreByHarm("possible_irreversible") === "纯虐", "harm→虐");
assert(classifyWorkGenreByHarm("almost_none") === "纯甜", "harm→甜");
assert(classifyWorkGenreByHarm("mixed") === "爽虐结合", "harm→爽虐结合");
assert(classifyWorkGenreByHarm("none_irreversible", "燃") === "爽燃", "燃→爽燃");

const ranBad = validateRanBoundToShuang({
  core: "燃",
  protagonistState: "热血",
  harmLevel: "none_irreversible",
  genreLabel: "爽燃",
  noviceSingleCoreLocked: true,
  ranBoundToShuang: false,
  secondaryEmotions: [],
  note: "",
});
assert(ranBad.ok === false, "燃单独成核拦截");

const ranOk = validateRanBoundToShuang({
  core: "燃",
  protagonistState: "热血",
  harmLevel: "none_irreversible",
  genreLabel: "爽燃",
  noviceSingleCoreLocked: true,
  ranBoundToShuang: true,
  secondaryEmotions: [],
  note: "",
});
assert(ranOk.ok === true, "燃绑定爽通过");

const pullDec = validateObstacleEscalation({
  isomorphicNote: "",
  gapExpectation: "金手指",
  linkedExpectationId: "",
  rounds: [
    { index: 1, partialSatisfy: "a", obstacle: "o1", obstacleLevel: 8, resolveOrFake: "", escalate: "", expectationNote: "", emotionNote: "" },
    { index: 2, partialSatisfy: "b", obstacle: "o2", obstacleLevel: 3, resolveOrFake: "", escalate: "", expectationNote: "", emotionNote: "" },
    { index: 3, partialSatisfy: "c", obstacle: "o3", obstacleLevel: 9, resolveOrFake: "", escalate: "", expectationNote: "", emotionNote: "" },
  ],
  outcome: "overpay",
  refuseFate: true,
  villainEnding: "undecided",
  replayAmplify: "放大",
  replayMode: "升华",
  surpriseGain: "",
});
assert(pullDec.ok === false && pullDec.warnings.length >= 1, "阻碍递减 fail");

const pullAsc = validateObstacleEscalation({
  isomorphicNote: "",
  gapExpectation: "金手指",
  linkedExpectationId: "",
  rounds: [
    { index: 1, partialSatisfy: "a", obstacle: "o1", obstacleLevel: 3, resolveOrFake: "", escalate: "", expectationNote: "", emotionNote: "" },
    { index: 2, partialSatisfy: "b", obstacle: "o2", obstacleLevel: 6, resolveOrFake: "", escalate: "", expectationNote: "", emotionNote: "" },
    { index: 3, partialSatisfy: "c", obstacle: "o3", obstacleLevel: 9, resolveOrFake: "", escalate: "", expectationNote: "", emotionNote: "" },
  ],
  outcome: "overpay",
  refuseFate: true,
  villainEnding: "dead",
  replayAmplify: "放大",
  replayMode: "升华",
  surpriseGain: "意外股权",
});
assert(pullAsc.ok === true, "阻碍单调不减 pass");

const nueRefuse = threeRoundPullCompleteness({
  isomorphicNote: "",
  gapExpectation: "温暖",
  linkedExpectationId: "",
  rounds: [
    { index: 1, partialSatisfy: "希望", obstacle: "反对", obstacleLevel: 3, resolveOrFake: "", escalate: "", expectationNote: "", emotionNote: "" },
    { index: 2, partialSatisfy: "和好", obstacle: "赌约", obstacleLevel: 6, resolveOrFake: "", escalate: "", expectationNote: "", emotionNote: "" },
    { index: 3, partialSatisfy: "假破局", obstacle: "落空", obstacleLevel: 9, resolveOrFake: "", escalate: "", expectationNote: "", emotionNote: "" },
  ],
  outcome: "fallthrough",
  refuseFate: false,
  villainEnding: "undecided",
  replayAmplify: "留白",
  replayMode: "留白",
  surpriseGain: "",
});
assert(nueRefuse.refuseFateOk === false, "虐文认命 fail");

const nueOkPull = threeRoundPullCompleteness({
  isomorphicNote: "",
  gapExpectation: "温暖",
  linkedExpectationId: "",
  rounds: [
    { index: 1, partialSatisfy: "希望", obstacle: "反对", obstacleLevel: 3, resolveOrFake: "", escalate: "", expectationNote: "", emotionNote: "" },
    { index: 2, partialSatisfy: "和好", obstacle: "赌约", obstacleLevel: 6, resolveOrFake: "", escalate: "", expectationNote: "", emotionNote: "" },
    { index: 3, partialSatisfy: "假破局", obstacle: "落空", obstacleLevel: 9, resolveOrFake: "", escalate: "", expectationNote: "", emotionNote: "" },
  ],
  outcome: "fallthrough",
  refuseFate: true,
  villainEnding: "undecided",
  replayAmplify: "留白",
  replayMode: "留白",
  surpriseGain: "",
});
assert(nueOkPull.refuseFateOk === true && nueOkPull.escalationOk === true, "虐文不认命 pass");

const seeEmpty = seePersonCompleteness({ scenes: [], principleNote: "" });
assert(seeEmpty.canMarkDone === false, "无场景不可完成以事见人");

const seeNoReaction = seePersonCompleteness({
  scenes: [
    {
      id: "s1",
      sceneLabel: "生日",
      protagonistReaction: "",
      controlGroup: "弟弟",
      atmosphereGroup: "邻居",
      atmospherePolarity: "negative",
      environmentCue: "",
      causeBeforeEffect: "",
      subtext: "",
      actionMemoryPoint: "",
      actionPurpose: "",
      appearanceAsMood: "",
      sensoryRecall: "",
      countdownTimer: "",
      sentenceTension: "mixed",
      payload: {
        verbal: "",
        nonverbalAction: "",
        nonverbalReaction: "",
        nonverbalOs: "",
        inferredEmotion: "",
      },
      intensityWarn: false,
    },
  ],
  principleNote: "",
});
assert(seeNoReaction.canMarkDone === false, "无主角反应不完整");

const seeFull = seePersonCompleteness({
  scenes: [
    {
      id: "s1",
      sceneLabel: "生日",
      protagonistReaction: "一哭二闹求礼物",
      controlGroup: "弟弟要贵鞋妈妈卖首饰",
      atmosphereGroup: "奶奶说女孩子迟早要嫁人",
      atmospherePolarity: "negative",
      environmentCue: "",
      causeBeforeEffect: "长期偏心",
      subtext: "",
      actionMemoryPoint: "撒泼打滚",
      actionPurpose: "展现不公",
      appearanceAsMood: "",
      sensoryRecall: "",
      countdownTimer: "",
      sentenceTension: "short_tense",
      payload: { verbal: "", nonverbalAction: "哭闹", nonverbalReaction: "", nonverbalOs: "", inferredEmotion: "委屈" },
      intensityWarn: false,
    },
  ],
  principleNote: "",
});
assert(seeFull.canMarkDone === true && seeFull.intensityWarnings.length === 0, "有对照气氛强度OK");

const seeWeak = seePersonCompleteness({
  scenes: [
    {
      id: "s2",
      sceneLabel: "只有反应",
      protagonistReaction: "握拳",
      controlGroup: "",
      atmosphereGroup: "",
      atmospherePolarity: "mixed",
      environmentCue: "",
      causeBeforeEffect: "",
      subtext: "",
      actionMemoryPoint: "",
      actionPurpose: "",
      appearanceAsMood: "",
      sensoryRecall: "",
      countdownTimer: "",
      sentenceTension: "mixed",
      payload: {
        verbal: "",
        nonverbalAction: "",
        nonverbalReaction: "",
        nonverbalOs: "",
        inferredEmotion: "",
      },
      intensityWarn: true,
    },
  ],
  principleNote: "",
});
assert(seeWeak.canMarkDone === true && seeWeak.intensityWarnings.length >= 1, "缺对照气氛告警");

const mismatch = validateTightLooseMatch({
  beatLabel: "追杀",
  targetEmotion: "紧张打戏",
  selectedElements: ["环境", "动作"],
  mismatchWarned: false,
  note: "",
});
assert(mismatch.ok === false, "紧张段插环境错配");

const matchOk = validateTightLooseMatch({
  beatLabel: "开打",
  targetEmotion: "紧张",
  selectedElements: ["动作", "感受"],
  mismatchWarned: false,
  note: "",
});
assert(matchOk.ok === true, "紧张段快元素OK");

const zcBad = validateZhangChiSequence([
  { unitLabel: "1", kind: "tense", note: "" },
  { unitLabel: "2", kind: "tense", note: "" },
  { unitLabel: "3", kind: "tense", note: "" },
]);
assert(zcBad.ok === false, "全紧张情绪透支");

const zcOk = validateZhangChiSequence([
  { unitLabel: "1", kind: "tense", note: "" },
  { unitLabel: "2", kind: "relax", note: "" },
  { unitLabel: "3", kind: "tense", note: "" },
]);
assert(zcOk.ok === true, "张弛交替OK");

const erEmpty = EmotionRhythmWorkflowSchema.parse({});
const erEmptyScore = emotionRhythmWorkflowCompleteness(erEmpty);
assert(erEmptyScore.totalSteps === 9, "nine required steps");
assert(erEmptyScore.filledSteps < 10, "empty er incomplete");
assert(erEmpty.renderChecklist.length === DEFAULT_EMOTION_RENDER_ITEMS.length, "render items");

const erFull = EmotionRhythmWorkflowSchema.parse({
  anchor: {
    core: "爽",
    protagonistState: "被打压但不认输",
    harmLevel: "none_irreversible",
    genreLabel: "纯爽",
    noviceSingleCoreLocked: true,
    ranBoundToShuang: false,
    shuangSubtype: "力量型",
  },
  pull: {
    gapExpectation: "捡到玉佩读心术",
    linkedExpectationId: "core",
    rounds: [
      { index: 1, partialSatisfy: "小项目搞定", obstacle: "上司刁难", obstacleLevel: 3, resolveOrFake: "读心过关", escalate: "", expectationNote: "", emotionNote: "" },
      { index: 2, partialSatisfy: "解决危机", obstacle: "发现黑手", obstacleLevel: 6, resolveOrFake: "布局", escalate: "上强度", expectationNote: "", emotionNote: "" },
      { index: 3, partialSatisfy: "反击", obstacle: "最终对决", obstacleLevel: 9, resolveOrFake: "真破局", escalate: "", expectationNote: "", emotionNote: "" },
    ],
    outcome: "overpay",
    refuseFate: true,
    villainEnding: "prison",
    replayAmplify: "身败名裂+升职",
    replayMode: "升华",
    surpriseGain: "女神改观",
  },
  seePerson: {
    scenes: [
      {
        id: "s1",
        sceneLabel: "董事会",
        protagonistReaction: "当众甩出证据冷笑",
        controlGroup: "对手慌乱求饶",
        atmosphereGroup: "股东窃窃私语",
        atmospherePolarity: "positive",
        causeBeforeEffect: "备份U盘埋线",
        actionMemoryPoint: "甩证据",
        actionPurpose: "打脸",
        sentenceTension: "short_tense",
        payload: { verbal: "这份合同你看过吗", nonverbalAction: "甩文件", nonverbalReaction: "", nonverbalOs: "终于轮到我了", inferredEmotion: "爽" },
      },
    ],
  },
  showDontTell: { scanned: true, hits: [] },
  renderChecklist: DEFAULT_EMOTION_RENDER_ITEMS.map((i) => ({ ...i, done: true })),
  rhythm: {
    kuaiman: {
      volumeCharsMin: 100000,
      volumeCharsMax: 150000,
      unitCharsMin: 10000,
      unitCharsMax: 15000,
      chapterCharsMin: 2000,
      chapterCharsMax: 3000,
      normalEventChapters: "1-2",
      climaxEventChapters: "3-4",
      climaxGapChapters: "10-15",
      scriptThreePhases: "",
      attentionNote: "",
    },
    shumi: DEFAULT_RHYTHM_QUANT,
    imitateQuantBrief: "12章×800×6-8节点×50-200字",
    zhangChi: [
      { unitLabel: "碎银案", kind: "tense", note: "" },
      { unitLabel: "日常", kind: "relax", note: "" },
      { unitLabel: "再案", kind: "tense", note: "" },
    ],
    tenseOverRelax: true,
    jinhuan: [
      {
        beatLabel: "开打",
        targetEmotion: "紧张",
        selectedElements: ["动作", "感受"],
        mismatchWarned: false,
        note: "",
      },
    ],
    fightPipeline: "环境→嘴炮→心理→开打→伤势",
    notes: "",
  },
  hookLead: {
    purposeNote: "",
    antiCommonSense: "魂穿成智齿",
    deepMeaning: "",
    emotionWave: "又气又笑",
    suspense: "谁在利用宿主",
    draft: "访谈时同学说她见过飞碟",
    noFabricatedPrompt: true,
  },
  diagnose: { reasons: ["emotion_pull_weak"], notes: "", fixPlan: "补三轮" },
});
assert(emotionRhythmWorkflowCompleteness({...erFull, showDontTell: erEmpty.showDontTell}).filledSteps === 9, "skipped style review permits completion");
const erFullScore = emotionRhythmWorkflowCompleteness(erFull);
assert(
  erFullScore.filledSteps === 9,
  `expected 9 filled, got ${erFullScore.filledSteps}: ${erFullScore.missing.join(",")}`,
);
assert(erFullScore.canMarkPullDone === true, "pull can mark");
assert(erFullScore.canMarkSeePersonDone === true, "see person can mark");
assert(erFullScore.ranOk === true, "ran ok for 爽");

const erMaster = summarizeEmotionRhythmToMaster(erFull);
assert(erMaster.emotionRhythmSummary.includes("核心情绪:爽"), "master emotion summary");
assert(erMaster.genre === "纯爽", "master genre");

/* ───── 6.md 装逼打脸 + cool12 + 代入感 ───── */
const c12thin = cool12PlanCompleteness({
  primaryNeed: "esteem",
  tropeIds: ["hide_strength"],
  multiStackNote: "",
  chapterMapping: [],
  eroticEdgeBlocked: true,
  needGap: "",
  satisfyBeat: "",
  rewardUpgrade: "",
  channelNote: "",
  tropeRecipeChecks: [],
});
assert(c12thin.stackOk === false, "single trope not stack");
assert(c12thin.gapSatisfyOk === false, "gap satisfy missing");

const c12ok = cool12PlanCompleteness({
  primaryNeed: "esteem",
  tropeIds: ["hide_strength", "get_artifact"],
  coreTropeId: "hide_strength",
  multiStackNote: "",
  chapterMapping: [],
  eroticEdgeBlocked: true,
  needGap: "被夺权打压",
  satisfyBeat: "董事会反杀",
  rewardUpgrade: "升职+股权",
  channelNote: "",
  tropeRecipeChecks: [],
});
assert(c12ok.stackOk === true && c12ok.gapSatisfyOk === true, "multi trope + gap ok");

const premBad = faceSlapPremiseCompleteness({
  slapper: "",
  slapped: "赵总",
  purpose: "展实力",
  mode: "direct",
  slapVariant: "flex_slap",
  done: false,
});
assert(premBad.complete === false, "premise missing slapper");

const premOk = faceSlapPremiseCompleteness({
  slapper: "林川",
  slapped: "赵总",
  purpose: "展读心术",
  mode: "direct",
  slapVariant: "flex_slap",
  done: true,
});
assert(premOk.complete === true, "premise complete");

assert(suggestEmotionIntensity("active") === 1, "intensity 1");
assert(suggestEmotionIntensity("semi_auto") === 5, "intensity 5");
assert(suggestEmotionIntensity("passive") === 10, "intensity 10");

const gapSemi = validateTierInfoGap("semi_auto", {
  protagonist: "full",
  reader: "full",
  villain: "unknown",
  atmosphere: "unknown",
  insider: "unknown",
  toolsperson: "unknown",
  note: "",
});
assert(gapSemi.ok === false, "semi needs insider");

const gapSemiOk = validateTierInfoGap("semi_auto", {
  protagonist: "full",
  reader: "full",
  villain: "unknown",
  atmosphere: "unknown",
  insider: "slight",
  toolsperson: "unknown",
  note: "",
});
assert(gapSemiOk.ok === true, "semi with insider ok");

const toolBad = validateToolspersonStatus({
  tier: "passive",
  emotionIntensity: 10,
  beats: defaultBeatsForTier("passive"),
  toolspersonName: "老王",
  toolspersonHasStatus: false,
  powerRevealPct: 30,
  powerRevealSecondPct: 100,
  sceneLabel: "",
  slapperTag: "",
  slappedTag: "",
});
assert(toolBad.ok === false, "toolsperson without status fail");

const powerBad = validatePowerRevealLayers({
  tier: "passive",
  emotionIntensity: 10,
  beats: defaultBeatsForTier("passive"),
  toolspersonName: "管家",
  toolspersonHasStatus: true,
  powerRevealPct: 100,
  powerRevealSecondPct: 100,
  sceneLabel: "",
  slapperTag: "",
  slappedTag: "",
});
assert(powerBad.ok === false, "one-shot full reveal fail");

const powerOk = validatePowerRevealLayers({
  tier: "passive",
  emotionIntensity: 10,
  beats: defaultBeatsForTier("passive"),
  toolspersonName: "管家",
  toolspersonHasStatus: true,
  powerRevealPct: 30,
  powerRevealSecondPct: 100,
  sceneLabel: "",
  slapperTag: "",
  slappedTag: "",
});
assert(powerOk.ok === true, "layered reveal ok");

const cfsEmpty = CoolFaceSlapWorkflowSchema.parse({});
const cfsEmptyScore = coolFaceSlapWorkflowCompleteness(cfsEmpty);
assert(cfsEmptyScore.totalSteps === 10, "cfs ten steps");
assert(cfsEmptyScore.filledSteps < 10, "cfs empty incomplete");

const passiveBeats = defaultBeatsForTier("passive").map((b) => ({ ...b, done: true }));
const cfsFull = CoolFaceSlapWorkflowSchema.parse({
  cool12: {
    primaryNeed: "esteem",
    tropeIds: ["hide_strength", "crush_villain", "get_artifact"],
    coreTropeId: "hide_strength",
    eroticEdgeBlocked: true,
    needGap: "被夺权打压",
    satisfyBeat: "董事会反杀",
    rewardUpgrade: "升职",
  },
  flexShow: {
    power: true,
    appropriate: true,
    competitiveEdge: true,
    psychologicalEdge: false,
    powerCarrier: "读心术",
    triggerReason: "被逼上董事会",
    appropriateDetail: "",
  },
  premise: {
    slapper: "林川",
    slapped: "赵总",
    purpose: "夺回股权",
    mode: "direct",
    slapVariant: "flex_slap",
    done: true,
  },
  infoGap: {
    protagonist: "full",
    reader: "full",
    villain: "unknown",
    atmosphere: "unknown",
    insider: "slight",
    toolsperson: "full",
    note: "",
  },
  beat: {
    tier: "passive",
    emotionIntensity: 10,
    beats: passiveBeats,
    toolspersonName: "陈管家",
    toolspersonHasStatus: true,
    powerRevealPct: 30,
    powerRevealSecondPct: 100,
    sceneLabel: "董事会",
    slapperTag: "林川",
    slappedTag: "赵总",
  },
  psyche: {
    villain: "追悔莫及",
    hero: "嗤之以鼻",
    atmosphere: "回踩",
    insider: "幸灾乐祸",
    note: "",
  },
  linkedCoolPointFirst: "董事会当场反杀",
  linkedPullRound: 3,
  immersion: {
    fiveAsk: {
      background: "被夺权总裁",
      coreDesire: "翻盘",
      fear: "一无所有",
      values: "以牙还牙",
      behaviorPattern: "扮猪",
      catchphrase: "慢慢来",
    },
    traits: ["隐忍", "狠厉"],
    contrastHook: "废柴脸杀伐果断",
    proactivePerChapter: true,
    arc: {
      defect: "不敢撕破脸",
      keyEvent: "重生夜",
      overcome: "主动夜袭",
      newState: "掌控全局",
    },
    tension: {
      goal: "夺权",
      failCost: "公司破产",
      countdown: "三天董事会",
      crisisChain: "小中大",
      baseFear: "失去一切",
    },
    villain: {
      stagePowerGap: "暂时碾压主角",
      conflictGoal: "吞并股权",
      motive: "家族野心",
      weakness: "贪功",
      activePressure: "每章逼宫",
    },
    issues: [],
    levels: {},
    resonanceCheck: "会为他心疼也会爽",
    fixPlan: "",
    impressionPoint: "董事会甩证据",
    standingBeat: "冷笑反杀",
    editorialAsk: {
      mainlineClear: true,
      characterClear: true,
      conflictEnough: true,
      immersionOk: true,
      expectationOk: false,
      paceOk: false,
    },
  },
  prose: {
    filterWordsScanned: true,
    filterHits: [],
    sensesUsed: ["视", "听", "触"],
    bodyReaction: "拳头发白",
    innerMonologue: "终于轮到我了",
    vagueVerbsReplaced: true,
    spatialOrder: "far_near",
    noDirectEmotionTell: true,
  },
  curveAlign: {
    benchmarkRounds: 3,
    imitateRounds: 3,
    alignedUpDown: true,
    note: "",
    dissectMode: "both",
    chapterBundleSize: 10,
    longFormTargetChapters: 50,
  },
});
const cfsFullScore = coolFaceSlapWorkflowCompleteness(cfsFull);
assert(
  cfsFullScore.filledSteps === 10,
  `expected 10 filled, got ${cfsFullScore.filledSteps}: ${cfsFullScore.missing.join(",")}`,
);
assert(cfsFullScore.canMarkPremiseDone === true, "premise can mark");
assert(cfsFullScore.stackOk === true, "stack ok");

const cfsMaster = summarizeCoolFaceSlapToMaster(cfsFull);
assert(cfsMaster.coolFaceSlapSummary.includes("扮猪吃老虎"), "master cool summary");

/* 7.md deepen gates */
const activeNeedSub = coolFaceSlapWorkflowCompleteness(
  CoolFaceSlapWorkflowSchema.parse({
    ...cfsFull,
    beat: { ...cfsFull.beat, tier: "active", activeSubMode: undefined, beats: defaultBeatsForTier("active").map((b) => ({ ...b, done: true })) },
    infoGap: { ...cfsFull.infoGap, toolsperson: "unknown", insider: "unknown" },
  }),
);
assert(activeNeedSub.missing.some((m) => m.includes("三子模式")), "active needs submode");

/* ─── 8.md InspirationToStoryWorkflow ─── */
assert(recommendPathForLevel("storyline") === "A", "storyline → A");
assert(recommendPathForLevel("core_event") === "B", "core → B");
assert(recommendPathForLevel("plot") === "C", "plot → C");
assert(recommendPathForLevel("scene_event") === "nest", "event → nest");

const itsEmpty = InspirationToStoryWorkflowSchema.parse({});
const itsEmptyScore = inspirationToStoryWorkflowCompleteness(itsEmpty);
assert(itsEmptyScore.totalSteps === 10, "its ten steps");
assert(itsEmptyScore.filledSteps < 10, "its empty incomplete");

const nestCls = inspirationClassifyCompleteness([
  {
    id: "1",
    rawText: "雨夜抢药",
    source: "一念",
    level: "scene_event",
    reason: "场景级",
    recommendedPath: "nest",
  },
]);
assert(nestCls.complete === true, "classify nest complete");

const plotMissConflict = plotThreeCompleteness({
  person: "女主",
  matter: "抢药",
  conflictPhysical: "",
  conflictEmotional: "",
  conflictGoalBlock: "",
  sceneAtmosphere: "暴雨",
});
assert(plotMissConflict.complete === false, "plot missing conflict incomplete");
assert(plotMissConflict.missing.includes("物理冲突"), "miss physical conflict");

const earlyForgive = validateEarlyForgive({
  beats: [
    { phase: "breakup", heroineGoal: "离开", heroState: "冷漠", emotionIntensity: 8, events: ["当众羞辱"], done: true },
    { phase: "turning", heroineGoal: "", heroState: "", emotionIntensity: 5, events: [], done: false },
    { phase: "awakening", heroineGoal: "", heroState: "", emotionIntensity: 5, events: [], done: false },
    { phase: "chase", heroineGoal: "", heroState: "", emotionIntensity: 5, events: [], done: false },
    { phase: "ending", heroineGoal: "原谅他", heroState: "复合", emotionIntensity: 9, events: ["和好"], done: true },
  ],
  earlyForgiveWarned: true,
  forgiveTooEarlyNote: "决裂后立刻原谅",
});
assert(earlyForgive.ok === false && earlyForgive.level === "warn", "early forgive warn");

const dumpWarn = validateCoreEventDump({
  events: [
    { id: "a", label: "出轨", intensity: 6, chapterNo: 1 },
    { id: "b", label: "决裂", intensity: 8, chapterNo: 1 },
    { id: "c", label: "追妻", intensity: 9, chapterNo: 1 },
  ],
  dumpWarnThreshold: 2,
});
assert(dumpWarn.ok === false, "same chapter dump warn");

const dryFail = validateSceneFourDry({
  id: "dry",
  chapterNo: 1,
  title: "干货",
  dialogue: "",
  action: "打了一架",
  expression: "",
  environment: "",
  cause: "吵架",
  process: "打完了",
  emotionStretch: "",
  onlyWhatHappened: true,
});
assert(dryFail.ok === false && dryFail.level === "fail", "scene dry fail");

const rainOk = sceneFourCompleteness(SCENE_FOUR_RAIN_HERB_TEMPLATE);
assert(rainOk.complete === true, "rain herb template complete");

const aiNoCompare = aiReviseCompleteness({
  drafts: [
    { version: "v1", text: "稿一", selected: true },
    { version: "v2", text: "", selected: false },
    { version: "v3", text: "", selected: false },
    { version: "v4", text: "", selected: false },
  ],
  compared: false,
  readAloudSmooth: true,
  readAloudGap: false,
  readAloudWeird: false,
  qcEmotion: true,
  qcBenchmark: true,
  qcPace: true,
  qcHook: true,
  qcSuspense: true,
  hasChapterOutline: true,
  done: true,
});
assert(aiNoCompare.canMarkDone === false, "ai without compare cannot complete");
assert(aiNoCompare.complete === false, "ai done blocked without compare");

const itsFull = InspirationToStoryWorkflowSchema.parse({
  classify: [
    {
      id: "c1",
      rawText: "追妻火葬场：出轨决裂到追回",
      source: "选题",
      level: "storyline",
      reason: "完整主线",
      recommendedPath: "A",
    },
  ],
  activePath: "A",
  storyline: {
    oneLiner: "出轨被抓后男主追妻火葬场",
    setting: "现代婚恋",
    process: "决裂→觉醒→追妻",
    result: "HE 或开放",
    structureTag: "追妻",
    emotionTag: "虐恋",
    relationTag: "夫妻",
    microInnovation: "信息差反转",
    themeAligned: true,
    themeNote: "主题对齐",
  },
  sevenStepsDone: true,
  relationNet: [
    { id: "r1", name: "女主", role: "protagonist", goalPain: "尊严", function: "主线", relationToHero: "本人" },
    { id: "r2", name: "男主", role: "rival", goalPain: "悔恨", function: "追妻", relationToHero: "前夫" },
  ],
  coreExpand: {
    rawCore: "出轨被抓",
    headTail: "婚礼前夜→离婚后",
    causalBranches: ["女主离开创业", "男主被家族除名"],
    characterConflict: "占有欲 vs 自尊",
    coolPoints: ["当众打脸小三", "男主跪求"],
    linkedCoolPoint: "董事会打脸",
    done: true,
  },
  plotThree: {
    person: "女主",
    matter: "抓奸",
    conflictPhysical: "对峙",
    conflictEmotional: "背叛",
    conflictGoalBlock: "离婚协议被卡",
    sceneAtmosphere: "酒店走廊",
  },
  fiveAct: {
    beats: [
      { phase: "breakup", heroineGoal: "离开", heroState: "冷漠", emotionIntensity: 8, events: ["抓奸"], done: true },
      { phase: "turning", heroineGoal: "自立", heroState: "不安", emotionIntensity: 6, events: ["公司危机"], done: true },
      { phase: "awakening", heroineGoal: "拒绝复合", heroState: "醒悟", emotionIntensity: 7, events: ["发现真相"], done: true },
      { phase: "chase", heroineGoal: "守底线", heroState: "付出", emotionIntensity: 8, events: ["公开道歉"], done: true },
      { phase: "ending", heroineGoal: "选择性复合", heroState: "赎罪", emotionIntensity: 9, events: ["新约定"], done: true },
    ],
    earlyForgiveWarned: false,
    forgiveTooEarlyNote: "",
  },
  intensityLadder: {
    events: [
      { id: "e1", label: "抓奸", intensity: 6, chapterNo: 1 },
      { id: "e2", label: "离婚", intensity: 8, chapterNo: 3 },
      { id: "e3", label: "追妻高潮", intensity: 10, chapterNo: 8 },
    ],
    dumpWarnThreshold: 2,
  },
  chapterTree: [
    {
      id: "ch1",
      coreEventId: "e1",
      chapterNo: 1,
      title: "抓奸夜",
      plotPoints: ["发现异常", "闯入套房", "当众对峙", "摔婚戒"],
      aroundCoreEvent: true,
    },
  ],
  scenes: [SCENE_FOUR_RAIN_HERB_TEMPLATE],
  lengthPace: { form: "short", densePull: true, slowPushOk: false, mismatchWarned: false, note: "" },
  genreGuard: {
    zhiguaiRedlineChecked: true,
    materialReserveOk: true,
    commodityMindsetNoted: true,
    note: "",
  },
  aiRevise: {
    drafts: [
      { version: "v1", text: "稿A", selected: false },
      { version: "v2", text: "稿B", selected: true },
      { version: "v3", text: "", selected: false },
      { version: "v4", text: "", selected: false },
    ],
    compared: true,
    readAloudSmooth: true,
    readAloudGap: false,
    readAloudWeird: false,
    qcEmotion: true,
    qcBenchmark: true,
    qcPace: true,
    qcHook: true,
    qcSuspense: true,
    hasChapterOutline: true,
    done: true,
  },
  handedOffToShortNovel: true,
});
assert(aiReviseCompleteness({...itsFull.aiRevise, readAloudSmooth: false, qcEmotion: false, qcBenchmark: false, qcPace: false, qcHook: false, qcSuspense: false}).complete, "read-aloud and editorial questions are optional");
const itsFullScore = inspirationToStoryWorkflowCompleteness(itsFull);
assert(
  itsFullScore.filledSteps === 10,
  `its expected 10 filled, got ${itsFullScore.filledSteps}: ${itsFullScore.missing.join(",")}`,
);
const itsMaster = summarizeInspirationToStoryToMaster(itsFull);
assert(Boolean(itsMaster.inspirationToStorySummary.trim()), "master its summary non-empty");
assert(itsMaster.inspirationToStorySummary.includes("故事线"), "master has level");
assert(fiveActCompleteness(itsFull.fiveAct).complete === true, "five act full");

/* ─── 9.md TopicSelectionWorkflow ─── */
const tsEmpty = TopicSelectionWorkflowSchema.parse({});
const tsEmptyScore = topicSelectionWorkflowCompleteness(tsEmpty);
assert(tsEmptyScore.totalSteps === 10, "ts ten steps");
assert(tsEmptyScore.filledSteps < 10, "ts empty incomplete");

const audBad = validateAudienceExclusive({
  bucket: "young_18_35",
  antiTrope: true,
  womenMutual: false,
  softScifiGrounded: false,
  antiFloatingSweet: false,
  realistSmoke: true,
  slowPace: false,
  audioOriented: false,
  exclusiveConfirmed: true,
});
assert(audBad.ok === false, "audience mutual exclusion");

const introOver = validateIntroOverstuff({
  text: "x".repeat(400),
  targetChars: 200,
  senseTags: ["视"],
  coolSentenceMarked: true,
  overstuffWarned: false,
  trackNote: "",
});
assert(introOver.ok === false && introOver.level === "warn", "intro overstuff warn");

const beatFew = validateMasterBeatCount({
  slots: Array.from({ length: 5 }, (_, i) => ({
    id: `b${i}`,
    qi: "起",
    cheng: "承",
    zhuan: "转",
    he: "合",
    done: true,
  })),
  minSlots: 11,
  maxSlots: 13,
  note: "",
});
assert(beatFew.ok === false && beatFew.level === "fail", "beats not 11-13 fail");

const pitEmpty = validateFivePitfalls({
  noFloating: false,
  noMelodrama: false,
  noAuthorOpinionInText: false,
  noCopycat: false,
  audienceClear: false,
});
assert(pitEmpty.ok === false, "five pitfalls incomplete");

const filledSlots = Array.from({ length: 12 }, (_, i) => ({
  id: `b${i}`,
  qi: "起",
  cheng: "承",
  zhuan: "转",
  he: "合",
  done: true,
}));
const tsFull = TopicSelectionWorkflowSchema.parse({
  audience: {
    bucket: "young_18_35",
    antiTrope: true,
    exclusiveConfirmed: true,
  },
  chart: {
    platform: "知乎",
    chartType: "热榜",
    topKeywords: ["重生", "职场", "反杀"],
    repeatWords: ["重生"],
    diffNote: "职场+规则怪谈缝合",
  },
  formula: {
    oldTropeOrHot: "重生",
    strengthDomain: "职场",
    emotionPoint: "憋屈翻盘",
    diffOneLiner: "重生职场规则怪谈",
    multiEndingNote: "",
  },
  contrast: {
    baseTrope: "重生",
    alienElement: "规则怪谈",
    logicSelfCheck: true,
    note: "",
  },
  twists: {
    openingTwist: "假死",
    midTwist: "仇人是恩人",
    endingTwist: "自己是推手",
    foreshadowPreDesigned: true,
  },
  intro: {
    text: "雨夜里她撕碎合同。".repeat(8),
    targetChars: 200,
    senseTags: ["视", "听"],
    coolSentenceMarked: true,
    overstuffWarned: false,
  },
  beatRail: { slots: filledSlots, minSlots: 11, maxSlots: 13 },
  pitfalls: {
    noFloating: true,
    noMelodrama: true,
    noAuthorOpinionInText: true,
    noCopycat: true,
    audienceClear: true,
  },
  executionQc: {
    coreConflictTaughtToAi: true,
    visualSenseOk: true,
    fiveSensesOk: true,
    coolEscalationLinkedL6: true,
    punctDeAiLinked: true,
    pronounStrict: true,
    climaxNotAbrupt: true,
  },
  postSubmit: { restHours: 3, readToOther: false, submitted: true },
  handedOffToL8: true,
});
const tsFullScore = topicSelectionWorkflowCompleteness(tsFull);
assert(
  tsFullScore.filledSteps === 10,
  `ts expected 10, got ${tsFullScore.filledSteps}: ${tsFullScore.missing.join(",")}`,
);
const tsMaster = summarizeTopicSelectionToMaster(tsFull);
assert(Boolean(tsMaster.topicSelectionSummary.trim()), "ts master non-empty");

/* ─── 10.md CharacterDepthWorkflow ─── */
const cdEmpty = CharacterDepthWorkflowSchema.parse({});
const cdEmptyScore = characterDepthWorkflowCompleteness(cdEmpty);
assert(cdEmptyScore.totalSteps === 10, "cd ten steps");
assert(cdEmptyScore.filledSteps < 10, "cd empty incomplete");

const soulFail = validateSoulProbe({
  rows: [{ id: "1", beatLabel: "决裂", q1Pass: true, q2Pass: false, q3Pass: true, oocFix: "" }],
  questions: [],
});
assert(soulFail.ok === false && soulFail.level === "fail", "soul probe fail");

const fsFail = validateForeshadowRecover([
  { id: "f1", plant: "怀孕", recover: "", recovered: false },
]);
assert(fsFail.ok === false, "foreshadow unrecovered fail");

const handPartial = handEdit12Completeness({
  steps: SHORT_HAND_EDIT_12_LABELS.map((label, i) => ({
    id: `he${i}`,
    label,
    done: i < 5,
  })),
  note: "",
});
assert(handPartial.complete === false, "hand edit incomplete blocks done");

const submitWarn = validateShortSubmitGate({
  wordCount: 15000,
  targetWords: 12000,
  zhihuOverlongWarned: false,
  chapterTitlePlain: true,
  clearedStarsAndExtraLines: true,
  oneHeroine: true,
  oneHero: true,
  hasVillain: true,
  extrasOk: true,
});
assert(submitWarn.ok === false, "submit wordcount gate");

const cdFull = CharacterDepthWorkflowSchema.parse({
  purpose: { purpose: "commercial", exclusiveConfirmed: true },
  big5: {
    openness: { level: 3, fitBehavior: "A", unfitBehavior: "B" },
    conscientiousness: { level: 4, fitBehavior: "A", unfitBehavior: "B" },
    extraversion: { level: 2, fitBehavior: "A", unfitBehavior: "B" },
    agreeableness: { level: 2, fitBehavior: "A", unfitBehavior: "B" },
    neuroticism: { level: 4, fitBehavior: "A", unfitBehavior: "B" },
  },
  desireFearSecret: {
    desireSurface: "钱",
    desireDeep: "救奶奶",
    fearShadow: "一无所有",
    ultimateSecret: "身世",
    secretAsTwist: true,
  },
  cp: {
    preset: "schemer_x_interest",
    openingChecklist: ["利益联姻"],
    climaxChecklist: ["当众反水"],
  },
  sheet: {
    basic: "林婉,28,律师",
    appearance: "冷厉",
    mbtiProsCons: "INTJ",
    motiveThree: "为何/为何现在/代价",
    hallmarkProp: "玉镯",
    relationNetRef: "与男主夫妻/与小三对立",
    behaviorBoundary: "不跪求",
    sevenStepsDone: true,
  },
  soul: {
    rows: [
      {
        id: "s1",
        beatLabel: "抓奸",
        q1Pass: true,
        q2Pass: true,
        q3Pass: true,
        oocFix: "",
      },
    ],
  },
  foreshadow: [{ id: "f1", plant: "怀孕", recover: "产房摊牌", recovered: true }],
  handEdit: {
    steps: SHORT_HAND_EDIT_12_LABELS.map((label, i) => ({
      id: `he${i}`,
      label,
      done: true,
    })),
  },
  submitGate: {
    wordCount: 11800,
    targetWords: 12000,
    zhihuOverlongWarned: false,
    chapterTitlePlain: true,
    clearedStarsAndExtraLines: true,
    oneHeroine: true,
    oneHero: true,
    hasVillain: true,
    extrasOk: true,
  },
  pitfalls: { noPerfect: true, contrastNeedsBeat: true, noLabelOnly: true },
  sceneBehaviorChecked: true,
});
const cdFullScore = characterDepthWorkflowCompleteness(cdFull);
assert(
  cdFullScore.filledSteps === 10,
  `cd expected 10, got ${cdFullScore.filledSteps}: ${cdFullScore.missing.join(",")}`,
);
assert(cdFullScore.canMarkHandDone === true, "hand can mark");
const cdMaster = summarizeCharacterDepthToMaster(cdFull);
assert(Boolean(cdMaster.characterDepthSummary.trim()), "cd master non-empty");
const syncRel = syncRelationNetFromCharacterSheet(cdFull.sheet);
assert(syncRel.length === 1 && syncRel[0]!.relationToHero.includes("夫妻"), "sync relation");

/* ─── 11.md ManjuPipelineWorkflow ─── */
const mpEmpty = ManjuPipelineWorkflowSchema.parse({});
assert(manjuPipelineWorkflowCompleteness(mpEmpty).totalSteps === 10, "mp ten");
assert(validateLoglineSocial(mpEmpty.loglineSocial).ok === false, "mp social fail");
assert(
  validateCoarseOutline({
    events: [
      { id: "1", label: "a", kind: "cool", selected: true, order: 0, bridgeNote: "" },
      { id: "2", label: "b", kind: "abuse", selected: true, order: 1, bridgeNote: "" },
    ],
    sorted: true,
    note: "",
    lastExpandCount: 0,
  }).ok === false,
  "coarse need >=3",
);

const mpFull = ManjuPipelineWorkflowSchema.parse({
  loglineSocial: {
    text: "约一百字的受众测试梗概内容占位足够长度以便社交确认。",
    toldFriend: true,
    friendAudienceMatch: true,
    passed: true,
  },
  coarse: {
    events: [
      { id: "1", label: "虐", kind: "abuse", selected: true, order: 0, bridgeNote: "起" },
      { id: "2", label: "爽", kind: "cool", selected: true, order: 1, bridgeNote: "承" },
      { id: "3", label: "转", kind: "twist", selected: true, order: 2, bridgeNote: "转" },
    ],
    sorted: true,
  },
  rhythm: {
    slots: [
      { band: "ep1_heaviest", plan: "开场暴击", done: true },
      { band: "ep2_3", plan: "承压", done: true },
      { band: "ep3_10_big", plan: "大事件", done: true },
      { band: "ep10_paywall", plan: "一卡", done: true },
    ],
    naturalLanguageOutline: true,
    noQiChengZhuanHePrompt: true,
  },
  rejectThree: {
    noNovelization: true,
    noLiveActionThinking: true,
    noHomogenization: true,
  },
  dialogue13: {
    checks: DIALOGUE_13_RULES.map((label, i) => ({
      id: `d${i}`,
      label,
      done: true,
    })),
  },
  ethics: {
    onePitchOneOutlet: true,
    confidentialityNoted: true,
    homeworkSeparatedFromPitch: true,
    revenueMode: "share",
  },
  bioBeforeOutlineNoted: true,
  fourPackReady: true,
});
const mpScore = manjuPipelineWorkflowCompleteness(mpFull);
assert(
  mpScore.filledSteps === 10,
  `mp expected 10 got ${mpScore.filledSteps}: ${mpScore.missing.join(",")}`,
);
assert(Boolean(summarizeManjuPipelineToMaster(mpFull).manjuPipelineSummary.trim()), "mp summary");
assert(validateRejectThree(mpFull.rejectThree).ok === true, "reject three ok");
assert(validatePitchEthics(mpFull.ethics).ok === true, "ethics ok");
assert(validateEpisodeRhythm(mpFull.rhythm).ok === true, "rhythm ok");

/* ─── 12.md ManjuGenreTrackWorkflow ─── */
const gtEmpty = ManjuGenreTrackWorkflowSchema.parse({});
assert(manjuGenreTrackWorkflowCompleteness(gtEmpty).totalSteps === 10, "gt ten");
assert(
  validateBenchmarkCollection({
    title: "某剧",
    collectionCount: 1000,
    threshold: 50000,
    deepDissectOk: false,
    note: "",
  }).ok === false,
  "bench <50k fail",
);

const gtFull = ManjuGenreTrackWorkflowSchema.parse({
  track: "upgrade",
  upgrade: {
    buffStack: "叠满",
    strike: "打击",
    goldFingerOn: "金手指",
    revengeMain: "复仇",
    growSameTier: "同级",
    developCross: "跨级",
    climax: "高潮",
  },
  quota: { openingEps: 4, growEps: 10, developEps: 10, climaxEps: 1 },
  discouraged: {
    avoided: [...MANJU_DISCOURAGED_TOPICS],
    allChecked: true,
  },
  benchmark: {
    title: "爆款对标",
    collectionCount: 80000,
    threshold: 50000,
    deepDissectOk: true,
  },
  kernel: {
    humanFive: {
      who: "废材",
      world: "修仙",
      power: "系统",
      conflict: "被退婚",
      reward: "登顶",
    },
    aiFiveBrief: "AI摘要",
    compared: true,
  },
  genderHint: { acknowledged: true },
  settingPackLinked: true,
});
assert(validateGenreTrackFill(gtFull).ok === true, "upgrade fill ok");
assert(validateKernelExtract(gtFull.kernel).ok === true, "kernel ok");
const gtScore = manjuGenreTrackWorkflowCompleteness(gtFull);
assert(
  gtScore.filledSteps === 10,
  `gt expected 10 got ${gtScore.filledSteps}: ${gtScore.missing.join(",")}`,
);
assert(Boolean(summarizeManjuGenreTrackToMaster(gtFull).manjuGenreTrackSummary.trim()), "gt summary");

/* ─── 13.md IpAdaptWorkflow ─── */
const ipEmpty = IpAdaptWorkflowSchema.parse({});
assert(ipAdaptWorkflowCompleteness(ipEmpty).totalSteps === 10, "ip ten");
assert(
  validateIpSelectGoNoGo({
    ...ipEmpty.select,
    unsuitableHits: ["心理流"],
    dataOk: true,
    genreOk: true,
    structureFriendly: true,
    characterOk: true,
    copyrightConfirmed: true,
    platformAcceptsAdapt: true,
  }).ok === false,
  "unsuitable nogo",
);
assert(validateAdaptAnchor(ipEmpty.anchor).ok === false, "anchor empty fail");
assert(
  validateAdaptPitchPack({
    anchorDone: true,
    unitCount: 0,
    emotionPoints: 1,
    scriptCount: 1,
  }).ok === false,
  "pack missing unit fail",
);
assert(
  Boolean(
    tomatoRefWarn({
      ...ipEmpty.select,
      readsApprox: 1000,
      commentsApprox: 100,
      ratingApprox: 3,
    }),
  ),
  "tomato warn",
);
assert(
  deriveAdaptBudget({
    sourceWords: 200000,
    chapterCount: 400,
    targetEpisodes: 60,
    batchFrom: 1,
    batchTo: 20,
  }).compressHint.includes("1/5"),
  "budget hint",
);
assert(
  validateUnitEmotionTrail({
    id: "t",
    chapterFrom: 1,
    chapterTo: 3,
    conflict: "x",
    emotionScore: -3,
    emotionTrail: [-3, 0],
    tight: true,
    keep: true,
  }).ok === false,
  "emotion trail open fail",
);
assert(
  ipAdaptWorkflowCompleteness(
    IpAdaptWorkflowSchema.parse({
      select: {
        dataOk: true,
        genreOk: true,
        structureFriendly: true,
        characterOk: true,
        copyrightConfirmed: true,
        platformAcceptsAdapt: true,
      },
      anchor: {
        mainGoal: "a",
        corePersona: "b",
        goldFinger: "c",
        worldRules: "d",
      },
      logline: {
        identity: "人",
        coreConflict: "冲突",
        powerGap: "悬殊",
        openConflict: "开篇",
      },
    }),
  ).missing.includes("梗概/导语"),
  "logline four missing",
);

const ipFull = IpAdaptWorkflowSchema.parse({
  select: {
    dataOk: true,
    genreOk: true,
    structureFriendly: true,
    characterOk: true,
    structureChecks: {
      burstEvery5to10: true,
      strongConflict: true,
      actionHeavy: true,
      visualStrong: true,
      paceFast: true,
    },
    readsApprox: 100000,
    commentsApprox: 5000,
    ratingApprox: 4.8,
    finishRateOk: true,
    unsuitableHits: [],
    copyrightConfirmed: true,
    platformAcceptsAdapt: true,
  },
  budget: { sourceWords: 200000, chapterCount: 400, targetEpisodes: 60 },
  anchor: {
    mainGoal: "复仇",
    corePersona: "隐忍女主",
    goldFinger: "系统",
    worldRules: "修仙等级",
    canCutSide: true,
    canMergeSupport: true,
    canReorder: true,
    canFrontloadCool: true,
  },
  logline: {
    identity: "退婚女",
    coreConflict: "被欺",
    turnChance: "觉醒",
    goldFinger: "系统",
    openConflict: "当众退婚",
    dilemma: "无依",
    coreContradict: "强弱悬殊",
    turnHook: "金手指",
    powerGap: "宗门碾压",
  },
  units: [
    {
      id: "u1",
      chapterFrom: 1,
      chapterTo: 4,
      conflict: "退婚",
      emotionScore: -8,
      emotionTrail: [-8, -5, 0, 2],
      tight: true,
      keep: true,
    },
  ],
  rebuild: {
    mergeConflict: true,
    coolFront: true,
    cutEnv: true,
    cutRepeat: true,
    epOpen: "开场冲突",
    epCarry: "承接",
    epSlap: "打脸",
  },
  rhythm: {
    minutesPerEp: 2,
    conflictIn3s: true,
    pushEvery30s: true,
    first5sAction: "当众退婚",
    sameBeatMax30s: true,
    paywallEp10: true,
    paywallEp20: false,
    cutAtEmotionLow: true,
    cutBeforeTwist: false,
  },
  av: {
    policyOk: true,
    performanceOk: true,
    aiGeneratable: true,
    costSceneOk: true,
    platformPrefOk: true,
  },
  pitchPack: {
    scriptCount: 1,
  },
});
assert(validatePaywallEmotionCut(ipFull.rhythm).ok === true, "paywall ok");
assert(validateUnitEmotionTrail(ipFull.units[0]!).ok === true, "trail ok");
assert(deriveAdaptPitchPack(ipFull).unitCount >= 1, "derived pack");
const ipScore = ipAdaptWorkflowCompleteness(ipFull);
assert(
  ipScore.filledSteps === 10,
  `ip expected 10 got ${ipScore.filledSteps}: ${ipScore.missing.join(",")}`,
);
assert(Boolean(summarizeIpAdaptToMaster(ipFull).ipAdaptSummary.trim()), "ip summary");

/* ─── 14.md FemaleLongDepthWorkflow ─── */
const flEmpty = FemaleLongDepthWorkflowSchema.parse({});
assert(femaleLongDepthWorkflowCompleteness(flEmpty).totalSteps === 11, "fl eleven");
assert(validateTopicSixHazards(flEmpty.topicHazards).ok === false, "topic6 incomplete");
assert(
  validateCharPractice({
    heroineCraft: [],
    heroCraft: [],
    cards: [{ id: "1", role: "heroine", name: "A", craftNote: "", bio: "短" }],
    minBioChars: 300,
  }).ok === false,
  "char bio gate",
);
assert(
  validateArchPractice({
    mainline: "主线",
    stageGoals: ["a", "b"],
    subPlots: [
      { id: "s1", label: "副1", volumeShare: 0.2, closedLoop: true },
      { id: "s2", label: "副2", volumeShare: 0.2, closedLoop: true },
    ],
    nodeCh1: "x",
    nodeCh10: "x",
    nodeCh50: "x",
    nodeCh100: "x",
    nodeMid: [],
    archOutline: "短",
    minOutlineChars: 800,
  }).ok === false,
  "arch stageGoals gate",
);

const longBio = "人设描写。".repeat(80);
const longArch = "架构大纲节点与副线闭环说明。".repeat(60);
const eightNote = "写前薄备注：节点与情绪递进、人物关系变化要点已列。";
const flFull = FemaleLongDepthWorkflowSchema.parse({
  industrySelf: "周看榜+能力：现言甜宠",
  industryChecks: {
    boutiqueTrend: true,
    auditTighten: true,
    conflictCoolDown: true,
    aiManjuTrend: true,
  },
  track: {
    tier: "core",
    subTrack: "现言",
    marketHot: "追妻",
    strength: "拉扯",
    differentiation: "双视角职场",
    dreamHook: "逆袭梦想",
    healHook: "情感疗愈",
    mixElements: true,
    charDiff: true,
    plotDiff: false,
    dualPov: true,
  },
  topicHazards: {
    noCold: true,
    noHomogen: true,
    noTooBig: true,
    noTooSmall: true,
    capabilityMatch: true,
    noHardHotword: true,
  },
  chars: {
    heroineCraft: [...FEMALE_HEROINE_CRAFT],
    heroCraft: [...FEMALE_HERO_CRAFT],
    minBioChars: 300,
    cards: [
      { id: "c1", role: "heroine", name: "林晚", craftNote: "反差感", bio: longBio },
      { id: "c2", role: "hero", name: "顾琛", craftNote: "双强", bio: longBio },
      { id: "c3", role: "support_pos", name: "闺蜜", craftNote: "闪光", bio: longBio },
      { id: "c4", role: "support_neg", name: "渣男", craftNote: "坏有理由", bio: longBio },
    ],
  },
  charHazards: {
    noCollapse: true,
    noHeroTool: true,
    noSaint: true,
    noHomogen: true,
    noFloating: true,
  },
  arch: {
    mainline: "职场翻盘+爱情",
    stageGoals: ["入职", "项目", "公开", "HE"],
    subPlots: [
      { id: "s1", label: "闺蜜线", volumeShare: 0.15, closedLoop: true },
      { id: "s2", label: "渣男线", volumeShare: 0.15, closedLoop: true },
    ],
    nodeCh1: "开篇冲突",
    nodeCh10: "小爽",
    nodeCh50: "大爽",
    nodeCh100: "收线",
    nodeMid: ["5–10章", "30–50章"],
    archOutline: longArch,
    minOutlineChars: 800,
  },
  archHazards: {
    mainFocused: true,
    subClosed: true,
    emotionDriven: true,
    logicSupport: true,
    noBranchFlood: true,
    nodePlanned: true,
  },
  retention: {
    ch1: 70,
    ch10: 55,
    ch50: 40,
    ch100: 35,
    targetsLocked: true,
  },
  eightReports: {
    items: EIGHT_PREWRITE_LABELS.map((label, i) => ({
      id: `er${i}`,
      label,
      done: true,
      note: i < 4 ? eightNote : "",
      linkedKey: "",
    })),
  },
  adaptPotential: "画面感强可改编",
  fourSwapThree: {
    baseBackground: "都市职场",
    baseCharacter: "双强",
    baseGoldFinger: "信息差预知",
    baseMainline: "职场翻盘+爱情HE",
    swapBackground: true,
    swapCharacter: true,
    swapGoldFinger: true,
    mainlineLocked: true,
    swappedBackground: "古言侯府",
    swappedCharacter: "庶女+冷王",
    swappedGoldFinger: "前世记忆",
  },
});
assert(validateRetentionTargets(flFull.retention).ok === true, "retention ok");
assert(validateEightReports(flFull.eightReports).ok === true, "eight ok");
assert(validateFemaleFourSwapThree(flFull.fourSwapThree).ok === true, "four swap ok");
assert(
  validateFemaleFourSwapThree(FemaleFourSwapThreeSchema.parse({})).ok === false,
  "four swap empty",
);
assert(
  validateEightReports({
    items: EIGHT_PREWRITE_LABELS.map((label, i) => ({
      id: `er${i}`,
      label,
      done: true,
      note: "",
      linkedKey: "",
    })),
  }).ok === false,
  "eight note gate",
);
const flScore = femaleLongDepthWorkflowCompleteness(flFull);
assert(
  flScore.filledSteps === 11,
  `fl expected 11 got ${flScore.filledSteps}: ${flScore.missing.join(",")}`,
);
assert(Boolean(summarizeFemaleLongDepthToMaster(flFull).femaleLongDepthSummary.trim()), "fl summary");

/* ─── 狂更猫 MaleLongEngineWorkflow ─── */
const mlEmpty = MaleLongEngineWorkflowSchema.parse({});
assert(maleLongEngineCompleteness(mlEmpty).totalSteps === 10, "ml ten");
assert(validateTopicOrderGate(mlEmpty.topicOrderGate).softBlockOpening === true, "opening soft block");
assert(
  validateMainlineCoreGate("同一句", "同一句", [true, true, true, true]).ok === false,
  "main≠core same",
);
assert(validateBlurbFiveParts(mlEmpty.blurbFiveParts).ok === false, "blurb empty");
const mlFull = MaleLongEngineWorkflowSchema.parse({
  topicOrderGate: {
    scanRank: true,
    titleDone: true,
    blurbDone: true,
    openingDone: true,
    firstShowDone: true,
  },
  titleFourQ: {
    q1Identity: "废柴觉醒",
    q2Conflict: "宗门倾轧",
    q3Promise: "碾压装逼",
    q4Diff: "系统有代价",
    candidateTitle: "血价面板",
  },
  blurbFiveParts: {
    situation: "被退婚当众羞辱",
    piePromise: "面板觉醒反杀",
    path: "压抑→爆发→打脸循环",
    coolPreview: ["退婚打脸", "宗门大比"],
    close: "踏上更高舞台",
  },
  mainlineOneLiner: "登顶仙界揭开血价真相",
  coreHighlightOneLiner: "每次升级必须付出血价的面板",
  fourArcCheck: [true, true, true, true],
  goldFingerBrief: "血价面板：能力换血量，弱开可延伸",
  loopPlan: {
    loopIndex: 1,
    endShock: "宗主亲至仍被反杀",
    chapters: Array.from({ length: 12 }, (_, i) => ({
      chapterNo: i + 1,
      function: `功能${i + 1}`,
    })),
    feedUpgradeLoop: true,
  },
  stageSetups: [
    {
      chapterHint: "Ch3",
      heroGoal: "拿到内门名额",
      foeGoals: ["打压废柴"],
      povFirst: "主角",
      scenePurpose: "展示金手指边界",
    },
  ],
  antiStuck: { currentStep: 2, notes: ["目标不够具体，改为内门名额"], lastResolvedAt: "" },
  mingAn: {
    mingIdentity: "外门废柴",
    anIdentity: "血价宿主",
    payoffBeat: "大比第三场",
  },
  platformMilestones: {
    daily4k: true,
    signed: true,
    firstShow: true,
    bookVolume: false,
    chaseRatioOk: false,
    finishReadOk: false,
  },
});
const mlScore = maleLongEngineCompleteness(mlFull);
assert(
  mlScore.filledSteps === 10,
  `ml expected 10 got ${mlScore.filledSteps}: ${mlScore.missing.join(",")}`,
);
assert(mlScore.softBlockOpening === false, "ml no soft block when gate full");
assert(validateLoopPlan(mlFull.loopPlan).ok === true, "loop ok");
assert(Boolean(summarizeMaleLongEngineToMaster(mlFull).maleLongEngineSummary.trim()), "ml summary");
const patched = patchMasterFromMaleLongEngine(mlFull, MasterOutlineBodySchema.parse({}));
assert(patched.logline === mlFull.mainlineOneLiner, "patch logline");
assert(patched.coreConflictOneLiner === mlFull.coreHighlightOneLiner, "patch core");

/* ─── 15.md paceDepth ─── */
const paceEmpty = FemalePaceDepthSchema.parse({});
assert(femalePaceDepthCompleteness(paceEmpty).totalSteps === 6, "pace six");
assert(validatePaceOutline(paceEmpty.curve).ok === false, "pace outline gate");
const longPace = "节奏大纲节点小爽大爽缓冲说明。".repeat(40);
const longEmo = "情绪样章渲染细节描写。".repeat(40);
const longDetail = "细节描写感官微反应。".repeat(20);
const longAdapt = "改编剧本化片段画面。".repeat(40);
const paceFull = FemalePaceDepthSchema.parse({
  curve: {
    totalWordsPlan: 500000,
    genreSub: "现言",
    paceOutlineText: longPace,
    nodes: [
      { id: "n1", chapter: 1, kind: "hook", note: "" },
      { id: "n2", chapter: 10, kind: "small", note: "" },
      { id: "n3", chapter: 50, kind: "big", note: "" },
    ],
    hazards: {
      noVacuum15: true,
      noStackCool: true,
      noMidSoft: true,
      noRushEnd: true,
      noSlowOpen: true,
      genreMatch: true,
    },
  },
  emotionLab: {
    samples: [
      { emotion: "爽感", methods: ["细节"], text: longEmo, minChars: 300 },
      { emotion: "共情", methods: ["对话"], text: longEmo, minChars: 300 },
      { emotion: "治愈", methods: ["场景"], text: longEmo, minChars: 300 },
      { emotion: "遗憾弥补", methods: [], text: "", minChars: 300 },
    ],
  },
  detailLab: {
    personaDetail: longDetail,
    sceneSensory: longDetail,
    microReaction: longDetail,
  },
  riskList: {
    items: Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`,
      text: `避坑${i + 1}`,
      category: "创作",
    })),
  },
  monetize: {
    platform: "番茄",
    stockChapters: 15,
    dailyWordsMin: 4000,
    planItems: Array.from({ length: 8 }, (_, i) => `方案${i + 1}`),
    adaptFragment: longAdapt,
  },
  serial: {
    backupPlanFast: "加快小爽",
    backupPlanSlow: "加缓冲治愈",
    weeklyReviewNoted: true,
  },
});
assert(validateEmotionLab(paceFull.emotionLab).ok === true, "emo ok");
assert(validateMonetizePlan(paceFull.monetize).ok === true, "monetize ok");
const paceScore = femalePaceDepthCompleteness(paceFull);
assert(
  paceScore.filledSteps === 6,
  `pace expected 6 got ${paceScore.filledSteps}: ${paceScore.missing.join(",")}`,
);
assert(Boolean(summarizeFemalePaceDepthToMaster(paceFull).femalePaceDepthSummary.trim()), "pace sum");

/* ─── 16.md koala ─── */
const koalaEmpty = ManjuPipelineWorkflowSchema.parse({});
assert(manjuKoalaCompleteness(koalaEmpty).totalSteps === 6, "koala six");
assert(validatePromptTrimAck(koalaEmpty.promptTrimAck).ok === false, "trim fail");
const koalaFull = ManjuPipelineWorkflowSchema.parse({
  promptTrimAck: { genderTrim: true, subGenreTrim: true, platformTrim: true },
  toolPairNoted: true,
  syncOutlineOnBodyEdit: true,
  rollingMilestone: "post_10_30",
  outlinePerEpReview: Array.from({ length: 10 }, (_, i) => ({
    ep: i + 1,
    coolOk: true,
    crisisOk: true,
    done: true,
  })),
});
assert(
  manjuKoalaCompleteness(koalaFull).filledSteps === 6,
  `koala full ${manjuKoalaCompleteness(koalaFull).missing.join(",")}`,
);
assert(Boolean(summarizeManjuKoalaToMaster(koalaFull).manjuKoalaSummary.trim()), "koala sum");

/* ─── 17.md ManjuAdvanced ─── */
const maEmpty = ManjuAdvancedWorkflowSchema.parse({});
assert(manjuAdvancedCompleteness(maEmpty).totalSteps === 6, "ma six");
assert(validateElementCombo(maEmpty.combo).ok === false, "combo fail");
assert(validateAct100Tasks({ segments: DEFAULT_ACT100_SEGMENTS, importedFromAgent: false }).ok === true, "act100 default");
const maFull = ManjuAdvancedWorkflowSchema.parse({
  combo: {
    worldview: "修仙",
    identityContrast: "废柴",
    limitedGoldFinger: "一日一次",
    coreAction: "复仇",
    renderFormat: "仿真人",
  },
  act100: { segments: DEFAULT_ACT100_SEGMENTS },
  episodeCraft: [
    { id: "e1", episodeNo: 1, openingType: "冲突开场", endingHook: "危机降临" },
    { id: "e2", episodeNo: 2, openingType: "反差开场", endingHook: "信息差揭示" },
    { id: "e3", episodeNo: 3, openingType: "金手指开场", endingHook: "反转预告" },
  ],
  tropeDrill: { infoGapIntrigue: true, sweetSpotlight: true },
  trendAck: { followHot: true, pitchFastStudio: true, formatMatch: true },
});
assert(
  manjuAdvancedCompleteness(maFull).filledSteps === 6,
  `ma full ${manjuAdvancedCompleteness(maFull).missing.join(",")}`,
);
assert(Boolean(summarizeManjuAdvancedToMaster(maFull).manjuAdvancedSummary.trim()), "ma sum");

/* ─── 实操手册 SOP ─── */
assert(MANJU_COOL18_MODELS.length === 18, "cool18 len");
assert(MANJU_KARTIAN_TYPES.length === 3, "kartian cats");
assert(MANJU_KARTIAN_TYPE_NAMES.length === 10, "kartian types");

const hookWeak = {
  titleHook: "t",
  coreHook: "c",
  tags: [] as string[],
  motivation: "m",
  openingStructure: "o",
  riskFlags: [] as string[],
  openingBeats: [] as string[],
  favorited: false,
  abstractions: [],
  conflicts: [],
  plotCardSteps: [],
  emotionChain: [],
};
assert(
  !canStrongAdopt(checkCoreHookAdoption(hookWeak as never, "strong")),
  "strong needs tags+crisis",
);
const hookStrong = {
  ...hookWeak,
  tags: ["系统"],
  crisis: "被追杀",
};
assert(
  canStrongAdopt(checkCoreHookAdoption(hookStrong as never, "strong")),
  "strong ok with tags crisis",
);

const epRow = EpisodeOutlineBodySchema.parse({
  episodeNo: 1,
  title: "开局",
  summary: "开场冲突",
  coolModels: ["扮猪吃虎"],
  cliffType: "危机降临",
  cliffText: "尸潮压境",
});
assert(validateEpisodeOutlineHandbookRow(epRow).ok, "ep row ok");
assert(validateEp10HandbookAccept([epRow]).ok === false, "need 10 accept");

const packEmpty = PitchPackBodySchema.parse({});
assert(validatePitchPackBody(packEmpty).ok === false, "pitch empty fail");
const packFull = PitchPackBodySchema.parse({
  scriptInfo: {
    title: "凶兽动物园",
    sellingPoint: "加餐名场面",
    genreTags: ["灵气复苏"],
  },
  storyOutline: "x".repeat(220),
  characterBios: [
    { id: "1", name: "叶凡", motivation: "扩建动物园" },
    { id: "2", name: "陈静", motivation: "调查神墟" },
  ],
});
assert(validatePitchPackBody(packFull).ok, "pitch full");

const hbEmpty = ManjuHandbookOpsSchema.parse({});
assert(manjuHandbookOpsCompleteness(hbEmpty).totalSteps === 7, "hb seven");
assert(validateMarketGenreAck(hbEmpty.marketGenreAck).ok === false, "genre fail");
const hbFull = ManjuHandbookOpsSchema.parse({
  marketGenreAck: {
    maleGenres: ["系统"],
    brainHole: true,
    strongConflict: true,
    coolTrope: true,
    fastPace: true,
    payoffEarly: true,
    sinkAudience: true,
  },
  hookBatchRounds: [{ round: 1, count: 10, keepIds: ["a"] }],
  ep10TableAccept: [{ round: 1, accepted: true, note: "文字版可用" }],
  scriptFormatGate: {
    wordBand800_1200: true,
    scenesMax3: true,
    dialogueMax500: true,
    sceneHeaderFormat: true,
    deNovelizeAck: true,
  },
  dialogueHarshChecklist: {
    shortHarsh: true,
    barbedHook: true,
    contrastShock: true,
    evidenceSlap: true,
  },
  extendForm: {
    blockFrom: 11,
    blockTo: 20,
    conflictUpgrade: "势力升级",
    foreshadowSync: true,
    humanVerdict: "accept",
  },
});
assert(validateScriptFormatGate(hbFull.scriptFormatGate).ok, "script gate");
assert(validateExtendForm(hbFull.extendForm).ok, "extend form");
assert(
  manjuHandbookOpsCompleteness(hbFull).filledSteps === 7,
  `hb full ${manjuHandbookOpsCompleteness(hbFull).missing.join(",")}`,
);
assert(Boolean(summarizeManjuHandbookToMaster(hbFull).manjuHandbookSummary.trim()), "hb sum");

const mpWithHb = ManjuPipelineWorkflowSchema.parse({ handbookOps: hbFull });
assert(Boolean(mpWithHb.handbookOps.marketGenreAck.maleGenres.length), "mp nest hb");

/* ── 批量灵感：cool_expand 解析 ── */
{
  const table = `| 1 | abuse | 当众被退婚 |\n| 2 | cool | 金手指觉醒打脸 |\n| 3 | twist | 债主竟是旧识 |`;
  const parsed = parseCoolExpandToEvents(table);
  assert(parsed.length === 3, `parse table got ${parsed.length}`);
  assert(parsed[0].kind === "abuse", "kind abuse");
  assert(parsed[1].kind === "cool", "kind cool");
  const list = parseCoolExpandToEvents(`1. [虐] 家族逼婚\n2. [爽] 公开身份\n3. twist: 反派倒戈`);
  assert(list.length >= 3, `parse list ${list.length}`);
  assert(HOOK_BATCH_COUNTS.includes(10) && HOOK_BATCH_COUNTS.includes(100), "hook counts");
  assert(COOL_EXPAND_COUNTS.includes(20) && COOL_EXPAND_COUNTS.includes(100), "cool expand counts");
}

console.log("nines-workflow ok");
