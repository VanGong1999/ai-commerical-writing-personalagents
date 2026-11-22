import type { ContextRef } from "../features/references/selection";
import {
  type AnalysisReport,
  type Artifact,
  type CreateProjectInput,
  type GateCheck,
  type GraphSnapshot,
  type Hotspot,
  type Job,
  type KnowledgeDoc,
  type DreamJob,
  type DreamChange,
  type MemoryMeta,
  type MemoryStore,
  type MemoryVersion,
  type Project,
  type ProjectFormat,
  type PromptTemplate,
  type ProviderConfig,
  type ScheduledTask,
  type TaskProposal,
  type TropeClip,
  type UsageEvent,
  type AgentRun,
  type RunDigest,
} from "@xiezuomanju/domain";
import { streamJobEvents, type JobEvent } from "./sse";

const base = (import.meta.env.VITE_API_BASE as string) || "";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (!isForm && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${base}/api/v1${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}


export type Inspiration = {
  id: string;
  userId: string;
  level: "notion" | "idea" | "concept" | "topic" | string;
  sourceText: string;
  candidates: Array<{
    title?: string;
    logline?: string;
    scores?: Record<string, number>;
    format?: string;
    risk?: string[];
    [key: string]: unknown;
  }>;
  tags: string[];
  formatHint?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateInspirationInput = {
  level?: "notion" | "idea" | "concept" | "topic";
  sourceText: string;
  tags?: string[];
  formatHint?: string | null;
};

export type CrawlerSource = {
  id: string;
  name: string;
  scope: string;
  interval: string;
  enabled: boolean;
  robotsAck: boolean;
  lastRunAt?: string | null;
  status: string;
  needsCookie?: boolean;
  lastError?: string | null;
  lastItemCount?: number;
  hasCookie?: boolean;
};

export type CrawlReport = {
  id: string;
  sourceId: string;
  platform: string;
  boardName: string;
  title: string;
  bodyMarkdown: string;
  bodyJson: {
    stats?: {
      itemCount?: number;
      genres?: { name: string; count: number }[];
      keywords?: { name: string; count: number }[];
      needsCookie?: boolean;
      cookieHint?: string;
      error?: string | null;
    };
    items?: {
      rank: number;
      title: string;
      author?: string;
      genre?: string;
      abstract?: string;
      status?: string;
      url?: string;
      tags?: string[];
    }[];
    advice?: string[];
    hookSeeds?: string[];
  };
  itemCount: number;
  needsCookie: boolean;
  cookieHint: string;
  status: string;
  error?: string | null;
  createdAt: string;
};

export type SwapPlan = {
  id: string;
  userId: string;
  projectId?: string | null;
  sourceDocId?: string | null;
  degree: string;
  mappingJson: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
};

export type ComposeSwapResult = {
  degree: string;
  base: { docId: string; title: string };
  sources: Array<{ docId: string; title: string; usedFor: string[] }>;
  mapping: Array<{
    key: string;
    label: string;
    source: string;
    target: string;
    sourceDocId?: string | null;
    sourceDocTitle?: string | null;
    swappable: boolean;
  }>;
  swapPlanId?: string | null;
};

export type CreateSwapPlanInput = {
  projectId?: string | null;
  sourceDocId?: string | null;
  degree?: "one" | "two";
  mappingJson?: Array<Record<string, unknown>>;
};

export type AssistantAction = {
  type: string;
  label: string;
  to?: string;
  agentId?: string;
  projectId?: string;
  taskId?: string;
  sourceId?: string;
  payload?: Record<string, unknown>;
};

export type AssistantChatResult = {
  reply: string;
  actions: AssistantAction[];
  toolResults: Array<Record<string, unknown>>;
  runId?: string | null;
};

export type CowriteResult = {
  result: string;
  hint: string;
};

export type Conversation = {
  id: string;
  source: string;
  userId: string;
  projectId?: string | null;
  title: string;
  kind?: "dm" | "group" | "routine" | "bot_dm" | string;
  botId?: string | null;
  teamId?: string | null;
  memberBotIds?: string[];
  groupRules?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type FeishuReplyPart = { position: number; status: string; attempts: number; retries: number; receipt?: string; detail?: string };

export type ConversationMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCalls: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  confirm?: boolean;
  runId?: string | null;
  botId?: string | null;
  mentions?: string[];
  evidence?: Array<Record<string, unknown>>;
  contextRefs?: ContextRef[];
  createdAt: string;
};

export type BotAvatar = {
  emoji?: string;
  color?: string;
  image?: string;
  [key: string]: unknown;
};

export type KnowledgeExecution = {enabled?:boolean; projectId?:string; formats?:string[]; stage?:string; documentIds?:string[]};

export type Bot = {
  execution?: KnowledgeExecution;
  id: string;
  name: string;
  aliases: string[];
  avatar: BotAvatar;
  persona: string;
  tone: string;
  duties: string[];
  neverDo: string[];
  roleKind: string;
  delegateOnly: boolean;
  allowedAgentIds: string[];
  toolAllowlist: string[];
  modelProfile: string;
  trustLevel: number;
  vetoWindowMin: number;
  restateBeforeAct: boolean;
  /** 代主人操作系统时的通知策略：all 全部 / important 仅重要 / none 静默（审计始终记录） */
  notifyPolicy?: NotifyPolicy;
  weeklyTokenBudget?: number | null;
  pinned: boolean;
  isSystem: boolean;
  templateId?: string | null;
  status: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type NotifyPolicy = "all" | "important" | "none";

export type BotCreateInput = {
  execution?: KnowledgeExecution;
  name: string;
  aliases?: string[];
  avatar?: BotAvatar;
  persona?: string;
  tone?: string;
  duties?: string[];
  neverDo?: string[];
  roleKind?: string;
  delegateOnly?: boolean;
  allowedAgentIds?: string[];
  toolAllowlist?: string[];
  modelProfile?: string;
  trustLevel?: number;
  vetoWindowMin?: number;
  restateBeforeAct?: boolean;
  notifyPolicy?: NotifyPolicy;
  weeklyTokenBudget?: number | null;
  pinned?: boolean;
  templateId?: string | null;
};

export type BotPatchInput = Partial<
  Omit<BotCreateInput, "templateId"> & { status?: string }
>;

export type BotSkill = {
  id: string;
  botId?: string | null;
  name: string;
  slash: string;
  whenToUse: string;
  inputs: Array<Record<string, unknown>>;
  stepsMd: string;
  evidenceRequired: boolean;
  confirmWhen: string;
  version: number;
  trustStage: string;
  cleanRuns: number;
  sourceConversationId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BotSkillCreateInput = {
  name: string;
  slash?: string;
  whenToUse?: string;
  inputs?: Array<Record<string, unknown>>;
  stepsMd?: string;
  evidenceRequired?: boolean;
  confirmWhen?: string;
  sourceConversationId?: string | null;
};

export type BotTeam = {
  id: string;
  name: string;
  memberBotIds: string[];
  leadBotId?: string | null;
  rulesMd: string;
  truthSourcePath?: string | null;
  speakPolicy: string;
  maxRounds: number;
  ownerUserId: string;
  templateId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BotTeamCreateInput = {
  name: string;
  memberBotIds?: string[];
  leadBotId?: string | null;
  rulesMd?: string;
  truthSourcePath?: string | null;
  speakPolicy?: string;
  maxRounds?: number;
  templateId?: string | null;
};

export type BotTeamPatchInput = Partial<Omit<BotTeamCreateInput, "templateId">>;

export type BotTemplate = {
  id: string;
  kind: "bot" | "team" | string;
  name: string;
  description: string;
  payload: Record<string, unknown>;
};

export type BotImportInput = {
  templateId?: string | null;
  payload?: Record<string, unknown> | null;
  nameOverride?: string | null;
};

export type BotImportResult =
  | { kind: "bot"; bot: Bot }
  | { kind: "team"; team: BotTeam };

export type RosterColleague = {
  projectId?: string;
  id: string;
  agentId?: string;
  name: string;
  displayName?: string;
  catalogName?: string;
  team: string;
  teamColor: string;
  emoji: string;
  summary: string;
  when: string;
  formats?: string[];
  formatLabels?: string[];
  stage?: string | null;
  tools?: Array<{ id: string; label: string; desc: string }>;
  upstream?: Array<{ id: string; agentId: string; name: string }>;
  downstream?: Array<{ id: string; agentId: string; name: string }>;
  examplePrompts?: string[];
  roleKind?: string;
  isVirtual?: boolean;
  pinned?: boolean;
  advanced?: boolean;
  aliases?: string[];
};

export type RosterTeamGroup = {
  team: string;
  teamColor: string;
  emoji: string;
  count: number;
  members: RosterColleague[];
};

export type BotRoster = {
  chief: RosterColleague;
  eggbot: RosterColleague;
  teams: RosterTeamGroup[];
  stats: { domainAgents: number; teams: number };
};

export type SquadPreset = {
  id: string;
  kind: "workflow" | "team" | string;
  format?: string | null;
  name: string;
  description: string;
  speakPolicy: string;
  leadBotId: string;
  memberBotIds: string[];
  stages: Array<{
    id?: string;
    name?: string;
    requiresUserAck?: boolean;
    mode?: string;
    next?: string[];
    agentIds?: string[];
    memberBotIds?: string[];
  }>;
  coverageTeams: string[];
};

export type CoverageReport = {
  selectedCount: number;
  selectedTeams: string[];
  requiredCount: number;
  missing: Array<{
    agentId: string;
    botId: string;
    name: string;
    stage?: string;
    stageName?: string;
    team?: string;
  }>;
  coverageRatio: number;
};

export type BotMemoryFile = {
  path: string;
  content: string;
  hash?: string;
  updatedAt?: string;
};

export type BotRoutine = {
  id: string;
  name: string;
  cronOrInterval: string;
  enabled: boolean;
  prompt?: string | null;
  triggerType?: string;
  quietPolicy?: string;
  runCount?: number;
  lastCostTokens?: number;
  activeWindow?: Record<string, unknown> | null;
  eventFilter?: Record<string, unknown>;
  description?: string | null;
  botId?: string | null;
};

export type BotUsageSummary = {
  botId: string;
  days: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costEst: number | null;
  weeklyTokenBudget?: number | null;
  budgetRatio?: number | null;
  events: number;
};

export type InterviewQuestion = {
  key: string;
  prompt: string;
  type: string;
  default?: number | string;
};

export type ConversationEvent = {
  event: string;
  reply?: string;
  tool?: string;
  args?: Record<string, unknown>;
  detail?: Record<string, unknown>;
  messageId?: string;
  message?: string;
  [key: string]: unknown;
};

export type RunStepItem = {
  id: string;
  seq: number;
  actor: string;
  kind: string;
  payload: Record<string, unknown>;
  runId?: string | null;
  turnId?: string | null;
  createdAt: string;
};

export type ProjectReplayEvent = {
  at: string;
  kind: string;
  actor: string;
  summary: string;
  payload: Record<string, unknown>;
};

export type ProjectReplay = {
  projectId: string;
  title: string;
  stage: string;
  runCount: number;
  stepCount: number;
  events: ProjectReplayEvent[];
  runs: Array<{
    id: string;
    agentId: string;
    status: string;
    model?: string | null;
    artifactCount: number;
    createdAt: string;
    finishedAt?: string | null;
    execCheckpoint?: Record<string, unknown>;
  }>;
};

export type RunReplay = {
  run: {
    id: string;
    projectId?: string | null;
    conversationId?: string | null;
    agentId: string;
    status: string;
    model?: string | null;
    inputJson?: Record<string, unknown>;
    outputArtifactIds?: string[];
    gateResults?: Array<Record<string, unknown>>;
    receiptId?: string | null;
    tokenPrompt?: number;
    tokenCompletion?: number;
    execCheckpoint?: Record<string, unknown>;
    attempt?: number;
    createdAt: string;
    finishedAt?: string | null;
  };
  steps: RunStepItem[];
};

export type InboxEventItem = {
  id: string;
  source: string;
  status: string;
  payload: Record<string, unknown>;
  dedupeKey?: string | null;
  createdAt: string;
  processedAt?: string | null;
  waitMs?: number | null;
};

export type ThreadSubItem = {
  id: string;
  threadKey: string;
  runId?: string | null;
  runStatus?: string | null;
  agentId?: string | null;
  projectId?: string | null;
  projectTitle?: string | null;
  conversationId?: string | null;
  conversationTitle?: string | null;
  mode: string;
  status: string;
  createdAt: string;
};

export type ActiveRunItem = {
  runId: string;
  jobId?: string | null;
  agentId: string;
  label?: string | null;
  status: string;
  projectId?: string | null;
  projectTitle?: string | null;
  conversationId?: string | null;
  conversationTitle?: string | null;
  progressPct?: number;
  progressStage?: string | null;
  taskGroupId?: string | null;
  startedAt?: string;
  stuck?: boolean;
};

export type TimerItem = {
  id: string;
  name: string;
  cron?: string;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  note?: string | null;
  jobType?: string | null;
  ownerScope?: string;
  conversationId?: string | null;
  conversationTitle?: string | null;
};

export type WatchdogAlertItem = {
  id: string;
  seq: number;
  payload: Record<string, unknown>;
  runId?: string | null;
  conversationId?: string | null;
  conversationTitle?: string | null;
  createdAt: string;
};

export type ConversationRuntime = {
  conversationId: string;
  state: "idle" | "thinking" | "waiting_confirm" | string;
  pending: number;
  processing: number;
  activeRuns: ActiveRunItem[];
  subscriptions: ThreadSubItem[];
  timers: TimerItem[];
  specDrafts: Array<Record<string, unknown>>;
  alerts: WatchdogAlertItem[];
  waitingConfirm?: boolean;
};

export type BackendOverview = {
  stuckMinutes: number;
  activeRuns: ActiveRunItem[];
  subscriptions: ThreadSubItem[];
  timers: TimerItem[];
  alerts: WatchdogAlertItem[];
  inflightEvents: Array<{
    id: string;
    source: string;
    status: string;
    conversationId?: string | null;
    conversationTitle?: string | null;
    createdAt: string;
    waitMs?: number | null;
  }>;
};

export type DashboardSummary = {
  totals: {
    projects: number;
    active: number;
    flowDone: number;
    packageDone: number;
    wordCount: number;
    manuscripts: number;
    adopted: number;
    adoptionRate: number;
    tokenUsed: number;
  };
  byFormat: Array<{
    format: string;
    label: string;
    projects: number;
    flowDone: number;
    packageDone: number;
    wordCount: number;
    manuscripts: number;
    adopted: number;
  }>;
  byStatus: Array<{ status: string; count: number }>;
  usageTrend: Array<{ day: string; tokens: number }>;
};

export type UsageSummary = {
  used: number;
  costEst?: number;
  budget: number | null;
  remaining: number | null;
  over: boolean;
  byModel: Array<{ model: string; tokens: number }>;
  byBot?: Array<{ botId: string; name: string; tokens: number }>;
  byAgent?: Array<{ agentId: string; tokens: number }>;
  byRoutine?: Array<{
    id: string;
    name: string;
    botId?: string | null;
    runCount?: number;
    lastCostTokens?: number;
    enabled?: boolean;
  }>;
};

export type AppSettings = {
  usageBudgetMonthly: number | null;
  featureToggles?: Record<string, boolean>;
};

export type LlmTrafficSettings = {
  cap: number;
  effective: number;
  inflight: number;
  throttleUntil?: number | null;
  throttled: boolean;
  adaptiveEnabled: boolean;
  failoverEnabled: boolean;
  fleetDefaultConcurrency: number;
  paDeferWhenBusy: boolean;
  successStreak: number;
  cooldowns?: Record<string, number>;
};

export type EvalRubric = {
  id: string;
  key: string;
  name: string;
  format: string;
  artifactType: string;
  source: string;
  sourceRef: string;
  grader: string;
  codeGate?: string | null;
  question: string;
  guidance: string;
  severity: string;
  weight: number;
  wCodes: string[];
  passExample: string;
  failExample: string;
  version: number;
  enabled: boolean;
};

export type EvalRubricStats = {
  rubricKey: string;
  total: number;
  passRate: number;
  failRate: number;
  unknownRate: number;
  humanMachineAgreement: number | null;
  cohenKappa: number | null;
  pairedCount: number;
};

export type EvalSuite = {
  id: string;
  name: string;
  kind: string;
  tier: string;
  format: string;
  targetAgentId?: string | null;
  pipeline?: string | null;
  rubricKeys: string[];
  trialsK: number;
  thresholds: Record<string, unknown>;
  description: string;
  enabled: boolean;
  caseCount?: number;
};

export type EvalCase = {
  id: string;
  suiteId: string;
  title: string;
  inputJson: Record<string, unknown>;
  referenceMarkdown: string;
  expectedBehavior: string;
  label: string;
  tags: string[];
  origin: string;
  sourceRef: string;
  enabled: boolean;
};

export type EvalRun = {
  id: string;
  suiteId?: string | null;
  mode: string;
  variant: Record<string, unknown>;
  baselineRunId?: string | null;
  status: string;
  metrics: Record<string, unknown>;
  gateVerdict?: string | null;
  tokenCost: number;
  jobId?: string | null;
  progressPct: number;
  error?: string | null;
  createdAt?: string | null;
  finishedAt?: string | null;
};

export type EvalMatrix = {
  runId: string;
  caseIds: string[];
  rubricKeys: string[];
  cells: Array<{ caseId: string; rubricKey: string; verdict: string; trials: number }>;
  cases: Record<string, { id: string; title: string; label: string }>;
  trials: Array<{ id: string; caseId: string; trialIdx: number; passed?: boolean; score: number }>;
  metrics?: Record<string, unknown>;
  gateVerdict?: string | null;
};

export type EvalJudgment = {
  id: string;
  trialId?: string | null;
  artifactId?: string | null;
  rubricKey: string;
  grader: string;
  verdict: string;
  evidenceQuote?: string;
  reasoning?: string;
  judgeModel?: string | null;
  severity?: string;
  annotator?: string | null;
};

export type EvalTrialDetail = {
  processMetrics?: { assessment?: string; advisoryKeys?: string[] };
  id: string;
  evalRunId: string;
  caseId?: string | null;
  trialIdx: number;
  outputSnapshot: string;
  passed?: boolean | null;
  score: number;
  judgments: EvalJudgment[];
  agentRunId?: string | null;
  artifactId?: string | null;
};

export type EvalScoreResult = {
  passed: boolean;
  score: number;
  judgments: EvalJudgment[];
  detail: Record<string, unknown>;
  evalRunId?: string;
  trialId?: string;
  artifactId?: string;
  format?: string;
  artifactType?: string;
};

export type EvalCaseCandidate = {
  id: string;
  artifactId?: string | null;
  projectId?: string | null;
  signal: string;
  attribution?: string | null;
  attributionSuggestion?: string;
  fixSuggestion?: string;
  status: string;
  detail: Record<string, unknown>;
  createdAt?: string | null;
};

export type EvalAnnotateItem = {
  judgmentId: string;
  trialId?: string | null;
  artifactId?: string | null;
  rubricKey: string;
  question: string;
  outputPreview: string;
};

export type EvalAgreement = {
  pairedCount: number;
  humanMachineAgreement: number | null;
  cohenKappa: number | null;
  perRubric: Array<{
    rubricKey: string;
    agreement: number;
    kappa: number;
    n: number;
    needsRewrite: boolean;
  }>;
};

export type EvalConfig = {
  judgeModel?: string | null;
  monthlyBudgetTokens?: number;
  onlineSampleRate?: number;
  autoReviseEnabled?: boolean;
  autoReviseThreshold?: number;
  regressionTolerance?: number;
  tokensUsedThisMonth?: number;
  budgetRemaining?: number;
};

export type EvalOverview = {
  scorecards: Array<Record<string, unknown>>;
  trend: Array<Record<string, unknown>>;
  judgmentScopeCounts?: { required: number; advisory: number; unscoped: number };
  topFailingRubrics: Array<Record<string, unknown>>;
  wCodeDistribution: Record<string, number>;
  agreement: Record<string, unknown>;
  cost: Record<string, unknown>;
  maturity: {
    dimensions: Record<string, number>;
    shortestBoard: string;
    hint: string;
  };
  recentRegressionGate?: EvalRun | null;
  counts: Record<string, number>;
  config: EvalConfig;
};

export type AnalyticsCharts = {
  manuscriptTrend: Array<{ day: string; words: number }>;
  adoption: {
    adopted: number;
    candidates: number;
    discarded: number;
    total: number;
    rate: number;
  };
  stageDurations: Array<{ stage: string; hours: number }>;
  totalWords: number;
  targetWords: number | null;
};

export type ActivityItem = {
  id: string;
  actor: string;
  action: string;
  summary: string;
  projectId?: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type ArtifactVersionItem = {
  id: string;
  artifactId: string;
  version: number;
  title: string;
  status: string;
  bodyMarkdown: string;
  bodyJson?: Record<string, unknown> | null;
  note?: string | null;
  actor: string;
  createdAt: string;
};

export type ProjectSnapshotItem = {
  id: string;
  projectId: string;
  name: string;
  note?: string | null;
  stage: string;
  status: string;
  progress: Record<string, unknown>;
  coverMeta: Record<string, unknown>;
  artifacts: Array<Record<string, unknown>>;
  createdAt: string;
};

export type KbBindingItem = {
  id: string;
  docId: string;
  projectId: string;
  targetType: string;
  targetId: string;
  mode: string;
  createdAt: string;
};

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
};

export type KbSearchResult = {
  docs: KnowledgeDoc[];
  tropes: TropeClip[];
  answer: string;
  /** Present when API returns partitioned local/web results. */
  local?: {
    docs?: KnowledgeDoc[];
    tropes?: TropeClip[];
    answer?: string;
  };
  web?: {
    results?: WebSearchHit[];
    summary?: string;
    source?: string;
    fetchedAt?: string;
    enabled?: boolean;
  };
};

export type TropeCount = {
  tag: string;
  count: number;
};

export type TropeStats = {
  tropeCounts: TropeCount[];
  genreCounts: Array<{ genre: string; count: number }>;
  hookCategoryCounts: Array<{ category: string; count: number }>;
  totalTropes: number;
  totalDocs: number;
};

export type TropeSearchBook = {
  docId: string;
  title: string;
  matchedTags: string[];
  genre: string;
};

export type TropeSearchResult = {
  tropes: TropeClip[];
  books: TropeSearchBook[];
};

export type CreateKbDocInput = {
  title: string;
  docType?: string;
  tags?: string[];
};

export type AgentRunWithJob = AgentRun & {
  jobId?: string | null;
};

export type CreateRunOptions = {
  inputJson?: Record<string, unknown>;
  /** 控制平面恢复：resume | refuse | mark_done */
  operatorDecision?: string;
  /** 仅 createRunAndStream：中止 SSE */
  signal?: AbortSignal;
};

export type AutopilotStepIn = {
  id: string;
  agentId: string;
  label: string;
  adoptType?: string;
  adoptMode?: "draft" | "strong";
  episodeNo?: number;
  dependsOn?: string[];
};

export type AutopilotStartBody = {
  mode: "auto" | "step";
  steps: AutopilotStepIn[];
};

export type PolicyResumeInput = {
  lastEventType?: string;
  sideEffect?: string;
  alreadyApplied?: boolean;
  operatorDecision?: "resume" | "refuse" | "mark_done" | string;
};

export type PolicyResumeResult = {
  action: string;
  reason: string;
  recordFact?: string;
};

export type SaveProviderInput = {
  id?: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  selectedModel?: string | null;
  enabled: boolean;
  isDefault: boolean;
  pricing?: Record<string, { input?: number; cachedInput?: number; output?: number }>;
};

export type TestProviderInput = {
  baseUrl: string;
  apiKey: string;
  model?: string;
};

export type TestProviderResult = {
  ok: boolean;
  model?: string | null;
  error?: string | null;
};

function normalizeSearch(raw: Record<string, unknown>): KbSearchResult {
  const docs = (raw.docs as KnowledgeDoc[]) ?? [];
  const tropes = (raw.tropes as TropeClip[]) ?? [];
  const answer = typeof raw.answer === "string" ? raw.answer : "";
  const local = raw.local as KbSearchResult["local"] | undefined;
  const web = raw.web as KbSearchResult["web"] | undefined;
  return {
    docs: local?.docs ?? docs,
    tropes: local?.tropes ?? tropes,
    answer: local?.answer ?? answer,
    local: local ?? { docs, tropes, answer },
    web,
  };
}

async function resolveJobIdForRun(run: AgentRun): Promise<string | undefined> {
  const qs = run.projectId ? `?project_id=${encodeURIComponent(run.projectId)}` : "";
  const jobs = await http<Job[]>(`/jobs${qs}`);
  const match = jobs.find(
    (j) =>
      j.resultRef === run.id ||
      (j.payload as { runId?: string })?.runId === run.id,
  );
  return match?.id;
}

export type FleetCreateInput = {
  projectId: string;
  mode?: "synthesis" | "ordered" | "union";
  mergePolicy?: "semantic_repair" | "human" | "refuse";
  synthesisAgentId?: string;
  members: Array<{
    name: string;
    task: string;
    agentId?: string;
    workdir?: string;
    securityMode?: "readonly" | "safe" | "yolo";
  }>;
};

export type FleetReport = {
  name: string;
  agentId?: string;
  task?: string;
  workdir?: string;
  status: string;
  index?: number;
  runId?: string | null;
  jobId?: string | null;
  summary?: string;
};

export type FleetState = {
  planId: string;
  projectId: string;
  mode: string;
  mergePolicy: string;
  format?: string;
  synthesisAgentId?: string;
  reports: FleetReport[];
  artifactId?: string;
  mergeMarkdown?: string;
  awaitingHumanMerge?: boolean;
  synthesisJobId?: string;
  mergedArtifactId?: string;
  enqueuedIndexes?: number[];
  humanMerge?: { accepted: boolean; note?: string; at?: string };
};

export type FleetCreateResult = {
  ok: boolean;
  fleetId: string;
  jobs: Array<{ jobId: string; runId: string; name: string }>;
  state: FleetState;
};

export type FleetListItem = {
  planId: string;
  mode?: string;
  mergePolicy?: string;
  projectId: string;
  format?: string;
  awaitingHumanMerge?: boolean;
  mergedArtifactId?: string;
  artifactId?: string;
  enqueuedIndexes?: number[];
  reports?: FleetReport[];
  updatedAt?: string | null;
};

export type FileVersion = {id:string;path:string;hash:string;createdAt:string};

export type DirectoryMount = {name:string;root:string;readOnly:boolean};

export type ApiClient = {
  listFileVersions: (path:string) => Promise<{versions:FileVersion[]}>;
  getFileVersion: (path:string,versionId:string) => Promise<{content:string;hash:string}>;
  restoreFileVersion: (path:string,versionId:string,expectedHash:string) => Promise<{hash:string}>;
  listDirectoryMounts: () => Promise<{mounts:DirectoryMount[]}>;
  saveDirectoryMount: (input:DirectoryMount) => Promise<DirectoryMount>;
  removeDirectoryMount: (name:string) => Promise<{status:string}>;
  signPipelineQa: (projectId: string, qaRunId: string, expectedVersions: Record<string,number>) => Promise<{ok:boolean}>;
  getContextArtifactText: (artifactId: string) => Promise<{text:string;title:string;version:number;projectId:string}>;
  resolveContextRefs: (refs: ContextRef[]) => Promise<{ refs: ContextRef[]; manifest: Record<string, unknown> }>;
  listProjects: (params?: {
    format?: string;
    status?: string;
    q?: string;
  }) => Promise<Project[]>;
  getProject: (id: string) => Promise<Project>;
  createProject: (input: CreateProjectInput) => Promise<Project>;
  patchProject: (id: string, patch: Partial<Project>) => Promise<Project>;
  deleteProject: (id: string) => Promise<{ status: string }>;
  listArtifacts: (projectId: string, type?: string) => Promise<Artifact[]>;
  updateArtifact: (
    projectId: string,
    artifactId: string,
    patch: {
      title?: string;
      bodyMarkdown?: string;
      expectedVersion?: number;
      bodyJson?: Record<string, unknown> | null;
      status?: string;
    },
  ) => Promise<Artifact>;
  translateArtifact: (
    projectId: string,
    artifactId: string,
    input?: { text?: string; target?: "en"; expectedVersion?: number },
  ) => Promise<Artifact>;
  adoptArtifact: (
    projectId: string,
    artifactId: string,
    mode: "draft" | "strong",
    expectedVersion?: number,
  ) => Promise<Artifact>;
  createArtifact: (
    projectId: string,
    input: {
      type: string;
      title: string;
      bodyMarkdown?: string;
      bodyJson?: Record<string, unknown> | null;
      status?: string;
    },
  ) => Promise<Artifact>;
  deleteArtifact: (projectId: string, artifactId: string) => Promise<{ status: string }>;
  documentOptions: () => Promise<Array<{id:string;title:string}>>;
  listDocs: () => Promise<KnowledgeDoc[]>;
  getDoc: (id: string) => Promise<KnowledgeDoc>;
  getDocText: (id: string) => Promise<{ doc_id: string; title: string; text: string }>;
  listFolders: () => Promise<Array<{ id: string; name: string; createdAt: string }>>;
  createFolder: (name: string) => Promise<{ id: string; name: string; createdAt: string }>;
  moveDoc: (
    docId: string,
    folderId: string | null,
  ) => Promise<{ ok: boolean; doc_id: string; folder_id: string | null }>;
  createKbDoc: (input: CreateKbDocInput) => Promise<KnowledgeDoc>;
  uploadKbDoc: (file: File, input?: Partial<CreateKbDocInput>) => Promise<KnowledgeDoc>;
  deleteKbDoc: (id: string) => Promise<{ status: string }>;
  analyzeKbDoc: (id: string, analysisScope?: "sample" | "full") => Promise<{ jobId: string; status: string; analysisScope?:string; sourceChars?:number; estimatedChunks?:number; estimatedCalls?:number }>;
  listReports: (docId: string) => Promise<AnalysisReport[]>;
  getGraph: (docId: string) => Promise<GraphSnapshot>;
  listTropes: () => Promise<TropeClip[]>;
  toggleTropeFavorite: (id: string, favorited: boolean) => Promise<TropeClip>;
  tropeStats: () => Promise<TropeStats>;
  searchTropes: (q: string) => Promise<TropeSearchResult>;
  similarDocs: (docId: string) => Promise<{
    doc_id: string;
    title: string;
    hint?: string;
    items: Array<{
      doc_id: string;
      title: string;
      score: number;
      shared_tags: string[];
      same_genre: boolean;
      same_hook: boolean;
      reasons?: string[];
    }>;
  }>;
  listHotspots: () => Promise<Hotspot[]>;
  bindHotspot: (
    hotspotId: string,
    projectId: string,
  ) => Promise<{ ok: boolean; hotspot_id: string; project_id: string }>;
  createHotspot: (input: {
    title: string;
    genre?: string;
    source?: string;
    summary?: string;
  }) => Promise<Hotspot>;
  updateHotspot: (
    id: string,
    input: { title: string; genre?: string; source?: string; summary?: string },
  ) => Promise<Hotspot>;
  deleteHotspot: (id: string) => Promise<{ status: string }>;
  searchKb: (q: string, opts?: { includeWeb?: boolean }) => Promise<KbSearchResult>;
  webSearch: (q: string) => Promise<KbSearchResult>;
  pushToProject: (
    docId: string,
    projectId: string,
    mode: string,
  ) => Promise<{ ok: boolean; projectId: string; stage: string }>;
  listInspirations: () => Promise<Inspiration[]>;
  createInspiration: (input: CreateInspirationInput) => Promise<Inspiration>;
  expandInspiration: (id: string) => Promise<Inspiration>;
  listCrawlerSources: () => Promise<CrawlerSource[]>;
  createCrawlerSource: (input: {
    id: string;
    name: string;
    scope?: string;
    interval?: string;
    enabled?: boolean;
    robotsAck?: boolean;
  }) => Promise<CrawlerSource>;
  patchCrawlerSource: (
    id: string,
    patch: Partial<Pick<CrawlerSource, "enabled" | "robotsAck" | "interval">> & {
      cookie?: string;
    },
  ) => Promise<CrawlerSource>;
  deleteCrawlerSource: (id: string) => Promise<{ status: string }>;
  runCrawlerSource: (id: string, cookie?: string) => Promise<CrawlerSource>;
  listCrawlReports: (sourceId?: string) => Promise<CrawlReport[]>;
  getCrawlReport: (id: string) => Promise<CrawlReport>;
  listSwapPlans: (projectId?: string) => Promise<SwapPlan[]>;
  createSwapPlan: (input: CreateSwapPlanInput) => Promise<SwapPlan>;
  composeSwap: (
    docId: string,
    input: { comboDocIds: string[]; degree?: "one" | "two"; projectId?: string },
  ) => Promise<ComposeSwapResult>;
  getJob: (jobId: string) => Promise<Job>;
  getJobEvents: (jobId: string, signal?: AbortSignal) => AsyncIterable<JobEvent>;
  cancelJob: (jobId: string) => Promise<Job>;
  getRun: (runId: string) => Promise<AgentRun>;
  getRunDigest: (runId: string) => Promise<RunDigest>;
  getRunReplay: (runId: string) => Promise<RunReplay>;
  getProjectReplay: (projectId: string, limit?: number) => Promise<ProjectReplay>;
  policyResume: (input: PolicyResumeInput) => Promise<PolicyResumeResult>;
  memoryTree: (opts?: { storeId?: string; projectId?: string }) => Promise<MemoryMeta[]>;
  getMemory: (path: string) => Promise<MemoryMeta>;
  putMemory: (
    path: string,
    content: string,
    opts?: { expectedHash?: string | null; checkCas?: boolean; projectId?: string; changeSummary?: string },
  ) => Promise<MemoryMeta>;
  freezeMemory: (path: string) => Promise<MemoryMeta>;
  deleteMemory: (path: string) => Promise<{ status: string }>;
  searchMemory: (q: string, opts?: { storeId?: string; projectId?: string }) => Promise<MemoryMeta[]>;
  memoryVersions: (path: string) => Promise<MemoryVersion[]>;
  snapshotMemory: (path: string, note?: string) => Promise<MemoryVersion>;
  rollbackMemory: (versionId: string) => Promise<MemoryMeta>;
  listMemoryStores: (projectId?: string) => Promise<MemoryStore[]>;
  listDreams: (opts?: { projectId?: string; storeId?: string }) => Promise<DreamJob[]>;
  createDream: (body: {
    projectId?: string;
    storeId?: string;
    title?: string;
    windowHours?: number;
    sessionIds?: string[];
    runIds?: string[];
    instructions?: string;
  }) => Promise<DreamJob>;
  getDream: (id: string) => Promise<DreamJob>;
  patchDreamChange: (
    dreamId: string,
    changeId: string,
    body: { status?: string; editedContent?: string },
  ) => Promise<DreamChange>;
  acceptAllDreamChanges: (dreamId: string) => Promise<DreamJob>;
  mergeDream: (dreamId: string) => Promise<{
    jobId: string;
    status: string;
    merged: number;
    conflicts: number;
    rejected: number;
  }>;
  rejectDream: (dreamId: string) => Promise<DreamJob>;
  listUsage: () => Promise<UsageEvent[]>;
  dashboardSummary: (days?: number) => Promise<DashboardSummary>;
  getUsageSummary: () => Promise<UsageSummary>;
  getAppSettings: () => Promise<AppSettings>;
  patchAppSettings: (body: {
    usageBudgetMonthly?: number | null;
    featureToggles?: Record<string, boolean>;
  }) => Promise<AppSettings>;
  getLlmTraffic: () => Promise<LlmTrafficSettings>;
  patchLlmTraffic: (body: {
    workerConcurrencyCap?: number;
    adaptiveEnabled?: boolean;
    failoverEnabled?: boolean;
    fleetDefaultConcurrency?: number;
    paDeferWhenBusy?: boolean;
  }) => Promise<LlmTrafficSettings>;
  recalcTokenUsage: () => Promise<{ updatedProjects: number; total: number; events: number }>;
  getAnalyticsCharts: (projectId: string) => Promise<AnalyticsCharts>;
  listProposals: () => Promise<TaskProposal[]>;
  approveProposal: (id: string) => Promise<TaskProposal>;
  dismissProposal: (id: string) => Promise<TaskProposal>;
  colleagueScan: () => Promise<{ ok: boolean; proposalsCreated: number }>;
  getAnalytics: (projectId: string) => Promise<{
    id: string;
    projectId: string;
    views: number;
    favorites: number;
    retention: Record<string, unknown>;
    meta: Record<string, unknown>;
  }>;
  putAnalytics: (
    projectId: string,
    body: {
      views: number;
      favorites: number;
      retention?: Record<string, unknown>;
      meta?: Record<string, unknown>;
    },
  ) => Promise<unknown>;
  reindexKnowledge: () => Promise<{ ok: boolean; jobId: string }>;
  listProviders: () => Promise<ProviderConfig[]>;
  saveProvider: (input: SaveProviderInput) => Promise<ProviderConfig>;
  deleteProvider: (id: string) => Promise<{ status: string }>;
  setDefaultProvider: (id: string) => Promise<ProviderConfig>;
  testProvider: (input: TestProviderInput) => Promise<TestProviderResult>;
  listScheduled: () => Promise<ScheduledTask[]>;
  patchScheduled: (id: string, enabled: boolean) => Promise<ScheduledTask>;
  deleteScheduled: (id: string) => Promise<{ status: string }>;
  patchScheduledPrompt: (
    id: string,
    patch: { enabled?: boolean; prompt?: string },
  ) => Promise<ScheduledTask>;
  listPrompts: () => Promise<PromptTemplate[]>;
  validatePrompt: (input: {
    lockedSystem: string;
    lockedHash: string;
    editableInstruction: string;
    requiredPhrases: string[];
  }) => Promise<GateCheck[]>;
  createRun: (
    projectId: string,
    agentId: string,
    options?: CreateRunOptions,
  ) => Promise<AgentRunWithJob>;
  createRunAndStream: (
    projectId: string,
    agentId: string,
    options?: CreateRunOptions,
  ) => AsyncIterable<JobEvent & { run?: AgentRunWithJob }>;
  startAutopilot: (
    projectId: string,
    body: AutopilotStartBody,
  ) => Promise<{ taskGroupId: string; runIds: string[] }>;
  createFleet: (input: FleetCreateInput) => Promise<FleetCreateResult>;
  getFleet: (fleetId: string) => Promise<FleetState>;
  listFleets: (projectId: string) => Promise<{ fleets: FleetListItem[]; count: number }>;
  confirmFleetMerge: (
    fleetId: string,
    body?: { note?: string; accept?: boolean },
  ) => Promise<FleetState>;
  listAgentCatalog: (format?: string, projectId?:string) => Promise<{
    agents: AgentCatalogItem[];
    hint: string;
    count?: number;
  }>;
  getAgentsOverview: (projectId?:string) => Promise<AgentsOverview>;
  listTaskGroups: (conversationId?: string) => Promise<{
    groups: TaskGroup[];
    summary: TasksSummary & { groups?: number };
  }>;
  getTaskGroup: (groupId: string) => Promise<TaskGroupDetail>;
  getTasksSummary: () => Promise<TasksSummary>;
  patchTaskGroup: (
    groupId: string,
    body: { approvalMode?: string; status?: string; maxConcurrency?: number },
  ) => Promise<TaskGroup>;
  cancelTaskGroup: (groupId: string) => Promise<TaskGroup>;
  approveTaskRun: (runId: string, body: { approve: boolean; note?: string }) => Promise<{ ok: boolean }>;
  updateTaskRun: (
    runId: string,
    body: { message: string; updateStrategy?: "enqueue" | "interrupt" },
  ) => Promise<{ ok: boolean }>;
  cancelTaskRun: (runId: string) => Promise<{ ok: boolean }>;
  pauseTaskRun: (runId: string) => Promise<{ ok: boolean }>;
  resumeTaskRun: (runId: string) => Promise<{ ok: boolean }>;
  listInstances: (opts?: { includeFinished?: boolean }) => Promise<{ instances: AgentInstance[]; count: number }>;
  getInstanceMetrics: () => Promise<InstanceMetrics>;
  listAuditActions: (opts?: { onBehalfOnly?: boolean; limit?: number }) => Promise<{ actions: AuditAction[]; count: number }>;
  // Agent Eval
  evalSeed: () => Promise<Record<string, number>>;
  evalOverview: () => Promise<EvalOverview>;
  evalConfig: () => Promise<EvalConfig>;
  putEvalConfig: (body: Partial<EvalConfig>) => Promise<EvalConfig>;
  listEvalRubrics: (opts?: { format?: string; artifactType?: string; grader?: string }) => Promise<{ rubrics: EvalRubric[]; count: number }>;
  patchEvalRubric: (key: string, body: Partial<EvalRubric>) => Promise<EvalRubric>;
  evalRubricStats: (key: string) => Promise<EvalRubricStats>;
  listEvalSuites: (opts?: { format?: string; tier?: string }) => Promise<{ suites: EvalSuite[]; count: number }>;
  createEvalSuite: (body: Record<string, unknown>) => Promise<EvalSuite>;
  listEvalCases: (suiteId: string) => Promise<{ cases: EvalCase[]; count: number }>;
  // 人工偏好
  postArtifactFeedback: (body: {
    artifactId: string;
    spanText: string;
    polarity: "good" | "bad";
    reasonTags?: string[];
    note?: string;
    projectId?: string;
    format?: string;
    artifactType?: string;
    artifactVersion?: number;
  }) => Promise<{ id: string; polarity: string; reasonTags: string[] }>;
  listFeedbackTags: () => Promise<{ tags: { code: string; label: string }[] }>;
  getExemplars: (params: {
    format?: string;
    artifactType?: string;
    tags?: string[];
    maxChars?: number;
  }) => Promise<{ enabled: boolean; text: string; chars: number; good: unknown[]; bad: unknown[] }>;
  postBestOfNRank: (body: {
    candidates: { id: string; text: string }[];
    format?: string;
    includeLlm?: boolean;
  }) => Promise<{
    best: string | null;
    ranked: { id: string; rank: number; passed: boolean; score: number; assessment: string; advisoryJudgments: EvalJudgment[]; failedRubrics: string[]; chars: number }[];
  }>;
  postBestOfNPick: (body: {
    candidates: { id: string; text: string }[];
    pickedId: string;
    prompt?: string;
    format?: string;
    projectId?: string;
    artifactId?: string;
    step?: string;
  }) => Promise<{ created: string[]; count: number; contextKey: string }>;
  postPreference: (body: {
    chosenText: string;
    rejectedText: string;
    source: "ab_pick" | "bestofn_pick" | "manual";
    prompt?: string;
    contextKey?: string;
    reasonTags?: string[];
    format?: string;
    projectId?: string;
    artifactId?: string;
    chosenArtifactId?: string;
    rejectedArtifactId?: string;
    step?: string;
    meta?: Record<string, unknown>;
  }) => Promise<{ id: string; contextKey: string }>;
  createEvalCase: (suiteId: string, body: Record<string, unknown>) => Promise<EvalCase>;
  evalCaseFromArtifact: (body: { artifactId: string; suiteId: string; label?: string; title?: string }) => Promise<EvalCase>;
  createEvalRun: (body: {
    suiteId: string;
    variant?: Record<string, unknown>;
    trialsK?: number;
    baselineRunId?: string;
    includeLlm?: boolean;
    async?: boolean;
  }) => Promise<EvalRun>;
  listEvalRuns: (opts?: { suiteId?: string; limit?: number }) => Promise<{ runs: EvalRun[]; count: number }>;
  getEvalRun: (runId: string) => Promise<EvalRun & { matrix?: EvalMatrix }>;
  compareEvalRuns: (runId: string, baselineId: string) => Promise<{ candidate: EvalRun; baseline: EvalRun; compare: Record<string, unknown> }>;
  getEvalTrial: (trialId: string) => Promise<EvalTrialDetail>;
  overrideEvalJudgment: (trialId: string, body: { rubricKey: string; verdict: string; reasoning?: string }) => Promise<EvalJudgment>;
  scoreArtifact: (body: {
    artifactId?: string;
    text?: string;
    format?: string;
    artifactType?: string;
    rubricKeys?: string[];
    includeLlm?: boolean;
    reference?: string;
  }) => Promise<EvalScoreResult>;
  listEvalCasePool: (opts?: { status?: string; signal?: string; limit?: number }) => Promise<{ candidates: EvalCaseCandidate[]; count: number }>;
  triageEvalCandidate: (id: string, body: { status: string; attribution?: string; suiteId?: string }) => Promise<EvalCaseCandidate>;
  attributeEvalCandidate: (id: string) => Promise<EvalCaseCandidate>;
  flagEvalArtifact: (body: { artifactId: string; projectId?: string; good: boolean }) => Promise<EvalCaseCandidate>;
  evalAnnotateQueue: (limit?: number) => Promise<{ queue: EvalAnnotateItem[]; count: number }>;
  evalAnnotate: (body: Record<string, unknown>) => Promise<EvalJudgment>;
  evalAgreement: () => Promise<EvalAgreement>;
  evalPairwise: (body: { textA: string; textB: string; criteria?: string[] }) => Promise<Record<string, unknown>>;
  evalPromptSuggestions: (agentId?: string) => Promise<{ suggestions: Array<Record<string, unknown>> }>;
  listSkills: () => Promise<{ skills: SkillItem[]; hint: string; count?: number }>;
  getSkill: (skillId: string) => Promise<SkillItem>;
  getStageGraph: (format: string) => Promise<{
    format: string;
    stages: Array<{
      id: string;
      name: string;
      agentIds: string[];
      next: string[];
      requiresUserAck?: boolean;
    }>;
    hint?: string;
  }>;
  stageLock: (body: {
    format: string;
    currentStageId: string;
    completed?: string[];
    action: "inspect" | "ack" | "advance" | "can_jump";
    targetStageId?: string;
    force?: boolean;
    reason?: string;
  }) => Promise<{
    ok: boolean;
    locked?: boolean;
    requiresUserAck?: boolean;
    reason?: string;
    nextStageIds?: string[];
    state?: { format: string; currentStageId: string; completed: string[] };
    message?: string;
    migrationHint?: string;
  }>;
  searchKnowledge: (
    q: string,
    opts?: { category?: string; limit?: number; format?: string },
  ) => Promise<{ query: string; hits: Array<Record<string, unknown>>; count: number }>;
  assistantChat: (input: {
    message: string;
    projectId?: string;
    format?: string;
    path?: string;
  }) => Promise<AssistantChatResult>;
  assistantContext: () => Promise<{
    projects: Array<{ id: string; title: string; format: string; stage: string }>;
    scheduledTasks: Array<Record<string, unknown>>;
    crawlerSources: Array<Record<string, unknown>>;
    recentActivity: ActivityItem[];
  }>;
  listActivity: (projectId?: string, limit?: number) => Promise<ActivityItem[]>;
  listArtifactVersions: (projectId: string, artifactId: string) => Promise<ArtifactVersionItem[]>;
  rollbackArtifact: (
    projectId: string,
    artifactId: string,
    versionId: string,
    expectedVersion: number,
  ) => Promise<{ ok: boolean; version: number; artifactId: string }>;
  assistantLlmChat: (input: {
    message: string;
    projectId?: string;
    format?: string;
    path?: string;
  }) => Promise<AssistantChatResult>;
  cowrite: (input: {
    text: string;
    mode: "continue" | "polish" | "deai" | "expand";
    instruction?: string;
    projectId?: string;
  }) => Promise<CowriteResult>;
  listJobs: (projectId?: string) => Promise<Job[]>;
  getRetryContext: (jobId: string) => Promise<RetryContext>;
  retryJob: (jobId: string, editorialRevision?: EditorialRevision) => Promise<Job>;
  createScheduled: (input: {
    botId?:string; prompt?:string;
    id?: string;
    name: string;
    cronOrInterval: string;
    enabled?: boolean;
    ownerScope?: string;
    description?: string;
    payloadTemplate?: Record<string, unknown>;
  }) => Promise<ScheduledTask>;
  listProjectSnapshots: (projectId: string) => Promise<ProjectSnapshotItem[]>;
  createProjectSnapshot: (
    projectId: string,
    input: { name: string; note?: string },
  ) => Promise<ProjectSnapshotItem>;
  restoreProjectSnapshot: (projectId: string, snapshotId: string) => Promise<Project>;
  duplicateProject: (projectId: string, includeFullText?: boolean) => Promise<Project>;
  patchReport: (
    docId: string,
    reportId: string,
    patch: { favorited?: boolean; sourceFragments?: Array<Record<string, unknown>> },
  ) => Promise<AnalysisReport>;
  listKbBindings: (docId: string) => Promise<KbBindingItem[]>;
  revokeKbBinding: (docId: string, bindingId: string) => Promise<{ status: string }>;
  listConversations: (opts?: { source?: string; projectId?: string }) => Promise<Conversation[]>;
  createConversation: (input: {
    source?: string;
    projectId?: string;
    title?: string;
    kind?: "dm" | "group" | "routine" | "bot_dm";
    botId?: string | null;
    teamId?: string | null;
    memberBotIds?: string[];
    groupRules?: Record<string, unknown>;
  }) => Promise<Conversation>;
  getConversation: (id: string) => Promise<Conversation>;
  getFeishuDelivery: (conversationId: string, messageId: string) => Promise<{parts: FeishuReplyPart[]}>;
  retryFeishuReply: (conversationId: string, messageId: string) => Promise<{ok: boolean}>;
  listMessages: (conversationId: string) => Promise<ConversationMessage[]>;
  getTimeline: (conversationId: string) => Promise<{
    conversationId: string;
    projectId?: string | null;
    events: Array<Record<string, unknown>>;
  }>;
  listConversationSteps: (
    conversationId: string,
    opts?: { afterSeq?: number; afterId?: string; limit?: number; runId?: string; actor?: string },
  ) => Promise<{
    conversationId: string;
    steps: RunStepItem[];
  }>;
  getConversationRuntime: (conversationId: string) => Promise<ConversationRuntime>;
  getBackendOverview: () => Promise<BackendOverview>;
  getConversationInbox: (
    conversationId: string,
    opts?: { status?: string; limit?: number },
  ) => Promise<{ conversationId: string; events: InboxEventItem[] }>;
  listSubscriptions: (conversationId: string) => Promise<{
    conversationId: string;
    subscriptions: ThreadSubItem[];
  }>;
  updateSubscription: (
    conversationId: string,
    subId: string,
    body: { mode?: string; release?: boolean },
  ) => Promise<ThreadSubItem>;
  steerRun: (runId: string, message: string) => Promise<{ ok: boolean; eventId?: string }>;
  fsRead: (path:string) => Promise<{raw:string;hash?:string;readOnly?:boolean}>;
  fsLs: (path?: string) => Promise<{ path: string; entries: Array<Record<string, unknown>> }>;
  respondConversation: (
    conversationId: string,
    input: { approve: boolean; messageId?: string; editedArgs?: Record<string, unknown> },
  ) => Promise<Record<string, unknown>>;
  listBots: (opts?: { includeArchived?: boolean }) => Promise<Bot[]>;
  createBot: (input: BotCreateInput) => Promise<Bot>;
  getBot: (botId: string) => Promise<Bot>;
  patchBot: (botId: string, patch: BotPatchInput) => Promise<Bot>;
  deleteBot: (botId: string) => Promise<{ ok: boolean; status?: string }>;
  pinBot: (botId: string, pinned?: boolean) => Promise<Bot>;
  listBotMemories: (botId: string, projectId?:string) => Promise<{ botId: string; files: BotMemoryFile[] }>;
  listBotSkills: (botId: string) => Promise<BotSkill[]>;
  createBotSkill: (botId: string, input: BotSkillCreateInput) => Promise<BotSkill>;
  listBotRoutines: (botId: string) => Promise<BotRoutine[]>;
  getBotUsage: (botId: string, days?: number) => Promise<BotUsageSummary>;
  interviewBot: (
    botId: string,
    input: { answers?: Record<string, unknown>; freeText?: string | null },
  ) => Promise<{ draft?: Record<string, unknown>; bot?: Bot; questions?: InterviewQuestion[] }>;
  exportBot: (botId: string) => Promise<Record<string, unknown>>;
  listBotTemplates: () => Promise<BotTemplate[]>;
  importBotTemplate: (input: BotImportInput) => Promise<BotImportResult>;
  listInterviewQuestions: () => Promise<{ questions: InterviewQuestion[] }>;
  listBotTeams: () => Promise<BotTeam[]>;
  createBotTeam: (input: BotTeamCreateInput) => Promise<BotTeam>;
  getBotTeam: (teamId: string) => Promise<BotTeam>;
  patchBotTeam: (teamId: string, patch: BotTeamPatchInput) => Promise<BotTeam>;
  deleteBotTeam: (teamId: string) => Promise<{ ok: boolean }>;
  getBotRoster: (opts?: { projectId?:string; format?: string; team?: string }) => Promise<BotRoster>;
  listSquads: () => Promise<{ squads: SquadPreset[] }>;
  botCoverage: (input: {
    memberBotIds: string[];
    format?: string | null;
  }) => Promise<CoverageReport>;
  ontologySubmit: (input: {
    actionApiName: string;
    projectId: string;
    parameters?: Record<string, unknown>;
    expectedHash?: string;
    actor?: string;
  }) => Promise<{
    ok: boolean;
    runId: string;
    actionApiName: string;
    criteria: unknown[];
    error?: string;
  }>;
  ontologyQuery: (input: {
    function: string;
    projectId: string;
    parameters?: Record<string, unknown>;
  }) => Promise<{ function: string; result: unknown }>;
  ontologyObjects: (projectId: string, typeApiName?: string) => Promise<
    {
      rid: string;
      typeApiName: string;
      status: string;
      properties: Record<string, unknown>;
      contentHash: string;
      version: number;
    }[]
  >;
  ontologyRegistry: () => Promise<Record<string, unknown>>;
  ontologyActionRuns: (projectId: string) => Promise<
    {
      id: string;
      actionApiName: string;
      ok: boolean;
      actor: string;
      startedAt?: string;
      error?: string;
    }[]
  >;
  ontologyScenarios: (projectId: string) => Promise<
    { rid: string; label: string; status: string; baseRids: string[] }[]
  >;
  reset: () => void;
};

export type ToolCatalogItem = {
  id: string;
  label: string;
  category: string;
  description: string;
  security?: string;
  parameters?: Record<string, unknown>;
  required?: string[];
};

export type AgentCatalogItem = {
  custom?: boolean; projectId?: string; projectTitle?: string; documentCount?: number;
  id: string;
  name: string;
  summary: string;
  skillPath: string;
  when: string;
  persona?: string;
  team?: string;
  formats?: string[];
  stage?: string | null;
  tools?: string[];
  toolDetails?: ToolCatalogItem[];
  toolCount?: number;
  modelProfile?: string;
  doneContract?: Array<Record<string, unknown>>;
};

export type AgentsOverview = {
  personalAgent: {
    id: string;
    name: string;
    persona: string;
    role: string;
    summary: string;
    capabilities: Array<{ id: string; title: string; desc: string }>;
    asyncPrimitives: string[];
    tools: ToolCatalogItem[];
    vfsPaths: string[];
  };
  stats: {
    personalAgents: number;
    domainAgents: number;
    skills: number;
    tools: number;
    workflows: number;
    byTeam: Record<string, number>;
    byFormat: Record<string, number>;
    byModelProfile: Record<string, number>;
  };
  agents: AgentCatalogItem[];
  toolsCatalog: ToolCatalogItem[];
  workflows: Record<
    string,
    {
      format: string;
      stageCount: number;
      ackCount: number;
      stages: Array<{
        id: string;
        name: string;
        agentIds?: string[];
        next?: string[];
        requiresUserAck?: boolean;
        mode?: string;
      }>;
    }
  >;
  skillCount: number;
  hint?: string;
};

export type EditorialRevision = {
  revisionId: string;
  expectedLeaseVersion: number;
  sourceCallId: string;
  sourceTextHash: string;
  selectedQuote: string;
  operation: "shorten" | "rewrite";
  instructions: string;
};

export type RetryContext = { eligible: false; requiresRevision: boolean; reason?: string } | {
  eligible: true; requiresRevision: true; runId: string; jobId: string;
  sourceText: string; count: number; outline: {id: string; version: number};
  expectedLeaseVersion: number; sourceCallId: string; sourceTextHash: string;
};

export type TaskGroupRun = {
  runId: string;
  agentId: string;
  projectId?: string;
  status: string;
  label: string;
  progressPct: number;
  progressStage?: string | null;
  approvalState: string;
  checkpoint?: boolean;
  dependsOn?: string[];
  outputArtifactIds?: string[];
  jobId?: string | null;
  createdAt?: string;
  finishedAt?: string | null;
  /** Agent Instance 生命周期（created/queued/running/paused/completed/failed/cancelled/dead…） */
  lifecycleState?: string;
  attempt?: number;
  leaseExpiresInS?: number | null;
};

export type AgentInstance = {
  runId: string;
  agentId: string;
  label: string;
  projectId?: string | null;
  taskGroupId?: string | null;
  state: string;
  status: string;
  progressPct: number;
  progressStage?: string | null;
  attempt: number;
  maxAttempts: number;
  attention?: "lease_expired" | "lease_expiring" | "retrying" | "dead" | null;
  lease: { owner?: string | null; version: number; expiresInS?: number | null; heartbeatAt?: string | null };
  checkpoint: { turn?: number; stage?: string; artifactCount?: number; compactions?: number; handoffs?: number };
};

export type AuditAction = {
  id: string;
  actor: string;
  action: string;
  summary: string;
  target?: string | null;
  onBehalfOfUser: boolean;
  botId?: string | null;
  undo?: { action: "agent_pause" | "agent_resume"; runId: string } | null;
  projectId?: string | null;
  conversationId?: string | null;
  createdAt: string;
};

export type InstanceMetrics = {
  total: number;
  byState: Record<string, number>;
  retried: number;
  dead: number;
  leaseExpiring: number;
  tokenPrompt: number;
  tokenCompletion: number;
};

export type TaskGroup = {
  id: string;
  title: string;
  goal: string;
  kind: string;
  approvalMode: string;
  maxConcurrency: number;
  status: string;
  conversationId?: string | null;
  progress: { pct: number; total: number; done: number; running: number; waiting: number };
  createdAt?: string;
  finishedAt?: string | null;
  updatedAt?: string;
  runs: TaskGroupRun[];
};

/** 单个任务组详情（GET /tasks/groups/{id}），与 listTaskGroups 的元素结构一致。 */
export type TaskGroupDetail = TaskGroup;

export type TasksSummary = {
  running: number;
  queued: number;
  waitingApproval: number;
  slots: number;
  activeGroups: number;
};

export type SkillItem = {
  id: string;
  name: string;
  description: string;
  gates: string[];
  locks: string[];
  path: string;
  body: string;
  folder: string;
};

const httpApi: ApiClient = {
  listFileVersions: (path) => http(`/fs/versions?path=${encodeURIComponent(path)}`),
  getFileVersion: (path,id) => http(`/fs/versions/${encodeURIComponent(id)}?path=${encodeURIComponent(path)}`),
  restoreFileVersion: (path,versionId,expectedHash) => http("/fs/restore",{method:"POST",body:JSON.stringify({path,versionId,expectedHash})}),
  listDirectoryMounts: () => http("/fs/mounts"),
  saveDirectoryMount: (input) => http("/fs/mounts",{method:"POST",body:JSON.stringify(input)}),
  removeDirectoryMount: (name) => http(`/fs/mounts/${encodeURIComponent(name)}`,{method:"DELETE"}),
  signPipelineQa: (projectId,qaRunId,expectedVersions) => http(`/projects/${encodeURIComponent(projectId)}/logic-ack`, {
    method:"POST",body:JSON.stringify({qaRunId,expectedVersions}),
  }),
  getContextArtifactText: (artifactId) => http(`/context/artifacts/${encodeURIComponent(artifactId)}/text`),
  resolveContextRefs: (refs) => http("/context/resolve", { method: "POST", body: JSON.stringify({refs}) }),
  listProjects: (params) => {
    const qs = new URLSearchParams();
    if (params?.format) qs.set("format", params.format);
    if (params?.status) qs.set("status", params.status);
    if (params?.q) qs.set("q", params.q);
    const s = qs.toString();
    return http<Project[]>(`/projects${s ? `?${s}` : ""}`);
  },
  getProject: (id) => http<Project>(`/projects/${id}`),
  createProject: (input) =>
    http<Project>("/projects", { method: "POST", body: JSON.stringify(input) }),
  patchProject: (id, patch) =>
    http<Project>(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteProject: (id) => http<{ status: string }>(`/projects/${id}`, { method: "DELETE" }),
  listArtifacts: (projectId, type) =>
    http<Artifact[]>(
      `/projects/${projectId}/artifacts${type ? `?type=${encodeURIComponent(type)}` : ""}`,
    ),
  updateArtifact: (projectId, artifactId, patch) =>
    http<Artifact>(`/projects/${projectId}/artifacts/${artifactId}`, {
      method: "PATCH",
      body: JSON.stringify({ ...patch, viaOntologyAction: true }),
    }),
  translateArtifact: (projectId, artifactId, input) =>
    http<Artifact>(`/projects/${projectId}/artifacts/${artifactId}/translate`, {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    }),
  adoptArtifact: (projectId, artifactId, adoptMode, expectedVersion) =>
    http<Artifact>(`/projects/${projectId}/artifacts/${artifactId}/adopt`, {
      method: "POST",
      body: JSON.stringify({ mode: adoptMode, expectedVersion }),
    }),
  createArtifact: (projectId, input) =>
    http<Artifact>(`/projects/${projectId}/artifacts`, {
      method: "POST",
      // Writing Ontology：已映射类型须经 Action 物化通道
      body: JSON.stringify({ ...input, viaOntologyAction: true }),
    }),
  ontologySubmit: (input: {
    actionApiName: string;
    projectId: string;
    parameters?: Record<string, unknown>;
    expectedHash?: string;
    actor?: string;
  }) =>
    http<{
      ok: boolean;
      runId: string;
      actionApiName: string;
      criteria: unknown[];
      error?: string;
    }>("/ontology/actions/submit", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  ontologyQuery: (input: {
    function: string;
    projectId: string;
    parameters?: Record<string, unknown>;
  }) =>
    http<{ function: string; result: unknown }>("/ontology/query", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  ontologyObjects: (projectId: string, typeApiName?: string) =>
    http<
      {
        rid: string;
        typeApiName: string;
        status: string;
        properties: Record<string, unknown>;
        contentHash: string;
        version: number;
      }[]
    >(
      `/ontology/projects/${projectId}/objects${typeApiName ? `?typeApiName=${encodeURIComponent(typeApiName)}` : ""}`,
    ),
  ontologyRegistry: () => http<Record<string, unknown>>("/ontology/registry"),
  ontologyActionRuns: (projectId: string) =>
    http<
      {
        id: string;
        actionApiName: string;
        ok: boolean;
        actor: string;
        startedAt?: string;
        error?: string;
      }[]
    >(`/ontology/projects/${projectId}/actions`),
  ontologyScenarios: (projectId: string) =>
    http<{ rid: string; label: string; status: string; baseRids: string[] }[]>(
      `/ontology/projects/${projectId}/scenarios`,
    ),
  deleteArtifact: (projectId, artifactId) =>
    http(`/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}`, {
      method: "DELETE",
    }),
  documentOptions: () => http("/kb/document-options"),
  listDocs: () => http<KnowledgeDoc[]>("/kb/docs"),
  getDoc: (id) => http<KnowledgeDoc>(`/kb/docs/${id}`),
  getDocText: (id) => http(`/kb/docs/${encodeURIComponent(id)}/text`),
  listFolders: () => http("/kb/folders"),
  createFolder: (name) =>
    http("/kb/folders", { method: "POST", body: JSON.stringify({ name }) }),
  moveDoc: (docId, folderId) =>
    http(`/kb/docs/${encodeURIComponent(docId)}/move`, {
      method: "POST",
      body: JSON.stringify({ folder_id: folderId }),
    }),
  createKbDoc: (input) => {
    const qs = new URLSearchParams({
      title: input.title,
      doc_type: input.docType ?? "notes",
    });
    if (input.tags?.length) qs.set("tags", input.tags.join(","));
    return http<KnowledgeDoc>(`/kb/docs?${qs}`, { method: "POST" });
  },
  async uploadKbDoc(file, input) {
    const title = input?.title || file.name.replace(/\.[^.]+$/, "") || file.name;
    const docType = input?.docType ?? "notes";
    const tags = input?.tags?.length ? input.tags.join(",") : "";
    // Query matches current FastAPI create_doc; file body is forward-compat for ingest.
    const qs = new URLSearchParams({ title, doc_type: docType });
    if (tags) qs.set("tags", tags);
    const form = new FormData();
    form.append("file", file);
    form.append("title", title);
    form.append("doc_type", docType);
    try {
      return await http<KnowledgeDoc>(`/kb/docs?${qs}`, { method: "POST", body: form });
    } catch (e) {
      // 禁止静默 createKbDoc（会丢掉文件正文）；上传失败必须上抛
      throw e instanceof Error ? e : new Error(String(e));
    }
  },
  deleteKbDoc: (id) => http<{ status: string }>(`/kb/docs/${id}`, { method: "DELETE" }),
  analyzeKbDoc: (id, analysisScope = "sample") =>
    http(`/kb/docs/${id}/analyze`, { method: "POST", body:JSON.stringify({analysisScope}) }),
  listReports: (docId) => http<AnalysisReport[]>(`/kb/docs/${docId}/reports`),
  getGraph: (docId) => http<GraphSnapshot>(`/kb/graph/${docId}`),
  listTropes: () => http<TropeClip[]>("/kb/tropes"),
  toggleTropeFavorite: (id, favorited) =>
    http<TropeClip>(
      `/kb/tropes/${encodeURIComponent(id)}/favorite?favorited=${favorited}`,
      { method: "PATCH" },
    ),
  tropeStats: () => http<TropeStats>("/kb/tropes/stats"),
  searchTropes: (q) => {
    const sp = new URLSearchParams({ q });
    return http<TropeSearchResult>(`/kb/search/tropes?${sp.toString()}`);
  },
  similarDocs: (docId) => http(`/kb/similar/${encodeURIComponent(docId)}`),
  async listHotspots() {
    const rows = await http<Array<Record<string, unknown>>>("/kb/hotspots");
    return rows.map((r) => ({
      id: String(r.id ?? ""),
      title: String(r.title ?? ""),
      genre: String(r.genre ?? ""),
      source: String(r.source ?? ""),
      summary: String(r.summary ?? ""),
      fetchedAt: String(r.fetched_at ?? r.fetchedAt ?? ""),
      status: (r.status as "ok" | "failed") ?? "ok",
      meta: (r.meta as Record<string, unknown>) ?? {},
      projectId: (r.project_id as string | null | undefined) ?? null,
    })) as Hotspot[];
  },
  bindHotspot: (hotspotId, projectId) =>
    http(`/kb/hotspots/${encodeURIComponent(hotspotId)}/bind`, {
      method: "POST",
      body: JSON.stringify({ project_id: projectId }),
    }),
  createHotspot: (input) =>
    http<Hotspot>("/kb/hotspots", { method: "POST", body: JSON.stringify(input) }),
  updateHotspot: (id, input) =>
    http<Hotspot>(`/kb/hotspots/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteHotspot: (id) =>
    http<{ status: string }>(`/kb/hotspots/${encodeURIComponent(id)}`, { method: "DELETE" }),
  async searchKb(q, opts) {
    const sp = new URLSearchParams({ q });
    if (opts?.includeWeb) sp.set("includeWeb", "true");
    const raw = await http<Record<string, unknown>>(`/kb/search?${sp.toString()}`);
    return normalizeSearch(raw);
  },
  async webSearch(q) {
    return this.searchKb(q, { includeWeb: true });
  },
  pushToProject: (docId, projectId, pushMode) =>
    http(`/kb/docs/${docId}/push-to-project`, {
      method: "POST",
      body: JSON.stringify({ projectId, mode: pushMode }),
    }),
  listInspirations: () => http<Inspiration[]>("/inspirations"),
  createInspiration: (input) =>
    http<Inspiration>("/inspirations", { method: "POST", body: JSON.stringify(input) }),
  expandInspiration: (id) =>
    http<Inspiration>(`/inspirations/${id}/expand`, { method: "POST" }),
  listCrawlerSources: () => http<CrawlerSource[]>("/crawler-sources"),
  createCrawlerSource: (input) =>
    http<CrawlerSource>("/crawler-sources", { method: "POST", body: JSON.stringify(input) }),
  patchCrawlerSource: (id, patch) =>
    http<CrawlerSource>(`/crawler-sources/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteCrawlerSource: (id) =>
    http<{ status: string }>(`/crawler-sources/${id}`, { method: "DELETE" }),
  runCrawlerSource: (id, cookie) =>
    http<CrawlerSource>(`/crawler-sources/${id}/run`, {
      method: "POST",
      body: JSON.stringify(cookie ? { cookie } : {}),
    }),
  listCrawlReports: (sourceId) =>
    http<CrawlReport[]>(
      sourceId
        ? `/crawler-sources/${encodeURIComponent(sourceId)}/reports`
        : "/crawler-sources/reports/all",
    ),
  getCrawlReport: (id) =>
    http<CrawlReport>(`/crawler-sources/reports/${encodeURIComponent(id)}`),
  listSwapPlans: (projectId) =>
    http<SwapPlan[]>(
      `/swap-plans${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`,
    ),
  createSwapPlan: (input) =>
    http<SwapPlan>("/swap-plans", { method: "POST", body: JSON.stringify(input) }),
  composeSwap: (docId, input) =>
    http<ComposeSwapResult>(`/kb/docs/${encodeURIComponent(docId)}/compose`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getJob: (jobId) => http<Job>(`/jobs/${jobId}`),
  getJobEvents: (jobId, signal) => streamJobEvents(jobId, signal),
  cancelJob: (jobId) =>
    http<Job>(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }),
  policyResume: (input) =>
    http<PolicyResumeResult>("/agents/policy/resume", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getRun: (runId) => http<AgentRun>(`/runs/${runId}`),
  getRunDigest: (runId) => http<RunDigest>(`/runs/${encodeURIComponent(runId)}/digest`),
  getRunReplay: (runId) => http<RunReplay>(`/runs/${encodeURIComponent(runId)}/replay`),
  getProjectReplay: (projectId, limit = 200) =>
    http<ProjectReplay>(
      `/projects/${encodeURIComponent(projectId)}/replay?limit=${encodeURIComponent(String(limit))}`,
    ),
  memoryTree: (opts = {}) => {
    const qs = new URLSearchParams();
    if (opts.storeId) qs.set("store_id", opts.storeId);
    if (opts.projectId) qs.set("project_id", opts.projectId);
    const q = qs.toString();
    return http<MemoryMeta[]>(`/memory/tree${q ? `?${q}` : ""}`);
  },
  getMemory: (path) => http<MemoryMeta>(`/memory/file?path=${encodeURIComponent(path)}`),
  putMemory: (path, content, opts = {}) =>
    http<MemoryMeta>("/memory/file", {
      method: "PUT",
      body: JSON.stringify({
        path,
        content,
        projectId: opts.projectId,
        expectedHash: opts.expectedHash,
        checkCas: opts.checkCas,
        changeSummary: opts.changeSummary,
        actor: "user",
      }),
    }),
  freezeMemory: (path) =>
    http<MemoryMeta>(`/memory/freeze?path=${encodeURIComponent(path)}`, { method: "POST" }),
  deleteMemory: (path) =>
    http<{ status: string }>(`/memory/file?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }),
  searchMemory: (q, opts = {}) => {
    const qs = new URLSearchParams({ q });
    if (opts.storeId) qs.set("store_id", opts.storeId);
    if (opts.projectId) qs.set("project_id", opts.projectId);
    return http<MemoryMeta[]>(`/memory/search?${qs}`, { method: "POST" });
  },
  memoryVersions: (path) =>
    http<MemoryVersion[]>(`/memory/versions?path=${encodeURIComponent(path)}`),
  snapshotMemory: (path, note) =>
    http<MemoryVersion>("/memory/versions", {
      method: "POST",
      body: JSON.stringify({ path, note }),
    }),
  rollbackMemory: (versionId) =>
    http<MemoryMeta>("/memory/rollback", {
      method: "POST",
      body: JSON.stringify({ versionId }),
    }),
  listMemoryStores: (projectId) =>
    http<MemoryStore[]>(
      `/memory/stores${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`,
    ),
  listDreams: (opts = {}) => {
    const qs = new URLSearchParams();
    if (opts.projectId) qs.set("project_id", opts.projectId);
    if (opts.storeId) qs.set("store_id", opts.storeId);
    const q = qs.toString();
    return http<DreamJob[]>(`/memory/dreams${q ? `?${q}` : ""}`);
  },
  createDream: (body) =>
    http<DreamJob>("/memory/dreams", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getDream: (id) => http<DreamJob>(`/memory/dreams/${encodeURIComponent(id)}`),
  patchDreamChange: (dreamId, changeId, body) =>
    http<DreamChange>(
      `/memory/dreams/${encodeURIComponent(dreamId)}/changes/${encodeURIComponent(changeId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),
  acceptAllDreamChanges: (dreamId) =>
    http<DreamJob>(`/memory/dreams/${encodeURIComponent(dreamId)}/accept-all`, {
      method: "POST",
    }),
  mergeDream: (dreamId) =>
    http(`/memory/dreams/${encodeURIComponent(dreamId)}/merge`, { method: "POST" }),
  rejectDream: (dreamId) =>
    http<DreamJob>(`/memory/dreams/${encodeURIComponent(dreamId)}/reject`, {
      method: "POST",
    }),
  listUsage: () => http<UsageEvent[]>("/usage"),
  dashboardSummary: (days = 14) =>
    http<DashboardSummary>(`/dashboard/summary?days=${encodeURIComponent(String(days))}`),
  getUsageSummary: () => http<UsageSummary>("/usage/summary"),
  getAppSettings: () => http<AppSettings>("/settings/app"),
  patchAppSettings: (body) =>
    http<AppSettings>("/settings/app", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  getLlmTraffic: () => http<LlmTrafficSettings>("/settings/llm-traffic"),
  patchLlmTraffic: (body) =>
    http<LlmTrafficSettings>("/settings/llm-traffic", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  recalcTokenUsage: () =>
    http<{ updatedProjects: number; total: number; events: number }>(
      "/maintenance/recalc-token-usage",
      {
        method: "POST",
      },
    ),
  getAnalyticsCharts: (projectId) =>
    http<AnalyticsCharts>(`/projects/${encodeURIComponent(projectId)}/analytics-charts`),
  listProposals: () => http<TaskProposal[]>("/task-proposals"),
  approveProposal: (id) =>
    http<TaskProposal>(`/task-proposals/${id}/approve`, { method: "POST" }),
  dismissProposal: (id) =>
    http<TaskProposal>(`/task-proposals/${id}/dismiss`, { method: "POST" }),
  colleagueScan: () =>
    http<{ ok: boolean; proposalsCreated: number }>("/colleague/scan", { method: "POST" }),
  getAnalytics: (projectId) => http(`/analytics/projects/${projectId}`),
  putAnalytics: (projectId, body) =>
    http(`/analytics/projects/${projectId}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  reindexKnowledge: () =>
    http<{ ok: boolean; jobId: string }>("/kb/knowledge/reindex", { method: "POST" }),
  listProviders: () => http<ProviderConfig[]>("/settings/providers"),
  saveProvider: (input) =>
    http<ProviderConfig>("/settings/providers", {
      method: "POST",
      body: JSON.stringify({
        id: input.id,
        name: input.name,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        models: input.models,
        selectedModel: input.selectedModel,
        enabled: input.enabled,
        isDefault: input.isDefault,
        pricing: input.pricing,
      }),
    }),
  deleteProvider: (id) =>
    http<{ status: string }>(`/settings/providers/${id}`, { method: "DELETE" }),
  setDefaultProvider: (id) =>
    http<ProviderConfig>(`/settings/providers/${id}/default`, { method: "PATCH" }),
  testProvider: (input) =>
    http<TestProviderResult>("/settings/providers/test", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listScheduled: () => http<ScheduledTask[]>("/scheduled-tasks"),
  patchScheduled: (id, enabled) =>
    http<ScheduledTask>(`/scheduled-tasks/${id}?enabled=${enabled}`, { method: "PATCH" }),
  deleteScheduled: (id) =>
    http<{ status: string }>(`/scheduled-tasks/${id}`, { method: "DELETE" }),
  patchScheduledPrompt: (id, patch) =>
    http<ScheduledTask>(`/scheduled-tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  listPrompts: () => http<PromptTemplate[]>("/prompts"),
  validatePrompt: (input) =>
    http<GateCheck[]>("/prompts/validate", { method: "POST", body: JSON.stringify(input) }),
  async createRun(projectId, agentId, options) {
    const run = await http<AgentRunWithJob>("/runs", {
      method: "POST",
      body: JSON.stringify({
        projectId,
        agentId,
        inputJson: options?.inputJson ?? {},
        ...(options?.operatorDecision
          ? { operatorDecision: options.operatorDecision }
          : {}),
      }),
    });
    if (run.jobId) return run;
    // 兼容旧 API：未返回 jobId 时再扫一次
    let jobId: string | undefined;
    try {
      jobId = await resolveJobIdForRun(run);
    } catch {
      jobId = undefined;
    }
    return { ...run, jobId: jobId ?? null };
  },
  async *createRunAndStream(projectId, agentId, options) {
    const run = await httpApi.createRun(projectId, agentId, options);
    yield {
      type: "status",
      status: run.status,
      jobId: run.jobId ?? undefined,
      runId: run.id,
      run,
    };
    if (!run.jobId) return;
    for await (const ev of streamJobEvents(run.jobId, options?.signal)) {
      if (options?.signal?.aborted) break;
      yield { ...ev, run };
    }
  },
  startAutopilot: (projectId, body) =>
    http<{ taskGroupId: string; runIds: string[] }>(
      `/autopilot/start?project_id=${encodeURIComponent(projectId)}`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  createFleet: (input) =>
    http<FleetCreateResult>("/agents/fleet", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getFleet: (fleetId) => http<FleetState>(`/agents/fleet/${encodeURIComponent(fleetId)}`),
  listFleets: (projectId) =>
    http<{ fleets: FleetListItem[]; count: number }>(
      `/agents/fleets?projectId=${encodeURIComponent(projectId)}`,
    ),
  confirmFleetMerge: (fleetId, body) =>
    http<FleetState>(`/agents/fleet/${encodeURIComponent(fleetId)}/confirm-merge`, {
      method: "POST",
      body: JSON.stringify(body ?? { accept: true }),
    }),
  listAgentCatalog: (format,projectId) =>
    http(`/agents/catalog?${new URLSearchParams({...format && {format}, ...projectId && {project_id:projectId}})}`),
  getAgentsOverview: (projectId) => http<AgentsOverview>(`/agents/overview?${new URLSearchParams(projectId ? {project_id:projectId} : {})}`),
  listTaskGroups: (conversationId) =>
    http(
      `/tasks/groups${conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ""}`,
    ),
  getTaskGroup: (groupId) =>
    http<TaskGroupDetail>(`/tasks/groups/${encodeURIComponent(groupId)}`),
  getTasksSummary: () => http<TasksSummary>("/tasks/summary"),
  patchTaskGroup: (groupId, body) =>
    http<TaskGroup>(`/tasks/groups/${encodeURIComponent(groupId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  cancelTaskGroup: (groupId) =>
    http<TaskGroup>(`/tasks/groups/${encodeURIComponent(groupId)}/cancel`, { method: "POST" }),
  approveTaskRun: (runId, body) =>
    http(`/tasks/runs/${encodeURIComponent(runId)}/approve`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateTaskRun: (runId, body) =>
    http(`/tasks/runs/${encodeURIComponent(runId)}/update`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cancelTaskRun: (runId) =>
    http(`/tasks/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }),
  pauseTaskRun: (runId) =>
    http(`/tasks/runs/${encodeURIComponent(runId)}/pause`, { method: "POST" }),
  resumeTaskRun: (runId) =>
    http(`/tasks/runs/${encodeURIComponent(runId)}/resume`, { method: "POST" }),
  listInstances: (opts) =>
    http(`/tasks/instances${opts?.includeFinished ? "?includeFinished=true" : ""}`),
  getInstanceMetrics: () => http("/tasks/metrics"),
  listAuditActions: (opts) => {
    const q = new URLSearchParams();
    if (opts?.onBehalfOnly) q.set("onBehalfOnly", "true");
    if (opts?.limit) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return http(`/tasks/audit${qs ? `?${qs}` : ""}`);
  },
  listSkills: () => http("/agents/skills"),
  getSkill: (skillId) => http(`/agents/skills/${encodeURIComponent(skillId)}`),
  getStageGraph: (format) => http(`/agents/stages/${encodeURIComponent(format)}`),
  stageLock: (body) =>
    http("/agents/stage-lock", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  searchKnowledge: (q, opts) => {
    const sp = new URLSearchParams({ q, mode: "hybrid" });
    const category =
      opts?.category ??
      (opts?.format
        ? {
            manju: "02-manju",
            duanju: "03-duanju",
            short_novel: "04-webnovel",
            male_long: "16-male-long",
            female_long: "12-female-long",
            ip_adapt: "11-ip-adapt",
          }[opts.format]
        : undefined);
    if (category) sp.set("category", category);
    if (opts?.format) sp.set("format", opts.format);
    if (opts?.limit) sp.set("limit", String(opts.limit));
    return http(`/kb/knowledge/search?${sp}`);
  },
  assistantChat: (input) =>
    http("/assistant/chat", {
      method: "POST",
      body: JSON.stringify({
        message: input.message,
        projectId: input.projectId,
        format: input.format,
        path: input.path,
      }),
    }),
  assistantContext: () => http("/assistant/context"),
  listActivity: (projectId, limit) => {
    const sp = new URLSearchParams();
    if (projectId) sp.set("projectId", projectId);
    if (limit) sp.set("limit", String(limit));
    return http(`/activity?${sp}`);
  },
  listArtifactVersions: (projectId, artifactId) =>
    http(`/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}/versions`),
  rollbackArtifact: (projectId, artifactId, versionId, expectedVersion) =>
    http(
      `/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}/versions/${encodeURIComponent(versionId)}/rollback`,
      { method: "POST", body: JSON.stringify({ expectedVersion }) },
    ),
  assistantLlmChat: (input) =>
    http("/assistant/llm-chat", {
      method: "POST",
      body: JSON.stringify({
        message: input.message,
        projectId: input.projectId,
        format: input.format,
        path: input.path,
      }),
    }),
  cowrite: (input) =>
    http("/assistant/cowrite", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listJobs: (projectId) =>
    http(`/jobs${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`),
  getRetryContext: (jobId) => http(`/jobs/${encodeURIComponent(jobId)}/retry-context`),
  retryJob: (jobId, editorialRevision) =>
    http(`/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST",
      ...(editorialRevision ? {body: JSON.stringify({ editorialRevision })} : {}) }),
  createScheduled: (input) =>
    http("/scheduled-tasks", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listProjectSnapshots: (projectId) =>
    http(`/projects/${encodeURIComponent(projectId)}/snapshots`),
  createProjectSnapshot: (projectId, input) =>
    http(`/projects/${encodeURIComponent(projectId)}/snapshots`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  restoreProjectSnapshot: (projectId, snapshotId) =>
    http(`/projects/${encodeURIComponent(projectId)}/snapshots/${encodeURIComponent(snapshotId)}/restore`, {
      method: "POST",
    }),
  duplicateProject: (projectId, includeFullText = true) =>
    http(
      `/projects/${encodeURIComponent(projectId)}/duplicate?includeFullText=${includeFullText}`,
      { method: "POST" },
    ),
  patchReport: (docId, reportId, patch) =>
    http(`/kb/docs/${encodeURIComponent(docId)}/reports/${encodeURIComponent(reportId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  listKbBindings: (docId) =>
    http(`/kb/docs/${encodeURIComponent(docId)}/bindings`),
  revokeKbBinding: (docId, bindingId) =>
    http(`/kb/docs/${encodeURIComponent(docId)}/bindings/${encodeURIComponent(bindingId)}`, {
      method: "DELETE",
    }),
  listConversations: (opts) => {
    const sp = new URLSearchParams();
    if (opts?.source) sp.set("source", opts.source);
    if (opts?.projectId) sp.set("projectId", opts.projectId);
    const q = sp.toString();
    return http(`/conversations${q ? `?${q}` : ""}`);
  },
  createConversation: (input) =>
    http("/conversations", {
      method: "POST",
      body: JSON.stringify({
        source: input.source,
        projectId: input.projectId,
        title: input.title,
        kind: input.kind,
        botId: input.botId,
        teamId: input.teamId,
        memberBotIds: input.memberBotIds,
        groupRules: input.groupRules,
      }),
    }),
  getConversation: (id) => http(`/conversations/${encodeURIComponent(id)}`),
  getFeishuDelivery: (cid, mid) => http(`/conversations/${encodeURIComponent(cid)}/messages/${encodeURIComponent(mid)}/feishu-delivery`),
  retryFeishuReply: (cid, mid) => http(`/conversations/${encodeURIComponent(cid)}/messages/${encodeURIComponent(mid)}/feishu-retry`, {method: "POST"}),
  listMessages: (conversationId) =>
    http(`/conversations/${encodeURIComponent(conversationId)}/messages`),
  getTimeline: (conversationId) =>
    http(`/conversations/${encodeURIComponent(conversationId)}/timeline`),
  listConversationSteps: (conversationId, opts) => {
    const qs = new URLSearchParams();
    if (opts?.afterSeq !== undefined) qs.set("after_seq", String(opts.afterSeq));
    if (opts?.afterId !== undefined) qs.set("after_id", opts.afterId);
    if (opts?.limit !== undefined) qs.set("limit", String(opts.limit));
    if (opts?.runId) qs.set("run_id", opts.runId);
    if (opts?.actor) qs.set("actor", opts.actor);
    const q = qs.toString();
    return http<{ conversationId: string; steps: RunStepItem[] }>(
      `/conversations/${encodeURIComponent(conversationId)}/steps${q ? `?${q}` : ""}`,
    );
  },
  getConversationRuntime: (conversationId) =>
    http<ConversationRuntime>(`/conversations/${encodeURIComponent(conversationId)}/runtime`),
  getBackendOverview: () => http<BackendOverview>(`/conversations/_backend/overview`),
  getConversationInbox: (conversationId, opts) => {
    const qs = new URLSearchParams();
    if (opts?.status) qs.set("status", opts.status);
    if (opts?.limit) qs.set("limit", String(opts.limit));
    const q = qs.toString();
    return http<{ conversationId: string; events: InboxEventItem[] }>(
      `/conversations/${encodeURIComponent(conversationId)}/inbox${q ? `?${q}` : ""}`,
    );
  },
  listSubscriptions: (conversationId) =>
    http(`/conversations/${encodeURIComponent(conversationId)}/subscriptions`),
  updateSubscription: (conversationId, subId, body) =>
    http(`/conversations/${encodeURIComponent(conversationId)}/subscriptions/${encodeURIComponent(subId)}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  steerRun: (runId, message) =>
    http(`/runs/${encodeURIComponent(runId)}/steer`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  fsRead: (path) => http(`/fs/read?path=${encodeURIComponent(path)}`),
  fsLs: (path = "/") => http(`/fs/ls?path=${encodeURIComponent(path)}`),
  respondConversation: (conversationId, input) =>
    http(`/conversations/${encodeURIComponent(conversationId)}/respond`, {
      method: "POST",
      body: JSON.stringify({
        approve: input.approve,
        messageId: input.messageId,
        editedArgs: input.editedArgs,
      }),
    }),
  listBots: (opts) => {
    const qs = new URLSearchParams();
    if (opts?.includeArchived) qs.set("include_archived", "true");
    const q = qs.toString();
    return http<Bot[]>(`/bots${q ? `?${q}` : ""}`);
  },
  createBot: (input) =>
    http<Bot>("/bots", { method: "POST", body: JSON.stringify(input) }),
  getBot: (botId) => http<Bot>(`/bots/${encodeURIComponent(botId)}`),
  patchBot: (botId, patch) =>
    http<Bot>(`/bots/${encodeURIComponent(botId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteBot: (botId) =>
    http(`/bots/${encodeURIComponent(botId)}`, { method: "DELETE" }),
  pinBot: (botId, pinned = true) =>
    http<Bot>(`/bots/${encodeURIComponent(botId)}/pin?pinned=${pinned ? "true" : "false"}`, {
      method: "POST",
    }),
  listBotMemories: (botId,projectId) =>
    http(`/bots/${encodeURIComponent(botId)}/memories?${new URLSearchParams(projectId ? {project_id:projectId} : {})}`),
  listBotSkills: (botId) =>
    http<BotSkill[]>(`/bots/${encodeURIComponent(botId)}/skills`),
  createBotSkill: (botId, input) =>
    http<BotSkill>(`/bots/${encodeURIComponent(botId)}/skills`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listBotRoutines: (botId) =>
    http<BotRoutine[]>(`/bots/${encodeURIComponent(botId)}/routines`),
  getBotUsage: (botId, days = 7) =>
    http<BotUsageSummary>(`/bots/${encodeURIComponent(botId)}/usage?days=${days}`),
  interviewBot: (botId, input) =>
    http(`/bots/${encodeURIComponent(botId)}/interview`, {
      method: "POST",
      body: JSON.stringify({
        answers: input.answers || {},
        freeText: input.freeText,
      }),
    }),
  exportBot: (botId) =>
    http(`/bots/${encodeURIComponent(botId)}/export`),
  listBotTemplates: () => http<BotTemplate[]>("/bots/templates"),
  importBotTemplate: (input) =>
    http<BotImportResult>("/bots/import", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listInterviewQuestions: () =>
    http<{ questions: InterviewQuestion[] }>("/bots/interview/questions"),
  listBotTeams: () => http<BotTeam[]>("/bots/teams"),
  createBotTeam: (input) =>
    http<BotTeam>("/bots/teams", { method: "POST", body: JSON.stringify(input) }),
  getBotTeam: (teamId) => http<BotTeam>(`/bots/teams/${encodeURIComponent(teamId)}`),
  patchBotTeam: (teamId, patch) =>
    http<BotTeam>(`/bots/teams/${encodeURIComponent(teamId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteBotTeam: (teamId) =>
    http(`/bots/teams/${encodeURIComponent(teamId)}`, { method: "DELETE" }),
  getBotRoster: (opts) => {
    const qs = new URLSearchParams();
    if (opts?.format) qs.set("format", opts.format);
    if (opts?.team) qs.set("team", opts.team);
    if (opts?.projectId) qs.set("project_id",opts.projectId);
    const q = qs.toString();
    return http<BotRoster>(`/bots/roster${q ? `?${q}` : ""}`);
  },
  listSquads: () => http<{ squads: SquadPreset[] }>("/bots/squads"),
  botCoverage: (input) =>
    http<CoverageReport>("/bots/coverage", {
      method: "POST",
      body: JSON.stringify({
        memberBotIds: input.memberBotIds,
        format: input.format,
      }),
    }),
  evalSeed: () => http("/eval/seed", { method: "POST", body: "{}" }),
  evalOverview: () => http("/eval/overview"),
  evalConfig: () => http("/eval/config"),
  putEvalConfig: (body) =>
    http("/eval/config", { method: "PUT", body: JSON.stringify(body) }),
  listEvalRubrics: (opts) => {
    const q = new URLSearchParams();
    if (opts?.format) q.set("format", opts.format);
    if (opts?.artifactType) q.set("artifactType", opts.artifactType);
    if (opts?.grader) q.set("grader", opts.grader);
    const qs = q.toString();
    return http(`/eval/rubrics${qs ? `?${qs}` : ""}`);
  },
  patchEvalRubric: (key, body) =>
    http(`/eval/rubrics/${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  evalRubricStats: (key) => http(`/eval/rubrics/${encodeURIComponent(key)}/stats`),
  listEvalSuites: (opts) => {
    const q = new URLSearchParams();
    if (opts?.format) q.set("format", opts.format);
    if (opts?.tier) q.set("tier", opts.tier);
    const qs = q.toString();
    return http(`/eval/suites${qs ? `?${qs}` : ""}`);
  },
  createEvalSuite: (body) =>
    http("/eval/suites", { method: "POST", body: JSON.stringify(body) }),
  postArtifactFeedback: (body) =>
    http("/eval/feedback", { method: "POST", body: JSON.stringify(body) }),
  listFeedbackTags: () => http("/eval/feedback/tags"),
  getExemplars: (params) => {
    const q = new URLSearchParams();
    if (params.format) q.set("format", params.format);
    if (params.artifactType) q.set("artifactType", params.artifactType);
    if (params.tags?.length) q.set("tags", params.tags.join(","));
    if (params.maxChars) q.set("maxChars", String(params.maxChars));
    return http(`/eval/exemplars?${q.toString()}`);
  },
  postBestOfNRank: (body) =>
    http("/eval/best-of-n/rank", { method: "POST", body: JSON.stringify(body) }),
  postBestOfNPick: (body) =>
    http("/eval/best-of-n/pick", { method: "POST", body: JSON.stringify(body) }),
  postPreference: (body) =>
    http("/eval/preferences", { method: "POST", body: JSON.stringify(body) }),
  listEvalCases: (suiteId) => http(`/eval/suites/${encodeURIComponent(suiteId)}/cases`),
  createEvalCase: (suiteId, body) =>
    http(`/eval/suites/${encodeURIComponent(suiteId)}/cases`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  evalCaseFromArtifact: (body) =>
    http("/eval/cases/from-artifact", { method: "POST", body: JSON.stringify(body) }),
  createEvalRun: (body) =>
    http("/eval/runs", { method: "POST", body: JSON.stringify(body) }),
  listEvalRuns: (opts) => {
    const q = new URLSearchParams();
    if (opts?.suiteId) q.set("suiteId", opts.suiteId);
    if (opts?.limit) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return http(`/eval/runs${qs ? `?${qs}` : ""}`);
  },
  getEvalRun: (runId) => http(`/eval/runs/${encodeURIComponent(runId)}`),
  compareEvalRuns: (runId, baselineId) =>
    http(`/eval/runs/${encodeURIComponent(runId)}/compare/${encodeURIComponent(baselineId)}`),
  getEvalTrial: (trialId) => http(`/eval/trials/${encodeURIComponent(trialId)}`),
  overrideEvalJudgment: (trialId, body) =>
    http(`/eval/trials/${encodeURIComponent(trialId)}/override`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  scoreArtifact: (body) =>
    http("/eval/score-artifact", { method: "POST", body: JSON.stringify(body) }),
  listEvalCasePool: (opts) => {
    const q = new URLSearchParams();
    if (opts?.status) q.set("status", opts.status);
    if (opts?.signal) q.set("signal", opts.signal);
    if (opts?.limit) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return http(`/eval/case-pool${qs ? `?${qs}` : ""}`);
  },
  triageEvalCandidate: (id, body) =>
    http(`/eval/case-pool/${encodeURIComponent(id)}/triage`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  attributeEvalCandidate: (id) =>
    http(`/eval/case-pool/${encodeURIComponent(id)}/attribute`, { method: "POST", body: "{}" }),
  flagEvalArtifact: (body) =>
    http("/eval/case-pool/flag", { method: "POST", body: JSON.stringify(body) }),
  evalAnnotateQueue: (limit = 20) => http(`/eval/annotate/queue?limit=${limit}`),
  evalAnnotate: (body) =>
    http("/eval/annotate", { method: "POST", body: JSON.stringify(body) }),
  evalAgreement: () => http("/eval/agreement"),
  evalPairwise: (body) =>
    http("/eval/pairwise", { method: "POST", body: JSON.stringify(body) }),
  evalPromptSuggestions: (agentId) => {
    const q = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
    return http(`/eval/feedback/prompt-suggestions${q}`);
  },
  reset() {
    /* no-op */
  },
};

export const api: ApiClient = httpApi;

export function formatLabel(format: ProjectFormat) {
  const map: Record<ProjectFormat, string> = {
    manju: "漫剧",
    duanju: "短剧",
    short_novel: "短篇",
    male_long: "男频中长篇",
    female_long: "女频中长篇",
    ip_adapt: "IP 改编",
  };
  return map[format];
}
