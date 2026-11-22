/**
 * 九格基础课（2.md + 3.md + 4.md + 5.md + 6.md + 8.md + 9.md + 10.md）业务逻辑领域模型。
 * 2.md：提示词规则+指令、商业工作流术语、拆书 11 项、单元故事、核心梗 vs 情节卡、
 *       七步法、追妻、生成控长 GenerationPolicy。
 * 3.md：方法谱系、洗稿定基调、六大元素、一度/二度换元七步、节奏量化 RhythmQuant、
 *       情绪上下行对照、人物三位一体、质检优先级（与 GenerationPolicy / 11 项并存，不替换）。
 * 4.md：期待感 1+3、冲突六要素、配对、爽点四步+三类情绪链（非 5.md）、AI 筛选分。
 * 5.md：情绪锚定/以事见人/三轮拉扯/节奏四维/导语四轴（深化薄字段，不替换 2–4）。
 * 6.md：Maslow+cool12、装逼打脸三阶/信息差、代入感五维、文字表现力（不重建四步/三轮）。
 * 7.md：与 6.md 同堂复用校验；深化缺口—满足/写法卡/四线心理/审稿六问（不另建 Lesson7Workflow）。
 * 8.md：结构四层级判层→路径 A/B/C→人设/关系网/核心事件→章纲/细纲四描写→汇入短篇→AI 抽卡
 *       （InspirationToStoryWorkflow；不重建 short_novel Stage）。
 * 9.md：受众/扒榜/选题公式/反差缝合/导语200/全书11–13情节/处刑QC轻台（TopicSelectionWorkflow）。
 * 10.md：Big5/欲惧秘/差异化CP/清单七栏/灵魂三问/短篇手搓12（CharacterDepthWorkflow；≠漫剧十二检）。
 * 11.md：漫剧粗纲/集纲节奏/拒稿三检/投稿伦理/100字社交确认（ManjuPipelineWorkflow；不重建 Stage）。
 * 12.md：三大题材轨+不推荐表+收藏>5万+提炼内核（ManjuGenreTrackWorkflow；深化设定包）。
 * 13.md：IP 选书/锚定/单元/情绪/重构/视听/AdaptPitchPack（IpAdaptWorkflow；不重建 Stage）。
 * 14.md：女频选题/人设/架构/八报告/留存（FemaleLongDepthWorkflow；嵌 FemaleLongWorkbench）。
 * 15.md：女频节奏下半 paceDepth（嵌 Depth；复用 female.pace）。
 * 16.md：考拉十二步深化（ManjuPipeline 增字段；≠ male_long）。
 * 17.md：四步法/百集四幕/钩子（ManjuAdvancedWorkflow；不塞 Beat20）。
 * 实操手册 SOP：COOL18/Kartian + ManjuPipeline.handbookOps（不另建 HandbookWorkflow）。
 * 狂更猫：MaleLongEngineWorkflow（顺序闸/五段简介/主线≠核心/不卡文/循环倒推/搭台子/里程碑）；
 *       女频四换三挂 FemaleLongDepth.fourSwapThree（链 swap，不另起换元）。
 * 不可简化——前端工作台 / Agent 入参 / 知识库报告 bodyJson 共用此结构。
 */
import { z } from "zod";

/* ───────────────────── 提示词：规则 + 指令 ───────────────────── */

/** 人与 AI 认知差四象限（决定沟通策略） */
export const CognitiveGapQuadrantSchema = z.enum([
  "both_know", // 直接沟通
  "human_knows", // 用角色提示词/规则告诉 AI
  "ai_knows", // 提问让 AI 解释
  "neither_knows", // 先提问学习，再建规则
]);
export type CognitiveGapQuadrant = z.infer<typeof CognitiveGapQuadrantSchema>;

export const COGNITIVE_GAP_LABELS: Record<CognitiveGapQuadrant, string> = {
  both_know: "你知道 · AI 也知道 → 直接沟通",
  human_knows: "你知道 · AI 不知道 → 写规则告诉它",
  ai_knows: "你不知道 · AI 知道 → 先提问",
  neither_knows: "双方都不知道 → 先学再建规则",
};

/** 7W 指令补全（避免「去买个西瓜」式含糊指令） */
export const Instruction7WSchema = z.object({
  why: z.string().default(""),
  what: z.string().default(""),
  who: z.string().default(""),
  when: z.string().default(""),
  where: z.string().default(""),
  which: z.string().default(""),
  how: z.string().default(""),
});
export type Instruction7W = z.infer<typeof Instruction7WSchema>;

/** 一次 AI 交互 = 规则（角色提示词）+ 指令（具体命令）+ 双重限定 */
export const PromptComposeSchema = z.object({
  cognitiveGap: CognitiveGapQuadrantSchema.default("both_know"),
  /** 规则：你是谁、按什么方式工作（角色提示词） */
  rules: z.string().default(""),
  /** 指令：本次具体要做什么（由人提意见，不让 AI 乱选） */
  instruction: z.string().default(""),
  sevenW: Instruction7WSchema.default({}),
  /** 示例：仿节奏、仿情绪；必须能代表用户自己的想法 */
  examples: z.array(z.string()).default([]),
  /** 双重限定：要什么 */
  want: z.array(z.string()).default([]),
  /** 双重限定：不要什么（如「不要科幻」） */
  avoid: z.array(z.string()).default([]),
  /** 是否用 Markdown + 引用符包裹大批量原文 */
  wrapSourceInBlockquote: z.boolean().default(true),
  sourceExcerpt: z.string().optional(),
  notes: z.string().optional(),
});
export type PromptCompose = z.infer<typeof PromptComposeSchema>;

/* ───────────────────── 生成控长策略 ───────────────────── */

/** AI 单次优质输出约 2000～3000 汉字；用情节点个数控长，不用精确字数 */
export const GenerationPolicySchema = z.object({
  /** 建议单次汉字带宽下限 */
  minChars: z.number().int().default(2000),
  /** 建议单次汉字带宽上限 */
  maxChars: z.number().int().default(3000),
  /** 本次要覆盖的情节点个数（主控手段） */
  plotPointCount: z.number().int().min(1).max(12).default(3),
  /** 禁止：一次性全书 / 整篇万字 */
  forbidWholeBook: z.boolean().default(true),
  /** 分段：章 / 集 / 情节点批次 */
  chunkMode: z.enum(["chapter", "episode", "beat_batch"]).default("beat_batch"),
  /** 窗口策略：一类问题一个窗口，混乱/失忆则换窗 */
  windowPolicy: z
    .enum(["one_topic_per_window", "carry_full_context"])
    .default("one_topic_per_window"),
});
export type GenerationPolicy = z.infer<typeof GenerationPolicySchema>;

export const DEFAULT_GENERATION_POLICY: GenerationPolicy = {
  minChars: 2000,
  maxChars: 3000,
  plotPointCount: 3,
  forbidWholeBook: true,
  chunkMode: "beat_batch",
  windowPolicy: "one_topic_per_window",
};

/* ───────────────────── 大纲术语（禁止含糊「大纲」） ───────────────────── */

export const OutlineLevelSchema = z.enum([
  "inspiration", // 灵感 / 故事梗概入口
  "master", // 总纲 = 故事梗概
  "framework", // 框架 = 人设、世界观、文风、金手指等
  "volume", // 卷纲（长篇有；短篇无；中篇有）
  "chapter", // 章纲 = 章节层故事线
  "beat", // 细纲 = 最小单元情节设计
  "draft", // 正文初稿
  "revise", // 修改（节奏、情绪）
]);
export type OutlineLevel = z.infer<typeof OutlineLevelSchema>;

export const OUTLINE_LEVEL_LABELS: Record<OutlineLevel, string> = {
  inspiration: "灵感 / 故事梗概",
  master: "总纲（故事梗概）",
  framework: "框架（人设·世界观·文风）",
  volume: "卷纲",
  chapter: "章纲（故事线·章节安排）",
  beat: "细纲（每章情节设计）",
  draft: "正文初稿",
  revise: "修改（节奏·情绪）",
};

/** 商业文章标准工作流顺序 */
export const COMMERCIAL_WORKFLOW_ORDER: OutlineLevel[] = [
  "inspiration",
  "master",
  "framework",
  "volume",
  "chapter",
  "beat",
  "draft",
  "revise",
];

export const FrameworkOmitFlagsSchema = z.object({
  /** 短篇可省略 */
  omitWorldview: z.boolean().default(false),
  omitPowerSystem: z.boolean().default(false),
  omitFactions: z.boolean().default(false),
  omitGoldFinger: z.boolean().default(false),
  /** 文风和角色通常需要 */
  requireStyle: z.boolean().default(true),
  requireCharacters: z.boolean().default(true),
});
export type FrameworkOmitFlags = z.infer<typeof FrameworkOmitFlagsSchema>;

export const MasterOutlineBodySchema = z.object({
  logline: z.string().default(""),
  genre: z.string().default(""),
  formatHint: z.string().default(""),
  approxWords: z.number().int().nonnegative().optional(),
  coreConflictOneLiner: z.string().default(""),
  bigExpectation: z.string().default(""),
  smallExpectations: z.array(z.string()).default([]),
  /** 4.md：配对/筛选摘要（薄字段回写，完整设计见 ExpectationConflictWorkflow） */
  pairingSummary: z.string().default(""),
  screenScoreSummary: z.string().default(""),
  /** 5.md：情绪节奏摘要（完整设计见 EmotionRhythmWorkflow） */
  emotionRhythmSummary: z.string().default(""),
  /** 6.md：爽点打脸摘要（完整设计见 CoolFaceSlapWorkflow） */
  coolFaceSlapSummary: z.string().default(""),
  /** 8.md：灵感成故事摘要（完整设计见 InspirationToStoryWorkflow） */
  inspirationToStorySummary: z.string().default(""),
  /** 9.md：短篇选题摘要（完整设计见 TopicSelectionWorkflow） */
  topicSelectionSummary: z.string().default(""),
  /** 10.md：人设深度摘要（完整设计见 CharacterDepthWorkflow） */
  characterDepthSummary: z.string().default(""),
  /** 11.md：漫剧管线摘要（完整设计见 ManjuPipelineWorkflow） */
  manjuPipelineSummary: z.string().default(""),
  /** 12.md：漫剧题材轨摘要（完整设计见 ManjuGenreTrackWorkflow） */
  manjuGenreTrackSummary: z.string().default(""),
  /** 13.md：IP 改编摘要（完整设计见 IpAdaptWorkflow） */
  ipAdaptSummary: z.string().default(""),
  /** 14.md：女频长篇深度摘要（完整设计见 FemaleLongDepthWorkflow） */
  femaleLongDepthSummary: z.string().default(""),
  /** 15.md：女频节奏下半摘要 */
  femalePaceDepthSummary: z.string().default(""),
  /** 16.md：考拉流水线摘要 */
  manjuKoalaSummary: z.string().default(""),
  /** 17.md：漫剧进阶二摘要 */
  manjuAdvancedSummary: z.string().default(""),
  /** 实操手册 SOP 摘要 */
  manjuHandbookSummary: z.string().default(""),
  /** 投稿三块摘要 */
  manjuPitchPackSummary: z.string().default(""),
  /** 查理短剧课 Ops 摘要 */
  duanjuCharlieSummary: z.string().default(""),
  /** 狂更猫男频长篇引擎摘要 */
  maleLongEngineSummary: z.string().default(""),
});
export type MasterOutlineBody = z.infer<typeof MasterOutlineBodySchema>;

export const FrameworkBodySchema = z.object({
  charactersBrief: z.string().default(""),
  worldview: z.string().default(""),
  powerSystem: z.string().default(""),
  factions: z.string().default(""),
  goldFinger: z.string().default(""),
  styleRules: z.string().default(""),
  omit: FrameworkOmitFlagsSchema.default({}),
});
export type FrameworkBody = z.infer<typeof FrameworkBodySchema>;

export const ChapterOutlineItemSchema = z.object({
  chapterNo: z.number().int(),
  title: z.string().default(""),
  summary: z.string().default(""),
  unitStoryId: z.string().optional(),
  storylineRole: z.string().default(""), // 主线推进 / 日常缓冲 / 付费卡点…
  hookAtEnd: z.boolean().default(false),
});
export type ChapterOutlineItem = z.infer<typeof ChapterOutlineItemSchema>;

export const BeatSheetItemSchema = z.object({
  chapterNo: z.number().int(),
  beatNo: z.number().int(),
  event: z.string().default(""),
  cause: z.string().default(""),
  change: z.string().default(""),
  emotionDelta: z.string().default(""),
  plotPointIndex: z.number().int().optional(),
});
export type BeatSheetItem = z.infer<typeof BeatSheetItemSchema>;

/* ───────────────────── 单元故事层级 ───────────────────── */

export const StoryScaleSchema = z.enum(["macro", "volume", "unit"]);
export type StoryScale = z.infer<typeof StoryScaleSchema>;

export const STORY_SCALE_LABELS: Record<StoryScale, { label: string; scale: string }> = {
  macro: { label: "大故事（全篇）", scale: "整本书" },
  volume: { label: "中故事（一卷）", scale: "一卷" },
  unit: { label: "小故事（单元）", scale: "约 1 万字 / 1～5 章" },
};

export const UnitStoryBodySchema = z.object({
  id: z.string().default(""),
  title: z.string().default(""),
  scale: StoryScaleSchema.default("unit"),
  chapterRange: z.string().default(""), // 如 1～5 章
  purpose: z.string().default(""), // 拆书目的：故事线 / 细纲 / 人物
  worthDeepDissect: z.boolean().default(false),
  summary: z.string().default(""),
  parentId: z.string().nullable().optional(),
});
export type UnitStoryBody = z.infer<typeof UnitStoryBodySchema>;

/* ───────────────────── 故事七步法（≠ 人设七步） ───────────────────── */

/** 单元故事七步：目标→阻碍→行动→结果→意外→转折→结局 */
export const UNIT_SEVEN_STEP_IDS = [
  "goal",
  "obstacle",
  "action",
  "result",
  "accident",
  "twist",
  "ending",
] as const;

export const UNIT_SEVEN_STEP_LABELS: Record<(typeof UNIT_SEVEN_STEP_IDS)[number], string> = {
  goal: "目标",
  obstacle: "阻碍",
  action: "行动",
  result: "结果（通常先失败）",
  accident: "意外",
  twist: "转折",
  ending: "结局",
};

export const UnitSevenStepsSchema = z.object({
  goal: z.string().default(""),
  obstacle: z.string().default(""),
  action: z.string().default(""),
  /** 前四步通常失败——一下成功就没有爽点 */
  result: z.string().default(""),
  accident: z.string().default(""),
  twist: z.string().default(""),
  ending: z.string().default(""),
  /** 是否为反向拆书验证（读文时） */
  reverseValidate: z.boolean().default(false),
  /** 是否嵌套在更大故事内 */
  nestedUnder: z.string().optional(),
  notes: z.string().optional(),
});
export type UnitSevenSteps = z.infer<typeof UnitSevenStepsSchema>;

export const QiChengZhuanHeSchema = z.object({
  qi: z.string().default(""), // 起
  cheng: z.string().default(""), // 承
  zhuan: z.string().default(""), // 转
  he: z.string().default(""), // 合
  chapterRange: z.string().optional(),
});
export type QiChengZhuanHe = z.infer<typeof QiChengZhuanHeSchema>;

/* ───────────────────── 核心梗 vs 情节卡 ───────────────────── */

export const CoreHookKindSchema = z.enum(["core_hook", "plot_card"]);
export type CoreHookKind = z.infer<typeof CoreHookKindSchema>;

export const CORE_HOOK_KIND_HINTS: Record<CoreHookKind, string> = {
  core_hook: "抽象、可跨题材；只保情绪链条，不锁步骤/人物/场景",
  plot_card: "固定流程菜谱；起因经过结果与人物类型基本写死",
};

export const CoreHookCategorySchema = z.enum(["thrill", "emotion", "twist"]);
export type CoreHookCategory = z.infer<typeof CoreHookCategorySchema>;

export const CORE_HOOK_CATEGORY_LABELS: Record<CoreHookCategory, string> = {
  thrill: "爽点型（扮猪吃老虎 / 临危受命 / 贵族相遇…）",
  emotion: "情感型（英雄救美 / 误会解除 / 共同经历…）",
  twist: "转折型（因祸得福 / 掉悬崖必有奇遇…）",
};

export const CoreHookSizeSchema = z.enum(["L1", "L2", "unit"]);
export type CoreHookSize = z.infer<typeof CoreHookSizeSchema>;

export const CORE_HOOK_SIZE_LABELS: Record<CoreHookSize, string> = {
  L1: "一级梗（整本书，如打败魔王）",
  L2: "二级梗（一级内部：练级/技能/装备/队友）",
  unit: "单元内部梗组合（虐时用其他梗虐，追时用其他梗追）",
};

/** 情绪链条节点 */
export const EmotionChainNodeSchema = z.object({
  label: z.string(),
  side: z.enum(["hurt", "hurter", "shared", "reader"]).default("shared"),
  intensity: z.number().min(-10).max(10).optional(),
});
export type EmotionChainNode = z.infer<typeof EmotionChainNodeSchema>;

/**
 * 扩展核心梗 body（在 entities.CoreHookBody 之上的完整业务字段）。
 * 写入 artifact.bodyJson 时可与旧字段并存。
 */
export const CoreHookFullBodySchema = z.object({
  kind: CoreHookKindSchema.default("core_hook"),
  category: CoreHookCategorySchema.optional(),
  size: CoreHookSizeSchema.default("unit"),
  titleHook: z.string().default(""),
  coreHook: z.string().default(""),
  /** 情绪链条——核心梗真正要跨题材保持的东西 */
  emotionChain: z.array(EmotionChainNodeSchema).default([]),
  tags: z.array(z.string()).default([]),
  motivation: z.string().optional(),
  crisis: z.string().optional(),
  openingStructure: z.string().optional(),
  openingBeats: z.array(z.string()).default([]),
  /** 抽象化痕迹：客栈→公共空间；结伴而行→关系加深 */
  abstractions: z
    .array(z.object({ concrete: z.string(), abstract: z.string() }))
    .default([]),
  conflicts: z.array(z.string()).default([]), // 内部/外部；敌对/竞争
  scores: z
    .object({
      empathy: z.number().optional(),
      thrill: z.number().optional(),
      diff: z.number().optional(),
      motivation: z.number().optional(),
      mainline: z.number().optional(),
    })
    .optional(),
  favorited: z.boolean().default(false),
  note: z.string().optional(),
  riskFlags: z.array(z.string()).default([]),
  /** 若被标为情节卡：固定步骤 */
  plotCardSteps: z.array(z.string()).default([]),
});
export type CoreHookFullBody = z.infer<typeof CoreHookFullBodySchema>;

/* ───────────────────── 追妻火葬场模板 ───────────────────── */

export const ChaseWifePhaseSchema = z.enum(["abuse", "destroy", "chase", "union"]);
export type ChaseWifePhase = z.infer<typeof ChaseWifePhaseSchema>;

export const CHASE_WIFE_PHASE_LABELS: Record<ChaseWifePhase, string> = {
  abuse: "虐（三轮递进：一而再、再而三、三而竭）",
  destroy: "毁（决裂方式）",
  chase: "追（同样三轮：第一轮不行→第二轮不行→第三轮）",
  union: "合（HE / BE；反派含白月光一律无好下场）",
};

export const ChaseWifeRoundSchema = z.object({
  round: z.number().int().min(1).max(3),
  event: z.string().default(""),
  location: z.string().default(""), // 医院/家里/监狱/酒吧/墓地…
  emotionHurt: z.string().default(""),
  emotionHurter: z.string().default(""),
});
export type ChaseWifeRound = z.infer<typeof ChaseWifeRoundSchema>;

export const ChaseWifeTemplateSchema = z.object({
  /** 被伤害方情绪链 */
  hurtChain: z
    .array(z.string())
    .default(["受挫", "期待", "委屈", "积累失望", "决裂"]),
  /** 伤害方情绪链 */
  hurterChain: z
    .array(z.string())
    .default(["忽视/过错", "后知后觉", "幡然醒悟", "悔恨", "付出"]),
  abuseRounds: z.array(ChaseWifeRoundSchema).default([]),
  destroyHow: z.string().default(""),
  chaseRounds: z.array(ChaseWifeRoundSchema).default([]),
  unionEnding: z.enum(["HE", "BE", "open"]).default("HE"),
  villainFate: z.string().default("反派（含白月光）无好下场：被抓或死，无中间态"),
  hasDigBoard: z.boolean().optional(), // 有挖板 / 无挖板变体
  relatedTropes: z.array(z.string()).default(["破镜重圆（相近但有别，需自己看文体会）"]),
  notes: z.string().optional(),
});
export type ChaseWifeTemplate = z.infer<typeof ChaseWifeTemplateSchema>;

/* ───────────────────── 拆书参数模板（11 项完整结构） ───────────────────── */

export const DissectPurposeSchema = z.enum([
  "storyline", // 拆故事线 / 章纲
  "beats", // 拆细纲
  "characters", // 拆人物
  "core_hook", // 提取核心梗
  "style", // 拆文风
  "full_params", // 完整参数
]);
export type DissectPurpose = z.infer<typeof DissectPurposeSchema>;

export const DISSECT_PURPOSE_LABELS: Record<DissectPurpose, string> = {
  storyline: "拆故事线（先看章纲）",
  beats: "拆细纲（选写得好的单元）",
  characters: "拆人物",
  core_hook: "提取核心梗",
  style: "拆文风要素",
  full_params: "完整参数模板（11 项）",
};

export const TextEncodingCheckSchema = z.object({
  encoding: z.enum(["utf8_windows", "utf8_unix", "other", "unknown"]).default("unknown"),
  lineEnding: z.enum(["crlf", "lf", "mixed", "unknown"]).default("unknown"),
  cleanedHierarchyNoise: z.boolean().default(false),
  notes: z.string().optional(),
});
export type TextEncodingCheck = z.infer<typeof TextEncodingCheckSchema>;

export const EmotionCurvePointSchema = z.object({
  beatLabel: z.string().default(""),
  value: z.number().min(-10).max(10),
  note: z.string().optional(),
  /** 5.md：可选标注核心情绪 / 三轮序号 / 展示或告知 */
  coreEmotion: z.string().optional(),
  roundIndex: z.number().int().min(0).max(3).optional(),
  showOrTell: z.enum(["show", "tell", "unknown"]).optional(),
});
export type EmotionCurvePoint = z.infer<typeof EmotionCurvePointSchema>;

/* ───────────────────── 4.md：期待感 Hook 单元 ───────────────────── */

export const ExpectationLayerSchema = z.enum(["core", "small"]);
export type ExpectationLayer = z.infer<typeof ExpectationLayerSchema>;

export const ExpectationSpanSchema = z.enum(["near", "far"]);
export type ExpectationSpan = z.infer<typeof ExpectationSpanSchema>;

export const ExpectationSizeSchema = z.enum(["big", "small"]);
export type ExpectationSize = z.infer<typeof ExpectationSizeSchema>;

export const ExpectationHorizonSchema = z.enum(["short", "long"]);
export type ExpectationHorizon = z.infer<typeof ExpectationHorizonSchema>;

export const ExpectationDecayRiskSchema = z.enum(["none", "forget", "delay", "fatigue"]);
export type ExpectationDecayRisk = z.infer<typeof ExpectationDecayRiskSchema>;

export const ExpectationHookStatusSchema = z.enum(["open", "paid"]);
export type ExpectationHookStatus = z.infer<typeof ExpectationHookStatusSchema>;

export const ExpectationHookUnitSchema = z.object({
  id: z.string().default(""),
  content: z.string().default(""),
  layer: ExpectationLayerSchema.default("small"),
  span: ExpectationSpanSchema.default("near"),
  size: ExpectationSizeSchema.default("small"),
  horizon: ExpectationHorizonSchema.default("short"),
  /** 抛钩位置（章/集/字数区间） */
  castAt: z.string().default(""),
  /** 收钩位置 */
  payoffAt: z.string().default(""),
  /** 小期待默认 ≤1000 字 */
  maxCharsHint: z.number().int().default(1000),
  urgency: z.string().default(""),
  timeCrisis: z.string().default(""),
  decayRisk: ExpectationDecayRiskSchema.default("none"),
  decayRemedy: z.string().default(""),
  status: ExpectationHookStatusSchema.default("open"),
});
export type ExpectationHookUnit = z.infer<typeof ExpectationHookUnitSchema>;

export const ExpectationDesign1Plus3Schema = z.object({
  core: ExpectationHookUnitSchema.default({
    layer: "core",
    size: "big",
    span: "far",
    horizon: "long",
    maxCharsHint: 3000,
  }),
  /** 强制三槽；不足则完成度缺项 */
  small: z
    .array(ExpectationHookUnitSchema)
    .default([
      { layer: "small", size: "small", span: "near", horizon: "short", maxCharsHint: 1000 },
      { layer: "small", size: "small", span: "near", horizon: "short", maxCharsHint: 1000 },
      { layer: "small", size: "small", span: "near", horizon: "short", maxCharsHint: 1000 },
    ]),
  /** 开篇前多少字内必须亮核心期待 */
  openingRevealByChars: z.number().int().default(3000),
  /** 黄金一章：导语+开篇定生死 */
  goldChapterChars: z.number().int().default(500),
  /** 远期待打底、近期待拉满 */
  farNearStrategy: z
    .string()
    .default("远期待打底、近期待拉满：大目标分解为子目标（升级/装备/队友）再落到具体获得。"),
  subGoals: z.array(z.string()).default([]),
  concreteGains: z.array(z.string()).default([]),
  /** 短篇基本无支线 */
  noSidePlot: z.boolean().default(true),
  midImmersionNote: z.string().default(""),
});
export type ExpectationDesign1Plus3 = z.infer<typeof ExpectationDesign1Plus3Schema>;

/** 爽点四步附属：三类情绪链（非 5.md 情绪曲线） */
export const EmotionChain3Schema = z.object({
  protagonist: z.string().default(""),
  antagonist: z.string().default(""),
  atmosphere: z.string().default(""),
});
export type EmotionChain3 = z.infer<typeof EmotionChain3Schema>;

export const CoolPointFourStepSchema = z.object({
  pull: z.string().default(""),
  intensify: z.string().default(""),
  feint: z.string().default(""),
  overpay: z.string().default(""),
  emotionChain: EmotionChain3Schema.default({}),
});
export type CoolPointFourStep = z.infer<typeof CoolPointFourStepSchema>;

export const CoolPointReversePlanSchema = z.object({
  coolPointFirst: z.string().default(""),
  fourStep: CoolPointFourStepSchema.default({}),
  reverseHooks: z
    .array(
      z.object({
        hook: z.string().default(""),
        buryAt: z.string().default(""),
        payoffAt: z.string().default(""),
        linkedExpectationId: z.string().default(""),
      }),
    )
    .default([]),
  /** 未填爽点不可标完成 */
  reverseDone: z.boolean().default(false),
  appendedToForeshadow: z.boolean().default(false),
});
export type CoolPointReversePlan = z.infer<typeof CoolPointReversePlanSchema>;

/* ───────────────────── 4.md：矛盾冲突 ───────────────────── */

export const ConflictKindSchema = z.enum(["compete", "hostile"]);
export type ConflictKind = z.infer<typeof ConflictKindSchema>;

export const ConflictLocusSchema = z.enum(["internal", "external"]);
export type ConflictLocus = z.infer<typeof ConflictLocusSchema>;

export const ConflictTargetPrioritySchema = z.enum(["protagonist", "importantOther"]);
export type ConflictTargetPriority = z.infer<typeof ConflictTargetPrioritySchema>;

export const ConflictUpgradeModeSchema = z.enum(["singleEvent", "multiEvent"]);
export type ConflictUpgradeMode = z.infer<typeof ConflictUpgradeModeSchema>;

export const VillainEndingSchema = z.enum(["yield", "dead", "prison", "undecided"]);
export type VillainEnding = z.infer<typeof VillainEndingSchema>;

export const ConflictSixElementIdSchema = z.enum([
  "hitProtagonist",
  "fierce",
  "upgrade",
  "believable",
  "coolThenValues",
  "noForcedNovelty",
]);
export type ConflictSixElementId = z.infer<typeof ConflictSixElementIdSchema>;

export const CONFLICT_SIX_ELEMENT_LABELS: Record<ConflictSixElementId, string> = {
  hitProtagonist: "冲主角（或重要的人）",
  fierce: "激烈凶险（对手强/后果重/目标强）",
  upgrade: "能升级（2～3 次）",
  believable: "合理（反机械降神）",
  coolThenValues: "先爽再正三观",
  noForcedNovelty: "不强行创新（老套路可用）",
};

export const CONFLICT_SIX_ELEMENT_IDS: ConflictSixElementId[] = [
  "hitProtagonist",
  "fierce",
  "upgrade",
  "believable",
  "coolThenValues",
  "noForcedNovelty",
];

export const ConflictSixElementsChecklistSchema = z.object({
  items: z
    .array(
      z.object({
        id: ConflictSixElementIdSchema,
        done: z.boolean().default(false),
        evidence: z.string().default(""),
      }),
    )
    .default(
      CONFLICT_SIX_ELEMENT_IDS.map((id) => ({ id, done: false, evidence: "" })),
    ),
});
export type ConflictSixElementsChecklist = z.infer<typeof ConflictSixElementsChecklistSchema>;

export const ConflictDesignSchema = z.object({
  id: z.string().default(""),
  oneLiner: z.string().default(""),
  kind: ConflictKindSchema.default("hostile"),
  locus: ConflictLocusSchema.default("external"),
  targetPriority: ConflictTargetPrioritySchema.default("protagonist"),
  opponentStrong: z.boolean().default(false),
  consequenceSevere: z.boolean().default(false),
  goalStrong: z.boolean().default(false),
  upgradeMode: ConflictUpgradeModeSchema.default("singleEvent"),
  upgradeSteps: z.array(z.string()).default([]),
  chainUnbroken: z.boolean().default(true),
  antiDeusEx: z.boolean().default(false),
  resolutionStyle: z.string().default(""),
  villainEnding: VillainEndingSchema.default("undecided"),
  noWinWin: z.boolean().default(true),
  passiveHive: z.boolean().default(true),
  six: ConflictSixElementsChecklistSchema.default({}),
  linkedExpectationId: z.string().default(""),
});
export type ConflictDesign = z.infer<typeof ConflictDesignSchema>;

export const ExpectationConflictPairingSchema = z.object({
  coreExpectationId: z.string().default(""),
  coreConflictId: z.string().default(""),
  smallPairs: z
    .array(
      z.object({
        expectationId: z.string().default(""),
        conflictId: z.string().default(""),
        ok: z.boolean().default(false),
      }),
    )
    .default([]),
  note: z.string().default(""),
});
export type ExpectationConflictPairing = z.infer<typeof ExpectationConflictPairingSchema>;

export const GenericArcPhaseSchema = z.enum(["opening", "mid", "late", "ending"]);
export type GenericArcPhase = z.infer<typeof GenericArcPhaseSchema>;

export const GENERIC_ARC_PHASE_LABELS: Record<GenericArcPhase, string> = {
  opening: "开篇：抛核心期待 + 第一钩",
  mid: "中期：收钩，抛第二钩",
  late: "后期：收第二钩，抛第三小钩",
  ending: "结尾：收第三小钩，收束",
};

export const GenericArcTemplateSchema = z.object({
  enabled: z.boolean().default(true),
  isReferenceNotStandard: z.boolean().default(true),
  phases: z
    .array(
      z.object({
        phase: GenericArcPhaseSchema,
        action: z.string().default(""),
        done: z.boolean().default(false),
      }),
    )
    .default([
      { phase: "opening", action: "抛核心期待 + 第一个钩子；解决紧急问题并产生第一期待", done: false },
      { phase: "mid", action: "收钩，抛第二个钩", done: false },
      { phase: "late", action: "收第二个钩，抛第三个小钩", done: false },
      { phase: "ending", action: "收第三个小钩，收束", done: false },
    ]),
});
export type GenericArcTemplate = z.infer<typeof GenericArcTemplateSchema>;

/** 换元候选：期待感 + 矛盾筛选分（人仍选定，低分告警） */
export const AiCandidateScreenScoreSchema = z.object({
  expectClear: z.boolean().default(false),
  expect1Plus3: z.boolean().default(false),
  expectUrgency: z.boolean().default(false),
  expectEnding: z.boolean().default(false),
  conflictHitsProtagonist: z.boolean().default(false),
  conflictDeadEnd: z.boolean().default(false),
  conflictEscalates: z.boolean().default(false),
  note: z.string().default(""),
  /** 0～7；建议 ≥5 再选定 */
  total: z.number().int().min(0).max(7).default(0),
  lowScoreWarned: z.boolean().default(false),
});
export type AiCandidateScreenScore = z.infer<typeof AiCandidateScreenScoreSchema>;

export const SCREEN_SCORE_THRESHOLD = 5;

export function computeAiCandidateScreenScore(
  partial: Omit<AiCandidateScreenScore, "total" | "lowScoreWarned"> & {
    total?: number;
    lowScoreWarned?: boolean;
  },
): AiCandidateScreenScore {
  const flags = [
    partial.expectClear,
    partial.expect1Plus3,
    partial.expectUrgency,
    partial.expectEnding,
    partial.conflictHitsProtagonist,
    partial.conflictDeadEnd,
    partial.conflictEscalates,
  ];
  const total = flags.filter(Boolean).length;
  return AiCandidateScreenScoreSchema.parse({
    ...partial,
    total,
    lowScoreWarned: total < SCREEN_SCORE_THRESHOLD,
  });
}

/** 人设反差→期待感（引用三位一体，不重建表单） */
export const CharacterExpectationContrastSchema = z.object({
  characterName: z.string().default(""),
  contrast: z.string().default(""),
  expectationBoost: z.string().default(""),
  trinityRefOk: z.boolean().nullable().default(null),
});
export type CharacterExpectationContrast = z.infer<typeof CharacterExpectationContrastSchema>;

export const ExpectationReviseItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  done: z.boolean().default(false),
  note: z.string().default(""),
});
export type ExpectationReviseItem = z.infer<typeof ExpectationReviseItemSchema>;

export const DEFAULT_EXPECTATION_REVISE_ITEMS: ExpectationReviseItem[] = [
  { id: "opening_core", label: "开篇 2000～3000 字内亮出核心期待", done: false, note: "" },
  { id: "gold_chapter", label: "导语+开篇 300～500 字定生死", done: false, note: "" },
  { id: "small_len", label: "小期待 ≤1000 字快抛快收", done: false, note: "" },
  { id: "no_side", label: "短篇无支线；情节围绕核心期待", done: false, note: "" },
  { id: "far_remind", label: "远期待有反复拉紧（防遗忘）", done: false, note: "" },
  { id: "deus_ex", label: "无机械降神；冲突爆发/升级合理", done: false, note: "" },
  { id: "no_winwin", label: "反派彻底服软/悲惨收尾；无合作共赢憋屈", done: false, note: "" },
  { id: "routine_vary", label: "核心循环有变化（感情/友情线等）", done: false, note: "" },
  { id: "char_align", label: "人设与期待未脱节", done: false, note: "" },
  { id: "mid_immersion", label: "中期有代入期待（具体获得）", done: false, note: "" },
];

/** 4.md 九步工作流（故事梗概阶段） */
export const ExpectationConflictWorkflowSchema = z.object({
  schemaVersion: z.string().default("nines-4.md/1"),
  synopsis: z.string().default(""),
  logline: z.string().default(""),
  design: ExpectationDesign1Plus3Schema.default({}),
  conflicts: z.array(ConflictDesignSchema).default([]),
  pairing: ExpectationConflictPairingSchema.default({}),
  coolReverse: CoolPointReversePlanSchema.default({}),
  arc: GenericArcTemplateSchema.default({}),
  characterContrast: z.array(CharacterExpectationContrastSchema).default([]),
  reviseChecklist: z
    .array(ExpectationReviseItemSchema)
    .default(DEFAULT_EXPECTATION_REVISE_ITEMS),
  currentStep: z.number().int().min(1).max(9).default(1),
  notes: z.string().default(""),
});
export type ExpectationConflictWorkflow = z.infer<typeof ExpectationConflictWorkflowSchema>;

/** 拆书结果完整结构（参数模板 11 模块）——与课程知识点 13 一一对应 */
export const DissectParamsBodySchema = z.object({
  schemaVersion: z.string().default("nines-2.md/1"),
  purpose: DissectPurposeSchema.default("full_params"),
  sourceDocId: z.string().optional(),
  sourceTitle: z.string().optional(),
  textCheck: TextEncodingCheckSchema.default({}),

  /** 1. 基本信息/选题 */
  basic: z
    .object({
      synopsis: z.string().default(""),
      genre: z.string().default(""),
      typeLabel: z.string().default(""), // 长篇/短篇/短剧/漫剧…
      approxWords: z.number().int().nonnegative().optional(),
    })
    .default({}),

  /** 2. 期待感：大期待 + 小期待（4.md 可选 design 深化） */
  expectations: z
    .object({
      big: z.string().default(""),
      small: z.array(z.string()).default([]),
      design: ExpectationDesign1Plus3Schema.optional(),
    })
    .default({}),

  /** 3. 故事设定 */
  setting: z
    .object({
      background: z.string().default(""),
      protagonist: z.string().default(""),
      supporting: z.array(z.string()).default([]),
    })
    .default({}),

  /** 4. 故事脉络/核心内容（≠ 核心梗） */
  storyline: z
    .object({
      coreContent: z.string().default(""),
      note: z.string().default("此处「核心内容」不是核心梗定义"),
    })
    .default({}),

  /** 5. 核心冲突（可多个；4.md 可选 designs 深化） */
  conflicts: z.array(z.string()).default([]),
  conflictDesigns: z.array(ConflictDesignSchema).default([]),

  /** 6. 情绪曲线 */
  emotionCurve: z.array(EmotionCurvePointSchema).default([]),

  /** 7. 人物关系 */
  relationships: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        bond: z.string(),
      }),
    )
    .default([]),

  /** 8. 故事反转（可二次/多次） */
  twists: z.array(z.string()).default([]),

  /** 9. 起承转合 */
  qiChengZhuanHe: QiChengZhuanHeSchema.default({}),

  /** 10. 七步法 */
  sevenSteps: UnitSevenStepsSchema.default({}),

  /** 11. 整体节奏/风格 */
  rhythmStyle: z
    .object({
      rhythm: z.string().default(""),
      style: z.string().default(""),
    })
    .default({}),

  /** 单元故事列表（按单元拆，不盲目拆全书） */
  unitStories: z.array(UnitStoryBodySchema).default([]),

  /** 提取出的核心梗（可多条） */
  extractedHooks: z.array(CoreHookFullBodySchema).default([]),

  /** 人工校对状态：AI 拆得不准要校对多遍 */
  proofread: z
    .object({
      comparedWithSource: z.boolean().default(false),
      rounds: z.number().int().default(0),
      issues: z.array(z.string()).default([]),
    })
    .default({}),

  favoriteWorthDeep: z.array(z.string()).default([]), // 写得好、值得深拆的单元 id/标题
});
export type DissectParamsBody = z.infer<typeof DissectParamsBodySchema>;

/* ───────────────────── 文风提取工作流 ───────────────────── */

export const StyleExtractElementsSchema = z.object({
  atmosphere: z.string().default(""),
  narrativeStructure: z.string().default(""),
  languageStyle: z.string().default(""),
  tone: z.string().default(""),
  lengthComplexity: z.string().default(""),
  pacing: z.string().default(""),
  characterization: z.string().default(""),
  detail: z.string().default(""),
  dialogue: z.string().default(""),
  emotionExpression: z.string().default(""),
});
export type StyleExtractElements = z.infer<typeof StyleExtractElementsSchema>;

export const StyleExtractWorkflowSchema = z.object({
  sourceExcerpt: z.string().default(""),
  aiExtract: StyleExtractElementsSchema.default({}),
  /** 你理解的文风 vs AI 理解的文风是否一致（人工判断） */
  humanAgreesWithAi: z.boolean().nullable().default(null),
  disagreementNotes: z.string().default(""),
  /** 整理成规则后的提示词片段 */
  styleRulesPrompt: z.string().default(""),
  /** 目的：仿写这一篇 / 只要文风相似（一般不直接丢原文，除非洗稿） */
  purpose: z.enum(["imitate_piece", "style_only", "wash"]).default("style_only"),
});
export type StyleExtractWorkflow = z.infer<typeof StyleExtractWorkflowSchema>;

/* ───────────────────── 3.md：方法谱系 ───────────────────── */

/** 行业方法谱系：洗稿 → 仿写 → 融梗 → 改编（难度递增；融梗/改编本课只标谱系） */
export const MethodSpectrumStepSchema = z.enum([
  "wash", // 洗稿 1V1/1VN
  "imitate_coarse", // 仿写粗纺 ≈ 一度
  "imitate_fine", // 仿写精纺
  "swap", // 换元法 1V1
  "merge_tropes", // 融梗 ≥2 本（更高课次）
  "adapt", // 改编 长篇→短篇→剧本（更高课次）
]);
export type MethodSpectrumStep = z.infer<typeof MethodSpectrumStepSchema>;

export const METHOD_SPECTRUM_META: Record<
  MethodSpectrumStep,
  { label: string; difficulty: number; relation: string; lesson3Deep: boolean }
> = {
  wash: {
    label: "洗稿",
    difficulty: 1,
    relation: "1V1 或 1VN；高相似度仿写",
    lesson3Deep: true,
  },
  imitate_coarse: {
    label: "仿写·粗纺",
    difficulty: 2,
    relation: "一度置换范畴",
    lesson3Deep: true,
  },
  imitate_fine: {
    label: "仿写·精纺",
    difficulty: 3,
    relation: "二级置换范畴",
    lesson3Deep: true,
  },
  swap: {
    label: "换元法",
    difficulty: 3,
    relation: "1V1；换背景/人物/道具或核心事件",
    lesson3Deep: true,
  },
  merge_tropes: {
    label: "融梗",
    difficulty: 5,
    relation: "≥2 本融合（本课仅展示谱系）",
    lesson3Deep: false,
  },
  adapt: {
    label: "改编",
    difficulty: 4,
    relation: "长篇→短篇→剧本（本课仅展示谱系）",
    lesson3Deep: false,
  },
};

export const MethodSpectrumStateSchema = z.object({
  selected: MethodSpectrumStepSchema.default("swap"),
  /** 新人默认一度；留级可二度 */
  preferredDegree: z.enum(["once", "twice"]).default("once"),
  /** 入门题材建议：爽文/甜文；不建议虐文 */
  genrePreference: z
    .enum(["爽文", "甜文", "世情", "悬疑", "追妻", "末日", "其他"])
    .default("爽文"),
  avoidSciFi: z.boolean().default(true),
  avoidAbuse: z.boolean().default(true),
  notes: z.string().default(""),
});
export type MethodSpectrumState = z.infer<typeof MethodSpectrumStateSchema>;

/* ───────────────────── 3.md：六大元素 ───────────────────── */

export const SixElementKeySchema = z.enum([
  "event", // 事件/故事
  "structure", // 结构（视角、时间线、节奏）
  "subject", // 主体/价值观
  "background", // 背景
  "character", // 人物
  "prop", // 道具（含路人甲/气氛组）
]);
export type SixElementKey = z.infer<typeof SixElementKeySchema>;

export const SIX_ELEMENT_LABELS: Record<SixElementKey, string> = {
  event: "事件（故事）",
  structure: "结构",
  subject: "主体（价值观）",
  background: "背景",
  character: "人物",
  prop: "道具",
};

export const SIX_ELEMENT_KEYS: SixElementKey[] = [
  "event",
  "structure",
  "subject",
  "background",
  "character",
  "prop",
];

export const SixElementRowSchema = z.object({
  key: SixElementKeySchema,
  source: z.string().default(""),
  target: z.string().default(""),
  /** 一度通常不换 event；二度必须换 event */
  swappable: z.boolean().default(true),
  note: z.string().default(""),
});
export type SixElementRow = z.infer<typeof SixElementRowSchema>;

export const SixElementsMappingSchema = z.object({
  degree: z.enum(["once", "twice"]).default("once"),
  rows: z
    .array(SixElementRowSchema)
    .default(
      SIX_ELEMENT_KEYS.map((key) => ({
        key,
        source: "",
        target: "",
        swappable: key !== "subject",
        note: "",
      })),
    ),
  /** 换皮不换骨风险提示（如只换道具不换结构） */
  skinOnlyRisk: z.boolean().default(false),
});
export type SixElementsMapping = z.infer<typeof SixElementsMappingSchema>;

export function defaultSixElementsMapping(
  degree: "once" | "twice" = "once",
): SixElementsMapping {
  return SixElementsMappingSchema.parse({
    degree,
    rows: SIX_ELEMENT_KEYS.map((key) => ({
      key,
      source: "",
      target: "",
      // 一度：不换核心事件；主体通常少换
      swappable:
        degree === "once" ? key !== "event" && key !== "subject" : key !== "subject",
      note:
        degree === "once" && key === "event"
          ? "一度置换：核心事件保持不变"
          : degree === "twice" && key === "event"
            ? "二度置换：必须替换核心事件"
            : "",
    })),
  });
}

/* ───────────────────── 3.md：洗稿分段迭代（定基调） ───────────────────── */

export const WashSegmentSchema = z.object({
  index: z.number().int().min(0),
  sourceExcerpt: z.string().default(""),
  output: z.string().default(""),
  /** 第一步锁定后，后续段继承 */
  inheritsBaseTone: z.boolean().default(true),
  done: z.boolean().default(false),
});
export type WashSegment = z.infer<typeof WashSegmentSchema>;

export const WashSegmentWorkflowSchema = z.object({
  /** 第一步定基调：字数、节奏、风格一致；人物可换名/职业 */
  baseTonePrompt: z
    .string()
    .default("核心点：字数、节奏、风格保持一致。人物可以换（换名字或换职业）。"),
  baseToneLocked: z.boolean().default(false),
  baseToneOutput: z.string().default(""),
  /** 人设仅作 AI 校验，洗稿通常不改正设定 */
  characterCheckNames: z.array(z.string()).default([]),
  /** 原文预处理：建议 ≤2 万字；每段 1500～3000 */
  sourceWordCap: z.number().int().default(20000),
  segmentMaxChars: z.number().int().default(3000),
  segments: z.array(WashSegmentSchema).default([]),
  /** 查看 AI 思考过程（人工勾选确认） */
  reviewedThinking: z.boolean().default(false),
  /** 关联 StyleExtract purpose=wash，不重复文风字段 */
  notes: z.string().default(""),
});
export type WashSegmentWorkflow = z.infer<typeof WashSegmentWorkflowSchema>;

/* ───────────────────── 3.md：节奏量化（与 GenerationPolicy 并存） ───────────────────── */

/**
 * 短篇通用节奏目标（3.md）。
 * 注意：GenerationPolicy 管「单次 AI 输出带宽」；RhythmQuant 管「整篇故事节奏目标」。
 */
export const RhythmQuantSchema = z.object({
  targetChapters: z.number().int().default(12),
  charsPerChapter: z.number().int().default(800),
  plotPointsPerChapterMin: z.number().int().default(6),
  plotPointsPerChapterMax: z.number().int().default(8),
  charsPerPlotPointMin: z.number().int().default(50),
  charsPerPlotPointMax: z.number().int().default(200),
  /** 实际统计（拆书/成稿后填） */
  actualChapters: z.number().int().optional(),
  actualPlotPointsPerChapter: z.array(z.number().int()).default([]),
  notes: z.string().default(""),
});
export type RhythmQuant = z.infer<typeof RhythmQuantSchema>;

export const DEFAULT_RHYTHM_QUANT: RhythmQuant = {
  targetChapters: 12,
  charsPerChapter: 800,
  plotPointsPerChapterMin: 6,
  plotPointsPerChapterMax: 8,
  charsPerPlotPointMin: 50,
  charsPerPlotPointMax: 200,
  actualPlotPointsPerChapter: [],
  notes: "",
};

/* ───────────────────── 3.md：情绪上下行对照 ───────────────────── */

export const EmotionSlopeSchema = z.enum(["up", "down", "flat"]);
export type EmotionSlope = z.infer<typeof EmotionSlopeSchema>;

export const EMOTION_SLOPE_LABELS: Record<EmotionSlope, string> = {
  up: "上行（正向）",
  down: "下行（负向）",
  flat: "平",
};

export const EmotionSlopeCompareItemSchema = z.object({
  chapterNo: z.number().int(),
  sourceSlope: EmotionSlopeSchema.default("flat"),
  sourceNote: z.string().default(""),
  newSlope: EmotionSlopeSchema.default("flat"),
  newNote: z.string().default(""),
  /** 斜率不一致则偏离 */
  aligned: z.boolean().default(true),
  regenerated: z.boolean().default(false),
});
export type EmotionSlopeCompareItem = z.infer<typeof EmotionSlopeCompareItemSchema>;

export const EmotionSlopeCompareSchema = z.object({
  items: z.array(EmotionSlopeCompareItemSchema).default([]),
  /** 仿的重点是情绪，不要偏 */
  principleNote: z
    .string()
    .default("仿写重点是情绪起伏方式与原文对应（上行/下行），偏离则重新生成该节点。"),
});
export type EmotionSlopeCompare = z.infer<typeof EmotionSlopeCompareSchema>;

/* ───────────────────── 3.md：拆书四层 + 有效情节点互校 ───────────────────── */

/** 叠在 DissectParamsBody 之上的四层目的，不重复 11 项字段 */
export const DissectFourLayersSchema = z.object({
  comprehensiveDone: z.boolean().default(false), // 综合→故事梗概
  chapterOutlineDone: z.boolean().default(false), // 章纲→故事线
  beatAndRhythmDone: z.boolean().default(false), // 细纲+节奏→有效情节点
  characterDone: z.boolean().default(false), // 人设按需
  /** 有效情节点：删了故事就断 */
  effectivePlotPoints: z
    .array(
      z.object({
        chapterNo: z.number().int(),
        beatNo: z.number().int().optional(),
        text: z.string().default(""),
        whyCritical: z.string().default(""), // 推动主线/改变人物/引爆或解决冲突
      }),
    )
    .default([]),
  /** 细纲与节奏两遍互校 */
  crossCheckNote: z.string().default(""),
  crossCheckPassed: z.boolean().nullable().default(null),
});
export type DissectFourLayers = z.infer<typeof DissectFourLayersSchema>;

/* ───────────────────── 3.md：人物三位一体 + 三字经 ───────────────────── */

export const CharacterTrinitySchema = z.object({
  name: z.string().default(""),
  role: z.enum(["protagonist", "supporting", "extra"]).default("protagonist"),
  background: z.string().default(""),
  personality: z.string().default(""),
  behavior: z.string().default(""),
  /** 反差记忆点 */
  contrast: z.string().default(""),
  /** 背景→性格→行为是否自洽 */
  trinityOk: z.boolean().nullable().default(null),
});
export type CharacterTrinity = z.infer<typeof CharacterTrinitySchema>;

export const CharacterSanzijingSchema = z.object({
  /** 人物皮加缺点 */
  skinPlusFlaw: z.string().default(""),
  /** 配角弱加特征 */
  supportingTrait: z.string().default(""),
  /** 显身份，服饰定 */
  identityViaCostume: z.string().default(""),
  /** 微起伏，写成长 */
  microGrowth: z.string().default(""),
  /** 记忆点口头禅 */
  catchphrase: z.string().default(""),
});
export type CharacterSanzijing = z.infer<typeof CharacterSanzijingSchema>;

/* ───────────────────── 3.md：质检优先级 ───────────────────── */

export const QcPriorityItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  done: z.boolean().default(false),
  note: z.string().default(""),
});
export type QcPriorityItem = z.infer<typeof QcPriorityItemSchema>;

export const QcPriorityChecklistSchema = z.object({
  /** P1 致命：逻辑/人设/核心矛盾——AI 可辅约 90%；4.md 挂载期待感+矛盾子项 */
  p1Framework: z
    .array(QcPriorityItemSchema)
    .default([
      { id: "logic", label: "逻辑自洽", done: false, note: "" },
      { id: "character_break", label: "人设未崩", done: false, note: "" },
      { id: "core_conflict", label: "核心矛盾/设定成立", done: false, note: "" },
      { id: "mainline", label: "主线目标清晰且贯穿", done: false, note: "" },
      { id: "world_consistent", label: "世界观自洽（如有）", done: false, note: "" },
      { id: "foreshadow_p1", label: "关键伏笔可回收", done: false, note: "" },
      { id: "expect_1plus3", label: "期待感 1+3 成立（4.md）", done: false, note: "" },
      { id: "conflict_six", label: "冲突六要素齐（4.md）", done: false, note: "" },
      { id: "opening_reveal", label: "开篇亮核心期待（4.md）", done: false, note: "" },
      { id: "anti_deus_ex", label: "无机械降神（4.md）", done: false, note: "" },
    ]),
  /** P2 重点：情绪/节奏/伏笔——必须人工（含 5.md 子项，不另建质检体系） */
  p2EmotionRhythm: z
    .array(QcPriorityItemSchema)
    .default([
      { id: "emotion", label: "情绪走向对（上下行）", done: false, note: "" },
      { id: "rhythm", label: "节奏不拖（章数/情节点密度）", done: false, note: "" },
      { id: "foreshadow", label: "伏笔已收回", done: false, note: "" },
      { id: "show_dont_tell", label: "展示而非告知（无「他感到/他觉得」堆砌）·5.md", done: false, note: "" },
      { id: "three_round", label: "三轮拉扯成立（阻碍递进）·5.md", done: false, note: "" },
      { id: "control_group", label: "以事见人有对照/气氛强化·5.md", done: false, note: "" },
      { id: "pace_zhangchi", label: "张弛交替（禁单调递增/属性飘忽）·5.md", done: false, note: "" },
      { id: "pace_jinhuan", label: "紧缓元素匹配情绪（六要素）·5.md", done: false, note: "" },
      { id: "cool12_stack", label: "cool12 多梗叠加≥2·6.md", done: false, note: "" },
      { id: "face_slap_premise", label: "打脸四前提齐全·6.md", done: false, note: "" },
      { id: "info_gap", label: "信息差矩阵与阶段一致·6.md", done: false, note: "" },
      { id: "immersion_five", label: "代入感五维已诊断·6.md", done: false, note: "" },
      { id: "structure_level_done", label: "结构四层级已判层·8.md", done: false, note: "" },
      { id: "scene_four_render", label: "细纲四描写齐全·8.md", done: false, note: "" },
      { id: "early_forgive", label: "追妻未过早原谅·8.md", done: false, note: "" },
      { id: "intro_200", label: "知乎导语~200字未过塞·9.md", done: false, note: "" },
      { id: "master_beats_11_13", label: "全书故事情节11–13·9.md", done: false, note: "" },
      { id: "visual_sense_check", label: "画面感/五觉处刑验收·9.md", done: false, note: "" },
      { id: "soul_probe", label: "灵魂三问已过·10.md", done: false, note: "" },
      { id: "hand_edit_12", label: "短篇手搓十二步·10.md", done: false, note: "" },
      { id: "foreshadow_recovered", label: "伏笔已回收·10.md", done: false, note: "" },
      { id: "coarse_outline", label: "粗纲已排序·11.md", done: false, note: "" },
      { id: "ep_rhythm", label: "集纲节奏已对齐·11.md", done: false, note: "" },
      { id: "reject_three", label: "拒稿三检·11.md", done: false, note: "" },
      { id: "genre_track", label: "升级/反套路/后悔轨·12.md", done: false, note: "" },
      { id: "benchmark_50k", label: "对标收藏>5万·12.md", done: false, note: "" },
      { id: "adapt_anchor", label: "IP锚定四要素·13.md", done: false, note: "" },
      { id: "unit_cut_tight", label: "单元紧段已筛·13.md", done: false, note: "" },
      { id: "av_verify", label: "视听验证·13.md", done: false, note: "" },
      { id: "female_topic_hazards", label: "女频选题六雷区·14.md", done: false, note: "" },
      { id: "retention_nodes", label: "留存四节点·14.md", done: false, note: "" },
      { id: "eight_reports", label: "八类写前报告·14.md", done: false, note: "" },
      { id: "pace_curve", label: "节奏曲线报告·15.md", done: false, note: "" },
      { id: "female_monetize", label: "女频变现方案·15.md", done: false, note: "" },
      { id: "serial_monitor", label: "连载监控·15.md", done: false, note: "" },
      { id: "koala_rolling", label: "考拉滚动交稿·16.md", done: false, note: "" },
      { id: "act100_tasks", label: "百集四幕任务·17.md", done: false, note: "" },
      { id: "episode_hooks", label: "开场/集尾钩子·17.md", done: false, note: "" },
      { id: "handbook_ep10_verdict", label: "前十能不能用·手册SOP", done: false, note: "" },
      { id: "handbook_script_format", label: "剧本规格闸·手册SOP", done: false, note: "" },
      { id: "handbook_pitch_pack", label: "投稿三块·手册SOP", done: false, note: "" },
      { id: "charlie_beat20_names", label: "查理20拍名对齐·短剧", done: false, note: "" },
      { id: "charlie_revise20", label: "修改20法则·短剧", done: false, note: "" },
      { id: "charlie_product_lock", label: "产品锁三原则·短剧", done: false, note: "" },
    ]),
  /** P3：用词/AI 味/语言——挂 DeAiWorkbench */
  p3Language: z
    .array(QcPriorityItemSchema)
    .default([
      { id: "wording", label: "用词与台词", done: false, note: "" },
      { id: "ai_taste", label: "去 AI 味（见五维精修）", done: false, note: "" },
      { id: "punctuation", label: "标点等细节（影响检测）", done: false, note: "" },
    ]),
  selfReviseRounds: z.number().int().min(0).default(0),
  editorReviseRounds: z.number().int().min(0).default(0),
  /** 改太多=框架有问题 */
  frameworkSuspect: z.boolean().default(false),
  /** 禁止 AI 直出交稿 */
  humanReviewed: z.boolean().default(false),
  selfDissectCompareNote: z.string().default(""),
});
export type QcPriorityChecklist = z.infer<typeof QcPriorityChecklistSchema>;

/* ───────────────────── 换元法七步工作流（3.md 深化；兼容 2.md 薄字段） ───────────────────── */

export const SwapCandidateSchema = z.object({
  id: z.string(),
  summary: z.string(),
  degree: z.enum(["once", "twice"]).default("once"),
  selected: z.boolean().default(false),
  /** 方案级六元素摘要 */
  sixElementsBrief: z.string().default(""),
  background: z.string().default(""),
  event: z.string().default(""),
  prop: z.string().default(""),
  characterRelations: z.string().default(""),
  /** AI 核心事件是否偏老套（人判） */
  eventFeelsStale: z.boolean().nullable().default(null),
  /** 4.md：期待感+矛盾筛选分（人仍选定；低分告警） */
  screenScore: AiCandidateScreenScoreSchema.optional(),
});
export type SwapCandidate = z.infer<typeof SwapCandidateSchema>;

export const BeatSwapBatchItemSchema = z.object({
  chapterNo: z.number().int(),
  done: z.boolean().default(false),
  note: z.string().default(""),
  batchIndex: z.number().int().optional(),
});
export type BeatSwapBatchItem = z.infer<typeof BeatSwapBatchItemSchema>;

export const SwapImitateWorkflowSchema = z.object({
  /** —— 兼容 2.md 薄字段 —— */
  sourceSynopsis: z.string().default(""),
  swapCandidates: z.array(SwapCandidateSchema).default([]),
  selectedSwapId: z.string().nullable().optional(),
  newSynopsis: z.string().default(""),
  chapterOutlineReady: z.boolean().default(false),
  beatSwapProgress: z.array(BeatSwapBatchItemSchema).default([]),

  /** —— 3.md 七步深化 —— */
  method: MethodSpectrumStateSchema.default({}),
  sixElements: SixElementsMappingSchema.default({}),
  fourLayers: DissectFourLayersSchema.default({}),
  wash: WashSegmentWorkflowSchema.optional(),
  rhythmQuant: RhythmQuantSchema.default({}),
  emotionSlope: EmotionSlopeCompareSchema.default({}),
  /** 细纲每批章数：3～5，禁止一次全书 */
  beatBatchSize: z.number().int().min(1).max(5).default(3),
  currentBeatBatch: z.number().int().min(0).default(0),
  /** 填细节：格式锁 + 角色数 */
  formatLock: z
    .enum(["short_novel", "long_novel", "duanju", "manju"])
    .default("short_novel"),
  castCount: z.number().int().min(1).max(12).default(3),
  castMin: z.number().int().default(2),
  castMax: z.number().int().default(6),
  characters: z.array(CharacterTrinitySchema).default([]),
  sanzijing: CharacterSanzijingSchema.default({}),
  /** 写一章改好一章 */
  chapterReviseBeforeNext: z.boolean().default(true),
  chaptersRevised: z
    .array(
      z.object({
        chapterNo: z.number().int(),
        generated: z.boolean().default(false),
        polished: z.boolean().default(false),
        humanRevised: z.boolean().default(false),
      }),
    )
    .default([]),
  qc: QcPriorityChecklistSchema.default({}),
  /** 当前七步进度 1～7 */
  currentStep: z.number().int().min(1).max(7).default(1),
  notes: z.string().default(""),
});
export type SwapImitateWorkflow = z.infer<typeof SwapImitateWorkflowSchema>;

/* ───────────────────── 创作会话检查清单（用户操作全覆盖） ───────────────────── */

export const WorkflowCheckpointSchema = z.object({
  id: z.string(),
  level: OutlineLevelSchema,
  label: z.string(),
  done: z.boolean().default(false),
  blockedReason: z.string().optional(),
  userAction: z.string().default(""), // 用户本步必须做的事
  aiAction: z.string().default(""), // AI 本步可做的事
  displayFields: z.array(z.string()).default([]), // 本步应展示的信息字段
});
export type WorkflowCheckpoint = z.infer<typeof WorkflowCheckpointSchema>;

/** 短篇标准检查点（灵感→总纲→框架→章纲→细纲→初稿→修改） */
export const SHORT_NOVEL_CHECKPOINTS: WorkflowCheckpoint[] = [
  {
    id: "cp_inspiration",
    level: "inspiration",
    label: "灵感 / 故事梗概入口",
    done: false,
    userAction: "明确写什么类型（短篇）、一句话方向；可从热点/拆书/对标进入",
    aiAction: "可扩写灵感候选，但由人筛选",
    displayFields: ["format", "genreTags", "logline", "source"],
  },
  {
    id: "cp_dissect",
    level: "inspiration",
    label: "拆书（参数）",
    done: false,
    userAction: "明确拆书目的→按单元故事拆→校对 AI 结果→提取核心梗",
    aiAction: "按 11 项参数模板输出；七步法反向验证稿",
    displayFields: [
      "purpose",
      "basic",
      "expectations",
      "setting",
      "storyline",
      "conflicts",
      "emotionCurve",
      "relationships",
      "twists",
      "qiChengZhuanHe",
      "sevenSteps",
      "rhythmStyle",
      "unitStories",
      "extractedHooks",
      "proofread",
    ],
  },
  {
    id: "cp_swap",
    level: "inspiration",
    label: "换元（可选）",
    done: false,
    userAction: "从多个换元方案中人工选定一个，不让 AI 乱选",
    aiAction: "出多个换元方案供人选择",
    displayFields: ["swapCandidates", "newSynopsis", "degree"],
  },
  {
    id: "cp_master",
    level: "master",
    label: "总纲（故事梗概）",
    done: false,
    userAction: "确认故事梗概可读、有因果；大期待/小期待写清；挂载 4.md 期待感+矛盾九步",
    aiAction: "在规则+指令约束下生成梗概候选",
    displayFields: [
      "logline",
      "bigExpectation",
      "smallExpectations",
      "coreConflictOneLiner",
      "pairingSummary",
      "screenScoreSummary",
    ],
  },
  {
    id: "cp_framework",
    level: "framework",
    label: "框架（人设·文风）",
    done: false,
    userAction: "短篇可省世界观/力量体系/势力/金手指；文风与角色通常必填",
    aiAction: "按省略标记生成设定包",
    displayFields: ["charactersBrief", "styleRules", "omit", "worldview", "goldFinger"],
  },
  {
    id: "cp_chapter",
    level: "chapter",
    label: "章纲",
    done: false,
    userAction: "按单元故事排列故事线；短篇无卷纲",
    aiAction: "输出章节故事线与集/章尾钩",
    displayFields: ["chapters", "unitStories", "hooks"],
  },
  {
    id: "cp_beat",
    level: "beat",
    label: "细纲",
    done: false,
    userAction: "最小单元情节：事件→因果→变化；用情节点个数控长",
    aiAction: "按情节点个数展开细纲，禁止一次全书",
    displayFields: ["beats", "plotPointCount", "emotionDelta"],
  },
  {
    id: "cp_draft",
    level: "draft",
    label: "正文初稿",
    done: false,
    userAction: "分段生成，每次约 2000～3000 字；验收情节点是否写全",
    aiAction: "按细纲与控长策略生成",
    displayFields: ["chunkMode", "plotPointCount", "minChars", "maxChars", "manuscript"],
  },
  {
    id: "cp_revise",
    level: "revise",
    label: "修改（节奏·情绪）",
    done: false,
    userAction: "仿写仿的是节奏和情绪；人工判断输出好坏",
    aiAction: "按情绪曲线/节奏报告提示修改点",
    displayFields: ["emotionCurve", "rhythm", "qc"],
  },
];

/** 3.md 换元七步检查点（与 SHORT_NOVEL_CHECKPOINTS 并存） */
export const SWAP_SEVEN_STEP_CHECKPOINTS: WorkflowCheckpoint[] = [
  {
    id: "swap_goal",
    level: "inspiration",
    label: "1.定目标（类型+一度/二度）",
    done: false,
    userAction: "选类型、一度或二度、入门题材（爽文/甜文优先）；新人默认一度",
    aiAction: "可给题材偏好提示，不替人选定置换度",
    displayFields: ["methodSpectrum", "degree", "genrePreference", "avoidSciFi"],
  },
  {
    id: "swap_dissect",
    level: "inspiration",
    label: "2.拆模板（四层+有效情节点）",
    done: false,
    userAction: "确认综合/章纲/细纲+节奏/人设四层；互校有效情节点（复用 11 项产物）",
    aiAction: "细纲与节奏同步拆两遍供人比对",
    displayFields: ["fourLayers", "effectivePlotPoints", "crossCheck"],
  },
  {
    id: "swap_layer",
    level: "inspiration",
    label: "3.分层置换（方案人选）",
    done: false,
    userAction: "从多方案中 radio 选定；审核核心事件是否老套；填六元素映射",
    aiAction: "出 ≥3 方案（可强制不要科幻）；选定后出新梗概",
    displayFields: ["sixElements", "candidates", "selectedSwapId", "newSynopsis"],
  },
  {
    id: "swap_structure",
    level: "chapter",
    label: "4.搭结构（章纲→细纲批次）",
    done: false,
    userAction: "改章纲后每批 3～5 章改细纲；逐章标上下行；偏离则重生",
    aiAction: "按方案改章纲/细纲，禁止一次全书细纲",
    displayFields: ["chapterOutline", "beatBatches", "emotionSlopeCompare", "beatBatchSize"],
  },
  {
    id: "swap_details",
    level: "framework",
    label: "5.填细节（格式·角色）",
    done: false,
    userAction: "选对格式；短篇省略世界观等；配 2～6 人；三位一体+三字经自查",
    aiAction: "按 omit 与角色表填框架",
    displayFields: ["formatLock", "omitFlags", "castSize", "characterTrinity", "sanzijing"],
  },
  {
    id: "swap_body",
    level: "draft",
    label: "6.写正文（写一章改一章）",
    done: false,
    userAction: "逐章生成→润色→改好再下一章；字数偏多做减法",
    aiAction: "按细纲生成；可附润色与短篇通用要求",
    displayFields: ["chapterReviseBeforeNext", "chaptersRevised", "polishNotes"],
  },
  {
    id: "swap_qc",
    level: "revise",
    label: "7.修稿质检（P1→P2→P3）",
    done: false,
    userAction: "按优先级修；控制次数；人工确认非 AI 直出；可选自拆对照",
    aiAction: "框架性问题可检约 90%；情绪节奏交人；P3 去 AI 味",
    displayFields: ["qcPriority", "reviseRoundCount", "selfDissectCompare"],
  },
];

/** 4.md 期待感+矛盾九步检查点（与 SHORT_NOVEL / SWAP 检查点并存） */
export const EXPECTATION_CONFLICT_CHECKPOINTS: WorkflowCheckpoint[] = [
  {
    id: "ec_synopsis",
    level: "master",
    label: "1.故事梗概",
    done: false,
    userAction: "确认一句话/梗概可读；可先筛换元方案再定「有没有得写」",
    aiAction: "出梗概候选；不替人判定好坏",
    displayFields: ["logline", "synopsis", "screenScore"],
  },
  {
    id: "ec_core_expect",
    level: "master",
    label: "2.核心期待",
    done: false,
    userAction: "写清主角目标；远打底近拉满；分解子目标与具体获得",
    aiAction: "可建议近期待落地，人不改目标不推进",
    displayFields: ["core", "farNearStrategy", "subGoals", "concreteGains"],
  },
  {
    id: "ec_core_conflict",
    level: "master",
    label: "3.核心矛盾",
    done: false,
    userAction: "按六要素设计；标竞争/敌对、内/外；禁合作共赢",
    aiAction: "可检六要素缺项，不替人写绝路",
    displayFields: ["conflictDesign", "sixChecklist"],
  },
  {
    id: "ec_1plus3",
    level: "master",
    label: "4.拆1+3",
    done: false,
    userAction: "填满核心+三小钩；小钩≤1000；短篇禁支线",
    aiAction: "可从梗概拆三轮拉扯候选",
    displayFields: ["design1Plus3", "noSidePlot"],
  },
  {
    id: "ec_pairing",
    level: "master",
    label: "5.期待↔矛盾配对",
    done: false,
    userAction: "核对核心↔核心、小钩↔矛盾ABC 一一对应",
    aiAction: "标出未配对项",
    displayFields: ["pairing"],
  },
  {
    id: "ec_upgrade",
    level: "master",
    label: "6.冲突升级",
    done: false,
    userAction: "选单/多事件；填 2～3 级；勾链条不断；被动捅马蜂窝",
    aiAction: "可扩升级步骤草案",
    displayFields: ["upgradeMode", "upgradeSteps", "chainUnbroken"],
  },
  {
    id: "ec_cool_reverse",
    level: "chapter",
    label: "7.爽点反推钩子",
    done: false,
    userAction: "先写爽点再反推钩子；填四步+三类情绪链；可追加伏笔台账",
    aiAction: "可建议钩子，人确认后写入",
    displayFields: ["coolPoint", "fourStep", "emotionChain3", "reverseHooks"],
  },
  {
    id: "ec_opening",
    level: "draft",
    label: "8.开篇门禁",
    done: false,
    userAction: "勾 300～500 / 2000～3000；可加时间与危机",
    aiAction: "可检测开篇是否亮核心期待",
    displayFields: ["goldChapterChars", "openingRevealByChars", "timeCrisis"],
  },
  {
    id: "ec_revise",
    level: "revise",
    label: "9.改稿清单",
    done: false,
    userAction: "按期待感+矛盾 check 逐项勾；中期代入期待",
    aiAction: "可跑 struct.expectation 诊断",
    displayFields: ["reviseChecklist", "midImmersion"],
  },
];

/** 完成度：拆书参数 11 项哪些已填 */
export function dissectParamsCompleteness(body: DissectParamsBody): {
  filled: number;
  total: number;
  missing: string[];
  pct: number;
} {
  const checks: [string, boolean][] = [
    ["基本信息", Boolean(body.basic.synopsis.trim() || body.basic.genre.trim())],
    ["期待感", Boolean(body.expectations.big.trim() || body.expectations.small.length)],
    ["故事设定", Boolean(body.setting.background.trim() || body.setting.protagonist.trim())],
    ["故事脉络", Boolean(body.storyline.coreContent.trim())],
    ["核心冲突", body.conflicts.length > 0],
    ["情绪曲线", body.emotionCurve.length > 0],
    ["人物关系", body.relationships.length > 0],
    ["故事反转", body.twists.length > 0],
    [
      "起承转合",
      Boolean(
        body.qiChengZhuanHe.qi.trim() ||
          body.qiChengZhuanHe.cheng.trim() ||
          body.qiChengZhuanHe.zhuan.trim() ||
          body.qiChengZhuanHe.he.trim(),
      ),
    ],
    [
      "七步法",
      Boolean(
        body.sevenSteps.goal.trim() ||
          body.sevenSteps.obstacle.trim() ||
          body.sevenSteps.ending.trim(),
      ),
    ],
    [
      "整体节奏/风格",
      Boolean(body.rhythmStyle.rhythm.trim() || body.rhythmStyle.style.trim()),
    ],
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([name]) => name);
  const filled = checks.length - missing.length;
  return {
    filled,
    total: checks.length,
    missing,
    pct: Math.round((filled / checks.length) * 100),
  };
}

/** 故事七步法完成度 */
export function unitSevenStepsCompleteness(steps: UnitSevenSteps): {
  filled: number;
  total: number;
  missing: string[];
  earlySuccessRisk: boolean;
} {
  const missing = UNIT_SEVEN_STEP_IDS.filter((id) => !steps[id].trim()).map(
    (id) => UNIT_SEVEN_STEP_LABELS[id],
  );
  const earlySuccessRisk =
    Boolean(steps.result.trim()) &&
    /成功|顺利|轻易|马上|立刻成功/.test(steps.result) &&
    !steps.accident.trim();
  return {
    filled: UNIT_SEVEN_STEP_IDS.length - missing.length,
    total: UNIT_SEVEN_STEP_IDS.length,
    missing,
    earlySuccessRisk,
  };
}

/** 六元素映射完成度 */
export function sixElementsCompleteness(m: SixElementsMapping): {
  filled: number;
  total: number;
  missing: string[];
  degreeConflict: boolean;
  pct: number;
} {
  const missing: string[] = [];
  for (const row of m.rows) {
    const label = SIX_ELEMENT_LABELS[row.key];
    if (!row.source.trim()) missing.push(`${label}·原文`);
    if (row.swappable && !row.target.trim()) missing.push(`${label}·置换`);
  }
  const eventRow = m.rows.find((r) => r.key === "event");
  /** 二度必须换事件；一度不应把事件标成可换且已填成不同 */
  const degreeConflict =
    (m.degree === "twice" && eventRow && !eventRow.target.trim()) ||
    (m.degree === "once" && eventRow?.swappable === true && Boolean(eventRow.target.trim()));
  const total = m.rows.length * 2;
  const filled = total - missing.length;
  return {
    filled: Math.max(0, filled),
    total,
    missing,
    degreeConflict: Boolean(degreeConflict),
    pct: Math.round((Math.max(0, filled) / total) * 100),
  };
}

/** 节奏量化：是否相对默认目标有偏离提示 */
export function rhythmQuantCompleteness(r: RhythmQuant): {
  ok: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (r.actualChapters != null && Math.abs(r.actualChapters - r.targetChapters) > 3) {
    warnings.push(`章数 ${r.actualChapters} 偏离目标 ${r.targetChapters}`);
  }
  for (const n of r.actualPlotPointsPerChapter) {
    if (n < r.plotPointsPerChapterMin || n > r.plotPointsPerChapterMax) {
      warnings.push(`某章情节点 ${n} 不在 ${r.plotPointsPerChapterMin}～${r.plotPointsPerChapterMax}`);
      break;
    }
  }
  return { ok: warnings.length === 0, warnings };
}

/** 情绪上下行对照 */
export function emotionSlopeCompleteness(c: EmotionSlopeCompare): {
  total: number;
  aligned: number;
  misaligned: number;
  misalignedChapters: number[];
} {
  const misalignedChapters = c.items.filter((i) => !i.aligned).map((i) => i.chapterNo);
  return {
    total: c.items.length,
    aligned: c.items.filter((i) => i.aligned).length,
    misaligned: misalignedChapters.length,
    misalignedChapters,
  };
}

/** 质检优先级完成度 */
export function qcPriorityCompleteness(q: QcPriorityChecklist): {
  p1: { filled: number; total: number };
  p2: { filled: number; total: number };
  p3: { filled: number; total: number };
  frameworkSuspect: boolean;
  readyToSubmit: boolean;
} {
  const count = (items: QcPriorityItem[]) => ({
    filled: items.filter((i) => i.done).length,
    total: items.length,
  });
  const p1 = count(q.p1Framework);
  const p2 = count(q.p2EmotionRhythm);
  const p3 = count(q.p3Language);
  const tooManyRounds = q.selfReviseRounds >= 4 || q.editorReviseRounds >= 5;
  const frameworkSuspect = q.frameworkSuspect || tooManyRounds;
  const readyToSubmit =
    p1.filled === p1.total &&
    p2.filled === p2.total &&
    q.humanReviewed &&
    !frameworkSuspect;
  return { p1, p2, p3, frameworkSuspect, readyToSubmit };
}

/** 换元七步整体完成度 */
export function swapImitateCompleteness(wf: SwapImitateWorkflow): {
  step: number;
  filledSteps: number;
  totalSteps: number;
  missing: string[];
  canAdvance: boolean;
} {
  const missing: string[] = [];
  const stepDone: boolean[] = [];

  // 1 定目标
  stepDone[0] = Boolean(wf.method.preferredDegree && wf.method.genrePreference);
  if (!stepDone[0]) missing.push("定目标");

  // 2 拆模板四层（至少综合+细纲节奏）
  stepDone[1] =
    wf.fourLayers.comprehensiveDone &&
    wf.fourLayers.beatAndRhythmDone &&
    wf.fourLayers.crossCheckPassed !== false;
  if (!stepDone[1]) missing.push("拆模板四层/互校");

  // 3 人选方案 + 新梗概
  stepDone[2] = Boolean(wf.selectedSwapId && wf.newSynopsis.trim());
  if (!stepDone[2]) missing.push("选定换元方案");

  // 4 章纲 + 细纲进度
  const beatsDone =
    wf.beatSwapProgress.length > 0 && wf.beatSwapProgress.every((b) => b.done);
  stepDone[3] = wf.chapterOutlineReady && beatsDone;
  if (!stepDone[3]) missing.push("章纲/细纲批次");

  // 5 格式与角色
  const castOk = wf.castCount >= wf.castMin && wf.castCount <= wf.castMax;
  stepDone[4] = wf.formatLock === "short_novel" ? castOk : castOk;
  if (!castOk) missing.push("角色人数 2～6");

  // 6 写一章改一章
  const chaptersOk =
    wf.chaptersRevised.length === 0 ||
    wf.chaptersRevised.every((c) => !c.generated || c.humanRevised);
  stepDone[5] = chaptersOk && wf.chapterReviseBeforeNext;
  if (!chaptersOk) missing.push("存在未改好的已生成章");

  // 7 质检
  const qc = qcPriorityCompleteness(wf.qc);
  stepDone[6] = qc.readyToSubmit;
  if (!stepDone[6]) missing.push("质检未达可交稿");

  const filledSteps = stepDone.filter(Boolean).length;
  return {
    step: wf.currentStep,
    filledSteps,
    totalSteps: 7,
    missing,
    canAdvance: filledSteps < 7,
  };
}

/** 4.md：1+3 完成度 */
export function expectation1Plus3Completeness(d: ExpectationDesign1Plus3): {
  filled: number;
  total: number;
  missing: string[];
  pct: number;
  smallSlotCount: number;
} {
  const missing: string[] = [];
  if (!d.core.content.trim()) missing.push("核心期待");
  if (!d.core.castAt.trim()) missing.push("核心抛钩位置");
  const smallFilled = d.small.filter((s) => s.content.trim()).length;
  if (smallFilled < 3) missing.push(`小期待槽位 ${smallFilled}/3`);
  d.small.forEach((s, i) => {
    if (s.content.trim() && !s.castAt.trim()) missing.push(`小期待${i + 1}抛钩`);
  });
  if (!d.farNearStrategy.trim()) missing.push("远近策略");
  const total = 5;
  const filled = total - missing.length;
  return {
    filled: Math.max(0, filled),
    total,
    missing,
    pct: Math.round((Math.max(0, filled) / total) * 100),
    smallSlotCount: smallFilled,
  };
}

/** 4.md：冲突六要素完成度 */
export function conflictSixCompleteness(c: ConflictDesign | ConflictSixElementsChecklist): {
  filled: number;
  total: number;
  missing: string[];
  complete: boolean;
} {
  const checklist =
    "six" in c && c.six
      ? c.six
      : (c as ConflictSixElementsChecklist);
  const items = checklist.items?.length
    ? checklist.items
    : CONFLICT_SIX_ELEMENT_IDS.map((id) => ({ id, done: false, evidence: "" }));
  const missing = items
    .filter((i) => !i.done)
    .map((i) => CONFLICT_SIX_ELEMENT_LABELS[i.id as ConflictSixElementId] ?? i.id);
  const filled = items.length - missing.length;
  return {
    filled,
    total: items.length,
    missing,
    complete: missing.length === 0,
  };
}

/** 4.md：期待↔矛盾配对 */
export function pairingCompleteness(
  pairing: ExpectationConflictPairing,
  opts?: { smallExpectCount?: number },
): {
  coreOk: boolean;
  smallOk: boolean;
  missing: string[];
  complete: boolean;
} {
  const missing: string[] = [];
  const coreOk = Boolean(pairing.coreExpectationId.trim() && pairing.coreConflictId.trim());
  if (!coreOk) missing.push("核心期待↔核心矛盾");
  const need = opts?.smallExpectCount ?? 3;
  const okPairs = pairing.smallPairs.filter((p) => p.expectationId.trim() && p.conflictId.trim());
  const smallOk = okPairs.length >= need;
  if (!smallOk) missing.push(`小期待配对 ${okPairs.length}/${need}`);
  return { coreOk, smallOk, missing, complete: coreOk && smallOk };
}

/** 从工作流摘要回写总纲薄字段 */
export function summarizeExpectationConflictToMaster(
  wf: ExpectationConflictWorkflow,
): Pick<
  MasterOutlineBody,
  "logline" | "bigExpectation" | "smallExpectations" | "coreConflictOneLiner" | "pairingSummary" | "screenScoreSummary"
> {
  const coreConflict = wf.conflicts[0];
  const pair = pairingCompleteness(wf.pairing);
  return {
    logline: wf.logline || wf.synopsis.slice(0, 120),
    bigExpectation: wf.design.core.content,
    smallExpectations: wf.design.small.map((s) => s.content).filter(Boolean),
    coreConflictOneLiner: coreConflict?.oneLiner ?? "",
    pairingSummary: pair.complete ? "期待↔矛盾已配对" : `未完成：${pair.missing.join("；")}`,
    screenScoreSummary: "",
  };
}

/** 4.md 九步工作流完成度 */
export function expectationConflictWorkflowCompleteness(wf: ExpectationConflictWorkflow): {
  step: number;
  filledSteps: number;
  totalSteps: number;
  missing: string[];
  canMarkConflictDone: boolean;
  canMarkReverseDone: boolean;
} {
  const missing: string[] = [];
  const stepDone: boolean[] = [];

  // 1 梗概
  stepDone[0] = Boolean(wf.synopsis.trim() || wf.logline.trim());
  if (!stepDone[0]) missing.push("故事梗概");

  // 2 核心期待
  stepDone[1] = Boolean(wf.design.core.content.trim());
  if (!stepDone[1]) missing.push("核心期待");

  // 3 核心矛盾 + 六要素
  const mainConflict = wf.conflicts[0];
  const six = mainConflict ? conflictSixCompleteness(mainConflict) : { complete: false, missing: ["核心矛盾"] };
  stepDone[2] = Boolean(mainConflict?.oneLiner.trim()) && six.complete;
  if (!stepDone[2]) missing.push("核心矛盾/六要素");

  // 4 1+3
  const onePlus3 = expectation1Plus3Completeness(wf.design);
  stepDone[3] = onePlus3.smallSlotCount >= 3 && Boolean(wf.design.core.content.trim());
  if (!stepDone[3]) missing.push("1+3");

  // 5 配对
  const pair = pairingCompleteness(wf.pairing);
  stepDone[4] = pair.complete;
  if (!stepDone[4]) missing.push("期待↔矛盾配对");

  // 6 升级
  const steps = mainConflict?.upgradeSteps.filter((s) => s.trim()) ?? [];
  stepDone[5] =
    Boolean(mainConflict) &&
    steps.length >= 2 &&
    steps.length <= 3 &&
    mainConflict!.chainUnbroken;
  if (!stepDone[5]) missing.push("冲突升级 2～3 级");

  // 7 爽点反推：必须先有爽点才能标 reverseDone
  const cool = wf.coolReverse.coolPointFirst.trim();
  const canMarkReverseDone = Boolean(cool);
  stepDone[6] =
    canMarkReverseDone &&
    wf.coolReverse.reverseDone &&
    Boolean(wf.coolReverse.fourStep.pull.trim());
  if (!stepDone[6]) missing.push("爽点反推钩子");

  // 8 开篇门禁
  stepDone[7] =
    wf.design.openingRevealByChars >= 2000 &&
    wf.design.openingRevealByChars <= 3000 &&
    wf.design.goldChapterChars >= 300 &&
    wf.design.goldChapterChars <= 500;
  if (!stepDone[7]) missing.push("开篇字数门禁");

  // 9 改稿清单至少勾一半或全部
  const reviseDone = wf.reviseChecklist.filter((i) => i.done).length;
  stepDone[8] = reviseDone >= Math.ceil(wf.reviseChecklist.length / 2);
  if (!stepDone[8]) missing.push("改稿清单");

  return {
    step: wf.currentStep,
    filledSteps: stepDone.filter(Boolean).length,
    totalSteps: 9,
    missing,
    canMarkConflictDone: six.complete,
    canMarkReverseDone,
  };
}

/* ───────────────────── 5.md：情绪与节奏 ───────────────────── */

/** 六大核心情绪（爽虐甜约占 80%–90%） */
export const CoreEmotionTypeSchema = z.enum(["爽", "虐", "甜", "燃", "猜", "恐"]);
export type CoreEmotionType = z.infer<typeof CoreEmotionTypeSchema>;

export const CORE_EMOTION_LABELS: Record<CoreEmotionType, string> = {
  爽: "爽（期待被满足；力量/智力/身份）",
  虐: "虐（痛苦压抑遗憾；外虐/内虐）",
  甜: "甜（情感/陪伴/治愈；纯糖/半糖）",
  燃: "燃（须绑定爽；不可单独成核）",
  猜: "猜·悬疑（新手劝阻；难写高稿费）",
  恐: "恐·恐怖（平台限制多；灵异禁鬼神）",
};

export const ShuangSubtypeSchema = z.enum(["力量型", "智力型", "身份型"]);
export type ShuangSubtype = z.infer<typeof ShuangSubtypeSchema>;

export const NueSubtypeSchema = z.enum(["外虐", "内虐"]);
export type NueSubtype = z.infer<typeof NueSubtypeSchema>;

export const TianSubtypeSchema = z.enum(["情感向", "陪伴向", "治愈向"]);
export type TianSubtype = z.infer<typeof TianSubtypeSchema>;

export const TianSugarModeSchema = z.enum(["纯糖", "半糖"]);
export type TianSugarMode = z.infer<typeof TianSugarModeSchema>;

/** 对主角伤害程度 → 判定爽/虐/甜（比结局更准） */
export const ProtagonistHarmLevelSchema = z.enum([
  "none_irreversible", // 无不可逆 → 偏爽
  "possible_irreversible", // 可能不可逆 → 偏虐
  "almost_none", // 几乎无伤害 → 偏甜
  "mixed", // 交织 → 爽虐结合
]);
export type ProtagonistHarmLevel = z.infer<typeof ProtagonistHarmLevelSchema>;

export const PROTAGONIST_HARM_LABELS: Record<ProtagonistHarmLevel, string> = {
  none_irreversible: "不产生不可逆后果（顶多嘴炮）→ 偏爽",
  possible_irreversible: "可能不可逆（断肢/抑郁等）→ 偏虐",
  almost_none: "几乎无伤害 → 偏甜",
  mixed: "爽虐交织无明显单一特征 → 爽虐结合",
};

export const WorkGenreLabelSchema = z.enum([
  "纯爽",
  "纯虐",
  "纯甜",
  "爽虐结合",
  "爽燃",
  "甜虐",
  "未判定",
]);
export type WorkGenreLabel = z.infer<typeof WorkGenreLabelSchema>;

export function classifyWorkGenreByHarm(
  harm: ProtagonistHarmLevel,
  core?: CoreEmotionType | null,
): WorkGenreLabel {
  if (core === "燃") return "爽燃";
  if (harm === "mixed") return "爽虐结合";
  if (harm === "none_irreversible") return "纯爽";
  if (harm === "possible_irreversible") return "纯虐";
  if (harm === "almost_none") return "纯甜";
  return "未判定";
}

export const EmotionAnchorSchema = z.object({
  core: CoreEmotionTypeSchema.default("爽"),
  shuangSubtype: ShuangSubtypeSchema.optional(),
  nueSubtype: NueSubtypeSchema.optional(),
  tianSubtype: TianSubtypeSchema.optional(),
  tianSugarMode: TianSugarModeSchema.optional(),
  /** 主角当前情绪状态（锚定说明） */
  protagonistState: z.string().default(""),
  harmLevel: ProtagonistHarmLevelSchema.default("none_irreversible"),
  genreLabel: WorkGenreLabelSchema.default("未判定"),
  /** 新手默认锁单一核心；组合类型需显式解锁 */
  noviceSingleCoreLocked: z.boolean().default(true),
  /** 燃必须绑定爽 */
  ranBoundToShuang: z.boolean().default(false),
  secondaryEmotions: z.array(CoreEmotionTypeSchema).default([]),
  note: z.string().default(""),
});
export type EmotionAnchor = z.infer<typeof EmotionAnchorSchema>;

/** 燃单独成核 → 拦截 */
export function validateRanBoundToShuang(anchor: EmotionAnchor): {
  ok: boolean;
  warning: string;
} {
  if (anchor.core === "燃" && !anchor.ranBoundToShuang) {
    return { ok: false, warning: "燃不能单独成核，须绑定爽（勾选 ranBoundToShuang）" };
  }
  if (
    anchor.noviceSingleCoreLocked &&
    anchor.secondaryEmotions.length > 0 &&
    !(anchor.core === "燃" && anchor.ranBoundToShuang)
  ) {
    return {
      ok: false,
      warning: "新手路径锁定单一核心；组合类型请先关闭 noviceSingleCoreLocked",
    };
  }
  return { ok: true, warning: "" };
}

export const EmotionPayloadSchema = z.object({
  verbal: z.string().default(""), // 台词 / 描述性文字
  nonverbalAction: z.string().default(""), // 肢体动作
  nonverbalReaction: z.string().default(""), // 精神反应
  nonverbalOs: z.string().default(""), // 内部感觉 / OS
  inferredEmotion: z.string().default(""),
});
export type EmotionPayload = z.infer<typeof EmotionPayloadSchema>;

export const ShowDontTellHitSchema = z.object({
  excerpt: z.string().default(""),
  pattern: z.string().default(""), // 他感到 / 他觉得 …
  rewrite: z.string().default(""),
  fixed: z.boolean().default(false),
});
export type ShowDontTellHit = z.infer<typeof ShowDontTellHitSchema>;

export const ShowDontTellScanSchema = z.object({
  hits: z.array(ShowDontTellHitSchema).default([]),
  scanned: z.boolean().default(false),
  note: z
    .string()
    .default("审稿时专门搜索「他感到」「他觉得」；出现则重点检查是否告知。"),
});
export type ShowDontTellScan = z.infer<typeof ShowDontTellScanSchema>;

export const SentenceTensionSchema = z.enum(["short_tense", "long_calm", "mixed"]);
export type SentenceTension = z.infer<typeof SentenceTensionSchema>;

export const AtmospherePolaritySchema = z.enum(["positive", "negative", "mixed"]);
export type AtmospherePolarity = z.infer<typeof AtmospherePolaritySchema>;

/** 单场以事见人（≠ 4.md EmotionChain3） */
export const EmotionSceneBeatSchema = z.object({
  id: z.string().default(""),
  sceneLabel: z.string().default(""),
  /** 主角反应：动作/神态/语言/心理——必须有 */
  protagonistReaction: z.string().default(""),
  controlGroup: z.string().default(""), // 对照组/参照物
  atmosphereGroup: z.string().default(""), // 气氛组旁观评论
  atmospherePolarity: AtmospherePolaritySchema.default("mixed"),
  environmentCue: z.string().default(""),
  causeBeforeEffect: z.string().default(""), // 前因
  subtext: z.string().default(""),
  actionMemoryPoint: z.string().default(""),
  actionPurpose: z.string().default(""),
  appearanceAsMood: z.string().default(""),
  sensoryRecall: z.string().default(""),
  countdownTimer: z.string().default(""),
  sentenceTension: SentenceTensionSchema.default("mixed"),
  payload: EmotionPayloadSchema.default({}),
  intensityWarn: z.boolean().default(false), // 缺对照/气氛时强度可能不足
});
export type EmotionSceneBeat = z.infer<typeof EmotionSceneBeatSchema>;

export const SeePersonThroughEventSchema = z.object({
  scenes: z.array(EmotionSceneBeatSchema).default([]),
  principleNote: z
    .string()
    .default(
      "以事见人：主角反应必须有；对照组与气氛组强化情绪强度。本结构是场景写法，非 4.md 三类情绪链。",
    ),
});
export type SeePersonThroughEvent = z.infer<typeof SeePersonThroughEventSchema>;

export const PullRoundSchema = z.object({
  index: z.number().int().min(1).max(3),
  partialSatisfy: z.string().default(""),
  obstacle: z.string().default(""),
  /** 阻碍强度 1–10，须相对前一轮单调不减 */
  obstacleLevel: z.number().int().min(1).max(10).default(1),
  resolveOrFake: z.string().default(""),
  escalate: z.string().default(""),
  expectationNote: z.string().default(""),
  emotionNote: z.string().default(""),
});
export type PullRound = z.infer<typeof PullRoundSchema>;

export const PullOutcomeSchema = z.enum(["overpay", "fallthrough"]);
export type PullOutcome = z.infer<typeof PullOutcomeSchema>;

export const ReplayAmplifyModeSchema = z.enum(["升华", "留白", "未定"]);
export type ReplayAmplifyMode = z.infer<typeof ReplayAmplifyModeSchema>;

/** 铺垫 → 引爆 → 宣泄（与 1+3 / 七步法同构，不另造期待系统） */
export const ThreeRoundPullFormulaSchema = z.object({
  isomorphicNote: z
    .string()
    .default("与 4.md 的 1+3、七步法、三幕式同构：铺垫建预期 → 引爆 → 宣泄满足或落空。"),
  gapExpectation: z.string().default(""), // 制造缺口
  linkedExpectationId: z.string().default(""), // 可链 L4
  rounds: z
    .array(PullRoundSchema)
    .default([
      { index: 1, partialSatisfy: "", obstacle: "", obstacleLevel: 3, resolveOrFake: "", escalate: "", expectationNote: "", emotionNote: "" },
      { index: 2, partialSatisfy: "", obstacle: "", obstacleLevel: 6, resolveOrFake: "", escalate: "", expectationNote: "", emotionNote: "" },
      { index: 3, partialSatisfy: "", obstacle: "", obstacleLevel: 9, resolveOrFake: "", escalate: "", expectationNote: "", emotionNote: "" },
    ]),
  outcome: PullOutcomeSchema.default("overpay"),
  /** 虐文核心：主角不认命 */
  refuseFate: z.boolean().default(true),
  villainEnding: VillainEndingSchema.default("undecided"),
  replayAmplify: z.string().default(""),
  replayMode: ReplayAmplifyModeSchema.default("未定"),
  surpriseGain: z.string().default(""), // 爽文意外收获
});
export type ThreeRoundPullFormula = z.infer<typeof ThreeRoundPullFormulaSchema>;

export function validateObstacleEscalation(pull: ThreeRoundPullFormula): {
  ok: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  const levels = pull.rounds
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((r) => r.obstacleLevel);
  for (let i = 1; i < levels.length; i++) {
    if (levels[i]! < levels[i - 1]!) {
      warnings.push(`第 ${i + 1} 轮阻碍强度 ${levels[i]} < 第 ${i} 轮 ${levels[i - 1]}（须单调不减）`);
    }
  }
  return { ok: warnings.length === 0, warnings };
}

export const SceneSixElementSchema = z.enum([
  "环境",
  "人物",
  "心理",
  "语言",
  "动作",
  "感受",
]);
export type SceneSixElement = z.infer<typeof SceneSixElementSchema>;

/** 缓 → 紧 排序 */
export const SCENE_SIX_ELEMENTS_ORDER: SceneSixElement[] = [
  "环境",
  "人物",
  "心理",
  "语言",
  "动作",
  "感受",
];

export const SCENE_SIX_ELEMENT_PACE: Record<SceneSixElement, "缓" | "稍快" | "快"> = {
  环境: "缓",
  人物: "缓",
  心理: "稍快",
  语言: "稍快",
  动作: "快",
  感受: "快",
};

export const ZhangChiKindSchema = z.enum(["tense", "relax"]);
export type ZhangChiKind = z.infer<typeof ZhangChiKindSchema>;

export const ZhangChiUnitSchema = z.object({
  unitLabel: z.string().default(""),
  kind: ZhangChiKindSchema.default("tense"),
  note: z.string().default(""),
});
export type ZhangChiUnit = z.infer<typeof ZhangChiUnitSchema>;

export const PaceStructureSchema = z.object({
  volumeCharsMin: z.number().int().default(100_000),
  volumeCharsMax: z.number().int().default(150_000),
  unitCharsMin: z.number().int().default(10_000),
  unitCharsMax: z.number().int().default(15_000),
  chapterCharsMin: z.number().int().default(2000),
  chapterCharsMax: z.number().int().default(3000),
  normalEventChapters: z.string().default("1-2"),
  climaxEventChapters: z.string().default("3-4"),
  climaxGapChapters: z.string().default("10-15 或 2-3 小节"),
  scriptThreePhases: z.string().default(""), // 剧本可选
  attentionNote: z
    .string()
    .default("章 2000–3000 字约对应阅读 4–5 分钟注意力节奏；开篇/结尾算特殊事件。"),
});
export type PaceStructure = z.infer<typeof PaceStructureSchema>;

export const TightLooseBeatSchema = z.object({
  beatLabel: z.string().default(""),
  targetEmotion: z.string().default(""), // 放松 / 紧张
  selectedElements: z.array(SceneSixElementSchema).default([]),
  mismatchWarned: z.boolean().default(false),
  note: z.string().default(""),
});
export type TightLooseBeat = z.infer<typeof TightLooseBeatSchema>;

export const RhythmFourDimSchema = z.object({
  /** 快慢：结构篇幅 */
  kuaiman: PaceStructureSchema.default({}),
  /** 疏密：嵌入 3.md RhythmQuant，不替换 */
  shumi: RhythmQuantSchema.default({}),
  imitateQuantBrief: z
    .string()
    .default("仿写量化：多少章 × 每章多少字 × 每章多少情节点 × 每节点多少字"),
  /** 张弛：单元之间 */
  zhangChi: z.array(ZhangChiUnitSchema).default([]),
  tenseOverRelax: z.boolean().default(true),
  attributeDriftWarned: z.boolean().default(false),
  monotoneEscalateWarned: z.boolean().default(false),
  /** 紧缓：情节点内部 */
  jinhuan: z.array(TightLooseBeatSchema).default([]),
  fightPipeline: z
    .string()
    .default("环境 → 嘴炮(语言) → 心理 → 开打(动作+感受) → 打完写伤势状态"),
  notes: z.string().default(""),
});
export type RhythmFourDim = z.infer<typeof RhythmFourDimSchema>;

/** 紧张段插入慢元素 → 错配 */
export function validateTightLooseMatch(beat: TightLooseBeat): {
  ok: boolean;
  warning: string;
} {
  const slow: SceneSixElement[] = ["环境", "人物"];
  const isTense = /紧张|激烈|危机|打戏|追杀/.test(beat.targetEmotion);
  const hasSlow = beat.selectedElements.some((e) => slow.includes(e));
  if (isTense && hasSlow) {
    return {
      ok: false,
      warning: "紧张段插入环境/人物细描等慢元素 → 情绪断裂风险",
    };
  }
  return { ok: true, warning: "" };
}

/** 张弛序列：单调递增（全程 tense）→ 情绪透支 */
export function validateZhangChiSequence(units: ZhangChiUnit[]): {
  ok: boolean;
  warnings: string[];
  tenseCount: number;
  relaxCount: number;
} {
  const warnings: string[] = [];
  const tenseCount = units.filter((u) => u.kind === "tense").length;
  const relaxCount = units.filter((u) => u.kind === "relax").length;
  if (units.length >= 3 && relaxCount === 0) {
    warnings.push("单元间全为紧张、无松弛 → 情绪提前透支风险（须正—负—正交替）");
  }
  let streak = 0;
  for (const u of units) {
    if (u.kind === "tense") {
      streak += 1;
      if (streak >= 4) {
        warnings.push("连续 4+ 紧张单元：建议插入日常/温馨松弛");
        break;
      }
    } else {
      streak = 0;
    }
  }
  return {
    ok: warnings.length === 0,
    warnings,
    tenseCount,
    relaxCount,
  };
}

export const HookLeadFourAxesSchema = z.object({
  purposeNote: z
    .string()
    .default("导语目的是吸引往下看，不是堆「最激烈冲突」（无前因则激烈表现不出）。"),
  antiCommonSense: z.string().default(""),
  deepMeaning: z.string().default(""),
  emotionWave: z.string().default(""),
  suspense: z.string().default(""),
  draft: z.string().default(""),
  /** 课上未展示 Prompt 原文，禁止伪造 */
  noFabricatedPrompt: z.boolean().default(true),
});
export type HookLeadFourAxes = z.infer<typeof HookLeadFourAxesSchema>;

export const PlatformEmotionPolicySchema = z.object({
  manjuShuangMain: z.boolean().default(true),
  heiyanShuangNueOnly: z.boolean().default(true),
  fanqieTianScarce: z.boolean().default(true),
  duanjuShuangTianMix: z.boolean().default(true),
  discourageNewbieSuspenseHorrorHeal: z.boolean().default(true),
  danmeiDomesticClosed: z.boolean().default(true),
  lingyiNoGhostGod: z.boolean().default(true),
  hints: z
    .array(z.string())
    .default([
      "漫剧基本以爽文为主",
      "黑岩基本只收爽/虐，不收甜",
      "番茄长篇甜文少；短剧又爽又甜反而多",
      "新手勿先写悬疑/恐/治愈（难、正反馈慢）",
      "耽美向国内不要写；灵异可写但不能出鬼/神",
    ]),
});
export type PlatformEmotionPolicy = z.infer<typeof PlatformEmotionPolicySchema>;

export const BlindWriteDrillSchema = z.object({
  sourceBeat: z.string().default(""),
  verbalDissect: z.string().default(""),
  nonverbalDissect: z.string().default(""),
  environmentDissect: z.string().default(""),
  twistPoint: z.string().default(""),
  blindWrite: z.string().default(""),
  compareNote: z.string().default(""),
  retries: z.number().int().min(0).default(0),
});
export type BlindWriteDrill = z.infer<typeof BlindWriteDrillSchema>;

export const EditorRejectReasonSchema = z.enum([
  "contradiction_weak",
  "expectation_weak",
  "emotion_pull_weak",
  "rhythm_slow",
  "immersion_visual_weak",
]);
export type EditorRejectReason = z.infer<typeof EditorRejectReasonSchema>;

export const EDITOR_REJECT_ROUTE: Record<
  EditorRejectReason,
  { label: string; route: string }
> = {
  contradiction_weak: { label: "矛盾不剧烈", route: "4.md 冲突六要素 / 升级路径" },
  expectation_weak: { label: "期待感不足", route: "4.md 1+3 / 开篇门禁" },
  emotion_pull_weak: { label: "情绪拉扯不行", route: "5.md 三轮拉扯 + 以事见人" },
  rhythm_slow: { label: "节奏太慢", route: "5.md 节奏四维 + 3.md RhythmQuant" },
  immersion_visual_weak: {
    label: "代入弱≈画面不够",
    route: "9.md 五觉/画面感处刑 + 6.md 代入感五维",
  },
};

export const EditorRejectDiagnoseSchema = z.object({
  reasons: z.array(EditorRejectReasonSchema).default([]),
  notes: z.string().default(""),
  fixPlan: z.string().default(""),
});
export type EditorRejectDiagnose = z.infer<typeof EditorRejectDiagnoseSchema>;

export const EmotionRenderCheckItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  done: z.boolean().default(false),
  note: z.string().default(""),
});
export type EmotionRenderCheckItem = z.infer<typeof EmotionRenderCheckItemSchema>;

export const DEFAULT_EMOTION_RENDER_ITEMS: EmotionRenderCheckItem[] = [
  { id: "no_direct", label: "不直白说出情绪；台词有潜台词", done: false, note: "" },
  { id: "action_memory", label: "动作有记忆点、不拖拉、有目的", done: false, note: "" },
  { id: "appearance", label: "外貌可体现情绪（可选）", done: false, note: "" },
  { id: "control_group", label: "尽量有对照组", done: false, note: "" },
  { id: "cause_effect", label: "重要反应前有前因", done: false, note: "" },
  { id: "sensory", label: "感官唤起回忆（可选）", done: false, note: "" },
  { id: "countdown", label: "倒计时危机（可选）", done: false, note: "" },
  { id: "gender_diff", label: "考虑性别/性格差异", done: false, note: "" },
];

export type EmotionCaseSkeleton = {
  id: string;
  title: string;
  kind: "虐三轮" | "爽三轮" | "以事见人" | "节奏范本" | "追妻映射";
  steps: string[];
};

export const EMOTION_CASE_SKELETONS: EmotionCaseSkeleton[] = [
  {
    id: "qingshenshen",
    title: "《情深深雨蒙蒙》虐文三轮",
    kind: "虐三轮",
    steps: [
      "锚定：不配被爱",
      "缺口：何书桓温暖",
      "轮1：部分满足→家人反对",
      "轮2：和好后发现赌约假温暖",
      "轮3：假破局→预期落空",
      "复盘放大；主角不认命",
    ],
  },
  {
    id: "workplace",
    title: "职场逆袭爽文三轮",
    kind: "爽三轮",
    steps: [
      "锚定：打压/房贷/被嘲笑",
      "缺口：玉佩读心术",
      "轮1：小项目搞定",
      "轮2：解决危机发现黑手",
      "轮3：深层能力反击身败名裂",
      "复盘放大+反派下场",
    ],
  },
  {
    id: "gender_bias",
    title: "重男轻女·以事见人",
    kind: "以事见人",
    steps: [
      "女主求礼物勉强得便宜货（反应）",
      "弟弟要贵鞋妈妈卖首饰（对照）",
      "奶奶/邻居正负评论（气氛）",
    ],
  },
  {
    id: "dafeng",
    title: "《大奉打更人》节奏范本",
    kind: "节奏范本",
    steps: ["危机睁眼流开篇", "高信息密度", "单元间一张一弛"],
  },
  {
    id: "taohua",
    title: "《桃花马上请长缨》短篇节奏写长篇",
    kind: "节奏范本",
    steps: ["单章约 1000 字提速", "框架好→IP 可多次改编", "改编是重构"],
  },
  {
    id: "chase_wife",
    title: "追妻虐→毁→追→和 ≡ 三轮公式",
    kind: "追妻映射",
    steps: ["虐", "毁", "追", "和"],
  },
];

export const EmotionRhythmWorkflowSchema = z.object({
  schemaVersion: z.string().default("nines-5.md/1"),
  anchor: EmotionAnchorSchema.default({}),
  platform: PlatformEmotionPolicySchema.default({}),
  pull: ThreeRoundPullFormulaSchema.default({}),
  seePerson: SeePersonThroughEventSchema.default({}),
  showDontTell: ShowDontTellScanSchema.default({}),
  renderChecklist: z
    .array(EmotionRenderCheckItemSchema)
    .default(DEFAULT_EMOTION_RENDER_ITEMS),
  rhythm: RhythmFourDimSchema.default({}),
  hookLead: HookLeadFourAxesSchema.default({}),
  blindWrite: BlindWriteDrillSchema.default({}),
  diagnose: EditorRejectDiagnoseSchema.default({}),
  crisisOpenEye: z.boolean().default(false), // 危机睁眼流开篇
  shortPaceLongForm: z.boolean().default(false), // 短篇节奏写长篇
  currentStep: z.number().int().min(1).max(10).default(1),
  notes: z.string().default(""),
});
export type EmotionRhythmWorkflow = z.infer<typeof EmotionRhythmWorkflowSchema>;

/** 5.md 十步检查点（与 SHORT_NOVEL / SWAP / EXPECTATION_CONFLICT 并存） */
export const EMOTION_RHYTHM_CHECKPOINTS: WorkflowCheckpoint[] = [
  {
    id: "er_anchor",
    level: "master",
    label: "1.锚定核心情绪",
    done: false,
    userAction: "选爽/虐/甜等；填伤害程度与主角状态；看平台提示；新手锁单一",
    aiAction: "可建议类型，人不改锚点不推进",
    displayFields: ["anchor", "harmLevel", "genreLabel", "platformHints"],
  },
  {
    id: "er_gap",
    level: "master",
    label: "2.制造缺口/预期",
    done: false,
    userAction: "写目标或金手指/温暖/希望；可填 L4 期待 id",
    aiAction: "可从梗概建议缺口，人确认",
    displayFields: ["gapExpectation", "linkedExpectationId"],
  },
  {
    id: "er_three_round",
    level: "chapter",
    label: "3.三轮拉扯",
    done: false,
    userAction: "填轮1–3；阻碍强度递增；虐勾不认命",
    aiAction: "可扩拉扯草案；校验递减告警",
    displayFields: ["rounds", "obstacleLevels", "refuseFate"],
  },
  {
    id: "er_see_person",
    level: "beat",
    label: "4.以事见人",
    done: false,
    userAction: "每场填主角反应；尽量加对照+气氛（非 4.md 三类情绪链）",
    aiAction: "可建议对照组",
    displayFields: ["scenes", "protagonistReaction", "controlGroup", "atmosphere"],
  },
  {
    id: "er_show_tell",
    level: "draft",
    label: "5.展示非告知",
    done: false,
    userAction: "扫描告知句；改写；双层拆解台词/非语言",
    aiAction: "可跑 qc.show_dont_tell",
    displayFields: ["tellHits", "rewriteStatus", "payloads"],
  },
  {
    id: "er_render",
    level: "draft",
    label: "6.渲染细则",
    done: false,
    userAction: "勾潜台词/动作目的/先因后果/倒计时等",
    aiAction: "可列缺项",
    displayFields: ["renderChecklist"],
  },
  {
    id: "er_pace_kuaiman",
    level: "framework",
    label: "7.节奏·快慢",
    done: false,
    userAction: "填卷/单元/章目标；高潮章数与间距",
    aiAction: "可对照注意力 2–3k 章长建议",
    displayFields: ["paceStructure"],
  },
  {
    id: "er_pace_shumi",
    level: "chapter",
    label: "8.节奏·疏密",
    done: false,
    userAction: "确认 RhythmQuant（3.md 并存）；填仿写量化结构",
    aiAction: "可统计情节点密度偏离",
    displayFields: ["rhythmQuant", "imitateQuantBrief"],
  },
  {
    id: "er_pace_zhangchi",
    level: "beat",
    label: "9.张弛+紧缓",
    done: false,
    userAction: "排单元松紧；选六要素；禁错配与属性飘忽",
    aiAction: "可检单调递增/错配",
    displayFields: ["zhangChi", "sceneElements", "fightPipeline"],
  },
  {
    id: "er_ending",
    level: "revise",
    label: "10.复盘放大+导语+诊断",
    done: false,
    userAction: "填升华/留白；导语四轴；退稿诊断；回勾 QC P2",
    aiAction: "可建议结尾与导语轴（不伪造 Prompt 原文）",
    displayFields: ["replayAmplify", "hookLead", "diagnose", "qcP2"],
  },
];

export function threeRoundPullCompleteness(pull: ThreeRoundPullFormula): {
  filled: number;
  total: number;
  missing: string[];
  pct: number;
  escalationOk: boolean;
  refuseFateOk: boolean;
} {
  const missing: string[] = [];
  if (!pull.gapExpectation.trim()) missing.push("制造缺口/预期");
  for (const r of pull.rounds) {
    if (!r.partialSatisfy.trim() && !r.obstacle.trim()) {
      missing.push(`第${r.index}轮内容`);
    }
  }
  if (!pull.replayAmplify.trim() && pull.replayMode === "未定") {
    missing.push("复盘放大");
  }
  const esc = validateObstacleEscalation(pull);
  const refuseFateOk = pull.outcome === "fallthrough" ? pull.refuseFate : true;
  if (!esc.ok) missing.push("阻碍递进");
  if (!refuseFateOk) missing.push("虐文须不认命");
  const total = 2 + pull.rounds.length; // gap + rounds + replay roughly
  const filled = Math.max(0, total - missing.length);
  return {
    filled,
    total,
    missing,
    pct: Math.round((filled / total) * 100),
    escalationOk: esc.ok,
    refuseFateOk,
  };
}

export function seePersonCompleteness(see: SeePersonThroughEvent): {
  filled: number;
  total: number;
  missing: string[];
  pct: number;
  intensityWarnings: string[];
  canMarkDone: boolean;
} {
  const missing: string[] = [];
  const intensityWarnings: string[] = [];
  if (see.scenes.length === 0) missing.push("至少一场戏");
  let reactionOk = 0;
  for (const s of see.scenes) {
    if (!s.protagonistReaction.trim()) {
      missing.push(`场景「${s.sceneLabel || s.id || "?"}」缺主角反应`);
    } else {
      reactionOk += 1;
      if (!s.controlGroup.trim() || !s.atmosphereGroup.trim()) {
        intensityWarnings.push(
          `「${s.sceneLabel || s.id}」缺对照或气氛 → 情绪强度可能不足`,
        );
      }
    }
  }
  const total = Math.max(1, see.scenes.length);
  const filled = reactionOk;
  return {
    filled,
    total,
    missing,
    pct: Math.round((filled / total) * 100),
    intensityWarnings,
    canMarkDone: see.scenes.length > 0 && reactionOk === see.scenes.length,
  };
}

export function rhythmFourDimCompleteness(r: RhythmFourDim): {
  filled: number;
  total: number;
  missing: string[];
  pct: number;
  zhangChiOk: boolean;
  jinhuanWarnings: string[];
} {
  const missing: string[] = [];
  const k = r.kuaiman;
  if (!(k.chapterCharsMin >= 2000 && k.chapterCharsMax <= 3000)) {
    // still count as filled if defaults present — check notes or structure touched
  }
  const structureTouched =
    k.volumeCharsMin > 0 && k.unitCharsMin > 0 && k.chapterCharsMin > 0;
  if (!structureTouched) missing.push("快慢结构");
  const shumi = rhythmQuantCompleteness(r.shumi);
  if (!shumi.ok) missing.push("疏密/RhythmQuant");
  if (r.zhangChi.length === 0) missing.push("张弛序列");
  const zc = validateZhangChiSequence(r.zhangChi);
  const jinhuanWarnings: string[] = [];
  for (const b of r.jinhuan) {
    const v = validateTightLooseMatch(b);
    if (!v.ok) jinhuanWarnings.push(v.warning);
  }
  if (r.jinhuan.length === 0) missing.push("紧缓情节点");
  const total = 4;
  const filled = total - missing.length;
  return {
    filled: Math.max(0, filled),
    total,
    missing,
    pct: Math.round((Math.max(0, filled) / total) * 100),
    zhangChiOk: zc.ok,
    jinhuanWarnings,
  };
}

export function summarizeEmotionRhythmToMaster(
  wf: EmotionRhythmWorkflow,
): Pick<MasterOutlineBody, "emotionRhythmSummary" | "genre"> {
  const genre = classifyWorkGenreByHarm(wf.anchor.harmLevel, wf.anchor.core);
  const pull = threeRoundPullCompleteness(wf.pull);
  const see = seePersonCompleteness(wf.seePerson);
  const parts = [
    `核心情绪:${wf.anchor.core}`,
    `类型:${genre}`,
    `三轮:${pull.escalationOk ? "阻碍递进OK" : "阻碍递进待修"}`,
    `以事见人:${see.canMarkDone ? "反应齐全" : "待补反应"}`,
    wf.pull.replayMode !== "未定" ? `结尾:${wf.pull.replayMode}` : "",
  ].filter(Boolean);
  return {
    emotionRhythmSummary: parts.join(" · "),
    genre: genre === "未判定" ? wf.anchor.core : genre,
  };
}

/** 5.md 十步工作流完成度 */
export function emotionRhythmWorkflowCompleteness(wf: EmotionRhythmWorkflow): {
  step: number;
  filledSteps: number;
  totalSteps: number;
  missing: string[];
  canMarkSeePersonDone: boolean;
  canMarkPullDone: boolean;
  ranOk: boolean;
} {
  const missing: string[] = [];
  const stepDone: boolean[] = [];

  // 1 锚定
  const ran = validateRanBoundToShuang(wf.anchor);
  const genreResolved =
    wf.anchor.genreLabel !== "未判定"
      ? wf.anchor.genreLabel
      : classifyWorkGenreByHarm(wf.anchor.harmLevel, wf.anchor.core);
  stepDone[0] = Boolean(wf.anchor.protagonistState.trim()) && genreResolved !== "未判定" && ran.ok;
  if (!stepDone[0]) missing.push("锚定核心情绪");

  // 2 缺口
  stepDone[1] = Boolean(wf.pull.gapExpectation.trim());
  if (!stepDone[1]) missing.push("制造缺口/预期");

  // 3 三轮
  const pullC = threeRoundPullCompleteness(wf.pull);
  const canMarkPullDone = pullC.escalationOk && pullC.refuseFateOk && pullC.missing.length === 0;
  stepDone[2] = canMarkPullDone;
  if (!stepDone[2]) missing.push("三轮拉扯");

  // 4 以事见人
  const seeC = seePersonCompleteness(wf.seePerson);
  stepDone[3] = seeC.canMarkDone;
  if (!stepDone[3]) missing.push("以事见人");

  // 5 Show don't tell
  // 可选自查，不计入必做步骤。

  // 6 渲染细则
  const renderDone = wf.renderChecklist.filter((i) => i.done).length;
  stepDone[5] = renderDone >= Math.ceil(wf.renderChecklist.length / 2);
  if (!stepDone[5]) missing.push("渲染细则");

  // 7 快慢
  stepDone[6] =
    wf.rhythm.kuaiman.chapterCharsMin >= 2000 &&
    wf.rhythm.kuaiman.chapterCharsMax <= 3000;
  if (!stepDone[6]) missing.push("节奏·快慢");

  // 8 疏密
  const rq = rhythmQuantCompleteness(wf.rhythm.shumi);
  stepDone[7] = rq.ok && Boolean(wf.rhythm.imitateQuantBrief.trim());
  if (!stepDone[7]) missing.push("节奏·疏密");

  // 9 张弛+紧缓
  const r4 = rhythmFourDimCompleteness(wf.rhythm);
  stepDone[8] =
    wf.rhythm.zhangChi.length >= 2 &&
    r4.zhangChiOk &&
    wf.rhythm.jinhuan.length >= 1 &&
    r4.jinhuanWarnings.length === 0;
  if (!stepDone[8]) missing.push("张弛+紧缓");

  // 10 结尾+导语+诊断
  const hookFilled =
    Boolean(wf.hookLead.antiCommonSense.trim()) ||
    Boolean(wf.hookLead.suspense.trim()) ||
    Boolean(wf.hookLead.draft.trim());
  stepDone[9] =
    (Boolean(wf.pull.replayAmplify.trim()) || wf.pull.replayMode !== "未定") &&
    hookFilled;
  if (!stepDone[9]) missing.push("复盘放大/导语");

  // auto genre if still 未判定 but harm set
  return {
    step: wf.currentStep,
    filledSteps: stepDone.filter(Boolean).length,
    totalSteps: 9,
    missing,
    canMarkSeePersonDone: seeC.canMarkDone,
    canMarkPullDone,
    ranOk: ran.ok,
  };
}

/* ───────────────────── 6.md：爽点 cool12 + 装逼打脸 + 代入感 ───────────────────── */

export const MaslowNeedLevelSchema = z.enum([
  "physiological",
  "safety",
  "belonging",
  "esteem",
  "self_actualization",
]);
export type MaslowNeedLevel = z.infer<typeof MaslowNeedLevelSchema>;

export const MASLOW_NEED_LABELS: Record<MaslowNeedLevel, string> = {
  physiological: "生理（生存类）",
  safety: "安全（死里逃生类）",
  belonging: "归属（社交类）",
  esteem: "尊重（碾压/扮猪/神技/报仇）",
  self_actualization: "自我实现（破规则/推倒/好为人师/KO boss）",
};

/** 十二套路（与 DeepMethod COOL12 对齐，正式 schema） */
export const Cool12TropeIdSchema = z.enum([
  "survival_hardship",
  "narrow_escape",
  "beauties_galore",
  "all_love_heroine",
  "crush_villain",
  "hide_strength",
  "get_artifact",
  "revenge",
  "defy_authority",
  "melt_iceberg",
  "mentor_flex",
  "defeat_boss",
]);
export type Cool12TropeId = z.infer<typeof Cool12TropeIdSchema>;

export const COOL12_TROPE_META: Record<
  Cool12TropeId,
  { label: string; need: MaslowNeedLevel; index: number }
> = {
  survival_hardship: { label: "生存困难", need: "physiological", index: 1 },
  narrow_escape: { label: "死里逃生", need: "safety", index: 2 },
  beauties_galore: { label: "美女/帅哥如云", need: "belonging", index: 3 },
  all_love_heroine: { label: "男主男配都喜欢女主", need: "belonging", index: 4 },
  crush_villain: { label: "主角碾压反派", need: "esteem", index: 5 },
  hide_strength: { label: "扮猪吃老虎", need: "esteem", index: 6 },
  get_artifact: { label: "获得法宝或神技", need: "esteem", index: 7 },
  revenge: { label: "报仇雪恨", need: "esteem", index: 8 },
  defy_authority: { label: "破坏规则挑战权威", need: "self_actualization", index: 9 },
  melt_iceberg: { label: "推倒冰山/倒追冷酷", need: "self_actualization", index: 10 },
  mentor_flex: { label: "好为人师/正人宝物", need: "self_actualization", index: 11 },
  defeat_boss: { label: "推翻大boss", need: "self_actualization", index: 12 },
};

export const COOL12_TROPE_IDS = Object.keys(COOL12_TROPE_META) as Cool12TropeId[];

/** 7.md：各套路写法细则卡（勾选，不另建工作流） */
export type Cool12RecipeItem = { id: string; label: string };

export const COOL12_TROPE_RECIPE: Record<Cool12TropeId, Cool12RecipeItem[]> = {
  survival_hardship: [
    { id: "sh1", label: "绝境：没吃/没喝/没资源" },
    { id: "sh2", label: "对比：别人都有、只有主角没有" },
    { id: "sh3", label: "尺度：吃喝住行，禁擦边开车" },
  ],
  narrow_escape: [
    { id: "ne1", label: "铺垫危险+存活率极低（九死一生）" },
    { id: "ne2", label: "环境对比写出绝处逢生氛围感" },
    { id: "ne3", label: "脱险后可加奖励二次升级" },
  ],
  beauties_galore: [
    { id: "bg1", label: "情根深重者逐一登场" },
    { id: "bg2", label: "女频尺度收敛；关系勿乱成几对几" },
  ],
  all_love_heroine: [
    { id: "al1", label: "多人倾慕但宜专一独宠主线" },
    { id: "al2", label: "至少一人对主角专情" },
  ],
  crush_villain: [
    { id: "cv1", label: "反派够卑鄙；打压→积蓄→反杀" },
    { id: "cv2", label: "打压可生理/心理PUA/利益层" },
  ],
  hide_strength: [
    { id: "hs1", label: "前期废柴铺垫必须足" },
    { id: "hs2", label: "装的方式：衣着/年龄/外形/能力" },
    { id: "hs3", label: "前后性格可有反差" },
  ],
  get_artifact: [
    { id: "ga1", label: "先惨后得（系统/传承）" },
    { id: "ga2", label: "爽点靠前后对比" },
  ],
  revenge: [
    { id: "rv1", label: "仇有因、约有期（如三年之约）" },
    { id: "rv2", label: "古言/权谋力度通常更大" },
  ],
  defy_authority: [
    { id: "da1", label: "破坏规则有代价（财富/名誉）" },
    { id: "da2", label: "读者支持反抗动机成立" },
  ],
  melt_iceberg: [
    { id: "mi1", label: "征服欲：得不到的永远在骚动" },
    { id: "mi2", label: "美人/帅哥不降智；白月光级塑造" },
  ],
  mentor_flex: [
    { id: "mf1", label: "日常被看轻→不经意指导" },
    { id: "mf2", label: "大赛/高潮俯首称臣" },
  ],
  defeat_boss: [
    { id: "db1", label: "层层危机1…n铺垫" },
    { id: "db2", label: "逐个解决增强实力再KO" },
  ],
};

export const TropeRecipeCheckSchema = z.object({
  tropeId: Cool12TropeIdSchema,
  items: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        done: z.boolean().default(false),
      }),
    )
    .default([]),
});
export type TropeRecipeCheck = z.infer<typeof TropeRecipeCheckSchema>;

export function buildTropeRecipeChecks(tropeId: Cool12TropeId): TropeRecipeCheck {
  return {
    tropeId,
    items: (COOL12_TROPE_RECIPE[tropeId] ?? []).map((x) => ({
      ...x,
      done: false,
    })),
  };
}

export const MaslowCool12PlanSchema = z.object({
  primaryNeed: MaslowNeedLevelSchema.default("esteem"),
  secondaryNeed: MaslowNeedLevelSchema.optional(),
  tropeIds: z.array(Cool12TropeIdSchema).default([]),
  /** 核心套路（装逼打脸常为 hide_strength） */
  coreTropeId: Cool12TropeIdSchema.optional(),
  multiStackNote: z.string().default("多梗叠加，禁止单一套路；可循环叠加核心梗。"),
  chapterMapping: z
    .array(
      z.object({
        chapterNo: z.number().int(),
        tropeId: Cool12TropeIdSchema,
        note: z.string().default(""),
      }),
    )
    .default([]),
  /** 生理套路禁擦边开车 */
  eroticEdgeBlocked: z.boolean().default(true),
  /** 7.md：先缺口（虐/压抑）再满足（爽/释放） */
  needGap: z.string().default(""),
  satisfyBeat: z.string().default(""),
  /** 危机后再奖励（二次升级） */
  rewardUpgrade: z.string().default(""),
  /** 赛道提示：女频专一独宠等 */
  channelNote: z.string().default(""),
  tropeRecipeChecks: z.array(TropeRecipeCheckSchema).default([]),
});
export type MaslowCool12Plan = z.infer<typeof MaslowCool12PlanSchema>;

export function cool12PlanCompleteness(plan: MaslowCool12Plan): {
  filled: number;
  total: number;
  missing: string[];
  pct: number;
  stackOk: boolean;
  gapSatisfyOk: boolean;
} {
  const missing: string[] = [];
  if (plan.tropeIds.length === 0) missing.push("至少选一个套路");
  const stackOk = plan.tropeIds.length >= 2;
  if (!stackOk) missing.push("多梗叠加≥2");
  if (plan.coreTropeId && !plan.tropeIds.includes(plan.coreTropeId)) {
    missing.push("核心套路须在已选列表中");
  }
  if (
    plan.tropeIds.includes("survival_hardship") &&
    !plan.eroticEdgeBlocked
  ) {
    missing.push("生存困难须勾禁擦边");
  }
  const gapSatisfyOk = Boolean(plan.needGap.trim() && plan.satisfyBeat.trim());
  if (!gapSatisfyOk) missing.push("缺口—满足");
  const total = 4;
  const filled = Math.max(0, total - missing.length);
  return {
    filled,
    total,
    missing,
    pct: Math.round((filled / total) * 100),
    stackOk,
    gapSatisfyOk,
  };
}

/** 装逼四要素（可不全齐） */
export const FlexShowElementsSchema = z.object({
  power: z.boolean().default(false),
  appropriate: z.boolean().default(false),
  competitiveEdge: z.boolean().default(false),
  psychologicalEdge: z.boolean().default(false),
  powerCarrier: z.string().default(""), // 武力/财富/地位/势力/知识
  triggerReason: z.string().default(""), // 被逼装/忍无可忍…
  appropriateDetail: z.string().default(""), // 学识炫耀须细节
  note: z.string().default("四要素不必全齐，具备其一亦可；网文装逼偏褒义（表面装、实际真牛）。"),
});
export type FlexShowElements = z.infer<typeof FlexShowElementsSchema>;

export const FaceSlapModeSchema = z.enum(["direct", "indirect"]);
export type FaceSlapMode = z.infer<typeof FaceSlapModeSchema>;

export const SlapVariantSchema = z.enum(["pure", "flex_slap"]);
export type SlapVariant = z.infer<typeof SlapVariantSchema>;

export const SLAP_VARIANT_LABELS: Record<SlapVariant, string> = {
  pure: "纯打脸（揭露虚假/直接反杀，人设已铺）",
  flex_slap: "装逼打脸（表面不厉害、实际碾压反差）",
};

export const FaceSlapPremiseSchema = z.object({
  slapper: z.string().default(""), // 谁打（主角）
  slapped: z.string().default(""), // 打谁（反派）
  purpose: z.string().default(""), // 为何打
  mode: FaceSlapModeSchema.default("direct"),
  /** 7.md：纯打脸 vs 装逼打脸 */
  slapVariant: SlapVariantSchema.default("flex_slap"),
  done: z.boolean().default(false),
});
export type FaceSlapPremise = z.infer<typeof FaceSlapPremiseSchema>;

export function faceSlapPremiseCompleteness(p: FaceSlapPremise): {
  complete: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  if (!p.slapper.trim()) missing.push("打脸主角");
  if (!p.slapped.trim()) missing.push("挨打反派");
  if (!p.purpose.trim()) missing.push("打脸目的");
  if (!p.slapVariant) missing.push("纯打脸/装逼打脸版本");
  return { complete: missing.length === 0, missing };
}

export const FaceSlapTierSchema = z.enum([
  "active", // 初阶主动
  "semi_auto", // 中阶半自动
  "passive", // 高阶被动
  "villain_self", // 反派自打脸
]);
export type FaceSlapTier = z.infer<typeof FaceSlapTierSchema>;

export const FACE_SLAP_TIER_LABELS: Record<FaceSlapTier, string> = {
  active: "初阶·主动打脸（强度1）",
  semi_auto: "中阶·半自动打脸（强度5）",
  passive: "高阶·被动打脸（强度10）",
  villain_self: "高级·反派自打脸",
};

export function suggestEmotionIntensity(tier: FaceSlapTier): number {
  if (tier === "active") return 1;
  if (tier === "semi_auto") return 5;
  if (tier === "passive" || tier === "villain_self") return 10;
  return 1;
}

export const InfoGapKnowLevelSchema = z.enum([
  "unknown",
  "slight",
  "full",
  "reader_only",
]);
export type InfoGapKnowLevel = z.infer<typeof InfoGapKnowLevelSchema>;

export const InfoGapTableSchema = z.object({
  protagonist: InfoGapKnowLevelSchema.default("full"),
  reader: InfoGapKnowLevelSchema.default("full"),
  villain: InfoGapKnowLevelSchema.default("unknown"),
  atmosphere: InfoGapKnowLevelSchema.default("unknown"),
  insider: InfoGapKnowLevelSchema.default("unknown"), // 知情煽火
  toolsperson: InfoGapKnowLevelSchema.default("unknown"), // 工具人（高阶钩子）
  note: z.string().default("信息差是打脸爽感引擎：谁知道主角实力决定爽度。"),
});
export type InfoGapTable = z.infer<typeof InfoGapTableSchema>;

export function validateTierInfoGap(
  tier: FaceSlapTier,
  gap: InfoGapTable,
): { ok: boolean; warnings: string[] } {
  const warnings: string[] = [];
  if (tier === "active") {
    if (gap.insider !== "unknown" && gap.insider !== "slight") {
      warnings.push("初阶通常仅主/读知情；知情者过强偏中阶");
    }
  }
  if (tier === "semi_auto" && gap.insider === "unknown") {
    warnings.push("中阶须有知情煽火者（配角稍知）");
  }
  if (tier === "passive" && gap.toolsperson === "unknown") {
    warnings.push("高阶建议工具人知情并毕恭毕敬造钩子");
  }
  if (tier === "villain_self" && gap.insider !== "full") {
    warnings.push("反派自打脸：配角宜完全知道且崇拜主角");
  }
  return { ok: warnings.length === 0, warnings };
}

export const FaceSlapBeatStepSchema = z.object({
  id: z.string(),
  label: z.string(),
  done: z.boolean().default(false),
  note: z.string().default(""),
});
export type FaceSlapBeatStep = z.infer<typeof FaceSlapBeatStepSchema>;

export const DEFAULT_ACTIVE_BEATS: FaceSlapBeatStep[] = [
  { id: "a1", label: "告诉读者真实实力+装逼计划", done: false, note: "" },
  { id: "a2", label: "加强反派塑造", done: false, note: "" },
  { id: "a3", label: "主角出手打脸", done: false, note: "" },
  { id: "a4", label: "气氛组震惊", done: false, note: "" },
  { id: "a5", label: "反派追悔讨好", done: false, note: "" },
  { id: "a6", label: "支持者捧高踩低", done: false, note: "" },
];

export const DEFAULT_SEMI_BEATS: FaceSlapBeatStep[] = [
  { id: "s1", label: "配角稍知但不点破", done: false, note: "" },
  { id: "s2", label: "气氛组先踩主捧反", done: false, note: "" },
  { id: "s3", label: "知情者刺激反派+鼓吹迎战", done: false, note: "" },
  { id: "s4", label: "反派口出狂言", done: false, note: "" },
  { id: "s5", label: "主角出手碾压", done: false, note: "" },
  { id: "s6", label: "态度反转+气氛组回踩", done: false, note: "" },
  { id: "s7", label: "主角嗤之以鼻", done: false, note: "" },
];

export const DEFAULT_PASSIVE_BEATS: FaceSlapBeatStep[] = [
  { id: "p1", label: "层层拱火（不可压缩）", done: false, note: "" },
  { id: "p2", label: "有身份工具人毕恭毕敬造钩子", done: false, note: "" },
  { id: "p3", label: "实力露约30%", done: false, note: "" },
  { id: "p4", label: "实力露100% KO", done: false, note: "" },
  { id: "p5", label: "反派追悔莫及", done: false, note: "" },
];

export const DEFAULT_SELF_BEATS: FaceSlapBeatStep[] = [
  { id: "v1", label: "配角全知且崇拜", done: false, note: "" },
  { id: "v2", label: "主角坦荡暴露", done: false, note: "" },
  { id: "v3", label: "反派/气氛组不信", done: false, note: "" },
  { id: "v4", label: "撩拨循环（可N轮）", done: false, note: "" },
  { id: "v5", label: "反派自打脸", done: false, note: "" },
];

export function defaultBeatsForTier(tier: FaceSlapTier): FaceSlapBeatStep[] {
  if (tier === "semi_auto") return DEFAULT_SEMI_BEATS.map((x) => ({ ...x }));
  if (tier === "passive") return DEFAULT_PASSIVE_BEATS.map((x) => ({ ...x }));
  if (tier === "villain_self") return DEFAULT_SELF_BEATS.map((x) => ({ ...x }));
  return DEFAULT_ACTIVE_BEATS.map((x) => ({ ...x }));
}

export const VillainPsycheSchema = z.enum([
  "得意忘形",
  "诚惶诚恐",
  "追悔莫及",
  "讨好",
  "未开始",
]);
export type VillainPsyche = z.infer<typeof VillainPsycheSchema>;

export const HeroPsycheSchema = z.enum([
  "胜券在握",
  "志得意满",
  "嗤之以鼻",
  "未开始",
]);
export type HeroPsyche = z.infer<typeof HeroPsycheSchema>;

/** 7.md：气氛组心理线 */
export const AtmospherePsycheSchema = z.enum(["捧高", "震惊", "回踩", "未开始"]);
export type AtmospherePsyche = z.infer<typeof AtmospherePsycheSchema>;

/** 7.md：知情配角心理线 */
export const InsiderPsycheSchema = z.enum([
  "煽火",
  "幸灾乐祸",
  "崇拜坐等",
  "未开始",
]);
export type InsiderPsyche = z.infer<typeof InsiderPsycheSchema>;

export const PsycheTracksSchema = z.object({
  villain: VillainPsycheSchema.default("未开始"),
  hero: HeroPsycheSchema.default("未开始"),
  atmosphere: AtmospherePsycheSchema.default("未开始"),
  insider: InsiderPsycheSchema.default("未开始"),
  note: z.string().default("7.md：反派/主角/气氛组/知情配角四线心理变化"),
});
export type PsycheTracks = z.infer<typeof PsycheTracksSchema>;

/** 7.md：初阶主动打脸三子模式 */
export const ActiveSubModeSchema = z.enum([
  "hide_plan",
  "villain_provoke",
  "atmosphere_shock",
]);
export type ActiveSubMode = z.infer<typeof ActiveSubModeSchema>;

export const ACTIVE_SUB_MODE_LABELS: Record<ActiveSubMode, string> = {
  hide_plan: "低调有计划主动暴露",
  villain_provoke: "反派高调撩拨",
  atmosphere_shock: "气氛组捧高踩低到震惊",
};

export const FaceSlapBeatDesignSchema = z.object({
  tier: FaceSlapTierSchema.default("active"),
  emotionIntensity: z.number().int().min(1).max(10).default(1),
  beats: z.array(FaceSlapBeatStepSchema).default(DEFAULT_ACTIVE_BEATS),
  /** 仅 tier=active 时必选 */
  activeSubMode: ActiveSubModeSchema.optional(),
  /** 高阶工具人 */
  toolspersonName: z.string().default(""),
  toolspersonHasStatus: z.boolean().default(false),
  powerRevealPct: z.number().int().min(0).max(100).default(0),
  powerRevealSecondPct: z.number().int().min(0).max(100).default(100),
  sceneLabel: z.string().default(""),
  slapperTag: z.string().default(""), // 分场标注装逼方
  slappedTag: z.string().default(""),
});
export type FaceSlapBeatDesign = z.infer<typeof FaceSlapBeatDesignSchema>;

export function validateToolspersonStatus(beat: FaceSlapBeatDesign): {
  ok: boolean;
  warning: string;
} {
  if (beat.tier === "passive" && beat.toolspersonName.trim() && !beat.toolspersonHasStatus) {
    return { ok: false, warning: "高阶工具人必须有身份地位名声，否则钩子无效" };
  }
  return { ok: true, warning: "" };
}

export function validatePowerRevealLayers(beat: FaceSlapBeatDesign): {
  ok: boolean;
  warning: string;
} {
  if (beat.tier !== "passive") return { ok: true, warning: "" };
  if (beat.powerRevealPct >= 100 && beat.powerRevealSecondPct >= 100) {
    return { ok: false, warning: "高阶禁止一次全露；先约30%再100%" };
  }
  if (beat.powerRevealPct > 0 && beat.powerRevealPct >= beat.powerRevealSecondPct) {
    return { ok: false, warning: "第一次释放应小于第二次（分次展露）" };
  }
  return { ok: true, warning: "" };
}

/** 代入感五维 */
export const ImmersionIssueSchema = z.enum([
  "character_unreal",
  "character_flat",
  "arc_broken",
  "tension_weak",
  "villain_weak",
]);
export type ImmersionIssue = z.infer<typeof ImmersionIssueSchema>;

export const IMMERSION_ISSUE_LABELS: Record<ImmersionIssue, string> = {
  character_unreal: "人物失真",
  character_flat: "人物扁平",
  arc_broken: "人物弧线断裂",
  tension_weak: "叙事缺乏紧迫感与悬念",
  villain_weak: "反派威胁不足",
};

export const CharacterFiveAskSchema = z.object({
  background: z.string().default(""),
  coreDesire: z.string().default(""),
  fear: z.string().default(""),
  values: z.string().default(""),
  behaviorPattern: z.string().default(""),
  catchphrase: z.string().default(""),
});
export type CharacterFiveAsk = z.infer<typeof CharacterFiveAskSchema>;

export const CharacterArcFourSchema = z.object({
  defect: z.string().default(""),
  keyEvent: z.string().default(""),
  overcome: z.string().default(""),
  newState: z.string().default(""),
});
export type CharacterArcFour = z.infer<typeof CharacterArcFourSchema>;

export const TensionPackSchema = z.object({
  goal: z.string().default(""),
  failCost: z.string().default(""),
  countdown: z.string().default(""),
  crisisChain: z.string().default(""),
  baseFear: z.string().default(""),
});
export type TensionPack = z.infer<typeof TensionPackSchema>;

export const ImmersionVillainCardSchema = z.object({
  stagePowerGap: z.string().default(""),
  conflictGoal: z.string().default(""),
  motive: z.string().default(""),
  weakness: z.string().default(""),
  activePressure: z.string().default(""),
});
export type ImmersionVillainCard = z.infer<typeof ImmersionVillainCardSchema>;

export const ImmersionDiagLevelSchema = z.enum(["green", "yellow", "red", "unset"]);
export type ImmersionDiagLevel = z.infer<typeof ImmersionDiagLevelSchema>;

/** 7.md：Stella 审稿自检六问 */
export const EditorialAskSchema = z.object({
  mainlineClear: z.boolean().default(false),
  characterClear: z.boolean().default(false),
  conflictEnough: z.boolean().default(false),
  immersionOk: z.boolean().default(false),
  expectationOk: z.boolean().default(false),
  paceOk: z.boolean().default(false),
});
export type EditorialAsk = z.infer<typeof EditorialAskSchema>;

export const EDITORIAL_ASK_LABELS: Record<keyof EditorialAsk, string> = {
  mainlineClear: "主线清晰",
  characterClear: "人物清晰",
  conflictEnough: "矛盾感充足",
  immersionOk: "代入感够",
  expectationOk: "期待感够",
  paceOk: "节奏不慢",
};

export const ImmersionFiveAuditSchema = z.object({
  fiveAsk: CharacterFiveAskSchema.default({}),
  traits: z.array(z.string()).default([]),
  contrastHook: z.string().default(""),
  proactivePerChapter: z.boolean().default(false),
  arc: CharacterArcFourSchema.default({}),
  tension: TensionPackSchema.default({}),
  villain: ImmersionVillainCardSchema.default({}),
  issues: z.array(ImmersionIssueSchema).default([]),
  levels: z
    .record(z.string(), ImmersionDiagLevelSchema)
    .default({}),
  resonanceCheck: z.string().default(""), // 会否为角色心痛/开心
  fixPlan: z.string().default(""),
  /** 7.md：人物立住=印象点+魅力爆发场 */
  impressionPoint: z.string().default(""),
  standingBeat: z.string().default(""),
  editorialAsk: EditorialAskSchema.default({}),
});
export type ImmersionFiveAudit = z.infer<typeof ImmersionFiveAuditSchema>;

export function immersionFiveCompleteness(a: ImmersionFiveAudit): {
  filled: number;
  total: number;
  missing: string[];
  pct: number;
  editorialOk: boolean;
} {
  const missing: string[] = [];
  const f = a.fiveAsk;
  if (!f.background.trim() || !f.coreDesire.trim() || !f.fear.trim()) {
    missing.push("人设五问（背景/欲望/恐惧）");
  }
  if (a.traits.length < 2) missing.push("≥2 特质");
  if (!a.contrastHook.trim()) missing.push("反差萌点");
  if (!a.arc.defect.trim() || !a.arc.newState.trim()) missing.push("弧线缺陷→终态");
  if (!a.tension.goal.trim() || !a.tension.failCost.trim()) missing.push("目标+失败代价");
  if (!a.villain.conflictGoal.trim()) missing.push("反派冲突目标");
  if (!a.resonanceCheck.trim()) missing.push("共鸣检验");
  if (!a.impressionPoint.trim() && !a.standingBeat.trim()) {
    missing.push("人物立住（印象点/爆发场）");
  }
  const askFlags = Object.values(a.editorialAsk);
  const editorialOk = askFlags.filter(Boolean).length >= 3;
  if (!editorialOk) missing.push("审稿六问至少勾3项");
  const total = 9;
  const filled = Math.max(0, total - missing.length);
  return {
    filled,
    total,
    missing,
    pct: Math.round((filled / total) * 100),
    editorialOk,
  };
}

export const ProseForceChecklistSchema = z.object({
  filterWordsScanned: z.boolean().default(false),
  filterHits: z.array(z.string()).default([]),
  sensesUsed: z.array(z.string()).default([]), // 视听嗅触味
  bodyReaction: z.string().default(""),
  innerMonologue: z.string().default(""),
  vagueVerbsReplaced: z.boolean().default(false),
  spatialOrder: z.enum(["far_near", "top_bottom", "logic", "unset"]).default("unset"),
  noDirectEmotionTell: z.boolean().default(false),
  note: z
    .string()
    .default("过滤词：看到/听到/觉得…；五感≥3+生理+内心；禁「他很生气」直述。"),
});
export type ProseForceChecklist = z.infer<typeof ProseForceChecklistSchema>;

export const DissectModeSchema = z.enum(["merge", "chapter", "both"]);
export type DissectMode = z.infer<typeof DissectModeSchema>;

export const CurveAlignDrillSchema = z.object({
  benchmarkRounds: z.number().int().min(0).default(0),
  imitateRounds: z.number().int().min(0).default(0),
  alignedUpDown: z.boolean().default(false),
  note: z.string().default("它上你上、它下你下；一上一下为一轮（常约三轮，链5.md）。"),
  /** 7.md：合并拆/分章拆薄链，不伪造小九 UI */
  dissectMode: DissectModeSchema.default("both"),
  chapterBundleSize: z.number().int().default(10),
  longFormTargetChapters: z.number().int().default(50),
  linkedDissectDocId: z.string().default(""),
  stella5w1hNote: z
    .string()
    .default("5W1H 变异：Who/What/When/What action/What goal/How（链拆书，不重建 11 项）"),
});
export type CurveAlignDrill = z.infer<typeof CurveAlignDrillSchema>;

/** 7.md 案例骨架（侧栏展示） */
export type StellaCaseSkeleton = {
  id: string;
  title: string;
  kind: string;
  steps: string[];
};

export const STELLA_CASE_SKELETONS: StellaCaseSkeleton[] = [
  {
    id: "qingyunian",
    title: "《庆余年》醉酒诗百篇",
    kind: "碾压反派",
    steps: ["力量=学识诗词", "对方先贬低", "事实打脸", "细节支撑可信度"],
  },
  {
    id: "xiu_hide",
    title: "修仙隐藏实力—宗门危机—大赛暴露",
    kind: "主动打脸",
    steps: ["隐藏灵根", "外部危机合理化暴露", "大赛打脸"],
  },
  {
    id: "mahouka",
    title: "《魔法科高校的劣等生》",
    kind: "好为人师",
    steps: ["日常被看轻", "不经意指导", "大赛冠军俯首"],
  },
  {
    id: "apocalypse_villain",
    title: "末世囤货反派",
    kind: "反派威胁",
    steps: ["目标直接冲突", "内在动机", "主动施压", "设弱点"],
  },
  {
    id: "blood_smell",
    title: "血腥味描写优化",
    kind: "去过滤词",
    steps: ["删闻到/感觉", "生理反应", "具体环境阴影"],
  },
  {
    id: "pure_vs_flex",
    title: "纯打脸 vs 装逼打脸（注油/戳死）",
    kind: "版本选择",
    steps: ["人设铺垫优先", "选 pure 或 flex_slap"],
  },
];

export const CoolFaceSlapWorkflowSchema = z.object({
  schemaVersion: z.string().default("nines-6.md/7-deepen"),
  cool12: MaslowCool12PlanSchema.default({}),
  flexShow: FlexShowElementsSchema.default({}),
  premise: FaceSlapPremiseSchema.default({}),
  infoGap: InfoGapTableSchema.default({}),
  beat: FaceSlapBeatDesignSchema.default({}),
  psyche: PsycheTracksSchema.default({}),
  /** 链 4.md：可回写爽点一句话 */
  linkedCoolPointFirst: z.string().default(""),
  /** 链 5.md 三轮序号 */
  linkedPullRound: z.number().int().min(0).max(3).default(0),
  immersion: ImmersionFiveAuditSchema.default({}),
  prose: ProseForceChecklistSchema.default({}),
  curveAlign: CurveAlignDrillSchema.default({}),
  currentStep: z.number().int().min(1).max(10).default(1),
  notes: z.string().default(""),
});
export type CoolFaceSlapWorkflow = z.infer<typeof CoolFaceSlapWorkflowSchema>;

export const COOL_FACE_SLAP_CHECKPOINTS: WorkflowCheckpoint[] = [
  {
    id: "cfs_maslow",
    level: "master",
    label: "1.Maslow+cool12",
    done: false,
    userAction: "选需求层；勾≥2套路；填缺口—满足；可选二次升级与写法卡；生存类禁擦边",
    aiAction: "可建议多梗叠加组合（struct.cool12）",
    displayFields: ["need", "tropes", "needGap", "satisfyBeat", "rewardUpgrade"],
  },
  {
    id: "cfs_flex",
    level: "chapter",
    label: "2.装逼四要素",
    done: false,
    userAction: "勾力量/适当/竞争/心理；填载体与触发理由",
    aiAction: "可检「适当」缺细节",
    displayFields: ["flexShow", "powerCarrier", "trigger"],
  },
  {
    id: "cfs_premise",
    level: "beat",
    label: "3.打脸四前提",
    done: false,
    userAction: "填四前提；选纯打脸/装逼打脸版本；未齐不可标完成",
    aiAction: "可检缺项",
    displayFields: ["premise", "slapVariant"],
  },
  {
    id: "cfs_info_gap",
    level: "beat",
    label: "4.信息差矩阵",
    done: false,
    userAction: "标注主/读/反/气/知/工具知情度；与阶段一致",
    aiAction: "可检阶段-知情冲突",
    displayFields: ["infoGap"],
  },
  {
    id: "cfs_tier",
    level: "beat",
    label: "5.选阶+节奏",
    done: false,
    userAction: "选阶；初阶须选三子模式；勾节奏步；高阶工具人须有身份",
    aiAction: "可出节奏草案（struct.face_slap）",
    displayFields: ["tier", "activeSubMode", "beatChecklist", "toolsperson"],
  },
  {
    id: "cfs_psy",
    level: "draft",
    label: "6.心理四线+实力",
    done: false,
    userAction: "走反派/主角/气氛组/知情配角四线；高阶分次释放",
    aiAction: "可检一次露尽",
    displayFields: ["psycheTracks", "powerReveal"],
  },
  {
    id: "cfs_link",
    level: "chapter",
    label: "7.链L4/L5",
    done: false,
    userAction: "可选填爽点一句话回写、三轮轮次；不重建四步/三轮表单",
    aiAction: "不替人改期待系统",
    displayFields: ["linkedCoolPoint", "linkedPullRound"],
  },
  {
    id: "cfs_immersion",
    level: "revise",
    label: "8.代入感五维",
    done: false,
    userAction: "五问/弧线/紧迫/反派/共鸣；人物立住；审稿六问≥3",
    aiAction: "可跑 qc.immersion",
    displayFields: ["immersion", "impressionPoint", "editorialAsk"],
  },
  {
    id: "cfs_prose",
    level: "draft",
    label: "9.文字表现力",
    done: false,
    userAction: "过滤词扫描；五感≥3；替换笼统动词；定描写顺序",
    aiAction: "可列过滤词命中",
    displayFields: ["proseForce"],
  },
  {
    id: "cfs_curve",
    level: "revise",
    label: "10.曲线校准+QC",
    done: false,
    userAction: "对标/仿写对齐；填合并/分章拆模式；回勾 QC P2",
    aiAction: "可对比上下对齐指示（不伪造小九 UI）",
    displayFields: ["curveAlign", "dissectMode", "qc"],
  },
];

export function infoGapCompleteness(gap: InfoGapTable): {
  filled: number;
  total: number;
  pct: number;
} {
  const slots: InfoGapKnowLevel[] = [
    gap.protagonist,
    gap.reader,
    gap.villain,
    gap.atmosphere,
    gap.insider,
    gap.toolsperson,
  ];
  /** 至少主+读+反已配置即算实质填写（unknown 也是显式取值） */
  const filled = slots.length;
  return { filled, total: 6, pct: 100 };
}

export function summarizeCoolFaceSlapToMaster(
  wf: CoolFaceSlapWorkflow,
): Pick<MasterOutlineBody, "coolFaceSlapSummary"> {
  const tropes = wf.cool12.tropeIds
    .map((id) => COOL12_TROPE_META[id]?.label ?? id)
    .join("+");
  const premise = faceSlapPremiseCompleteness(wf.premise);
  const parts = [
    tropes ? `套路:${tropes}` : "",
    `阶:${FACE_SLAP_TIER_LABELS[wf.beat.tier]}`,
    `强度:${wf.beat.emotionIntensity}`,
    premise.complete ? "四前提齐" : `四前提缺:${premise.missing.join(",")}`,
    wf.linkedCoolPointFirst.trim() ? `爽点:${wf.linkedCoolPointFirst.slice(0, 40)}` : "",
  ].filter(Boolean);
  return { coolFaceSlapSummary: parts.join(" · ") };
}

/** 可选：把 linkedCoolPointFirst 同步进 4.md 反推计划的薄字段形态 */
export function syncLinkedCoolPointToReverse(
  coolPointFirst: string,
): Pick<CoolPointReversePlan, "coolPointFirst"> {
  return { coolPointFirst };
}

export function coolFaceSlapWorkflowCompleteness(wf: CoolFaceSlapWorkflow): {
  step: number;
  filledSteps: number;
  totalSteps: number;
  missing: string[];
  canMarkPremiseDone: boolean;
  canMarkTierDone: boolean;
  stackOk: boolean;
} {
  const missing: string[] = [];
  const stepDone: boolean[] = [];

  const c12 = cool12PlanCompleteness(wf.cool12);
  stepDone[0] = c12.stackOk && c12.gapSatisfyOk;
  if (!stepDone[0]) missing.push("Maslow+cool12+缺口满足");

  const flexAny =
    wf.flexShow.power ||
    wf.flexShow.appropriate ||
    wf.flexShow.competitiveEdge ||
    wf.flexShow.psychologicalEdge;
  stepDone[1] = flexAny && Boolean(wf.flexShow.powerCarrier.trim() || wf.flexShow.triggerReason.trim());
  if (!stepDone[1]) missing.push("装逼四要素/载体");

  const prem = faceSlapPremiseCompleteness(wf.premise);
  const canMarkPremiseDone = prem.complete;
  stepDone[2] = prem.complete && wf.premise.done;
  if (!stepDone[2]) missing.push("打脸四前提");

  const gapV = validateTierInfoGap(wf.beat.tier, wf.infoGap);
  stepDone[3] = gapV.ok;
  if (!stepDone[3]) missing.push("信息差与阶段");

  const tool = validateToolspersonStatus(wf.beat);
  const beatsDone = wf.beat.beats.filter((b) => b.done).length;
  const activeSubOk =
    wf.beat.tier !== "active" || Boolean(wf.beat.activeSubMode);
  const canMarkTierDone =
    beatsDone >= Math.ceil(wf.beat.beats.length / 2) && tool.ok && activeSubOk;
  stepDone[4] = canMarkTierDone;
  if (!stepDone[4]) missing.push("选阶+节奏步/三子模式");

  const power = validatePowerRevealLayers(wf.beat);
  stepDone[5] =
    wf.psyche.villain !== "未开始" &&
    wf.psyche.hero !== "未开始" &&
    wf.psyche.atmosphere !== "未开始" &&
    wf.psyche.insider !== "未开始" &&
    power.ok;
  if (!stepDone[5]) missing.push("心理四线/实力释放");

  stepDone[6] =
    Boolean(wf.linkedCoolPointFirst.trim()) || wf.linkedPullRound > 0;
  if (!stepDone[6]) missing.push("链L4/L5（可选但本步计完成需填一项）");

  const imm = immersionFiveCompleteness(wf.immersion);
  stepDone[7] = imm.pct >= 70 && imm.editorialOk;
  if (!stepDone[7]) missing.push("代入感五维/立住/审稿六问");

  stepDone[8] =
    wf.prose.filterWordsScanned &&
    wf.prose.sensesUsed.length >= 3 &&
    wf.prose.noDirectEmotionTell;
  if (!stepDone[8]) missing.push("文字表现力");

  stepDone[9] =
    (wf.curveAlign.alignedUpDown ||
      (wf.curveAlign.benchmarkRounds > 0 && wf.curveAlign.imitateRounds > 0)) &&
    Boolean(wf.curveAlign.dissectMode);
  if (!stepDone[9]) missing.push("曲线校准/拆书模式");

  return {
    step: wf.currentStep,
    filledSteps: stepDone.filter(Boolean).length,
    totalSteps: 10,
    missing,
    canMarkPremiseDone,
    canMarkTierDone,
    stackOk: c12.stackOk,
  };
}

/* ───────────────────── 8.md：灵感成故事总装（InspirationToStoryWorkflow） ───────────────────── */

/** 结构四层级（≠ Inspiration 采集层级一念/灵感/创意/选题） */
export const StoryStructureLevelSchema = z.enum([
  "storyline", // 故事线 → 简介形态
  "core_event", // 核心事件 → 大纲形态
  "plot", // 情节 → 章纲形态
  "scene_event", // 事件 → 细纲形态
]);
export type StoryStructureLevel = z.infer<typeof StoryStructureLevelSchema>;

export const STORY_STRUCTURE_LEVEL_META: Record<
  StoryStructureLevel,
  { label: string; textForm: string; example: string }
> = {
  storyline: {
    label: "故事线",
    textForm: "简介",
    example: "西游记：唐僧师徒西天取经降妖除魔",
  },
  core_event: {
    label: "核心事件",
    textForm: "大纲",
    example: "协和：出轨被抓→决裂→追妻→结局（一章级大事件）",
  },
  plot: {
    label: "情节",
    textForm: "章纲",
    example: "男主当众羞辱女主导致决裂（章内情节点）",
  },
  scene_event: {
    label: "事件",
    textForm: "细纲",
    example: "雨夜抢药材对话/动作/神态（场景级）",
  },
};

export const InspirationRoutePathSchema = z.enum([
  "A", // 故事线下行
  "B", // 核心事件口诀四步
  "C", // 情节三要素上行
  "nest", // 事件级归入情节或核心事件
]);
export type InspirationRoutePath = z.infer<typeof InspirationRoutePathSchema>;

export const InspirationClassifyItemSchema = z.object({
  id: z.string(),
  rawText: z.string().default(""),
  source: z.string().default(""), // 一念/灵感/创意/选题/外部
  level: StoryStructureLevelSchema.optional(),
  reason: z.string().default(""),
  recommendedPath: InspirationRoutePathSchema.optional(),
  nestTarget: z.enum(["plot", "core_event"]).optional(),
});
export type InspirationClassifyItem = z.infer<typeof InspirationClassifyItemSchema>;

export const StorylineCardSchema = z.object({
  oneLiner: z.string().default(""),
  setting: z.string().default(""), // 名字拆解：设定
  process: z.string().default(""), // 过程
  result: z.string().default(""), // 结果
  structureTag: z.string().default(""),
  emotionTag: z.string().default(""),
  relationTag: z.string().default(""),
  microInnovation: z.string().default(""),
  themeAligned: z.boolean().default(false),
  themeNote: z.string().default(""),
});
export type StorylineCard = z.infer<typeof StorylineCardSchema>;

/** 路径 B：核心事件扩展口诀四步 */
export const CoreEventExpandSchema = z.object({
  rawCore: z.string().default(""),
  headTail: z.string().default(""), // 上补头尾
  causalBranches: z.array(z.string()).default([]), // 下猜因果 ≥2
  characterConflict: z.string().default(""), // 人设驱动冲突
  coolPoints: z.array(z.string()).default([]), // 爽点 ≥2
  linkedCoolPoint: z.string().default(""), // 可链 L6
  done: z.boolean().default(false),
});
export type CoreEventExpand = z.infer<typeof CoreEventExpandSchema>;

/** 路径 C：情节三要素（人/事/冲突 + 场景氛围）— 修正旧「事件/因果/变化」 */
export const PlotThreeElementsSchema = z.object({
  person: z.string().default(""),
  matter: z.string().default(""),
  conflictPhysical: z.string().default(""),
  conflictEmotional: z.string().default(""),
  conflictGoalBlock: z.string().default(""),
  sceneAtmosphere: z.string().default(""),
});
export type PlotThreeElements = z.infer<typeof PlotThreeElementsSchema>;

export const ChaseWifeFiveActPhaseSchema = z.enum([
  "breakup", // 决裂期
  "turning", // 转折期
  "awakening", // 男主觉醒期
  "chase", // 追妻期
  "ending", // 结局
]);
export type ChaseWifeFiveActPhase = z.infer<typeof ChaseWifeFiveActPhaseSchema>;

export const CHASE_WIFE_FIVE_ACT_LABELS: Record<ChaseWifeFiveActPhase, string> = {
  breakup: "决裂期",
  turning: "转折期",
  awakening: "男主觉醒期",
  chase: "追妻期",
  ending: "结局",
};

/** 与既有四段映射：决裂≈毁、转折+觉醒≈虐递进、追妻≈追、结局≈合 */
export const FIVE_ACT_TO_FOUR_PHASE: Record<
  ChaseWifeFiveActPhase,
  "destroy" | "abuse" | "chase" | "union"
> = {
  breakup: "destroy",
  turning: "abuse",
  awakening: "abuse",
  chase: "chase",
  ending: "union",
};

export const ChaseWifeFiveActBeatSchema = z.object({
  phase: ChaseWifeFiveActPhaseSchema,
  heroineGoal: z.string().default(""),
  heroState: z.string().default(""),
  emotionIntensity: z.number().int().min(1).max(10).default(5),
  events: z.array(z.string()).default([]),
  done: z.boolean().default(false),
});
export type ChaseWifeFiveActBeat = z.infer<typeof ChaseWifeFiveActBeatSchema>;

export const ChaseWifeFiveActSchema = z.object({
  beats: z
    .array(ChaseWifeFiveActBeatSchema)
    .default([
      { phase: "breakup", heroineGoal: "", heroState: "", emotionIntensity: 8, events: [], done: false },
      { phase: "turning", heroineGoal: "", heroState: "", emotionIntensity: 6, events: [], done: false },
      { phase: "awakening", heroineGoal: "", heroState: "", emotionIntensity: 7, events: [], done: false },
      { phase: "chase", heroineGoal: "", heroState: "", emotionIntensity: 8, events: [], done: false },
      { phase: "ending", heroineGoal: "", heroState: "", emotionIntensity: 9, events: [], done: false },
    ]),
  /** 闸门：过早原谅警告（决裂后很快原谅） */
  earlyForgiveWarned: z.boolean().default(false),
  forgiveTooEarlyNote: z.string().default(""),
});
export type ChaseWifeFiveAct = z.infer<typeof ChaseWifeFiveActSchema>;

export const RelationshipRoleSchema = z.enum([
  "protagonist",
  "villain",
  "ally",
  "rival",
]);
export type RelationshipRole = z.infer<typeof RelationshipRoleSchema>;

export const RELATIONSHIP_ROLE_LABELS: Record<RelationshipRole, string> = {
  protagonist: "主角",
  villain: "反派",
  ally: "助攻",
  rival: "竞争对手",
};

export const RelationshipNetRowSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  role: RelationshipRoleSchema.default("ally"),
  goalPain: z.string().default(""),
  function: z.string().default(""),
  relationToHero: z.string().default(""),
});
export type RelationshipNetRow = z.infer<typeof RelationshipNetRowSchema>;

export const ChapterTreeNodeSchema = z.object({
  id: z.string(),
  coreEventId: z.string().default(""),
  chapterNo: z.number().int().positive().default(1),
  title: z.string().default(""),
  plotPoints: z.array(z.string()).default([]), // 3–10 启发式
  aroundCoreEvent: z.boolean().default(true),
});
export type ChapterTreeNode = z.infer<typeof ChapterTreeNodeSchema>;

export const SceneFourRenderSchema = z.object({
  id: z.string(),
  chapterNo: z.number().int().positive().default(1),
  title: z.string().default(""),
  dialogue: z.string().default(""),
  action: z.string().default(""),
  expression: z.string().default(""), // 神态
  environment: z.string().default(""),
  cause: z.string().default(""), // 一起因
  process: z.string().default(""), // 二过程
  emotionStretch: z.string().default(""), // 三情绪拉伸
  onlyWhatHappened: z.boolean().default(false), // 干货闸：只写发生了什么 → fail
});
export type SceneFourRender = z.infer<typeof SceneFourRenderSchema>;

export const CoreEventIntensityLadderSchema = z.object({
  events: z
    .array(
      z.object({
        id: z.string(),
        label: z.string().default(""),
        intensity: z.number().int().min(1).max(10).default(5),
        nestedUnderId: z.string().optional(),
        chapterNo: z.number().int().positive().optional(),
      }),
    )
    .default([]),
  dumpWarnThreshold: z.number().int().positive().default(2),
});
export type CoreEventIntensityLadder = z.infer<typeof CoreEventIntensityLadderSchema>;

export const AiReviseDraftSchema = z.object({
  version: z.enum(["v1", "v2", "v3", "v4"]),
  text: z.string().default(""),
  selected: z.boolean().default(false),
});
export type AiReviseDraft = z.infer<typeof AiReviseDraftSchema>;

export const AiReviseFlowSchema = z.object({
  drafts: z
    .array(AiReviseDraftSchema)
    .default([
      { version: "v1", text: "", selected: false },
      { version: "v2", text: "", selected: false },
      { version: "v3", text: "", selected: false },
      { version: "v4", text: "", selected: false },
    ]),
  compared: z.boolean().default(false),
  readAloudSmooth: z.boolean().default(false),
  readAloudGap: z.boolean().default(false), // 有无断层
  readAloudWeird: z.boolean().default(false), // 有无怪感
  qcEmotion: z.boolean().default(false),
  qcBenchmark: z.boolean().default(false),
  qcPace: z.boolean().default(false),
  qcHook: z.boolean().default(false),
  qcSuspense: z.boolean().default(false),
  hasChapterOutline: z.boolean().default(false), // 禁止无章纲直出
  done: z.boolean().default(false),
});
export type AiReviseFlow = z.infer<typeof AiReviseFlowSchema>;

export const LengthPacePolicySchema = z.object({
  form: z.enum(["short", "long"]).default("short"),
  densePull: z.boolean().default(true), // 短篇密拉扯
  slowPushOk: z.boolean().default(false), // 长篇可慢推
  mismatchWarned: z.boolean().default(false),
  note: z.string().default(""),
});
export type LengthPacePolicy = z.infer<typeof LengthPacePolicySchema>;

export const GenreGuardSchema = z.object({
  zhiguaiRedlineChecked: z.boolean().default(false),
  materialReserveOk: z.boolean().default(false), // 30–50 万素材储备
  commodityMindsetNoted: z.boolean().default(false),
  note: z.string().default(""),
});
export type GenreGuard = z.infer<typeof GenreGuardSchema>;

/** 案例/口诀常量 */
export const CORE_EVENT_EXPAND_MANTRA =
  "上补头尾 → 下猜因果（≥2 走向）→ 人设驱动冲突 → 爽点往里加（≥2）";

export const RELATIONSHIP_NET_CASE_TEMPLATE: RelationshipNetRow[] = [
  {
    id: "case-hero",
    name: "女主",
    role: "protagonist",
    goalPain: "求子/安全感",
    function: "情感主线",
    relationToHero: "本人",
  },
  {
    id: "case-villain",
    name: "小三/白月光",
    role: "villain",
    goalPain: "上位",
    function: "制造决裂",
    relationToHero: "情敌",
  },
  {
    id: "case-ally",
    name: "闺蜜/律师",
    role: "ally",
    goalPain: "帮女主站稳",
    function: "助攻信息/资源",
    relationToHero: "好友",
  },
];

export const SCENE_FOUR_RAIN_HERB_TEMPLATE: SceneFourRender = {
  id: "tpl-rain-herb",
  chapterNo: 1,
  title: "暴雨抢药材",
  dialogue: "「放下！那是我家救命的药！」",
  action: "扑上去夺药包，脚下一滑跪进泥水",
  expression: "眼神发红，咬破下唇",
  environment: "暴雨砸在瓦檐，药铺灯笼被风撕开",
  cause: "家中病危急需稀缺药材",
  process: "雨夜对峙→抢夺→被打落→仍死死护药",
  emotionStretch: "绝望→愤怒→不甘→一丝希望",
  onlyWhatHappened: false,
};

export const InspirationToStoryWorkflowSchema = z.object({
  schemaVersion: z.literal("nines-8.md/1").default("nines-8.md/1"),
  currentStep: z.number().int().min(0).max(9).default(0),
  classify: z.array(InspirationClassifyItemSchema).default([]),
  activePath: InspirationRoutePathSchema.optional(),
  storyline: StorylineCardSchema.default({}),
  sevenStepsDone: z.boolean().default(false), // 复用 UnitSevenSteps UI，此处只记完成闸
  relationNet: z.array(RelationshipNetRowSchema).default([]),
  coreExpand: CoreEventExpandSchema.default({}),
  plotThree: PlotThreeElementsSchema.default({}),
  fiveAct: ChaseWifeFiveActSchema.default({}),
  intensityLadder: CoreEventIntensityLadderSchema.default({}),
  chapterTree: z.array(ChapterTreeNodeSchema).default([]),
  scenes: z.array(SceneFourRenderSchema).default([]),
  lengthPace: LengthPacePolicySchema.default({}),
  genreGuard: GenreGuardSchema.default({}),
  aiRevise: AiReviseFlowSchema.default({}),
  handedOffToShortNovel: z.boolean().default(false),
  notes: z.string().default(""),
});
export type InspirationToStoryWorkflow = z.infer<typeof InspirationToStoryWorkflowSchema>;

export const INSPIRATION_TO_STORY_CHECKPOINTS: WorkflowCheckpoint[] = [
  {
    id: "its_classify",
    level: "inspiration",
    label: "1.采集与结构判层",
    done: false,
    userAction: "粘贴灵感原文，判定故事线/核心事件/情节/事件四层",
    aiAction: "可给判层建议，人最终确认",
    displayFields: ["classify"],
  },
  {
    id: "its_route",
    level: "inspiration",
    label: "2.路由路径 A/B/C",
    done: false,
    userAction: "按判层选 A 下行 / B 口诀 / C 三要素；事件级归巢",
    aiAction: "提示推荐路径",
    displayFields: ["activePath"],
  },
  {
    id: "its_storyline",
    level: "master",
    label: "3.故事线卡+微创新",
    done: false,
    userAction: "填设定/过程/结果 + 标签 + 微创新 + 主题对齐",
    aiAction: "可扩写一句话主线",
    displayFields: ["storyline"],
  },
  {
    id: "its_seven",
    level: "framework",
    label: "4.七步法人设",
    done: false,
    userAction: "在 DeepMethod 七步法台完成并勾完成",
    aiAction: "复用既有七步法生成",
    displayFields: ["sevenStepsDone"],
  },
  {
    id: "its_relation",
    level: "framework",
    label: "5.人物关系网",
    done: false,
    userAction: "填主角+主配：定位/目标痛点/功能/关系",
    aiAction: "可参考避孕药关系网模板",
    displayFields: ["relationNet"],
  },
  {
    id: "its_core",
    level: "master",
    label: "6.核心事件/五部曲/强度",
    done: false,
    userAction: "五部曲或口诀扩展 + 强度阶梯；禁过早原谅/同章倾泻",
    aiAction: "可扩爽点分支",
    displayFields: ["fiveAct", "coreExpand", "intensityLadder"],
  },
  {
    id: "its_chapter",
    level: "chapter",
    label: "7.章纲树",
    done: false,
    userAction: "核心事件→章→情节点（3–10）；勾是否围绕核心事件",
    aiAction: "可建议情节点列表",
    displayFields: ["chapterTree"],
  },
  {
    id: "its_scene",
    level: "beat",
    label: "8.细纲四描写",
    done: false,
    userAction: "对话/动作/神态/环境 + 起因/过程/情绪拉伸",
    aiAction: "可参考暴雨抢药材模板",
    displayFields: ["scenes"],
  },
  {
    id: "its_handoff",
    level: "draft",
    label: "9.汇入短篇/回写总纲",
    done: false,
    userAction: "勾汇入 short_novel；薄回写 MasterOutline",
    aiAction: "不另建 Stage",
    displayFields: ["handedOffToShortNovel"],
  },
  {
    id: "its_ai",
    level: "revise",
    label: "10.AI 抽卡·朗读·质检",
    done: false,
    userAction: "有章纲后抽卡对比+朗读三检+质检五问",
    aiAction: "复用既有 qc；禁止无章纲直出",
    displayFields: ["aiRevise"],
  },
];

export function recommendPathForLevel(
  level: StoryStructureLevel,
): InspirationRoutePath {
  if (level === "storyline") return "A";
  if (level === "core_event") return "B";
  if (level === "plot") return "C";
  return "nest";
}

export function inspirationClassifyCompleteness(
  items: InspirationClassifyItem[],
): { filled: number; total: number; pct: number; complete: boolean } {
  const total = Math.max(1, items.length);
  const filled = items.filter((i) => i.rawText.trim() && i.level && i.recommendedPath).length;
  const pct = items.length === 0 ? 0 : Math.round((filled / total) * 100);
  return { filled, total: items.length || 1, pct, complete: items.length > 0 && filled === items.length };
}

export function plotThreeCompleteness(p: PlotThreeElements): {
  filled: number;
  total: number;
  pct: number;
  complete: boolean;
  missing: string[];
} {
  const checks: [string, string][] = [
    ["人", p.person],
    ["事", p.matter],
    ["物理冲突", p.conflictPhysical],
    ["情感冲突", p.conflictEmotional],
    ["目标阻碍", p.conflictGoalBlock],
    ["场景氛围", p.sceneAtmosphere],
  ];
  const missing = checks.filter(([, v]) => !v.trim()).map(([k]) => k);
  const filled = checks.length - missing.length;
  return {
    filled,
    total: checks.length,
    pct: Math.round((filled / checks.length) * 100),
    complete: missing.length === 0,
    missing,
  };
}

export function fiveActCompleteness(fa: ChaseWifeFiveAct): {
  filled: number;
  total: number;
  pct: number;
  complete: boolean;
} {
  const total = fa.beats.length;
  const filled = fa.beats.filter(
    (b) =>
      b.done ||
      (Boolean(b.heroineGoal.trim()) &&
        Boolean(b.heroState.trim()) &&
        b.events.some((e) => e.trim())),
  ).length;
  return {
    filled,
    total,
    pct: Math.round((filled / Math.max(1, total)) * 100),
    complete: filled >= total,
  };
}

export function sceneFourCompleteness(s: SceneFourRender): {
  filled: number;
  total: number;
  pct: number;
  complete: boolean;
  dryFail: boolean;
} {
  const fields = [s.dialogue, s.action, s.expression, s.environment, s.cause, s.process, s.emotionStretch];
  const filled = fields.filter((f) => f.trim()).length;
  const dryFail = s.onlyWhatHappened || (filled > 0 && !s.dialogue.trim() && !s.expression.trim() && !s.environment.trim());
  return {
    filled,
    total: 7,
    pct: Math.round((filled / 7) * 100),
    complete: filled >= 7 && !dryFail,
    dryFail,
  };
}

export function aiReviseCompleteness(a: AiReviseFlow): {
  filled: number;
  total: number;
  pct: number;
  complete: boolean;
  canMarkDone: boolean;
} {
  const hasDraft = a.drafts.some((d) => d.text.trim());
  const checks = [
    a.hasChapterOutline,
    hasDraft,
    a.compared,
  ];
  const filled = checks.filter(Boolean).length;
  const canMarkDone =
    a.hasChapterOutline &&
    a.compared &&
    hasDraft;
  return {
    filled,
    total: checks.length,
    pct: Math.round((filled / checks.length) * 100),
    complete: canMarkDone && a.done,
    canMarkDone,
  };
}

export function validateThemeAlignment(card: StorylineCard): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!card.oneLiner.trim() && !card.setting.trim()) {
    return { ok: false, level: "warn", message: "故事线未填" };
  }
  if (!card.themeAligned) {
    return { ok: false, level: "warn", message: "主题对齐未确认" };
  }
  return { ok: true, level: "pass", message: "主题已对齐" };
}

export function validateEarlyForgive(fa: ChaseWifeFiveAct): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const breakup = fa.beats.find((b) => b.phase === "breakup");
  const chase = fa.beats.find((b) => b.phase === "chase");
  const ending = fa.beats.find((b) => b.phase === "ending");
  const early =
    fa.earlyForgiveWarned ||
    (Boolean(breakup?.done) &&
      Boolean(ending?.done) &&
      !(chase?.events.some((e) => e.trim()) || chase?.done) &&
      Boolean(fa.forgiveTooEarlyNote.trim() || ending?.heroineGoal.includes("原谅")));
  if (early) {
    return { ok: false, level: "warn", message: "过早原谅：决裂后应经转折/觉醒/追妻再合" };
  }
  return { ok: true, level: "pass", message: "五部曲节奏未见过早原谅" };
}

export function validateCoreEventDump(ladder: CoreEventIntensityLadder): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
  monoOk: boolean;
} {
  const intensities = ladder.events.map((e) => e.intensity);
  let monoOk = true;
  for (let i = 1; i < intensities.length; i++) {
    if (intensities[i]! < intensities[i - 1]!) {
      monoOk = false;
      break;
    }
  }
  const byChapter = new Map<number, number>();
  for (const e of ladder.events) {
    if (e.chapterNo == null) continue;
    byChapter.set(e.chapterNo, (byChapter.get(e.chapterNo) ?? 0) + 1);
  }
  let dump = false;
  for (const [, n] of byChapter) {
    if (n > ladder.dumpWarnThreshold) {
      dump = true;
      break;
    }
  }
  if (dump) {
    return {
      ok: false,
      level: "warn",
      message: `同章核心事件超阈(>${ladder.dumpWarnThreshold})，勿一章倾泻`,
      monoOk,
    };
  }
  if (!monoOk) {
    return { ok: false, level: "warn", message: "强度阶梯应单调不减", monoOk };
  }
  return { ok: true, level: "pass", message: "强度阶梯与倾泻闸通过", monoOk };
}

export function validateSceneFourDry(s: SceneFourRender): {
  ok: boolean;
  level: "pass" | "fail";
  message: string;
} {
  const c = sceneFourCompleteness(s);
  if (c.dryFail) {
    return { ok: false, level: "fail", message: "干货闸：禁止只写「发生了什么」，需四描写" };
  }
  if (!c.complete) {
    return { ok: false, level: "fail", message: `细纲四描写不完整：${c.filled}/7` };
  }
  return { ok: true, level: "pass", message: "四描写齐全" };
}

export function validateLengthPace(p: LengthPacePolicy): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (p.form === "short" && p.slowPushOk && !p.densePull) {
    return { ok: false, level: "warn", message: "短篇宜密拉扯，不宜慢推" };
  }
  if (p.form === "long" && p.densePull && p.mismatchWarned) {
    return { ok: false, level: "warn", message: "长篇可慢推：已标记错配" };
  }
  if (p.mismatchWarned) {
    return { ok: false, level: "warn", message: p.note || "篇幅节奏错配" };
  }
  return { ok: true, level: "pass", message: "篇幅节奏策略匹配" };
}

/** 可选：五部曲摘要同步回 ChaseWife 四段薄字段 */
export function syncFiveActToChaseWifeFour(
  fa: ChaseWifeFiveAct,
): Pick<ChaseWifeTemplate, "destroyHow" | "notes"> & {
  abuseHint: string;
  chaseHint: string;
  unionHint: string;
} {
  const by = (ph: ChaseWifeFiveActPhase) => fa.beats.find((b) => b.phase === ph);
  const join = (b?: ChaseWifeFiveActBeat) =>
    b ? [b.heroineGoal, b.heroState, ...b.events].filter((x) => x.trim()).join("；") : "";
  return {
    destroyHow: join(by("breakup")),
    abuseHint: [join(by("turning")), join(by("awakening"))].filter(Boolean).join(" / "),
    chaseHint: join(by("chase")),
    unionHint: join(by("ending")),
    notes: `五部曲映射四段：毁=${CHASE_WIFE_FIVE_ACT_LABELS.breakup}；虐=${CHASE_WIFE_FIVE_ACT_LABELS.turning}+${CHASE_WIFE_FIVE_ACT_LABELS.awakening}；追=${CHASE_WIFE_FIVE_ACT_LABELS.chase}；合=${CHASE_WIFE_FIVE_ACT_LABELS.ending}`,
  };
}

export function summarizeInspirationToStoryToMaster(
  wf: InspirationToStoryWorkflow,
): Pick<MasterOutlineBody, "inspirationToStorySummary" | "logline" | "genre"> {
  const level =
    wf.classify.find((c) => c.level)?.level ??
    (wf.activePath === "A"
      ? "storyline"
      : wf.activePath === "B"
        ? "core_event"
        : wf.activePath === "C"
          ? "plot"
          : undefined);
  const parts = [
    level ? `层:${STORY_STRUCTURE_LEVEL_META[level].label}` : "",
    wf.activePath ? `径:${wf.activePath}` : "",
    wf.storyline.oneLiner.trim() ? `线:${wf.storyline.oneLiner.slice(0, 40)}` : "",
    fiveActCompleteness(wf.fiveAct).complete ? "五部曲齐" : "",
    wf.scenes.length ? `细纲×${wf.scenes.length}` : "",
    wf.handedOffToShortNovel ? "已汇入短篇" : "",
  ].filter(Boolean);
  return {
    inspirationToStorySummary: parts.join(" · "),
    logline: wf.storyline.oneLiner.trim(),
    genre: wf.storyline.structureTag.trim(),
  };
}

export function inspirationToStoryWorkflowCompleteness(wf: InspirationToStoryWorkflow): {
  step: number;
  filledSteps: number;
  totalSteps: number;
  missing: string[];
  canMarkAiDone: boolean;
} {
  const missing: string[] = [];
  const stepDone: boolean[] = [];

  const cls = inspirationClassifyCompleteness(wf.classify);
  stepDone[0] = cls.complete;
  if (!stepDone[0]) missing.push("采集与结构判层");

  const hasSceneEvent = wf.classify.some((c) => c.level === "scene_event");
  stepDone[1] = hasSceneEvent
    ? wf.activePath === "nest"
    : Boolean(wf.activePath);
  if (!stepDone[1]) missing.push("路由路径 A/B/C");

  const theme = validateThemeAlignment(wf.storyline);
  stepDone[2] =
    Boolean(wf.storyline.oneLiner.trim() || (wf.storyline.setting.trim() && wf.storyline.process.trim() && wf.storyline.result.trim())) &&
    theme.ok;
  if (!stepDone[2]) missing.push("故事线卡+微创新/主题");

  stepDone[3] = wf.sevenStepsDone;
  if (!stepDone[3]) missing.push("七步法人设");

  stepDone[4] =
    wf.relationNet.length >= 2 &&
    wf.relationNet.every((r) => r.name.trim() && r.goalPain.trim() && r.function.trim());
  if (!stepDone[4]) missing.push("人物关系网");

  const five = fiveActCompleteness(wf.fiveAct);
  const expandOk =
    Boolean(wf.coreExpand.rawCore.trim()) &&
    Boolean(wf.coreExpand.headTail.trim()) &&
    wf.coreExpand.causalBranches.filter((x) => x.trim()).length >= 2 &&
    Boolean(wf.coreExpand.characterConflict.trim()) &&
    wf.coreExpand.coolPoints.filter((x) => x.trim()).length >= 2;
  const early = validateEarlyForgive(wf.fiveAct);
  const dump = validateCoreEventDump(wf.intensityLadder);
  stepDone[5] = (five.complete || expandOk) && early.ok && dump.ok;
  if (!stepDone[5]) missing.push("核心事件/五部曲/强度");

  stepDone[6] =
    wf.chapterTree.length > 0 &&
    wf.chapterTree.every(
      (n) => n.plotPoints.filter((p) => p.trim()).length >= 3 && n.aroundCoreEvent !== undefined,
    );
  if (!stepDone[6]) missing.push("章纲树");

  const scenesOk =
    wf.scenes.length > 0 && wf.scenes.every((s) => sceneFourCompleteness(s).complete);
  stepDone[7] = scenesOk;
  if (!stepDone[7]) missing.push("细纲四描写");

  stepDone[8] = wf.handedOffToShortNovel;
  if (!stepDone[8]) missing.push("汇入短篇/回写总纲");

  const ai = aiReviseCompleteness(wf.aiRevise);
  stepDone[9] = ai.complete;
  if (!stepDone[9]) missing.push("AI 抽卡·朗读·质检");

  return {
    step: wf.currentStep,
    filledSteps: stepDone.filter(Boolean).length,
    totalSteps: 10,
    missing,
    canMarkAiDone: ai.canMarkDone,
  };
}


/* ───────────────────── 9.md：短篇选题 TopicSelectionWorkflow ───────────────────── */

export const AudienceBucketSchema = z.enum(["young_18_35", "mature_40plus"]);
export type AudienceBucket = z.infer<typeof AudienceBucketSchema>;

export const AUDIENCE_BUCKET_LABELS: Record<AudienceBucket, string> = {
  young_18_35: "18–35 年轻向",
  mature_40plus: "40+ 中老年向",
};

export const AudienceSegmentSchema = z.object({
  bucket: AudienceBucketSchema.optional(),
  /** 年轻向方向 */
  antiTrope: z.boolean().default(false),
  womenMutual: z.boolean().default(false),
  softScifiGrounded: z.boolean().default(false),
  antiFloatingSweet: z.boolean().default(false),
  /** 中老年向方向 */
  realistSmoke: z.boolean().default(false),
  slowPace: z.boolean().default(false),
  audioOriented: z.boolean().default(false),
  exclusiveConfirmed: z.boolean().default(false),
});
export type AudienceSegment = z.infer<typeof AudienceSegmentSchema>;

export const ChartMiningBoardSchema = z.object({
  platform: z.string().default(""),
  chartType: z.string().default(""),
  topKeywords: z.array(z.string()).default([]),
  repeatWords: z.array(z.string()).default([]),
  diffNote: z.string().default(""),
  onlySettingKeywordCoreHint: z
    .string()
    .default("只扒核心设定+关键词+扫内核，勿抄全文"),
});
export type ChartMiningBoard = z.infer<typeof ChartMiningBoardSchema>;

export const TopicFormulaCardSchema = z.object({
  oldTropeOrHot: z.string().default(""),
  strengthDomain: z.string().default(""),
  emotionPoint: z.string().default(""),
  diffOneLiner: z.string().default(""),
  multiEndingNote: z.string().default(""),
});
export type TopicFormulaCard = z.infer<typeof TopicFormulaCardSchema>;

export const ContrastSeamSchema = z.object({
  baseTrope: z.string().default(""),
  alienElement: z.string().default(""),
  logicSelfCheck: z.boolean().default(false),
  note: z.string().default(""),
});
export type ContrastSeam = z.infer<typeof ContrastSeamSchema>;

export const HotspotLandingSchema = z.object({
  canLand: z.boolean().default(false),
  hasEmotion: z.boolean().default(false),
  hasDepth: z.boolean().default(false),
  positiveReviewOk: z.boolean().default(false),
  note: z.string().default(""),
});
export type HotspotLanding = z.infer<typeof HotspotLandingSchema>;

export const ForeshadowTwistLedgerSchema = z.object({
  openingTwist: z.string().default(""),
  midTwist: z.string().default(""),
  endingTwist: z.string().default(""),
  foreshadowPreDesigned: z.boolean().default(false),
  note: z.string().default(""),
});
export type ForeshadowTwistLedger = z.infer<typeof ForeshadowTwistLedgerSchema>;

export const SENSE_TAG_OPTIONS = ["视", "听", "触", "嗅", "味"] as const;

export const IntroLeadDraftSchema = z.object({
  text: z.string().default(""),
  targetChars: z.number().int().positive().default(200),
  senseTags: z.array(z.string()).default([]),
  coolSentenceMarked: z.boolean().default(false),
  overstuffWarned: z.boolean().default(false),
  trackNote: z.string().default("知乎导语轨~200字；与 L5 导语四轴分轨互标"),
});
export type IntroLeadDraft = z.infer<typeof IntroLeadDraftSchema>;

export const MasterStoryBeatSlotSchema = z.object({
  id: z.string(),
  qi: z.string().default(""),
  cheng: z.string().default(""),
  zhuan: z.string().default(""),
  he: z.string().default(""),
  done: z.boolean().default(false),
});
export type MasterStoryBeatSlot = z.infer<typeof MasterStoryBeatSlotSchema>;

export const MasterStoryBeatRailSchema = z.object({
  slots: z.array(MasterStoryBeatSlotSchema).default([]),
  minSlots: z.number().int().default(11),
  maxSlots: z.number().int().default(13),
  note: z.string().default("全书故事情节 11–13；≠ L8 章内情节点 3–10"),
});
export type MasterStoryBeatRail = z.infer<typeof MasterStoryBeatRailSchema>;

export const TopicFivePitfallsSchema = z.object({
  noFloating: z.boolean().default(false),
  noMelodrama: z.boolean().default(false),
  noAuthorOpinionInText: z.boolean().default(false),
  noCopycat: z.boolean().default(false),
  audienceClear: z.boolean().default(false),
});
export type TopicFivePitfalls = z.infer<typeof TopicFivePitfallsSchema>;

export const ExecutionQcLiteSchema = z.object({
  coreConflictTaughtToAi: z.boolean().default(false),
  visualSenseOk: z.boolean().default(false),
  fiveSensesOk: z.boolean().default(false),
  coolEscalationLinkedL6: z.boolean().default(false),
  punctDeAiLinked: z.boolean().default(false),
  pronounStrict: z.boolean().default(false),
  climaxNotAbrupt: z.boolean().default(false),
  note: z.string().default("处刑轻台：勾选验收，爽点/画面链 L6，标点链 DeAi/p3"),
});
export type ExecutionQcLite = z.infer<typeof ExecutionQcLiteSchema>;

export const PostSubmitPolicySchema = z.object({
  restHours: z.number().min(0).default(2),
  readToOther: z.boolean().default(false),
  logicVsEditorTasteNote: z.string().default(""),
  submitted: z.boolean().default(false),
});
export type PostSubmitPolicy = z.infer<typeof PostSubmitPolicySchema>;

export const GOLDEN_THREE_SECONDS =
  "黄金三秒 = 反常识 + 强冲突 + 高悬念";

export const EXECUTION_QC_TAGS = [
  "核心矛盾",
  "导语",
  "画面",
  "五觉",
  "爽点递进",
  "标点",
  "代词",
] as const;

export const TopicSelectionWorkflowSchema = z.object({
  schemaVersion: z.literal("nines-9.md/1").default("nines-9.md/1"),
  currentStep: z.number().int().min(0).max(9).default(0),
  audience: AudienceSegmentSchema.default({}),
  chart: ChartMiningBoardSchema.default({}),
  formula: TopicFormulaCardSchema.default({}),
  contrast: ContrastSeamSchema.default({}),
  hotspot: HotspotLandingSchema.default({}),
  twists: ForeshadowTwistLedgerSchema.default({}),
  intro: IntroLeadDraftSchema.default({}),
  beatRail: MasterStoryBeatRailSchema.default({}),
  pitfalls: TopicFivePitfallsSchema.default({}),
  executionQc: ExecutionQcLiteSchema.default({}),
  postSubmit: PostSubmitPolicySchema.default({}),
  handedOffToL8: z.boolean().default(false),
  notes: z.string().default(""),
});
export type TopicSelectionWorkflow = z.infer<typeof TopicSelectionWorkflowSchema>;

export const TOPIC_SELECTION_CHECKPOINTS: WorkflowCheckpoint[] = [
  {
    id: "ts_audience",
    level: "inspiration",
    label: "1.定受众",
    done: false,
    userAction: "年轻/中老年二选一并勾方向",
    aiAction: "可建议方向组合",
    displayFields: ["audience"],
  },
  {
    id: "ts_chart",
    level: "inspiration",
    label: "2.扒榜前20",
    done: false,
    userAction: "填平台/榜类型/关键词/重复词/差异化",
    aiAction: "可助提炼重复词",
    displayFields: ["chart"],
  },
  {
    id: "ts_formula",
    level: "inspiration",
    label: "3.选题加法",
    done: false,
    userAction: "老梗/热点+擅长+情绪→差异化一句话",
    aiAction: "可扩多结局备注",
    displayFields: ["formula"],
  },
  {
    id: "ts_contrast",
    level: "inspiration",
    label: "4.反差验逻辑",
    done: false,
    userAction: "基底梗+异质元素+逻辑自检",
    aiAction: "提示自洽风险",
    displayFields: ["contrast"],
  },
  {
    id: "ts_twist",
    level: "master",
    label: "5.伏笔反转",
    done: false,
    userAction: "开篇/中段/结尾反转+伏笔预先设计",
    aiAction: "可建议反转密度",
    displayFields: ["twists"],
  },
  {
    id: "ts_intro",
    level: "draft",
    label: "6.写导语",
    done: false,
    userAction: "知乎导语~200字+五觉+爽点句",
    aiAction: "可润色导语（人定）",
    displayFields: ["intro"],
  },
  {
    id: "ts_beats",
    level: "chapter",
    label: "7.情节轨+爽点验收",
    done: false,
    userAction: "全书11–13故事情节；处刑勾爽点递进链L6",
    aiAction: "可建议槽位标题",
    displayFields: ["beatRail", "executionQc"],
  },
  {
    id: "ts_hand",
    level: "revise",
    label: "8.手搓/标点链",
    done: false,
    userAction: "标点去AI/代词/高潮勿戛然",
    aiAction: "链 DeAi/p3",
    displayFields: ["executionQc"],
  },
  {
    id: "ts_rest",
    level: "revise",
    label: "9.静置自检",
    done: false,
    userAction: "静置2–5h或读给旁人",
    aiAction: "无",
    displayFields: ["postSubmit"],
  },
  {
    id: "ts_submit",
    level: "revise",
    label: "10.投稿/回写总纲",
    done: false,
    userAction: "五坑齐+投稿勾选+回写Master",
    aiAction: "薄摘要",
    displayFields: ["pitfalls", "postSubmit"],
  },
];

export function validateAudienceExclusive(a: AudienceSegment): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!a.bucket) {
    return { ok: false, level: "warn", message: "未选定受众边" };
  }
  if (!a.exclusiveConfirmed) {
    return { ok: false, level: "warn", message: "须确认只选一边受众" };
  }
  if (a.bucket === "young_18_35") {
    const any =
      a.antiTrope || a.womenMutual || a.softScifiGrounded || a.antiFloatingSweet;
    if (!any) return { ok: false, level: "warn", message: "年轻向须至少勾一方向" };
    if (a.realistSmoke || a.slowPace || a.audioOriented) {
      return { ok: false, level: "warn", message: "受众互斥：勿同时勾中老年方向" };
    }
  } else {
    const any = a.realistSmoke || a.slowPace || a.audioOriented;
    if (!any) return { ok: false, level: "warn", message: "中老年向须至少勾一方向" };
    if (a.antiTrope || a.womenMutual || a.softScifiGrounded || a.antiFloatingSweet) {
      return { ok: false, level: "warn", message: "受众互斥：勿同时勾年轻向方向" };
    }
  }
  return { ok: true, level: "pass", message: "受众边清晰" };
}

export function validateIntroOverstuff(intro: IntroLeadDraft): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
  charCount: number;
} {
  const charCount = intro.text.trim().length;
  const over =
    intro.overstuffWarned ||
    charCount > intro.targetChars * 1.5 ||
    (charCount > 0 && intro.senseTags.length === 0 && charCount > intro.targetChars);
  if (over) {
    return {
      ok: false,
      level: "warn",
      message: `导语过塞或超标（${charCount}/${intro.targetChars}）`,
      charCount,
    };
  }
  if (!intro.text.trim()) {
    return { ok: false, level: "warn", message: "导语未填", charCount: 0 };
  }
  return { ok: true, level: "pass", message: "导语长度可接受", charCount };
}

export function validateMasterBeatCount(rail: MasterStoryBeatRail): {
  ok: boolean;
  level: "pass" | "fail";
  message: string;
  filled: number;
} {
  const filled = rail.slots.filter(
    (s) => s.done || (s.qi.trim() && s.cheng.trim() && s.zhuan.trim() && s.he.trim()),
  ).length;
  if (filled < rail.minSlots || filled > rail.maxSlots) {
    return {
      ok: false,
      level: "fail",
      message: `全书故事情节须 ${rail.minSlots}–${rail.maxSlots}，当前有效 ${filled}`,
      filled,
    };
  }
  return { ok: true, level: "pass", message: `情节轨 ${filled} 槽合格`, filled };
}

export function validateFivePitfalls(p: TopicFivePitfalls): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
  missing: string[];
} {
  const checks: [string, boolean][] = [
    ["禁悬浮", p.noFloating],
    ["禁狗血", p.noMelodrama],
    ["禁作者观点入文", p.noAuthorOpinionInText],
    ["禁跟风抄袭", p.noCopycat],
    ["受众清晰", p.audienceClear],
  ];
  const missing = checks.filter(([, v]) => !v).map(([k]) => k);
  return {
    ok: missing.length === 0,
    level: missing.length === 0 ? "pass" : "warn",
    message: missing.length === 0 ? "五坑已自检" : `五坑未齐：${missing.join(",")}`,
    missing,
  };
}

export function summarizeTopicSelectionToMaster(
  wf: TopicSelectionWorkflow,
): Pick<MasterOutlineBody, "topicSelectionSummary" | "logline" | "genre"> {
  const parts = [
    wf.audience.bucket ? `受众:${AUDIENCE_BUCKET_LABELS[wf.audience.bucket]}` : "",
    wf.formula.diffOneLiner.trim() ? `差:${wf.formula.diffOneLiner.slice(0, 36)}` : "",
    wf.chart.platform ? `榜:${wf.chart.platform}` : "",
    validateMasterBeatCount(wf.beatRail).ok ? "情节轨齐" : "",
    wf.handedOffToL8 ? "已汇入L8" : "",
  ].filter(Boolean);
  return {
    topicSelectionSummary: parts.join(" · "),
    logline: wf.formula.diffOneLiner.trim(),
    genre: wf.formula.strengthDomain.trim(),
  };
}

export function topicSelectionWorkflowCompleteness(wf: TopicSelectionWorkflow): {
  step: number;
  filledSteps: number;
  totalSteps: number;
  missing: string[];
} {
  const missing: string[] = [];
  const stepDone: boolean[] = [];

  const aud = validateAudienceExclusive(wf.audience);
  stepDone[0] = aud.ok;
  if (!stepDone[0]) missing.push("定受众");

  stepDone[1] =
    Boolean(wf.chart.platform.trim()) &&
    wf.chart.topKeywords.filter((k) => k.trim()).length >= 3 &&
    Boolean(wf.chart.diffNote.trim());
  if (!stepDone[1]) missing.push("扒榜前20");

  stepDone[2] =
    Boolean(wf.formula.oldTropeOrHot.trim()) &&
    Boolean(wf.formula.strengthDomain.trim()) &&
    Boolean(wf.formula.emotionPoint.trim()) &&
    Boolean(wf.formula.diffOneLiner.trim());
  if (!stepDone[2]) missing.push("选题加法");

  stepDone[3] =
    Boolean(wf.contrast.baseTrope.trim()) &&
    Boolean(wf.contrast.alienElement.trim()) &&
    wf.contrast.logicSelfCheck;
  if (!stepDone[3]) missing.push("反差验逻辑");

  stepDone[4] =
    Boolean(wf.twists.openingTwist.trim()) &&
    Boolean(wf.twists.midTwist.trim()) &&
    Boolean(wf.twists.endingTwist.trim()) &&
    wf.twists.foreshadowPreDesigned;
  if (!stepDone[4]) missing.push("伏笔反转");

  const introV = validateIntroOverstuff(wf.intro);
  stepDone[5] =
    introV.ok &&
    wf.intro.senseTags.length >= 1 &&
    wf.intro.coolSentenceMarked &&
    !wf.intro.overstuffWarned;
  if (!stepDone[5]) missing.push("写导语");

  const beats = validateMasterBeatCount(wf.beatRail);
  stepDone[6] = beats.ok && wf.executionQc.coolEscalationLinkedL6;
  if (!stepDone[6]) missing.push("情节轨+爽点验收");

  stepDone[7] =
    wf.executionQc.punctDeAiLinked &&
    wf.executionQc.pronounStrict &&
    wf.executionQc.climaxNotAbrupt;
  if (!stepDone[7]) missing.push("手搓/标点链");

  stepDone[8] = wf.postSubmit.restHours >= 2 || wf.postSubmit.readToOther;
  if (!stepDone[8]) missing.push("静置自检");

  const pits = validateFivePitfalls(wf.pitfalls);
  stepDone[9] = pits.ok && (wf.postSubmit.submitted || wf.handedOffToL8);
  if (!stepDone[9]) missing.push("投稿/回写总纲");

  return {
    step: wf.currentStep,
    filledSteps: stepDone.filter(Boolean).length,
    totalSteps: 10,
    missing,
  };
}

/* ───────────────────── 10.md：人设深度 CharacterDepthWorkflow ───────────────────── */

export const CreationPurposeSchema = z.enum(["commercial", "literary"]);
export type CreationPurpose = z.infer<typeof CreationPurposeSchema>;

export const CreationPurposeGateSchema = z.object({
  purpose: CreationPurposeSchema.optional(),
  exclusiveConfirmed: z.boolean().default(false),
  note: z.string().default("择一为重：商业则压风花雪月"),
});
export type CreationPurposeGate = z.infer<typeof CreationPurposeGateSchema>;

export const BigFiveTraitSlotSchema = z.object({
  level: z.number().int().min(1).max(5).default(3),
  fitBehavior: z.string().default(""),
  unfitBehavior: z.string().default(""),
});
export type BigFiveTraitSlot = z.infer<typeof BigFiveTraitSlotSchema>;

export const BigFiveBlendSchema = z.object({
  openness: BigFiveTraitSlotSchema.default({}),
  conscientiousness: BigFiveTraitSlotSchema.default({}),
  extraversion: BigFiveTraitSlotSchema.default({}),
  agreeableness: BigFiveTraitSlotSchema.default({}),
  neuroticism: BigFiveTraitSlotSchema.default({}),
  templateId: z.string().default(""),
  blendNote: z.string().default(""),
});
export type BigFiveBlend = z.infer<typeof BigFiveBlendSchema>;

export const DesireFearSecretSchema = z.object({
  desireSurface: z.string().default(""),
  desireDeep: z.string().default(""),
  fearShadow: z.string().default(""),
  ultimateSecret: z.string().default(""),
  secretAsTwist: z.boolean().default(false),
});
export type DesireFearSecret = z.infer<typeof DesireFearSecretSchema>;

export const DiffCpPresetSchema = z.enum([
  "tsundere_mad_x_true_monk",
  "schemer_x_interest",
  "salted_fish_x_grinder",
  "custom",
]);
export type DiffCpPreset = z.infer<typeof DiffCpPresetSchema>;

export const DIFF_CP_PRESET_LABELS: Record<DiffCpPreset, string> = {
  tsundere_mad_x_true_monk: "傲娇疯批×真佛子",
  schemer_x_interest: "腹黑×利益至上",
  salted_fish_x_grinder: "咸鱼×卷王",
  custom: "自定义",
};

export const DiffCpComboSchema = z.object({
  preset: DiffCpPresetSchema.default("custom"),
  customLabel: z.string().default(""),
  openingChecklist: z.array(z.string()).default([]),
  climaxChecklist: z.array(z.string()).default([]),
  note: z.string().default(""),
});
export type DiffCpCombo = z.infer<typeof DiffCpComboSchema>;

export const CharacterSheetSevenSchema = z.object({
  basic: z.string().default(""),
  appearance: z.string().default(""),
  mbtiProsCons: z.string().default(""),
  motiveThree: z.string().default(""),
  hallmarkProp: z.string().default(""),
  relationNetRef: z.string().default(""),
  behaviorBoundary: z.string().default(""),
  sevenStepsDone: z.boolean().default(false),
});
export type CharacterSheetSeven = z.infer<typeof CharacterSheetSevenSchema>;

/** 10.md 课内原文三问 */
export const SOUL_PROBE_QUESTIONS = [
  "这人面对此事会做什么、为什么？",
  "「渣事」真无情还是有苦衷？",
  "相反行为是否违背底色？",
] as const;

export const SoulProbeRowSchema = z.object({
  id: z.string(),
  beatLabel: z.string().default(""),
  q1Pass: z.boolean().default(false),
  q2Pass: z.boolean().default(false),
  q3Pass: z.boolean().default(false),
  oocFix: z.string().default(""),
});
export type SoulProbeRow = z.infer<typeof SoulProbeRowSchema>;

export const SoulProbeThreeSchema = z.object({
  rows: z.array(SoulProbeRowSchema).default([]),
  questions: z.array(z.string()).default([...SOUL_PROBE_QUESTIONS]),
});
export type SoulProbeThree = z.infer<typeof SoulProbeThreeSchema>;

export const ForeshadowRecoverItemSchema = z.object({
  id: z.string(),
  plant: z.string().default(""),
  recover: z.string().default(""),
  recovered: z.boolean().default(false),
});
export type ForeshadowRecoverItem = z.infer<typeof ForeshadowRecoverItemSchema>;

export const SHORT_HAND_EDIT_12_LABELS = [
  "清 AI 痕迹",
  "标点正常化",
  "精炼语句",
  "去官方词",
  "补冲突",
  "埋伏笔",
  "情绪递进",
  "爆点写实",
  "回收伏笔",
  "删冗余",
  "去说教",
  "升华留白",
] as const;

export const ShortFictionHandEdit12Schema = z.object({
  steps: z
    .array(z.object({ id: z.string(), label: z.string(), done: z.boolean().default(false) }))
    .default(
      SHORT_HAND_EDIT_12_LABELS.map((label, i) => ({
        id: `he${i + 1}`,
        label,
        done: false,
      })),
    ),
  note: z.string().default("短篇手搓12步；≠漫剧十二检"),
});
export type ShortFictionHandEdit12 = z.infer<typeof ShortFictionHandEdit12Schema>;

export const ShortSubmitGateSchema = z.object({
  wordCount: z.number().int().nonnegative().default(0),
  targetWords: z.number().int().default(12000),
  zhihuOverlongWarned: z.boolean().default(false),
  chapterTitlePlain: z.boolean().default(false),
  clearedStarsAndExtraLines: z.boolean().default(false),
  oneHeroine: z.boolean().default(false),
  oneHero: z.boolean().default(false),
  hasVillain: z.boolean().default(false),
  extrasOk: z.boolean().default(false),
});
export type ShortSubmitGate = z.infer<typeof ShortSubmitGateSchema>;

export const CharacterPitfallsThreeSchema = z.object({
  noPerfect: z.boolean().default(false),
  contrastNeedsBeat: z.boolean().default(false),
  noLabelOnly: z.boolean().default(false),
});
export type CharacterPitfallsThree = z.infer<typeof CharacterPitfallsThreeSchema>;

export const BIG5_PRESIDENT_TEMPLATE: BigFiveBlend = {
  openness: { level: 3, fitBehavior: "年会公开吃醋护短", unfitBehavior: "对秘书温柔絮叨" },
  conscientiousness: { level: 5, fitBehavior: "丢文件后深夜复盘追责", unfitBehavior: "随手甩锅" },
  extraversion: { level: 2, fitBehavior: "少言短句下令", unfitBehavior: "热闹寒暄" },
  agreeableness: { level: 2, fitBehavior: "谈判寸步不让", unfitBehavior: "无条件让利" },
  neuroticism: { level: 4, fitBehavior: "失控前先冷脸", unfitBehavior: "当众崩溃哭诉" },
  templateId: "cold_ceo",
  blendNote: "高冷总裁模板",
};

export const BIG5_SWEET_REPORTER_TEMPLATE: BigFiveBlend = {
  openness: { level: 4, fitBehavior: "追问倔老艺术家真意", unfitBehavior: "抄通稿交差" },
  conscientiousness: { level: 4, fitBehavior: "核对引语出处", unfitBehavior: "断章取义爆款" },
  extraversion: { level: 4, fitBehavior: "主动破冰寒暄", unfitBehavior: "全程冷场" },
  agreeableness: { level: 5, fitBehavior: "共情对方底线", unfitBehavior: "羞辱受访者" },
  neuroticism: { level: 3, fitBehavior: "采访前紧张仍上", unfitBehavior: "爽约逃避" },
  templateId: "sweet_reporter",
  blendNote: "甜妹记者模板",
};

export const CharacterDepthWorkflowSchema = z.object({
  schemaVersion: z.literal("nines-10.md/1").default("nines-10.md/1"),
  currentStep: z.number().int().min(0).max(9).default(0),
  purpose: CreationPurposeGateSchema.default({}),
  big5: BigFiveBlendSchema.default({}),
  desireFearSecret: DesireFearSecretSchema.default({}),
  cp: DiffCpComboSchema.default({}),
  sheet: CharacterSheetSevenSchema.default({}),
  soul: SoulProbeThreeSchema.default({}),
  foreshadow: z.array(ForeshadowRecoverItemSchema).default([]),
  handEdit: ShortFictionHandEdit12Schema.default({}),
  submitGate: ShortSubmitGateSchema.default({}),
  pitfalls: CharacterPitfallsThreeSchema.default({}),
  sceneBehaviorChecked: z.boolean().default(false),
  notes: z.string().default(""),
});
export type CharacterDepthWorkflow = z.infer<typeof CharacterDepthWorkflowSchema>;

export const CHARACTER_DEPTH_CHECKPOINTS: WorkflowCheckpoint[] = [
  {
    id: "cd_purpose",
    level: "inspiration",
    label: "1.目的闸",
    done: false,
    userAction: "商业/文艺择一为重",
    aiAction: "无",
    displayFields: ["purpose"],
  },
  {
    id: "cd_big5",
    level: "framework",
    label: "2.Big5底色",
    done: false,
    userAction: "五维档位+符合/不符合行为",
    aiAction: "可载入模板",
    displayFields: ["big5"],
  },
  {
    id: "cd_dfs",
    level: "framework",
    label: "3.欲惧秘",
    done: false,
    userAction: "欲望表层/深层+恐惧+终极秘密",
    aiAction: "char.bible_big5",
    displayFields: ["desireFearSecret"],
  },
  {
    id: "cd_sheet",
    level: "framework",
    label: "4.清单七栏",
    done: false,
    userAction: "基本/外貌/MBTI/动机/标志物/关系/边界",
    aiAction: "嵌七步法",
    displayFields: ["sheet"],
  },
  {
    id: "cd_scene",
    level: "framework",
    label: "5.场景行为校验",
    done: false,
    userAction: "勾场景符合/不符合已核对",
    aiAction: "无",
    displayFields: ["sceneBehaviorChecked"],
  },
  {
    id: "cd_cp",
    level: "master",
    label: "6.CP/推剧情",
    done: false,
    userAction: "选差异化CP+开端高潮清单",
    aiAction: "可扩 checklist",
    displayFields: ["cp"],
  },
  {
    id: "cd_soul",
    level: "chapter",
    label: "7.灵魂三问",
    done: false,
    userAction: "逐beat三问pass",
    aiAction: "char.soul_check",
    displayFields: ["soul"],
  },
  {
    id: "cd_pit",
    level: "framework",
    label: "8.避坑三则",
    done: false,
    userAction: "勿完美/反差需暴击/勿标签化",
    aiAction: "无",
    displayFields: ["pitfalls"],
  },
  {
    id: "cd_hand",
    level: "revise",
    label: "9.手搓12",
    done: false,
    userAction: "短篇十二步全勾",
    aiAction: "链DeAi",
    displayFields: ["handEdit"],
  },
  {
    id: "cd_submit",
    level: "revise",
    label: "10.投稿闸/回写",
    done: false,
    userAction: "字数/卡司/清痕迹+伏笔回收",
    aiAction: "薄摘要",
    displayFields: ["submitGate", "foreshadow"],
  },
];

export function validatePurposeExclusive(p: CreationPurposeGate): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!p.purpose || !p.exclusiveConfirmed) {
    return { ok: false, level: "warn", message: "须择一创作目的并确认" };
  }
  return { ok: true, level: "pass", message: `目的:${p.purpose}` };
}

export function validateSoulProbe(soul: SoulProbeThree): {
  ok: boolean;
  level: "pass" | "fail";
  message: string;
} {
  if (soul.rows.length === 0) {
    return { ok: false, level: "fail", message: "灵魂三问无 beat 行" };
  }
  const bad = soul.rows.filter((r) => !(r.q1Pass && r.q2Pass && r.q3Pass));
  if (bad.length > 0) {
    return {
      ok: false,
      level: "fail",
      message: `${bad.length} 条 beat 三问未全过`,
    };
  }
  return { ok: true, level: "pass", message: "灵魂三问全过" };
}

export function validateForeshadowRecover(
  items: ForeshadowRecoverItem[],
): {
  ok: boolean;
  level: "pass" | "fail";
  message: string;
} {
  if (items.length === 0) {
    return { ok: false, level: "fail", message: "无伏笔账本条目" };
  }
  const unrecovered = items.filter((i) => i.plant.trim() && !i.recovered);
  if (unrecovered.length > 0) {
    return {
      ok: false,
      level: "fail",
      message: `${unrecovered.length} 条伏笔未回收`,
    };
  }
  return { ok: true, level: "pass", message: "伏笔已回收" };
}

export function validateShortSubmitGate(g: ShortSubmitGate): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const over = g.wordCount > g.targetWords && g.zhihuOverlongWarned;
  const undercast =
    !g.oneHeroine || !g.oneHero || !g.hasVillain || !g.extrasOk;
  if (undercast) {
    return { ok: false, level: "warn", message: "卡司闸：须1女主1男主+反派+龙套策略" };
  }
  if (!g.chapterTitlePlain || !g.clearedStarsAndExtraLines) {
    return { ok: false, level: "warn", message: "章标题/清***空行未完成" };
  }
  if (g.wordCount > g.targetWords && !g.zhihuOverlongWarned) {
    return {
      ok: false,
      level: "warn",
      message: `字数 ${g.wordCount}>${g.targetWords}，须确认知乎超长风险`,
    };
  }
  if (over) {
    /* warned and over is allowed with warn acknowledged */
  }
  return { ok: true, level: "pass", message: "投稿闸通过" };
}

export function handEdit12Completeness(h: ShortFictionHandEdit12): {
  filled: number;
  total: number;
  complete: boolean;
} {
  const filled = h.steps.filter((s) => s.done).length;
  return { filled, total: h.steps.length, complete: filled >= 12 && h.steps.length >= 12 };
}

export function syncRelationNetFromCharacterSheet(
  sheet: CharacterSheetSeven,
): RelationshipNetRow[] {
  if (!sheet.relationNetRef.trim()) return [];
  return [
    {
      id: "sync-from-sheet",
      name: sheet.basic.split(/[,，\s]/)[0] || "主角",
      role: "protagonist",
      goalPain: sheet.motiveThree,
      function: "人设清单同步",
      relationToHero: sheet.relationNetRef,
    },
  ];
}

export function summarizeCharacterDepthToMaster(
  wf: CharacterDepthWorkflow,
): Pick<MasterOutlineBody, "characterDepthSummary"> {
  const he = handEdit12Completeness(wf.handEdit);
  const parts = [
    wf.purpose.purpose ? `目的:${wf.purpose.purpose}` : "",
    wf.cp.preset !== "custom"
      ? `CP:${DIFF_CP_PRESET_LABELS[wf.cp.preset]}`
      : wf.cp.customLabel
        ? `CP:${wf.cp.customLabel}`
        : "",
    wf.desireFearSecret.desireDeep.trim()
      ? `欲:${wf.desireFearSecret.desireDeep.slice(0, 20)}`
      : "",
    he.complete ? "手搓12齐" : "",
    validateSoulProbe(wf.soul).ok ? "三问过" : "",
  ].filter(Boolean);
  return { characterDepthSummary: parts.join(" · ") };
}

export function characterDepthWorkflowCompleteness(wf: CharacterDepthWorkflow): {
  step: number;
  filledSteps: number;
  totalSteps: number;
  missing: string[];
  canMarkHandDone: boolean;
} {
  const missing: string[] = [];
  const stepDone: boolean[] = [];

  const pur = validatePurposeExclusive(wf.purpose);
  stepDone[0] = pur.ok;
  if (!stepDone[0]) missing.push("目的闸");

  const traits = [
    wf.big5.openness,
    wf.big5.conscientiousness,
    wf.big5.extraversion,
    wf.big5.agreeableness,
    wf.big5.neuroticism,
  ];
  stepDone[1] = traits.every((t) => t.fitBehavior.trim() && t.unfitBehavior.trim());
  if (!stepDone[1]) missing.push("Big5底色");

  stepDone[2] =
    Boolean(wf.desireFearSecret.desireSurface.trim()) &&
    Boolean(wf.desireFearSecret.desireDeep.trim()) &&
    Boolean(wf.desireFearSecret.fearShadow.trim()) &&
    Boolean(wf.desireFearSecret.ultimateSecret.trim());
  if (!stepDone[2]) missing.push("欲惧秘");

  stepDone[3] =
    Boolean(wf.sheet.basic.trim()) &&
    Boolean(wf.sheet.appearance.trim()) &&
    Boolean(wf.sheet.mbtiProsCons.trim()) &&
    Boolean(wf.sheet.motiveThree.trim()) &&
    Boolean(wf.sheet.hallmarkProp.trim()) &&
    Boolean(wf.sheet.relationNetRef.trim()) &&
    Boolean(wf.sheet.behaviorBoundary.trim());
  if (!stepDone[3]) missing.push("清单七栏");

  stepDone[4] = wf.sceneBehaviorChecked;
  if (!stepDone[4]) missing.push("场景行为校验");

  stepDone[5] =
    (wf.cp.preset !== "custom" || Boolean(wf.cp.customLabel.trim())) &&
    wf.cp.openingChecklist.filter((x) => x.trim()).length >= 1 &&
    wf.cp.climaxChecklist.filter((x) => x.trim()).length >= 1;
  if (!stepDone[5]) missing.push("CP/推剧情");

  const soul = validateSoulProbe(wf.soul);
  stepDone[6] = soul.ok;
  if (!stepDone[6]) missing.push("灵魂三问");

  stepDone[7] =
    wf.pitfalls.noPerfect &&
    wf.pitfalls.contrastNeedsBeat &&
    wf.pitfalls.noLabelOnly;
  if (!stepDone[7]) missing.push("避坑三则");

  const he = handEdit12Completeness(wf.handEdit);
  const canMarkHandDone = he.complete;
  stepDone[8] = he.complete;
  if (!stepDone[8]) missing.push("手搓12");

  const fs = validateForeshadowRecover(wf.foreshadow);
  const sub = validateShortSubmitGate(wf.submitGate);
  stepDone[9] = fs.ok && sub.ok;
  if (!stepDone[9]) missing.push("投稿闸/回写");

  return {
    step: wf.currentStep,
    filledSteps: stepDone.filter(Boolean).length,
    totalSteps: 10,
    missing,
    canMarkHandDone,
  };
}

/* ───────────────────── 11.md：漫剧管线深化 ManjuPipelineWorkflow ───────────────────── */

export const CoolAbuseEventSchema = z.object({
  id: z.string(),
  label: z.string().default(""),
  kind: z.enum(["abuse", "cool", "twist"]).default("cool"),
  selected: z.boolean().default(false),
  order: z.number().int().nonnegative().default(0),
  bridgeNote: z.string().default(""),
});
export type CoolAbuseEvent = z.infer<typeof CoolAbuseEventSchema>;

export const CoarseOutlineSchema = z.object({
  events: z.array(CoolAbuseEventSchema).default([]),
  sorted: z.boolean().default(false),
  note: z.string().default("选剧情排序后补衔接；链 S2_COOL_BATCH / struct.cool_expand 灌池"),
  /** 最近一次批量扩写条数偏好 */
  lastExpandCount: z.number().int().default(10),
});
export type CoarseOutline = z.infer<typeof CoarseOutlineSchema>;

export const COOL_EXPAND_COUNTS = [10, 20, 50, 100] as const;
export type CoolExpandCount = (typeof COOL_EXPAND_COUNTS)[number];

export const HOOK_BATCH_COUNTS = [10, 50, 100] as const;
export type HookBatchCount = (typeof HOOK_BATCH_COUNTS)[number];

/** 从 Agent 表格/列表文本解析爽虐事件（人确认后导入粗纲） */
export function parseCoolExpandToEvents(
  text: string,
  opts?: { startOrder?: number },
): CoolAbuseEvent[] {
  const start = opts?.startOrder ?? 0;
  const out: CoolAbuseEvent[] = [];
  const seen = new Set<string>();
  const kindOf = (raw: string): CoolAbuseEvent["kind"] => {
    const s = raw.toLowerCase();
    if (/虐|abuse|痛/.test(s)) return "abuse";
    if (/转|twist|反转/.test(s)) return "twist";
    return "cool";
  };
  const push = (kind: CoolAbuseEvent["kind"], label: string) => {
    const t = label.replace(/^["']|["']$/g, "").trim();
    if (!t || t === "label" || t === "—" || seen.has(t)) return;
    seen.add(t);
    out.push({
      id: `ce-${Date.now()}-${out.length}`,
      label: t,
      kind,
      selected: true,
      order: start + out.length,
      bridgeNote: "",
    });
  };

  for (const m of text.matchAll(
    /-\s*kind:\s*(abuse|cool|twist)\s*\n\s*label:\s*["']?([^\n"']+)/gi,
  )) {
    push(kindOf(m[1]), m[2]);
  }

  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const table = line.match(
      /^\|\s*\d+\s*\|\s*(abuse|cool|twist|虐|爽|转)\s*\|\s*([^|]+)\|/i,
    );
    if (table) {
      push(kindOf(table[1]), table[2]);
      continue;
    }
    if (/^\|/.test(line) || /^#+/.test(line) || /^##\s/.test(line)) continue;
    const numbered = line.match(
      /^(?:\d+[\.\)、]\s*|[-*]\s*)(?:\[?(虐|爽|转|abuse|cool|twist)\]?[:：\s]+)?(.+)$/i,
    );
    if (
      numbered?.[2] &&
      numbered[2].length > 2 &&
      !/^(kind:|model:|bridge|label:)/i.test(numbered[2])
    ) {
      push(numbered[1] ? kindOf(numbered[1]) : "cool", numbered[2]);
    }
  }
  return out;
}

export const EpisodeRhythmBandSchema = z.enum([
  "ep1_heaviest",
  "ep2_3",
  "ep3_10_big",
  "ep10_paywall",
]);
export type EpisodeRhythmBand = z.infer<typeof EpisodeRhythmBandSchema>;

export const EPISODE_RHYTHM_LABELS: Record<EpisodeRhythmBand, string> = {
  ep1_heaviest: "第1集最重（黄金钩）",
  ep2_3: "第2–3集承压/反转",
  ep3_10_big: "第3–10集大事件推进",
  ep10_paywall: "第10集一卡付费点",
};

export const EpisodeRhythmSlotSchema = z.object({
  band: EpisodeRhythmBandSchema,
  plan: z.string().default(""),
  done: z.boolean().default(false),
});
export type EpisodeRhythmSlot = z.infer<typeof EpisodeRhythmSlotSchema>;

export const EpisodeRhythmPlanSchema = z.object({
  slots: z
    .array(EpisodeRhythmSlotSchema)
    .default([
      { band: "ep1_heaviest", plan: "", done: false },
      { band: "ep2_3", plan: "", done: false },
      { band: "ep3_10_big", plan: "", done: false },
      { band: "ep10_paywall", plan: "", done: false },
    ]),
  naturalLanguageOutline: z.boolean().default(false),
  noQiChengZhuanHePrompt: z.boolean().default(false),
  note: z.string().default("集纲自然语言200–600字/集；删起承转合提示词"),
});
export type EpisodeRhythmPlan = z.infer<typeof EpisodeRhythmPlanSchema>;

export const RejectThreeCheckSchema = z.object({
  noNovelization: z.boolean().default(false),
  noLiveActionThinking: z.boolean().default(false),
  noHomogenization: z.boolean().default(false),
  note: z.string().default("三类拒稿：小说化/实拍思维/同质化"),
});
export type RejectThreeCheck = z.infer<typeof RejectThreeCheckSchema>;

export const DIALOGUE_13_RULES = [
  "短句为主",
  "禁长段独白",
  "态度先于信息",
  "潜台词可留白",
  "身份用词差",
  "冲突对撞",
  "禁解说剧情",
  "OS克制",
  "闪回服务钩子",
  "场次≤3",
  "动作△可视",
  "禁小说化心理堆砌",
  "结尾钩子可台词落地",
] as const;

export const Dialogue13LiteSchema = z.object({
  checks: z
    .array(z.object({ id: z.string(), label: z.string(), done: z.boolean().default(false) }))
    .default(
      DIALOGUE_13_RULES.map((label, i) => ({
        id: `d13-${i + 1}`,
        label,
        done: false,
      })),
    ),
  note: z.string().default("轻清单；完整三层见 dialogue 台"),
});
export type Dialogue13Lite = z.infer<typeof Dialogue13LiteSchema>;

export const PitchEthicsGateSchema = z.object({
  onePitchOneOutlet: z.boolean().default(false),
  confidentialityNoted: z.boolean().default(false),
  homeworkSeparatedFromPitch: z.boolean().default(false),
  revenueMode: z.enum(["guarantee", "share", "buyout", "unknown"]).default("unknown"),
  note: z.string().default("一稿一投·保密·作业与已投稿分离"),
});
export type PitchEthicsGate = z.infer<typeof PitchEthicsGateSchema>;

export const LoglineSocialConfirmSchema = z.object({
  text: z.string().default(""),
  toldFriend: z.boolean().default(false),
  friendAudienceMatch: z.boolean().default(false),
  passed: z.boolean().default(false),
  note: z.string().default("讲给目标受众朋友听；不过关弃梗。加深 Logline100Ack"),
});
export type LoglineSocialConfirm = z.infer<typeof LoglineSocialConfirmSchema>;

/** 16.md：提示词三层删减 */
export const PromptTrimAckSchema = z.object({
  genderTrim: z.boolean().default(false),
  subGenreTrim: z.boolean().default(false),
  platformTrim: z.boolean().default(false),
});
export type PromptTrimAck = z.infer<typeof PromptTrimAckSchema>;

export const OutlinePerEpReviewSchema = z.object({
  ep: z.number().int().min(1).max(10),
  coolOk: z.boolean().default(false),
  crisisOk: z.boolean().default(false),
  done: z.boolean().default(false),
});
export type OutlinePerEpReview = z.infer<typeof OutlinePerEpReviewSchema>;

export const RollingMilestoneSchema = z.enum(["pitch", "post_10_30", "outline_60"]);
export type RollingMilestone = z.infer<typeof RollingMilestoneSchema>;

export const EpisodeFunctionCardSchema = z.object({
  id: z.string(),
  episodeNo: z.number().int().positive().default(1),
  segment: z.number().int().positive().default(1),
  functionLabel: z.string().default(""),
  note: z.string().default(""),
});
export type EpisodeFunctionCard = z.infer<typeof EpisodeFunctionCardSchema>;

/* ─── 实操手册：十八爽点 + 卡点三类（单一真相源；≠ L6 cool12） ─── */

export const MANJU_COOL18_MODELS = [
  { id: "绝对惩戒", dim: "力量与征服", tip: "先拉仇恨→过程羞辱→终极惩罚→名正言顺接收" },
  { id: "扮猪吃虎", dim: "力量与征服", tip: "铺垫轻视→雷霆爆发→嘲讽回旋镖" },
  { id: "装逼打脸", dim: "力量与征服", tip: "身份隐藏与第三方点破，氛围瞬间逆转" },
  { id: "掠夺与暴富", dim: "力量与征服", tip: "正当性+稀缺性+暴富瞬间可视化" },
  { id: "绝境反杀", dim: "成长与逆袭", tip: "观众信没救了再反杀，结果须震撼" },
  { id: "永不屈服", dim: "成长与逆袭", tip: "信念+惨状反衬+配角共鸣" },
  { id: "力挽狂澜", dim: "成长与逆袭", tip: "群体绝望峰值时主角如神兵天降" },
  { id: "持之以恒", dim: "成长与逆袭", tip: "量化努力+即时反馈展示成果" },
  { id: "智商碾压", dim: "智慧与谋略", tip: "见招拆招/局中有局/后手揭秘" },
  { id: "幕后黑手", dim: "智慧与谋略", tip: "身份反差+操控局势+终局揭晓" },
  { id: "慧眼识珠", dim: "智慧与谋略", tip: "众人皆醉我独醒+立刻验证价值" },
  { id: "偷听秘闻", dim: "智慧与谋略", tip: "关键时机听到关键秘密" },
  { id: "报仇雪恨", dim: "情感与关系", tip: "刻骨仇恨+延时满足+完美闭环" },
  { id: "被偏爱", dim: "情感与关系", tip: "高冷对象当众表态偏袒" },
  { id: "英雄救美", dim: "情感与关系", tip: "最绝望时刻出手并推进关系" },
  { id: "寻宝奇遇", dim: "机遇与命运", tip: "我得到你们没有的优越感" },
  { id: "意外之喜", dim: "机遇与命运", tip: "无心善举后期破局" },
  { id: "俄罗斯套娃", dim: "机遇与命运", tip: "上面还有天，永不终结期待" },
] as const;

export const MANJU_COOL18_NAMES = MANJU_COOL18_MODELS.map((m) => m.id);

export const MANJU_KARTIAN_TYPES = [
  {
    category: "悬念勾子",
    goal: "然后呢？",
    types: ["危机降临", "未解之谜", "惊人宣言", "关键转折"],
  },
  {
    category: "爽点爆点",
    goal: "太牛了！",
    types: ["实力打脸", "认知反差", "势力反应", "收获时刻"],
  },
  {
    category: "情感钩",
    goal: "有温度、愿共情",
    types: ["守护宣言", "情感联结"],
  },
] as const;

export const MANJU_KARTIAN_TYPE_NAMES = MANJU_KARTIAN_TYPES.flatMap((c) => [...c.types]);

export const MANJU_MALE_GENRE_POOL = [
  "脑洞异能",
  "末世",
  "玄幻修仙",
  "灵气复苏",
  "全球高武",
  "系统",
  "灵兽",
  "游戏",
  "异兽",
  "高武",
  "架空历史",
  "求生",
  "全民",
  "西游洪荒",
  "诡异",
  "悬疑",
] as const;

export const MANJU_FEMALE_GENRE_POOL = [
  "婚恋",
  "甜宠",
  "重生复仇",
  "大女主爽文",
  "萌宝",
  "马甲团宠",
  "宫斗宅斗",
  "打脸虐渣",
] as const;

export const MarketGenreAckSchema = z.object({
  maleGenres: z.array(z.string()).default([]),
  femaleGenres: z.array(z.string()).default([]),
  brainHole: z.boolean().default(false),
  strongConflict: z.boolean().default(false),
  coolTrope: z.boolean().default(false),
  fastPace: z.boolean().default(false),
  payoffEarly: z.boolean().default(false),
  sinkAudience: z.boolean().default(false),
});
export type MarketGenreAck = z.infer<typeof MarketGenreAckSchema>;

export const HookBatchRoundSchema = z.object({
  round: z.number().int().positive(),
  count: z.number().int().nonnegative().default(10),
  keepIds: z.array(z.string()).default([]),
  note: z.string().default(""),
});
export type HookBatchRound = z.infer<typeof HookBatchRoundSchema>;

export const Ep10TableAcceptRoundSchema = z.object({
  round: z.number().int().positive(),
  accepted: z.boolean().default(false),
  note: z.string().default(""),
});
export type Ep10TableAcceptRound = z.infer<typeof Ep10TableAcceptRoundSchema>;

export const ScriptFormatGateSchema = z.object({
  wordBand800_1200: z.boolean().default(false),
  scenesMax3: z.boolean().default(false),
  dialogueMax500: z.boolean().default(false),
  sceneHeaderFormat: z.boolean().default(false),
  deNovelizeAck: z.boolean().default(false),
});
export type ScriptFormatGate = z.infer<typeof ScriptFormatGateSchema>;

export const DialogueHarshChecklistSchema = z.object({
  shortHarsh: z.boolean().default(false),
  barbedHook: z.boolean().default(false),
  contrastShock: z.boolean().default(false),
  evidenceSlap: z.boolean().default(false),
  crowdReaction: z.boolean().default(false),
  pacePingPong: z.boolean().default(false),
  note: z.string().default("旁挂 DialogueTriple，不替换三层公式"),
});
export type DialogueHarshChecklist = z.infer<typeof DialogueHarshChecklistSchema>;

export const ExtendFormSchema = z.object({
  blockFrom: z.number().int().positive().default(11),
  blockTo: z.number().int().positive().default(20),
  conflictUpgrade: z.string().default(""),
  foreshadowSync: z.boolean().default(false),
  humanVerdict: z.enum(["pending", "reject", "accept"]).default("pending"),
});
export type ExtendForm = z.infer<typeof ExtendFormSchema>;

export const ManjuHandbookOpsSchema = z.object({
  marketGenreAck: MarketGenreAckSchema.default({}),
  hookBatchRounds: z.array(HookBatchRoundSchema).default([]),
  ep10TableAccept: z.array(Ep10TableAcceptRoundSchema).default([]),
  scriptFormatGate: ScriptFormatGateSchema.default({}),
  dialogueHarshChecklist: DialogueHarshChecklistSchema.default({}),
  extendForm: ExtendFormSchema.default({}),
  /** 弱联动：选中的 cool18 写入草稿 */
  pickedCool18Draft: z.array(z.string()).default([]),
});
export type ManjuHandbookOps = z.infer<typeof ManjuHandbookOpsSchema>;

export const ManjuPipelineWorkflowSchema = z.object({
  schemaVersion: z.literal("nines-11.md/1").default("nines-11.md/1"),
  currentStep: z.number().int().min(0).max(9).default(0),
  loglineSocial: LoglineSocialConfirmSchema.default({}),
  coarse: CoarseOutlineSchema.default({}),
  rhythm: EpisodeRhythmPlanSchema.default({}),
  rejectThree: RejectThreeCheckSchema.default({}),
  dialogue13: Dialogue13LiteSchema.default({}),
  ethics: PitchEthicsGateSchema.default({}),
  bioBeforeOutlineNoted: z.boolean().default(false),
  fourPackReady: z.boolean().default(false),
  /** 16.md 考拉深化 */
  promptTrimAck: PromptTrimAckSchema.default({}),
  outlinePerEpReview: z
    .array(OutlinePerEpReviewSchema)
    .default(
      Array.from({ length: 10 }, (_, i) => ({
        ep: i + 1,
        coolOk: false,
        crisisOk: false,
        done: false,
      })),
    ),
  rollingMilestone: RollingMilestoneSchema.default("pitch"),
  syncOutlineOnBodyEdit: z.boolean().default(false),
  toolPairNoted: z.boolean().default(false),
  episodeFunctionCards: z.array(EpisodeFunctionCardSchema).default([]),
  /** 实操手册 SOP 中间态（嵌本管线，不另建 Workflow） */
  handbookOps: ManjuHandbookOpsSchema.default({}),
  notes: z.string().default(""),
});
export type ManjuPipelineWorkflow = z.infer<typeof ManjuPipelineWorkflowSchema>;

export const MANJU_PIPELINE_CHECKPOINTS: WorkflowCheckpoint[] = [
  {
    id: "mp_logline",
    level: "inspiration",
    label: "1.100字社交确认",
    done: false,
    userAction: "讲给朋友听并勾通过",
    aiAction: "链 Logline100Ack",
    displayFields: ["loglineSocial"],
  },
  {
    id: "mp_coarse",
    level: "master",
    label: "2.粗纲排序",
    done: false,
    userAction: "选爽虐事件排序+衔接",
    aiAction: "链 S2_COOL_BATCH",
    displayFields: ["coarse"],
  },
  {
    id: "mp_rhythm",
    level: "chapter",
    label: "3.集纲节奏",
    done: false,
    userAction: "填四段节奏+自然语言声明",
    aiAction: "可建议钩子",
    displayFields: ["rhythm"],
  },
  {
    id: "mp_bio",
    level: "framework",
    label: "4.人设先于大纲声明",
    done: false,
    userAction: "确认考拉权威：BioAck 先于 Outline",
    aiAction: "无",
    displayFields: ["bioBeforeOutlineNoted"],
  },
  {
    id: "mp_reject",
    level: "revise",
    label: "5.拒稿三检",
    done: false,
    userAction: "小说化/实拍/同质化",
    aiAction: "链去AI",
    displayFields: ["rejectThree"],
  },
  {
    id: "mp_d13",
    level: "draft",
    label: "6.台词13条",
    done: false,
    userAction: "轻勾≥8条",
    aiAction: "链 dialogue",
    displayFields: ["dialogue13"],
  },
  {
    id: "mp_ethics",
    level: "revise",
    label: "7.投稿伦理",
    done: false,
    userAction: "一稿一投+保密",
    aiAction: "无",
    displayFields: ["ethics"],
  },
  {
    id: "mp_pack",
    level: "revise",
    label: "8.四件套齐套",
    done: false,
    userAction: "勾四件套就绪（链 Pitch）",
    aiAction: "deliver.pitch_pack",
    displayFields: ["fourPackReady"],
  },
  {
    id: "mp_sync",
    level: "revise",
    label: "9.回写总纲",
    done: false,
    userAction: "摘要非空",
    aiAction: "薄回写",
    displayFields: ["notes"],
  },
  {
    id: "mp_done",
    level: "revise",
    label: "10.管线完成",
    done: false,
    userAction: "前步齐",
    aiAction: "无",
    displayFields: [],
  },
];

export function validateLoglineSocial(l: LoglineSocialConfirm): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!l.text.trim()) return { ok: false, level: "warn", message: "100字文案未填" };
  if (!l.toldFriend || !l.friendAudienceMatch || !l.passed) {
    return { ok: false, level: "warn", message: "须讲给朋友听并确认通过" };
  }
  return { ok: true, level: "pass", message: "100字社交确认通过" };
}

export function validateCoarseOutline(c: CoarseOutline): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const selected = c.events.filter((e) => e.selected);
  if (selected.length < 3) {
    return { ok: false, level: "warn", message: "粗纲至少选3个事件" };
  }
  if (!c.sorted) return { ok: false, level: "warn", message: "粗纲未确认排序" };
  return { ok: true, level: "pass", message: `粗纲 ${selected.length} 事件已排序` };
}

export function validateEpisodeRhythm(r: EpisodeRhythmPlan): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const done = r.slots.filter((s) => s.done || s.plan.trim()).length;
  if (done < 4 || !r.naturalLanguageOutline || !r.noQiChengZhuanHePrompt) {
    return { ok: false, level: "warn", message: "集纲节奏四段+自然语言声明未齐" };
  }
  return { ok: true, level: "pass", message: "集纲节奏对齐" };
}

export function validateRejectThree(r: RejectThreeCheck): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!r.noNovelization || !r.noLiveActionThinking || !r.noHomogenization) {
    return { ok: false, level: "warn", message: "拒稿三检未齐" };
  }
  return { ok: true, level: "pass", message: "拒稿三检通过" };
}

export function validatePitchEthics(e: PitchEthicsGate): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!e.onePitchOneOutlet || !e.confidentialityNoted) {
    return { ok: false, level: "warn", message: "一稿一投/保密未确认" };
  }
  return { ok: true, level: "pass", message: "投稿伦理通过" };
}

export function validatePromptTrimAck(p: PromptTrimAck): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!p.genderTrim || !p.subGenreTrim || !p.platformTrim) {
    return { ok: false, level: "warn", message: "三层删减未齐" };
  }
  return { ok: true, level: "pass", message: "提示词三层删减齐" };
}

export function validateOutlinePerEpReview(
  rows: OutlinePerEpReview[],
): { ok: boolean; level: "pass" | "warn"; message: string } {
  const done = rows.filter((r) => r.done && r.coolOk && r.crisisOk).length;
  if (done < 10) {
    return { ok: false, level: "warn", message: `十集校正 ${done}/10` };
  }
  return { ok: true, level: "pass", message: "十集大纲逐集校正齐" };
}

export function summarizeManjuKoalaToMaster(
  wf: ManjuPipelineWorkflow,
): Pick<MasterOutlineBody, "manjuKoalaSummary"> {
  const parts = [
    validatePromptTrimAck(wf.promptTrimAck).ok ? "三层删减" : "",
    validateOutlinePerEpReview(wf.outlinePerEpReview).ok ? "十集校正" : "",
    `滚动:${wf.rollingMilestone}`,
    wf.toolPairNoted ? "一主一辅" : "",
    wf.syncOutlineOnBodyEdit ? "正文改纲" : "",
  ].filter(Boolean);
  return { manjuKoalaSummary: parts.join(" · ") };
}

export function manjuKoalaCompleteness(wf: ManjuPipelineWorkflow): {
  filledSteps: number;
  totalSteps: number;
  missing: string[];
} {
  const missing: string[] = [];
  const stepDone: boolean[] = [];
  stepDone[0] = validatePromptTrimAck(wf.promptTrimAck).ok;
  if (!stepDone[0]) missing.push("三层删减");
  stepDone[1] = wf.toolPairNoted;
  if (!stepDone[1]) missing.push("一主一辅");
  stepDone[2] = validateOutlinePerEpReview(wf.outlinePerEpReview).ok;
  if (!stepDone[2]) missing.push("十集校正");
  stepDone[3] = wf.syncOutlineOnBodyEdit;
  if (!stepDone[3]) missing.push("正文改纲同步");
  stepDone[4] =
    wf.rollingMilestone === "post_10_30" || wf.rollingMilestone === "outline_60";
  if (!stepDone[4]) missing.push("滚动里程碑");
  stepDone[5] = Boolean(summarizeManjuKoalaToMaster(wf).manjuKoalaSummary.trim());
  if (!stepDone[5]) missing.push("考拉摘要");
  return {
    filledSteps: stepDone.filter(Boolean).length,
    totalSteps: 6,
    missing,
  };
}

export function summarizeManjuPipelineToMaster(
  wf: ManjuPipelineWorkflow,
): Pick<
  MasterOutlineBody,
  "manjuPipelineSummary" | "manjuKoalaSummary" | "manjuHandbookSummary"
> {
  const parts = [
    validateLoglineSocial(wf.loglineSocial).ok ? "100字社交OK" : "",
    validateCoarseOutline(wf.coarse).ok ? "粗纲齐" : "",
    validateEpisodeRhythm(wf.rhythm).ok ? "节奏齐" : "",
    wf.fourPackReady ? "四件套" : "",
    wf.ethics.onePitchOneOutlet ? "一稿一投" : "",
  ].filter(Boolean);
  return {
    manjuPipelineSummary: parts.join(" · "),
    ...summarizeManjuKoalaToMaster(wf),
    ...summarizeManjuHandbookToMaster(wf.handbookOps ?? ManjuHandbookOpsSchema.parse({})),
  };
}

export function manjuPipelineWorkflowCompleteness(wf: ManjuPipelineWorkflow): {
  step: number;
  filledSteps: number;
  totalSteps: number;
  missing: string[];
} {
  const missing: string[] = [];
  const stepDone: boolean[] = [];
  stepDone[0] = validateLoglineSocial(wf.loglineSocial).ok;
  if (!stepDone[0]) missing.push("100字社交确认");
  stepDone[1] = validateCoarseOutline(wf.coarse).ok;
  if (!stepDone[1]) missing.push("粗纲排序");
  stepDone[2] = validateEpisodeRhythm(wf.rhythm).ok;
  if (!stepDone[2]) missing.push("集纲节奏");
  stepDone[3] = wf.bioBeforeOutlineNoted;
  if (!stepDone[3]) missing.push("人设先于大纲声明");
  stepDone[4] = validateRejectThree(wf.rejectThree).ok;
  if (!stepDone[4]) missing.push("拒稿三检");
  const d13 = wf.dialogue13.checks.filter((c) => c.done).length;
  stepDone[5] = d13 >= 8;
  if (!stepDone[5]) missing.push("台词13条");
  stepDone[6] = validatePitchEthics(wf.ethics).ok;
  if (!stepDone[6]) missing.push("投稿伦理");
  stepDone[7] = wf.fourPackReady;
  if (!stepDone[7]) missing.push("四件套齐套");
  stepDone[8] = Boolean(summarizeManjuPipelineToMaster(wf).manjuPipelineSummary.trim());
  if (!stepDone[8]) missing.push("回写总纲");
  stepDone[9] = stepDone.slice(0, 9).every(Boolean);
  if (!stepDone[9]) missing.push("管线完成");
  return {
    step: wf.currentStep,
    filledSteps: stepDone.filter(Boolean).length,
    totalSteps: 10,
    missing,
  };
}

/* ───────────────────── 12.md：漫剧题材轨 ManjuGenreTrackWorkflow ───────────────────── */

export const ManjuGenreTrackKindSchema = z.enum([
  "upgrade",
  "anti_trope",
  "regret",
]);
export type ManjuGenreTrackKind = z.infer<typeof ManjuGenreTrackKindSchema>;

export const MANJU_GENRE_TRACK_LABELS: Record<ManjuGenreTrackKind, string> = {
  upgrade: "升级流（新人友好）",
  anti_trope: "反套路",
  regret: "后悔流",
};

export const UpgradeSevenBeatSchema = z.object({
  buffStack: z.string().default(""),
  strike: z.string().default(""),
  goldFingerOn: z.string().default(""),
  revengeMain: z.string().default(""),
  growSameTier: z.string().default(""),
  developCross: z.string().default(""),
  climax: z.string().default(""),
});
export type UpgradeSevenBeat = z.infer<typeof UpgradeSevenBeatSchema>;

export const AntiTropeThreeLayerSchema = z.object({
  characterLayer: z.string().default(""),
  plotLayer: z.string().default(""),
  worldLayer: z.string().default(""),
  writeToPlotLayer: z.boolean().default(true),
  tropeStockNoted: z.boolean().default(false),
});
export type AntiTropeThreeLayer = z.infer<typeof AntiTropeThreeLayerSchema>;

export const RegretTrackSchema = z.object({
  passiveWaitRegret: z.string().default(""),
  payHistoryFull: z.string().default(""),
  openingBuffStack: z.string().default(""),
  contrastWithUpgrade: z.string().default(""),
});
export type RegretTrack = z.infer<typeof RegretTrackSchema>;

export const EpisodeQuotaPlanSchema = z.object({
  openingEps: z.number().int().default(4),
  growEps: z.number().int().default(10),
  developEps: z.number().int().default(10),
  climaxEps: z.number().int().default(1),
  note: z.string().default("开场3–5 / 成长10 / 发展10 / 高潮1"),
});
export type EpisodeQuotaPlan = z.infer<typeof EpisodeQuotaPlanSchema>;

export const MANJU_DISCOURAGED_TOPICS = [
  "诡异",
  "国运/气运擂台",
  "斩仙台",
  "双主角/双穿越",
  "多世界堆砌",
  "无敌流灌水",
  "末世温馨无冲突",
] as const;

export const DiscouragedTopicCheckSchema = z.object({
  avoided: z.array(z.string()).default([]),
  allChecked: z.boolean().default(false),
});
export type DiscouragedTopicCheck = z.infer<typeof DiscouragedTopicCheckSchema>;

export const BenchmarkCollectionGateSchema = z.object({
  title: z.string().default(""),
  collectionCount: z.number().int().nonnegative().default(0),
  threshold: z.number().int().default(50000),
  deepDissectOk: z.boolean().default(false),
  note: z.string().default("收藏>5万才深拆；点击/评论辅看"),
});
export type BenchmarkCollectionGate = z.infer<typeof BenchmarkCollectionGateSchema>;

export const KernelExtractDrillSchema = z.object({
  humanFive: z
    .object({
      who: z.string().default(""),
      world: z.string().default(""),
      power: z.string().default(""),
      conflict: z.string().default(""),
      reward: z.string().default(""),
    })
    .default({}),
  aiFiveBrief: z.string().default(""),
  compared: z.boolean().default(false),
  note: z.string().default("先人手填五要素再 AI；链 SettingWorkbench"),
});
export type KernelExtractDrill = z.infer<typeof KernelExtractDrillSchema>;

export const GenderFreqHintSchema = z.object({
  female: z.string().default("女频：重制作/讨喜/情感线"),
  male: z.string().default("男频：事业线；主角可不那么讨喜"),
  acknowledged: z.boolean().default(false),
});
export type GenderFreqHint = z.infer<typeof GenderFreqHintSchema>;

export const ManjuGenreTrackWorkflowSchema = z.object({
  schemaVersion: z.literal("nines-12.md/1").default("nines-12.md/1"),
  currentStep: z.number().int().min(0).max(9).default(0),
  track: ManjuGenreTrackKindSchema.optional(),
  upgrade: UpgradeSevenBeatSchema.default({}),
  antiTrope: AntiTropeThreeLayerSchema.default({}),
  regret: RegretTrackSchema.default({}),
  quota: EpisodeQuotaPlanSchema.default({}),
  discouraged: DiscouragedTopicCheckSchema.default({}),
  benchmark: BenchmarkCollectionGateSchema.default({}),
  kernel: KernelExtractDrillSchema.default({}),
  genderHint: GenderFreqHintSchema.default({}),
  settingPackLinked: z.boolean().default(false),
  notes: z.string().default(""),
});
export type ManjuGenreTrackWorkflow = z.infer<typeof ManjuGenreTrackWorkflowSchema>;

export const MANJU_GENRE_TRACK_CHECKPOINTS: WorkflowCheckpoint[] = [
  {
    id: "gt_pick",
    level: "inspiration",
    label: "1.选题材轨",
    done: false,
    userAction: "升级/反套路/后悔三选一",
    aiAction: "无",
    displayFields: ["track"],
  },
  {
    id: "gt_discourage",
    level: "inspiration",
    label: "2.不推荐自检",
    done: false,
    userAction: "勾避坑清单",
    aiAction: "链 genre_trim",
    displayFields: ["discouraged"],
  },
  {
    id: "gt_trackfill",
    level: "master",
    label: "3.题材框架填",
    done: false,
    userAction: "按轨填七段/三层/后悔对照",
    aiAction: "可扩写",
    displayFields: ["upgrade", "antiTrope", "regret"],
  },
  {
    id: "gt_quota",
    level: "chapter",
    label: "4.集数配额",
    done: false,
    userAction: "开场/成长/发展/高潮",
    aiAction: "无",
    displayFields: ["quota"],
  },
  {
    id: "gt_bench",
    level: "inspiration",
    label: "5.对标收藏闸",
    done: false,
    userAction: "收藏>阈值才深拆",
    aiAction: "analytics",
    displayFields: ["benchmark"],
  },
  {
    id: "gt_kernel",
    level: "master",
    label: "6.提炼内核",
    done: false,
    userAction: "人手五要素+对照AI",
    aiAction: "topic.world_setting",
    displayFields: ["kernel"],
  },
  {
    id: "gt_gender",
    level: "framework",
    label: "7.男女频提示",
    done: false,
    userAction: "确认差异提示",
    aiAction: "无",
    displayFields: ["genderHint"],
  },
  {
    id: "gt_setting",
    level: "framework",
    label: "8.链设定包",
    done: false,
    userAction: "勾已链 SettingWorkbench",
    aiAction: "topic.world_setting",
    displayFields: ["settingPackLinked"],
  },
  {
    id: "gt_sync",
    level: "revise",
    label: "9.回写摘要",
    done: false,
    userAction: "摘要非空",
    aiAction: "薄回写",
    displayFields: ["notes"],
  },
  {
    id: "gt_done",
    level: "revise",
    label: "10.题材轨完成",
    done: false,
    userAction: "前步齐",
    aiAction: "无",
    displayFields: [],
  },
];

export function validateBenchmarkCollection(b: BenchmarkCollectionGate): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!b.title.trim()) return { ok: false, level: "warn", message: "对标剧未填" };
  if (b.collectionCount < b.threshold) {
    return {
      ok: false,
      level: "warn",
      message: `收藏 ${b.collectionCount}<${b.threshold}，勿深拆`,
    };
  }
  if (!b.deepDissectOk) {
    return { ok: false, level: "warn", message: "未确认可深拆" };
  }
  return { ok: true, level: "pass", message: "对标收藏闸通过" };
}

export function validateGenreTrackFill(wf: ManjuGenreTrackWorkflow): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!wf.track) return { ok: false, level: "warn", message: "未选题材轨" };
  if (wf.track === "upgrade") {
    const u = wf.upgrade;
    const ok = [
      u.buffStack,
      u.strike,
      u.goldFingerOn,
      u.revengeMain,
      u.growSameTier,
      u.developCross,
      u.climax,
    ].every((x) => x.trim());
    return ok
      ? { ok: true, level: "pass", message: "升级流七段齐" }
      : { ok: false, level: "warn", message: "升级流七段未齐" };
  }
  if (wf.track === "anti_trope") {
    const a = wf.antiTrope;
    const ok =
      Boolean(a.characterLayer.trim()) &&
      Boolean(a.plotLayer.trim()) &&
      a.writeToPlotLayer &&
      a.tropeStockNoted;
    return ok
      ? { ok: true, level: "pass", message: "反套路至剧情层" }
      : { ok: false, level: "warn", message: "反套路三层未齐" };
  }
  const r = wf.regret;
  const ok =
    Boolean(r.passiveWaitRegret.trim()) &&
    Boolean(r.payHistoryFull.trim()) &&
    Boolean(r.openingBuffStack.trim());
  return ok
    ? { ok: true, level: "pass", message: "后悔流齐" }
    : { ok: false, level: "warn", message: "后悔流未齐" };
}

export function validateKernelExtract(k: KernelExtractDrill): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const fiveOk = Object.values(k.humanFive).every((v) => v.trim());
  if (!fiveOk) return { ok: false, level: "warn", message: "人手五要素未齐" };
  if (!k.compared) return { ok: false, level: "warn", message: "未与AI对照" };
  return { ok: true, level: "pass", message: "提炼内核对照完成" };
}

export function summarizeManjuGenreTrackToMaster(
  wf: ManjuGenreTrackWorkflow,
): Pick<MasterOutlineBody, "manjuGenreTrackSummary"> {
  const parts = [
    wf.track ? `轨:${MANJU_GENRE_TRACK_LABELS[wf.track]}` : "",
    validateBenchmarkCollection(wf.benchmark).ok ? "对标>5万" : "",
    wf.settingPackLinked ? "已链设定包" : "",
    wf.discouraged.allChecked ? "避坑齐" : "",
  ].filter(Boolean);
  return { manjuGenreTrackSummary: parts.join(" · ") };
}

export function manjuGenreTrackWorkflowCompleteness(wf: ManjuGenreTrackWorkflow): {
  step: number;
  filledSteps: number;
  totalSteps: number;
  missing: string[];
} {
  const missing: string[] = [];
  const stepDone: boolean[] = [];
  stepDone[0] = Boolean(wf.track);
  if (!stepDone[0]) missing.push("选题材轨");
  stepDone[1] =
    wf.discouraged.allChecked &&
    wf.discouraged.avoided.length >= MANJU_DISCOURAGED_TOPICS.length;
  if (!stepDone[1]) missing.push("不推荐自检");
  stepDone[2] = validateGenreTrackFill(wf).ok;
  if (!stepDone[2]) missing.push("题材框架填");
  stepDone[3] =
    wf.quota.openingEps >= 3 &&
    wf.quota.openingEps <= 5 &&
    wf.quota.growEps === 10 &&
    wf.quota.developEps === 10 &&
    wf.quota.climaxEps === 1;
  if (!stepDone[3]) missing.push("集数配额");
  stepDone[4] = validateBenchmarkCollection(wf.benchmark).ok;
  if (!stepDone[4]) missing.push("对标收藏闸");
  stepDone[5] = validateKernelExtract(wf.kernel).ok;
  if (!stepDone[5]) missing.push("提炼内核");
  stepDone[6] = wf.genderHint.acknowledged;
  if (!stepDone[6]) missing.push("男女频提示");
  stepDone[7] = wf.settingPackLinked;
  if (!stepDone[7]) missing.push("链设定包");
  stepDone[8] = Boolean(summarizeManjuGenreTrackToMaster(wf).manjuGenreTrackSummary.trim());
  if (!stepDone[8]) missing.push("回写摘要");
  stepDone[9] = stepDone.slice(0, 9).every(Boolean);
  if (!stepDone[9]) missing.push("题材轨完成");
  return {
    step: wf.currentStep,
    filledSteps: stepDone.filter(Boolean).length,
    totalSteps: 10,
    missing,
  };
}

/* ───────────────────── 13.md：IP 改编 IpAdaptWorkflow ───────────────────── */

export const IP_UNSUITABLE_TYPES = [
  "纯古装大历史",
  "漫人文大世界",
  "多线叙事",
  "群像",
  "双主角",
  "心理流",
] as const;

/** 番茄选书参考尺（人工填；不接实时 API） */
export const IP_TOMATO_REF = {
  reads: 100_000,
  comments: 5_000,
  rating: 4.8,
} as const;

export const IP_STRUCTURE_CHECK_LABELS = [
  "5–10章一爆点",
  "强冲突",
  "动作多",
  "画面强",
  "节奏快",
] as const;

export const IpStructureChecksSchema = z.object({
  burstEvery5to10: z.boolean().default(false),
  strongConflict: z.boolean().default(false),
  actionHeavy: z.boolean().default(false),
  visualStrong: z.boolean().default(false),
  paceFast: z.boolean().default(false),
});
export type IpStructureChecks = z.infer<typeof IpStructureChecksSchema>;

export const IpSelectScorecardSchema = z.object({
  dataOk: z.boolean().default(false),
  genreOk: z.boolean().default(false),
  structureFriendly: z.boolean().default(false),
  characterOk: z.boolean().default(false),
  structureChecks: IpStructureChecksSchema.default({}),
  readsApprox: z.number().int().nonnegative().default(0),
  commentsApprox: z.number().int().nonnegative().default(0),
  ratingApprox: z.number().min(0).max(5).default(0),
  finishRateOk: z.boolean().default(false),
  unsuitableHits: z.array(z.string()).default([]),
  copyrightConfirmed: z.boolean().default(false),
  platformAcceptsAdapt: z.boolean().default(false),
  note: z.string().default("四指标重点：结构友好+人物；番茄参考阈值仅人工填"),
});
export type IpSelectScorecard = z.infer<typeof IpSelectScorecardSchema>;

export const AdaptBudgetLiteSchema = z.object({
  sourceWords: z.number().int().nonnegative().default(0),
  chapterCount: z.number().int().nonnegative().default(0),
  targetEpisodes: z.number().int().positive().default(60),
  batchFrom: z.number().int().nonnegative().default(1),
  batchTo: z.number().int().nonnegative().default(20),
});
export type AdaptBudgetLite = z.infer<typeof AdaptBudgetLiteSchema>;

export const AdaptAnchorTableSchema = z.object({
  mainGoal: z.string().default(""),
  corePersona: z.string().default(""),
  goldFinger: z.string().default(""),
  worldRules: z.string().default(""),
  canCutSide: z.boolean().default(true),
  canMergeSupport: z.boolean().default(true),
  canReorder: z.boolean().default(true),
  canFrontloadCool: z.boolean().default(true),
});
export type AdaptAnchorTable = z.infer<typeof AdaptAnchorTableSchema>;

export const AdaptLoglinePackSchema = z.object({
  identity: z.string().default(""),
  coreConflict: z.string().default(""),
  turnChance: z.string().default(""),
  goldFinger: z.string().default(""),
  openConflict: z.string().default(""),
  dilemma: z.string().default(""),
  coreContradict: z.string().default(""),
  turnHook: z.string().default(""),
  powerGap: z.string().default(""),
});
export type AdaptLoglinePack = z.infer<typeof AdaptLoglinePackSchema>;

export const UnitCutRowSchema = z.object({
  id: z.string(),
  chapterFrom: z.number().int().positive().default(1),
  chapterTo: z.number().int().positive().default(3),
  conflict: z.string().default(""),
  emotionScore: z.number().min(-10).max(10).default(-6),
  /** 2–5 点情绪轨迹；缺省时以 emotionScore 单点表示 */
  emotionTrail: z.array(z.number().min(-10).max(10)).default([]),
  tight: z.boolean().default(true),
  keep: z.boolean().default(true),
});
export type UnitCutRow = z.infer<typeof UnitCutRowSchema>;

export const RebuildBlocksPlanSchema = z.object({
  mergeConflict: z.boolean().default(false),
  timeSkip: z.boolean().default(false),
  coolFront: z.boolean().default(false),
  cutPsychology: z.boolean().default(false),
  mergeChars: z.boolean().default(false),
  ironTriangle: z.boolean().default(false),
  cutEnv: z.boolean().default(false),
  cutRepeat: z.boolean().default(false),
  keepImportantSide: z.boolean().default(false),
  epOpen: z.string().default(""),
  epCarry: z.string().default(""),
  epSlap: z.string().default(""),
});
export type RebuildBlocksPlan = z.infer<typeof RebuildBlocksPlanSchema>;

export const EpisodeRhythmLiteSchema = z.object({
  minutesPerEp: z.number().min(1).max(3).default(2),
  conflictIn3s: z.boolean().default(false),
  pushEvery30s: z.boolean().default(false),
  first5sAction: z.string().default(""),
  sameBeatMax30s: z.boolean().default(false),
  paywallEp10: z.boolean().default(false),
  paywallEp20: z.boolean().default(false),
  cutAtEmotionLow: z.boolean().default(false),
  cutBeforeTwist: z.boolean().default(false),
  note: z.string().default("断章优先情绪峰值；≠查理短剧主线卡点"),
});
export type EpisodeRhythmLite = z.infer<typeof EpisodeRhythmLiteSchema>;

export const AvVerifyChecklistSchema = z.object({
  policyOk: z.boolean().default(false),
  performanceOk: z.boolean().default(false),
  aiGeneratable: z.boolean().default(false),
  costSceneOk: z.boolean().default(false),
  platformPrefOk: z.boolean().default(false),
});
export type AvVerifyChecklist = z.infer<typeof AvVerifyChecklistSchema>;

export const AdaptPitchPackGateSchema = z.object({
  anchorDone: z.boolean().default(false),
  unitCount: z.number().int().nonnegative().default(0),
  emotionPoints: z.number().int().nonnegative().default(0),
  scriptCount: z.number().int().nonnegative().default(0),
});
export type AdaptPitchPackGate = z.infer<typeof AdaptPitchPackGateSchema>;

export const IpAdaptWorkflowSchema = z.object({
  schemaVersion: z.literal("nines-13.md/1").default("nines-13.md/1"),
  currentStep: z.number().int().min(0).max(9).default(0),
  select: IpSelectScorecardSchema.default({}),
  budget: AdaptBudgetLiteSchema.default({}),
  anchor: AdaptAnchorTableSchema.default({}),
  logline: AdaptLoglinePackSchema.default({}),
  units: z.array(UnitCutRowSchema).default([]),
  rebuild: RebuildBlocksPlanSchema.default({}),
  rhythm: EpisodeRhythmLiteSchema.default({}),
  av: AvVerifyChecklistSchema.default({}),
  pitchPack: AdaptPitchPackGateSchema.default({}),
  notes: z.string().default(""),
});
export type IpAdaptWorkflow = z.infer<typeof IpAdaptWorkflowSchema>;

export const IP_ADAPT_CHECKPOINTS: WorkflowCheckpoint[] = [
  {
    id: "ip_select",
    level: "inspiration",
    label: "1.选书四指标",
    done: false,
    userAction: "四指标+不适类型+版权/收改编",
    aiAction: "ip.select_score",
    displayFields: ["select"],
  },
  {
    id: "ip_anchor",
    level: "framework",
    label: "2.锚定表",
    done: false,
    userAction: "不能动四要素",
    aiAction: "无",
    displayFields: ["anchor"],
  },
  {
    id: "ip_logline",
    level: "master",
    label: "3.梗概/导语",
    done: false,
    userAction: "四要素梗概+五要素导语",
    aiAction: "topic.logline_title",
    displayFields: ["logline"],
  },
  {
    id: "ip_units",
    level: "chapter",
    label: "4.单元拆解",
    done: false,
    userAction: "3–6章/单元；标紧松keep",
    aiAction: "ip.unit_cut",
    displayFields: ["units"],
  },
  {
    id: "ip_emotion",
    level: "chapter",
    label: "5.情绪量化",
    done: false,
    userAction: "单元情绪分；开篇宜≤-6",
    aiAction: "ip.emotion_quant",
    displayFields: ["units"],
  },
  {
    id: "ip_rebuild",
    level: "master",
    label: "6.压缩重构",
    done: false,
    userAction: "策略勾选+分集地图",
    aiAction: "ip.rebuild",
    displayFields: ["rebuild"],
  },
  {
    id: "ip_rhythm",
    level: "beat",
    label: "7.节奏/卡点",
    done: false,
    userAction: "前三秒/30秒/10·20付费/情绪断章",
    aiAction: "无",
    displayFields: ["rhythm"],
  },
  {
    id: "ip_av",
    level: "revise",
    label: "8.视听验证",
    done: false,
    userAction: "政策/表演/AI/成本/平台",
    aiAction: "无",
    displayFields: ["av"],
  },
  {
    id: "ip_pack",
    level: "revise",
    label: "9.交稿包闸",
    done: false,
    userAction: "锚定+单元+情绪+剧本",
    aiAction: "deliver.pitch_pack format-aware",
    displayFields: ["pitchPack"],
  },
  {
    id: "ip_sync",
    level: "revise",
    label: "10.回写总纲",
    done: false,
    userAction: "摘要非空",
    aiAction: "薄回写",
    displayFields: ["notes"],
  },
];

export function structureChecksAll(c: IpStructureChecks): boolean {
  return (
    c.burstEvery5to10 &&
    c.strongConflict &&
    c.actionHeavy &&
    c.visualStrong &&
    c.paceFast
  );
}

export function tomatoRefWarn(s: IpSelectScorecard): string | null {
  const misses: string[] = [];
  if (s.readsApprox > 0 && s.readsApprox < IP_TOMATO_REF.reads) {
    misses.push(`在读<${IP_TOMATO_REF.reads}`);
  }
  if (s.commentsApprox > 0 && s.commentsApprox < IP_TOMATO_REF.comments) {
    misses.push(`评论<${IP_TOMATO_REF.comments}`);
  }
  if (s.ratingApprox > 0 && s.ratingApprox < IP_TOMATO_REF.rating) {
    misses.push(`评分<${IP_TOMATO_REF.rating}`);
  }
  return misses.length ? `番茄参考尺偏低：${misses.join("、")}` : null;
}

export function deriveAdaptBudget(b: AdaptBudgetLite): {
  compressHint: string;
  unitQuotaHint: string;
} {
  const low = b.sourceWords > 0 ? Math.round(b.sourceWords / 5) : 0;
  const high = b.sourceWords > 0 ? Math.round(b.sourceWords / 4) : 0;
  const compressHint =
    b.sourceWords > 0
      ? `压缩目标约 ${low.toLocaleString()}–${high.toLocaleString()} 字（1/5–1/4）`
      : "填原文字数可派生压缩区间";
  const unitQuotaHint = `目标约 ${b.targetEpisodes} 集 → 紧单元建议 10–20（一单元≈2–3集）`;
  return { compressHint, unitQuotaHint };
}

export function unitEmotionTrail(u: UnitCutRow): number[] {
  if (u.emotionTrail.length >= 2) return u.emotionTrail.slice(0, 5);
  if (u.emotionTrail.length === 1) return u.emotionTrail;
  return [u.emotionScore];
}

export function validateUnitEmotionTrail(u: UnitCutRow): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const trail = unitEmotionTrail(u);
  const start = trail[0] ?? u.emotionScore;
  const end = trail[trail.length - 1] ?? start;
  if (start > -6) {
    return { ok: false, level: "warn", message: "开篇情绪宜≤-6" };
  }
  if (trail.length >= 2 && end < start) {
    return { ok: false, level: "warn", message: "末点宜不低于起点（上升趋势）" };
  }
  return { ok: true, level: "pass", message: "情绪轨迹可" };
}

export function deriveAdaptPitchPack(wf: IpAdaptWorkflow): AdaptPitchPackGate {
  return {
    anchorDone: wf.pitchPack.anchorDone || validateAdaptAnchor(wf.anchor).ok,
    unitCount: Math.max(
      wf.pitchPack.unitCount,
      wf.units.filter((u) => u.keep).length,
    ),
    emotionPoints: Math.max(wf.pitchPack.emotionPoints, wf.units.length),
    scriptCount: wf.pitchPack.scriptCount,
  };
}

export function validateIpSelectGoNoGo(s: IpSelectScorecard): {
  ok: boolean;
  level: "pass" | "fail" | "warn";
  message: string;
} {
  if (s.unsuitableHits.length > 0) {
    return {
      ok: false,
      level: "fail",
      message: `不适改编：${s.unsuitableHits.join(",")}`,
    };
  }
  const structureOk = s.structureFriendly || structureChecksAll(s.structureChecks);
  if (!s.dataOk || !s.genreOk || !structureOk || !s.characterOk) {
    return { ok: false, level: "warn", message: "四指标未齐" };
  }
  if (!s.copyrightConfirmed || !s.platformAcceptsAdapt) {
    return { ok: false, level: "warn", message: "版权/收改编未确认" };
  }
  const tomato = tomatoRefWarn(s);
  if (tomato) {
    return { ok: true, level: "warn", message: `选书 go（${tomato}）` };
  }
  if (!structureChecksAll(s.structureChecks) && s.structureFriendly) {
    return { ok: true, level: "warn", message: "选书 go（结构细项未全勾）" };
  }
  return { ok: true, level: "pass", message: "选书 go" };
}

export function validateAdaptAnchor(a: AdaptAnchorTable): {
  ok: boolean;
  level: "pass" | "fail";
  message: string;
} {
  if (
    !a.mainGoal.trim() ||
    !a.corePersona.trim() ||
    !a.goldFinger.trim() ||
    !a.worldRules.trim()
  ) {
    return { ok: false, level: "fail", message: "锚定缺不能动四要素" };
  }
  return { ok: true, level: "pass", message: "锚定齐" };
}

export function validateAdaptPitchPack(p: AdaptPitchPackGate): {
  ok: boolean;
  level: "pass" | "fail";
  message: string;
} {
  if (!p.anchorDone || p.unitCount < 1 || p.emotionPoints < 1 || p.scriptCount < 1) {
    return {
      ok: false,
      level: "fail",
      message: "交稿包须：锚定+单元≥1+情绪点≥1+剧本≥1",
    };
  }
  return { ok: true, level: "pass", message: "AdaptPitchPack 通过" };
}

export function validatePaywallEmotionCut(r: EpisodeRhythmLite): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!r.conflictIn3s || !r.pushEvery30s) {
    return { ok: false, level: "warn", message: "单集节奏未齐" };
  }
  if (!(r.paywallEp10 || r.paywallEp20)) {
    return { ok: false, level: "warn", message: "须标10或20集付费点" };
  }
  if (!r.cutAtEmotionLow && !r.cutBeforeTwist) {
    return { ok: false, level: "warn", message: "断章须情绪最低或即将反转" };
  }
  return { ok: true, level: "pass", message: "节奏/卡点对齐" };
}

export function summarizeIpAdaptToMaster(
  wf: IpAdaptWorkflow,
): Pick<MasterOutlineBody, "ipAdaptSummary" | "logline"> {
  const pack = deriveAdaptPitchPack(wf);
  const parts = [
    validateIpSelectGoNoGo(wf.select).ok ? "选书go" : "",
    validateAdaptAnchor(wf.anchor).ok ? "锚定齐" : "",
    wf.units.filter((u) => u.keep && u.tight).length
      ? `紧单元×${wf.units.filter((u) => u.keep && u.tight).length}`
      : "",
    validateAdaptPitchPack(pack).ok ? "交稿包" : "",
  ].filter(Boolean);
  const logline = [
    wf.logline.identity,
    wf.logline.coreConflict,
    wf.logline.turnChance,
    wf.logline.goldFinger,
    wf.logline.powerGap,
  ]
    .filter((x) => x.trim())
    .join(" · ");
  return { ipAdaptSummary: parts.join(" · "), logline };
}

export function ipAdaptWorkflowCompleteness(wf: IpAdaptWorkflow): {
  step: number;
  filledSteps: number;
  totalSteps: number;
  missing: string[];
} {
  const missing: string[] = [];
  const stepDone: boolean[] = [];
  stepDone[0] = validateIpSelectGoNoGo(wf.select).ok;
  if (!stepDone[0]) missing.push("选书四指标");
  stepDone[1] = validateAdaptAnchor(wf.anchor).ok;
  if (!stepDone[1]) missing.push("锚定表");
  stepDone[2] =
    Boolean(wf.logline.identity.trim()) &&
    Boolean(wf.logline.coreConflict.trim()) &&
    Boolean(wf.logline.turnChance.trim()) &&
    Boolean(wf.logline.goldFinger.trim()) &&
    Boolean(wf.logline.powerGap.trim()) &&
    Boolean(wf.logline.openConflict.trim());
  if (!stepDone[2]) missing.push("梗概/导语");
  stepDone[3] = wf.units.filter((u) => u.keep).length >= 1;
  if (!stepDone[3]) missing.push("单元拆解");
  stepDone[4] = wf.units.some((u) => {
    const trail = unitEmotionTrail(u);
    return (trail[0] ?? u.emotionScore) <= -6;
  });
  if (!stepDone[4]) missing.push("情绪量化");
  stepDone[5] =
    (wf.rebuild.mergeConflict ||
      wf.rebuild.timeSkip ||
      wf.rebuild.coolFront ||
      wf.rebuild.cutPsychology ||
      wf.rebuild.mergeChars ||
      wf.rebuild.ironTriangle ||
      wf.rebuild.cutEnv ||
      wf.rebuild.cutRepeat) &&
    Boolean(wf.rebuild.epOpen.trim()) &&
    Boolean(wf.rebuild.epSlap.trim());
  if (!stepDone[5]) missing.push("压缩重构");
  stepDone[6] = validatePaywallEmotionCut(wf.rhythm).ok;
  if (!stepDone[6]) missing.push("节奏/卡点");
  stepDone[7] =
    wf.av.policyOk &&
    wf.av.performanceOk &&
    wf.av.aiGeneratable &&
    wf.av.costSceneOk &&
    wf.av.platformPrefOk;
  if (!stepDone[7]) missing.push("视听验证");
  const pack = deriveAdaptPitchPack(wf);
  stepDone[8] = validateAdaptPitchPack(pack).ok && pack.scriptCount >= 1;
  if (!stepDone[8]) missing.push("交稿包闸");
  stepDone[9] = Boolean(summarizeIpAdaptToMaster(wf).ipAdaptSummary.trim());
  if (!stepDone[9]) missing.push("回写总纲");
  return {
    step: wf.currentStep,
    filledSteps: stepDone.filter(Boolean).length,
    totalSteps: 10,
    missing,
  };
}

/* ───────────────────── 14.md：女频长篇深度 FemaleLongDepthWorkflow ───────────────────── */

export const FemaleTrackTierSchema = z.enum(["core", "potential", "cold"]);
export type FemaleTrackTier = z.infer<typeof FemaleTrackTierSchema>;

/** 讲义女主四技巧 */
export const FEMALE_HEROINE_CRAFT = ["反差感", "成长线", "特长", "小缺点"] as const;
/** 讲义男主四技巧 */
export const FEMALE_HERO_CRAFT = ["双强", "细节偏爱", "疏而不油", "软肋"] as const;

/** 子赛道占比提示（写死常量，源自知识库文案） */
export const FEMALE_SUBTRACK_HINTS: Record<string, string> = {
  现言: "约45%·核心赛道",
  古言: "约38%·核心赛道",
  年代: "约12%·潜力",
  仙侠: "约3%·偏冷需差异化",
  其他: "自填差异化理由",
};

export const FemaleTrackPickSchema = z.object({
  tier: FemaleTrackTierSchema.optional(),
  subTrack: z.string().default(""),
  marketHot: z.string().default(""),
  strength: z.string().default(""),
  differentiation: z.string().default(""),
  dreamHook: z.string().default(""),
  healHook: z.string().default(""),
  mixElements: z.boolean().default(false),
  charDiff: z.boolean().default(false),
  plotDiff: z.boolean().default(false),
  dualPov: z.boolean().default(false),
});
export type FemaleTrackPick = z.infer<typeof FemaleTrackPickSchema>;

export const TopicSixHazardsSchema = z.object({
  noCold: z.boolean().default(false),
  noHomogen: z.boolean().default(false),
  noTooBig: z.boolean().default(false),
  noTooSmall: z.boolean().default(false),
  capabilityMatch: z.boolean().default(false),
  noHardHotword: z.boolean().default(false),
});
export type TopicSixHazards = z.infer<typeof TopicSixHazardsSchema>;

export const FemaleCharCardSchema = z.object({
  id: z.string(),
  role: z.enum(["heroine", "hero", "support_pos", "support_neg"]),
  name: z.string().default(""),
  craftNote: z.string().default(""),
  bio: z.string().default(""),
});
export type FemaleCharCard = z.infer<typeof FemaleCharCardSchema>;

export const FemaleCharCraftSchema = z.object({
  heroineCraft: z.array(z.string()).default([]),
  heroCraft: z.array(z.string()).default([]),
  cards: z.array(FemaleCharCardSchema).default([]),
  minBioChars: z.number().int().default(300),
});
export type FemaleCharCraft = z.infer<typeof FemaleCharCraftSchema>;

export const CharFiveHazardsSchema = z.object({
  noCollapse: z.boolean().default(false),
  noHeroTool: z.boolean().default(false),
  noSaint: z.boolean().default(false),
  noHomogen: z.boolean().default(false),
  noFloating: z.boolean().default(false),
  gold500Hint: z.string().default("黄金500字开篇：背景+冲突+目标+特质"),
});
export type CharFiveHazards = z.infer<typeof CharFiveHazardsSchema>;

export const SubPlotRowSchema = z.object({
  id: z.string(),
  label: z.string().default(""),
  volumeShare: z.number().min(0).max(1).default(0.2),
  closedLoop: z.boolean().default(false),
});
export type SubPlotRow = z.infer<typeof SubPlotRowSchema>;

export const FEMALE_MID_NODE_LABELS = [
  "5–10章",
  "30–50章",
  "60–70章",
  "80–90章",
  "90–100章",
  "101–150章",
] as const;

export const MainSubPlotArchSchema = z.object({
  mainline: z.string().default(""),
  stageGoals: z.array(z.string()).default([]),
  subPlots: z.array(SubPlotRowSchema).default([]),
  nodeCh1: z.string().default(""),
  nodeCh10: z.string().default(""),
  nodeCh50: z.string().default(""),
  nodeCh100: z.string().default(""),
  /** 中期节点勾选（不强制全文） */
  nodeMid: z.array(z.string()).default([]),
  archOutline: z.string().default(""),
  minOutlineChars: z.number().int().default(800),
});
export type MainSubPlotArch = z.infer<typeof MainSubPlotArchSchema>;

export const RetentionGateSchema = z.object({
  ch1: z.number().min(0).max(100).default(70),
  ch10: z.number().min(0).max(100).default(55),
  ch50: z.number().min(0).max(100).default(40),
  ch100: z.number().min(0).max(100).default(35),
  targetsLocked: z.boolean().default(false),
});
export type RetentionGate = z.infer<typeof RetentionGateSchema>;

export const EIGHT_PREWRITE_LABELS = [
  "人物关系递进",
  "情绪节奏曲线",
  "架构报告",
  "大纲",
  "总纲",
  "集纲",
  "伏笔填埋",
  "复现递进",
] as const;

export const EightPrewriteReportsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        done: z.boolean().default(false),
        note: z.string().default(""),
        linkedKey: z.string().default(""),
      }),
    )
    .default(
      EIGHT_PREWRITE_LABELS.map((label, i) => ({
        id: `er${i + 1}`,
        label,
        done: false,
        note: "",
        linkedKey: "",
      })),
    ),
});
export type EightPrewriteReports = z.infer<typeof EightPrewriteReportsSchema>;

export const ArchSixHazardsSchema = z.object({
  mainFocused: z.boolean().default(false),
  subClosed: z.boolean().default(false),
  emotionDriven: z.boolean().default(false),
  logicSupport: z.boolean().default(false),
  noBranchFlood: z.boolean().default(false),
  nodePlanned: z.boolean().default(false),
});
export type ArchSixHazards = z.infer<typeof ArchSixHazardsSchema>;

/**
 * 架构六雷区标签对齐讲义 §5.7（字段 id 保留）
 * mainFocused=非主线模糊 / subClosed=非副线抢戏 / emotionDriven=非拖沓
 * logicSupport=冲突有逻辑 / noBranchFlood=伏笔可回收 / nodePlanned=结局不烂尾
 */
export const ARCH_SIX_HAZARD_LABELS: Record<keyof ArchSixHazards, string> = {
  mainFocused: "非主线模糊",
  subClosed: "非副线抢戏",
  emotionDriven: "非拖沓",
  logicSupport: "冲突有逻辑",
  noBranchFlood: "伏笔可回收",
  nodePlanned: "结局不烂尾",
};

export const IndustrySelfChecklistSchema = z.object({
  boutiqueTrend: z.boolean().default(false),
  auditTighten: z.boolean().default(false),
  conflictCoolDown: z.boolean().default(false),
  aiManjuTrend: z.boolean().default(false),
});
export type IndustrySelfChecklist = z.infer<typeof IndustrySelfChecklistSchema>;

/* ─── 15.md：节奏下半 paceDepth（嵌 Depth） ─── */

export const PACE_NODE_KINDS = [
  "small",
  "big",
  "buffer",
  "heal",
  "hook",
  "pay_core",
  "pay_minor",
  "foreshadow_plant",
  "foreshadow_pay",
] as const;

export const FemalePaceNodeSchema = z.object({
  id: z.string(),
  chapter: z.number().int().positive().default(1),
  kind: z.enum(PACE_NODE_KINDS).default("small"),
  note: z.string().default(""),
});
export type FemalePaceNode = z.infer<typeof FemalePaceNodeSchema>;

export const FemalePacePhaseSchema = z.object({
  name: z.enum(["early", "mid", "late"]),
  chapterRange: z.string().default(""),
  smallCoolEvery: z.string().default(""),
  bigCoolAt: z.array(z.number().int()).default([]),
  bufferEvery: z.number().int().positive().default(20),
});
export type FemalePacePhase = z.infer<typeof FemalePacePhaseSchema>;

export const FemalePaceSixHazardsSchema = z.object({
  noVacuum15: z.boolean().default(false),
  noStackCool: z.boolean().default(false),
  noMidSoft: z.boolean().default(false),
  noRushEnd: z.boolean().default(false),
  noSlowOpen: z.boolean().default(false),
  genreMatch: z.boolean().default(false),
});
export type FemalePaceSixHazards = z.infer<typeof FemalePaceSixHazardsSchema>;

export const FemalePaceCurveReportSchema = z.object({
  totalWordsPlan: z.number().int().nonnegative().default(500000),
  genreSub: z.string().default(""),
  phases: z
    .array(FemalePacePhaseSchema)
    .default([
      {
        name: "early",
        chapterRange: "1–50",
        smallCoolEvery: "8–10",
        bigCoolAt: [50],
        bufferEvery: 20,
      },
      {
        name: "mid",
        chapterRange: "51–100",
        smallCoolEvery: "10–12",
        bigCoolAt: [100],
        bufferEvery: 15,
      },
      {
        name: "late",
        chapterRange: "101+",
        smallCoolEvery: "12",
        bigCoolAt: [],
        bufferEvery: 10,
      },
    ]),
  nodes: z.array(FemalePaceNodeSchema).default([]),
  paceOutlineText: z.string().default(""),
  minOutlineChars: z.number().int().default(600),
  hazards: FemalePaceSixHazardsSchema.default({}),
});
export type FemalePaceCurveReport = z.infer<typeof FemalePaceCurveReportSchema>;

export const FEMALE_EMOTION_KINDS = ["爽感", "共情", "治愈", "遗憾弥补"] as const;

export const FemaleEmotionSampleSchema = z.object({
  emotion: z.enum(FEMALE_EMOTION_KINDS),
  methods: z.array(z.string()).default([]),
  text: z.string().default(""),
  minChars: z.number().int().default(300),
});
export type FemaleEmotionSample = z.infer<typeof FemaleEmotionSampleSchema>;

export const FemaleEmotionLabSchema = z.object({
  samples: z
    .array(FemaleEmotionSampleSchema)
    .default(
      FEMALE_EMOTION_KINDS.map((emotion) => ({
        emotion,
        methods: [],
        text: "",
        minChars: 300,
      })),
    ),
});
export type FemaleEmotionLab = z.infer<typeof FemaleEmotionLabSchema>;

export const FemaleDetailLabSchema = z.object({
  personaDetail: z.string().default(""),
  sceneSensory: z.string().default(""),
  microReaction: z.string().default(""),
  minChars: z.number().int().default(150),
});
export type FemaleDetailLab = z.infer<typeof FemaleDetailLabSchema>;

export const FemaleRiskAvoidListSchema = z.object({
  items: z
    .array(z.object({ id: z.string(), text: z.string(), category: z.string().default("") }))
    .default([]),
  minCount: z.number().int().default(10),
  selfReviewHours: z.union([z.literal(24), z.literal(48)]).default(24),
});
export type FemaleRiskAvoidList = z.infer<typeof FemaleRiskAvoidListSchema>;

export const FemaleMonetizePlanSchema = z.object({
  platform: z.enum(["阅文", "番茄", "晋江", ""]).default(""),
  stockChapters: z.number().int().nonnegative().default(0),
  dailyWordsMin: z.number().int().nonnegative().default(0),
  payCoreEvery: z.string().default("10–20"),
  payMinorEvery: z.string().default("5–8"),
  chaptersPerEpisode: z.string().default("10–15"),
  adaptFragment: z.string().default(""),
  planItems: z.array(z.string()).default([]),
  minPlanItems: z.number().int().default(8),
  minAdaptChars: z.number().int().default(300),
});
export type FemaleMonetizePlan = z.infer<typeof FemaleMonetizePlanSchema>;

export const FemaleSerialMonitorSchema = z.object({
  actualCh1: z.number().min(0).max(100).optional(),
  actualCh10: z.number().min(0).max(100).optional(),
  actualCh50: z.number().min(0).max(100).optional(),
  actualCh100: z.number().min(0).max(100).optional(),
  backupPlanFast: z.string().default(""),
  backupPlanSlow: z.string().default(""),
  weeklyReviewNoted: z.boolean().default(false),
});
export type FemaleSerialMonitor = z.infer<typeof FemaleSerialMonitorSchema>;

export const FemalePaceDepthSchema = z.object({
  curve: FemalePaceCurveReportSchema.default({}),
  emotionLab: FemaleEmotionLabSchema.default({}),
  detailLab: FemaleDetailLabSchema.default({}),
  riskList: FemaleRiskAvoidListSchema.default({}),
  monetize: FemaleMonetizePlanSchema.default({}),
  serial: FemaleSerialMonitorSchema.default({}),
});
export type FemalePaceDepth = z.infer<typeof FemalePaceDepthSchema>;

/** 狂更猫女频四换三（挂 Depth，链 swap；不另起换元） */
export const FemaleFourSwapThreeSchema = z.object({
  /** 对标四要素 */
  baseBackground: z.string().default(""),
  baseCharacter: z.string().default(""),
  baseGoldFinger: z.string().default(""),
  baseMainline: z.string().default(""),
  /** 换三勾选（主线默认保留/只读锁） */
  swapBackground: z.boolean().default(true),
  swapCharacter: z.boolean().default(true),
  swapGoldFinger: z.boolean().default(true),
  /** 主线只读锁：优先保留主线本质 */
  mainlineLocked: z.boolean().default(true),
  swappedBackground: z.string().default(""),
  swappedCharacter: z.string().default(""),
  swappedGoldFinger: z.string().default(""),
  note: z.string().default("四换三：背景/人设/金手指/主线，优先保留主线本质"),
});
export type FemaleFourSwapThree = z.infer<typeof FemaleFourSwapThreeSchema>;

export const FemaleLongDepthWorkflowSchema = z.object({
  schemaVersion: z.literal("nines-14.md/1").default("nines-14.md/1"),
  currentStep: z.number().int().min(0).max(10).default(0),
  industrySelf: z.string().default(""),
  industryChecks: IndustrySelfChecklistSchema.default({}),
  track: FemaleTrackPickSchema.default({}),
  topicHazards: TopicSixHazardsSchema.default({}),
  chars: FemaleCharCraftSchema.default({}),
  charHazards: CharFiveHazardsSchema.default({}),
  arch: MainSubPlotArchSchema.default({}),
  archHazards: ArchSixHazardsSchema.default({}),
  retention: RetentionGateSchema.default({}),
  eightReports: EightPrewriteReportsSchema.default({}),
  adaptPotential: z.string().default(""),
  /** 狂更猫：四换三 */
  fourSwapThree: FemaleFourSwapThreeSchema.default({}),
  paceDepth: FemalePaceDepthSchema.default({}),
  notes: z.string().default(""),
});
export type FemaleLongDepthWorkflow = z.infer<typeof FemaleLongDepthWorkflowSchema>;

export const FEMALE_LONG_DEPTH_CHECKPOINTS: WorkflowCheckpoint[] = [
  {
    id: "fl_industry",
    level: "inspiration",
    label: "1.行业自评",
    done: false,
    userAction: "市场记录+能力清单",
    aiAction: "无",
    displayFields: ["industrySelf"],
  },
  {
    id: "fl_formula",
    level: "inspiration",
    label: "2.选题公式",
    done: false,
    userAction: "市场+擅长+差异化",
    aiAction: "无",
    displayFields: ["track"],
  },
  {
    id: "fl_topic6",
    level: "inspiration",
    label: "3.六雷区",
    done: false,
    userAction: "选题六雷区全勾",
    aiAction: "无",
    displayFields: ["topicHazards"],
  },
  {
    id: "fl_char1",
    level: "framework",
    label: "4.人设练习1",
    done: false,
    userAction: "女主男主正反配≥300字",
    aiAction: "char.bible_big5",
    displayFields: ["chars"],
  },
  {
    id: "fl_char5",
    level: "framework",
    label: "5.人设五雷区",
    done: false,
    userAction: "五雷区自检",
    aiAction: "无",
    displayFields: ["charHazards"],
  },
  {
    id: "fl_arch",
    level: "master",
    label: "6.主副线架构",
    done: false,
    userAction: "主线+副线2–3+节点",
    aiAction: "无",
    displayFields: ["arch"],
  },
  {
    id: "fl_ret",
    level: "chapter",
    label: "7.留存节点",
    done: false,
    userAction: "70/55/40/35锁定",
    aiAction: "female.pace",
    displayFields: ["retention"],
  },
  {
    id: "fl_eight",
    level: "master",
    label: "8.八报告",
    done: false,
    userAction: "八类写前报告勾齐",
    aiAction: "无",
    displayFields: ["eightReports"],
  },
  {
    id: "fl_practice2",
    level: "master",
    label: "9.练习2/回写",
    done: false,
    userAction: "架构大纲≥800+摘要",
    aiAction: "薄回写",
    displayFields: ["arch"],
  },
  {
    id: "fl_four_swap",
    level: "inspiration",
    label: "10.四换三",
    done: false,
    userAction: "对标四要素+换三勾选+主线锁",
    aiAction: "swap.master / swap.plan",
    displayFields: ["fourSwapThree"],
  },
  {
    id: "fl_done",
    level: "revise",
    label: "11.完成",
    done: false,
    userAction: "前步齐",
    aiAction: "无",
    displayFields: [],
  },
];

export function validateTopicSixHazards(h: TopicSixHazards): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const ok =
    h.noCold &&
    h.noHomogen &&
    h.noTooBig &&
    h.noTooSmall &&
    h.capabilityMatch &&
    h.noHardHotword;
  return ok
    ? { ok: true, level: "pass", message: "六雷区已过" }
    : { ok: false, level: "warn", message: "选题六雷区未齐" };
}

export function validateCharPractice(c: FemaleCharCraft): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (c.heroineCraft.length < 4) {
    return { ok: false, level: "warn", message: "女主四技巧未齐" };
  }
  if (c.heroCraft.length < 4) {
    return { ok: false, level: "warn", message: "男主四技巧未齐" };
  }
  const roles = new Set(c.cards.map((x) => x.role));
  const need = ["heroine", "hero", "support_pos", "support_neg"] as const;
  if (!need.every((r) => roles.has(r))) {
    return { ok: false, level: "warn", message: "须含女主/男主/正配/反配" };
  }
  const short = c.cards.filter((x) => x.bio.trim().length < c.minBioChars);
  if (short.length) {
    return {
      ok: false,
      level: "warn",
      message: `${short.length} 人未达 ${c.minBioChars} 字`,
    };
  }
  return { ok: true, level: "pass", message: "人设练习1通过" };
}

export function validateArchPractice(a: MainSubPlotArch): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!a.mainline.trim()) return { ok: false, level: "warn", message: "主线未填" };
  if (a.stageGoals.length < 3 || a.stageGoals.length > 4) {
    return { ok: false, level: "warn", message: "阶段性目标须 3–4 个" };
  }
  if (a.subPlots.length < 2 || a.subPlots.length > 3) {
    return { ok: false, level: "warn", message: "副线须 2–3 条" };
  }
  const share = a.subPlots.reduce((s, p) => s + p.volumeShare, 0);
  if (share > 1 / 3 + 0.001) {
    return { ok: false, level: "warn", message: "副线体量合计应≤主线1/3" };
  }
  if (a.archOutline.trim().length < a.minOutlineChars) {
    return {
      ok: false,
      level: "warn",
      message: `架构大纲须≥${a.minOutlineChars}字`,
    };
  }
  if (!a.nodeCh1.trim() || !a.nodeCh10.trim() || !a.nodeCh50.trim() || !a.nodeCh100.trim()) {
    return { ok: false, level: "warn", message: "1/10/50/100 节点未齐" };
  }
  return { ok: true, level: "pass", message: "架构练习2通过" };
}

export function validateRetentionTargets(r: RetentionGate): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!r.targetsLocked) {
    return { ok: false, level: "warn", message: "留存目标未锁定" };
  }
  if (r.ch1 < 70 || r.ch10 < 55 || r.ch50 < 40 || r.ch100 < 35) {
    return { ok: false, level: "warn", message: "留存目标低于课标 70/55/40/35" };
  }
  return { ok: true, level: "pass", message: "留存四节点达标" };
}

export function validateEightReports(e: EightPrewriteReports): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const done = e.items.filter((i) => i.done).length;
  if (done < 8) {
    return { ok: false, level: "warn", message: `八报告 ${done}/8` };
  }
  const noted = e.items.filter((i) => i.note.trim().length >= 20).length;
  if (noted < 4) {
    return {
      ok: false,
      level: "warn",
      message: `八报告已勾；薄备注≥20字仅 ${noted}/4`,
    };
  }
  return { ok: true, level: "pass", message: "八报告齐" };
}

export function summarizeFemaleLongDepthToMaster(
  wf: FemaleLongDepthWorkflow,
): Pick<MasterOutlineBody, "femaleLongDepthSummary"> {
  const parts = [
    wf.track.tier ? `赛道:${wf.track.tier}` : "",
    wf.track.subTrack ? wf.track.subTrack : "",
    wf.track.dreamHook.trim() ? "梦" : "",
    wf.track.healHook.trim() ? "补" : "",
    validateCharPractice(wf.chars).ok ? "人设练习OK" : "",
    validateEightReports(wf.eightReports).ok ? "八报告" : "",
    validateRetentionTargets(wf.retention).ok ? "留存锁" : "",
  ].filter(Boolean);
  return { femaleLongDepthSummary: parts.join(" · ") };
}

export function femaleLongDepthWorkflowCompleteness(wf: FemaleLongDepthWorkflow): {
  step: number;
  filledSteps: number;
  totalSteps: number;
  missing: string[];
} {
  const missing: string[] = [];
  const stepDone: boolean[] = [];
  const industryOk =
    Boolean(wf.industrySelf.trim()) ||
    wf.industryChecks.boutiqueTrend ||
    wf.industryChecks.auditTighten ||
    wf.industryChecks.conflictCoolDown ||
    wf.industryChecks.aiManjuTrend;
  stepDone[0] = industryOk;
  if (!stepDone[0]) missing.push("行业自评");
  stepDone[1] =
    Boolean(wf.track.tier) &&
    Boolean(wf.track.marketHot.trim()) &&
    Boolean(wf.track.strength.trim()) &&
    Boolean(wf.track.differentiation.trim()) &&
    Boolean(wf.track.dreamHook.trim()) &&
    Boolean(wf.track.healHook.trim()) &&
    (wf.track.mixElements || wf.track.charDiff || wf.track.plotDiff || wf.track.dualPov);
  if (!stepDone[1]) missing.push("选题公式");
  stepDone[2] = validateTopicSixHazards(wf.topicHazards).ok;
  if (!stepDone[2]) missing.push("六雷区");
  stepDone[3] = validateCharPractice(wf.chars).ok;
  if (!stepDone[3]) missing.push("人设练习1");
  stepDone[4] =
    wf.charHazards.noCollapse &&
    wf.charHazards.noHeroTool &&
    wf.charHazards.noSaint &&
    wf.charHazards.noHomogen &&
    wf.charHazards.noFloating;
  if (!stepDone[4]) missing.push("人设五雷区");
  const archStructOk =
    Boolean(wf.arch.mainline.trim()) &&
    wf.arch.stageGoals.length >= 3 &&
    wf.arch.stageGoals.length <= 4 &&
    wf.arch.subPlots.length >= 2 &&
    wf.arch.subPlots.length <= 3 &&
    wf.arch.subPlots.reduce((s, p) => s + p.volumeShare, 0) <= 1 / 3 + 0.001 &&
    Boolean(wf.arch.nodeCh1.trim()) &&
    Boolean(wf.arch.nodeCh10.trim()) &&
    Boolean(wf.arch.nodeCh50.trim()) &&
    Boolean(wf.arch.nodeCh100.trim());
  stepDone[5] =
    archStructOk &&
    wf.archHazards.mainFocused &&
    wf.archHazards.subClosed &&
    wf.archHazards.emotionDriven &&
    wf.archHazards.logicSupport &&
    wf.archHazards.noBranchFlood &&
    wf.archHazards.nodePlanned;
  if (!stepDone[5]) missing.push("主副线架构");
  stepDone[6] = validateRetentionTargets(wf.retention).ok;
  if (!stepDone[6]) missing.push("留存节点");
  stepDone[7] = validateEightReports(wf.eightReports).ok;
  if (!stepDone[7]) missing.push("八报告");
  stepDone[8] =
    validateArchPractice(wf.arch).ok &&
    Boolean(summarizeFemaleLongDepthToMaster(wf).femaleLongDepthSummary.trim());
  if (!stepDone[8]) missing.push("练习2/回写");
  stepDone[9] = validateFemaleFourSwapThree(wf.fourSwapThree).ok;
  if (!stepDone[9]) missing.push("四换三");
  stepDone[10] = stepDone.slice(0, 10).every(Boolean);
  if (!stepDone[10]) missing.push("完成");
  return {
    step: wf.currentStep,
    filledSteps: stepDone.filter(Boolean).length,
    totalSteps: 11,
    missing,
  };
}

export function validateFemaleFourSwapThree(f: FemaleFourSwapThree): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const baseOk =
    Boolean(f.baseBackground.trim()) &&
    Boolean(f.baseCharacter.trim()) &&
    Boolean(f.baseGoldFinger.trim()) &&
    Boolean(f.baseMainline.trim());
  if (!baseOk) {
    return { ok: false, level: "warn", message: "对标四要素未齐" };
  }
  if (!f.mainlineLocked) {
    return { ok: false, level: "warn", message: "主线应只读锁（四换三优先保留主线）" };
  }
  const swaps = [f.swapBackground, f.swapCharacter, f.swapGoldFinger].filter(Boolean).length;
  if (swaps < 3) {
    return { ok: false, level: "warn", message: `换三勾选 ${swaps}/3` };
  }
  if (
    !f.swappedBackground.trim() ||
    !f.swappedCharacter.trim() ||
    !f.swappedGoldFinger.trim()
  ) {
    return { ok: false, level: "warn", message: "换后背景/人设/金手指未填" };
  }
  return { ok: true, level: "pass", message: "四换三可链 swap" };
}

export const FEMALE_PACE_DEPTH_CHECKPOINTS: WorkflowCheckpoint[] = [
  {
    id: "fp_curve",
    level: "master",
    label: "1.节奏曲线",
    done: false,
    userAction: "大纲≥600+六雷区+节点",
    aiAction: "female.pace",
    displayFields: ["paceDepth.curve"],
  },
  {
    id: "fp_emotion",
    level: "draft",
    label: "2.情绪练习",
    done: false,
    userAction: "至少3情绪×≥300",
    aiAction: "female.tension",
    displayFields: ["paceDepth.emotionLab"],
  },
  {
    id: "fp_detail",
    level: "draft",
    label: "3.细节打磨",
    done: false,
    userAction: "人设/场景/微反应≥150",
    aiAction: "无",
    displayFields: ["paceDepth.detailLab"],
  },
  {
    id: "fp_risk",
    level: "revise",
    label: "4.避坑清单",
    done: false,
    userAction: "≥10条",
    aiAction: "female.risk",
    displayFields: ["paceDepth.riskList"],
  },
  {
    id: "fp_monetize",
    level: "revise",
    label: "5.变现/改编",
    done: false,
    userAction: "方案≥8+改编≥300",
    aiAction: "无",
    displayFields: ["paceDepth.monetize"],
  },
  {
    id: "fp_serial",
    level: "revise",
    label: "6.连载监控",
    done: false,
    userAction: "双备案+周复盘",
    aiAction: "无",
    displayFields: ["paceDepth.serial"],
  },
];

export function validatePaceOutline(c: FemalePaceCurveReport): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (c.paceOutlineText.trim().length < c.minOutlineChars) {
    return {
      ok: false,
      level: "warn",
      message: `节奏大纲须≥${c.minOutlineChars}字`,
    };
  }
  const h = c.hazards;
  if (
    !h.noVacuum15 ||
    !h.noStackCool ||
    !h.noMidSoft ||
    !h.noRushEnd ||
    !h.noSlowOpen ||
    !h.genreMatch
  ) {
    return { ok: false, level: "warn", message: "六节奏雷区未齐" };
  }
  if (c.nodes.length < 3) {
    return { ok: false, level: "warn", message: "至少标3个节奏节点" };
  }
  return { ok: true, level: "pass", message: "节奏曲线齐" };
}

export function validateEmotionLab(e: FemaleEmotionLab): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const filled = e.samples.filter((s) => s.text.trim().length >= s.minChars);
  if (filled.length < 3) {
    return { ok: false, level: "warn", message: `情绪样章达标 ${filled.length}/3` };
  }
  return { ok: true, level: "pass", message: "情绪练习通过" };
}

export function validateDetailLab(d: FemaleDetailLab): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const ok =
    d.personaDetail.trim().length >= d.minChars &&
    d.sceneSensory.trim().length >= d.minChars &&
    d.microReaction.trim().length >= d.minChars;
  return ok
    ? { ok: true, level: "pass", message: "细节练习通过" }
    : { ok: false, level: "warn", message: `细节各须≥${d.minChars}字` };
}

export function validateRiskAvoidList(r: FemaleRiskAvoidList): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const n = r.items.filter((i) => i.text.trim()).length;
  if (n < r.minCount) {
    return { ok: false, level: "warn", message: `避坑清单 ${n}/${r.minCount}` };
  }
  return { ok: true, level: "pass", message: "避坑清单齐" };
}

export function validateMonetizePlan(m: FemaleMonetizePlan): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!m.platform) return { ok: false, level: "warn", message: "未选平台" };
  const items = m.planItems.filter((x) => x.trim()).length;
  if (items < m.minPlanItems) {
    return { ok: false, level: "warn", message: `变现方案 ${items}/${m.minPlanItems}` };
  }
  if (m.adaptFragment.trim().length < m.minAdaptChars) {
    return {
      ok: false,
      level: "warn",
      message: `改编片段须≥${m.minAdaptChars}字`,
    };
  }
  return { ok: true, level: "pass", message: "变现方案通过" };
}

export function validateSerialMonitor(s: FemaleSerialMonitor): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!s.backupPlanFast.trim() || !s.backupPlanSlow.trim()) {
    return { ok: false, level: "warn", message: "须填快/慢双备案" };
  }
  if (!s.weeklyReviewNoted) {
    return { ok: false, level: "warn", message: "须确认7日复盘" };
  }
  return { ok: true, level: "pass", message: "连载监控齐" };
}

export function summarizeFemalePaceDepthToMaster(
  pd: FemalePaceDepth,
): Pick<MasterOutlineBody, "femalePaceDepthSummary"> {
  const parts = [
    validatePaceOutline(pd.curve).ok ? "节奏曲线" : "",
    validateEmotionLab(pd.emotionLab).ok ? "情绪练" : "",
    validateMonetizePlan(pd.monetize).ok ? "变现" : "",
    validateSerialMonitor(pd.serial).ok ? "连载监控" : "",
  ].filter(Boolean);
  return { femalePaceDepthSummary: parts.join(" · ") };
}

export function femalePaceDepthCompleteness(pd: FemalePaceDepth): {
  filledSteps: number;
  totalSteps: number;
  missing: string[];
} {
  const missing: string[] = [];
  const stepDone: boolean[] = [];
  stepDone[0] = validatePaceOutline(pd.curve).ok;
  if (!stepDone[0]) missing.push("节奏曲线");
  stepDone[1] = validateEmotionLab(pd.emotionLab).ok;
  if (!stepDone[1]) missing.push("情绪练习");
  stepDone[2] = validateDetailLab(pd.detailLab).ok;
  if (!stepDone[2]) missing.push("细节打磨");
  stepDone[3] = validateRiskAvoidList(pd.riskList).ok;
  if (!stepDone[3]) missing.push("避坑清单");
  stepDone[4] = validateMonetizePlan(pd.monetize).ok;
  if (!stepDone[4]) missing.push("变现/改编");
  stepDone[5] = validateSerialMonitor(pd.serial).ok;
  if (!stepDone[5]) missing.push("连载监控");
  return {
    filledSteps: stepDone.filter(Boolean).length,
    totalSteps: 6,
    missing,
  };
}

/* ───────────────────── 17.md：漫剧进阶二 ManjuAdvancedWorkflow ───────────────────── */

export const MANJU_RENDER_FORMATS = ["仿真人", "2D", "3D", "IP改编"] as const;

export const ElementComboBoardSchema = z.object({
  worldview: z.string().default(""),
  identityContrast: z.string().default(""),
  limitedGoldFinger: z.string().default(""),
  coreAction: z.string().default(""),
  renderFormat: z.enum(["仿真人", "2D", "3D", "IP改编", ""]).default(""),
  seedNote: z.string().default(""),
});
export type ElementComboBoard = z.infer<typeof ElementComboBoardSchema>;

export const Act100SegmentSchema = z.object({
  id: z.string(),
  act: z.number().int().min(1).max(4),
  epFrom: z.number().int().positive(),
  epTo: z.number().int().positive(),
  task: z.string().default(""),
  done: z.boolean().default(false),
});
export type Act100Segment = z.infer<typeof Act100SegmentSchema>;

export const DEFAULT_ACT100_SEGMENTS: Act100Segment[] = [
  { id: "a1s1", act: 1, epFrom: 1, epTo: 10, task: "开局建期待/金手指亮相", done: false },
  { id: "a1s2", act: 1, epFrom: 11, epTo: 25, task: "压制→反杀；幕末新危机", done: false },
  { id: "a2s1", act: 2, epFrom: 26, epTo: 40, task: "升级循环/新对手", done: false },
  { id: "a2s2", act: 2, epFrom: 41, epTo: 50, task: "中点大事件", done: false },
  { id: "a3s1", act: 3, epFrom: 51, epTo: 70, task: "低谷+绝地反击", done: false },
  { id: "a3s2", act: 3, epFrom: 71, epTo: 75, task: "幕末危机抬升", done: false },
  { id: "a4s1", act: 4, epFrom: 76, epTo: 90, task: "决战铺垫/填坑", done: false },
  { id: "a4s2", act: 4, epFrom: 91, epTo: 100, task: "终局兑现+余韵钩", done: false },
];

export const Act100TaskTableSchema = z.object({
  segments: z.array(Act100SegmentSchema).default(DEFAULT_ACT100_SEGMENTS),
  importedFromAgent: z.boolean().default(false),
});
export type Act100TaskTable = z.infer<typeof Act100TaskTableSchema>;

export const OPENING_NINE_TYPES = [
  "冲突开场",
  "反差开场",
  "危机开场",
  "金手指开场",
  "悬念开场",
  "日常破局",
  "群像切入",
  "倒叙钩子",
  "规则展示",
] as const;

export const ENDING_HOOK_FIVE = [
  "信息差揭示",
  "危机降临",
  "反转预告",
  "人物抉择",
  "未解谜题",
] as const;

export const EpisodeCraftRowSchema = z.object({
  id: z.string(),
  episodeNo: z.number().int().positive(),
  openingType: z.string().default(""),
  endingHook: z.string().default(""),
  note: z.string().default(""),
});
export type EpisodeCraftRow = z.infer<typeof EpisodeCraftRowSchema>;

export const TropeDrillLiteSchema = z.object({
  infoGapIntrigue: z.boolean().default(false),
  sweetSpotlight: z.boolean().default(false),
  coolBeat: z.boolean().default(false),
  tearBeat: z.boolean().default(false),
  comedyBeat: z.boolean().default(false),
  note: z.string().default("≠ Charlie bridge8"),
});
export type TropeDrillLite = z.infer<typeof TropeDrillLiteSchema>;

export const ManjuTrendPitchAckSchema = z.object({
  followHot: z.boolean().default(false),
  pitchFastStudio: z.boolean().default(false),
  formatMatch: z.boolean().default(false),
});
export type ManjuTrendPitchAck = z.infer<typeof ManjuTrendPitchAckSchema>;

export const ManjuAdvancedWorkflowSchema = z.object({
  schemaVersion: z.literal("nines-17.md/1").default("nines-17.md/1"),
  currentStep: z.number().int().min(0).max(9).default(0),
  combo: ElementComboBoardSchema.default({}),
  act100: Act100TaskTableSchema.default({}),
  episodeCraft: z.array(EpisodeCraftRowSchema).default([]),
  tropeDrill: TropeDrillLiteSchema.default({}),
  trendAck: ManjuTrendPitchAckSchema.default({}),
  notes: z.string().default(""),
});
export type ManjuAdvancedWorkflow = z.infer<typeof ManjuAdvancedWorkflowSchema>;

export const MANJU_ADVANCED_CHECKPOINTS: WorkflowCheckpoint[] = [
  {
    id: "ma_combo",
    level: "inspiration",
    label: "1.元素叠加",
    done: false,
    userAction: "四维+形式",
    aiAction: "topic.core_hook_batch",
    displayFields: ["combo"],
  },
  {
    id: "ma_trend",
    level: "inspiration",
    label: "2.趋势投稿",
    done: false,
    userAction: "热点/快公司/形式",
    aiAction: "无",
    displayFields: ["trendAck"],
  },
  {
    id: "ma_act100",
    level: "master",
    label: "3.百集四幕",
    done: false,
    userAction: "四幕任务表",
    aiAction: "struct.act100_manju",
    displayFields: ["act100"],
  },
  {
    id: "ma_craft",
    level: "chapter",
    label: "4.开场/钩子",
    done: false,
    userAction: "≥3集填开场+钩子",
    aiAction: "无",
    displayFields: ["episodeCraft"],
  },
  {
    id: "ma_trope",
    level: "draft",
    label: "5.桥段练习",
    done: false,
    userAction: "≥2类勾选",
    aiAction: "无",
    displayFields: ["tropeDrill"],
  },
  {
    id: "ma_sync",
    level: "revise",
    label: "6.回写摘要",
    done: false,
    userAction: "摘要非空",
    aiAction: "薄回写",
    displayFields: ["notes"],
  },
];

export function validateElementCombo(c: ElementComboBoard): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (
    !c.worldview.trim() ||
    !c.identityContrast.trim() ||
    !c.limitedGoldFinger.trim() ||
    !c.coreAction.trim()
  ) {
    return { ok: false, level: "warn", message: "四维组合未齐" };
  }
  if (!c.renderFormat) {
    return { ok: false, level: "warn", message: "未选表现形式" };
  }
  return { ok: true, level: "pass", message: "元素叠加齐" };
}

export function validateAct100Tasks(t: Act100TaskTable): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const acts = new Set(t.segments.map((s) => s.act));
  if (acts.size < 4) {
    return { ok: false, level: "warn", message: "须覆盖四幕" };
  }
  const filled = t.segments.filter((s) => s.task.trim()).length;
  if (filled < 4) {
    return { ok: false, level: "warn", message: "至少4段任务有文案" };
  }
  return { ok: true, level: "pass", message: "百集任务表可" };
}

export function validateEpisodeCraft(rows: EpisodeCraftRow[]): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const okRows = rows.filter((r) => r.openingType.trim() && r.endingHook.trim());
  if (okRows.length < 3) {
    return { ok: false, level: "warn", message: `开场/钩子齐备 ${okRows.length}/3` };
  }
  return { ok: true, level: "pass", message: "开场钩子练习通过" };
}

export function summarizeManjuAdvancedToMaster(
  wf: ManjuAdvancedWorkflow,
): Pick<MasterOutlineBody, "manjuAdvancedSummary"> {
  const parts = [
    validateElementCombo(wf.combo).ok ? "四步组合" : "",
    validateAct100Tasks(wf.act100).ok ? "百集四幕" : "",
    validateEpisodeCraft(wf.episodeCraft).ok ? "钩子练" : "",
    wf.trendAck.followHot && wf.trendAck.pitchFastStudio && wf.trendAck.formatMatch
      ? "趋势ack"
      : "",
  ].filter(Boolean);
  return { manjuAdvancedSummary: parts.join(" · ") };
}

export function manjuAdvancedCompleteness(wf: ManjuAdvancedWorkflow): {
  step: number;
  filledSteps: number;
  totalSteps: number;
  missing: string[];
} {
  const missing: string[] = [];
  const stepDone: boolean[] = [];
  stepDone[0] = validateElementCombo(wf.combo).ok;
  if (!stepDone[0]) missing.push("元素叠加");
  stepDone[1] =
    wf.trendAck.followHot && wf.trendAck.pitchFastStudio && wf.trendAck.formatMatch;
  if (!stepDone[1]) missing.push("趋势投稿");
  stepDone[2] = validateAct100Tasks(wf.act100).ok;
  if (!stepDone[2]) missing.push("百集四幕");
  stepDone[3] = validateEpisodeCraft(wf.episodeCraft).ok;
  if (!stepDone[3]) missing.push("开场/钩子");
  const tropeN = [
    wf.tropeDrill.infoGapIntrigue,
    wf.tropeDrill.sweetSpotlight,
    wf.tropeDrill.coolBeat,
    wf.tropeDrill.tearBeat,
    wf.tropeDrill.comedyBeat,
  ].filter(Boolean).length;
  stepDone[4] = tropeN >= 2;
  if (!stepDone[4]) missing.push("桥段练习");
  stepDone[5] = Boolean(summarizeManjuAdvancedToMaster(wf).manjuAdvancedSummary.trim());
  if (!stepDone[5]) missing.push("回写摘要");
  return {
    step: wf.currentStep,
    filledSteps: stepDone.filter(Boolean).length,
    totalSteps: 6,
    missing,
  };
}

/* ───────────────────── 实操手册 SOP：handbookOps 校验/摘要 ───────────────────── */

export function validateMarketGenreAck(a: MarketGenreAck): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const genres = a.maleGenres.length + a.femaleGenres.length;
  const notes =
    a.brainHole &&
    a.strongConflict &&
    a.coolTrope &&
    a.fastPace &&
    a.payoffEarly &&
    a.sinkAudience;
  if (genres < 1 || !notes) {
    return { ok: false, level: "warn", message: "题材池或注意事项六勾未齐" };
  }
  return { ok: true, level: "pass", message: `题材ack ${genres}项` };
}

export function validateScriptFormatGate(g: ScriptFormatGate): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (
    !g.wordBand800_1200 ||
    !g.scenesMax3 ||
    !g.dialogueMax500 ||
    !g.sceneHeaderFormat ||
    !g.deNovelizeAck
  ) {
    return { ok: false, level: "warn", message: "剧本规格闸未齐" };
  }
  return { ok: true, level: "pass", message: "剧本规格闸通过" };
}

export function validateDialogueHarshChecklist(c: DialogueHarshChecklist): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const n = [
    c.shortHarsh,
    c.barbedHook,
    c.contrastShock,
    c.evidenceSlap,
    c.crowdReaction,
    c.pacePingPong,
  ].filter(Boolean).length;
  if (n < 4) {
    return { ok: false, level: "warn", message: `台词狠清单 ${n}/6（≥4）` };
  }
  return { ok: true, level: "pass", message: "台词狠清单可" };
}

export function validateExtendForm(f: ExtendForm): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (f.blockTo < f.blockFrom) {
    return { ok: false, level: "warn", message: "扩纲区间非法" };
  }
  if (!f.conflictUpgrade.trim() || !f.foreshadowSync) {
    return { ok: false, level: "warn", message: "冲突升级/伏笔同步未齐" };
  }
  return { ok: true, level: "pass", message: `扩纲 EP${f.blockFrom}-${f.blockTo}` };
}

export function summarizeManjuHandbookToMaster(
  ops: ManjuHandbookOps,
): Pick<MasterOutlineBody, "manjuHandbookSummary"> {
  const parts = [
    validateMarketGenreAck(ops.marketGenreAck).ok ? "题材ack" : "",
    ops.hookBatchRounds.length > 0 ? `梗轮${ops.hookBatchRounds.length}` : "",
    ops.ep10TableAccept.some((r) => r.accepted) ? "前十可用" : "",
    validateScriptFormatGate(ops.scriptFormatGate).ok ? "规格闸" : "",
    validateDialogueHarshChecklist(ops.dialogueHarshChecklist).ok ? "台词狠" : "",
    ops.extendForm.humanVerdict === "accept" ? "扩纲accept" : "",
  ].filter(Boolean);
  return { manjuHandbookSummary: parts.join(" · ") };
}

export function manjuHandbookOpsCompleteness(ops: ManjuHandbookOps): {
  filledSteps: number;
  totalSteps: number;
  missing: string[];
} {
  const missing: string[] = [];
  const stepDone: boolean[] = [];
  stepDone[0] = validateMarketGenreAck(ops.marketGenreAck).ok;
  if (!stepDone[0]) missing.push("题材注意事项");
  stepDone[1] = ops.hookBatchRounds.length >= 1;
  if (!stepDone[1]) missing.push("核心梗多轮");
  stepDone[2] = ops.ep10TableAccept.some((r) => r.accepted);
  if (!stepDone[2]) missing.push("前十能不能用");
  stepDone[3] = validateScriptFormatGate(ops.scriptFormatGate).ok;
  if (!stepDone[3]) missing.push("剧本规格");
  stepDone[4] = validateDialogueHarshChecklist(ops.dialogueHarshChecklist).ok;
  if (!stepDone[4]) missing.push("台词狠清单");
  stepDone[5] = validateExtendForm(ops.extendForm).ok;
  if (!stepDone[5]) missing.push("扩纲表单");
  stepDone[6] = Boolean(summarizeManjuHandbookToMaster(ops).manjuHandbookSummary.trim());
  if (!stepDone[6]) missing.push("手册摘要");
  return {
    filledSteps: stepDone.filter(Boolean).length,
    totalSteps: 7,
    missing,
  };
}

/* ───────────────────── 狂更猫：MaleLongEngineWorkflow ───────────────────── */

export const TopicOrderGateSchema = z.object({
  scanRank: z.boolean().default(false),
  titleDone: z.boolean().default(false),
  blurbDone: z.boolean().default(false),
  openingDone: z.boolean().default(false),
  firstShowDone: z.boolean().default(false),
  note: z.string().default("顺序：扫榜→书名→简介→开头→首秀"),
  // 扫榜带入的对标书（用于回流选题，供 male.opening / 换元参考）
  benchmarkTitle: z.string().default(""),
  benchmarkSummary: z.string().default(""),
  benchmarkSource: z.string().default(""),
  benchmarkGenre: z.string().default(""),
});
export type TopicOrderGate = z.infer<typeof TopicOrderGateSchema>;

export const TitleFourQSchema = z.object({
  q1Identity: z.string().default(""),
  q2Conflict: z.string().default(""),
  q3Promise: z.string().default(""),
  q4Diff: z.string().default(""),
  candidateTitle: z.string().default(""),
});
export type TitleFourQ = z.infer<typeof TitleFourQSchema>;

export const BlurbFivePartsSchema = z.object({
  situation: z.string().default(""),
  piePromise: z.string().default(""),
  path: z.string().default(""),
  coolPreview: z.array(z.string()).default([]),
  close: z.string().default(""),
});
export type BlurbFiveParts = z.infer<typeof BlurbFivePartsSchema>;

export const FourArcCheckSchema = z.tuple([
  z.boolean(),
  z.boolean(),
  z.boolean(),
  z.boolean(),
]).default([false, false, false, false]);
export type FourArcCheck = z.infer<typeof FourArcCheckSchema>;

export const ANTI_STUCK_TEN_LABELS = [
  "1.金手指边界清不清？",
  "2.当前目标够不够具体？",
  "3.阻碍是否逻辑自洽？",
  "4.压抑段写足了吗？",
  "5.爆发是否用金手指？",
  "6.打脸对比场在哪？",
  "7.奖励是否快速展示？",
  "8.新目标是否已拉出？",
  "9.是否服务总主线？",
  "10.下一循环是否加强？",
] as const;

export const AntiStuckTenStepSchema = z.object({
  currentStep: z.number().int().min(1).max(10).default(1),
  notes: z.array(z.string()).default([]),
  lastResolvedAt: z.string().default(""),
});
export type AntiStuckTenStep = z.infer<typeof AntiStuckTenStepSchema>;

export const LoopChapterFunctionSchema = z.object({
  chapterNo: z.number().int().positive(),
  function: z.string().default(""),
});
export type LoopChapterFunction = z.infer<typeof LoopChapterFunctionSchema>;

export const LoopPlanSchema = z.object({
  loopIndex: z.number().int().positive().default(1),
  endShock: z.string().default(""),
  chapters: z.array(LoopChapterFunctionSchema).default([]),
  feedUpgradeLoop: z.boolean().default(true),
});
export type LoopPlan = z.infer<typeof LoopPlanSchema>;

export const StageSetupBeatSchema = z.object({
  chapterHint: z.string().default(""),
  heroGoal: z.string().default(""),
  foeGoals: z.array(z.string()).default([]),
  povFirst: z.string().default(""),
  scenePurpose: z.string().default(""),
});
export type StageSetupBeat = z.infer<typeof StageSetupBeatSchema>;

export const PlatformMilestoneChecklistSchema = z.object({
  daily4k: z.boolean().default(false),
  signed: z.boolean().default(false),
  firstShow: z.boolean().default(false),
  bookVolume: z.boolean().default(false),
  chaseRatioOk: z.boolean().default(false),
  finishReadOk: z.boolean().default(false),
  note: z.string().default("课内口径人工勾选；不接番茄 API"),
});
export type PlatformMilestoneChecklist = z.infer<typeof PlatformMilestoneChecklistSchema>;

export const MingAnCardSchema = z.object({
  mingIdentity: z.string().default(""),
  anIdentity: z.string().default(""),
  payoffBeat: z.string().default(""),
});
export type MingAnCard = z.infer<typeof MingAnCardSchema>;

export const MaleLongEngineWorkflowSchema = z.object({
  schemaVersion: z.literal("kgm-male-long/1").default("kgm-male-long/1"),
  currentStep: z.number().int().min(0).max(10).default(0),
  topicOrderGate: TopicOrderGateSchema.default({}),
  titleFourQ: TitleFourQSchema.default({}),
  blurbFiveParts: BlurbFivePartsSchema.default({}),
  mainlineOneLiner: z.string().default(""),
  coreHighlightOneLiner: z.string().default(""),
  fourArcCheck: FourArcCheckSchema,
  antiStuck: AntiStuckTenStepSchema.default({}),
  loopPlan: LoopPlanSchema.default({}),
  stageSetups: z.array(StageSetupBeatSchema).default([]),
  platformMilestones: PlatformMilestoneChecklistSchema.default({}),
  mingAn: MingAnCardSchema.default({}),
  goldFingerBrief: z.string().default(""),
  notes: z.string().default(""),
});
export type MaleLongEngineWorkflow = z.infer<typeof MaleLongEngineWorkflowSchema>;

export const MALE_LONG_KGM_CHECKPOINTS: WorkflowCheckpoint[] = [
  {
    id: "ml_topic_gate",
    level: "inspiration",
    label: "1.选题顺序闸",
    done: false,
    userAction: "扫榜→书名→简介→开头→首秀",
    aiAction: "软阻 male.opening",
    displayFields: ["topicOrderGate"],
  },
  {
    id: "ml_title_blurb",
    level: "inspiration",
    label: "2.书名四问+五段简介",
    done: false,
    userAction: "四问+处境/画饼/路径/爽点/收束",
    aiAction: "无",
    displayFields: ["titleFourQ", "blurbFiveParts"],
  },
  {
    id: "ml_main_core",
    level: "master",
    label: "3.主线≠核心",
    done: false,
    userAction: "主线句+核心亮点+四弧勾选",
    aiAction: "薄回写 MasterOutline",
    displayFields: ["mainlineOneLiner", "coreHighlightOneLiner"],
  },
  {
    id: "ml_gold",
    level: "framework",
    label: "4.金手指",
    done: false,
    userAction: "金手指简述",
    aiAction: "male.gold_finger",
    displayFields: ["goldFingerBrief"],
  },
  {
    id: "ml_loop",
    level: "master",
    label: "5.循环倒推",
    done: false,
    userAction: "endShock+≈15章功能",
    aiAction: "male.upgrade_loop",
    displayFields: ["loopPlan"],
  },
  {
    id: "ml_stage",
    level: "chapter",
    label: "6.搭台子",
    done: false,
    userAction: "hero/foe/POV/目的",
    aiAction: "scene.solution_fanout",
    displayFields: ["stageSetups"],
  },
  {
    id: "ml_antistuck",
    level: "chapter",
    label: "7.不卡文十条",
    done: false,
    userAction: "currentStep 1–10",
    aiAction: "stuck_at_step→upgrade_loop",
    displayFields: ["antiStuck"],
  },
  {
    id: "ml_mingan",
    level: "framework",
    label: "8.明暗牌",
    done: false,
    userAction: "明/暗身份+兑现节拍",
    aiAction: "无",
    displayFields: ["mingAn"],
  },
  {
    id: "ml_platform",
    level: "revise",
    label: "9.平台里程碑",
    done: false,
    userAction: "日更/签约/首秀等人工勾",
    aiAction: "male.risk 软提示",
    displayFields: ["platformMilestones"],
  },
  {
    id: "ml_done",
    level: "revise",
    label: "10.完成",
    done: false,
    userAction: "前步齐",
    aiAction: "无",
    displayFields: [],
  },
];

export function validateTopicOrderGate(g: TopicOrderGate): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
  softBlockOpening: boolean;
} {
  const flags = [g.scanRank, g.titleDone, g.blurbDone, g.openingDone, g.firstShowDone];
  const n = flags.filter(Boolean).length;
  const softBlockOpening = !(g.scanRank && g.titleDone && g.blurbDone);
  if (n < 5) {
    return {
      ok: false,
      level: "warn",
      message: `选题顺序闸 ${n}/5${softBlockOpening ? "（opening 软阻）" : ""}`,
      softBlockOpening,
    };
  }
  return { ok: true, level: "pass", message: "选题顺序闸齐", softBlockOpening: false };
}

export function validateTitleFourQ(t: TitleFourQ): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const filled = [t.q1Identity, t.q2Conflict, t.q3Promise, t.q4Diff, t.candidateTitle].filter(
    (s) => s.trim(),
  ).length;
  if (filled < 5) {
    return { ok: false, level: "warn", message: `书名四问 ${filled}/5` };
  }
  return { ok: true, level: "pass", message: "书名四问齐" };
}

export function validateBlurbFiveParts(b: BlurbFiveParts): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const coolN = b.coolPreview.filter((x) => x.trim()).length;
  if (
    !b.situation.trim() ||
    !b.piePromise.trim() ||
    !b.path.trim() ||
    coolN < 1 ||
    !b.close.trim()
  ) {
    return {
      ok: false,
      level: "warn",
      message: `五段简介未齐（爽点预知 ${coolN}，建议1–3）`,
    };
  }
  return { ok: true, level: "pass", message: "五段简介齐" };
}

export function validateMainlineCoreGate(
  mainline: string,
  core: string,
  arcs: FourArcCheck,
): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!mainline.trim() || !core.trim()) {
    return { ok: false, level: "warn", message: "主线/核心亮点双句缺一" };
  }
  if (mainline.trim() === core.trim()) {
    return { ok: false, level: "warn", message: "主线≠核心：两句不可相同" };
  }
  const arcN = arcs.filter(Boolean).length;
  if (arcN < 4) {
    return { ok: false, level: "warn", message: `四弧勾选 ${arcN}/4` };
  }
  return { ok: true, level: "pass", message: "主线≠核心闸过" };
}

export function validateLoopPlan(p: LoopPlan): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!p.endShock.trim()) {
    return { ok: false, level: "warn", message: "循环终点震惊点未填" };
  }
  if (p.chapters.length < 10) {
    return {
      ok: false,
      level: "warn",
      message: `循环章功能 ${p.chapters.length}/≈15（至少10）`,
    };
  }
  const empty = p.chapters.filter((c) => !c.function.trim()).length;
  if (empty > 0) {
    return { ok: false, level: "warn", message: `${empty} 章功能空` };
  }
  return { ok: true, level: "pass", message: `循环#${p.loopIndex} 可喂 upgrade_loop` };
}

export function summarizeMaleLongEngineToMaster(
  wf: MaleLongEngineWorkflow,
): Pick<MasterOutlineBody, "maleLongEngineSummary"> {
  const parts = [
    validateTopicOrderGate(wf.topicOrderGate).ok ? "顺序闸" : "",
    wf.mainlineOneLiner.trim() ? "主线" : "",
    wf.coreHighlightOneLiner.trim() ? "核心" : "",
    validateLoopPlan(wf.loopPlan).ok ? `循环#${wf.loopPlan.loopIndex}` : "",
    wf.antiStuck.currentStep ? `卡文步${wf.antiStuck.currentStep}` : "",
  ].filter(Boolean);
  return { maleLongEngineSummary: parts.join(" · ") };
}

/** 薄回写：仅有内容时覆盖 logline / coreConflict */
export function patchMasterFromMaleLongEngine(
  wf: MaleLongEngineWorkflow,
  prev: MasterOutlineBody,
): MasterOutlineBody {
  const thin = summarizeMaleLongEngineToMaster(wf);
  return {
    ...prev,
    maleLongEngineSummary: thin.maleLongEngineSummary,
    ...(wf.mainlineOneLiner.trim() ? { logline: wf.mainlineOneLiner.trim() } : {}),
    ...(wf.coreHighlightOneLiner.trim()
      ? { coreConflictOneLiner: wf.coreHighlightOneLiner.trim() }
      : {}),
  };
}

export function maleLongEngineCompleteness(wf: MaleLongEngineWorkflow): {
  step: number;
  filledSteps: number;
  totalSteps: number;
  missing: string[];
  softBlockOpening: boolean;
} {
  const missing: string[] = [];
  const stepDone: boolean[] = [];
  const gate = validateTopicOrderGate(wf.topicOrderGate);
  stepDone[0] = gate.ok;
  if (!stepDone[0]) missing.push("选题顺序闸");
  stepDone[1] =
    validateTitleFourQ(wf.titleFourQ).ok && validateBlurbFiveParts(wf.blurbFiveParts).ok;
  if (!stepDone[1]) missing.push("书名四问+五段简介");
  stepDone[2] = validateMainlineCoreGate(
    wf.mainlineOneLiner,
    wf.coreHighlightOneLiner,
    wf.fourArcCheck,
  ).ok;
  if (!stepDone[2]) missing.push("主线≠核心");
  stepDone[3] = Boolean(wf.goldFingerBrief.trim());
  if (!stepDone[3]) missing.push("金手指");
  stepDone[4] = validateLoopPlan(wf.loopPlan).ok;
  if (!stepDone[4]) missing.push("循环倒推");
  stepDone[5] =
    wf.stageSetups.length >= 1 &&
    wf.stageSetups.some(
      (s) =>
        Boolean(s.heroGoal.trim()) &&
        Boolean(s.scenePurpose.trim()) &&
        Boolean(s.povFirst.trim()),
    );
  if (!stepDone[5]) missing.push("搭台子");
  stepDone[6] = wf.antiStuck.currentStep >= 1 && wf.antiStuck.notes.length > 0;
  if (!stepDone[6]) missing.push("不卡文十条");
  stepDone[7] =
    Boolean(wf.mingAn.mingIdentity.trim()) &&
    Boolean(wf.mingAn.anIdentity.trim()) &&
    Boolean(wf.mingAn.payoffBeat.trim());
  if (!stepDone[7]) missing.push("明暗牌");
  const pm = wf.platformMilestones;
  stepDone[8] =
    [pm.daily4k, pm.signed, pm.firstShow, pm.bookVolume, pm.chaseRatioOk, pm.finishReadOk].filter(
      Boolean,
    ).length >= 3;
  if (!stepDone[8]) missing.push("平台里程碑");
  stepDone[9] = stepDone.slice(0, 9).every(Boolean);
  if (!stepDone[9]) missing.push("完成");
  return {
    step: wf.currentStep,
    filledSteps: stepDone.filter(Boolean).length,
    totalSteps: 10,
    missing,
    softBlockOpening: gate.softBlockOpening,
  };
}
