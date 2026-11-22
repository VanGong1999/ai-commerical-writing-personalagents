/**
 * 漫剧/长篇正文生命周期钩子（命令式，不靠 LLM 自觉）。
 * - 开写前：确保 bible_pack 注入包存在（含图切片 / 近 N 集状态 / 完整伏笔台账）
 * - 写完后：LengthDecay 硬停；写 journal；同步 episode/story graph + GraphConsistency
 */
import { checkSavedScene, checkLengthDecay, allPassed, manuscriptLength, sceneScriptLength, SCENE_SCRIPT_MIN_CHARS } from "@xiezuomanju/agent-runtime";
import { isActiveCompletionArtifact } from "./completionArtifacts.js";
import { api } from "./apiClient.js";
import { readProjectBible } from "./bibleMemory.js";
import { bibleGraphSlice, extractManuscriptHookText, syncGraphsAfterBody } from "./storyGraphLifecycle.js";

const BODY_AGENTS = new Set([
  "prose.episode_body",
  "prose.novel_body",
  "prose.length_decay_fix",
  "prose.qa_correct",
]);

const PRE_BODY_AGENTS = new Set([
  "prose.episode_body",
  "prose.novel_body",
]);

/** duanju 场级正文由 scene.* 家族产出（scene.triple/triangle/opening7/…），属正文生命周期。 */
function isBodyAgent(agentId) {
  const id = String(agentId || "");
  return BODY_AGENTS.has(id) || id.startsWith("scene.");
}

function isPreBodyAgent(agentId) {
  const id = String(agentId || "");
  return PRE_BODY_AGENTS.has(id) || id.startsWith("scene.");
}

/** duanju 正文落库为 `scene`，其余格式为 `manuscript`。 */
function bodyTypeFor(format) {
  return format === "duanju" ? "scene" : "manuscript";
}

function episodeNo(art) {
  const body = art?.bodyJson || {};
  const n = Number(body.episodeNo ?? body.episode_no ?? body.chapterNo ?? 0);
  if (n > 0) return n;
  // duanju scene：scene_header "1|客厅|内|日" 的首位数字为集号
  const header = String(body.scene_header || body.sceneHeader || "");
  const m = header.match(/^(\d+)/);
  return m ? Number(m[1]) : 0;
}

function journalPath(projectId, ep) {
  const pad = String(ep || "latest").padStart(3, "0");
  return `/memories/projects/${projectId}/journal/ch-${pad}.md`;
}

function biblePackPath(projectId) {
  return `/memories/projects/${projectId}/bible_pack.md`;
}

function parseEpOrCh(epOrCh) {
  if (typeof epOrCh === "number" && Number.isFinite(epOrCh)) return epOrCh;
  const n = Number(String(epOrCh || "").replace(/\D/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 开写正文前：组装/校验 bible 注入包。缺 bible 则抛错阻断。
 */
export async function ensureBiblePack({ projectId, epOrCh, publish }) {
  const currentEp = parseEpOrCh(epOrCh);

  const [cast, world, decisions, arts, graphPack] = await Promise.all([
    readProjectBible(projectId, "characters.md"),
    readProjectBible(projectId, "world.md"),
    readProjectBible(projectId, "decisions.md"),
    api.listArtifacts(projectId, "character").catch(() => []),
    bibleGraphSlice(projectId, currentEp || 1).catch(() => ({
      graphSlice: "（尚无 story_graph）",
      foreshadowText: "- （无登记开放伏笔）",
      openCount: 0,
      recentStatesText: "- （无近集状态快照）",
      recentJournalsText: "（无近集 journal）",
      worldText: "",
      issues: [],
    })),
  ]);

  const castText =
    cast?.content ||
    cast?.body ||
    (arts || [])
      .map((a) => a.bodyMarkdown || "")
      .filter(Boolean)
      .join("\n\n");

  if (!String(castText || "").trim()) {
    const msg = "BibleGuard：缺少人设 bible/人物小传，禁止开写正文。请先完成 S3_BIO 并确认。";
    publish?.({ type: "gates", phase: "bible_pre", gates: [{ id: "bible_guard", result: "fail", message: msg }] });
    throw new Error(msg);
  }

  let lastSummary = "";
  const prevEp = currentEp > 0 ? currentEp - 1 : 0;
  if (prevEp > 0) {
    const prev = await api.getMemoryFile(journalPath(projectId, prevEp)).catch(() => null);
    lastSummary = prev?.content || prev?.body || "";
  }

  const pack = [
    `# bible_pack · ${epOrCh || "next"}`,
    "",
    "## locked_cast",
    String(castText).slice(0, 4000),
    "",
    "## gold_finger_limits",
    String(world?.content || world?.body || "（未写入 world.md，以核心梗限制为准）").slice(0, 2000),
    "",
    "## decisions",
    String(decisions?.content || decisions?.body || "（无）").slice(0, 1500),
    "",
    "## last_summary",
    lastSummary.trim() || "（首集/首章，无上集摘要）",
    "",
    "## recent_journals",
    graphPack.recentJournalsText || "（无近集 journal）",
    "",
    "## story_graph_slice",
    graphPack.graphSlice || "（尚无 story_graph）",
    "",
    "## recent_character_states",
    graphPack.recentStatesText || "- （无近集状态快照）",
    "",
    "## open_foreshadows",
    graphPack.foreshadowText || "- （无登记开放伏笔）",
    "",
    "ready_for_body: true",
  ].join("\n");

  await api.putMemoryFile({
    path: biblePackPath(projectId),
    content: pack,
    project_id: projectId,
    projectId,
  });

  publish?.({
    type: "token",
    text: `[bible_guard] 已注入 bible_pack（上集摘要 ${lastSummary ? "有" : "无"}，开放伏笔 ${graphPack.openCount || 0}，图切片 ${graphPack.graphSlice?.includes("尚无") ? "无" : "有"}）\n`,
  });

  return {
    path: biblePackPath(projectId),
    openHooks: graphPack.openCount || 0,
    graphIssues: graphPack.issues || [],
  };
}

// Gate tools and final receipts must evaluate the same stored edition.
export async function readSavedBodyDecay(scope) {
  const rows = await api.listArtifacts(scope.projectId, bodyTypeFor(scope.input?.format));
  return measureSavedBodyDecay(rows, scope);
}

function measureSavedBodyDecay(rows, { projectId, runId, agentId, input = {}, artifactId, ratio }) {
  const type = bodyTypeFor(input.format);
  const manuscripts = rows.filter(a => (!a.type || a.type === type) && (!a.projectId || a.projectId === projectId));
  const owner = a => a.createdByRunId ?? a.created_by_run_id;
  const targetEpisode = parseEpOrCh(input.episodeNo ?? input.ep_no ?? input.chapterNo);
  const slots = input.taskGroupId && Array.isArray(input.batchBodySlots) ? input.batchBodySlots : null;
  let series = [];
  let invalidBatch = false;
  if (slots) {
    for (const slot of slots) {
      const matches = manuscripts.filter(a => owner(a) === slot.runId && episodeNo(a) === slot.episodeNo);
      if (matches.length !== 1 || !isActiveCompletionArtifact(matches[0])) {
        invalidBatch = true;
        break;
      }
      series.push(matches[0]);
    }
    const last = series.at(-1);
    if (!last || (runId && owner(last) !== runId) || (targetEpisode && episodeNo(last) !== targetEpisode)) invalidBatch = true;
    if (invalidBatch) series = [];
  } else {
    const active = manuscripts.filter(isActiveCompletionArtifact).sort((a, b) => episodeNo(a) - episodeNo(b));
    const candidates = active.filter(a => !targetEpisode || episodeNo(a) === targetEpisode);
    const owned = candidates.filter(a => runId && owner(a) === runId);
    const eligible = owned.length ? owned : candidates.filter(a => input.reuseArtifactIds?.includes(a.id));
    const current = runId ? (eligible.length === 1 ? eligible[0] : undefined) : candidates.at(-1);
    if (current) series = [...active.filter(a => episodeNo(a) < episodeNo(current)), current];
  }
  if (artifactId != null && artifactId !== series.at(-1)?.id) series = [];
  const standaloneScene = type === "scene" && agentId?.startsWith("scene.") && !slots;
  const defaultMin = standaloneScene ? SCENE_SCRIPT_MIN_CHARS : 800;
  const lengths = standaloneScene ? series.map(a => sceneScriptLength(a.bodyJson)) : series.map(manuscriptLength);
  const configuredMin = Number(input.minChars ?? input.min_chars ?? input.wordTarget?.min ?? defaultMin);
  const current = series.at(-1);
  const decay = checkMeasuredDecay(lengths, {
    artifactId: current?.id,
    version: current?.version,
    minChars: Number.isFinite(configuredMin) && configuredMin >= 0 ? configuredMin : defaultMin,
    ratio: Number(input.ratio ?? ratio ?? 0.7),
  });
  return { current, lengths, decay, invalidBatch };
}

function checkMeasuredDecay(lengths, evidence) {
  const gate = checkLengthDecay({
    currentChars: lengths.at(-1),
    prevChars: lengths.at(-2),
    minChars: evidence.minChars,
    ratio: evidence.ratio,
  });
  return evidence.artifactId ? { ...gate, evidence } : gate;
}

function bodyLifecycleResult({ decay, lengths, invalidBatch }, graphSync) {
  return {
    decay,
    lengths,
    graphSync,
    cancelled: [],
    hardStop: invalidBatch || decay.result === "fail",
    passed: allPassed(graphSync?.gate ? [decay, graphSync.gate] : [decay]),
  };
}

export function finalBodyLifecycle(post, artifacts, scope) {
  if (!post?.decay) return post;
  const type = bodyTypeFor(scope.input?.format);
  const measurement = measureSavedBodyDecay(artifacts.filter(a => a.type === type), scope);
  return bodyLifecycleResult(measurement, post.graphSync);
}

// Refresh only evidence recorded by the gate tool. A post hook cannot prove that a required tool ran.
export function finalBodyGateEvidence(prior = {}, post, artifacts, { runId, projectId }) {
  if (!post?.decay) return prior;
  const evidence = { ...prior };
  const boundDecay = prior.length_decay;
  if (boundDecay) {
    const decay = post.decay;
    const sameArtifact = boundDecay.evidence?.artifactId && boundDecay.evidence.artifactId === decay.evidence?.artifactId;
    let verified = decay;
    if (sameArtifact) {
      verified = checkMeasuredDecay(post.lengths, {
        ...decay.evidence,
        ratio: boundDecay.evidence.ratio ?? decay.evidence.ratio,
      });
    } else if (decay.result !== "inconclusive") {
      verified = { id: decay.id, name: decay.name, result: "inconclusive", message: "LengthDecay 尚未核验本次交付的正文" };
    }
    replaceCheck(verified, "LengthDecay");
  }
  const sceneBinding = prior.Schema?.evidence;
  if (sceneBinding?.source === "saved_scene") {
    const scene = artifacts.find(a => a.id === sceneBinding.artifactId && a.createdByRunId === runId &&
      (!a.projectId || a.projectId === projectId) && a.type === "scene" && isActiveCompletionArtifact(a));
    const verified = checkSavedScene(scene?.bodyJson);
    if (scene) verified.evidence = { ...sceneBinding, version: scene.version };
    replaceCheck(verified, "Schema");
  }
  return evidence;

  function replaceCheck(verified, alias) {
    for (const [key, old] of Object.entries(evidence)) {
      if (old.id === verified.id || old.id === alias) {
        evidence[key] = { ...verified, id: old.id, name: old.name };
      }
    }
  }
}

/** Write the measured post-body gate, chapter journal and continuity graph. */
export async function afterBodyLifecycle({ projectId, agentId, runId, input = {}, publish }) {
  if (!isBodyAgent(agentId)) return { skipped: true };
  const measurement = await readSavedBodyDecay({ projectId, runId, agentId, input });
  const { current: last, lengths, decay, invalidBatch } = measurement;
  if (invalidBatch) throw new Error("批次正文缺失、重复或集号不符，停止后续任务");

  publish?.({ type: "gates", phase: "post_body", gates: [decay] });

  if (decay.result === "fail") {
    publish?.({
      type: "token",
      text: `[LengthDecay] 硬停：${decay.message}\n`,
    });
  }

  const ep = episodeNo(last) || Number(input.ep_no || input.episodeNo || lengths.length) || 0;
  let graphSync = null;
  if (last && ep > 0) {
    await writeChapterJournal({ projectId, artifact: last, ep, chars: lengths.at(-1), publish });
    const settings = await api.getAppSettings();
    const toggles = settings?.featureToggles || {};
    const graphOn = toggles.storyGraphAutoUpdate !== false;
    const foreshadowOn = toggles.foreshadowAutoUpdate !== false;
    if (!graphOn && !foreshadowOn) {
      publish?.({
        type: "token",
        text: "[story_graph] 连续性图/伏笔台账自动更新已在设置中关闭，跳过\n",
      });
      graphSync = { skippedByToggle: true };
    } else {
      graphSync = await syncGraphsAfterBody({
        projectId,
        artifact: last,
        ep,
        publish,
        mergeGraph: graphOn,
        mergeForeshadow: foreshadowOn,
      }).catch((err) => {
        publish?.({ type: "token", text: `[story_graph] 同步失败：${err.message}\n` });
        return { error: err.message };
      });
    }
  }

  return bodyLifecycleResult(measurement, graphSync);
}

async function writeChapterJournal({ projectId, artifact, ep, chars, publish }) {
  const body = artifact.bodyJson || {};
  const md = artifact.bodyMarkdown || "";
  const states = Array.isArray(body.characterStates)
    ? body.characterStates
        .map(
          (s) =>
            `- ${s.name || s.characterId}: @${s.location || "?"} / ${s.powerLevel || "-"} / ${s.emotion || "-"}`,
        )
        .join("\n")
    : "- （待 episode_graph / 正文 Agent 补全）";

  const summary = [
    `# ch-${String(ep).padStart(3, "0")} / EP${String(ep).padStart(2, "0")} handoff`,
    "",
    "## 事实摘要",
    String(body.summary || body.script_body || md.slice(0, 280) || "（无正文）").trim().slice(0, 400),
    "",
    "## 字数",
    String(chars),
    "",
    "## 人物状态",
    states,
    "",
    "## 集尾钩子",
    extractManuscriptHookText(artifact, body.clip_candidate) || "（未标注）",
    "",
    "## 开放伏笔",
    body.openHooks
      ? (Array.isArray(body.openHooks) ? body.openHooks : [body.openHooks]).map((h) => `- ${h}`).join("\n")
      : "- （见 foreshadow_ledger.json）",
    "",
    "## 金手指进度",
    String(body.goldFingerProgress || "（未变 / 见 bible）"),
    "",
  ].join("\n");

  await api.putMemoryFile({
    path: journalPath(projectId, ep),
    content: summary,
    project_id: projectId,
    projectId,
  });
  publish?.({
    type: "token",
    text: `[chapter_summary] 已写入 ${journalPath(projectId, ep)}\n`,
  });
}

export async function runLifecycleHooks({ agentId, projectId, jobId, input, publish }) {
  const result = { pre: null, post: null };
  if (isPreBodyAgent(agentId)) {
    result.pre = await ensureBiblePack({
      projectId,
      epOrCh: input?.ep_no || input?.episodeNo || input?.episode_range || "next",
      publish,
    });
  }
  return result;
}

export async function runPostLifecycleHooks({ agentId, projectId, runId, input, publish }) {
  return afterBodyLifecycle({ projectId, agentId, runId, input, publish });
}

export { BODY_AGENTS, PRE_BODY_AGENTS };
