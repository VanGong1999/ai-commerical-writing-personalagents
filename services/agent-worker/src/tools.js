import { typedRole, roleOutputError } from "./typedRoleOutput.js";
import { validChecklist } from "./humanHandoff.js";
import {criticAgents} from "./criticReview.js";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { resolveFleetMemoryPath } from "./resumeReplay.js";
import { marked } from "marked";
import parse5 from "parse5";
import { Type } from "@sinclair/typebox";
import {
  checkSavedScene,
  checkCourseShell,
  sceneBodyContract,
  allPassed,
  getAgent,
  checkChunkPolicy,
  checkFormatSelected,
  checkHookPresence,
  checkLengthBand,
  checkLengthDecay,
  codepointCount,
  checkLogicAck,
  checkPromptLockHash,
  normalizeGateName,
  runGateBattery,
  listSkillIndex,
  resolveSkill,
  formatSkillCatalogForPrompt,
  evaluateDoneContract,
  evaluateDoneGate,
  resolveSubagent,
  assertSubagentDepth,
  assertParallelSize,
  SUBAGENT_SPAWN_TOOL_DESC,
  gateToolCall,
  payoffLedgerAction,
  defaultSecurityPolicy,
  withSecurityGate,
  agentPrivateMemoryGate,
  callBudgetGate,
  findPlaceholder,
  sliceLines,
} from "@xiezuomanju/agent-runtime";
import { ArtifactTypeSchema } from "../../../packages/domain/src/enums.ts";
import { StoryGraphBodySchema } from "../../../packages/domain/src/story-graph.ts";
import { readSavedBodyDecay } from "./batchLifecycle.js";
import { api } from "./apiClient.js";
import { searchKb, KB_SOURCE_SCOPES } from "./kbRetrieval.js";
import { countCompletionArtifacts, isActiveCompletionArtifact, selectCompletionArtifacts } from "./completionArtifacts.js";

const manuscriptRevisionStages = new Map([
  ["prose.qa_correct", "S6_QA"],
  ["prose.length_decay_fix", "S6_QA"],
  ["prose.storyboard", "S7_STORYBOARD"],
  ["prose.dialogue_pressure", "S8_DIALOGUE"],
  ["qc.de_ai", "S9_DE_AI"],
]);

export function activeRunManuscripts(rows, runId) {
  return selectCompletionArtifacts(rows, {runId}).filter(row => row.type === "manuscript");
}

export function checkSavedFinalStoryGraph(artifact, projectId, payload) {
  const id = payload.artifactId || payload.artifact_id;
  const graph = id && artifact?.id === id && artifact.projectId === projectId && artifact.type === "story_graph" &&
    isActiveCompletionArtifact(artifact) && Number.isSafeInteger(artifact.version) && artifact.version > 0
    ? StoryGraphBodySchema.safeParse(artifact.bodyJson) : null;
  if (!graph?.success || graph.data.kind !== "story_graph" || !graph.data.nodes.length) {
    return { id:"graph_consistency", name:"剧情图一致性", result:"inconclusive",
      message:'请用 artifact_list({type:"story_graph",full:false}) 查找本项目当前有效图的 ID，再用 payload.artifactId 运行 GraphConsistency。门禁直接读取已保存的结构化图。' };
  }
  const [check] = runGateBattery("GraphConsistency", {...payload, graph:graph.data, requireNonEmpty:true});
  return {...check, evidence:{source:"saved_story_graph", projectId, artifactId:id, version:artifact.version}};
}

const biblePackFields = [
  "locked_cast", "gold_finger_limits", "last_summary", "recent_journals",
  "story_graph_slice", "recent_character_states", "open_foreshadows", "forbidden_drifts",
];
const optionalPackCollections = new Set(["recent_journals","recent_character_states","open_foreshadows","forbidden_drifts"]);

// Accept the skill's YAML fields or named Markdown sections used by the lifecycle pack.
function incompleteBiblePackFields(content) {
  const sections = new Map();
  let current;
  let fieldIndent = -1;
  for (const line of content.split(/\r?\n/)) {
    const yaml = /^( *)([\w-]+):(?:\s+(.*))?\s*$/.exec(line);
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (heading || (yaml && (biblePackFields.includes(yaml[2]) || yaml[1].length <= fieldIndent))) {
      const key = heading ? heading[1] : yaml[2];
      current = biblePackFields.includes(key) ? key : undefined;
      fieldIndent = yaml?.[1].length ?? -1;
      if (current) {
        if (sections.has(current)) return [current];
        sections.set(current, [yaml?.[3] ?? ""]);
      }
    } else if (current) sections.get(current).push(line);
  }
  return biblePackFields.filter(field => {
    const value = (sections.get(field) || []).filter(line => !/^\s*(?:#|\x60\x60\x60)/.test(line)).join("\n").trim();
    if (/^(?:\[\s*\]|\{\s*\})$/.test(value)) return !optionalPackCollections.has(field);
    return !/[\p{L}\p{N}]/u.test(value) || /^(?:null|~)$/i.test(value);
  });
}

function extractAbilityRule(body, markdown, fallback = {}) {
  const renderRule = (value, depth = 0) => {
    if (typeof value === "string") return value.trim();
    if (!value || typeof value !== "object" || depth > 3) return "";
    return Object.entries(value).map(([key, child]) => {
      // Category metadata alone contributes no mechanism, regardless of the author's label.
      if (["type", "category", "类型", "类别"].includes(key.trim().toLowerCase())) return "";
      const rendered = renderRule(child, depth + 1);
      return rendered ? `${key}：${rendered}` : "";
    }).filter(Boolean).join("；");
  };
  const md = String(markdown || "");
  const section = md.match(/(?:^|\n)#{1,6}\s*金手指[^\n]*\n([\s\S]*?)(?=\n#{1,2}\s|$)/)?.[1]
    || md.match(/(?:^|\n)[-* ]*金手指[：:]\s*([^\n]+)/)?.[1];
  const candidates = [body, fallback].flatMap(source =>
    ["goldFinger", "gold_finger", "金手指", "rule", "rules"].map(key => renderRule(source[key]))
  );
  candidates.push(section?.trim() || (fallback.text ? String(fallback.text).trim() : ""));
  // Match a complete label. Extra prose on the same bullet is still saved rule evidence.
  const categoryOnly = /^(?:[-*]\s*)?(?:(?:类型|type|category)\s*[：:]\s*)?(?:系统|先知|天赋|本体)[。.!！]?$/iu;
  const customLabelOnly = /^(?:[-*]\s*)?(?:类型|type|category)\s*[：:]\s*(?!系统|先知|天赋|本体)[\p{L}\p{N}_-]+[。.!！]?$/iu;
  return candidates.find(rule => rule && !categoryOnly.test(rule) && !customLabelOnly.test(rule)) || "";
}

const textPresent = value => typeof value === "string" && value.trim().length > 0;
const nonReportElements = new Set(["h1","h2","h3","h4","h5","h6","head","title","th","script","style","template","noscript"]);
const textBoundaries = new Set(["p","div","br","hr","li","dt","dd","blockquote","pre","td","section","article","header","footer"]);

// Markdown escapes code literals; parsing its HTML decodes character references exactly once.
// Keep inline fragments together so styling a word in the report title does not turn it into body text.
function genreReportHasBody(markdown, title) {
  if (!textPresent(markdown)) return false;
  const document = parse5.parseFragment(marked.parse(markdown));
  const pieces = [];
  function collect(node) {
    if (nonReportElements.has(node.tagName) || node.attrs?.some(attr => attr.name === "hidden")) return;
    if (node.nodeName === "#text") {
      pieces.push(node.value.replace(/\s+/gu, " "));
      return;
    }
    const block = textBoundaries.has(node.tagName);
    if (block) pieces.push("\n");
    for (const child of node.childNodes || []) collect(child);
    if (block) pieces.push("\n");
  }
  collect(document);
  const normalizedTitle = (title || "").replace(/\s+/gu, " ").trim();
  return pieces.join("").split("\n").some(block => {
    const text = block.replace(/\s+/gu, " ").trim();
    return /[\p{L}\p{N}]/u.test(text) && text !== normalizedTitle;
  });
}

const savedReviewOutputs = {
  "topic.genre_trim": a => {
    const body = a.bodyJson?.genre_trim ?? a.bodyJson ?? {};
    const title = a.title?.trim();
    const hasReport = value => genreReportHasBody(value, title);
    return hasReport(a.bodyMarkdown) ||
      [body.report, body.summary, body.analysis, body.freshness_note].some(hasReport) ||
      [body.blacklist_hits, body.watchlist_hits, body.rewrite_hints].some(list => Array.isArray(list) && list.some(hasReport));
  },
  "prose.dialogue_voice": a => a.type === "manuscript" &&
    [a.bodyMarkdown, a.bodyJson?.script_body, a.bodyJson?.text].some(textPresent),
  "imitate.wash": a => ["other","qc_report","analysis_report"].includes(a.type) && textPresent(a.bodyMarkdown),
  "scene.comedy": a => a.type === "other" && Array.isArray(a.bodyJson?.comedy_inserts) && a.bodyJson.comedy_inserts.length > 0 &&
    a.bodyJson.comedy_inserts.every(row => textPresent(row?.beat) && textPresent(row?.element)),
  "world.setting_cap": (a, {maxMainSettings}) => a.type === "other" && Array.isArray(a.bodyJson?.settings_found) &&
    (a.bodyJson.settings_found.length > 0 || textPresent(a.bodyJson.verdict)) &&
    a.bodyJson.settings_found.every(row => textPresent(row?.name) && typeof row.is_main === "boolean") &&
    (maxMainSettings === undefined || (Number.isSafeInteger(maxMainSettings) && maxMainSettings >= 0 &&
      a.bodyJson.settings_found.filter(row => row.is_main).length <= maxMainSettings)),
  "struct.bridge8": (a, {requireTropeTag}) => {
    const plan = a.bodyJson?.trope_plan;
    const categories = ["打脸","碾压","运气","地位","集体","因果","极限","哲思"];
    if (a.type !== "other" || !Array.isArray(plan?.secondary) ||
        !plan.secondary.every(tag => categories.includes(tag))) return false;
    return (categories.includes(plan.primary) && textPresent(plan.visual_beat) ||
      requireTropeTag !== true && (plan.primary == null || plan.primary === "") &&
      plan.secondary.length === 0 && textPresent(plan.no_fit_reason));
  },
  "topic.world_setting": a => ["setting","world","world_setting","other"].includes(a.type) &&
    Boolean(extractAbilityRule(a.bodyJson || {}, a.bodyMarkdown)),
};
function structuredOutputCheck(type, body) {
  if (type === "scene") return checkSavedScene(body);
  const score = body?.select_score ?? body;
  const valid = ["data", "genre", "structure", "characters"].every(key => {
    const value = score?.[key]?.score;
    return Number.isInteger(value) && value >= 1 && value <= 5;
  }) && ["go", "hold", "no-go"].includes(score?.decision);
  return {id:"select_score", name:"选书四指标", result:valid ? "pass" : "fail",
    message:"bodyJson 需要 data、genre、structure、characters 四项各含整数 score 1–5，以及 decision 为 go/hold/no-go"};
}

/** 纯读工具：可在同一轮内并发执行（无副作用/无动态加载/无 CAS 写）。 */
export const PARALLEL_READ_TOOLS = new Set([
  "bible_read",
  "memory_get",
  "memory_search",
  "memory_grep",
  "kb_read",
  "kb_search",
  "artifact_list",
  "skill_list",
  "skill_read",
  "project_get",
]);
import { lessonsPath, mergeLesson } from "./contextMemory.js";
import {
  CORE_TOOL_NAMES,
  getCatalogEntry,
  resolveToolAccess,
  searchCatalog,
} from "./toolCatalog.js";
import {
  buildToolIndex,
  closestToolNames,
  lookupTool,
  normalizeToolName,
} from "./toolNames.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const KB_INDEX = join(REPO_ROOT, "knowledge", "00-meta", "search-index.json");

function loadKbIndex() {
  if (!existsSync(KB_INDEX)) return [];
  try {
    const raw = JSON.parse(readFileSync(KB_INDEX, "utf8"));
    if (Array.isArray(raw)) return raw;
    // search-index.json 主字段为 articles；兼容旧 items/entries
    return raw.articles || raw.items || raw.entries || [];
  } catch {
    return [];
  }
}

function searchKnowledgeLocal(query, { category, limit = 8 } = {}) {
  const q = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!q.length) return [];
  let rows = loadKbIndex();
  if (category) rows = rows.filter((r) => String(r.category || "").includes(category));
  const scored = rows
    .map((r) => {
      const hay = [r.title, r.summary, ...(r.tags || []), r.path]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      let score = 0;
      for (const term of q) {
        if (hay.includes(term)) score += term.length > 1 ? 2 : 1;
        if (String(r.title || "")
          .toLowerCase()
          .includes(term))
          score += 3;
      }
      return { ...r, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored;
}

function isMemoryFileMissing(error) {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status;
  return status === 404 || (status == null && /^404(?:\s|$)/.test(String(error?.message || "")));
}

/** CAS never retries stale content against another writer's newer hash. */
async function casPutMemory({
  path,
  content,
  projectId,
  expectedHash,
  actor = "agent:worker",
  isHypothesis = false,
  changeSummary,
  sourceRunId,
}) {
  if (String(expectedHash ?? "").trim() === "*") {
    return { ok: false, isError: true, error: "memory_hash_required", path,
      message: "禁止 wildcard 通配 hash；必须提供读取版本的精确 expectedHash。", attempts: 0 };
  }
  let hash = expectedHash;
  if (hash === undefined) {
    let current;
    try {
      current = await api.getMemoryFile(path);
    } catch (error) {
      if (!isMemoryFileMissing(error)) throw error;
      hash = null; // Only a confirmed missing file permits create-only CAS.
    }
    if (hash !== null) {
      return {
        ok: false, isError: true, error: "memory_hash_required", path,
        message: "文件已存在：请先读取并基于其内容修改，写入时传入该版本的 expectedHash。禁止自动采用最新 hash 覆盖。",
        currentHash: current?.hash ?? null,
        currentContent: String(current?.content || ""),
        attempts: 0,
      };
    }
  }
  try {
    const row = await api.putMemoryFileCas({
      path, content, project_id: projectId, projectId,
      is_hypothesis: !!isHypothesis, expected_hash: hash, check_cas: true,
      actor, change_summary: changeSummary || undefined, source_run_id: sourceRunId,
    });
    return { ok: true, path, hash: row?.hash || null, row, attempts: 1 };
  } catch (error) {
    if (error?.code !== "memory_conflict") throw error;
    const detail = error.detail || {};
    return {
      ok: false, isError: true, error: "memory_conflict", path,
      message: "乐观并发冲突：其他 agent 已更新该文件，未重试覆盖。请读取完整当前内容，合并修改后再用 expectedHash=currentHash 重试。",
      currentHash: detail.current_hash ?? detail.currentHash ?? null,
      currentContent: detail.current_content ?? detail.currentContent ?? "",
      actor: detail.actor, attempts: 1,
    };
  }
}

/** Version/provenance remain attached even when the content is paged. */
function memoryReadMetadata(row) {
  return {
    hash: row?.hash ?? null,
    isHypothesis: row?.isHypothesis ?? row?.is_hypothesis ?? false,
    sourceRunId: row?.sourceRunId ?? row?.source_run_id ?? null,
    updatedAt: row?.updatedAt ?? row?.updated_at ?? null,
  };
}

/**
 * 构造 artifact 创建请求体；把 runId 写入 createdByRunId，
 * 供后端 daemon 在 run 成功后按 created_by_run_id == run.id 采纳本步产物。
 */
export function buildArtifactPayload({ runId, type, title, bodyMarkdown, bodyJson, status }) {
  return { type, title, bodyMarkdown, bodyJson, status, createdByRunId: runId };
}

function artifactReceipt(row) {
  const body = row.bodyJson || {};
  return {
    id: row.id, projectId: row.projectId, type: row.type, title: row.title,
    status: row.status, version: row.version, createdByRunId: row.createdByRunId,
    schemaVersion: row.schemaVersion, parentId: row.parentId, batchId: row.batchId, adoptedAt: row.adoptedAt,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
    bodyChars: String(row.bodyMarkdown || "").length,
    bodyJsonChars: JSON.stringify(row.bodyJson ?? null).length,
    words: Number(body.wordCount ?? 0) || String(row.bodyMarkdown || "").replace(/\s/g, "").length,
    episodeNo: body.episodeNo ?? body.episode_no ?? body.chapterNo ?? null,
  };
}

// Only a successful persistent mutator can issue this evidence. Read tools and
// idempotent "already exists" observations deliberately return no write marker.
function artifactWriteResult(row, display = row) {
  const {id, projectId, version} = row;
  return {content: [{type: "text", text: JSON.stringify(display)}],
    details: {}, artifactWrite: {id, projectId, version}};
}

// These two idempotent creation endpoints can return an existing report. Verify
// the immutable initial write before attaching a receipt to such a response.
async function reportWriteResult(row, display, runId, actor) {
  const response = {content: [{type:"text",text:JSON.stringify(display)}], details:{}};
  if (row.createdByRunId !== runId) return response;
  const history = await api.listArtifactVersions(row.projectId, row.id).catch(() => []);
  const initial = history.find(v => v.artifactId === row.id && v.version === 1 && v.actor === actor);
  return initial ? artifactWriteResult({...row, version:initial.version}, display) : response;
}

function boundedInteger(value, fallback, maximum, minimum = 0) {
  return Number.isFinite(Number(value)) && value != null
    ? Math.max(minimum, Math.min(maximum, Math.floor(Number(value)))) : fallback;
}

function artifactBodyPage(text, offset, limit) {
  let start = Math.min(offset, text.length);
  const lowSurrogateAt = index => index < text.length && /[\uDC00-\uDFFF]/.test(text[index]);
  if (start > 0 && lowSurrogateAt(start)) start -= 1;
  let end = Math.min(text.length, start + limit);
  if (end > start && lowSurrogateAt(end)) end -= 1;
  return { text: text.slice(start, end), coverage: {
    offset: start, end, totalChars: text.length, offsetUnit: "UTF-16",
    truncated: start > 0 || end < text.length, hasMore: end < text.length,
    nextOffset: end < text.length ? end : null,
  } };
}

/** Retrieval scope is enforced again even if an older server ignores filters. */
function readableMemoryPath(path, projectId, agentId, shared = false) {
  if (typeof path !== "string" || /\\|(?:^|\/)\.\.(?:\/|$)|%2e/i.test(path)) return false;
  const prefix = `/memories/projects/${projectId}/`;
  if (!path.startsWith(prefix)) return shared && (path.startsWith("/memories/org/") || path === "/memories/user/preferences.md");
  const relative = path.slice(prefix.length);
  return !relative.startsWith("procedural/") || relative.startsWith(`procedural/${agentId}/`);
}

const decimalCitationOffset = /^(?:0|[1-9][0-9]{0,15})$/;
const reportText = Type.String({pattern:"\\S"});
const knowledgeReportBody = Type.Object({
  verified: Type.String({pattern:"\\S", description:"授权原文能证实的内容"}),
  unknowns: Type.Union([reportText, Type.Array(reportText, {minItems:1})], {
    description:"原文未能证实的事项，写成一段非空文本或逐项列出。",
  }),
  citations: Type.Array(Type.Object({
    refId: Type.Optional(Type.String({minLength:1, description:"引用用户选区时复制该选区的 id。"})),
    docId: Type.String({minLength:1, description:"复制授权文档的 docId（kb_read 返回 doc_id）"}),
    quote: Type.String({pattern:"\\S", description:"从 snippet 或 text 逐字复制，保留空格和标点，最多 2400 个 Unicode 字符。"}),
    offset: Type.Union([
      Type.Integer({minimum:0, maximum:Number.MAX_SAFE_INTEGER}),
      Type.String({pattern:decimalCitationOffset.source}),
    ], {description:"从零起的字符位置，使用非负安全整数或无前导零的十进制整数字符串（最大 9007199254740991）。"
      + "可以直接用命中片段或阅读页返回的 offset。引文若不在该起点，系统仅在授权文档中逐字匹配唯一时定位。多处匹配时复制更长的唯一原文或给出准确位置。"}),
  }), {minItems:1, maxItems:24}),
});

export function createWritingTools(ctx) {
  const {
    projectId,
    publish,
    allowlist,
    jobId,
    runId,
    doneContract,
    allowedGateNames,
    securityMode = "safe",
    onGateEvidence,
    depth = 0,
    parentAgentId,
    spawnNested,
    fleetWorkdir,
  } = ctx;
  const memoryOwner = depth > 0 ? runId : parentAgentId;
  const gateEvidence = {};
  const successfulTools = new Set();
  const artifactCreates = new Map();
  const withArtifactIdentity = async (key, write) => {
    const previous = artifactCreates.get(key) || Promise.resolve();
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    artifactCreates.set(key, pending);
    await previous;
    try { return await write(); }
    finally { release(); if (artifactCreates.get(key) === pending) artifactCreates.delete(key); }
  };
  const setup = ctx.pipelineMember && parentAgentId === "orch.writing" && /^S0_/.test(ctx.pipelineStageId);
  const genreReview = ctx.pipelineMember && parentAgentId === "topic.genre_trim";
  const proactive = parentAgentId === "colleague.proactive";
  const knowledge = ctx.knowledge;
  const scout = ctx.subagentRole === "scout" && depth > 0;
  const scopedRole = Boolean(scout || knowledge || setup || genreReview || proactive);
  const ownedRevision = knowledge?.canReviseOwnReport === true && knowledge.tools?.includes("artifact_create") && allowlist?.includes("artifact_create") &&
    knowledge.id === parentAgentId && knowledge.runId === runId && knowledge.runProjectId === projectId && Boolean(jobId);
  const {format, pipelineExecutionId, pipelineStageId, episodeNo, manuscript, episode_outline, sourceIndex} = ctx.bodyInput || {};
  const manuscriptRevision = !scopedRole && depth === 0 && runId && ctx.pipelineMember && format === "manju" &&
    textPresent(pipelineExecutionId) && pipelineStageId === ctx.pipelineStageId && manuscriptRevisionStages.get(parentAgentId) === pipelineStageId &&
    typeof pipelineStageId === "string" && Number.isSafeInteger(episodeNo) && episodeNo >= 1 && episodeNo <= 3 &&
    [manuscript, episode_outline].every(ref => textPresent(ref?.id) && Number.isSafeInteger(ref.version) && ref.version > 0) &&
    allowlist?.includes("artifact_create");
  const edition = ref => textPresent(ref?.id) && Number.isSafeInteger(ref.version) && ref.version > 0;
  const editionList = (refs, count) => Array.isArray(refs) && refs.length === count && refs.every(edition);
  const pitchRole = parentAgentId === "deliver.pitch_pack";
  const pitchRevision = pitchRole && !scopedRole && depth === 0 && runId && jobId && ctx.pipelineMember && format === "manju" &&
    textPresent(projectId) && textPresent(pipelineExecutionId) && pipelineStageId === "S11_PITCH" && pipelineStageId === ctx.pipelineStageId &&
    [sourceIndex?.core_hook, sourceIndex?.logline, sourceIndex?.signedReport].every(edition) &&
    editionList(sourceIndex.characters, 1) && editionList(sourceIndex.episode_outline, 10) && editionList(sourceIndex.manuscripts, 3) &&
    allowlist?.includes("artifact_create");
  const activeRunPitch = rows => selectCompletionArtifacts(rows, {runId}).filter(row => row.projectId === projectId && row.type === "other");
  const finalLogicReview = !scopedRole && depth === 0 && runId && ctx.pipelineMember && format === "manju" &&
    parentAgentId === "qc.logic_heuristic" && pipelineStageId === "S10_HUMAN_QC" && pipelineStageId === ctx.pipelineStageId &&
    textPresent(pipelineExecutionId) && ctx.bodyInput.story_graph?.path === `/memories/projects/${projectId}/story_graph.md`;
  const reportRows = () => knowledge
    ? api.knowledgeReports(runId, jobId, knowledge.version)
    : api.listArtifacts(projectId);
  const sharedGateNames = scopedRole ? [] : (ctx.commonGateNames || []);
  async function verifyKnowledgeReport(body, saved = false, revision = false) {
    if (!textPresent(body?.verified)) throw new Error("bodyJson.verified 需要非空文本");
    const items = body.unknowns;
    // Adapt only a new tool call. A persisted report must already have its canonical text and numeric anchors.
    if (!saved && Array.isArray(items) && items.length && items.every(textPresent)) {
      if (Object.hasOwn(body, "unknownItems") && JSON.stringify(body.unknownItems) !== JSON.stringify(items))
        throw new Error("bodyJson.unknownItems 与 unknowns 列表不一致");
      body = {...body, unknowns:items.join("\n"), unknownItems:items};
    }
    if (!textPresent(body.unknowns)) throw new Error(saved ? "已保存的 bodyJson.unknowns 需要非空文本"
      : "bodyJson.unknowns 需要非空文本，或由非空文本组成的非空列表");
    if (!Array.isArray(body.citations) || !body.citations.length || body.citations.length > 24)
      throw new Error("bodyJson.citations 需要 1–24 条授权原文引用");
    const proposed = body.citations.map((cite, index) => {
      const hasOffset = cite && Object.hasOwn(cite, "providedOffset");
      const hasHash = cite && Object.hasOwn(cite, "sourceHash");
      if ((saved || revision) && hasOffset !== hasHash) throw new Error("已保存引文的核验信息不完整");
      const field = (saved || revision) && hasOffset ? "providedOffset" : "offset";
      const supplied = cite?.[field];
      const offset = !saved && field === "offset" && typeof supplied === "string" && decimalCitationOffset.test(supplied)
        ? Number(supplied) : supplied;
      if (!knowledge.documentIds.includes(cite?.docId)) throw new Error(`bodyJson.citations[${index}].docId 必须属于本次授权文档`);
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error(`bodyJson.citations[${index}].${field} 需要 0 至 9007199254740991 的十进制整数`);
      if (!textPresent(cite.quote) || [...cite.quote].length > 2400)
        throw new Error(`bodyJson.citations[${index}].quote 需要非空的逐字原文，最多 2400 个 Unicode 字符`);
      return {docId:cite.docId, quote:cite.quote, offset, ...(cite.refId != null ? {refId:cite.refId} : {})};
    });
    const {citations} = await api.knowledgeCitations(runId, ctx.jobId, knowledge.version, proposed);
    if (!Array.isArray(citations) || citations.length !== proposed.length) throw new Error("未取得完整引文核验结果");
    const anchored = citations.map((anchor, index) => {
      const original = body.citations[index];
      if ((saved || (revision && Object.hasOwn(original, "sourceHash"))) && (original.offset !== anchor.offset ||
          (Object.hasOwn(original, "sourceHash") && original.sourceHash !== anchor.sourceHash)))
        throw new Error("已保存的证据位置或原文版本发生变化");
      return {...original, ...anchor};
    });
    return {...body, citations:anchored};
  }
  async function knowledgeSchema(artifactId, artifacts, checkedVersion) {
    const check = {id:"schema", name:"Schema", result:"fail", message:"需要本次运行保存的知识报告"};
    try {
      const rows = selectCompletionArtifacts(artifacts ?? await reportRows(), {runId});
      const reports = rows.filter(row => row.type === "qc_report");
      const report = reports[0];
      if (reports.length !== 1 || report.id !== artifactId || report.status !== "candidate" || report.bodyJson?.agentId !== parentAgentId ||
          report.bodyJson?.roleVersion !== knowledge.version || !Number.isInteger(report.version) || report.version < 1)
        return check;
      if (report.versionActor !== `agent:${runId}`)
        return {...check, message:"当前报告版本缺少本次运行的唯一写入凭据，请用 artifact_list 核对候选并向用户说明"};
      if (checkedVersion != null && report.version !== checkedVersion)
        return {...check, message:"知识报告版本发生变化，请重新运行 Schema"};
      await verifyKnowledgeReport(report.bodyJson, true);
      return {...check, result:"pass", message:"已核验本次报告版本及其授权原文",
        evidence:{source:"knowledge_report", artifactId:report.id, version:report.version, versionActor:report.versionActor}};
    } catch (error) {
      return {...check, message:String(error?.message || "知识报告复核失败")};
    }
  }
  async function recheckKnowledgeSchema(artifacts) {
    const prior = gateEvidence.Schema;
    if (prior?.result !== "pass") return;
    const binding = prior.evidence;
    const check = binding?.source === "knowledge_report" && Number.isInteger(binding.version)
      ? await knowledgeSchema(binding.artifactId, artifacts, binding.version)
      : {id:"schema", name:"Schema", result:"fail", message:"知识报告缺少版本核验记录"};
    rememberGateEvidence([check], "Schema");
  }
  const gateScope = scout ? new Set(["FormatSelected", "ChunkPolicy"]) : Array.isArray(allowedGateNames)
    ? new Set([...allowedGateNames, ...sharedGateNames].map(normalizeGateName)) : null;
  const showGoldFinger = !gateScope || gateScope.has("GoldFingerMinimal") || gateScope.has("GoldFingerMinimalGate");
  const showGenre = !gateScope || gateScope.has("GenreTrim") || gateScope.has("GenreTrimGate");
  if (gateScope && showGenre) {
    gateScope.add("GenreTrim");
    gateScope.add("GenreTrimGate");
  }
  const gateParameterNames = [...(gateScope || [])];
  if (!scout && gateScope?.has("FormatSelected")) gateParameterNames.push("Format");
  const contentIndependentGateKeys = new Set();
  const editorialGates = new Set(["HookPresence", "Ep1Hook", "RedlineHard", "Novelization", "DeAIChecklist", "ShowDontTell",
      "VoiceDiversity","VoiceDiversityGate","OutlineNoEvenActs","OOC","SimilarityRisk","ComedyDose","ComedyDoseGate",
      "GenreTrim","GenreTrimGate","GoldFingerMinimal","GoldFingerMinimalGate","SettingCap","SettingCapGate","EightTropeCoverage"]);
  const rememberGateEvidence = (checks, gateName) => {
    const preserveSeverity = editorialGates.has(gateName) || ["GraphConsistency","ShellGate","LengthDecay"].includes(gateName);
    const result = preserveSeverity && checks.length === 1 ? checks[0].result : allPassed(checks) ? "pass" : "fail";
    const rows = gateName ? [...checks, { id: gateName, name: gateName,
      result, message: `实际运行 ${gateName}`,
      ...((gateName === "FormatSelected" || (gateName === "Schema" && ["saved_scene","knowledge_report"].includes(checks[0]?.evidence?.source)))
        ? { evidence: checks[0].evidence } : {}),
    }] : checks;
    for (const check of rows) {
      if (check.id) gateEvidence[check.id] = check;
      if (check.name) gateEvidence[check.name] = check;
      if (["PromptLock", "FormatSelected"].includes(gateName)) {
        if (check.id) contentIndependentGateKeys.add(check.id);
        if (check.name) contentIndependentGateKeys.add(check.name);
      }
    }
    onGateEvidence?.(rows);
  };
  const invalidateContentGates = () => {
    for (const key of Object.keys(gateEvidence)) {
      if (!contentIndependentGateKeys.has(key)) delete gateEvidence[key];
    }
  };
  const currentLogicAck = async (artifacts) => {
    const project = await api.getProject(projectId);
    const progress = project.progress || {};
    const versions = progress.logicAckVersions || {};
    return checkLogicAck((progress.logicAck === true || progress.logic_ack === 1) &&
      Object.keys(progress.artifactReviewRequired || {}).length === 0 &&
      artifacts.every(artifact => versions[artifact.id] === artifact.version));
  };
  const promptAuthor = parentAgentId === "prompt.four_part";
  const loadPrompts = async () => {
    const prompts = (await api.listPrompts()) || [];
    if (!promptAuthor) return prompts;
    const {format} = await api.getProject(projectId);
    return prompts.filter(prompt => prompt.format?.includes("*") || prompt.format?.includes(format));
  };
  const validatePrompt = async ({promptId, lockedSystem, lockedHash}) => {
    if (promptId) {
      const canonical = (await loadPrompts()).find(prompt => prompt.id === promptId);
      const system = lockedSystem ?? canonical?.lockedSystem;
      if (typeof system === "string" && typeof canonical?.lockedHash === "string") {
        return checkPromptLockHash(system, canonical.lockedHash);
      }
    } else if (!promptAuthor && typeof lockedSystem === "string" && typeof lockedHash === "string") {
      return checkPromptLockHash(lockedSystem, lockedHash);
    }
    return {id:"prompt_lock_hash", name:"锁定区完整性", result:"fail", message:"请先用 prompt_render 获取有效 promptId"};
  };
  let promptLockBlocked = false;
  // Done Contract 期望的产物类型：注入工具描述 + 创建后软校验（弱模型高发类型写错）
  const expectedArtifactTypes = new Set(
    (doneContract || [])
      .filter((c) => c?.type === "artifact_count" && c?.artifact)
      .map((c) => String(c.artifact)),
  );
  // 策略栈：内置三层 + 不变量闸门（私有记忆边界、写入类调用预算；每个 Instance 一份计数）
  const securityPolicy = {
    ...defaultSecurityPolicy(securityMode, { projectId }),
    agentId: memoryOwner || undefined,
    gates: [
      { id: "memory_cas_exact_version", check: ({toolName, args}) =>
        ["memory_write", "bible_write", "memory_merge", "fs_write", "fs_edit"].includes(toolName) &&
        [args.expectedHash, args.expected_hash].some(hash => typeof hash === "string" && hash.trim() === "*")
          ? {decision: "deny", reason: "禁止 wildcard 通配 hash；请使用读取版本的精确 expectedHash。"} : null },
      { id: "prompt_lock", check: ({toolName}) => promptLockBlocked && getCatalogEntry(toolName)?.risk === "write" ? {decision:"deny",reason:"锁定提示词校验失败，请用 prompt_validate_lock({promptId}) 修复后再写入"} : null },
      ...(memoryOwner ? [agentPrivateMemoryGate(memoryOwner)] : []),
      callBudgetGate({
        lesson_note: Number(process.env.AGENT_MAX_LESSON_NOTES || 5),
        memory_write: Number(process.env.AGENT_MAX_MEMORY_WRITES || 80),
        memory_merge: Number(process.env.AGENT_MAX_MEMORY_WRITES || 80),
      }),
    ],
  };
  // 嵌套子智能体默认禁止再 spawn（depth>=1）；顶层仍可用
  const blockSpawn = depth >= 1;

  const tools = [
    {
      name: "artifact_list",
      label: "List artifacts",
      description: knowledge ? "空参数核对本次知识报告的 ID、版本和状态。传 full=true 阅读本次报告，按 bodyOffset 翻页。" :
        "List project generated artifacts/产物 with metadata pagination (default 40). Read one exact artifact with artifactId + full=true; full pages default 3, maximum 10. Bodies use UTF-16 bodyOffset/bodyLimit (default 4000, maximum 8000) with explicit coverage. Oversized JSON is bodyJsonText, not a complete JSON object. Distinct from memory_search.",
      parameters: knowledge ? Type.Object({
        full:Type.Optional(Type.Boolean()), bodyOffset:Type.Optional(Type.Integer({minimum:0})),
      }, {additionalProperties:false}) : Type.Object({
        type: Type.Optional(Type.String()),
        artifactId: Type.Optional(Type.String()),
        full: Type.Optional(Type.Boolean()),
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1 })),
        bodyOffset: Type.Optional(Type.Integer({ minimum: 0 })),
        bodyLimit: Type.Optional(Type.Integer({ minimum: 100, maximum: 8000 })),
      }),
      async execute(_toolCallId, params) {
        if (knowledge && !params.full) {
          const result = await api.knowledgeOutputs(runId, ctx.jobId, knowledge.version);
          if (!Array.isArray(result?.artifacts)) throw new Error("本次报告写入结果暂不可读");
          return {content:[{type:"text",text:JSON.stringify(result)}],details:{}};
        }
        const rows = knowledge ? (await reportRows()).filter(row => row.bodyJson?.agentId === parentAgentId &&
          row.bodyJson?.roleVersion === knowledge.version) : await api.listArtifacts(projectId, params.type);
        const sorted = [...(rows || [])].sort((a, b) =>
          String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
        );
        const filtered = params.artifactId ? sorted.filter(row => row.id === params.artifactId) : sorted;
        const offset = boundedInteger(params.offset, 0, Number.MAX_SAFE_INTEGER);
        const limit = boundedInteger(params.limit, params.full ? 3 : 40, params.full ? 10 : 100, 1);
        const bodyOffset = boundedInteger(params.bodyOffset, 0, Number.MAX_SAFE_INTEGER);
        const bodyLimit = boundedInteger(params.bodyLimit, 4000, 8000, 100);
        const out = filtered.slice(offset, offset + limit).map(row => {
          const receipt = artifactReceipt(row);
          if (!params.full) return receipt;
          const markdown = artifactBodyPage(String(row.bodyMarkdown || ""), bodyOffset, bodyLimit);
          const json = artifactBodyPage(JSON.stringify(row.bodyJson ?? null), bodyOffset, bodyLimit);
          return { ...receipt, bodyMarkdown: markdown.text,
            ...(json.coverage.truncated ? { bodyJsonText: json.text } : { bodyJson: row.bodyJson ?? null }),
            bodyCoverage: { markdown: markdown.coverage, json: json.coverage },
          };
        });
        const hasMore = offset + out.length < filtered.length;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                count: filtered.length,
                totalCount: sorted.length,
                offset, limit, returnedCount: out.length, hasMore,
                nextOffset: hasMore ? offset + out.length : null,
                ...(params.full ? { bodyOffset, bodyLimit } : {}),
                artifacts: out,
                hint: knowledge ? "使用 bodyOffset 读取后续正文或证据页。请核对完整内容与版本后再修订。" : "目录用 offset/limit 翻页；精读用 artifact_list({artifactId:'目标ID',full:true,bodyOffset:0,bodyLimit:4000})。bodyCoverage 分别说明正文和 JSON 的覆盖，按各自 nextOffset 继续；bodyJsonText 是 JSON 序列化片段，不能作为完整对象写回。",
              }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "ontology_action",
      label: "Ontology Action",
      description:
        "提交 Writing Ontology Action（唯一写路径）。常用：UpsertObject、UpsertStoryGraph、UpsertForeshadow、AdoptObject、LogicAck、LinkExpectationToGraph、CreateScenario、MergeScenario。已映射类型（core_hook/character/episode_outline/story_graph/episode_graph/foreshadow_ledger/expectation_conflict/manuscript/master_outline/framework/character_graph）禁止绕过本工具直写。",
      parameters: Type.Object({
        actionApiName: Type.String(),
        parameters: Type.Optional(Type.Any()),
        expectedHash: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        if (typedRole(parentAgentId)) throw new Error("此工种使用 artifact_create 提交结构化正文，以便校验字段并关联本次运行");
        const result = await api.ontologySubmit({
          actionApiName: params.actionApiName,
          projectId,
          actor: `agent:${parentAgentId || "worker"}`,
          parameters: params.parameters || {},
          expectedHash: params.expectedHash,
          jobId,
        });
        publish({ type: "ontology_action", title: params.actionApiName });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: {},
        };
      },
    },
    {
      name: "ontology_query",
      label: "Ontology Query",
      description:
        "调用 Ontology Function：objectSet|searchAround|sliceForBible|renderObjectView|listMappedArtifactTypes。写下一集前用 sliceForBible，勿塞全文。",
      parameters: Type.Object({
        function: Type.String(),
        parameters: Type.Optional(Type.Any()),
      }),
      async execute(_toolCallId, params) {
        const result = await api.ontologyQuery({
          function: params.function,
          projectId,
          parameters: params.parameters || {},
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: {},
        };
      },
    },
    {
      name: "artifact_create",
      label: "Create artifact",
      description: knowledge ? "保存一份基于授权原文的 qc_report 候选。bodyMarkdown 按用户要求撰写，bodyJson 提交已证实内容、未知项和引文。用返回的报告 ID 运行 Schema。"
        : genreReview ? "保存本次题材参考报告，传 type、title 和非空 bodyMarkdown。已有报告先用 artifact_list 核对。"
        : manuscriptRevision ? "为本集创建一次完整 manuscript 候选，bodyJson 保留 episodeNo 和 sourceManuscript。已有候选时用 artifact_list 核对 ID 和当前版本，再用 artifact_update 修订同一个 ID。不要改标题重复创建。"
        : pitchRevision ? "仅创建一份 other 投稿候选，bodyJson.sourceIndex 原样保存。已有本次候选时用 artifact_list 核对 ID 和版本，再用 artifact_update 修订同一份。"
        : `Create a writing artifact candidate（映射类型会自动改走 ontology_action）。本任务要求的产物类型：${[...expectedArtifactTypes].join("、") || "以 SKILL 的 artifact_create 字段契约为准"}。合法 type：${ArtifactTypeSchema.options.join("|")}。优先用 ontology_action。${expectedArtifactTypes.has("scene") ? sceneBodyContract : ""}`,
      parameters: Type.Object({
        type: knowledge ? Type.Literal("qc_report") : Type.String({
          description:
            `Artifact type。本任务期望：${[...expectedArtifactTypes].join("、") || "按 SKILL 契约"}。示例：outline|episode_outline|chapter_outline|manuscript|scene|qc_report`,
        }),
        title: Type.String({ description: "Short title" }),
        bodyMarkdown: Type.String({ description: "Markdown body (required)" }),
        bodyJson: knowledge ? knowledgeReportBody : Type.Optional(Type.Any()),
      }),
      async execute(_toolCallId, params) {
        // 兼容：模型偶发把 bodyJson 传成 JSON 字符串 → 尝试解析，避免 422 返工。
        const singleManuscript = manuscriptRevision && params.type === "manuscript";
        const singlePitch = pitchRevision && params.type === "other";
        return withArtifactIdentity(knowledge ? "knowledge_report" : singleManuscript ? "manuscript" : singlePitch ? "pitch_pack" : `${params.type}:${String(params.title).trim()}`, async () => {
        let bodyJson = params.bodyJson ?? null;
        if (typeof bodyJson === "string" && bodyJson.trim()) {
          try {
            bodyJson = JSON.parse(bodyJson);
          } catch {
            bodyJson = null;
          }
        }
        if (knowledge) {
          if (params.type !== "qc_report") throw new Error("知识岗位仅可保存 qc_report");
          const report = await verifyKnowledgeReport(bodyJson);
          bodyJson = {...report, agentId:parentAgentId, roleVersion:knowledge.version};
        }
        const typedError = roleOutputError(parentAgentId, params.type, bodyJson);
        if (typedError) return {content:[{type:"text", text:JSON.stringify({ok:false, error:"invalid_business_output", message:typedError, sideEffect:false})}], details:{ok:false}};
        if (ctx.batchEpisodeNo && ["scene","manuscript"].includes(params.type)) {
          if (bodyJson?.episodeNo != null && bodyJson.episodeNo !== ctx.batchEpisodeNo)
            throw new Error("正文集号与当前子任务不同");
          bodyJson = {...bodyJson, episodeNo:ctx.batchEpisodeNo};
        }
        if (["scene", "select_score"].includes(params.type)) {
          const check = structuredOutputCheck(params.type, bodyJson);
          if (check.result !== "pass") throw new Error(check.message);
        }
        // 占位符防御：禁止「[梗概内容]」之类模板空壳入库（弱/本地模型高发）
        const placeholder = findPlaceholder(bodyJson) || findPlaceholder(params.bodyMarkdown);
        if (placeholder) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  isError: true,
                  error: "placeholder_body",
                  message: `检测到未填写的占位符「${String(placeholder).slice(0, 40)}」。请写入真实内容后重新 artifact_create，不要用模板空壳占位。`,
                  retryable: true,
                }),
              },
            ],
            details: {},
          };
        }
        if (expectedArtifactTypes.size && !expectedArtifactTypes.has(params.type)) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  isError: true,
                  error: "wrong_artifact_type",
                  message: `Done Contract 期望类型为 ${[...expectedArtifactTypes].join("、")}，拒绝创建「${params.type}」。请改用正确 type 重新 artifact_create（禁止用 other 存档正文）。`,
                  retryable: true,
                }),
              },
            ],
            details: {},
          };
        }
        if (singlePitch && !isDeepStrictEqual(bodyJson?.sourceIndex, sourceIndex)) {
          throw new Error("投稿候选的 bodyJson.sourceIndex 必须原样保留本次任务的来源索引。");
        }
        if (runId) {
          const rows = await reportRows();
          const candidates = singleManuscript ? activeRunManuscripts(rows, runId) : singlePitch ? activeRunPitch(rows) : [];
          if (candidates.length > 1) {
            return {content:[{type:"text",text:JSON.stringify({ok:false,isError:true,error:"artifact_revision_required",
              message:singlePitch ? "本次运行已有多份有效投稿产物，请主人确认保留哪份并归档其余产物。"
                : "本次运行已有多份有效正文候选，请给主人确认保留哪份并归档其余候选，再修订保留的 ID。"})}],details:{}};
          }
          const existing = singleManuscript || singlePitch ? candidates[0] : rows.find(artifact =>
            artifact.createdByRunId === runId && artifact.type === params.type &&
            (knowledge || String(artifact.title).trim() === String(params.title).trim()));
          if (existing) {
            const sameTitle = !(knowledge || singleManuscript || singlePitch) || existing.title === params.title;
            const editablePitch = singlePitch && existing.status === "candidate" && isDeepStrictEqual(existing.bodyJson?.sourceIndex, sourceIndex);
            if (existing.id && sameTitle && (!knowledge || existing.status === "candidate") && (!singlePitch || editablePitch) && existing.bodyMarkdown === params.bodyMarkdown && JSON.stringify(existing.bodyJson ?? null) === JSON.stringify(bodyJson)) {
              successfulTools.add("artifact_create");
              return {content:[{type:'text',text:JSON.stringify({...artifactReceipt(existing),reused:true})}],details:{}};
            }
            return {content:[{type:'text',text:JSON.stringify({ok:false,isError:true,error:'artifact_revision_required',
              artifactId:existing.id,expectedVersion:existing.version,
              message:knowledge ? (ownedRevision && existing.status === "candidate" && existing.bodyJson?.agentId === parentAgentId && existing.bodyJson?.roleVersion === knowledge.version
                ? "本次已保存一份报告。用 artifact_list({full:true}) 核对署名和内容，需要纠正时用 artifact_update 提交该 artifactId 和核对时的 expectedVersion；随后重新运行 Schema。"
                : "用 artifact_list 核对本次报告状态，当前候选无法修订。")
                : genreReview
                ? '本次已有同题报告。用 artifact_list 核对原文，合格时用原 artifactId 运行 Schema。仅在实质内容需要纠正时保存一份注明修正内容的报告。'
                : singlePitch && !editablePitch
                ? '本次已有投稿产物，其状态或来源索引需要主人核对。'
                : '同一任务已创建此候选。请用 artifact_update 修改该 artifactId（先读取最新版本），不要换标题重复新建。'})}],details:{}};
          }
        }
        // Clear before sending: an ambiguous response may already have committed.
        invalidateContentGates();
        const art = await api.createArtifact(
          projectId,
          buildArtifactPayload({
            runId,
            type: params.type,
            title: params.title,
            bodyMarkdown: params.bodyMarkdown,
            bodyJson,
            status: "candidate",
          }),
        );
        if (!art?.id) throw new Error("artifact_create 返回缺少持久化 artifact id，不能计为完成");
        successfulTools.add("artifact_create");
        publish({ type: "artifact", title: params.title, artifactType: params.type });
        return artifactWriteResult(art, artifactReceipt(art));
        });
      },
    },
    {
      name: "project_get",
      label: "Get project",
      description: "Fetch current project metadata",
      parameters: Type.Object({}),
      async execute() {
        const p = await api.getProject(projectId);
        return { content: [{ type: "text", text: JSON.stringify(p) }], details: {} };
      },
    },
    {
      name: "gate_run",
      label: "Run gate",
      description: [
        gateScope ? `Run a gate applicable to the current task: ${[...gateScope].join(", ")}.` : "Run a deterministic gate by name.",
        gateScope?.has("LengthDecay") && "LengthDecay measures the current run’s saved manuscript. Use payload.artifactId to identify it.",
        gateScope?.has("Schema") && "Schema: use payload.artifactId for the saved output.",
        pitchRevision && "PitchFourPack 使用 payload.counts 中的 coreHook、character、episodeOutline、manuscript。按本次 sourceIndex 核实有正文的实际来源后填写；projectId、artifactId 不会自动计数。",
        finalLogicReview && 'GraphConsistency 需要本项目当前 story_graph 的 payload.artifactId。用 artifact_list({type:"story_graph",full:false}) 查 ID，门禁读取保存的图。',
        setup && "FormatSelected uses the bound project. ChunkPolicy checks this job's wholeBook and requestedChars.",
        showGenre && "GenreTrim is optional. Use payload.genre or payload.body.genre for the explicitly chosen genre, or payload.artifactId for saved bodyJson.genre. Without a chosen genre, skip this check.",
        showGoldFinger && "GoldFingerMinimal: pass payload.artifactId or payload.body.goldFinger (explicit mechanism and limits).",
      ].filter(Boolean).join(" "),
      parameters: Type.Object({
        name: gateParameterNames.length ? Type.Union(gateParameterNames.map(name => Type.Literal(name))) : Type.String({
          description: "Gate id, e.g. LengthBand | HookPresence | Format | Chunk | Logic",
        }),
        payload: Type.Optional(
          Type.Object(
            {
              ...(!setup && !genreReview ? {
                text: Type.Optional(Type.String()),
                minChars: Type.Optional(Type.Number()),
                maxChars: Type.Optional(Type.Number()),
                projectId: Type.Optional(Type.String()),
                promptId: Type.Optional(Type.String({description:"PromptLock 已保存的模板 ID"})),
              } : {}),
              ...(!genreReview ? {format: Type.Optional(Type.String({description:"FormatSelected 以当前项目保存的格式为准，可省略"}))} : {}),
              ...(setup ? {
                wholeBook: Type.Optional(Type.Boolean()),
                requestedChars: Type.Optional(Type.Number()),
              } : {}),
              ...(!setup ? {artifactId: Type.Optional(Type.String())} : {}),
              ...(pitchRevision ? {counts: Type.Optional(Type.Object({
                coreHook: Type.Integer({minimum:0}), character: Type.Integer({minimum:0}),
                episodeOutline: Type.Integer({minimum:0}), manuscript: Type.Integer({minimum:0}),
              }))} : {}),
              ...(showGenre ? {
                genre: Type.Optional(Type.String()),
                blacklist: Type.Optional(Type.Array(Type.String(), {description:"仅供参考的匹配词"})),
              } : {}),
              ...(!setup ? {body: Type.Optional(Type.Object({
                ...(showGenre ? {genre: Type.Optional(Type.String())} : {}),
                ...(showGoldFinger ? {
                  goldFinger: Type.Optional(Type.Union([Type.String(), Type.Record(Type.String(), Type.Any())], {description:"GoldFingerMinimal: explicit mechanism and limits"})),
                  rule: Type.Optional(Type.String()),
                  rules: Type.Optional(Type.String()),
                  ruleFieldCount: Type.Optional(Type.Number()),
                } : {}),
              }, {additionalProperties:true}))} : {}),
              ...(showGoldFinger ? {
                goldFinger: Type.Optional(Type.Union([Type.String(), Type.Record(Type.String(), Type.Any())])),
                rules: Type.Optional(Type.String()),
                rule: Type.Optional(Type.String()),
              } : {}),
            },
            { additionalProperties: true },
          ),
        ),
      }),
      async execute(_toolCallId, params) {
        const payload = params.payload || {};
        const name = scout ? params.name : normalizeGateName(params.name);
        if (gateScope && !gateScope.has(name)) {
          return {content:[{type:'text',text:JSON.stringify({ok:false,error:'gate_not_applicable',
            message:`${name} 不适用于当前任务，请只执行：${[...gateScope].join(', ')}`,
            allowedGates:[...gateScope]})}],details:{ok:false}};
        }
        publish({ type: "token", text: `\n[gate] 跑 ${name}…\n` });
        // artifactId → 产物文本解析：模型常只传 artifactId，不传 text。
        // 缺 text 时按 bodyMarkdown（非空）→ bodyJson(summary/beats/梗) 组合。
        let resolvedText = String(payload.text || "");
        let resolvedArtifact;
        const isGoldFinger = name === "GoldFingerMinimal" || name === "GoldFingerMinimalGate";
        const checkSavedGraph = finalLogicReview && name === "GraphConsistency";
        if (!knowledge && name !== "FormatSelected" && name !== "LengthDecay" && (payload.artifactId || payload.artifact_id)) {
          const aid = payload.artifactId || payload.artifact_id;
          const arts = checkSavedGraph ? await api.listArtifacts(projectId, "story_graph") : await api.listArtifacts(projectId);
          const a = (arts || []).find((x) => x?.id === aid);
          if (a) {
            resolvedArtifact = a;
            const md = String(a.bodyMarkdown || "").trim();
            if (typeof a.bodyJson?.script_body === "string") {
              resolvedText = a.bodyJson.script_body;
            } else if (md) {
              resolvedText = md;
            } else {
              const bj = a.bodyJson || {};
              const beats = Array.isArray(bj.beats) ? bj.beats.join(" ") : "";
              resolvedText = [
                bj.summary,
                bj.core_hook || bj.coreHook,
                bj.titleHook || bj.title,
                bj.crisis,
                bj.cliffType,
              ]
                .filter(Boolean)
                .concat(beats ? [beats] : [])
                .join(" ");
            }
          }
        }
        let checks = [];
        if (knowledge && name === "Schema") {
          checks = [await knowledgeSchema(payload.artifactId || payload.artifact_id)];
        }
        else if (typedRole(parentAgentId) && name === "Schema") {
          const error = resolvedArtifact?.createdByRunId === runId
            ? roleOutputError(parentAgentId, resolvedArtifact.type, resolvedArtifact.bodyJson, true)
            : "payload.artifactId 必须指向本次保存的产物";
          checks = [{id:"schema",name,result:error ? "fail" : "pass",message:error || "结构已验证"}];
        }
        else if (parentAgentId === "topic.story_shell" && ["Schema", "ShellGate"].includes(name)) {
          const saved = resolvedArtifact?.type === "topic_card" && resolvedArtifact.createdByRunId === runId;
          const course = checkCourseShell(saved ? resolvedArtifact.bodyJson || {} : {}, name === "ShellGate");
          checks = [{...course, id:name === "Schema" ? "schema" : course.id, name}];
        }
        else if (name === "Schema" && Object.hasOwn(savedReviewOutputs, parentAgentId)) {
          const saved = resolvedArtifact && resolvedArtifact.createdByRunId === runId && savedReviewOutputs[parentAgentId](resolvedArtifact, ctx);
          checks = saved ? runGateBattery("Schema", {body:resolvedArtifact.bodyJson, required:payload.required})
            : [{id:"schema", name, result:"fail", message:"请用 artifactId 指向本次保存、含技能书输出字段的产物"}];
        }
        else if (parentAgentId === "kb.report_pipeline" && name === "Schema") {
          checks = [{id:"schema",name,result:(await ctx.completionScope.verifiedReports()).length >= 4 ? "pass" : "fail",message:"本次文档至少四类已保存且关联的报告"}];
        }
        else if (ctx.critic && name === "Schema") checks = [await ctx.critic.check(true)];
        else if (name === "Schema" && parentAgentId === "qc.human_qc_duanju") {
          const saved = resolvedArtifact?.createdByRunId === runId && resolvedArtifact.type === "qc_report";
          checks = [{id:"schema", name:"Schema", result:saved && validChecklist(parentAgentId, resolvedArtifact.bodyJson) ? "pass" : "fail",
            message:"Schema 需要 payload.artifactId 指向本次已保存的完整人工清单"}];
        }
        else if (name === "FormatSelected") {
          const project = projectId ? await api.getProject(projectId) : null;
          if (!project || project.id !== projectId) {
            throw new Error("FormatSelected 无法读取当前绑定项目");
          }
          const format = payload.format === undefined ? project.format : payload.format;
          const check = checkFormatSelected(format);
          if (check.result === "pass" && format !== project.format) {
            check.result = "fail";
            check.message = `参数格式 ${format} 与当前项目格式 ${project.format || "未设置"} 冲突`;
          }
          checks = [{ ...check, evidence: { source: "bound_project", projectId, format: project.format ?? null } }];
        }
        else if (name === "Schema" && (expectedArtifactTypes.has("scene") || expectedArtifactTypes.has("select_score"))) {
          const type = expectedArtifactTypes.has("scene") ? "scene" : "select_score";
          const saved = resolvedArtifact?.type === type && resolvedArtifact.createdByRunId === runId;
          checks = [structuredOutputCheck(type, saved ? resolvedArtifact.bodyJson : null)];
          if (!saved) checks[0].message = "请在 payload.artifactId 指定本次运行已保存的 " + type;
          if (saved && type === "scene") {
            checks[0].evidence = { source: "saved_scene", artifactId: resolvedArtifact.id, version: resolvedArtifact.version };
          }
        }
        else if (name === "GenreTrim" || name === "GenreTrimGate") {
          checks = runGateBattery(name, {
            genre: payload.genre ?? payload.body?.genre ?? resolvedArtifact?.bodyJson?.genre,
            blacklist: payload.blacklist,
          });
        }
        else if (name === "ChunkPolicy") {
          const check = checkChunkPolicy(payload);
          checks = [setup && ctx.setupChunk && check.result === "pass" ? checkChunkPolicy(ctx.setupChunk) : check];
        }
        else if (name === "HumanConfirm") checks = runGateBattery(name, {acked:false});
        else if (name === "LogicAck") {
          const artifacts = await api.listArtifacts(projectId);
          checks = [await currentLogicAck(artifacts)];
        }
        else if (name === "PromptLock") {
          checks = [await validatePrompt(payload)];
        } else if (name === "LengthBand") {
          checks = [
            checkLengthBand(
              resolvedText,
              Number(payload.min_chars || payload.minChars || 800),
              Number(payload.max_chars || payload.maxChars || 1200),
            ),
          ];
        } else if (checkSavedGraph) {
          checks = [checkSavedFinalStoryGraph(resolvedArtifact, projectId, payload)];
        } else if (name === "LengthDecay") {
          const { current, decay } = runId ? await readSavedBodyDecay({
            projectId, runId, agentId: parentAgentId, input: ctx.bodyInput, artifactId: payload.artifactId ?? payload.artifact_id,
            ratio: payload.ratio,
          }) : { decay: checkLengthDecay({}) };
          checks = [current ? decay : {
            ...decay,
            message: "未找到可用于本次交付核验的已保存正文。先核对本次运行是否已保存目标候选稿及其资格，并用保存时返回的候选 ID 作为 payload.artifactId。" +
              "只有本次运行从未保存该目标稿时，才用 artifact_create 保存一份完整候选稿（原文合格时可原样保存），按任务要求保留正文类型和元数据（如 episodeNo、sourceManuscript），再使用返回的 ID。" +
              "正确 ID 仍无法核验时，检查重复候选和批次资格。手填字数或正文文本不能代替已保存的交付稿。",
          }];
        } else if (name === "HookPresence" || name === "Ep1Hook") {
          const c = checkHookPresence(resolvedText, payload.hook_flag);
          checks = [
            name === "Ep1Hook"
              ? { ...c, id: "ep1_hook", name: "第一集钩子" }
              : c,
          ];
        } else {
          // Structured gates consume body, not the generic text field.
          let gatePayload = { ...payload, text: resolvedText || payload.text };
          if (!gatePayload.body && (payload.artifactId || payload.artifact_id)) {
            const aid = payload.artifactId || payload.artifact_id;
            const arts = resolvedArtifact ? [resolvedArtifact] : await api.listArtifacts(projectId).catch(() => []);
            const a = (arts || []).find((x) => x?.id === aid);
            if (a?.bodyJson && typeof a.bodyJson === "object") gatePayload.body = a.bodyJson;
          }
          if (isGoldFinger) {
            const referenced = Boolean(payload.artifactId || payload.artifact_id);
            const sourceBody = referenced ? resolvedArtifact?.bodyJson : gatePayload.body;
            const body = sourceBody && typeof sourceBody === "object" ? sourceBody : {};
            const rule = extractAbilityRule(body, referenced ? resolvedArtifact?.bodyMarkdown : payload.text,
              referenced ? {} : payload);
            gatePayload.body = { goldFinger: rule, ruleFieldCount: rule ? body.ruleFieldCount : undefined };
          }
          checks = runGateBattery(name, gatePayload);
          const unknown = checks.find(
            (c) => String(c?.message || "").includes("未知或未实现的 Gate"),
          );
          if (unknown) {
            // 未注册的 Gate：直接报错回喂模型，且不写入 gate 证据，
            // 避免幻觉 Gate 的 fail 污染 Done Contract / 造成空转。
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: false,
                    isError: true,
                    error: "unknown_gate",
                    message: `Gate「${name}」未注册。可用 Gate 见 Skill 的 gates 声明；请只运行声明过的 Gate。`,
                  }),
                },
              ],
              details: {},
            };
          }
        }
        rememberGateEvidence(checks, name);
        publish({ type: "gates", gates: checks });
        const requiredGates = (doneContract || [])
          .filter(clause => clause.type === "gate_pass")
          .flatMap(clause => clause.gates);
        const remainingRequiredGates = [];
        const failedRequiredGates = [];
        for (const gate of requiredGates) {
          const status = evaluateDoneGate(gate, gateEvidence);
          if (status !== "satisfied") remainingRequiredGates.push(gate);
          if (status === "failed") failedRequiredGates.push(gate);
        }
        const repairHint = failedRequiredGates.length
          ? `请按检查结果处理未通过的必需门禁（${failedRequiredGates.join("、")}）。`
          : "";
        const completionHint = remainingRequiredGates.length
          ? `${repairHint}通过剩余必需门禁（${remainingRequiredGates.join("、")}）后调用 done_check 核对完整契约。`
          : "没有剩余必需门禁。请调用 done_check 核对实际产物、工具执行和人工确认条款。";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ passed: allPassed(checks), checks, remainingRequiredGates, completionHint,
                ...(editorialGates.has(name) ? {advisory:true} : {}),
                ...(name === "LengthDecay" && payload.cancelOnFail ? { cancelled: [],
                  cancellationNote: "任务结束后，调度器按已验证的结果处理后续依赖。" } : {}),
              }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "prompt_validate_lock",
      label: "Validate prompt lock",
      description: "Validate canonical prompt by promptId; do not transcribe locked text. Optional lockedSystem tests an explicit edited version against the saved hash.",
      parameters: Type.Object({
        promptId: promptAuthor ? Type.String({description:"当前项目中已保存的模板 ID"}) : Type.Optional(Type.String()),
        lockedSystem: Type.Optional(Type.String()),
        lockedHash: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        const check = await validatePrompt(params);
        promptLockBlocked = check.result === "fail";
        rememberGateEvidence([check], "PromptLock");
        return {content:[{type:"text",text:JSON.stringify(check)}],details:{},...(promptLockBlocked ? {isError:true} : {})};
      },
    },
    {
      name: "usage_log",
      label: "Log usage",
      description: "Record token usage note",
      parameters: Type.Object({
        promptTokens: Type.Number(),
        completionTokens: Type.Number(),
        model: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        publish({ type: "usage", ...params });
        return { content: [{ type: "text", text: "ok" }], details: {} };
      },
    },
    {
      name: "web_search",
      label: "Web search",
      description: "Search current public web sources. Required for current/latest trends; preserve links, fetchedAt, enabled/error status. Never invent results when unavailable.",
      parameters: Type.Object({
        query: Type.String(),
      }),
      async execute(_toolCallId, params) {
        const res = await api.webSearch(params.query);
        const web = res.web || { enabled: false, source: "error", results: [],
          summary: "联网接口未返回搜索结果，当前来源未核验。" };
        return { content: [{ type: "text", text: JSON.stringify(web) }], details: {} };
      },
    },
    {
      name: "kb_search",
      label: "KB search",
      description: knowledge ? "查找授权文档中的原文。命中返回 docId、snippet 和片段起点 offset，可从片段复制引文。"
        : "Search references. sourceScope: methodology (legacy default), documents (uploaded manuscripts), tropes, all. Returns compact snippets and source positions; use kb_read to page source text. Distinct from project memory_search.",
      parameters: Type.Object({
        query: Type.String(),
        sourceScope: Type.Optional(Type.Union(KB_SOURCE_SCOPES.map((s) => Type.Literal(s)))),
        category: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Number({ minimum: 1, maximum: 40 })),
        mode: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        const res = knowledge ? await api.knowledgeSearch(runId,ctx.jobId,params.query,params.limit ?? 8,knowledge.version) : await searchKb(api, params.query, params, searchKnowledgeLocal);
        return { content: [{ type: "text", text: JSON.stringify(res) }], details: {} };
      },
    },
    {
      name: "scan_banned_phrases",
      label: "Scan banned phrases",
      description: "Review contextual style signals (advisory only). Dialogue, purposeful imagery and pacing are allowed; never treat phrase hits as proof of AI authorship or a hard rejection.",
      parameters: Type.Object({
        text: Type.String(),
      }),
      async execute(_toolCallId, params) {
        const result = await api.detectDeai(params.text);
        return {
          content: [{ type: "text", text: JSON.stringify({ ...result, passed: true, advisory: true }) }],
          details: {},
        };
      },
    },
    {
      name: "scan_length",
      label: "Scan length",
      description: "Check character length band",
      parameters: Type.Object({
        text: Type.String(),
        minChars: Type.Number(),
        maxChars: Type.Number(),
      }),
      async execute(_toolCallId, params) {
        const check = checkLengthBand(params.text || "", params.minChars, params.maxChars);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                n: codepointCount((params.text || "").trim()),
                passed: check.result === "pass",
                check,
              }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "scan_hook_present",
      label: "Scan hook",
      description:
        "Heuristic end-hook presence. 判定看文末 400 字是否含钩子信号词：悬念 / 钩子 / 下集 / 突然 / 却发现 / 未完 / ？ / ?。要让检测通过，集尾卡点文案请自然包含这些信号（如疑问、反转、悬念词），不要只写陈述句。",
      parameters: Type.Object({
        text: Type.String(),
      }),
      async execute(_toolCallId, params) {
        const check = checkHookPresence(params.text || "");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ passed: check.result === "pass", check }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "scene_triple_validate",
      label: "Validate scene triple",
      description: "逐字段验证 goal/conflict/turn，显式外层字段优先，可在 body 中提供其余字段。",
      parameters: Type.Object({
        goal: Type.Optional(Type.String()),
        conflict: Type.Optional(Type.String()),
        turn: Type.Optional(Type.String()),
        body: Type.Optional(Type.Object({goal:Type.Optional(Type.String()),conflict:Type.Optional(Type.String()),turn:Type.Optional(Type.String())},{additionalProperties:true})),
      }),
      async execute(_toolCallId, params) {
        const body = {
          ...params.body,
          goal: params.goal ?? params.body?.goal,
          conflict: params.conflict ?? params.body?.conflict,
          turn: params.turn ?? params.body?.turn,
        };
        const checks = runGateBattery("SceneTriple", { body });
        return {
          content: [{ type: "text", text: JSON.stringify({ passed: allPassed(checks), checks }) }],
          details: {},
        };
      },
    },
    {
      name: "beat20_scaffold",
      label: "Beat20 scaffold",
      description: "Scaffold empty 20-beat slots then validate completeness",
      parameters: Type.Object({
        beats: Type.Optional(Type.Array(Type.Any())),
        fillPlaceholders: Type.Optional(Type.Boolean()),
      }),
      async execute(_toolCallId, params) {
        let beats = params.beats || [];
        if (params.fillPlaceholders !== false && beats.length < 20) {
          const next = [...beats];
          while (next.length < 20) {
            next.push({
              beat: next.length + 1,
              summary: "",
              function: "",
            });
          }
          beats = next;
        }
        const checks = runGateBattery("BeatCompleteness", { beats, expect: 20 });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ beats, passed: allPassed(checks), checks }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "paywall_slots",
      label: "Paywall slots",
      description: "Validate paywall/cliff slots coverage for early episodes",
      parameters: Type.Object({
        slots: Type.Array(Type.Any()),
        minSlots: Type.Optional(Type.Number()),
      }),
      async execute(_toolCallId, params) {
        const checks = runGateBattery("PaywallCoverage", {
          slots: params.slots,
          min_slots: params.minSlots ?? 3,
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ passed: allPassed(checks), checks }) }],
          details: {},
        };
      },
    },
    {
      name: "regex_redline",
      label: "Regex redline",
      description: "Optional lexical risk evidence. Context determines meaning.",
      parameters: Type.Object({
        text: Type.String(),
      }),
      async execute(_toolCallId, params) {
        const checks = runGateBattery("RedlineHard", { text: params.text });
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, assessment: checks.some(c => c.result === "warn") ? "pending_context_review" : "no_pattern_match", checks }) }],
          details: {},
        };
      },
    },
    {
      name: "want_how_concretize",
      label: "Want-how concretize",
      description: "Validate want/how/via_what topic triple",
      parameters: Type.Object({
        want: Type.String(),
        how: Type.String(),
        via_what: Type.String(),
      }),
      async execute(_toolCallId, params) {
        const checks = runGateBattery("PayMotive", {
          body: { want: params.want, how: params.how, via_what: params.via_what },
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ passed: allPassed(checks), checks }) }],
          details: {},
        };
      },
    },
    {
      name: "trope_coverage",
      label: "Trope coverage",
      description: "可选标签统计，minHit 为参考数量",
      parameters: Type.Object({
        tropes: Type.Array(Type.String()),
        minHit: Type.Optional(Type.Number()),
      }),
      async execute(_toolCallId, params) {
        const tropes = Array.isArray(params.tropes) ? params.tropes : [];
        const minHit = Number(params.minHit ?? 3);
        const checks = runGateBattery("EightTropeCoverage", {
          tropes,
          min_hit: minHit,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ advisory:true, passed: allPassed(checks), checks, tropes }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "location_merge_suggest",
      label: "Location merge suggest",
      description: "相似地点合并建议（去空格/统一家别墅等），返回 merged 与 suggestions",
      parameters: Type.Object({
        locations: Type.Array(Type.String()),
      }),
      async execute(_toolCallId, params) {
        const CANON_RULES = [
          { re: /(别墅|豪宅|家里|家中|我家|你家|他家)/, canon: "家" },
          { re: /(客厅|起居室)/, canon: "客厅" },
          { re: /(卧室|睡房)/, canon: "卧室" },
          { re: /(公司|办公室|写字楼|职场)/, canon: "公司" },
          { re: /(咖啡|咖啡馆|咖啡厅)/, canon: "咖啡厅" },
          { re: /(餐厅|饭店|酒楼)/, canon: "餐厅" },
          { re: /(医院|诊所|病房)/, canon: "医院" },
          { re: /(学校|教室|校园)/, canon: "学校" },
          { re: /(宴会|宴会厅|大厅)/, canon: "宴会厅" },
          { re: /(街道|路边|马路)/, canon: "街道" },
        ];
        function normalize(raw) {
          let s = String(raw || "")
            .replace(/\s+/g, "")
            .replace(/[·•．.。，,、|/／]/g, "")
            .trim();
          for (const rule of CANON_RULES) {
            if (rule.re.test(s)) return rule.canon;
          }
          return s;
        }
        const locations = Array.isArray(params.locations) ? params.locations : [];
        const groups = new Map();
        for (const loc of locations) {
          const key = normalize(loc);
          if (!key) continue;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(String(loc));
        }
        const merged = [...groups.keys()];
        const suggestions = [];
        for (const [canon, aliases] of groups.entries()) {
          const uniq = [...new Set(aliases)];
          if (uniq.length > 1 || (uniq.length === 1 && normalize(uniq[0]) !== uniq[0])) {
            suggestions.push({
              to: canon,
              from: uniq,
              reason: uniq.length > 1 ? "近义/变体合并" : "归一化命名",
            });
          }
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                merged,
                suggestions,
                unique_count: merged.length,
                over_budget: merged.length > 12,
              }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "artifact_update",
      label: "Update artifact",
      description: knowledge ? "仅修订本次运行自己的候选知识报告。先核对现有内容，以明确的 expectedVersion 修改标题、正文或完整证据，随后重新运行 Schema。"
        : ctx.critic ? "按父产物提交所有所选行的 reviews，仅传 artifactId、冻结的 expectedVersion 和 reviews。"
        : pitchRevision ? "仅修订本次运行自己的投稿候选。用 artifact_list 核对 ID 和 expectedVersion；如修改 bodyJson，原样保留 sourceIndex。修改后重跑门禁。"
        : "Revise an existing artifact using expectedVersion from its latest read. A stale version is rejected; inspect the artifact before retrying. Re-run content gates after writing.",
      parameters: Type.Object({
        artifactId: Type.String(),
        expectedVersion: Type.Integer({ minimum: 1 }),
        ...(knowledge ? {
          title:Type.Optional(reportText), bodyMarkdown:Type.Optional(reportText), bodyJson:Type.Optional(knowledgeReportBody),
        } : ctx.critic ? {reviews:Type.Array(Type.Object({
          ref:Type.String(),rank:Type.Integer({minimum:1}),
          marketFit:Type.Integer({minimum:1,maximum:5}),innovation:Type.Integer({minimum:1,maximum:5}),
          motivation:Type.Integer({minimum:1,maximum:5}),opening:Type.Integer({minimum:1,maximum:5}),compliance:Type.Integer({minimum:1,maximum:5}),
          recommendation:Type.Union(["建议采用","可改后再评","淘汰"].map(value=>Type.Literal(value))),reason:Type.String()
        }))} : {
        title: Type.Optional(Type.String()),
        bodyMarkdown: Type.Optional(Type.String()),
        bodyJson: Type.Optional(Type.Any()),
        ...(!pitchRevision ? {status: Type.Optional(Type.String())} : {}),
        }),
      }, knowledge ? {additionalProperties:false} : {}),
      async execute(_toolCallId, params) {
        if (pitchRole && !pitchRevision) throw new Error("当前岗位未绑定可修订的漫剧投稿任务。");
        if (knowledge) {
          if (!ownedRevision) throw new Error("当前岗位无候选修订权限");
          const {artifactId, expectedVersion, title, bodyMarkdown, bodyJson, ...extra} = params;
          if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || Object.keys(extra).length ||
              [title, bodyMarkdown, bodyJson].every(value => value === undefined))
            throw new Error("用 artifact_list 核对版本，仅提交 expectedVersion 和需修订的报告字段");
          const edits = {title, bodyMarkdown};
          if (bodyJson !== undefined) edits.bodyJson = await verifyKnowledgeReport(bodyJson, false, true);
          if (findPlaceholder(edits)) throw new Error("请填写实际修订内容，去除占位符");
          invalidateContentGates();
          const art = await api.reviseKnowledgeReport(runId, jobId, artifactId, {
            roleVersion:knowledge.version, leaseVersion:ctx.leaseVersion ?? 0, expectedVersion, ...edits,
          });
          return artifactWriteResult(art, artifactReceipt(art));
        }
        if (ctx.critic) {
          const art=await ctx.critic.write(params);
          return artifactWriteResult(art, artifactReceipt(art));
        }
        if (pitchRevision) {
          if (Object.hasOwn(params, "status")) throw new Error("投稿岗位仅可修订候选内容，稿件状态由主人处理。");
          const own = activeRunPitch(await api.listArtifacts(projectId)).find(row => row.id === params.artifactId);
          if (!own || own.status !== "candidate" || !isDeepStrictEqual(own.bodyJson?.sourceIndex, sourceIndex)) {
            throw new Error("只能修订本次运行中来源索引一致的投稿候选。");
          }
          if (own.version !== params.expectedVersion) throw new Error("409 version_conflict：请用 artifact_list 重新核对候选版本。");
          if (Object.hasOwn(params, "bodyJson") && !isDeepStrictEqual(params.bodyJson?.sourceIndex, sourceIndex)) {
            throw new Error("修订时必须原样保留本次投稿的 bodyJson.sourceIndex。");
          }
        } else if (ctx.pipelineMember) {
          const rows = await api.listArtifacts(projectId);
          const own = (manuscriptRevision ? activeRunManuscripts(rows, runId) : rows).find(a => a.id === params.artifactId);
          if (!own || own.createdByRunId !== runId) throw new Error("本次接力只能修改本岗位创建的候选。");
          if (manuscriptRevision && params.status !== undefined) throw new Error("本岗位仅修订当前正文候选的标题或内容，稿件状态由主人处理。");
        }
        if (!Number.isInteger(params.expectedVersion) || params.expectedVersion < 1) {
          throw new Error("expectedVersion 必须是从产物读取的正整数版本号");
        }
        if (!pitchRevision && Object.hasOwn(params, "bodyJson")) {
          const current = (await api.listArtifacts(projectId)).find(a => a.id === params.artifactId);
          if (!current) throw new Error("未找到待修改的产物");
          const typedError = roleOutputError(parentAgentId, current.type, params.bodyJson);
          if (typedError) return {content:[{type:"text", text:JSON.stringify({ok:false, error:"invalid_business_output", message:typedError, sideEffect:false})}], details:{ok:false}};
          if (["scene", "select_score"].includes(current.type)) {
            const check = structuredOutputCheck(current.type, params.bodyJson);
            if (check.result !== "pass") throw new Error(check.message);
          }
        }
        invalidateContentGates();
        const art = await api.updateArtifact(projectId, params.artifactId, {
          expectedVersion: params.expectedVersion,
          title: params.title,
          bodyMarkdown: params.bodyMarkdown,
          bodyJson: params.bodyJson,
          status: params.status,
        });
        return artifactWriteResult(art, artifactReceipt(art));
      },
    },
    {
      name: "bible_read",
      label: "Read bible/memory",
      description:
        "Read project memory/bible file. Long content is paged: returns up to `limit` lines from line `offset` (0-based). If `truncated` is true, continue reading with offset=nextOffset until truncated is false. path examples: /memories/projects/{projectId}/bible/premise.md or bible/note.md under project memories.",
      parameters: Type.Object({
        path: Type.String({
          description:
            "Absolute under /memories/... or relative bible/*.md. Never omit; do not pass undefined.",
        }),
        offset: Type.Optional(Type.Number()),
        limit: Type.Optional(Type.Number()),
      }),
      async execute(_toolCallId, params) {
        if (!params.path) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  isError: true,
                  error: "missing_required",
                  field: "path",
                  example: `/memories/projects/${projectId}/bible/premise.md`,
                  next: "补齐 path 后重试 bible_read。",
                }),
              },
            ],
            details: {},
          };
        }
        const path = resolveFleetMemoryPath(params.path, fleetWorkdir, projectId);
        if (!readableMemoryPath(path, projectId, memoryOwner, true)) {
          return {content:[{type:"text",text:JSON.stringify({ok:false,isError:true,error:"memory_scope_denied",message:"只能读取当前项目共享记忆、本人私有经验和已批准的共享参考。"})}],details:{},isError:true};
        }
        try {
          const row = await api.getMemoryFile(path);
          void api.touchMemory(path);
          const content = String(row?.content || "");
          const offset = Math.max(0, Number(params.offset) || 0);
          const limit = Math.max(1, Number(params.limit) || 800);
          const sliced = sliceLines(content, offset, limit);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ...row,
                  ...memoryReadMetadata(row),
                  content: sliced.text,
                  truncated: sliced.truncated,
                  nextOffset: sliced.nextOffset,
                }),
              },
            ],
            details: {},
          };
        } catch (err) {
          const msg = String(err?.message || err);
          // 文件不存在是 observation，不是 tool_crash（Hermes：缺文件当空上下文处理）
          if (/404|not found|不存在/i.test(msg)) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: false,
                    isError: true,
                    error: "doc_not_found",
                    retryable: false,
                    path,
                    message: `记忆文件不存在：${path}`,
                    next: "改用 memory_search / memory_list / artifact_list；或 bible_write 新建后再读。禁止原样重试同一路径。",
                  }),
                },
              ],
              details: {},
            };
          }
          throw err;
        }
      },
    },
    {
      name: "bible_write",
      label: "Write bible/memory",
      description:
        "Write project memory/bible file with optimistic concurrency. For an existing file, pass expectedHash from a prior bible_read or memory_get of the exact destination path and base the update on that version. Omit expectedHash only when creating a confirmed missing file. On conflict, read the current contents and merge your changes before retrying with the hash from that read. Never adopt the latest hash automatically. Prefer memory_write / memory_merge. path must be under /memories.",
      parameters: Type.Object({
        path: Type.String({
          description: "Must be under /memories/projects/... ; e.g. bible/premise.md",
        }),
        content: Type.String(),
        expectedHash: Type.Optional(Type.String({
          description: "Required for an existing file. Use the hash returned by a prior bible_read or memory_get of the exact destination path and write against that version. Omit only when creating a confirmed missing file. On conflict, reread and merge before using the newly read hash. Never adopt the latest hash automatically.",
        })),
      }),
      async execute(_toolCallId, params) {
        const path = resolveFleetMemoryPath(params.path, fleetWorkdir, projectId);
        const out = await casPutMemory({
          path,
          content: params.content,
          projectId,
          expectedHash: params.expectedHash,
          actor: `agent:${parentAgentId || "worker"}`,
        });
        if (out.ok === true) successfulTools.add('bible_write');
        return { content: [{ type: "text", text: JSON.stringify({ ...out, path }) }], details: out };
      },
    },
    {
      name: "memory_search",
      label: "Search memory files",
      description:
        "Search YOUR project memory/bible files by keyword (matches in path + content). Returns file paths + short previews. Use for fuzzy keyword recall of 'which file talks about X'. For exact line matches of a known phrase use memory_grep; for distilled methodology use kb_search.",
      parameters: Type.Object({
        query: Type.String(),
        limit: Type.Optional(Type.Number()),
      }),
      async execute(_toolCallId, params) {
        const q = String(params.query || "");
        const limit = Math.min(30, Math.max(1, Number(params.limit) || 12));
        let rows = [];
        try {
          rows = (await api.searchMemory(q, { projectId, limit: 100 })) || [];
        } catch {
          rows = [];
        }
        const prefix = `/memories/projects/${projectId}/`;
        const filtered = (rows || [])
          .filter((r) => readableMemoryPath(r.path, projectId, memoryOwner))
          .slice(0, limit)
          .map((r) => ({
            path: r.path,
            preview: String(r.content || "").slice(0, 240),
            updatedAt: r.updated_at || r.updatedAt,
          }));
        return {
          content: [{ type: "text", text: JSON.stringify({ query: q, hits: filtered }) }],
          details: { count: filtered.length },
        };
      },
    },
    {
      name: "memory_get",
      label: "Get memory file",
      description:
        "Read one memory file by absolute path (from memory_search). Long content is paged: returns up to `limit` lines from line `offset` (0-based). If `truncated` is true, continue reading with offset=nextOffset until truncated is false.",
      parameters: Type.Object({
        path: Type.String(),
        offset: Type.Optional(Type.Number()),
        limit: Type.Optional(Type.Number()),
      }),
      async execute(_toolCallId, params) {
        const path = resolveFleetMemoryPath(params.path, fleetWorkdir, projectId);
        if (!readableMemoryPath(path, projectId, memoryOwner, true)) {
          return {content:[{type:"text",text:JSON.stringify({ok:false,isError:true,error:"memory_scope_denied",message:"只能读取当前项目共享记忆、本人私有经验和已批准的共享参考。"})}],details:{},isError:true};
        }
        try {
          const row = await api.getMemoryFile(path);
          void api.touchMemory(path);
          const content = String(row?.content || "");
          const offset = Math.max(0, Number(params.offset) || 0);
          const limit = Math.max(1, Number(params.limit) || 800);
          const sliced = sliceLines(content, offset, limit);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  path,
                  ...memoryReadMetadata(row),
                  content: sliced.text,
                  truncated: sliced.truncated,
                  nextOffset: sliced.nextOffset,
                }),
              },
            ],
            details: {},
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  isError: true,
                  error: "memory_not_found",
                  message: `${err.message || err}。下一步：用 memory_search 确认路径，或 bible_read 同路径。`,
                }),
              },
            ],
            details: {},
          };
        }
      },
    },
    {
      name: "memory_list",
      label: "List memory files",
      description:
        "List all memory files (path + short preview + frozen flag). Use to discover what memory already exists before reading or writing.",
      parameters: Type.Object({}),
      async execute() {
        let rows = [];
        try {
          rows = (await api.memoryTree({ projectId })) || [];
        } catch {
          rows = [];
        }
        const prefix = `/memories/projects/${projectId}/`;
        const files = (rows || [])
          .filter((r) => readableMemoryPath(r.path, projectId, memoryOwner))
          .slice(0,100)
          .map((r) => ({
            path: r.path,
            frozen: !!r.frozen,
            updatedAt: r.updatedAt || r.updated_at || null,
            preview: String(r.content || "").slice(0, 80),
          }));
        return {
          content: [
            { type: "text", text: JSON.stringify({ count: files.length, files }) },
          ],
          details: { count: files.length },
        };
      },
    },
    {
      name: "memory_write",
      label: "Write memory file",
      description:
        "Write memory file with content-hash CAS. Existing files require expectedHash from memory_get; omit only to create a missing file. On conflict, merge with currentContent and retry. Set isHypothesis=true for unverified guesses.",
      parameters: Type.Object({
        path: Type.String(),
        content: Type.String(),
        isHypothesis: Type.Optional(Type.Boolean()),
        expectedHash: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        const path = resolveFleetMemoryPath(params.path, fleetWorkdir, projectId);
        if (parentAgentId === "qc.bible_guard") {
          const missing = incompleteBiblePackFields(params.content);
          if (path !== `/memories/projects/${projectId}/bible_pack.md` || params.isHypothesis || missing.length) {
            const failure = {ok:false,error:"invalid_bible_pack",missing,message:"只允许保存当前项目完整 bible_pack.md"};
            return {content:[{type:"text",text:JSON.stringify(failure)}],details:failure};
          }
          if (ctx.recoveringSetup && params.expectedHash === createHash("sha256").update(params.content).digest("hex")) {
            const refusal = {ok:false,error:"bible_pack_unchanged",sideEffect:false,
              message:"交接包内容没有变化。请按当前指令核对已保存版本和门禁，只提交实质修订。"};
            return {content:[{type:"text",text:JSON.stringify(refusal)}],details:refusal};
          }
        }
        const out = await casPutMemory({
          path,
          content: params.content,
          projectId,
          expectedHash: params.expectedHash,
          isHypothesis: !!params.isHypothesis,
          actor: `agent:${parentAgentId || "worker"}`,
        });
        let biblePackWrite;
        if (parentAgentId === "qc.bible_guard" && out.ok === true &&
            path === `/memories/projects/${projectId}/bible_pack.md` && params.content.trim() && !params.isHypothesis) {
          invalidateContentGates();
          const row = out.row;
          if (row?.path === path && row.projectId === projectId && row.isHypothesis === false &&
              row.content === params.content && row.updatedAt && row.hash !== params.expectedHash &&
              row.hash === createHash("sha256").update(params.content).digest("hex")) {
            biblePackWrite = true;
          }
          if (biblePackWrite || !ctx.hasBibleWriteDependency?.()) successfulTools.add("memory_write");
          else successfulTools.delete("memory_write");
        }
        let display = out;
        if (out.ok === true && out.row && out.row.content === params.content) {
          const { content: _echo, ...row } = out.row;
          display = { ...out, row };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(display) }],
          ...(biblePackWrite ? {biblePackWrite} : {}),
          details: out,
        };
      },
    },
    {
      name: "lesson_note",
      label: "Note a private lesson",
      description:
        "Append ONE reusable lesson (technique / pitfall / what worked) to YOUR OWN private lessons file. Only you (this agent) will see it in future runs; other agents cannot. Keep it to one short sentence. Do NOT use for project facts (use bible_write / memory_write for shared facts).",
      parameters: Type.Object({
        lesson: Type.String({ description: "一句话经验，≤200 字" }),
      }),
      async execute(_toolCallId, params) {
        const agentId = memoryOwner || "worker";
        const path = lessonsPath(projectId, agentId);
        let existing = "";
        let hash = null;
        try {
          const cur = await api.getMemoryFile(path);
          existing = String(cur?.content || "");
          hash = cur?.hash ?? null;
        } catch {
          /* 首次写入 */
        }
        const merged = mergeLesson(existing, String(params.lesson || "").slice(0, 200), { agentId });
        if (!merged.changed) {
          return {
            content: [
              { type: "text", text: JSON.stringify({ ok: true, path, changed: false, reason: merged.reason }) },
            ],
            details: { changed: false },
          };
        }
        const out = await casPutMemory({
          path,
          content: merged.content,
          projectId,
          expectedHash: hash,
          actor: `agent:${agentId}`,
          changeSummary: "lesson_note",
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ ...out, path, changed: out.ok !== false }) }],
          details: out,
        };
      },
    },
    {
      name: "memory_merge",
      label: "Merge/patch memory file",
      description:
        "Exact string replace in a memory file under CAS (safer than full overwrite for foreshadow_ledger / semantic facts). Provide old→new; uses current hash automatically.",
      parameters: Type.Object({
        path: Type.String(),
        old: Type.String(),
        new: Type.String(),
        replaceAll: Type.Optional(Type.Boolean()),
        expectedHash: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        const path = resolveFleetMemoryPath(params.path, fleetWorkdir, projectId);
        let expectedHash = params.expectedHash;
        let raw = "";
        try {
          const cur = await api.getMemoryFile(path);
          raw = String(cur?.content || "");
          if (expectedHash === undefined) expectedHash = cur?.hash ?? null;
        } catch {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  isError: true,
                  error: "memory_not_found",
                  message: `文件不存在：${path}。请先 memory_write 创建。`,
                }),
              },
            ],
            details: {},
          };
        }
        const old = String(params.old || "");
        const neu = String(params.new || "");
        const count = old ? raw.split(old).length - 1 : 0;
        if (!old || count === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  isError: true,
                  error: "no_match",
                  message: "未找到匹配的 old 文本",
                  currentHash: expectedHash,
                }),
              },
            ],
            details: {},
          };
        }
        if (count > 1 && !params.replaceAll) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  isError: true,
                  error: "ambiguous",
                  message: `old 出现 ${count} 次，请提供更唯一片段或 replaceAll=true`,
                  currentHash: expectedHash,
                }),
              },
            ],
            details: {},
          };
        }
        const next = params.replaceAll ? raw.split(old).join(neu) : raw.replace(old, neu);
        const out = await casPutMemory({
          path,
          content: next,
          projectId,
          expectedHash,
          actor: `agent:${parentAgentId || "worker"}`,
          changeSummary: "memory_merge patch",
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ ...out, replaced: count }) }],
          details: out,
        };
      },
    },
    {
      name: "memory_grep",
      label: "Grep memory files",
      description:
        "Case-insensitive substring line-match across memory files, returning matching lines with line numbers. Use when you already know the exact string (proper noun, character name, exact phrase). For fuzzy recall of a vague topic use memory_search.",
      parameters: Type.Object({
        query: Type.String(),
        limit: Type.Optional(Type.Number()),
      }),
      async execute(_toolCallId, params) {
        const q = String(params.query || "");
        const limit = Math.min(20, Math.max(1, Number(params.limit) || 10));
        let rows = [];
        try {
          rows = (await api.searchMemory(q, { projectId, limit: 100 })) || [];
        } catch {
          rows = [];
        }
        const ql = q.toLowerCase();
        const files = [];
        for (const r of rows || []) {
          if (!readableMemoryPath(r.path, projectId, memoryOwner)) continue;
          const hits = [];
          const lines = String(r.content || "").split("\n");
          lines.forEach((line, i) => {
            if (ql && line.toLowerCase().includes(ql)) {
              hits.push({ line: i + 1, text: line.trim().slice(0, 200) });
            }
          });
          if (hits.length) files.push({ path: r.path, matches: hits.slice(0, 5) });
          if (files.length >= limit) break;
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ query: q, files }) }],
          details: { count: files.length },
        };
      },
    },
    {
      name: "memory_freeze",
      label: "Freeze memory file",
      description:
        "Mark a memory file as read-only (frozen). Use for finalized decisions or characters that must not change.",
      parameters: Type.Object({
        path: Type.String(),
      }),
      async execute(_toolCallId, params) {
        const path = resolveFleetMemoryPath(params.path, fleetWorkdir, projectId);
        const row = await api.freezeMemoryFile(path);
        return {
          content: [{ type: "text", text: JSON.stringify({ path, frozen: !!row.frozen }) }],
          details: {},
        };
      },
    },
    {
      name: "checklist_open",
      label: "Open checklist",
      description: proactive ? "保存 1–5 条待用户批准的任务提案。提交成功后运行 HumanConfirm 门禁。"
        : "Persist a checklist as qc_report artifact",
      parameters: Type.Object({
        title: proactive ? Type.String({pattern:"\\S"}) : Type.String(),
        items: proactive ? Type.Array(Type.Object({
          message: Type.String({pattern:"\\S", description:"说明项目缺口和批准后要执行的任务。"}),
          agentId: Type.String({pattern:"\\S", description:"可执行该任务的已注册 Agent ID。"}),
          needsApproval: Type.Literal(true, {description:"JSON 布尔值 true。"}),
          priority: Type.Union([Type.Literal("P0"), Type.Literal("P1"), Type.Literal("P2")]),
          done: Type.Optional(Type.Literal(false, {description:"待办状态，可省略。填写时使用 JSON 布尔值 false。"})),
        }), {minItems:1, maxItems:5}) : Type.Array(Type.Any()),
      }),
      async execute(_toolCallId, params) {
        const invalid = params.items.findIndex(it => it && typeof it === "object" && Object.hasOwn(it, "done") && typeof it.done !== "boolean");
        if (invalid >= 0) {
          return {content:[{type:"text",text:JSON.stringify({ok:false,error:"invalid_checklist",message:`items.${invalid}.done: expected boolean`})}],details:{ok:false}};
        }
        if (proactive) {
          const report = await api.saveProposalChecklist(projectId, runId, {title:params.title, items:params.items});
          return reportWriteResult(report, report, runId, `agent:${runId}`);
        }
        const art = await api.createArtifact(
          projectId,
          buildArtifactPayload({
            runId,
            type: "qc_report",
            title: params.title,
            bodyMarkdown: (params.items || [])
              .map((it, i) => `- [${it?.done === true ? "x" : " "}] ${it?.text || it?.title || (typeof it === "string" ? it : JSON.stringify(it))}`)
              .join("\n"),
            bodyJson: { items: params.items },
            status: "draft",
          }),
        );
        return artifactWriteResult(art);
      },
    },
    {
      name: "prompt_render",
      label: "Render prompt",
      description: "Load one current-agent prompt. Omit promptId for the active template; pack IDs resolve to this agent's template. Unknown IDs return a compact index, never all bodies.",
      parameters: Type.Object({promptId:Type.Optional(Type.String())}),
      async execute(_toolCallId, params) {
        const prompts = await loadPrompts();
        const agent = parentAgentId ? getAgent(parentAgentId) : undefined;
        const activePath = agent?.skillPath?.replace(/^skills\//, "").replace(/\/SKILL\.md$/, "");
        const active = activePath ? prompts.find(p => (p.variables || []).some(v => v.key === "_skillPath" && String(v.defaultValue || "").replace(/^skills\//, "").replace(/\/SKILL\.md$/, "") === activePath)) : undefined;
        const requested = params.promptId;
        const packFormat = requested?.startsWith("pack.") ? requested.split(".")[1] : null;
        const hit = requested && !packFormat ? prompts.find(p => p.id === requested)
          : active && (!packFormat || active.format?.includes(packFormat)) ? active : null;
        const formats = !promptAuthor && !hit && agent?.format?.includes("*") ? [(await api.getProject(projectId)).format] : agent?.format;
        const compact = prompts.filter(p => promptAuthor || !agent || p.format?.includes("*") || p.format?.some(f => formats?.includes(f)))
          .map(p => ({id:p.id,name:p.name,format:p.format,stage:p.stage}));
        const out = hit || {count:compact.length,prompts:compact,...(requested ? {error:"prompt_not_found",message:"请选择列表中的具体 promptId；不会加载无关模板全文"} : {})};
        return {content:[{type:"text",text:JSON.stringify(out)}],details:{}};
      },
    },
    {
      name: "kb_read",
      label: "KB read doc",
      description: knowledge ? "读取授权文档的一页原文。doc_id 是文档 ID，offset 是 text 的起点。需要更多上下文时可按 nextOffset 翻页。"
        : "Read KB text in bounded character pages (offset=0, limit=6000, max=12000). sourceScope=documents reads uploads; default tries methodology then uploads. Use nextOffset until null.",
      parameters: Type.Object({
        docId: Type.String(),
        sourceScope: Type.Optional(Type.Union([Type.Literal("methodology"), Type.Literal("documents")])),
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 12000 })),
      }),
      async execute(_toolCallId, params) {
        const id = String(params.docId || "").trim();
        if (!id) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  isError: true,
                  error: "invalid_args",
                  message: "docId required",
                  retryable: false,
                }),
              },
            ],
            details: {},
          };
        }
        // 1) 蒸馏 knowledge/（与 kb_search 同源）2) 用户上传 KnowledgeDoc
        const page = { offset: params.offset ?? 0, limit: params.limit ?? 6000 };
        if (knowledge) {
          if (!knowledge.documentIds.includes(id)) throw new Error("文档不在本次授权范围");
          const result = await api.knowledgePage(runId,ctx.jobId,id,page.offset,page.limit,knowledge.version);
          return {content:[{type:"text",text:JSON.stringify(result)}],details:{}};
        }
        if (params.sourceScope !== "documents") {
          try {
            const distilled = await api.getKnowledgeDoc(id, page);
            return { content: [{ type: "text", text: JSON.stringify({ ...distilled, source: "methodology" }) }], details: {} };
          } catch (err) {
            if (!/404/.test(String(err?.message || err))) throw err;
          }
        }
        try {
          const doc = await api.getKbDocText(id, page);
          return { content: [{ type: "text", text: JSON.stringify(doc) }], details: {} };
        } catch (err) {
          if (!/404/.test(String(err?.message || err))) throw err;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  isError: true,
                  error: "doc_not_found",
                  retryable: false,
                  message: `找不到文档 ${id}（蒸馏库与上传库均无）。请改用 kb_search 命中的 id/path，或依赖 skill 正文。`,
                  next: "不要原样重试 kb_read；换 kb_search 关键词，或直接基于已有 snippet / skill 继续。",
                }),
              },
            ],
            details: {},
          };
        }
      },
    },
    {
      name: "kb_write_report",
      label: "KB write report",
      description: parentAgentId === "kb.report_pipeline" ? "保存当前输入文档的独立报告并取得关联项目产物 ID。每个 reportType 单独调用。" : "Trigger or write a dissect report for a KB doc",
      parameters: Type.Object({
        docId: Type.String(),
        reportType: Type.String(),
        body: parentAgentId === "kb.report_pipeline" ? Type.Object({title:Type.String(),bodyMarkdown:Type.String()}) : Type.Optional(Type.Any()),
      }),
      async execute(_toolCallId, params) {
        if (parentAgentId !== "kb.report_pipeline") {
          const row = await api.writeKbReport(params.docId, params.reportType, params.body);
          return {content:[{type:"text",text:JSON.stringify(row)}],details:{}};
        }
        const scope = ctx.completionScope;
        if (!scope?.docId || params.docId !== scope.docId || !params.body?.bodyMarkdown?.trim() || findPlaceholder(params.body.bodyMarkdown)) {
          throw new Error("请指定本次输入的 docId，并提供 body.title 和 body.bodyMarkdown 正文");
        }
        const row = await api.writeKbReport(scope.docId, params.reportType, {...params.body, runId, projectId});
        const verified = await scope.verifiedReports();
        const artifact = verified.find(a => a.bodyJson.reportId === row.id);
        if (!artifact) throw new Error("未找到匹配本次运行的已保存报告与项目产物");
        successfulTools.add("kb_write_report");
        const delivery = {ok:true,docId:scope.docId,reportId:row.id,reportType:row.reportType,
          artifactId:artifact.id,runId,projectId,status:"completed",contentHash:row.bodyJson.contentHash};
        return reportWriteResult(artifact, delivery, runId, `agent:${parentAgentId}`);
      },
    },
    {
      name: "job_enqueue",
      label: "Enqueue job",
      description: parentAgentId === "orch.batch_writer" ? "Dispatch this run’s approved outline range. Use type autopilot.batch and an empty payload." : "Enqueue a background job",
      parameters: Type.Object({
        type: Type.String(),
        payload: Type.Optional(Type.Any()),
      }),
      async execute(_toolCallId, params) {
        if (parentAgentId === "orch.batch_writer") {
          if (params.type !== "autopilot.batch" || Object.keys(params.payload || {}).length)
            throw new Error('批次范围由本次任务确定，请使用 {"type":"autopilot.batch","payload":{}}');
          const group = await api.dispatchBatch(projectId, runId);
          if (!group.taskGroupId || !group.episodeNos?.length || group.runIds?.length !== group.episodeNos.length + 1)
            throw new Error("未取得持久化批次收据");
          successfulTools.add("job_enqueue");
          ctx.completionScope.dispatchReceipt = group;
          return {content:[{type:"text",text:JSON.stringify(group)}],details:group};
        }
        const job = await api.enqueueJob({
          type: params.type,
          payload: { ...(params.payload || {}), projectId },
          project_id: projectId,
        });
        return { content: [{ type: "text", text: JSON.stringify(job) }], details: {} };
      },
    },
    {
      name: "job_cancel",
      label: "Cancel job",
      description: "Cancel a background job",
      parameters: Type.Object({
        jobId: Type.String(),
      }),
      async execute(_toolCallId, params) {
        const job = await api.cancelJob(params.jobId);
        return { content: [{ type: "text", text: JSON.stringify(job) }], details: {} };
      },
    },
    {
      name: "clip_candidate_extract",
      label: "Clip candidates",
      description: "Extract short clip-worthy moments from scene text",
      parameters: Type.Object({
        text: Type.String(),
        limit: Type.Optional(Type.Number()),
      }),
      async execute(_toolCallId, params) {
        const text = String(params.text || "");
        const limit = Number(params.limit ?? 5);
        const sentences = text
          .split(/[。！？\n]/)
          .map((s) => s.trim())
          .filter((s) => s.length >= 8);
        const verbs = /(打|撕|摔|跪|扇|冲|砸|跪|甩|爆|反杀|掉马|揭穿|跪下|扇耳光)/;
        const scored = sentences
          .map((s) => ({
            text: s,
            score: (verbs.test(s) ? 3 : 0) + Math.min(2, Math.floor(s.length / 40)),
          }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                clip_candidates: scored.map((x, i) => ({
                  id: `clip_${i + 1}`,
                  text: x.text,
                  reason: verbs.test(x.text) ? "强动作/冲突" : "可拍信息密度",
                })),
              }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "format_scene_header",
      label: "Format scene header",
      description: "Normalize scene header fields",
      parameters: Type.Object({
        time: Type.Optional(Type.String()),
        intExt: Type.Optional(Type.String()),
        location: Type.Optional(Type.String()),
        characters: Type.Optional(Type.Array(Type.String())),
      }),
      async execute(_toolCallId, params) {
        const time = params.time || "日";
        const ie = params.intExt || "内";
        const loc = params.location || "未命名地点";
        const chars = (params.characters || []).join("、") || "待定";
        const header = `【${time}/${ie}/${loc}】人物：${chars}`;
        return { content: [{ type: "text", text: JSON.stringify({ header }) }], details: {} };
      },
    },
    {
      name: "same_loc_task_change_check",
      label: "Same-loc task change",
      description: "同地点同目标仅记入 warns，可结合新增信息复核。",
      parameters: Type.Object({
        scenes: Type.Array(Type.Any()),
      }),
      async execute(_toolCallId, params) {
        const scenes = params.scenes || [];
        const warns = [];
        for (let i = 1; i < scenes.length; i++) {
          const a = scenes[i - 1] || {};
          const b = scenes[i] || {};
          const locA = String(a.location || a.loc || "");
          const locB = String(b.location || b.loc || "");
          const taskA = String(a.task || a.goal || "");
          const taskB = String(b.task || b.goal || "");
          if (locA && locA === locB && taskA && taskA === taskB) {
            warns.push({ index: i, location: locB, message: "地点与目标相同，可结合场内新增信息审读" });
          }
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, sameTaskFlagged: warns.length > 0, warns }) }],
          details: {},
        };
      },
    },
    {
      name: "finger_simplify",
      label: "Finger simplify",
      description: "Suggest simplifying over-complex gold-finger rules",
      parameters: Type.Object({
        rules: Type.Array(Type.String()),
        maxRules: Type.Optional(Type.Number()),
      }),
      async execute(_toolCallId, params) {
        const rules = params.rules || [];
        const maxRules = Number(params.maxRules ?? 3);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                keep: rules.slice(0, maxRules),
                drop: rules.slice(maxRules),
                advice:
                  rules.length > maxRules
                    ? `规则 ${rules.length} > ${maxRules}，建议砍到核心限制`
                    : "复杂度可接受",
              }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "midpoint_locator",
      label: "Midpoint locator",
      description: "请按具体情节填写身份反转、目标升级、盟友背叛、真相半露、代价结算之一，或对应序号 1–5。",
      parameters: Type.Object({
        midpoint: Type.Union([Type.String(), Type.Integer({minimum:1,maximum:5})]),
        beatIndex: Type.Optional(Type.Number()),
      }),
      async execute(_toolCallId, params) {
        const checks = runGateBattery("MidpointPosition", {
          body: { midpoint: params.midpoint, beat: params.beatIndex },
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ passed: allPassed(checks), checks, ...(!allPassed(checks) ? {next:"请结合具体情节选身份反转、目标升级、盟友背叛、真相半露、代价结算之一，或序号 1–5。"} : {}) }) }],
          details: {},
        };
      },
    },
    {
      name: "witness_suggest",
      label: "Witness suggest",
      description: "提供四种传播模板，请结合在场人物、视线和动机选定见证人。",
      parameters: Type.Object({
        scene: Type.String(),
      }),
      async execute(_toolCallId, params) {
        const scene = String(params.scene || "");
        const suggestions = [
          "当场路人起哄扩散",
          "宿敌心腹传话到上层",
          "直播/群聊二次传播",
          "权威角色改口承认",
        ];
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                scenePreview: scene.slice(0, 80),
                suggestions,
              }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "diff_artifacts",
      label: "Diff artifacts",
      description: "Compare two artifact markdown bodies",
      parameters: Type.Object({
        leftId: Type.String(),
        rightId: Type.String(),
      }),
      async execute(_toolCallId, params) {
        const rows = await api.listArtifacts(projectId);
        const left = rows.find((r) => r.id === params.leftId);
        const right = rows.find((r) => r.id === params.rightId);
        const a = String(left?.bodyMarkdown || "");
        const b = String(right?.bodyMarkdown || "");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                leftLen: a.length,
                rightLen: b.length,
                deltaChars: b.length - a.length,
                same: a === b,
              }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "similarity_heuristic",
      label: "Similarity heuristic",
      description: "Char n-gram overlap score then SimilarityRisk gate",
      parameters: Type.Object({
        source: Type.String(),
        draft: Type.String(),
        threshold: Type.Optional(Type.Number()),
      }),
      async execute(_toolCallId, params) {
        function grams(s, n = 2) {
          const t = String(s || "").replace(/\s+/g, "");
          const set = new Set();
          for (let i = 0; i <= t.length - n; i++) set.add(t.slice(i, i + n));
          return set;
        }
        const A = grams(params.source);
        const B = grams(params.draft);
        const shared = [...A].filter(g => B.has(g));
        const inter = shared.length;
        const score = A.size && B.size ? inter / A.size : null;
        const checks = runGateBattery("SimilarityRisk", {
          score,
          threshold: params.threshold ?? 0.72,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ score, sourceBigrams:A.size, draftBigrams:B.size, sharedBigrams:inter, sample:shared.slice(0, 6), advisory:true, passed: allPassed(checks), checks }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "exchange_chain_step",
      label: "Exchange chain step",
      description: "Record next prompt chain step as artifact",
      parameters: Type.Object({
        step: Type.Number(),
        input: Type.String(),
        output: Type.String(),
      }),
      async execute(_toolCallId, params) {
        const art = await api.createArtifact(
          projectId,
          buildArtifactPayload({
            runId,
            type: "other",
            title: `交换法步骤 ${params.step}`,
            bodyMarkdown: `## 输入\n${params.input}\n\n## 输出\n${params.output}`,
            bodyJson: { step: params.step, input: params.input, output: params.output },
            status: "draft",
          }),
        );
        return artifactWriteResult(art);
      },
    },
    {
      name: "payoff_ledger",
      label: "Payoff ledger",
      description:
        "Persist foreshadow ledger under /memories/projects/{id}/foreshadow_ledger.json; plant/payoff/audit",
      parameters: Type.Object({
        action: Type.Optional(
          Type.Union([
            Type.Literal("load"),
            Type.Literal("plant"),
            Type.Literal("payoff"),
            Type.Literal("audit"),
            Type.Literal("replace"),
          ]),
        ),
        openHooks: Type.Optional(Type.Array(Type.String())),
        payoffs: Type.Optional(Type.Array(Type.String())),
        entries: Type.Optional(
          Type.Array(
            Type.Object({
              id: Type.String(),
              plantEp: Type.Optional(Type.Union([Type.String(), Type.Number()])),
              dueEp: Type.Optional(Type.Union([Type.String(), Type.Number()])),
              status: Type.Optional(Type.String()),
              text: Type.Optional(Type.String()),
              payoffEp: Type.Optional(Type.Union([Type.String(), Type.Number()])),
            }),
          ),
        ),
        currentEp: Type.Optional(Type.Union([Type.String(), Type.Number()])),
        hookText: Type.Optional(Type.String()),
        hookId: Type.Optional(Type.String()),
        dueEp: Type.Optional(Type.Union([Type.String(), Type.Number()])),
      }),
      async execute(_toolCallId, params) {
        const path = `/memories/projects/${projectId}/foreshadow_ledger.json`;
        const action = payoffLedgerAction(params);
        if (!action) throw new Error("Invalid payoff ledger action or entries");
        const num = (v) => Number(String(v ?? "").replace(/\D/g, "")) || 0;
        const cur = num(params.currentEp);

        let ledger = { schemaVersion: "foreshadow-ledger/1", entries: [] };
        let file;
        let missing = false;
        try {
          file = await api.getMemoryFile(path);
        } catch (error) {
          if (!isMemoryFileMissing(error)) throw error;
          missing = true;
        }
        if (!missing) {
          if (file?.path !== path || typeof file.content !== "string")
            throw new Error("Invalid payoff ledger row");
          ledger = JSON.parse(file.content);
          if (!Array.isArray(ledger?.entries) || ledger.entries.some(e => typeof e?.id !== "string"))
            throw new Error("Invalid payoff ledger entries");
        }

        if (action === "replace" && params.entries?.length) {
          ledger.entries = params.entries.map((e) => ({
            id: e.id,
            plantEp: num(e.plantEp) || cur || 1,
            dueEp: num(e.dueEp) || (num(e.plantEp) || cur || 1) + 5,
            text: e.text || "",
            status: e.status || "open",
            payoffEp: e.payoffEp ? num(e.payoffEp) : undefined,
          }));
        } else if (action === "plant" && (params.hookText || params.entries?.[0])) {
          const text = params.hookText || params.entries[0].text || "";
          const id = params.hookId || params.entries?.[0]?.id || `F${ledger.entries.length + 1}`;
          ledger.entries.push({
            id,
            plantEp: cur || num(params.entries?.[0]?.plantEp) || 1,
            dueEp: num(params.dueEp) || num(params.entries?.[0]?.dueEp) || (cur || 1) + 5,
            text,
            status: "open",
          });
        } else if (action === "payoff") {
          const id = params.hookId || "";
          const text = params.hookText || "";
          for (const e of ledger.entries) {
            const hit =
              (id && e.id === id) ||
              (text && (e.text.includes(text) || text.includes(e.text.slice(0, 12))));
            if (hit && e.status === "open") {
              e.status = "paid";
              e.payoffEp = cur || e.payoffEp;
            }
          }
          for (const p of params.payoffs || []) {
            for (const e of ledger.entries) {
              if (e.status === "open" && (e.text.includes(p) || p.includes(e.text.slice(0, 12)))) {
                e.status = "paid";
                e.payoffEp = cur || e.payoffEp;
              }
            }
          }
        }

        if (action !== "load" && action !== "audit") {
          const expectedHash = missing ? null : file.hash;
          if (!missing && expectedHash !== createHash("sha256").update(file.content).digest("hex"))
            throw new Error("Invalid payoff ledger content hash");
          ledger.updatedAt = new Date().toISOString();
          const content = JSON.stringify(ledger, null, 2);
          const out = await casPutMemory({
            path, content, projectId, expectedHash, sourceRunId: runId,
            actor: `agent:${parentAgentId || "worker"}`,
          });
          if (!out.ok) return { content: [{ type: "text", text: JSON.stringify(out) }], details: out };
          if (out.row?.path !== path || out.hash !== createHash("sha256").update(content).digest("hex"))
            throw Object.assign(new Error("Payoff ledger write returned no matching receipt"), { code: "mutation_result_unknown" });
        }

        const openHooks = params.openHooks || [];
        const payoffs = params.payoffs || [];
        const unpaid = openHooks.filter((h) => !payoffs.some((p) => p.includes(h) || h.includes(p)));
        const openEntries = ledger.entries.filter((e) => (e.status || "open") === "open");
        const overdue = openEntries.filter((e) => cur > 0 && e.dueEp > 0 && cur > e.dueEp);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                path,
                action,
                open: openHooks.length || openEntries.length,
                paid: ledger.entries.filter((e) => e.status === "paid").length,
                unpaid,
                entries: ledger.entries,
                openEntries: openEntries.length,
                overdue: overdue.map((e) => e.id),
                healthy: overdue.length === 0,
                beforeExtendOk: overdue.length === 0,
              }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "stage_lock",
      label: "Stage lock",
      description: "Query or ack project stage lock (can_jump / ack / advance)",
      parameters: Type.Object({
        format: Type.String(),
        currentStageId: Type.String(),
        completed: Type.Optional(Type.Array(Type.String())),
        action: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        try {
          const res = await api.stageLock({
            format: params.format,
            currentStageId: params.currentStageId,
            completed: params.completed || [],
            action: params.action || "can_jump",
          });
          return {
            content: [{ type: "text", text: JSON.stringify(res) }],
            details: {},
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: false, error: String(err.message || err) }),
              },
            ],
            details: {},
          };
        }
      },
    },
    {
      name: "table_write",
      label: "Table write",
      description: "Normalize rows into a markdown table (Charlie outline/table helper)",
      parameters: Type.Object({
        headers: Type.Array(Type.String()),
        rows: Type.Array(Type.Array(Type.String())),
      }),
      async execute(_toolCallId, params) {
        const headers = params.headers || [];
        const rows = params.rows || [];
        const line = (cells) => `| ${cells.map((c) => String(c).replace(/\|/g, "\\|")).join(" | ")} |`;
        const sep = `| ${headers.map(() => "---").join(" | ")} |`;
        const md = [line(headers), sep, ...rows.map((r) => line(r))].join("\n");
        return { content: [{ type: "text", text: md }], details: { rows: rows.length } };
      },
    },
    {
      name: "outline_table",
      label: "Outline table",
      description: "Build episode outline markdown table from episode objects",
      parameters: Type.Object({
        episodes: Type.Array(
          Type.Object({
            episodeNo: Type.Optional(Type.Number()),
            title: Type.Optional(Type.String()),
            summary: Type.Optional(Type.String()),
            thrill: Type.Optional(Type.String()),
            hook: Type.Optional(Type.String()),
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const eps = params.episodes || [];
        const headers = ["集", "标题", "摘要", "爽点", "钩子"];
        const rows = eps.map((e) => [
          String(e.episodeNo ?? ""),
          e.title || "",
          e.summary || "",
          e.thrill || "",
          e.hook || "",
        ]);
        const line = (cells) => `| ${cells.map((c) => String(c).replace(/\|/g, "\\|")).join(" | ")} |`;
        const md = [
          line(headers),
          `| ${headers.map(() => "---").join(" | ")} |`,
          ...rows.map((r) => line(r)),
        ].join("\n");
        return { content: [{ type: "text", text: md }], details: { count: eps.length } };
      },
    },
    {
      name: "cool_stack_score",
      label: "Cool stack score",
      description: getCatalogEntry("cool_stack_score").description,
      parameters: Type.Object({
        beats: Type.Array(Type.String({ description: "节拍原文，保持现有措辞。" })),
        window: Type.Optional(Type.Integer({
          minimum: 1,
          maximum: Number.MAX_SAFE_INTEGER,
          default: 5,
          description: "触发词面堆叠提示所需的最少节拍数。命中数与密度不受此值影响。",
        })),
      }),
      async execute(_toolCallId, params) {
        const { beats, window = 5 } = params ?? {};
        if (!Array.isArray(beats) || !beats.every((beat) => typeof beat === "string")) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              error: { code: "invalid_beats", message: "beats 必须是节拍原文的字符串数组。" },
            }) }],
            details: {},
          };
        }
        if (!Number.isSafeInteger(window) || window < 1) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              error: { code: "invalid_window", message: "window 必须是 1 到 9007199254740991 之间的整数。" },
            }) }],
            details: {},
          };
        }
        const signalCounts = new Map(
          ["打脸", "反杀", "装逼", "碾压", "揭穿", "逆袭", "爽"].map((signal) => [signal, 0]),
        );
        let hits = 0;
        for (const beat of beats) {
          const matched = [...signalCounts.keys()].filter((signal) => beat.includes(signal));
          if (matched.length > 0) hits += 1;
          for (const signal of matched) signalCounts.set(signal, signalCounts.get(signal) + 1);
        }
        const density = beats.length ? hits / beats.length : 0;
        const stacked = density > 0.55 && beats.length >= window;
        const matchedSignals = [...signalCounts]
          .filter(([, count]) => count > 0)
          .map(([signal, beatCount]) => ({ signal, beatCount }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: beats.some((beat) => beat.trim()) ? "ok" : "empty_input",
                measurement: "keyword_heuristic",
                advisory: true,
                semanticAssessment: "unknown",
                beatCount: beats.length,
                window,
                hits,
                density: Number(density.toFixed(2)),
                stacked,
                warn: stacked ? "关键词命中较密集，可结合节拍原文检查节奏。" : null,
                matchedSignals,
                limitations: "每个节拍最多计一次命中，匹配仅基于词面。零命中时实际爽点仍未知，命中也不能证明叙事回报、质量或市场表现。window 仅影响堆叠提示的最少节拍数。",
                nextAction: {
                  code: "review_story_and_deliver",
                  rescoreRequiresNewStoryEvidence: true,
                  message: "根据困境、反转与观众回报做判断，继续岗位交付。不要为分数改写措辞或虚构回报。仅调整 window 不构成新情节证据。",
                },
              }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "option_enumerate",
      label: "Option enumerate",
      description: "Enumerate N labeled options for human/AI choice",
      parameters: Type.Object({
        topic: Type.String(),
        options: Type.Array(Type.String()),
      }),
      async execute(_toolCallId, params) {
        const opts = (params.options || []).map((o, i) => ({ id: i + 1, text: o }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ topic: params.topic, options: opts, pickHint: "选 1 条深化" }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "speak_aloud_lint",
      label: "Speak aloud lint",
      description: "可选朗读建议：列出句长和逗号线索。",
      parameters: Type.Object({
        lines: Type.Array(Type.String()),
        maxChars: Type.Optional(Type.Number()),
      }),
      execute: speakAloud,
    },
    {
      name: "ab_pingpong_detect",
      label: "AB pingpong detect",
      description: "统计对白轮次中的 A-B-A 交替模式，仅凭交替率无法判断剧情信息增量。",
      parameters: Type.Object({
        speakers: Type.Array(Type.String(), { description: "按对白轮次传稳定的说话人标识，每轮一项，如 [甲,乙,甲,乙]。同一角色重复使用同一标识，只传角色名或 ID，省略台词正文。" }),
      }),
      async execute(_toolCallId, params) {
        const sp = params.speakers || [];
        let pingpong = 0;
        for (let i = 2; i < sp.length; i++) {
          if (sp[i] === sp[i - 2] && sp[i] !== sp[i - 1]) pingpong += 1;
        }
        const ratio = sp.length > 2 ? pingpong / (sp.length - 2) : 0;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                pingpong,
                ratio: Number(ratio.toFixed(2)),
                warn: ratio >= 0.7 ? "说话人交替率高；请结合台词内容评估信息增量" : null,
              }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "suspense_budget_check",
      label: "Suspense budget check",
      description: "withinBudget 比较开放伏笔数与预算，超出时可结合回收计划复核。",
      parameters: Type.Object({
        openHooks: Type.Array(Type.String()),
        payoffs: Type.Optional(Type.Array(Type.String())),
        maxOpen: Type.Optional(Type.Number()),
      }),
      async execute(_toolCallId, params) {
        const open = params.openHooks || [];
        const payoffs = params.payoffs || [];
        const maxOpen = params.maxOpen ?? 3;
        const withinBudget = open.length <= maxOpen;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                open: open.length,
                payoffs: payoffs.length,
                maxOpen,
                ok: true,
                withinBudget,
                message: withinBudget ? "悬念预算可接受" : `未收钩过多（${open.length}>${maxOpen}）`,
              }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "speak_aloud_hint",
      label: "Speak aloud hint",
      description: "可选朗读建议：列出句长和逗号线索。",
      parameters: Type.Object({
        lines: Type.Array(Type.String()),
        maxChars: Type.Optional(Type.Number()),
      }),
      execute: speakAloud,
    },
    {
      name: "ner_realworld",
      label: "Real-world NER scan",
      description: "hits 列出词表命中，是否涉及真实对象需结合语境复核。",
      parameters: Type.Object({
        text: Type.String(),
        extraTerms: Type.Optional(Type.Array(Type.String())),
      }),
      async execute(_toolCallId, params) {
        const text = String(params.text || "");
        const base = [
          "习近平",
          "共产党",
          "腾讯",
          "阿里巴巴",
          "字节跳动",
          "华为",
          "苹果公司",
          "特朗普",
          "拜登",
          ...(params.extraTerms || []),
        ];
        const hits = [...new Set(base.filter((t) => t && text.includes(t)))];
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                hits,
                ok: true,
                assessment: hits.length ? "pending_context_review" : "no_term_match",
                message: hits.length ? "命中专名词表，可结合引用语境复核" : "未命中常见专名表",
              }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "duration_risk_flag",
      label: "Duration risk flag",
      description: "flags 提示动作词或长度风险，实际时长未知。",
      parameters: Type.Object({
        beats: Type.Array(Type.String()),
        maxSeconds: Type.Optional(Type.Number()),
      }),
      async execute(_toolCallId, params) {
        const maxSeconds = params.maxSeconds ?? 3;
        const hot = ["爆炸", "群架", "车祸", "追杀", "坠楼", "枪战"];
        const flags = [];
        for (const [i, b] of (params.beats || []).entries()) {
          const t = String(b || "");
          if (hot.some((h) => t.includes(h)) || t.length > 80) {
            flags.push({ at: i, risk: `可能超 ${maxSeconds}s 镜头`, beat: t.slice(0, 40) });
          }
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ flags, maxSeconds, ok: true, durationAssessment: "unknown" }) }],
          details: {},
        };
      },
    },
    {
      name: "spec_pitch_validate",
      label: "Spec pitch validate",
      description: "meetsSpec 检查导语是否填写、小传及大纲数量，另列建议字数；提交依实际合同。",
      parameters: Type.Object({
        logline: Type.Optional(Type.String()),
        bioCount: Type.Optional(Type.Number()),
        outlineCount: Type.Optional(Type.Number()),
        manuscriptCount: Type.Optional(Type.Number()),
      }),
      async execute(_toolCallId, params) {
        const issues = [];
        const logline = String(params.logline || "").trim();
        if (!logline) issues.push("缺导语");
        const warnings = logline && (logline.length < 20 || logline.length > 120) ? ["导语建议 20–120 字"] : [];
        if ((params.bioCount ?? 0) < 4) issues.push("人物小传 < 4");
        if ((params.outlineCount ?? 0) < 10) issues.push("分集大纲 < 10");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: true, meetsSpec: issues.length === 0, requiredIssues: issues, warnings, issues: [...issues, ...warnings], hint: "提交仍需独立检查 PitchFourPack" }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "lapi_checklist",
      label: "LAPI checklist",
      description: "Male/female pull-apart six-dimension checklist template",
      parameters: Type.Object({
        path: Type.String(),
        filled: Type.Optional(Type.Object({})),
      }),
      async execute(_toolCallId, params) {
        const path = String(params.path || "");
        const dims =
          path.includes("女") || path.toLowerCase().includes("f")
            ? ["人设共情", "虐点密度", "拉扯节奏", "付费点", "道德审判", "结局兑现"]
            : ["金手指限制", "打脸密度", "升级循环", "对手强度", "世界观规则", "开篇钩"];
        const filled = params.filled || {};
        const rows = dims.map((d) => ({
          dim: d,
          ok: Boolean(filled[d] || filled[d.replace(/\s/g, "")]),
          note: filled[d] || "",
        }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                path,
                rows,
                ok: rows.every((r) => r.ok),
              }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "voice_diversity_score",
      label: "Voice diversity score",
      description: "maxOverlap 测量样本字面重叠，可结合台词语境复核。",
      parameters: Type.Object({
        bySpeaker: Type.Object({}, {additionalProperties:Type.Union([Type.String(),Type.Array(Type.String())]),description:"每个角色名映射到台词字符串或字符串数组"}),
      }),
      async execute(_toolCallId, params) {
        const by = params.bySpeaker || {};
        const grams = (text) => {
          const t = (Array.isArray(text) ? text.join(" ") : text).replace(/\s/g, "");
          const set = new Set();
          for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
          return set;
        };
        const entries = Object.entries(by);
        for (const [speaker, lines] of entries) {
          if (typeof lines !== "string" && !(Array.isArray(lines) && lines.every(line => typeof line === "string"))) {
            return {content:[{type:"text",text:JSON.stringify({ok:false, isError:true, error:"bySpeaker."+speaker+" 必须为台词字符串或字符串数组"})}],details:{}};
          }
        }
        let maxOverlap = 0;
        for (let i = 0; i < entries.length; i++) {
          for (let j = i + 1; j < entries.length; j++) {
            const a = grams(entries[i][1]);
            const b = grams(entries[j][1]);
            if (!a.size || !b.size) continue;
            let hit = 0;
            for (const g of a) if (b.has(g)) hit += 1;
            maxOverlap = Math.max(maxOverlap, hit / Math.min(a.size, b.size));
          }
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                maxOverlap: Number(maxOverlap.toFixed(2)),
                warn: maxOverlap >= 0.45 ? "样本存在字面重叠，请结合上下文审读" : null,
                coverage: "只测所给台词样本的相邻双字重叠，不能据此判断人设质量",
                ok: true,
              }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "info_asymmetry_tag",
      label: "Info asymmetry tag",
      description: "Tag audience vs character knowledge advantage",
      parameters: Type.Object({
        beats: Type.Array(
          Type.Object({
            text: Type.String(),
            audienceKnows: Type.Optional(Type.Boolean()),
            characterKnows: Type.Optional(Type.Boolean()),
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const tags = (params.beats || []).map((b, i) => {
          const a = b.audienceKnows !== false;
          const c = Boolean(b.characterKnows);
          let tag = "对称";
          if (a && !c) tag = "观众>";
          else if (!a && c) tag = "角色>";
          return { at: i, tag, text: String(b.text || "").slice(0, 40) };
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ tags }) }],
          details: {},
        };
      },
    },
    {
      name: "prompt_4part_build",
      label: "Prompt 4-part build",
      description: "Assemble role/task/constraints/format prompt block",
      parameters: Type.Object({
        role: Type.String(),
        task: Type.String(),
        constraints: Type.Optional(Type.Array(Type.String())),
        format: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        const cons = (params.constraints || []).map((c) => `- ${c}`).join("\n");
        const md = [
          `## 角色\n${params.role}`,
          `## 任务\n${params.task}`,
          `## 约束\n${cons || "- （无）"}`,
          `## 输出格式\n${params.format || "结构化中文"}`,
        ].join("\n\n");
        return { content: [{ type: "text", text: md }], details: {} };
      },
    },
    {
      name: "line_split_attitude_info_subtext",
      label: "Dialogue triple split",
      description: "用分隔符拆已标注的三层台词，未标注文本需结合上下文推断。",
      parameters: Type.Object({
        line: Type.String(),
      }),
      async execute(_toolCallId, params) {
        const line = String(params.line || "").trim();
        const parts = line.split(/[—–\-｜|]/).map((s) => s.trim()).filter(Boolean);
        const result = {
          attitude: parts[0] || line.slice(0, Math.min(12, line.length)),
          info: parts[1] || line,
          subtext: parts[2] || "（待补潜台词）",
          raw: line,
        };
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
      },
    },
    {
      name: "one_plus_one_suggest",
      label: "One-plus-one suggest",
      description: "pairs 给出伏笔配对，meetsExerciseTarget 仅表示是否达到练习目标。",
      parameters: Type.Object({
        openHooks: Type.Array(Type.String()),
        payoffs: Type.Optional(Type.Array(Type.String())),
      }),
      async execute(_toolCallId, params) {
        const open = params.openHooks || [];
        const payoffs = params.payoffs || [];
        const pairs = open.map((h, i) => ({
          hook: h,
          payoff: payoffs[i] || "（待设计收钩）",
          status: payoffs[i] ? "paired" : "open",
        }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                pairs,
                ok: true,
                meetsExerciseTarget: open.length >= 2 && pairs.filter((p) => p.status === "paired").length >= 1,
                hint: "悬念一加一：可选练习目标是保留两个未收钩并设计对应收束",
              }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "export_doc",
      label: "Export doc",
      description: "Bundle markdown sections into a deliverable document string",
      parameters: Type.Object({
        title: Type.String(),
        sections: Type.Array(
          Type.Object({
            heading: Type.String(),
            body: Type.String(),
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const parts = [`# ${params.title}`, ""];
        for (const s of params.sections || []) {
          parts.push(`## ${s.heading}`, s.body || "", "");
        }
        return { content: [{ type: "text", text: parts.join("\n") }], details: {} };
      },
    },
    {
      name: "hook_100word_check",
      label: "100-word hook check",
      description: "lengthWithinRange 检查指定字数范围，关键词仅作提示，人工批准另行确认。",
      parameters: Type.Object({
        text: Type.String(),
        minChars: Type.Optional(Type.Number()),
        maxChars: Type.Optional(Type.Number()),
      }),
      async execute(_toolCallId, params) {
        const text = String(params.text || "").trim();
        const minChars = params.minChars ?? 60;
        const maxChars = params.maxChars ?? 160;
        const issues = [];
        const lengthWithinRange = text.length >= minChars && text.length <= maxChars;
        if (!lengthWithinRange) {
          issues.push(`字数 ${text.length} 不在 ${minChars}-${maxChars}`);
        }
        const hasConflict = /冲突|反杀|对峙|揭穿|破产|倒计时/.test(text);
        const hasIdentity = /重生|穿越|假|隐藏|破产|继承人|系统/.test(text);
        if (!hasConflict) issues.push("未命中冲突词表，可结合情节审读");
        if (!hasIdentity) issues.push("未命中身份词表，可结合设定审读");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                chars: text.length, minChars, maxChars, lengthWithinRange,
                ok: true,
                issues,
                gate: "Logline100Ack",
              }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "decay_detect",
      label: "Decay detect",
      description: "Evaluate supplied counts for review. Queue dependencies follow the saved manuscript gate at run completion.",
      parameters: Type.Object({
        lengths: Type.Array(Type.Number()),
        minChars: Type.Optional(Type.Number()),
        ratio: Type.Optional(Type.Number()),
        cancelOnFail: Type.Optional(Type.Boolean({ description: "Compatibility flag; this diagnostic does not change job state." })),
      }),
      async execute(_toolCallId, params) {
        const lengths = params.lengths || [];
        const minChars = params.minChars ?? 800;
        const ratio = params.ratio ?? 0.7;
        const gate = checkLengthDecay({ lengths, minChars, ratio });
        const warns = [];
        for (let i = 1; i < lengths.length; i++) {
          const currentDrop = i === lengths.length - 1 && gate.result === "warn";
          if (currentDrop || (lengths[i] < lengths[i - 1] * 0.85 && lengths[i] >= lengths[i - 1] * ratio)) {
            warns.push({ at: i, from: lengths[i - 1], to: currentDrop ? Math.trunc(lengths[i]) : lengths[i] });
          }
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                warns,
                fails: gate.result === "fail" ? [{ message: gate.message }] : [],
                ok: allPassed([gate]),
                diagnostic: true,
                hardStop: false,
                gate,
                cancelled: [],
                ...(params.cancelOnFail ? { cancellationNote: "本次仅检查传入的字数。任务完成时以已保存正文核验依赖。" } : {}),
                message: gate.message,
              }),
            },
          ],
          details: {},
        };
      },
    },
    {
      name: "skill_list",
      label: "List skills",
      description:
        "List project-relevant skill paths, active skill first. Pass allFormats to browse the full catalog. Use skill_read to load a body.",
      parameters: Type.Object({
        limit: Type.Optional(Type.Number()),
        allFormats: Type.Optional(Type.Boolean()),
      }),
      async execute(_toolCallId, params) {
        const entries = listSkillIndex();
        const agent = parentAgentId && getAgent(parentAgentId);
        const format = params.allFormats ? undefined
          : ctx.bodyInput?.format || (projectId && (await api.getProject(projectId)).format);
        const text = formatSkillCatalogForPrompt(entries, params.limit ?? 60, {
          activePath: agent?.skillPath,
          format,
          fullList: true,
        });
        return { content: [{ type: "text", text }], details: { count: entries.length } };
      },
    },
    {
      name: "skill_read",
      label: "Read skill body",
      description:
        "Load full SKILL.md by relativePath or name from the skill catalog (e.g. manju/core-hook/SKILL.md). Use gate_run for gate names such as LogicAck.",
      parameters: Type.Object({
        ref: Type.Optional(
          Type.String({ description: "relativePath or skill name, e.g. manju/core-hook/SKILL.md" }),
        ),
        relativePath: Type.Optional(
          Type.String({ description: "Alias of ref for compatibility" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const ref = String(params.ref || params.relativePath || "").trim();
        const resolved = resolveSkill(ref);
        if (!resolved.ok) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  isError: true,
                  error: "skill_not_found",
                  message: resolved.message,
                  close: resolved.close.map((e) => ({
                    name: e.name,
                    relativePath: e.relativePath,
                  })),
                  retryable: true,
                  next: "用 skill_list 确认后传完整 relativePath；门禁名请用 gate_run。",
                }),
              },
            ],
            details: {},
          };
        }
        const { skill, entry } = resolved;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                name: skill.name,
                relativePath: entry.relativePath,
                description: skill.description,
                gatesNote:
                  "下列 gates 是门禁名，不是技能；请用 gate_run({name}) 执行，不要 skill_read。",
                gates: skill.gates,
                locks: skill.locks,
                body: skill.body,
              }),
            },
          ],
          details: { relativePath: entry.relativePath },
        };
      },
    },
    {
      name: "tool_search",
      label: "Search writing tools",
      description:
        "Search tools by keyword (Chinese or English). Hits are loaded into the next turn's tools list with full schemas — call them directly by name (no tool_invoke).",
      parameters: Type.Object({
        query: Type.String(),
        limit: Type.Optional(Type.Number()),
      }),
      async execute(_toolCallId, params) {
        const limit = Math.min(20, Math.max(1, Number(params.limit) || 8));
        const searchable = ctx._searchableSet || null;
        const scored = searchCatalog(params.query, { limit, searchable });
        // 附上真实 description（来自工具实现）
        const enriched = scored.map((s) => {
          const hit = lookupTool(ctx._toolIndex, s.name);
          return {
            name: s.name,
            category: s.category,
            keywords: s.keywords,
            description: hit?.description || "",
            score: s.score,
          };
        });
        const load = enriched.slice(0, 5).map((t) => t.name);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                query: params.query,
                tools: enriched,
                load,
                hint: "下一轮这些工具会进入 functions 列表（完整参数）。请直接按函数名调用，不要再用 tool_invoke。",
              }),
            },
          ],
          details: { count: enriched.length, load },
        };
      },
    },
    {
      name: "tool_schema_get",
      label: "Get tool schema (compat)",
      description:
        "Compat only: return parameter schema. Prefer tool_search then call the tool directly.",
      parameters: Type.Object({
        name: Type.String(),
      }),
      async execute(_toolCallId, params) {
        const hit = lookupTool(ctx._toolIndex, params.name);
        if (!hit) {
          const close = closestToolNames(ctx._toolNames || [], params.name, 3);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  isError: true,
                  error: "tool_not_found",
                  message: `找不到工具 ${params.name}。${
                    close.length ? `最接近：${close.join(" / ")}。` : ""
                  }下一步：tool_search 换关键词。`,
                }),
              },
            ],
            details: {},
          };
        }
        let parameters = hit.parameters || { type: "object" };
        try {
          parameters = JSON.parse(JSON.stringify(parameters));
        } catch {
          parameters = { type: "object", additionalProperties: true };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                name: hit.name,
                description: hit.description,
                parameters,
                hint: "直接调用该函数名即可；下一轮会注入完整 schema。",
              }),
            },
          ],
          details: { load: [hit.name] },
        };
      },
    },
    {
      name: "tool_invoke",
      label: "Invoke discovered tool (compat)",
      description:
        "Compat only: execute a tool by name. Prefer calling the tool directly after tool_search.",
      parameters: Type.Object({
        name: Type.String(),
        args: Type.Optional(Type.Any()),
      }),
      async execute(toolCallId, params) {
        const rawName = String(params.name || "");
        const name = normalizeToolName(rawName);
        const callable = ctx._callableSet || ctx._invokeAllowSet;
        if (callable && !callable.has(name) && !callable.has(normalizeToolName(rawName))) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  isError: true,
                  error: "tool_not_allowed",
                  message: `工具 ${name} 不可用。下一步：tool_search 找允许的工具，或换 Agent。`,
                  retryable: false,
                }),
              },
            ],
            details: {},
          };
        }
        // 优先走安全门包装后的执行器
        const gated =
          lookupTool(ctx._gatedToolIndex, name) || lookupTool(ctx._toolIndex, name);
        if (!gated?.execute) {
          const close = closestToolNames(ctx._toolNames || [], name, 3);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  isError: true,
                  error: "tool_not_found",
                  message: `无执行器：${name}。${
                    close.length ? `最接近：${close.join(" / ")}。` : ""
                  }请经 tool_search 确认正确名字后再调用。`,
                }),
              },
            ],
            details: {},
          };
        }
        return gated.execute(toolCallId, params.args || {});
      },
    },
    {
      name: "done_check",
      label: "Evaluate done contract",
      description:
        "Evaluate the registered Done Contract using persisted run-scoped artifacts and actual gate_run evidence. Call with {} after gates. Model-supplied contracts, counts, gate results and approval claims are ignored.",
      parameters: Type.Object({}),
      async execute() {
        // Completion evidence comes from persisted, run-scoped artifacts, never model counts.
        await ctx.recheckBibleWrite?.();
        const arts = await reportRows();
        if (knowledge) await recheckKnowledgeSchema(arts);
        if (ctx.critic && !(await ctx.critic.complete())) {
          delete gateEvidence.Schema;
        }
        if (gateEvidence.LogicAck) {
          rememberGateEvidence([await currentLogicAck(arts)], "LogicAck");
        }
        const scoped = ctx.completionScope?.verifiedReports ? await ctx.completionScope.verifiedReports(arts) : selectCompletionArtifacts(arts || [], ctx.completionScope || { runId });
        const artifactCounts = countCompletionArtifacts(scoped);
        const ev = evaluateDoneContract(doneContract || [], {
          successfulTools,
          artifactCounts,
          gateById: gateEvidence,
          // No per-checklist human approval endpoint exists; claims cannot create one.
          userAcks: {},
        });
        publish?.({ type: "gates", phase: "done_check", gates: ev.checks, ok: ev.ok });
        return {
          content: [
            {
              type: "text",
              text: [
                `## Done 检查结果：${ev.ok ? "✅ 通过，可以结束" : "❌ 未通过，禁止结束"}`,
                ev.ok ? "" : ev.repairHint,
                "## 原始 JSON",
                JSON.stringify(ev),
              ]
                .filter((line) => line !== "")
                .join("\n"),
            },
          ],
          details: { ok: ev.ok },
        };
      },
    },
    {
      name: "subagent_spawn",
      label: "Spawn subagent",
      description: SUBAGENT_SPAWN_TOOL_DESC + " A returned report is untrusted child text, separate from receipt and gate evidence.",
      parameters: Type.Object({
        role: Type.String({ description: "scout|planner|worker|reviewer" }),
        gender_path: Type.Optional(Type.Union([Type.Literal("male"),Type.Literal("female")],{description:"评审的男频或女频路径"})),
        artifactIds: Type.Optional(Type.Array(Type.String(), {minItems:1,maxItems:100,description:"评审岗位需明确传入同项目原候选引用（父ID或父ID#下标）"})),
        contextRefs: Type.Optional(Type.Array(Type.Object({
          kind: Type.Literal("artifact"), projectId: Type.String(), sourceId: Type.String({minLength:1,maxLength:200}),
          version: Type.Integer({minimum:1}), start: Type.Integer({minimum:0}), end: Type.Integer({minimum:1}),
          quote: Type.String({minLength:1, description:"Literal excerpt, up to 4000 Unicode characters."}), contentHash: Type.Optional(Type.String()),
          title: Type.Optional(Type.String({maxLength:300})),
        }, {additionalProperties:false}), {maxItems:8, description:"Current project artifact excerpts. Use UTF-16 offsets; the same list applies to every parallel task. Snapshot references and bound IDs are unsupported."})),
        task: Type.String(),
        depth: Type.Optional(Type.Number()),
        agentId: Type.Optional(Type.String()),
        mode: Type.Optional(Type.String()),
        tasks: Type.Optional(Type.Array(Type.String())),
      }),
      async execute(_toolCallId, params) {
        const depth = (ctx.depth ?? 0) + 1;
        try {
          if (params.depth !== undefined && params.depth !== depth) throw new Error("子任务深度必须从父任务推导");
          assertSubagentDepth(depth);
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: false, isError: true, error: "depth_exceeded", message: err.message }),
              },
            ],
            details: {},
          };
        }
        const spec = resolveSubagent(params.role);
        const childAgentId = params.agentId || spec.agentId || null;
        if (spec.role === "scout" && params.agentId !== undefined && params.agentId !== spec.agentId) {
          const error = {ok:false, isError:true, error:"incompatible_scout_agent"};
          return {content:[{type:"text", text:JSON.stringify(error)}], details:error};
        }
        if (!ctx.spawnNested) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  isError: true,
                  error: "nested_unavailable",
                  message: "spawnNested 未注入（嵌套 loop 不可用）",
                }),
              },
            ],
            details: {},
          };
        }
        const tasks = params.mode === "parallel" ? (Array.isArray(params.tasks) ? params.tasks.map(String) : []) : undefined;
        if (tasks) {
          try { assertParallelSize(tasks); }
          catch (error) {
            const failure = {ok:false, isError:true, error:"parallel_size_exceeded", message:error.message};
            return {content:[{type:"text",text:JSON.stringify(failure)}],details:{}};
          }
        }
        const invalidContext = () => {
          const failure = {ok:false, isError:true, error:"invalid_delegated_context",
            ...(tasks ? {mode:"parallel",results:[],failed:[]} : {})};
          return {content:[{type:"text",text:JSON.stringify(failure)}],details:failure};
        };
        let delegation;
        try { delegation = await ctx.bindDelegation(params.contextRefs); }
        catch { return invalidContext(); }
        const unavailable = error => error?.code === "nested_output_unavailable"
          ? {error:error.code, runId:error.runId, terminalStatus:error.terminalStatus} : {};
        const spawnOne = async (task) => {
          publish?.({ type: "subagent", role: spec.role, task, depth });
          const nested = await ctx.spawnNested({
            role: spec.role,
            agentId: childAgentId,
            delegation,
            artifactIds: params.artifactIds,
            genderPath: params.gender_path,
            task,
            depth,
            maxTurns: spec.maxTurns || 8,
            toolsAllowlist: [...(spec.toolsAllowlist || []).filter((t) => t !== "subagent_spawn"), ...(spec.role==="reviewer" && criticAgents.has(childAgentId) ? ["artifact_update"] : [])],
            securityMode: spec.role === "scout" ? "readonly" : securityMode,
          });
          if (nested?.status !== 'succeeded') {
            throw new Error(`子任务未成功：${childAgentId} ${nested?.runId || childAgentId} status=${nested?.status || 'unknown'} exit=${nested?.exitReason || 'unknown'}`);
          }
          if (nested.terminalProofRequired) {
            throw Object.assign(new Error("nested_output_unavailable"), {
              code:"nested_output_unavailable", runId:nested.runId, terminalStatus:nested.status,
            });
          }
          return {
            runId: nested.runId,
            status: nested.status,
            artifactIds: nested.artifactIds || [],
            outputVersions: nested.outputVersions ?? {},
            ...(spec.role === "scout" && nested.report ? {report:nested.report} : {}),
            role: spec.role,
            name: spec.name,
            agentId: childAgentId,
            task,
            depth,
            exitReason: nested?.exitReason,
            handoff: nested?.handoff,
            attestation: nested?.receipt?.attestation,
            gates: (nested?.gates || []).map((g) => ({ id: g.id, result: g.result, message: g.message })),
            summary: String(nested?.handoff || nested?.receipt?.narrative || "").slice(0, 4000),
          };
        };

        if (tasks) {
          const results = [];
          const failed = [];
          await Promise.all(
            tasks.map((t) =>
              spawnOne(t).then(
                (r) => {
                  results.push(r);
                },
                (err) => {
                  failed.push({ task: t, error: err?.message || String(err), ...unavailable(err) });
                },
              ),
            ),
          );
          try { await delegation.acceptResults(); }
          catch (error) {
            if (error?.code === "RUN_STEP_PERSIST_FAILED") throw error;
            return invalidContext();
          }
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: failed.length === 0, mode: "parallel", results, failed }) }],
            details: { ok: failed.length === 0, mode: "parallel", results, failed },
          };
        }

        try {
          let report;
          try { report = await spawnOne(params.task); }
          finally { await delegation.acceptResults(); }
          return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...report }) }], details: { ok: true, ...report } };
        } catch (err) {
          if (err?.code === "RUN_STEP_PERSIST_FAILED") throw err;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  isError: true,
                  error: "nested_failed",
                  ...unavailable(err),
                  message: err.message || String(err),
                }),
              },
            ],
            details: {},
          };
        }
      },
    },
  ];

  // Scope is enforced before requests and again by API traversal, including VFS links.
  const fsScope = { project_id: projectId, agent_id: memoryOwner || "worker" };
  function scopedFsPath(value, { directory = false, search = false, write = false } = {}) {
    let path = String(value || "/");
    if ([".", "./"].includes(path)) path = "/";
    if (search && path === "/") path = `/projects/${projectId}`;
    const project = `/projects/${projectId}`;
    const ancestors = ["/", "/projects", "/memories", "/memories/projects", "/memories/user"];
    const safe = !/[\\%]|(?:^|\/)\.{1,2}(?:\/|$)/.test(path);
    const allowed = safe && (
      (directory && ancestors.includes(path)) || path === project || path.startsWith(project + "/") ||
      readableMemoryPath(path, projectId, fsScope.agent_id, true) ||
      (directory && [ `/memories/projects/${projectId}`, `/memories/projects/${projectId}/procedural/${fsScope.agent_id}`, "/memories/org" ].includes(path)) ||
      ["/files", "/kb"].some(root => path === root || path.startsWith(root + "/"))
    );
    if (write && (path.startsWith("/memories/org/") || path === "/memories/user/preferences.md" || path === "/kb" || path.startsWith("/kb/"))) throw new Error("worker scope: 共享目录为只读");
    if (!allowed) throw new Error("worker scope: 路径不属于当前项目/Agent 或明确共享目录");
    return path;
  }
  // 统一虚拟文件系统（经 API /fs）
  const fsTools = [
    {
      name: "fs_ls",
      label: "FS ls",
      description: "List this project and approved shared VFS roots. Use '/' for root; '.' means root.",
      parameters: Type.Object({
        path: Type.Optional(
          Type.String({ description: "VFS path; default '/'. '.' or './' is treated as '/'." }),
        ),
      }),
      async execute(_id, params) {
        const path = scopedFsPath(params.path, { directory: true });
        const out = await api.fsLs(path, fsScope);
        return { content: [{ type: "text", text: JSON.stringify(out) }], details: {} };
      },
    },
    {
      name: "fs_read",
      label: "FS read",
      description: "Read a virtual file with line numbers",
      parameters: Type.Object({
        path: Type.String(),
        offset: Type.Optional(Type.Number()),
        limit: Type.Optional(Type.Number()),
      }),
      async execute(_id, params) {
        const out = await api.fsRead(scopedFsPath(params.path), { offset: params.offset, limit: params.limit, ...fsScope });
        return { content: [{ type: "text", text: `${out.hash ? `内容版本 hash=${out.hash}${out.readOnly ? "（只读）" : ""}\n` : ""}${out.content || out.raw || ""}` }], details: out };
      },
    },
    {
      name: "fs_write",
      label: "FS write",
      description: "Write a virtual file; /files mounted text requires expectedHash from fs_read and an explicitly writable mount.",
      parameters: Type.Object({ path: Type.String(), content: Type.String(), expectedHash: Type.Optional(Type.String()) }),
      async execute(_id, params) {
        const out = await api.fsWrite({
          path: scopedFsPath(params.path, { write: true }),
          content: params.content,
          expected_hash: params.expectedHash,
          check_cas: params.expectedHash !== undefined,
          actor: `agent:${parentAgentId || "worker"}`,
        });
        return { content: [{ type: "text", text: JSON.stringify(out) }], details: out };
      },
    },
    {
      name: "fs_edit",
      label: "FS edit",
      description: "Exact string replace in a virtual file",
      parameters: Type.Object({
        path: Type.String(),
        old: Type.String(),
        new: Type.String(),
        replace_all: Type.Optional(Type.Boolean()),
        expectedHash: Type.Optional(Type.String()),
      }),
      async execute(_id, params) {
        const out = await api.fsEdit({
          path: scopedFsPath(params.path, { write: true }),
          old: params.old,
          new: params.new,
          replace_all: !!params.replace_all,
          expected_hash: params.expectedHash,
          check_cas: params.expectedHash !== undefined,
          actor: `agent:${parentAgentId || "worker"}`,
        });
        return { content: [{ type: "text", text: JSON.stringify(out) }], details: out };
      },
    },
    {
      name: "fs_grep",
      label: "FS grep",
      description: "Regex search across virtual filesystem",
      parameters: Type.Object({
        pattern: Type.String(),
        path: Type.Optional(Type.String()),
        glob: Type.Optional(Type.String()),
      }),
      async execute(_id, params) {
        const out = await api.fsGrep({
          pattern: params.pattern,
          path: scopedFsPath(params.path, { directory: true, search: true }),
          ...fsScope,
          glob: params.glob,
        });
        return { content: [{ type: "text", text: JSON.stringify(out) }], details: out };
      },
    },
    {
      name: "fs_find",
      label: "FS find",
      description: "Find files by glob in virtual filesystem",
      parameters: Type.Object({
        path: Type.Optional(Type.String()),
        glob: Type.Optional(Type.String()),
      }),
      async execute(_id, params) {
        const out = await api.fsFind({
          path: scopedFsPath(params.path, { directory: true, search: true }),
          ...fsScope,
          glob: params.glob || "**/*",
        });
        return { content: [{ type: "text", text: JSON.stringify(out) }], details: out };
      },
    },
  ];
  tools.push(...fsTools);

  // bash：仅 AGENT_BASH_ENABLED=true 时启用；白名单命令，cwd=/workspace
  if (String(process.env.AGENT_BASH_ENABLED || "").toLowerCase() === "true") {
    tools.push({
      name: "bash",
      label: "Bash (sandboxed)",
      description:
        "Run a whitelisted shell command under /workspace (ls/cat/rg/grep/find/wc/head/tail/sed -n/pandoc/python3/git status|diff).",
      parameters: Type.Object({
        command: Type.String(),
        timeout_s: Type.Optional(Type.Number()),
      }),
      async execute(_id, params) {
        const { runBash } = await import("./bash.js");
        const out = await runBash(params.command, { timeoutS: params.timeout_s || 30 });
        publish?.({ type: "tool_call", tool: "bash", args: { command: params.command } });
        return {
          content: [{ type: "text", text: JSON.stringify(out) }],
          details: out,
        };
      },
    });
  }

  const configuredTools = proactive ? getAgent(parentAgentId).tools : (allowlist || []);
  const agentAllow = configuredTools.map((n) => String(n).replace(/\./g, "_"))
    .filter(name => !(knowledge || pitchRole) || name !== "artifact_update");
  if (knowledge) agentAllow.push("artifact_list");
  if (ownedRevision || manuscriptRevision || pitchRevision) agentAllow.push("artifact_update");
  const { searchable, callable, allow } = resolveToolAccess({
    allowlist: agentAllow,
    securityMode,
  });
  // nested 写权限只取显式 allowlist；core 可见性不能赋予 scout 写权限。
  if (allowlist?.length && (ctx.nestedStrictAllowlist || ["orch.batch_writer","kb.report_pipeline"].includes(parentAgentId))) {
    const strict = new Set(agentAllow);
    for (const n of [...searchable]) {
      if (!strict.has(n) && getCatalogRisk(n) === "write") searchable.delete(n);
    }
    for (const n of [...callable]) {
      if (!strict.has(n) && getCatalogRisk(n) === "write") callable.delete(n);
    }
  }
  if (scopedRole) {
    const scoped = new Set(scout ? resolveSubagent("scout").toolsAllowlist.filter(name => agentAllow.includes(name)) : knowledge ? agentAllow : ["gate_run", "done_check", "skill_read", "tool_search"]);
    if (proactive) for (const name of agentAllow) scoped.add(name);
    if (setup) scoped.add("project_get");
    if (genreReview || ctx.recoveringSetup) scoped.add("artifact_list");
    if (genreReview) scoped.add("artifact_create");
    for (const names of [searchable, callable]) {
      for (const name of names) if (!scoped.has(name)) names.delete(name);
    }
    // Legacy discovery and dispatch use the same scoped index and permissions.
    if (proactive) {
      callable.add("tool_schema_get");
      callable.add("tool_invoke");
    }
  }
  if (ctx.pipelineMember) {
    const forbidden = ["subagent_spawn", "job_cancel", "ontology_action"];
    if (parentAgentId !== "orch.batch_writer") forbidden.push("job_enqueue");
    for (const name of forbidden) {
      searchable.delete(name);
      callable.delete(name);
    }
  }
  if (blockSpawn) {
    searchable.delete("subagent_spawn");
    callable.delete("subagent_spawn");
  }
  const catalog = scopedRole ? tools.filter(tool => searchable.has(tool.name)) : tools;
  ctx._allToolsCatalog = catalog;
  ctx._toolIndex = buildToolIndex(catalog);
  ctx._toolNames = catalog.map(tool => tool.name);
  ctx._searchableSet = searchable;
  ctx._callableSet = callable;
  ctx._invokeAllowSet = callable;
  ctx._agentAllowSet = allow;

  // 初始可见：core + agent allowlist（不含 schema_get/invoke；它们仅兼容分发）
  const HIDDEN_META = new Set(["tool_schema_get", "tool_invoke"]);
  const initialVisibleNames = new Set([
    ...CORE_TOOL_NAMES,
    ...agentAllow.filter((n) => callable.has(n)),
  ]);
  if (!blockSpawn && allow.has("subagent_spawn")) initialVisibleNames.add("subagent_spawn");
  // project_get / skill_list 常用只读：若在 callable 中可进初始面（减小空转）
  for (const extra of ["project_get", "skill_list", "memory_get", "fs_ls", "fs_read"]) {
    if (callable.has(extra)) initialVisibleNames.add(extra);
  }

  // 安全门包装：ask → API 审批（限时等待，超时拒绝）
  const askRunId = runId || ctx.run?.id || null;
  const waitForApproval = async (toolName, args, reason) => {
    if (!askRunId) return false;
    const timeoutMs = Number(process.env.AGENT_SECURITY_ASK_TIMEOUT_MS || 90000);
    try {
      const created = await api.createSecurityAsk(askRunId, {
        tool: toolName,
        args: args || {},
        reason: reason || "",
        timeout_s: Math.ceil(timeoutMs / 1000),
      });
      const askId = created?.askId;
      if (!askId) return false;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 2000));
        ctx.signal?.throwIfAborted();
        const st = await api.getSecurityAsk(askRunId, askId).catch(() => null);
        if (!st) continue;
        if (st.status === "approved") return true;
        if (st.status === "denied") return false;
      }
      await api.respondSecurityAsk(askRunId, askId, false, "timeout").catch(() => {});
      return false;
    } catch {
      ctx.signal?.throwIfAborted();
      return false;
    }
  };

  // Approval may arrive long after the native dispatch was admitted. Check
  // outside the approval transport catch before the gate invokes the operation.
  const onAsk = async (...args) => {
    if (!await waitForApproval(...args)) return false;
    await ctx.checkAdmission?.();
    ctx.signal?.throwIfAborted();
    return true;
  };

  // 全量 gated 索引（含 deferred），供自动路由与 tool_invoke 兼容路径
  const allGated = (proactive || scout ? tools.filter(tool => callable.has(tool.name)) : knowledge ? catalog : tools).map((t) => ({
    ...t,
    execute: withSecurityGate(t, securityPolicy, onAsk),
    _security: { gateToolCall, policy: securityPolicy },
  }));
  ctx._gatedToolIndex = buildToolIndex(allGated);

  const visible = allGated.filter(
    (t) =>
      initialVisibleNames.has(t.name) &&
      callable.has(t.name) &&
      !HIDDEN_META.has(t.name) &&
      !(blockSpawn && t.name === "subagent_spawn"),
  );
  visible._catalogNames = ctx._toolNames;
  visible._pipelineSetup = setup;
  visible._scopedRole = scopedRole;
  visible._allGated = allGated;
  visible._callableSet = callable;
  visible._searchableSet = searchable;
  visible._initialVisibleNames = scopedRole ? visible.map(tool => tool.name) : [...initialVisibleNames];
  visible._ctx = ctx;
  if (knowledge) visible._recheckKnowledgeSchema = recheckKnowledgeSchema;
  if (parentAgentId === "qc.bible_guard") visible._invalidateBibleWrite = () => {
    invalidateContentGates();
    successfulTools.delete("memory_write");
    successfulTools.delete("done_check");
  };
  visible._gateEvidence = gateEvidence;
  visible._successfulTools = successfulTools;
  return visible;
}

function getCatalogRisk(name) {
  return getCatalogEntry(name)?.risk || "read";
}

async function speakAloud(_toolCallId, params) {
  const maxChars = params.maxChars ?? 40;
  if (!Array.isArray(params.lines) || !params.lines.every(line => typeof line === "string") || !Number.isFinite(maxChars) || maxChars < 0) throw new TypeError("Expected lines and a nonnegative maxChars");
  const issues = [];
  for (const [i, line] of (params.lines || []).entries()) {
    const t = String(line || "");
    if (t.length > maxChars) issues.push({ at: i, reason: "过长", len: t.length });
    if ((t.match(/[，,]/g) || []).length >= 4) issues.push({ at: i, reason: "逗号过多" });
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: true, qualityAdvisory: issues.length > 0, maxChars, issues }) }],
    details: {},
  };
}
