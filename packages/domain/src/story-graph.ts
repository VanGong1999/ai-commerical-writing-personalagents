import { z } from "zod";
import type { GateCheck } from "./entities";

/** 剧情连续性图节点类型 */
export const StoryNodeKindSchema = z.enum([
  "character",
  "location",
  "fact",
  "event",
  "macguffin",
  "state",
]);
export type StoryNodeKind = z.infer<typeof StoryNodeKindSchema>;

export const StoryEdgeKindSchema = z.enum([
  "causes",
  "enables",
  "blocks",
  "foreshadows",
  "payoff",
  "knows",
  "owns",
  "located",
]);
export type StoryEdgeKind = z.infer<typeof StoryEdgeKindSchema>;

export const StoryNodeSchema = z.object({
  id: z.string().min(1),
  kind: StoryNodeKindSchema,
  label: z.string().min(1),
  episodeSpan: z
    .object({
      from: z.number().int().nonnegative().default(0),
      to: z.number().int().nonnegative().optional(),
    })
    .default({ from: 0 }),
  status: z.enum(["active", "resolved", "dormant"]).default("active"),
  note: z.string().optional(),
});
export type StoryNode = z.infer<typeof StoryNodeSchema>;

export const StoryEdgeSchema = z.object({
  id: z.string().optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  kind: StoryEdgeKindSchema,
  episode: z.number().int().nonnegative().default(0),
  note: z.string().optional(),
  open: z.boolean().default(false),
});
export type StoryEdge = z.infer<typeof StoryEdgeSchema>;

export const CharacterStateSnapshotSchema = z.object({
  characterId: z.string().min(1),
  name: z.string().default(""),
  episode: z.number().int().nonnegative(),
  location: z.string().default(""),
  inventory: z.array(z.string()).default([]),
  knownFacts: z.array(z.string()).default([]),
  powerLevel: z.string().default(""),
  emotion: z.string().default(""),
  note: z.string().optional(),
});
export type CharacterStateSnapshot = z.infer<typeof CharacterStateSnapshotSchema>;

export const StoryGraphBodySchema = z.object({
  kind: z.enum(["story_graph", "episode_graph"]).default("story_graph"),
  episodeNo: z.number().int().optional(),
  schemaVersion: z.literal("story-graph/1").default("story-graph/1"),
  nodes: z.array(StoryNodeSchema).default([]),
  edges: z.array(StoryEdgeSchema).default([]),
  characterStates: z.array(CharacterStateSnapshotSchema).default([]),
  openQuestions: z.array(z.string()).default([]),
  contradictions: z.array(z.string()).default([]),
  /** 由 JSON 确定性生成；编辑以 JSON 为准 */
  mermaid: z.string().default(""),
  updatedAt: z.string().optional(),
});
export type StoryGraphBody = z.infer<typeof StoryGraphBodySchema>;

export const ForeshadowEntrySchema = z.object({
  id: z.string().min(1),
  plantEp: z.number().int().positive(),
  dueEp: z.number().int().positive(),
  text: z.string().min(1),
  status: z.enum(["open", "paid", "dropped"]).default("open"),
  payoffEp: z.number().int().positive().optional(),
  note: z.string().optional(),
});
export type ForeshadowEntry = z.infer<typeof ForeshadowEntrySchema>;

export const ForeshadowLedgerSchema = z.object({
  schemaVersion: z.literal("foreshadow-ledger/1").default("foreshadow-ledger/1"),
  entries: z.array(ForeshadowEntrySchema).default([]),
  updatedAt: z.string().optional(),
});
export type ForeshadowLedger = z.infer<typeof ForeshadowLedgerSchema>;

const EDGE_LABEL: Record<StoryEdgeKind, string> = {
  causes: "导致",
  enables: "促成",
  blocks: "阻碍",
  foreshadows: "伏笔",
  payoff: "兑现",
  knows: "知晓",
  owns: "持有",
  located: "位于",
};

function escMermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, "_").slice(0, 48) || "n";
}

function escLabel(label: string): string {
  return label.replace(/[[\]"\n]/g, " ").slice(0, 40);
}

/** 由结构化图确定性生成 Mermaid flowchart */
export function storyGraphToMermaid(graph: StoryGraphBody): string {
  const lines = ["flowchart TD"];
  for (const n of graph.nodes) {
    const id = escMermaidId(n.id);
    const shape =
      n.kind === "character"
        ? `([${escLabel(n.label)}])`
        : n.kind === "event"
          ? `[${escLabel(n.label)}]`
          : n.kind === "location"
            ? `[[${escLabel(n.label)}]]`
            : `(${escLabel(n.label)})`;
    lines.push(`  ${id}${shape}`);
  }
  for (const e of graph.edges) {
    const from = escMermaidId(e.from);
    const to = escMermaidId(e.to);
    const label = EDGE_LABEL[e.kind] || e.kind;
    const ep = e.episode > 0 ? ` EP${e.episode}` : "";
    lines.push(`  ${from} -->|${label}${ep}| ${to}`);
  }
  if (graph.nodes.length === 0) {
    lines.push("  empty([暂无节点])");
  }
  return lines.join("\n");
}

export function withGeneratedMermaid(graph: StoryGraphBody): StoryGraphBody {
  return { ...graph, mermaid: storyGraphToMermaid(graph) };
}

export function emptyStoryGraph(
  kind: "story_graph" | "episode_graph" = "story_graph",
  episodeNo?: number,
): StoryGraphBody {
  return withGeneratedMermaid({
    kind,
    episodeNo,
    schemaVersion: "story-graph/1",
    nodes: [],
    edges: [],
    characterStates: [],
    openQuestions: [],
    contradictions: [],
    mermaid: "",
    updatedAt: new Date().toISOString(),
  });
}

export function emptyForeshadowLedger(): ForeshadowLedger {
  return {
    schemaVersion: "foreshadow-ledger/1",
    entries: [],
    updatedAt: new Date().toISOString(),
  };
}

export function parseForeshadowLedger(raw: unknown): ForeshadowLedger {
  if (raw == null) return emptyForeshadowLedger();
  if (typeof raw === "string") {
    try {
      return ForeshadowLedgerSchema.parse(JSON.parse(raw));
    } catch {
      return emptyForeshadowLedger();
    }
  }
  try {
    return ForeshadowLedgerSchema.parse(raw);
  } catch {
    return emptyForeshadowLedger();
  }
}

export function openForeshadows(ledger: ForeshadowLedger): ForeshadowEntry[] {
  return ledger.entries.filter((e) => e.status === "open");
}

export function overdueForeshadows(
  ledger: ForeshadowLedger,
  currentEp: number,
): ForeshadowEntry[] {
  return openForeshadows(ledger).filter((e) => currentEp > e.dueEp && e.dueEp > 0);
}

/** 合并 episode 图到全剧图（按 id upsert 节点/边；状态按集号替换） */
export function mergeEpisodeIntoStory(
  story: StoryGraphBody,
  episode: StoryGraphBody,
): StoryGraphBody {
  const nodeMap = new Map(story.nodes.map((n) => [n.id, n]));
  for (const n of episode.nodes) nodeMap.set(n.id, n);
  const edgeKey = (e: StoryEdge) =>
    e.id || `${e.from}->${e.to}:${e.kind}:${e.episode}`;
  const edgeMap = new Map(story.edges.map((e) => [edgeKey(e), e]));
  for (const e of episode.edges) edgeMap.set(edgeKey(e), e);

  const epNo = episode.episodeNo ?? 0;
  const stateMap = new Map(
    story.characterStates
      .filter((s) => s.episode !== epNo)
      .map((s) => [`${s.characterId}:${s.episode}`, s]),
  );
  for (const s of episode.characterStates) {
    stateMap.set(`${s.characterId}:${s.episode}`, s);
  }

  return withGeneratedMermaid({
    ...story,
    kind: "story_graph",
    nodes: [...nodeMap.values()],
    edges: [...edgeMap.values()],
    characterStates: [...stateMap.values()],
    openQuestions: [
      ...new Set([...(story.openQuestions || []), ...(episode.openQuestions || [])]),
    ],
    contradictions: [
      ...new Set([...(story.contradictions || []), ...(episode.contradictions || [])]),
    ],
    updatedAt: new Date().toISOString(),
  });
}

/**
 * 为 bible 注入压缩切片：活跃节点、开放边、近 N 集角色状态。
 */
export function sliceStoryGraphForBible(
  graph: StoryGraphBody | null | undefined,
  opts: { currentEp?: number; recentEps?: number; maxNodes?: number; maxEdges?: number } = {},
): string {
  if (!graph || (!graph.nodes.length && !graph.edges.length)) {
    return "（尚无 story_graph）";
  }
  const currentEp = opts.currentEp ?? 0;
  const recentEps = opts.recentEps ?? 3;
  const maxNodes = opts.maxNodes ?? 40;
  const maxEdges = opts.maxEdges ?? 40;
  const minEp = Math.max(0, currentEp - recentEps);

  const activeNodes = graph.nodes
    .filter((n) => n.status === "active" || !n.episodeSpan?.to || (n.episodeSpan.to ?? 999) >= minEp)
    .slice(0, maxNodes);
  const openEdges = graph.edges
    .filter((e) => e.open || e.kind === "foreshadows" || e.episode >= minEp)
    .slice(0, maxEdges);
  const states = graph.characterStates
    .filter((s) => s.episode >= minEp && (currentEp === 0 || s.episode <= currentEp))
    .sort((a, b) => b.episode - a.episode)
    .slice(0, 24);

  const lines = [
    `nodes(${activeNodes.length}/${graph.nodes.length}):`,
    ...activeNodes.map((n) => `- ${n.id}[${n.kind}] ${n.label} · ${n.status}`),
    `edges(${openEdges.length}/${graph.edges.length}):`,
    ...openEdges.map(
      (e) =>
        `- ${e.from} -${e.kind}-> ${e.to}` +
        (e.episode ? ` @EP${e.episode}` : "") +
        (e.open ? " [open]" : ""),
    ),
    "characterStates:",
    ...(states.length
      ? states.map(
          (s) =>
            `- EP${s.episode} ${s.name || s.characterId}: @${s.location || "?"} | ${s.powerLevel || "-"} | ${s.emotion || "-"}`,
        )
      : ["- （无快照）"]),
  ];
  return lines.join("\n").slice(0, 3500);
}

export function formatForeshadowsForBible(ledger: ForeshadowLedger): string {
  const open = openForeshadows(ledger);
  if (!open.length) return "- （无登记开放伏笔）";
  return open
    .map((e) => `- ${e.id}: EP${e.plantEp}→EP${e.dueEp} ${e.text}`)
    .join("\n");
}

export type GraphConsistencyIssue = {
  code: string;
  severity: "fail" | "warn";
  message: string;
};

/** 程序化图一致性校验（不替代 LogicAck） */
export function validateStoryGraphConsistency(
  graph: StoryGraphBody | null | undefined,
  opts: {
    ledger?: ForeshadowLedger | null;
    currentEp?: number;
    worldText?: string;
    requireNonEmpty?: boolean;
  } = {},
): GraphConsistencyIssue[] {
  const issues: GraphConsistencyIssue[] = [];
  if (!graph) {
    if (opts.requireNonEmpty) {
      issues.push({ code: "missing_graph", severity: "warn", message: "缺少 story/episode graph" });
    }
    return issues;
  }

  const parsed = StoryGraphBodySchema.safeParse(graph);
  if (!parsed.success) {
    issues.push({
      code: "schema",
      severity: "fail",
      message: `图 schema 无效：${parsed.error.issues[0]?.message || "parse error"}`,
    });
    return issues;
  }
  const g = parsed.data;
  const ids = new Set(g.nodes.map((n) => n.id));

  for (const e of g.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) {
      issues.push({
        code: "dangling_edge",
        severity: "fail",
        message: `边引用缺失节点：${e.from}→${e.to} (${e.kind})`,
      });
    }
  }

  const byCharEp = new Map<string, CharacterStateSnapshot[]>();
  for (const s of g.characterStates) {
    const key = `${s.characterId}:${s.episode}`;
    const list = byCharEp.get(key) || [];
    list.push(s);
    byCharEp.set(key, list);
  }
  for (const [key, list] of byCharEp) {
    if (list.length < 2) continue;
    const locs = new Set(list.map((s) => s.location.trim()).filter(Boolean));
    if (locs.size > 1) {
      issues.push({
        code: "location_conflict",
        severity: "warn",
        message: `同集地点有变化，可核对转场 ${key}：${[...locs].join(" / ")}`,
      });
    }
  }

  const world = (opts.worldText || "").toLowerCase();
  if (world.includes("上限") || world.includes("禁止") || world.includes("不可")) {
    for (const e of g.edges) {
      if (e.kind === "enables" && /无限|无敌|秒杀全场/.test(e.note || "")) {
        issues.push({
          code: "gold_finger",
          severity: "warn",
          message: `疑似突破金手指上限：${e.from}→${e.to} ${e.note || ""}`,
        });
      }
    }
  }

  const ledger = opts.ledger;
  const currentEp = opts.currentEp ?? 0;
  if (ledger) {
    const overdue = overdueForeshadows(ledger, currentEp);
    for (const o of overdue) {
      issues.push({
        code: "foreshadow_overdue",
        severity: "warn",
        message: `伏笔逾期未收 ${o.id}（到期 EP${o.dueEp}，当前 EP${currentEp}）：${o.text}`,
      });
    }
    const openIds = new Set(openForeshadows(ledger).map((e) => e.id));
    for (const e of g.edges) {
      if (e.kind === "payoff" && e.note && openIds.has(e.note)) {
        issues.push({
          code: "payoff_still_open",
          severity: "fail",
          message: `图声称兑现 ${e.note}，但 ledger 仍为 open`,
        });
      }
    }
  }

  for (const c of g.contradictions || []) {
    if (c.trim()) {
      issues.push({ code: "listed_contradiction", severity: "warn", message: c.trim() });
    }
  }

  return issues;
}

export function graphIssuesToGateChecks(issues: GraphConsistencyIssue[]): GateCheck[] {
  if (!issues.length) {
    return [
      {
        id: "graph_consistency",
        name: "剧情图一致性",
        result: "pass",
        message: "图结构校验通过（终审仍须人工 LogicAck）",
      },
    ];
  }
  const hasFail = issues.some((i) => i.severity === "fail");
  return [
    {
      id: "graph_consistency",
      name: "剧情图一致性",
      result: hasFail ? "fail" : "warn",
      message: issues.map((i) => `[${i.code}] ${i.message}`).join("；"),
    },
  ];
}

export function storyGraphToMarkdown(graph: StoryGraphBody, title = "story_graph"): string {
  const body = withGeneratedMermaid(graph);
  return [
    `# ${title}`,
    "",
    "## 摘要",
    `- nodes: ${body.nodes.length}`,
    `- edges: ${body.edges.length}`,
    `- characterStates: ${body.characterStates.length}`,
    "",
    "## Mermaid",
    "```mermaid",
    body.mermaid,
    "```",
    "",
    "## JSON",
    "```json",
    JSON.stringify(
      {
        nodes: body.nodes,
        edges: body.edges,
        characterStates: body.characterStates,
        openQuestions: body.openQuestions,
        contradictions: body.contradictions,
      },
      null,
      2,
    ),
    "```",
  ].join("\n");
}
