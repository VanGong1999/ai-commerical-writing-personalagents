import { z } from "zod";
import {
  ArtifactStatusSchema,
  ArtifactTypeSchema,
  GateResultSchema,
  GenderChannelSchema,
  JobStatusSchema,
  KnowledgeDocStatusSchema,
  KnowledgeDocTypeSchema,
  MarketSchema,
  ProjectFormatSchema,
  ProjectStatusSchema,
  RunStatusSchema,
} from "./enums";

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string(),
  format: ProjectFormatSchema,
  genreTags: z.array(z.string()).default([]),
  market: MarketSchema.default("cn"),
  stage: z.string(),
  status: ProjectStatusSchema.default("active"),
  progress: z.record(z.number()).default({}),
  coverMeta: z
    .object({
      logline: z.string().optional(),
      benchmark: z.string().optional(),
      deadline: z.string().optional(),
      targetWords: z.number().int().nonnegative().optional(),
      platform: z.string().optional(),
      /** off | score_only — Hermes 子集程序化评分，默认 off */
      rlMode: z.enum(["off", "score_only"]).optional(),
    })
    .default({}),
  budgetTokens: z.number().nullable().optional(),
  promptPackId: z.string().nullable().optional(),
  tokenUsed: z.number().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastOpenedAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ArtifactSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  type: ArtifactTypeSchema,
  title: z.string(),
  status: ArtifactStatusSchema.default("draft"),
  bodyMarkdown: z.string().default(""),
  bodyJson: z.record(z.unknown()).nullable().optional(),
  schemaVersion: z.string().default("1"),
  parentId: z.string().uuid().nullable().optional(),
  batchId: z.string().nullable().optional(),
  version: z.number().int().default(1),
  createdByRunId: z.string().uuid().nullable().optional(),
  adoptedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const CoreHookMotiveLinesSchema = z.object({
  career: z.string().default(""),
  revenge: z.string().default(""),
  conflict: z.string().default(""),
  survive: z.string().default(""),
});
export type CoreHookMotiveLines = z.infer<typeof CoreHookMotiveLinesSchema>;

const reviewScore = z.number().int().min(1).max(5);
export const CriticReviewSchema = z.object({
  ref:z.string(), sourceVersion:z.number().int().positive(),runId:z.string(),
  marketFit:reviewScore, innovation:reviewScore, motivation:reviewScore, opening:reviewScore, compliance:reviewScore,
  total:z.number().int().min(5).max(25), rank:z.number().int().positive(),
  recommendation:z.enum(["建议采用","可改后再评","淘汰"]), reason:z.string(),
});

export const CoreHookBodySchema = z.object({
  titleHook: z.string(),
  coreHook: z.string(),
  tags: z.array(z.string()).default([]),
  motivation: z.string().optional(),
  crisis: z.string().optional(),
  openingStructure: z.string().optional(),
  openingBeats: z.array(z.string()).default([]),
  /** 手册：事业线/复仇线/冲突线/生存线（缺则用 motivation 长文兜底） */
  motiveLines: CoreHookMotiveLinesSchema.default({}),
  /** 核心梗 vs 情节卡（2.md） */
  kind: z.enum(["core_hook", "plot_card"]).default("core_hook"),
  /** 爽点型 / 情感型 / 转折型 */
  category: z.enum(["thrill", "emotion", "twist"]).optional(),
  /** 一级 / 二级 / 单元内部 */
  size: z.enum(["L1", "L2", "unit"]).default("unit"),
  /** 情绪链条——跨题材要保持的核心 */
  emotionChain: z
    .array(
      z.object({
        label: z.string(),
        side: z.enum(["hurt", "hurter", "shared", "reader"]).default("shared"),
        intensity: z.number().optional(),
      }),
    )
    .default([]),
  abstractions: z
    .array(z.object({ concrete: z.string(), abstract: z.string() }))
    .default([]),
  conflicts: z.array(z.string()).default([]),
  plotCardSteps: z.array(z.string()).default([]),
  criticReview: CriticReviewSchema.optional(),
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
});
export type CoreHookBody = z.infer<typeof CoreHookBodySchema>;

/** 批量核心梗产物（items）里的单条候选 → 可采纳的单梗 CoreHookBody。 */
export function flattenCoreHookCandidate(item: Record<string, unknown>): CoreHookBody | null {
  if (!item || typeof item !== "object") return null;
  // 兼容「打包产物 items[]」与「单候选产物 {candidate: {...}}」两种形状
  const outer = item;
  if (item.candidate && typeof item.candidate === "object") {
    item = item.candidate as Record<string, unknown>;
  }
  const coreHook = String(item.core_hook ?? item.coreHook ?? "");
  const titleHook = String(item.title ?? item.titleHook ?? "");
  if (!coreHook && !titleHook) return null;
  const motRaw = item.motivation;
  let motivation = "";
  if (typeof motRaw === "string") {
    motivation = motRaw;
  } else if (motRaw && typeof motRaw === "object") {
    const entries = Object.entries(motRaw as Record<string, unknown>);
    motivation = entries
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}：${String(v)}`)
      .join("；");
  }
  // 兜底推导：模型偶发丢掉 motivation 字段（输出 four_step 结构）时，
  // 用「冲突线（危机）+ 追剧点」重建动机线，保证强采纳门禁可用；人工仍可编辑。
  if (!motivation) {
    const four = (item.four_step ?? item.fourStep ?? {}) as Record<string, unknown>;
    const parts: string[] = [];
    if (item.crisis) parts.push(`冲突线：${String(item.crisis)}`);
    const chase = four.hook_point ?? four.hookPoint;
    if (chase) parts.push(`追剧点：${String(chase)}`);
    motivation = parts.join("；");
  }
  const openingStructure = String(
    item.opening ?? item.openingStructure ?? item.opening_structure ?? "",
  );
  const tags = unwrapItemList(item.tags);
  const openingBeats = unwrapItemList(item.opening_beats ?? item.openingBeats);
  const riskFlags = Array.isArray(item.risk_flags ?? item.riskFlags)
    ? ((item.risk_flags ?? item.riskFlags) as unknown[]).map((r) => String(r))
    : [];
  return CoreHookBodySchema.parse({
    titleHook,
    coreHook,
    tags,
    motivation: motivation || undefined,
    crisis: item.crisis ? String(item.crisis) : undefined,
    openingStructure: openingStructure || undefined,
    openingBeats,
    criticReview: CriticReviewSchema.safeParse(outer.criticReview).data,
    scores: CoreHookBodySchema.shape.scores.safeParse(outer.scores ?? item.scores).data,
    favorited: Boolean(item.favorited),
    riskFlags,
  });
}

/** LLM 偶发把数组包成 {item: [...]}（可多层嵌套）→ 递归拍平为字符串数组。 */
export function unwrapItemList(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "string" ? v : String(v))).filter(Boolean);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("item" in obj) return unwrapItemList(obj.item);
    if ("items" in obj) return unwrapItemList(obj.items);
  }
  return [];
}

/** 情节点锚点：把付费点/卡点/情绪峰/爽点钉到「集/场/正文片段」，支撑情节点地图双向高亮 */
export const StoryAnchorSchema = z.object({
  id: z.string(),
  /** 关联情节点 id（与 EpisodeOutlineBody.anchors / ManuscriptBody.anchors 对齐） */
  beatId: z.string().optional(),
  kind: z
    .enum(["paywall", "cliff", "emotion_peak", "cool", "beat"])
    .default("beat"),
  label: z.string().default(""),
  episodeNo: z.number().int().optional(),
  sceneNo: z.number().int().optional(),
  intensity: z.number().optional(),
});
export type StoryAnchor = z.infer<typeof StoryAnchorSchema>;

export const EpisodeOutlineBodySchema = z.object({
  episodeNo: z.number().int(),
  title: z.string(),
  summary: z.string(),
  beats: z.array(z.string()).default([]),
  hookAtEnd: z.boolean().default(false),
  emotionPeak: z.number().optional(),
  /** 情节点个数（控长主手段，2.md） */
  plotPointCount: z.number().int().optional(),
  coolPoint: z.string().optional(),
  /** 手册十八模型名（可多选） */
  coolModels: z.array(z.string()).default([]),
  /** 卡点类型（∈ MANJU_KARTIAN） */
  cliffType: z.string().default(""),
  /** 卡点文案 */
  cliffText: z.string().default(""),
  /** 手册「能不能用」人工门 */
  humanVerdict: z.enum(["pending", "reject", "accept"]).default("pending"),
  rejectReason: z.string().default(""),
  paywallHint: z.string().optional(),
  unitStoryTitle: z.string().optional(),
  sevenStepsBrief: z.string().optional(),
  /** 情节点锚点：付费点/卡点/情绪峰/爽点 在本集内的落点（供情节点地图与正文联动高亮） */
  anchors: z.array(StoryAnchorSchema).default([]),
  /** 付费点文案（= 付费卡点），缺则按 cliff 兜底 */
  paywallPoint: z.string().optional(),
});
export type EpisodeOutlineBody = z.infer<typeof EpisodeOutlineBodySchema>;

/** 第五节投稿三块：剧本信息 / 故事大纲 / 人物小传 */
export const PitchPackCharacterBioSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  identity: z.string().default(""),
  personality: z.string().default(""),
  motivation: z.string().default(""),
  relationToProtagonist: z.string().default(""),
});
export type PitchPackCharacterBio = z.infer<typeof PitchPackCharacterBioSchema>;

export const PitchPackScriptInfoSchema = z.object({
  title: z.string().default(""),
  genreTags: z.array(z.string()).default([]),
  episodeEstimate: z.number().int().positive().default(100),
  audience: z.string().default("下沉市场男性群体"),
  sellingPoint: z.string().default(""),
  adaptBenchmark: z.string().default(""),
});
export type PitchPackScriptInfo = z.infer<typeof PitchPackScriptInfoSchema>;

export const PitchPackBodySchema = z.object({
  schemaVersion: z.literal("manju-handbook/1").default("manju-handbook/1"),
  scriptInfo: PitchPackScriptInfoSchema.default({}),
  storyOutline: z.string().default(""),
  characterBios: z.array(PitchPackCharacterBioSchema).default([]),
  notes: z.string().default(""),
});
export type PitchPackBody = z.infer<typeof PitchPackBodySchema>;

export function validateEpisodeOutlineHandbookRow(row: EpisodeOutlineBody): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!row.summary?.trim()) {
    return { ok: false, level: "warn", message: "分集内容为空" };
  }
  if (!row.coolModels?.length && !row.coolPoint?.trim()) {
    return { ok: false, level: "warn", message: "缺爽点模型/文案" };
  }
  if (!row.cliffType?.trim() || !row.cliffText?.trim()) {
    return { ok: false, level: "warn", message: "缺卡点类型或文案" };
  }
  return { ok: true, level: "pass", message: `EP${row.episodeNo} 爽卡齐` };
}

export function validateEp10HandbookAccept(rows: EpisodeOutlineBody[]): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  const ten = rows.filter((r) => r.episodeNo >= 1 && r.episodeNo <= 10);
  const accepted = ten.filter((r) => r.humanVerdict === "accept").length;
  if (accepted < 10) {
    return { ok: false, level: "warn", message: `前十能不能用 ${accepted}/10 accept` };
  }
  return { ok: true, level: "pass", message: "前十集大纲人工可用" };
}

export function validatePitchPackBody(pack: PitchPackBody): {
  ok: boolean;
  level: "pass" | "warn";
  message: string;
} {
  if (!pack.scriptInfo.title.trim() || !pack.scriptInfo.sellingPoint.trim()) {
    return { ok: false, level: "warn", message: "剧本信息缺片名/卖点" };
  }
  if (pack.storyOutline.trim().length < 200) {
    return { ok: false, level: "warn", message: "故事大纲过短（≥200）" };
  }
  const bios = pack.characterBios.filter((b) => b.name.trim() && b.motivation.trim());
  if (bios.length < 2) {
    return { ok: false, level: "warn", message: "人物小传至少2人（名+动机）" };
  }
  return { ok: true, level: "pass", message: "投稿三块可" };
}

export function summarizePitchPackToMaster(
  pack: PitchPackBody,
): { manjuPitchPackSummary: string } {
  const g = validatePitchPackBody(pack);
  const parts = [
    pack.scriptInfo.title.trim() || "",
    g.ok ? "三块齐" : "",
    `小传${pack.characterBios.length}`,
  ].filter(Boolean);
  return { manjuPitchPackSummary: parts.join(" · ") };
}

export const ManuscriptBodySchema = z.object({
  episodeNo: z.number().int(),
  scenes: z
    .array(
      z.object({
        visual: z.string(),
        dialogue: z.string(),
      }),
    )
    .default([]),
  wordCount: z.number().default(0),
  hookAtEnd: z.boolean().default(false),
  /** 正文段落锚点：标记本集哪些段落对应付费点/卡点/情绪峰/爽点 */
  anchors: z.array(StoryAnchorSchema).default([]),
  /** 生成时声明的情节点覆盖数 */
  coveredPlotPoints: z.number().int().optional(),
  generationBand: z
    .object({
      minChars: z.number().int().default(2000),
      maxChars: z.number().int().default(3000),
    })
    .optional(),
  queueStatus: z
    .enum(["pending", "generating", "review", "adopted", "failed"])
    .default("pending"),
});
export type ManuscriptBody = z.infer<typeof ManuscriptBodySchema>;

export const PromptTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  format: z.array(z.string()),
  stage: z.string(),
  lockedSystem: z.string(),
  editableInstruction: z.string(),
  lockedHash: z.string(),
  requiredPhrases: z.array(z.string()).default([]),
  exampleSlots: z.array(z.string()).default([]).optional(),
  variables: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        type: z.enum(["string", "number", "select", "tags"]).or(z.string()),
        required: z.boolean().default(false).optional(),
        options: z.array(z.string()).optional(),
        defaultValue: z.unknown().optional(),
      }),
    )
    .default([]),
  outputSchema: z.string().optional(),
  gates: z.array(z.string()).default([]),
  version: z.number().int().default(1),
});
export type PromptTemplate = z.infer<typeof PromptTemplateSchema>;

export const PromptPackSchema = z.object({
  id: z.string(),
  name: z.string(),
  format: ProjectFormatSchema,
  templateIds: z.array(z.string()),
  description: z.string().optional(),
});
export type PromptPack = z.infer<typeof PromptPackSchema>;

export const GateCheckSchema = z.object({
  id: z.string(),
  name: z.string(),
  result: GateResultSchema,
  message: z.string(),
});
export type GateCheck = z.infer<typeof GateCheckSchema>;

export const AgentRunSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  agentId: z.string(),
  status: RunStatusSchema,
  inputJson: z.record(z.unknown()).default({}),
  outputArtifactIds: z.array(z.string()).default([]),
  tokenPrompt: z.number().default(0),
  tokenCompletion: z.number().default(0),
  model: z.string().optional(),
  gateResults: z.array(GateCheckSchema).default([]),
  receiptId: z.string().nullable().optional(),
  parentRunId: z.string().uuid().nullable().optional(),
  createdAt: z.string(),
  finishedAt: z.string().nullable().optional(),
});
export type AgentRun = z.infer<typeof AgentRunSchema>;

export const RunDigestSchema = z.object({
  id: z.string(),
  runId: z.string(),
  narrative: z.string().default(""),
  artifacts: z.array(z.record(z.unknown())).default([]),
  memoryChanges: z.array(z.record(z.unknown())).default([]),
  gates: z.array(z.record(z.unknown())).default([]),
  leftover: z.string().default(""),
  createdAt: z.string(),
});
export type RunDigest = z.infer<typeof RunDigestSchema>;

export const UsageEventSchema = z.object({
  id: z.union([z.string().uuid(), z.string().startsWith("run.digest:")]),
  phase: z.literal("run.digest").nullable().optional(),
  userId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  runId: z.string().uuid().nullable().optional(),
  agentId: z.string().optional(),
  botId: z.string().nullable().optional(),
  model: z.string(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  cacheHitTokens: z.number().default(0),
  cacheMissTokens: z.number().default(0),
  costEst: z.number().nullable().default(0),
  durationMs: z.number().nullable().optional(),
  createdAt: z.string(),
});
export type UsageEvent = z.infer<typeof UsageEventSchema>;

export const JobSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  payload: z.record(z.unknown()).default({}),
  status: JobStatusSchema,
  priority: z.number().default(0),
  projectId: z.string().uuid().nullable().optional(),
  userId: z.string().uuid(),
  attempts: z.number().default(0),
  maxAttempts: z.number().default(3),
  scheduledAt: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  resultRef: z.string().nullable().optional(),
  parentJobId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type Job = z.infer<typeof JobSchema>;

export const KnowledgeDocSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  source: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  docType: KnowledgeDocTypeSchema,
  genderChannel: GenderChannelSchema.default("unknown"),
  tags: z.array(z.string()).default([]),
  status: KnowledgeDocStatusSchema,
  wordCount: z.number().nullable().optional(),
  storageUri: z.string().optional(),
  hash: z.string().optional(),
  visibility: z.enum(["private", "workspace"]).default("private"),
  analysisReportIds: z.array(z.string()).default([]),
  graphId: z.string().nullable().optional(),
  folderId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KnowledgeDoc = z.infer<typeof KnowledgeDocSchema>;

export const AnalysisReportSchema = z.object({
  id: z.string().uuid(),
  docId: z.string().uuid(),
  reportType: z.string(),
  title: z.string(),
  bodyMarkdown: z.string(),
  bodyJson: z.record(z.unknown()).nullable().optional(),
  schemaVersion: z.string().default("1"),
  favorited: z.boolean().optional(),
  sourceFragments: z.array(z.record(z.unknown())).optional(),
  createdAt: z.string(),
});
export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;

export const TropeClipSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  summary: z.string(),
  sourceDocId: z.string().uuid().nullable().optional(),
  sourceLocator: z.string().optional(),
  tags: z.array(z.string()).default([]),
  emotionPeak: z.number().nullable().optional(),
  applicableGenres: z.array(z.string()).default([]),
  swapHints: z.string().optional(),
  favorited: z.boolean().default(false),
});
export type TropeClip = z.infer<typeof TropeClipSchema>;

export const GraphNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.string(),
  props: z.record(z.unknown()).optional(),
});
export const GraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  relationType: z.string(),
  strength: z.number().optional(),
});
export const GraphSnapshotSchema = z.object({
  id: z.string().uuid(),
  docId: z.string().uuid(),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});
export type GraphSnapshot = z.infer<typeof GraphSnapshotSchema>;

export const MemoryMetaSchema = z.object({
  displayPath: z.string().nullable().optional(),
  path: z.string(),
  userId: z.string().uuid().or(z.string()),
  projectId: z.string().uuid().nullable().optional().or(z.string().nullable().optional()),
  storeId: z.string().nullable().optional(),
  frozen: z.boolean().default(false),
  hash: z.string().nullable().optional(),
  sourceRunId: z.string().nullable().optional(),
  sourceConversationId: z.string().nullable().optional(),
  actor: z.string().default("user"),
  memoryKind: z.string().nullable().optional(),
  updatedAt: z.string(),
  content: z.string().optional(),
  isHypothesis: z.boolean().default(false),
  confidence: z.number().default(0.5),
  accessCount: z.number().default(0),
  lastAccessedAt: z.string().nullable().optional(),
});
export type MemoryMeta = z.infer<typeof MemoryMetaSchema>;

export const MemoryVersionSchema = z.object({
  id: z.string(),
  path: z.string(),
  storeId: z.string().nullable().optional(),
  content: z.string().default(""),
  hash: z.string().nullable().optional(),
  preconditionHash: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  changeSummary: z.string().nullable().optional(),
  actor: z.string().default("user"),
  sourceRunId: z.string().nullable().optional(),
  sourceConversationId: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type MemoryVersion = z.infer<typeof MemoryVersionSchema>;

export const MemoryStoreSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  scopeRef: z.string().nullable().optional(),
  description: z.string().default(""),
  status: z.string().default("active"),
  shared: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MemoryStore = z.infer<typeof MemoryStoreSchema>;

export const DreamChangeSchema = z.object({
  provenance: z.object({
    category: z.string(), conversationId: z.string(), messageId: z.string(), eventId: z.string(),
    sourceHash: z.string(), start: z.number(), end: z.number(), quote: z.string(),
  }).nullable().optional(),
  id: z.string(),
  dreamJobId: z.string(),
  path: z.string(),
  op: z.string(),
  beforeContent: z.string().default(""),
  afterContent: z.string().default(""),
  editedContent: z.string().nullable().optional(),
  beforeHash: z.string().nullable().optional(),
  rationale: z.string().default(""),
  status: z.string().default("pending"),
  conflictDetail: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type DreamChange = z.infer<typeof DreamChangeSchema>;

export const DreamJobSchema = z.object({
  id: z.string(),
  storeId: z.string(),
  projectId: z.string().nullable().optional(),
  status: z.string(),
  title: z.string(),
  windowHours: z.number().default(168),
  sessionIds: z.array(z.string()).default([]),
  runIds: z.array(z.string()).default([]),
  instructions: z.string().default(""),
  reportMarkdown: z.string().default(""),
  tokenEstimate: z.number().default(0),
  error: z.string().nullable().optional(),
  createdBy: z.string().default("user"),
  createdAt: z.string(),
  finishedAt: z.string().nullable().optional(),
  mergedAt: z.string().nullable().optional(),
  changes: z.array(DreamChangeSchema).default([]),
});
export type DreamJob = z.infer<typeof DreamJobSchema>;

export const TaskProposalSchema = z.object({
  id: z.string().uuid(),
  type: z.enum([
    "suggest",
    "scan",
    "team_plan",
    "colleague.proactive",
    "colleague.suggestion",
  ]),
  message: z.string(),
  projectId: z.string().uuid().nullable().optional(),
  actions: z
    .array(
      z.object({
        label: z.string(),
        needsApproval: z.boolean().default(true),
        actionId: z.string(),
      }),
    )
    .default([]),
  status: z.enum(["pending", "approved", "dismissed"]).default("pending"),
  read: z.boolean().default(false),
  createdAt: z.string(),
  runId: z.string().uuid().nullable().optional(),
  jobId: z.string().uuid().nullable().optional(),
});
export type TaskProposal = z.infer<typeof TaskProposalSchema>;

export const ProviderConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  apiKeyMasked: z.string(),
  models: z.array(z.string()).default([]),
  selectedModel: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  pricing: z.record(z.string(), z.unknown()).default({}),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const HotspotSchema = z.object({
  id: z.string(),
  title: z.string(),
  genre: z.string(),
  source: z.string(),
  summary: z.string(),
  fetchedAt: z.string(),
  status: z.enum(["ok", "failed"]).default("ok"),
  meta: z.record(z.string(), z.unknown()).optional(),
  projectId: z.string().nullable().optional(),
});
export type Hotspot = z.infer<typeof HotspotSchema>;

export const ScheduledTaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  cronOrInterval: z.string(),
  enabled: z.boolean(),
  ownerScope: z.enum(["system", "user", "assistant"]),
  lastRunAt: z.string().nullable().optional(),
  nextRunAt: z.string().nullable().optional(),
  description: z.string().optional(),
  payloadTemplate: z.record(z.unknown()).optional(),
});
export type ScheduledTask = z.infer<typeof ScheduledTaskSchema>;

export const CreateProjectInputSchema = z.object({
  title: z.string().min(1),
  format: ProjectFormatSchema,
  genreTags: z.array(z.string()).default([]),
  market: MarketSchema.default("cn"),
  budgetTokens: z.number().int().nonnegative().optional(),
  promptPackId: z.string().optional(),
  coverMeta: z
    .object({
      logline: z.string().optional(),
      benchmark: z.string().optional(),
      deadline: z.string().optional(),
      targetWords: z.number().int().nonnegative().optional(),
      platform: z.string().optional(),
      hook: z.union([z.record(z.unknown()), z.string()]).optional(),
    })
    .optional(),
  startFrom: z
    .enum(["blank", "kb_dissect", "existing_hook", "ip"])
    .default("blank"),
  sourceDocId: z.string().uuid().optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;
