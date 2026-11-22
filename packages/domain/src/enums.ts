import { z } from "zod";

export const ProjectFormatSchema = z.enum([
  "manju",
  "duanju",
  "short_novel",
  "male_long",
  "female_long",
  "ip_adapt",
]);
export type ProjectFormat = z.infer<typeof ProjectFormatSchema>;

export const ProjectStatusSchema = z.enum([
  "active",
  "paused",
  "archived",
  "submitted",
]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const MarketSchema = z.enum(["cn", "overseas", "both"]);
export type Market = z.infer<typeof MarketSchema>;

/** 与 packages/agent-runtime stages.ts 对齐（权威 · 九格金牌：人设先于大纲） */
export const ManjuStageSchema = z.enum([
  "S0_SETUP",
  "S1_HOOK_BATCH",
  "S2_HOOK_CRITIC",
  "S2_HOOK_SELECT",
  "S2_LOGLINE_100",
  "S2_COOL_BATCH",
  "S3_BIO",
  "S3_BIO_ACK",
  "S4_EP10_OUTLINE",
  "S4_OUTLINE_ACK",
  "S5_EP_BODY_BATCH",
  "S6_QA",
  "S7_STORYBOARD",
  "S8_DIALOGUE",
  "S9_DE_AI",
  "S10_HUMAN_QC",
  "S11_EXTEND",
  "S11_PITCH",
  "S11_DONE",
]);
export type ManjuStage = z.infer<typeof ManjuStageSchema>;

/** 与 agent-runtime DUANJU_STAGE_SKELETON 对齐 */
export const DuanjuStageSchema = z.enum([
  "S0_PRODUCT",
  "S1_TOPIC",
  "S1_TOPIC_ACK",
  "S2_BIO",
  "S3_BEAT20",
  "S4_EP10_DRAFT",
  "S4_EP10",
  "S5_SCENE",
  "S6_REVISE20",
  "S7_SUBMIT",
]);
export type DuanjuStage = z.infer<typeof DuanjuStageSchema>;

export const ShortNovelStageSchema = z.enum([
  "S0_SETUP",
  "S1_DISSECT",
  "S2_SWAP",
  "S3_SYNOPSIS",
  "S4_CHAPTER_OUTLINE",
  "S5_BEAT",
  "S6_BODY_CHAPTER",
  "S7_POLISH",
  "S8_QC",
  "S9_DONE",
]);
export type ShortNovelStage = z.infer<typeof ShortNovelStageSchema>;

/** 男频中长篇：升级流 / 爽点密度 / 金手指主轴 */
export const MaleLongStageSchema = z.enum([
  "S0_SETUP",
  "S1_TOPIC_SCAN",
  "S2_GOLD_FINGER",
  "S3_CHARACTER",
  "S4_VOLUME",
  "S5_CHAPTER",
  "S6_BEAT",
  "S7_BODY",
  "S8_COOL_DENSITY",
  "S9_RISK",
  "S10_DONE",
]);
export type MaleLongStage = z.infer<typeof MaleLongStageSchema>;

export const FemaleLongStageSchema = z.enum([
  "S0_SETUP",
  "S1_TOPIC",
  "S1_FOUR_SWAP",
  "S2_CHARACTER",
  "S3_VOLUME",
  "S4_CHAPTER",
  "S5_BEAT",
  "S6_BODY",
  "S7_RHYTHM",
  "S8_TABOO",
  "S9_PAYWALL",
  "S10_DONE",
]);
export type FemaleLongStage = z.infer<typeof FemaleLongStageSchema>;

export const IpAdaptStageSchema = z.enum([
  "S0_SETUP",
  "S1_IP_EVAL",
  "S2_UNIT_SPLIT",
  "S3_EMOTION",
  "S4_COMPRESS",
  "S5_EPISODE_RHYTHM",
  "S6_BEATS",
  "S7_SCRIPT",
  "S8_DONE",
]);
export type IpAdaptStage = z.infer<typeof IpAdaptStageSchema>;

export const ArtifactTypeSchema = z.enum([
  "core_hook",
  "swap_plan",
  "character",
  "world",
  "synopsis",
  "volume_outline",
  "chapter_outline",
  "beat_sheet",
  "episode_outline",
  "manuscript",
  "qc_report",
  "emotion_curve",
  /** topic.logline_title 产出：片名+一句话梗概 */
  "logline",
  /** topic.world_setting 产出：设定包（五要素·金手指·世界观） */
  "world_setting",
  /** hook.foreshadow_ledger 产出：伏笔台账（埋点·到期·状态机） */
  "foreshadow_ledger",
  /** 金手指规则卡 / 设定附件 */
  "setting",
  /** 人工评审用总表（避免与 episode_outline 计数混用） */
  "outline",
  /** 查理短剧场级正文（场三件套） */
  "scene",
  "trope",
  /** 2.md：拆书参数完整 11 项 */
  "dissect_params",
  /** 2.md：单元故事七步法 */
  "unit_seven_steps",
  /** 2.md：框架设定包 */
  "framework",
  /** 2.md：总纲 */
  "master_outline",
  /** 狂更猫：书名+简介卖点+开书验证（topic.book_pack） */
  "book_pack",
  /** 人物关系网结构化（CharacterGraphPanel 落库） */
  "character_graph",
  /** 全剧连续性图（JSON 真相 + Mermaid 视图） */
  "story_graph",
  /** 单集连续性图 */
  "episode_graph",
  /** 知识库拆书报告（kb.report_pipeline） */
  "analysis_report",
  /** 选题卡（topic.* 拉片/选题） */
  "topic_card",
  /** 期待感+矛盾设计态（lesson4） */
  "expectation_conflict",
  /** 男频金手指能力卡（male.gold_finger） */
  "gold_finger_cap",
  /** 男频开篇钩（male.opening） */
  "opening_hook",
  /** 男频升级循环（male.upgrade_loop） */
  "upgrade_loop",
  /** 查理二十节拍（struct.beat20） */
  "beat20",
  /** 二十节拍大纲 */
  "beat20_outline",
  /** 女频追妻五部曲（struct.chase_wife） */
  "chase_wife_pentalogy",
  /** 女频卷纲节奏（female.pace） */
  "pace_plan",
  /** 查理 Revise20 体检报告 */
  "revise20_report",
  /** IP 选书评分（ip.select_score） */
  "select_score",
  /** 历史遗留：早期弱模型误产类型，兼容展示不报错 */
  "episode_body",
  "other",
]);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const ArtifactStatusSchema = z.enum([
  "draft",
  "candidate",
  "adopted",
  "rejected",
  "archived",
]);
export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>;

export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const GateResultSchema = z.enum([
  "pass",
  "fail",
  "warn",
  "inconclusive",
]);
export type GateResult = z.infer<typeof GateResultSchema>;

export const JobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "dead",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const KnowledgeDocTypeSchema = z.enum([
  "novel",
  "short",
  "script_manju",
  "script_duanju",
  "notes",
  "other",
]);
export type KnowledgeDocType = z.infer<typeof KnowledgeDocTypeSchema>;

export const KnowledgeDocStatusSchema = z.enum([
  "uploading",
  "parsing",
  "indexed",
  "analyzing",
  "ready",
  "failed",
]);
export type KnowledgeDocStatus = z.infer<typeof KnowledgeDocStatusSchema>;

export const GenderChannelSchema = z.enum(["male", "female", "unknown"]);
export type GenderChannel = z.infer<typeof GenderChannelSchema>;

export const FORMAT_LABELS: Record<ProjectFormat, string> = {
  manju: "漫剧",
  duanju: "短剧",
  short_novel: "短篇网文",
  male_long: "男频中长篇",
  female_long: "女频中长篇",
  ip_adapt: "IP 改编",
};

export const MALE_LONG_STAGE_LABELS: Record<MaleLongStage, string> = {
  S0_SETUP: "项目设置",
  S1_TOPIC_SCAN: "刷榜选题",
  S2_GOLD_FINGER: "金手指设定",
  S3_CHARACTER: "人设",
  S4_VOLUME: "卷纲",
  S5_CHAPTER: "章纲",
  S6_BEAT: "细纲",
  S7_BODY: "正文",
  S8_COOL_DENSITY: "爽点密度",
  S9_RISK: "雷区质检",
  S10_DONE: "完成",
};

export const FEMALE_LONG_STAGE_LABELS: Record<FemaleLongStage, string> = {
  S0_SETUP: "项目设置",
  S1_TOPIC: "选题",
  S1_FOUR_SWAP: "四换三",
  S2_CHARACTER: "人设",
  S3_VOLUME: "卷纲",
  S4_CHAPTER: "章纲",
  S5_BEAT: "细纲",
  S6_BODY: "正文",
  S7_RHYTHM: "节奏情绪",
  S8_TABOO: "雷区",
  S9_PAYWALL: "付费点",
  S10_DONE: "完成",
};

export const MANJU_STAGE_LABELS: Record<ManjuStage, string> = {
  S0_SETUP: "项目设置",
  S1_HOOK_BATCH: "核心梗批量",
  S2_HOOK_CRITIC: "核心梗评审",
  S2_HOOK_SELECT: "核心梗筛选",
  S2_LOGLINE_100: "100字测试",
  S2_COOL_BATCH: "爽虐点批量",
  S3_BIO: "人设小传",
  S3_BIO_ACK: "小传确认",
  S4_EP10_OUTLINE: "前十集大纲",
  S4_OUTLINE_ACK: "大纲确认",
  S5_EP_BODY_BATCH: "分集正文",
  S6_QA: "规格校正",
  S7_STORYBOARD: "去小说化",
  S8_DIALOGUE: "台词加压",
  S9_DE_AI: "去 AI 味",
  S10_HUMAN_QC: "人工校稿",
  S11_EXTEND: "扩展大纲",
  S11_PITCH: "投稿打包",
  S11_DONE: "完成",
};

export const DUANJU_STAGE_LABELS: Record<DuanjuStage, string> = {
  S0_PRODUCT: "产品锁",
  S1_TOPIC: "选题三问",
  S1_TOPIC_ACK: "选题确认",
  S2_BIO: "人设",
  S3_BEAT20: "二十节拍",
  S4_EP10_DRAFT: "十集大纲生成",
  S4_EP10: "十集大纲确认",
  S5_SCENE: "场级正文",
  S6_REVISE20: "修改20",
  S7_SUBMIT: "红线与交付",
};

/** 短篇：对应 2.md 商业工作流 灵感→拆书→换元→总纲→章纲→细纲→初稿→修改 */
export const SHORT_NOVEL_STAGE_LABELS: Record<ShortNovelStage, string> = {
  S0_SETUP: "项目设置",
  S1_DISSECT: "拆书参数",
  S2_SWAP: "换元选方案",
  S3_SYNOPSIS: "总纲/故事梗概",
  S4_CHAPTER_OUTLINE: "章纲",
  S5_BEAT: "细纲（情节点）",
  S6_BODY_CHAPTER: "正文初稿",
  S7_POLISH: "润色（节奏·情绪）",
  S8_QC: "质检",
  S9_DONE: "完成",
};

/** 短剧旧 id → 新 id（仅 duanju；避免污染 female_long 的 S2_CHARACTER 等） */
export const DUANJU_STAGE_ALIASES: Record<string, string> = {
  S0_SETUP: "S0_PRODUCT",
  S1_TOPIC_CONFLICT: "S1_TOPIC",
  S2_CHARACTER: "S2_BIO",
  S3_UNIT_STRUCTURE: "S3_BEAT20",
  S4_SCENE_OUTLINE: "S4_EP10_DRAFT",
  S4_EP10_OUTLINE: "S4_EP10_DRAFT",
  S5_BODY: "S5_SCENE",
  S6_HOOK_CHECK: "S6_REVISE20",
  S7_DE_AI: "S6_REVISE20",
  S8_HUMAN_QC: "S7_SUBMIT",
  S9_DONE: "S7_SUBMIT",
};

/** @deprecated 使用 DUANJU_STAGE_ALIASES / MANJU_STAGE_ALIASES */
export const STAGE_ID_ALIASES: Record<string, string> = {
  ...DUANJU_STAGE_ALIASES,
};

/** 漫剧旧 id → 新 id（人设先于大纲重排） */
export const MANJU_STAGE_ALIASES: Record<string, string> = {
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

export function normalizeStageId(format: ProjectFormat, stage: string): string {
  if (format === "manju") return MANJU_STAGE_ALIASES[stage] || stage;
  if (format === "duanju") return DUANJU_STAGE_ALIASES[stage] || stage;
  return stage;
}

export const STAGES_BY_FORMAT: Record<ProjectFormat, readonly string[]> = {
  manju: ManjuStageSchema.options,
  duanju: DuanjuStageSchema.options,
  short_novel: ShortNovelStageSchema.options,
  male_long: MaleLongStageSchema.options,
  female_long: FemaleLongStageSchema.options,
  ip_adapt: IpAdaptStageSchema.options,
};
