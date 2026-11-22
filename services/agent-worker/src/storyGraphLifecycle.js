/**
 * 剧情连续性图 / 伏笔台账：读写与合并（命令式，不靠 LLM 自觉）。
 */
import {
  emptyForeshadowLedger,
  emptyStoryGraph,
  formatForeshadowsForBible,
  mergeEpisodeIntoStory,
  openForeshadows,
  parseForeshadowLedger,
  sliceStoryGraphForBible,
  storyGraphToMarkdown,
  validateStoryGraphConsistency,
  withGeneratedMermaid,
} from "@xiezuomanju/domain/story-graph";
import { checkGraphConsistency } from "@xiezuomanju/agent-runtime";
import { api } from "./apiClient.js";
import { readProjectBible } from "./bibleMemory.js";

export function foreshadowLedgerPath(projectId) {
  return `/memories/projects/${projectId}/foreshadow_ledger.json`;
}

export function storyGraphMemPath(projectId) {
  return `/memories/projects/${projectId}/story_graph.md`;
}

export function episodeGraphMemPath(projectId, ep) {
  const pad = String(ep || 0).padStart(3, "0");
  return `/memories/projects/${projectId}/graphs/ep-${pad}.md`;
}

function memContent(file) {
  return file?.content || file?.body || "";
}

export async function loadForeshadowLedger(projectId) {
  const file = await api.getMemoryFile(foreshadowLedgerPath(projectId)).catch(() => null);
  const raw = memContent(file);
  if (!raw.trim()) return emptyForeshadowLedger();
  try {
    return parseForeshadowLedger(JSON.parse(raw));
  } catch {
    return parseForeshadowLedger(raw);
  }
}

export async function saveForeshadowLedger(projectId, ledger) {
  const next = {
    ...ledger,
    updatedAt: new Date().toISOString(),
  };
  await api.putMemoryFile({
    path: foreshadowLedgerPath(projectId),
    content: JSON.stringify(next, null, 2),
    project_id: projectId,
    projectId,
  });
  return next;
}

export async function loadStoryGraphArtifact(projectId) {
  const arts = await api.listArtifacts(projectId, "story_graph").catch(() => []);
  const art = (arts || []).find((a) => a.status === "adopted") || (arts || [])[0] || null;
  if (art?.bodyJson) {
    return { artifact: art, graph: withGeneratedMermaid({ ...emptyStoryGraph("story_graph"), ...art.bodyJson }) };
  }
  return { artifact: null, graph: emptyStoryGraph("story_graph") };
}

export async function loadEpisodeGraphArtifact(projectId, ep) {
  const arts = await api.listArtifacts(projectId, "episode_graph").catch(() => []);
  const match = (arts || []).find((a) => Number(a.bodyJson?.episodeNo ?? 0) === Number(ep));
  if (match?.bodyJson) {
    return {
      artifact: match,
      graph: withGeneratedMermaid({
        ...emptyStoryGraph("episode_graph", Number(ep)),
        ...match.bodyJson,
        kind: "episode_graph",
        episodeNo: Number(ep),
      }),
    };
  }
  return { artifact: null, graph: emptyStoryGraph("episode_graph", Number(ep)) };
}

async function upsertGraphArtifact(projectId, type, title, graph, existing) {
  const body = withGeneratedMermaid(graph);
  const md = storyGraphToMarkdown(body, title);
  if (existing?.id) {
    return api.updateArtifact(projectId, existing.id, {
      title,
      bodyMarkdown: md,
      bodyJson: body,
    });
  }
  return api.createArtifact(projectId, {
    type,
    title,
    bodyMarkdown: md,
    bodyJson: body,
    status: "adopted",
  });
}

export function extractManuscriptHookText(artifact, fallbackText) {
  const body = artifact?.bodyJson || {};
  const description = [body.hookText, body.hook_text, body.cliffText, body.cliff, body.hookAtEnd]
    .find((value) => typeof value === "string");
  if (description !== undefined) return description.trim();
  if (body.hookAtEnd === false) return "";

  const markdown = artifact?.bodyMarkdown;
  if (typeof markdown === "string") {
    const lastLine = markdown.trimEnd().split(/\r?\n/).at(-1).trimStart();
    const marker = "【集尾卡点】";
    if (lastLine.startsWith(marker)) {
      const text = lastLine.slice(marker.length).trim();
      if (text) return text;
    }
  }
  return typeof fallbackText === "string" ? fallbackText.trim() : "";
}

/**
 * 从正文启发式抽出极简 episode_graph（保证写后有图可注入；Agent 可再精修）。
 */
export function heuristicEpisodeGraphFromManuscript(artifact, ep) {
  const body = artifact?.bodyJson || {};
  const md = String(artifact?.bodyMarkdown || "");
  const summary = String(body.summary || md.slice(0, 120) || `EP${ep}`).trim();
  const nodes = [
    {
      id: `ep${ep}_event`,
      kind: "event",
      label: summary.slice(0, 36) || `EP${ep}事件`,
      episodeSpan: { from: ep, to: ep },
      status: "active",
    },
  ];
  const edges = [];
  const hook = extractManuscriptHookText(artifact);
  if (hook) {
    nodes.push({
      id: `ep${ep}_hook`,
      kind: "fact",
      label: hook.slice(0, 36),
      episodeSpan: { from: ep },
      status: "active",
    });
    edges.push({
      from: `ep${ep}_event`,
      to: `ep${ep}_hook`,
      kind: "foreshadows",
      episode: ep,
      open: true,
      note: hook.slice(0, 80),
    });
  }
  const characterStates = Array.isArray(body.characterStates) ? body.characterStates : [];
  return withGeneratedMermaid({
    ...emptyStoryGraph("episode_graph", ep),
    nodes,
    edges,
    characterStates,
    openQuestions: [],
    contradictions: [],
  });
}

/**
 * 写后：更新 episode_graph → merge story_graph → 记忆落盘 → GraphConsistency。
 */
export async function syncGraphsAfterBody({
  projectId,
  artifact,
  ep,
  publish,
  mergeGraph = true,
  mergeForeshadow = true,
}) {
  const episodeNo = Number(ep) || 0;
  if (!episodeNo) return { skipped: true };

  const hookText = extractManuscriptHookText(artifact);
  let { artifact: epArt, graph: epGraph } = await loadEpisodeGraphArtifact(projectId, episodeNo);
  if (!epGraph.nodes.length) {
    epGraph = heuristicEpisodeGraphFromManuscript(artifact, episodeNo);
  } else {
    // 若已有图但缺钩子边，补开放钩
    if (hookText && !epGraph.edges.some((e) => e.kind === "foreshadows")) {
      epGraph = withGeneratedMermaid({
        ...epGraph,
        nodes: [
          ...epGraph.nodes,
          {
            id: `ep${episodeNo}_hook`,
            kind: "fact",
            label: hookText.slice(0, 36),
            episodeSpan: { from: episodeNo },
            status: "active",
          },
        ],
        edges: [
          ...epGraph.edges,
          {
            from: epGraph.nodes[0]?.id || `ep${episodeNo}_event`,
            to: `ep${episodeNo}_hook`,
            kind: "foreshadows",
            episode: episodeNo,
            open: true,
          },
        ],
      });
    }
  }

  epArt = await upsertGraphArtifact(
    projectId,
    "episode_graph",
    `EP${String(episodeNo).padStart(2, "0")} 连续性图`,
    epGraph,
    epArt,
  );

  await api.putMemoryFile({
    path: episodeGraphMemPath(projectId, episodeNo),
    content: storyGraphToMarkdown(epGraph, `ep-${String(episodeNo).padStart(3, "0")}`),
    project_id: projectId,
    projectId,
  });

  const storyLoaded = await loadStoryGraphArtifact(projectId);
  const merged = mergeGraph
    ? mergeEpisodeIntoStory(storyLoaded.graph, epGraph)
    : withGeneratedMermaid(storyLoaded.graph);
  if (mergeGraph) {
    await upsertGraphArtifact(projectId, "story_graph", "全剧连续性图", merged, storyLoaded.artifact);
    await api.putMemoryFile({
      path: storyGraphMemPath(projectId),
      content: storyGraphToMarkdown(merged, "story_graph"),
      project_id: projectId,
      projectId,
    });
  }

  // 若正文带来新钩且 ledger 无对应 open，登记
  let ledger = await loadForeshadowLedger(projectId);
  if (mergeForeshadow && hookText) {
    const exists = ledger.entries.some(
      (e) => e.status === "open" && e.text.includes(hookText.slice(0, 20)),
    );
    if (!exists) {
      const id = `F${ledger.entries.length + 1}`;
      ledger.entries.push({
        id,
        plantEp: episodeNo,
        dueEp: episodeNo + 5,
        text: hookText.slice(0, 120),
        status: "open",
      });
      await saveForeshadowLedger(projectId, ledger);
    }
  }

  const gate = checkGraphConsistency({
    graph: merged,
    ledger,
    currentEp: episodeNo,
    requireNonEmpty: true,
  });
  publish?.({ type: "gates", phase: "graph_consistency", gates: [gate] });
  publish?.({
    type: "token",
    text: `[story_graph] 已同步 EP${episodeNo} 图 → 全剧图；GraphConsistency=${gate.result}\n`,
  });

  return { episodeGraph: epGraph, storyGraph: merged, gate, ledger };
}

export async function bibleGraphSlice(projectId, currentEp) {
  const [{ graph }, ledger, world] = await Promise.all([
    loadStoryGraphArtifact(projectId),
    loadForeshadowLedger(projectId),
    readProjectBible(projectId, "world.md"),
  ]);
  const recentStates = (graph.characterStates || [])
    .filter((s) => s.episode >= Math.max(0, currentEp - 3) && s.episode < currentEp)
    .sort((a, b) => b.episode - a.episode)
    .slice(0, 12);

  const recentJournals = [];
  for (let i = Math.max(1, currentEp - 3); i < currentEp; i++) {
    const pad = String(i).padStart(3, "0");
    const j = await api
      .getMemoryFile(`/memories/projects/${projectId}/journal/ch-${pad}.md`)
      .catch(() => null);
    const c = memContent(j).trim();
    if (c) recentJournals.push(`### EP${String(i).padStart(2, "0")}\n${c.slice(0, 400)}`);
  }

  return {
    graphSlice: sliceStoryGraphForBible(graph, { currentEp, recentEps: 3 }),
    foreshadowText: formatForeshadowsForBible(ledger),
    openCount: openForeshadows(ledger).length,
    recentStatesText: recentStates.length
      ? recentStates
          .map(
            (s) =>
              `- EP${s.episode} ${s.name || s.characterId}: @${s.location || "?"} / ${s.powerLevel || "-"} / ${s.emotion || "-"}`,
          )
          .join("\n")
      : "- （无近集状态快照）",
    recentJournalsText: recentJournals.length ? recentJournals.join("\n\n") : "（无近集 journal）",
    worldText: memContent(world),
    ledger,
    graph,
    issues: validateStoryGraphConsistency(graph, {
      ledger,
      currentEp,
      worldText: memContent(world),
    }),
  };
}
