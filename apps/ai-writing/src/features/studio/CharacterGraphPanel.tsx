import { Button, CollapsibleSection, Select, toast } from "@xiezuomanju/ui";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { GraphNodeSchema, type Artifact } from "@xiezuomanju/domain";
import { api } from "../../api/client";
import { profileRole, type CharacterProfile } from "./characterProfiles";
import { runAgentFeedback } from "./runAgentFeedback";

type GraphNode = { id: string; label: string; type: string; profile?: CharacterProfile };
type Edge = { from: GraphNode; to: GraphNode; type: string; strength?: number };
type ManualEdge = { from: string; to: string; type: string; strength: number };

const RELATION_COLORS: Array<[string, string]> = [
  ["血缘", "#e5484d"],
  ["情感", "#f76b8a"],
  ["对立", "#8b5cf6"],
  ["利益", "#f5a524"],
  ["同盟", "#30a46c"],
  ["见证", "#3b82f6"],
];

function relationColor(type: string): string {
  for (const [key, color] of RELATION_COLORS) {
    if (type.includes(key)) return color;
  }
  return "var(--accent)";
}

function loadLocalEdges(projectId?: string): unknown[] {
  if (!projectId) return [];
  try {
    const edges = JSON.parse(localStorage.getItem(`char-graph:${projectId}`) || "[]");
    return Array.isArray(edges) ? edges : [];
  } catch {
    return [];
  }
}

function baseName(name: string) {
  return name.trim().replace(/[（(][^（）()]*[）)]\s*$/, "").trim();
}

function matchProfile(label: string, profiles: CharacterProfile[]) {
  const exact = profiles.filter(({ name }) => name.trim() === label.trim());
  if (exact.length) return exact.length === 1 ? exact[0] : undefined;
  const aliases = profiles.filter(({ name }) => baseName(name) === baseName(label));
  return aliases.length === 1 ? aliases[0] : undefined;
}

function normalizeEdge(raw: unknown, nodes: GraphNode[], byId: Map<string, GraphNode>): Edge | undefined {
  if (!raw || typeof raw !== "object") return;
  const { source, target, rel, relationType, from, to, type, strength } = raw as Record<string, unknown>;
  const findName = (value: unknown) => {
    if (typeof value !== "string") return;
    const exact = nodes.find((node) => node.label === value);
    if (exact) return exact;
    const aliases = nodes.filter((node) => node.profile?.name === value);
    return aliases.length === 1 ? aliases[0] : undefined;
  };
  const start = typeof source === "string" ? byId.get(source) : findName(from);
  const end = typeof target === "string" ? byId.get(target) : findName(to);
  const relation = rel ?? relationType ?? type;
  if (!start || !end || typeof relation !== "string") return;
  return { from: start, to: end, type: relation, strength: typeof strength === "number" && Number.isFinite(strength) ? strength : undefined };
}

export function CharacterGraphPanel({
  projectId,
  profiles,
  characterArtifacts,
  manuscripts = [],
  graphArtifacts = [],
}: {
  projectId?: string;
  profiles: CharacterProfile[];
  characterArtifacts: Artifact[];
  manuscripts?: Artifact[];
  graphArtifacts?: Artifact[];
}) {
  const qc = useQueryClient();
  const graphArtifact = graphArtifacts[0];
  const graph = graphArtifact?.bodyJson;
  const [localEdges, setLocalEdges] = useState<unknown[]>(() => loadLocalEdges(projectId));
  const rawEdges = Array.isArray(graph?.edges) ? graph.edges : localEdges;
  const [form, setForm] = useState<ManualEdge>({ from: "", to: "", type: "同盟", strength: 3 });
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const storedNodes = useMemo(() => {
    if (!Array.isArray(graph?.nodes)) return [];
    const sourceIds = graph.sourceArtifacts;
    const sources = Array.isArray(sourceIds) && sourceIds.length
      ? profiles.filter(({ artifact }) => sourceIds.includes(artifact.id))
      : profiles;
    const nodes = new Map<string, GraphNode>();
    for (const row of graph.nodes) {
      const result = GraphNodeSchema.safeParse(row);
      if (!result.success || !result.data.label.trim() || nodes.has(result.data.id)) continue;
      const { id, label, type } = result.data;
      nodes.set(id, { id, label, type, profile: type === "character" ? matchProfile(label, sources) : undefined });
    }
    return [...nodes.values()];
  }, [graph, profiles]);
  const nodes = useMemo<GraphNode[]>(() => storedNodes.length ? storedNodes : profiles.map((profile) => ({
    id: profile.key, label: profile.name || profileRole(profile) || "角色", type: "character", profile,
  })), [storedNodes, profiles]);
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const edges = useMemo(() => rawEdges.flatMap((raw) => {
    const edge = normalizeEdge(raw, nodes, byId);
    return edge ? [edge] : [];
  }), [rawEdges, nodes, byId]);
  const actors = nodes.filter((node) => node.type === "character");
  const protagonist = actors.find(({ profile }) => profile && profileRole(profile) === "主角");
  const centerNode = protagonist ?? actors[0] ?? nodes[0];
  const orbit = nodes.filter((node) => node !== centerNode);
  const incomplete = profiles.filter(({ index, fields }) => index === undefined &&
    [fields.desire, fields.fear, fields.secret].some((value) => !String(value ?? "").trim()));
  const selectedNode = selectedId === null ? undefined : byId.get(selectedId);
  const appearanceNames = selectedNode ? [selectedNode.label, selectedNode.profile?.name].filter((name): name is string => Boolean(name)) : [];
  const appearances = manuscripts.flatMap((manuscript) => {
    const text = manuscript.bodyMarkdown ?? "";
    const name = appearanceNames.find((name) => text.includes(name));
    return name ? [{ manuscript, index: text.indexOf(name), text }] : [];
  });

  const save = async (next: unknown[]) => {
    if (!projectId || saving) return;
    setSaving(true);
    try {
      const updated = graphArtifact
        ? await api.updateArtifact(projectId, graphArtifact.id, {
            expectedVersion: graphArtifact.version,
            bodyJson: { ...graph, edges: next },
          })
        : await api.createArtifact(projectId, {
            type: "character_graph",
            title: "人物关系网",
            bodyJson: { kind: "character_graph", edges: next },
          });
      qc.setQueryData<Artifact[]>(["artifacts", projectId], (old) => {
        if (!old) return old;
        return old.some((row) => row.id === updated.id)
          ? old.map((row) => row.id === updated.id && row.version <= updated.version ? updated : row)
          : [...old, updated];
      });
      void qc.invalidateQueries({ queryKey: ["artifact-versions", projectId, updated.id] });
    } catch (error) {
      if (!graphArtifact) {
        setLocalEdges(next);
        try { localStorage.setItem(`char-graph:${projectId}`, JSON.stringify(next)); } catch { /* browser storage unavailable */ }
      }
      toast.fail(error instanceof Error ? error.message : String(error));
    } finally {
      void qc.invalidateQueries({ queryKey: ["artifacts", projectId] });
      setSaving(false);
    }
  };

  const addEdge = () => {
    const from = byId.get(form.from);
    const to = byId.get(form.to);
    if (!from || !to || from === to) return;
    const { type, strength } = form;
    const edge = storedNodes.length
      ? { source: from.id, target: to.id, rel: type, strength }
      : { from: from.label, to: to.label, type, strength };
    void save([...rawEdges, edge]);
  };

  const generate = async () => {
    if (!projectId) return;
    setGenerating(true);
    try {
      await runAgentFeedback(projectId, "char.relation_net", {
        label: "char.relation_net",
        inputJson: {
          characters: characterArtifacts.map((c) => ({ id: c.id, title: c.title, body: c.bodyMarkdown })),
        },
      });
      toast.ok("已请求生成人物关系网，结果会写入产物列表");
    } finally {
      setGenerating(false);
    }
  };

  const radius = Math.max(110, orbit.length * 25);
  const size = radius * 2 + 140;
  const center = size / 2;
  const pos = (node: GraphNode): readonly [number, number] => {
    if (node === centerNode) return [center, center];
    const angle = (Math.PI * 2 * orbit.indexOf(node)) / orbit.length - Math.PI / 2;
    return [center + Math.cos(angle) * radius, center + Math.sin(angle) * radius];
  };
  const nodeCount = actors.length === nodes.length ? `${actors.length} 角色` : `${nodes.length} 节点（${actors.length} 角色）`;

  return (
    <CollapsibleSection
      title="角色关系网"
      badge={`${nodeCount} · ${edges.length} 关系`}
      summary={protagonist ? `主角居中：${protagonist.label} · 点角色看出场` : undefined}
      storageKey={projectId ? `deliverable-${projectId}-char-graph` : undefined}
      defaultOpen={false}
      actions={
        <Button
          size="sm"
          variant="primary"
          disabled={!projectId || profiles.length < 2 || generating}
          onClick={() => void generate()}
        >
          {generating ? "生成中…" : "AI 生成关系网"}
        </Button>
      }
    >
      {incomplete.length > 0 && (
        <div className="help-callout help-callout--warn" style={{ marginBottom: 10 }}>
          <div className="help-callout__title">人物一致性提示</div>
          <div className="help-callout__body">
            以下角色缺「欲望 / 恐惧 / 秘密」之一：{incomplete.map(({ name }) => name).join("、")}。建议回人物小传补齐，避免情节里动机断裂。
          </div>
        </div>
      )}
      {nodes.length < 2 ? (
        <div className="empty">至少需要两个角色才能画关系网。先在「生成小传候选」里补齐人物。</div>
      ) : (
        <div className="split" style={{ height: "auto" }}>
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            style={{ maxWidth: "100%", height: "auto" }}
            role="img"
            aria-label="角色关系网"
          >
            {edges.map((e, i) => {
              const [x1, y1] = pos(e.from);
              const [x2, y2] = pos(e.to);
              const color = relationColor(e.type);
              return (
                <g key={i}>
                  <title>{`${e.from.label} → ${e.to.label} · ${e.type}`}</title>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeOpacity="0.55" strokeWidth={e.strength === undefined ? 1.5 : Math.max(1, e.strength / 2)} />
                  <text x={(x1 + x2) / 2} y={(y1 + y2) / 2} textAnchor="middle" fill={color} fontSize="11">
                    {e.type}
                  </text>
                </g>
              );
            })}
            {nodes.map((node) => {
              const [x, y] = pos(node);
              const isMain = node === protagonist;
              const isActor = node.type === "character";
              const isSelected = node.id === selectedId;
              const kind = node.type === "location" ? "地点" : node.type === "object" ? "物件" : undefined;
              return (
                <g key={node.id} onClick={isActor ? () => setSelectedId(isSelected ? null : node.id) : undefined}
                  style={{ cursor: isActor ? "pointer" : undefined }} aria-label={kind ? `${kind} · ${node.label}` : node.label}>
                  <title>{node.label}</title>
                  <circle
                    cx={x}
                    cy={y}
                    r={isMain ? 30 : 22}
                    fill={isSelected || isMain ? "var(--accent)" : "var(--accent-soft)"}
                    stroke="var(--accent)"
                    strokeWidth={isMain || isSelected ? 2 : 1.5}
                    strokeDasharray={isActor ? undefined : "4 3"}
                  />
                  <text x={x} y={y} textAnchor="middle" dominantBaseline="middle"
                    fill="var(--accent-ink)" fontSize={isMain ? 13 : 12} fontWeight="600">
                    {node.label.length > 6 ? `${node.label.slice(0, 6)}…` : node.label}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="stack">
            <div className="field-grid">
              <label className="field">
                <span>角色 A</span>
                <Select className="select" value={form.from} onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}>
                  <option value="">选择</option>
                  {actors.map(({ id, label }) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </Select>
              </label>
              <label className="field">
                <span>角色 B</span>
                <Select className="select" value={form.to} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))}>
                  <option value="">选择</option>
                  {actors.map(({ id, label }) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </Select>
              </label>
              <label className="field">
                <span>关系</span>
                <Select className="select" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                  {["同盟", "对立", "血缘", "情感", "利益", "见证"].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
              </label>
              <label className="field">
                <span>强度 1–5</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={5}
                  value={form.strength}
                  onChange={(e) => setForm((f) => ({ ...f, strength: Number(e.target.value) }))}
                />
              </label>
            </div>
            <div className="row">
              <Button variant="primary" disabled={saving || !projectId || !form.from || !form.to || form.from === form.to} onClick={addEdge}>添加关系</Button>
              <Button variant="ghost" disabled={saving || !projectId || !rawEdges.length} onClick={() => void save([])}>清空</Button>
            </div>
            <div className="stack" style={{ gap: 4 }}>
              {edges.map((e, i) => (
                <div key={i} className="row" style={{ gap: 8, fontSize: "var(--fs-xs)" }}>
                  <span>{e.from.label} → {e.to.label}</span>
                  <span className="badge" style={{ borderColor: relationColor(e.type), color: relationColor(e.type) }}>
                    {e.type}
                  </span>
                  {e.strength !== undefined && <span className="faint">强度 {e.strength}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedNode ? (
        <div className="stack" style={{ gap: 6, marginTop: 8 }}>
          <div>
            <strong style={{ fontSize: 13 }}>「{selectedNode.label}」出场</strong>
            <span className="muted" style={{ fontSize: 11 }}>
              点击角色节点可定位其在正文中的出现位置。
            </span>
          </div>
          {appearances.length === 0 ? (
            <div className="empty">该角色暂未在正文中出现。</div>
          ) : (
            appearances.map(({ manuscript, index, text }) => {
              const b = manuscript.bodyJson as { episodeNo?: number; wordCount?: number } | null | undefined;
              const around = text.slice(Math.max(0, index - 30), index + 60);
              return (
                <div key={manuscript.id} className="help-callout" style={{ margin: 0 }}>
                  <div className="help-callout__title">
                    第{b?.episodeNo ?? "?"}集 · {b?.wordCount ?? 0} 字
                  </div>
                  <div className="help-callout__body">
                    …{around}…
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </CollapsibleSection>
  );
}
