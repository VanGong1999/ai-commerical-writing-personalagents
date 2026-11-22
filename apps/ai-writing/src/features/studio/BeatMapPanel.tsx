import {
  defaultCharlieBeatRows,
  type Artifact,
  type CharlieBeatRow,
  type EpisodeOutlineBody,
  type ManuscriptBody,
  type ProjectFormat,
  type StoryAnchor,
} from "@xiezuomanju/domain";
import { Badge, CollapsibleSection } from "@xiezuomanju/ui";
import { useMemo, useState } from "react";
import { usePersistedState } from "./usePersistedState";
import { bodyTextOf, bodyTypesFor, bodyUnitNo } from "./deliverables";

export type BeatKind = "paywall" | "cliff" | "emotion_peak" | "cool" | "beat";

export const KIND_META: Record<
  BeatKind,
  { label: string; color: string; bg: string }
> = {
  paywall: { label: "付费点", color: "#e5484d", bg: "rgba(229,72,77,.12)" },
  cliff: { label: "钩子/卡点", color: "#8b5cf6", bg: "rgba(139,92,246,.12)" },
  emotion_peak: { label: "情绪点", color: "#3b82f6", bg: "rgba(59,130,246,.12)" },
  cool: { label: "爽点", color: "#30a46c", bg: "rgba(48,164,108,.12)" },
  beat: { label: "节奏", color: "#8a8f98", bg: "rgba(138,143,152,.10)" },
};

type MapNode = {
  id: string;
  label: string;
  sub?: string;
  kind: BeatKind;
  episodeNo?: number;
  sceneNo?: number;
  intensity?: number;
};

function outlineAnchors(body: EpisodeOutlineBody): StoryAnchor[] {
  const list = Array.isArray(body.anchors) ? body.anchors : [];
  if (list.length) return list;
  // 兜底：从已有字段推导锚点，保证老数据也有情节点地图
  const derived: StoryAnchor[] = [];
  if (body.paywallPoint || body.paywallHint) {
    derived.push({
      id: `pay-${body.episodeNo}`,
      kind: "paywall",
      label: body.paywallPoint || body.paywallHint || "付费点",
      episodeNo: body.episodeNo,
    });
  }
  if (body.cliffType || body.cliffText) {
    derived.push({
      id: `cliff-${body.episodeNo}`,
      kind: "cliff",
      label: [body.cliffType, body.cliffText].filter(Boolean).join("：") || "卡点",
      episodeNo: body.episodeNo,
    });
  }
  if (typeof body.emotionPeak === "number") {
    derived.push({
      id: `emo-${body.episodeNo}`,
      kind: "emotion_peak",
      label: `情绪峰 ${body.emotionPeak}`,
      episodeNo: body.episodeNo,
      intensity: body.emotionPeak,
    });
  }
  if (body.coolPoint || (body.coolModels?.length ?? 0) > 0) {
    derived.push({
      id: `cool-${body.episodeNo}`,
      kind: "cool",
      label: body.coolModels?.join("·") || body.coolPoint || "爽点",
      episodeNo: body.episodeNo,
    });
  }
  return derived;
}

function beatNode(r: CharlieBeatRow): MapNode {
  const kind: BeatKind = r.payHint
    ? "paywall"
    : (r.intensity ?? 3) >= 4
      ? "emotion_peak"
      : "beat";
  return {
    id: `beat-${r.no}`,
    label: `${r.no} ${r.name}`,
    sub: r.conflict || r.emotion || KIND_META[kind].label,
    kind,
    intensity: r.intensity,
  };
}

export function BeatMapPanel({
  projectId,
  format,
  artifacts,
}: {
  projectId?: string;
  format: ProjectFormat;
  artifacts: Artifact[];
}) {
  const outlines = useMemo(
    () =>
      artifacts
        .filter((a) => a.type === "episode_outline")
        .sort(
          (a, b) =>
            Number((a.bodyJson as { episodeNo?: number })?.episodeNo ?? 0) -
            Number((b.bodyJson as { episodeNo?: number })?.episodeNo ?? 0),
        ),
    [artifacts],
  );
  const manuscripts = useMemo(
    () =>
      artifacts
        .filter((a) => bodyTypesFor(format).includes(a.type))
        .sort((a, b) => bodyUnitNo(a) - bodyUnitNo(b)),
    [artifacts, format],
  );
  const [beatRows] = usePersistedState<CharlieBeatRow[]>(
    projectId,
    "beat20-charlie",
    defaultCharlieBeatRows(),
  );

  const nodes: MapNode[] = useMemo(() => {
    if (format === "duanju" && beatRows.length) {
      return beatRows.map(beatNode);
    }
    const n: MapNode[] = [];
    for (const a of outlines) {
      const b = a.bodyJson as EpisodeOutlineBody;
      for (const anchor of outlineAnchors(b)) {
        n.push({
          id: `${a.id}:${anchor.id}`,
          label: `EP${b.episodeNo ?? "?"} ${anchor.label || KIND_META[anchor.kind].label}`,
          sub: anchor.kind === "beat" ? b.title : undefined,
          kind: anchor.kind,
          episodeNo: b.episodeNo,
          sceneNo: anchor.sceneNo,
          intensity: anchor.intensity,
        });
      }
      if (!n.some((x) => x.episodeNo === b.episodeNo)) {
        n.push({
          id: `${a.id}:ep`,
          label: `EP${b.episodeNo ?? "?"} ${b.title}`,
          sub: b.summary,
          kind: "beat",
          episodeNo: b.episodeNo,
        });
      }
    }
    return n;
  }, [format, beatRows, outlines]);

  const [hidden, setHidden] = useState<Record<BeatKind, boolean>>({
    paywall: false,
    cliff: false,
    emotion_peak: false,
    cool: false,
    beat: false,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible = nodes.filter((n) => !hidden[n.kind]);
  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  const relatedOutlines = useMemo(() => {
    if (!selected?.episodeNo) return [];
    return outlines.filter(
      (a) => Number((a.bodyJson as { episodeNo?: number })?.episodeNo) === selected.episodeNo,
    );
  }, [selected, outlines]);
  const relatedManuscripts = useMemo(() => {
    if (!selected?.episodeNo) return [];
    return manuscripts.filter((m) => bodyUnitNo(m) === selected.episodeNo);
  }, [selected, manuscripts]);

  const toggleKind = (k: BeatKind) =>
    setHidden((h) => ({ ...h, [k]: !h[k] }));
  const allKinds = Object.keys(KIND_META) as BeatKind[];

  return (
    <CollapsibleSection
      title="情节点地图 · 付费/卡点/情绪/爽点"
      badge={`${visible.length}/${nodes.length} 节点`}
      summary="点某块，下方高亮它在正文/大纲中的关联片段"
      storageKey={projectId ? `deliverable-${projectId}-beat-map` : undefined}
      defaultOpen={false}
    >
      {nodes.length === 0 ? (
        <div className="empty">先生成大纲或 20 拍，这里会出现情节点地图。</div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {allKinds.map((k) => {
              const meta = KIND_META[k];
              const on = !hidden[k];
              return (
                <button
                  key={k}
                  type="button"
                  className="badge"
                  onClick={() => toggleKind(k)}
                  title={`点此${on ? "隐藏" : "显示"}全部${meta.label}`}
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
              <button
                type="button"
                className="badge"
                onClick={() => setSelectedId(null)}
                style={{ cursor: "pointer" }}
              >
                清除选中
              </button>
            )}
          </div>

          <div
            className="row"
            style={{ flexWrap: "wrap", gap: 8, alignItems: "stretch" }}
            role="list"
            aria-label="情节点地图"
          >
            {visible.map((n) => {
              const meta = KIND_META[n.kind];
              const active = n.id === selectedId;
              return (
                <button
                  key={n.id}
                  type="button"
                  role="listitem"
                  className="beat-map-node"
                  onClick={() => setSelectedId(active ? null : n.id)}
                  style={{
                    textAlign: "left",
                    cursor: "pointer",
                    border: `1px solid ${meta.color}`,
                    background: active ? meta.bg : "transparent",
                    borderRadius: 8,
                    padding: "8px 10px",
                    minWidth: 120,
                    maxWidth: 220,
                    outline: active ? `2px solid ${meta.color}` : "none",
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      fontSize: 11,
                      fontWeight: 700,
                      color: meta.color,
                    }}
                  >
                    {meta.label}
                  </span>
                  <span style={{ display: "block", fontSize: 12, fontWeight: 600 }}>
                    {n.label}
                  </span>
                  {n.sub ? (
                    <span
                      style={{
                        display: "block",
                        fontSize: 11,
                        color: "var(--ink-muted)",
                        marginTop: 2,
                      }}
                    >
                      {n.sub.length > 40 ? `${n.sub.slice(0, 40)}…` : n.sub}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {selected ? (
            <div className="stack" style={{ gap: 8 }}>
              <div>
                <strong style={{ fontSize: 13 }}>关联片段 · {selected.label}</strong>
                <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
                  点亮的节拍会在这里列出它在正文与大纲中的全部落点。
                </p>
              </div>
              {relatedOutlines.length === 0 && relatedManuscripts.length === 0 ? (
                <div className="empty">该情节点暂无正文/大纲落点，可在分集正文里补锚点。</div>
              ) : null}
              {relatedOutlines.map((a) => {
                const b = a.bodyJson as EpisodeOutlineBody;
                return (
                  <div key={a.id} className="help-callout" style={{ margin: 0 }}>
                    <div className="help-callout__title">
                      大纲 EP{b.episodeNo} · {b.title}
                    </div>
                    <div className="help-callout__body">{b.summary}</div>
                  </div>
                );
              })}
              {relatedManuscripts.map((m) => {
                const b = m.bodyJson as ManuscriptBody;
                const text = bodyTextOf(m);
                const no = bodyUnitNo(m);
                return (
                  <div key={m.id} className="help-callout" style={{ margin: 0 }}>
                    <div className="help-callout__title">
                      {m.type === "scene"
                        ? `场 ${(m.bodyJson as { scene_header?: string } | null)?.scene_header ?? no}`
                        : `正文 EP${no}`}{" "}
                      · {b.wordCount ?? text.replace(/\s/g, "").length} 字
                      {m.status === "adopted" ? <Badge tone="ok">已定稿</Badge> : null}
                    </div>
                    <div className="help-callout__body">
                      {text.slice(0, 160)}
                      {text.length > 160 ? "…" : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      )}
    </CollapsibleSection>
  );
}
