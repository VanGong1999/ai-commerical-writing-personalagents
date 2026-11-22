import type { Artifact, StoryEdge, StoryGraphBody, StoryNode } from "@xiezuomanju/domain";
import {
  emptyStoryGraph,
  storyGraphToMermaid,
  validateStoryGraphConsistency,
  withGeneratedMermaid,
} from "@xiezuomanju/domain";
import { Badge, Button, CollapsibleSection, Panel, toast } from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useMemo, useState } from "react";
import { api } from "../../api/client";
import { MermaidDiagram } from "../../components/MermaidDiagram";
import { runAgentFeedback } from "./runAgentFeedback";
import { outlineMermaidFor } from "./outlineGraphs";
import { isFeatureOn, useFeatureToggles } from "./featureToggles";

type Props = {
  projectId?: string;
  artifacts: Artifact[];
  /** 在 LogicAck 区域展示告警 */
  showLogicAlerts?: boolean;
};

function asGraph(art?: Artifact | null): StoryGraphBody {
  if (!art?.bodyJson) return emptyStoryGraph("story_graph");
  try {
    return withGeneratedMermaid({
      ...emptyStoryGraph((art.bodyJson as { kind?: string }).kind === "episode_graph" ? "episode_graph" : "story_graph"),
      ...(art.bodyJson as StoryGraphBody),
    });
  } catch {
    return emptyStoryGraph("story_graph");
  }
}

function SimpleGraphSvg({ nodes, edges }: { nodes: StoryNode[]; edges: StoryEdge[] }) {
  const size = 360;
  const cx = size / 2;
  const cy = size / 2;
  const r = Math.max(90, Math.min(140, nodes.length * 18));
  const pos = (i: number) => {
    if (nodes.length <= 1) return [cx, cy] as const;
    const a = (Math.PI * 2 * i) / nodes.length - Math.PI / 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
  };
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  return (
    <svg width="100%" viewBox={`0 0 ${size} ${size}`} style={{ maxHeight: 320, background: "var(--bg-muted, #f6f6f4)", borderRadius: 8 }}>
      {edges.map((e, i) => {
        const a = index.get(e.from);
        const b = index.get(e.to);
        if (a == null || b == null) return null;
        const [x1, y1] = pos(a);
        const [x2, y2] = pos(b);
        return (
          <g key={`${e.from}-${e.to}-${i}`}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--border, #ccc)" strokeWidth={1.5} markerEnd="url(#arrow)" />
          </g>
        );
      })}
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="var(--muted, #888)" />
        </marker>
      </defs>
      {nodes.map((n, i) => {
        const [x, y] = pos(i);
        return (
          <g key={n.id}>
            <circle cx={x} cy={y} r={22} fill={n.kind === "character" ? "#3b82f6" : n.kind === "event" ? "#f59e0b" : "#64748b"} opacity={0.9} />
            <text x={x} y={y + 4} textAnchor="middle" fontSize={9} fill="#fff">
              {(n.label || n.id).slice(0, 6)}
            </text>
          </g>
        );
      })}
      {!nodes.length ? (
        <text x={cx} y={cy} textAnchor="middle" fill="var(--muted)" fontSize={12}>
          暂无节点 — 先生成连续性图
        </text>
      ) : null}
    </svg>
  );
}

export function StoryContinuityPanel({ projectId, artifacts, showLogicAlerts }: Props) {
  const [view, setView] = useState<"graph" | "outline" | "beats">("graph");
  const storyArts = artifacts.filter((a) => a.type === "story_graph");
  const epArts = artifacts
    .filter((a) => a.type === "episode_graph")
    .sort(
      (a, b) =>
        Number((a.bodyJson as { episodeNo?: number })?.episodeNo ?? 0) -
        Number((b.bodyJson as { episodeNo?: number })?.episodeNo ?? 0),
    );
  const [epFilter, setEpFilter] = useState<number | "all">("all");
  const [busy, setBusy] = useState(false);
  const toggles = useFeatureToggles();
  const logicScanOn = isFeatureOn(toggles, "logicScan");

  const story = asGraph(storyArts[0]);
  const selectedEpArt =
    epFilter === "all"
      ? null
      : epArts.find((a) => Number((a.bodyJson as { episodeNo?: number })?.episodeNo) === epFilter) || null;
  const viewGraph = selectedEpArt ? asGraph(selectedEpArt) : story;
  const mermaid = viewGraph.mermaid || storyGraphToMermaid(viewGraph);
  const outlineMermaid = useMemo(
    () => outlineMermaidFor("episode_outline", artifacts),
    [artifacts],
  );
  const chapterMermaid = useMemo(
    () => outlineMermaidFor("chapter_outline", artifacts),
    [artifacts],
  );
  const beatsMermaid = useMemo(() => {
    const beats = outlineMermaidFor("beat20_outline", artifacts);
    if (beats.includes("暂无细纲")) return outlineMermaidFor("beat20", artifacts);
    return beats;
  }, [artifacts]);
  const outlineCode = useMemo(() => {
    if (!outlineMermaid.includes("暂无大纲")) return outlineMermaid;
    return chapterMermaid;
  }, [outlineMermaid, chapterMermaid]);

  const issues = useMemo(
    () => validateStoryGraphConsistency(story, { currentEp: typeof epFilter === "number" ? epFilter : 0 }),
    [story, epFilter],
  );

  const regenMermaid = async () => {
    if (!projectId || !storyArts[0]) return;
    const next = withGeneratedMermaid(story);
    await api.updateArtifact(projectId, storyArts[0].id, {
      bodyJson: next,
      bodyMarkdown: ["```mermaid", next.mermaid, "```"].join("\n"),
    });
    toast.ok("已按 JSON 重生成 Mermaid");
  };

  const runStoryGraph = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      await runAgentFeedback(projectId, "struct.story_graph", { label: "struct.story_graph" });
      toast.ok("已请求生成全剧连续性图");
    } finally {
      setBusy(false);
    }
  };

  const runEpisodeGraph = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      await runAgentFeedback(projectId, "struct.episode_graph", {
        label: "struct.episode_graph",
        inputJson: { ep_no: epFilter === "all" ? undefined : epFilter },
      });
      toast.ok("已请求更新分集图");
    } finally {
      setBusy(false);
    }
  };

  const runLogicScan = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      await runAgentFeedback(projectId, "qc.logic_heuristic", { label: "qc.logic_heuristic" });
      toast.ok("已请求对照 story_graph 的逻辑扫描");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <CollapsibleSection title="剧情连续性图（Mermaid）" defaultOpen>
        <Panel title="全剧 / 分集图">
          <p className="muted" style={{ marginTop: 0 }}>
            结构化 JSON 为真相（Ontology Object）；Mermaid 为 Object View。大纲/细纲图本地生成（零
            token）。审计与情景分支见创作台「审计」标签。
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <div className="row" style={{ gap: 4 }}>
              {(
                [
                  ["graph", "全剧/分集"],
                  ["outline", "大纲图"],
                  ["beats", "细纲图"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="badge"
                  data-active={view === id}
                  onClick={() => setView(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {view === "graph" ? (
              <>
            <label className="row" style={{ gap: 6 }}>
              视图
              <Select
                value={epFilter === "all" ? "all" : String(epFilter)}
                onChange={(e) => {
                  const v = e.target.value;
                  setEpFilter(v === "all" ? "all" : Number(v));
                }}
              >
                <option value="all">全剧 story_graph</option>
                {epArts.map((a) => {
                  const n = Number((a.bodyJson as { episodeNo?: number })?.episodeNo ?? 0);
                  return (
                    <option key={a.id} value={n}>
                      EP{String(n).padStart(2, "0")}
                    </option>
                  );
                })}
              </Select>
            </label>
            <Badge tone={issues.some((i) => i.severity === "fail") ? "fail" : issues.length ? "warn" : "ok"}>
              {issues.length ? `${issues.length} 条图告警` : "图结构暂无硬伤"}
            </Badge>
            <Button disabled={!projectId || busy} onClick={() => void runStoryGraph()}>
              生成/更新全剧图
            </Button>
            <Button disabled={!projectId || busy} onClick={() => void runEpisodeGraph()}>
              更新分集图
            </Button>
            <Button disabled={!storyArts[0] || !projectId} onClick={() => void regenMermaid()}>
              重生成 Mermaid
            </Button>
            {showLogicAlerts ? (
              <Button
                disabled={!projectId || busy || !logicScanOn}
                title={logicScanOn ? undefined : "逻辑扫描已在「设置 → 功能开关」关闭"}
                onClick={() => void runLogicScan()}
              >
                对照图逻辑扫描
              </Button>
            ) : null}
              </>
            ) : null}
          </div>
          {view === "graph" ? (
            <div className="row" style={{ gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 280px" }}>
                <SimpleGraphSvg nodes={viewGraph.nodes || []} edges={viewGraph.edges || []} />
              </div>
              <div style={{ flex: "1 1 360px" }}>
                <MermaidDiagram code={mermaid || "flowchart TD\n  empty([暂无节点])"} maxHeight={420} />
              </div>
            </div>
          ) : view === "outline" ? (
            <MermaidDiagram
              code={outlineCode}
              maxHeight={520}
            />
          ) : (
            <MermaidDiagram code={beatsMermaid} maxHeight={520} />
          )}
          {view === "graph" && (showLogicAlerts || issues.length > 0) && (
            <div className="stack" style={{ marginTop: 10, gap: 4 }}>
              <strong>GraphConsistency / LogicAck 告警</strong>
              {issues.length === 0 ? (
                <p className="muted">无程序化告警；终审仍须人工 LogicAck。</p>
              ) : (
                issues.map((iss, i) => (
                  <div key={`${iss.code}-${i}`} className="row" style={{ gap: 8 }}>
                    <Badge tone={iss.severity === "fail" ? "fail" : "warn"}>{iss.code}</Badge>
                    <span>{iss.message}</span>
                  </div>
                ))
              )}
            </div>
          )}
          <p className="muted" style={{ marginTop: 8 }}>
            节点 {viewGraph.nodes?.length || 0} · 边 {viewGraph.edges?.length || 0} · 状态快照{" "}
            {viewGraph.characterStates?.length || 0}
            {storyArts[0] ? ` · 产物 ${storyArts[0].title}` : " · 尚未落库 story_graph"}
          </p>
        </Panel>
      </CollapsibleSection>
    </div>
  );
}
