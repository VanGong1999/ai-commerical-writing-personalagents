import { SelectionActions, sourceSelection } from "../references/SelectionActions";
import type { ContextRef } from "../references/selection";
import type { ProjectFormat, StoryAnchor } from "@xiezuomanju/domain";
import { useState } from "react";
import { KIND_META, type BeatKind } from "./BeatMapPanel";
import { SpanFeedbackBar } from "./SpanFeedbackBar";

const EMOTION_WORDS = [
  "崩溃",
  "痛哭",
  "流泪",
  "泪",
  "愤怒",
  "震惊",
  "绝望",
  "心碎",
  "委屈",
  "失控",
  "崩溃大哭",
];
const COOL_WORDS = ["打脸", "反转", "碾压", "装逼", "震惊", "跪了", "服了", "惊叹", "扬眉吐气", "复仇"];

type LineTag = { kind: BeatKind; label: string };

function classifyLine(
  line: string,
  isScript: boolean,
  isLastBlock: boolean,
): LineTag[] {
  const tags: LineTag[] = [];
  const t = line.trim();
  if (!t) return tags;

  // 剧本结构标记：场头 / 动作 / 旁白
  if (isScript) {
    if (/^场\s*\d+\s*[-–—]\s*\d+/.test(t)) {
      tags.push({ kind: "beat", label: "节奏·场" });
    }
    if (/【结尾卡点|卡点[：:]/.test(t) || /^【?结尾卡点/.test(t)) {
      tags.push({ kind: "paywall", label: "付费卡点" });
      tags.push({ kind: "cliff", label: "卡点" });
    }
    if (t.startsWith("VO")) tags.push({ kind: "beat", label: "节奏·旁白" });
  } else if (isLastBlock && /然而|可是|谁知|没想到|不料|就在这时/.test(t)) {
    tags.push({ kind: "cliff", label: "章末钩" });
  }

  if (EMOTION_WORDS.some((w) => t.includes(w))) {
    tags.push({ kind: "emotion_peak", label: "情绪点" });
  }
  if (COOL_WORDS.some((w) => t.includes(w))) {
    tags.push({ kind: "cool", label: "爽点" });
  }

  // 去重（同 kind 只保留一次）
  const seen = new Set<BeatKind>();
  return tags.filter((tag) => {
    if (seen.has(tag.kind)) return false;
    seen.add(tag.kind);
    return true;
  });
}

export function ManuscriptAnnotatedView({
  text,
  format,
  anchors = [],
  artifactId,
  projectId,
  artifactVersion,
  referenceSource,
}: {
  text: string;
  format: ProjectFormat;
  anchors?: StoryAnchor[];
  /** 传入后可在选中段落时做 👍/👎 反馈 */
  artifactId?: string;
  projectId?: string;
  artifactVersion?: number;
  referenceSource?: ContextRef;
}) {
  const isScript = format === "manju" || format === "duanju" || format === "ip_adapt";
  const [selection, setSelection] = useState("");
  const [range,setRange] = useState<{start:number;end:number} | null>(null);
  const onSelectionEnd = (event: React.SyntheticEvent<HTMLDivElement>) => {
    setRange(sourceSelection(event.currentTarget));
    if (!artifactId) return;
    const s = window.getSelection()?.toString().trim() ?? "";
    setSelection(s.length >= 4 ? s.slice(0, 4000) : "");
  };
  const lines = text.split("\n");
  let sourceOffset = 0;
  const lineStarts = lines.map(line => {const start=sourceOffset;sourceOffset+=line.length+1;return start;});
  // 小说按空行分块，最后一块视为章末
  let block = 0;
  const lineBlocks = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      block += 1;
      return block - 1;
    }
    return block;
  });
  const maxBlock = Math.max(0, ...lineBlocks);

  const anchorChips = anchors.slice(0, 12);

  return (
    <div className="stack" style={{ gap: 8 }}>
      {anchorChips.length > 0 && (
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          <span className="muted" style={{ fontSize: 11 }}>
            本集锚点
          </span>
          {anchorChips.map((a) => {
            const meta = KIND_META[a.kind] ?? KIND_META.beat;
            return (
              <span
                key={a.id}
                className="badge"
                style={{ borderColor: meta.color, color: meta.color, fontSize: 11 }}
              >
                {a.label || meta.label}
              </span>
            );
          })}
        </div>
      )}
      {referenceSource && <SelectionActions source={referenceSource} text={text} range={range} />}
      {selection && artifactId && (
        <SpanFeedbackBar
          text={selection}
          artifactId={artifactId}
          projectId={projectId}
          format={format}
          artifactVersion={artifactVersion}
          onDone={() => setSelection("")}
        />
      )}
      <div
        onMouseUp={onSelectionEnd}
        onKeyUp={onSelectionEnd}
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 14,
          lineHeight: 1.8,
          background: "var(--bg-elevated, transparent)",
          border: "1px solid var(--border, #e5e5e5)",
          borderRadius: 8,
          padding: "10px 12px",
          maxHeight: 560,
          overflowY: "auto",
        }}
      >
        {lines.map((line, i) => {
          const tags = classifyLine(line, isScript, lineBlocks[i] === maxBlock);
          const primary = tags[0];
          const no = i + 1;
          if (!line.trim()) {
            return (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "34px 1fr 118px",
                  gap: 8,
                  minHeight: 12,
                }}
              >
                <span style={{ color: "var(--ink-muted)", fontSize: 11, textAlign: "right" }}>{no}</span>
                <span data-source-start={lineStarts[i]} style={{whiteSpace:"pre-wrap"}}>{line}</span>
                <span style={{userSelect:"none"}} />
              </div>
            );
          }
          return (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "34px 1fr 118px",
                gap: 8,
                alignItems: "baseline",
                background: primary ? KIND_META[primary.kind].bg : "transparent",
                borderRadius: 4,
                padding: "1px 0",
              }}
            >
              <span
                style={{
                  color: "var(--ink-muted)",
                  fontSize: 11,
                  textAlign: "right",
                  userSelect: "none",
                }}
              >
                {no}
              </span>
              <span
                data-source-start={lineStarts[i]}
                style={{
                  borderLeft: primary
                    ? `3px solid ${KIND_META[primary.kind].color}`
                    : "3px solid transparent",
                  paddingLeft: primary ? 6 : 9,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {line}
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, userSelect:"none" }}>
                {tags.map((tag) => {
                  const meta = KIND_META[tag.kind];
                  return (
                    <span
                      key={tag.kind}
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: meta.color,
                        border: `1px solid ${meta.color}`,
                        borderRadius: 999,
                        padding: "0 6px",
                        lineHeight: 1.55,
                        textAlign: "center",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tag.label}
                    </span>
                  );
                })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
