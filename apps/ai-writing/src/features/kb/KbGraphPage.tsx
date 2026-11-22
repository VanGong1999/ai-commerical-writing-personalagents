import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button, PageHeader, Panel } from "@xiezuomanju/ui";
import { useMemo, useState } from "react";
import { api } from "../../api/client";

const NODE_TYPE_META: Record<string, { label: string; color: string }> = {
  person: { label: "人物", color: "#3b82f6" },
  event: { label: "事件/情节", color: "#8b5cf6" },
  emotion: { label: "情绪点", color: "#30a46c" },
  cool: { label: "爽点", color: "#e5484d" },
  hook: { label: "钩子", color: "#f5a524" },
  prop: { label: "道具/设定", color: "#14b8a6" },
  other: { label: "其他", color: "#8a8f98" },
};

type Node = { id: string; label: string; type?: string; category?: string };
type Edge = { id: string; source: string; target: string; relationType?: string };

function nodeColor(n: Node): string {
  return NODE_TYPE_META[n.type ?? "other"]?.color ?? NODE_TYPE_META.other.color;
}

export function KbGraphPage() {
  const { id } = useParams({ from: "/kb/graph/$id" });
  const nav = useNavigate();
  const { data: graph } = useQuery({
    queryKey: ["kb-graph", id],
    queryFn: () => api.getGraph(id),
  });
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nodes = (graph?.nodes ?? []) as Node[];
  const edges = (graph?.edges ?? []) as Edge[];

  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of edges) {
      d.set(e.source, (d.get(e.source) ?? 0) + 1);
      d.set(e.target, (d.get(e.target) ?? 0) + 1);
    }
    return d;
  }, [edges]);

  const visibleNodes = nodes.filter((n) => !hidden[n.type ?? "other"]);
  const visibleIds = new Set(visibleNodes.map((n) => n.id));

  const neighbors = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const set = new Set<string>([selectedId]);
    for (const e of edges) {
      if (e.source === selectedId) set.add(e.target);
      if (e.target === selectedId) set.add(e.source);
    }
    return set;
  }, [selectedId, edges]);

  const layout = useMemo(() => {
    if (!visibleNodes.length) return new Map<string, { x: number; y: number }>();
    const cx = 300;
    const cy = 220;
    const persons = visibleNodes.filter((n) => n.type === "person");
    const center =
      persons.sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))[0] ??
      visibleNodes[0];
    const others = visibleNodes.filter((n) => n.id !== center.id);
    // 按类型分组，同类型放相邻扇区
    const groups = new Map<string, Node[]>();
    for (const n of others) {
      const key = n.type ?? "other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(n);
    }
    const pos = new Map<string, { x: number; y: number }>();
    pos.set(center.id, { x: cx, y: cy });
    const groupKeys = [...groups.keys()];
    const radius = Math.max(120, others.length * 18);
    let start = -Math.PI / 2;
    for (const key of groupKeys) {
      const members = groups.get(key)!;
      const span = (Math.PI * 2 * members.length) / Math.max(1, others.length);
      members.forEach((n, i) => {
        const angle = start + span * (i + 0.5) / members.length;
        pos.set(n.id, {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
        });
      });
      start += (Math.PI * 2 * members.length) / Math.max(1, others.length);
    }
    return pos;
  }, [visibleNodes, degree]);

  const visibleEdges = edges.filter(
    (e) => visibleIds.has(e.source) && visibleIds.has(e.target),
  );

  const types = [...new Set(nodes.map((n) => n.type ?? "other"))];

  return (
    <div className="page">
      <PageHeader
        title="故事知识图谱"
        description="人物 · 事件 · 情绪点 · 爽点 · 钩子 · 道具，点击节点高亮邻域"
        breadcrumb={
          <Button variant="ghost" size="sm" onClick={() => nav({ to: "/kb/docs/$id", params: { id } })}>
            ← 返回文档
          </Button>
        }
      />
      <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {types.map((t) => {
          const meta = NODE_TYPE_META[t] ?? NODE_TYPE_META.other;
          const on = !hidden[t];
          return (
            <button
              key={t}
              type="button"
              className="badge"
              onClick={() => setHidden((h) => ({ ...h, [t]: !h[t] }))}
              style={{
                borderColor: meta.color,
                color: meta.color,
                opacity: on ? 1 : 0.35,
                cursor: "pointer",
              }}
            >
              {meta.label}
            </button>
          );
        })}
        {selectedId && (
          <button type="button" className="badge" onClick={() => setSelectedId(null)}>
            清除选中
          </button>
        )}
      </div>
      <div className="split" style={{ height: "auto" }}>
        <div className="graph-canvas">
          <svg width="100%" height="100%" viewBox="0 0 600 440" role="img" aria-label="故事知识图谱">
            {visibleEdges.map((e) => {
              const s = layout.get(e.source);
              const t = layout.get(e.target);
              if (!s || !t) return null;
              const dimmed = selectedId && !(neighbors.has(e.source) && neighbors.has(e.target));
              return (
                <g key={e.id} opacity={dimmed ? 0.12 : 0.9}>
                  <line
                    x1={s.x}
                    y1={s.y}
                    x2={t.x}
                    y2={t.y}
                    stroke="var(--line-strong)"
                    strokeWidth={1.4}
                  />
                  <text
                    x={(s.x + t.x) / 2}
                    y={(s.y + t.y) / 2 - 3}
                    fontSize="10"
                    fill="var(--ink-muted)"
                    textAnchor="middle"
                  >
                    {e.relationType ?? ""}
                  </text>
                </g>
              );
            })}
            {visibleNodes.map((n) => {
              const p = layout.get(n.id);
              if (!p) return null;
              const active = n.id === selectedId;
              const inNeighbor = selectedId && neighbors.has(n.id);
              const dimmed = selectedId && !inNeighbor;
              const color = nodeColor(n);
              return (
                <g
                  key={n.id}
                  onClick={() => setSelectedId(active ? null : n.id)}
                  style={{ cursor: "pointer" }}
                  opacity={dimmed ? 0.18 : 1}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={active ? 22 : n.type === "person" ? 16 : 13}
                    fill={color}
                    fillOpacity={active ? 1 : 0.18}
                    stroke={color}
                    strokeWidth={active || inNeighbor ? 2.2 : 1.2}
                  />
                  <text
                    x={p.x}
                    y={p.y + 4}
                    textAnchor="middle"
                    fontSize="10"
                    fill="var(--ink)"
                    fontWeight={active ? 700 : 500}
                  >
                    {(n.label ?? "").length > 7 ? `${n.label.slice(0, 7)}…` : n.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <Panel title="节点 / 关系">
          {selectedId ? (
            <div className="stack" style={{ gap: 6 }}>
              <strong style={{ fontSize: 13 }}>
                {nodes.find((n) => n.id === selectedId)?.label ?? selectedId}
              </strong>
              <span className="muted" style={{ fontSize: 12 }}>
                关联 {neighbors.size - 1} 个节点
              </span>
              {edges
                .filter((e) => e.source === selectedId || e.target === selectedId)
                .map((e) => {
                  const other = e.source === selectedId ? e.target : e.source;
                  const label = nodes.find((n) => n.id === other)?.label ?? other;
                  return (
                    <div key={e.id} className="row" style={{ fontSize: 12, gap: 6 }}>
                      <span className="badge">{e.relationType ?? "相关"}</span>
                      <span>{label}</span>
                    </div>
                  );
                })}
            </div>
          ) : (
            <div className="stack" style={{ gap: 6, maxHeight: 360, overflowY: "auto" }}>
              {nodes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="row"
                  style={{ gap: 6, alignItems: "baseline", fontSize: 12, cursor: "pointer" }}
                  onClick={() => setSelectedId(n.id)}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: nodeColor(n),
                    }}
                  />
                  <span style={{ flex: 1, textAlign: "left" }}>{n.label}</span>
                  <span className="badge">{NODE_TYPE_META[n.type ?? "other"]?.label ?? "其他"}</span>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
