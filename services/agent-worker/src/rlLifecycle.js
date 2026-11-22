/**
 * 可选 RL score_only：轨迹导出 + 程序化奖励（不训练权重）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeProgrammaticReward,
  resolveRlMode,
  sessionEventsToShareGPT,
} from "@xiezuomanju/agent-runtime";
import { api } from "./apiClient.js";
import { foreshadowLedgerPath, loadForeshadowLedger, loadStoryGraphArtifact } from "./storyGraphLifecycle.js";

export async function resolveProjectRlMode(projectId) {
  try {
    const p = await api.getProject(projectId);
    const meta = p?.coverMeta || p?.cover_meta || {};
    return resolveRlMode(meta.rlMode || meta.rl_mode || process.env.AGENT_RL_MODE || "off");
  } catch {
    return resolveRlMode(process.env.AGENT_RL_MODE || "off");
  }
}

export async function maybeScoreAndExportTrajectory({
  projectId,
  runId,
  agentId,
  sessionStore,
  lifecyclePre,
  lifecyclePost,
  toolNamesUsed = [],
  publish,
}) {
  const mode = await resolveProjectRlMode(projectId);
  if (mode !== "score_only") {
    return { mode, skipped: true };
  }

  const biblePath = `/memories/projects/${projectId}/bible_pack.md`;
  const bible = await api.getMemoryFile(biblePath).catch(() => null);
  const bibleText = bible?.content || bible?.body || "";
  const biblePackReady = /ready_for_body:\s*true/i.test(bibleText) || bibleText.includes("## locked_cast");
  const bibleHasGraphSlice =
    bibleText.includes("## story_graph_slice") && !bibleText.includes("尚无 story_graph");

  const { graph } = await loadStoryGraphArtifact(projectId);
  const ledger = await loadForeshadowLedger(projectId);
  const graphGate = lifecyclePost?.graphSync?.gate;
  const graphSchemaOk =
    graphGate?.result === "pass" ||
    graphGate?.result === "warn" ||
    (graph.nodes?.length > 0 && !String(graphGate?.result || "").includes("fail"));

  const open = (ledger.entries || []).filter((e) => e.status === "open");
  const foreshadowHasDue = open.length === 0 || open.every((e) => Number(e.dueEp) > 0);
  const foreshadowOverdueClear = !String(graphGate?.message || "").includes("foreshadow_overdue");

  const usedPayoffLedgerTool = toolNamesUsed.includes("payoff_ledger");
  const usedGraphRelatedTool =
    toolNamesUsed.some((n) =>
      ["payoff_ledger", "artifact.create", "bible.write", "bible.read"].includes(n),
    ) || Boolean(lifecyclePost?.graphSync?.storyGraph);

  const score = computeProgrammaticReward({
    mode,
    biblePackReady: Boolean(lifecyclePre?.pre?.path || biblePackReady),
    bibleHasGraphSlice,
    graphSchemaOk: Boolean(graphSchemaOk),
    foreshadowHasDue,
    foreshadowOverdueClear,
    lengthDecayPass: lifecyclePost?.decay?.result !== "fail",
    usedPayoffLedgerTool,
    usedGraphRelatedTool,
  });

  const events = sessionStore?.readAll?.() || [];
  const sharegpt = sessionEventsToShareGPT(events);
  const traj = {
    timestamp: new Date().toISOString(),
    model: agentId,
    completed: true,
    runId,
    projectId,
    rl_mode: mode,
    reward: score,
    conversations: sharegpt.conversations,
    meta: {
      foreshadowLedgerPath: foreshadowLedgerPath(projectId),
      biblePackPath: biblePath,
    },
  };

  const root = process.env.AGENT_TRAJECTORY_ROOT || ".data/trajectories";
  mkdirSync(root, { recursive: true });
  const filePath = join(root, `${runId}.jsonl`);
  writeFileSync(filePath, `${JSON.stringify(traj)}\n`, "utf8");

  await api
    .putMemoryFile({
      path: `/memories/projects/${projectId}/rl/last_score.json`,
      content: JSON.stringify({ ...score, runId, agentId, trajectoryPath: filePath }, null, 2),
      project_id: projectId,
      projectId,
    })
    .catch(() => {});

  publish?.({
    type: "rl_score",
    mode,
    total: score.total,
    breakdown: score.breakdown,
    notes: score.notes,
    trajectoryPath: filePath,
  });
  publish?.({
    type: "token",
    text: `[rl_score] mode=${mode} total=${score.total} → ${filePath}\n`,
  });

  return { mode, score, trajectoryPath: filePath };
}
