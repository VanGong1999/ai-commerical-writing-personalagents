import { observeDraftSave, finishDraftSave, firstManuscriptKey, reconcileFirstManuscript, clearSavedDraft, manuscriptSourceId, readManuscriptDraft, writeManuscriptDraft } from "./manuscriptAccess";
import { bodyUnitNo } from "./pendingUnits";
export { bodyUnitNo };
import { SelectionActions } from "../references/SelectionActions";
import { applySelectionEdit, type ContextRef } from "../references/selection";
import { registerDraftTarget, textHash } from "../references/draftTargets";
import { EpisodeOutlineBodySchema, type Artifact, type ProjectFormat, type StoryAnchor } from "@xiezuomanju/domain";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  CollapsibleSection,
  DiffCompare,
  MarkdownDocument,
  Panel,
  ProgressBar,
  Tabs,
  toast,
} from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { Check, ChevronRight } from "lucide-react";
import { ArtifactEvalPanel } from "../eval/ArtifactEvalPanel";
import { DeAiWorkbench } from "./DeAiWorkbench";
import {
  CoolPointWorkbench,
  DialogueTripleWorkbench,
  ForesightWorkbench,
  PitchSpecWorkbench,
  SettingWorkbench,
  SevenStepCharWorkbench,
} from "./DeepMethodPanels";
import { Fragment, useLayoutEffect, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { runAgentFeedback } from "./runAgentFeedback";
import { ArtifactVersionHistory } from "./ArtifactVersionHistory";
import { BestOfNPanel } from "./BestOfNPanel";
import { CharacterGraphPanel } from "./CharacterGraphPanel";
import { biographyFields, characterProfiles, updateBiographyProfile, type CharacterProfile } from "./characterProfiles";
import { CowritePanel } from "../cowrite/CowritePanel";
import { ManuscriptAnnotatedView } from "./ManuscriptAnnotatedView";
import {
  loadWordTarget,
  persistWordTarget,
  type WordTarget,
} from "./wordTarget";
import { downloadExport, englishOf, type ExportFormat } from "./exportUtils";

export type SynopsisParts = {
  identity: string;
  conflict: string;
  turn: string;
  finger: string;
  /** 13.md 导语五要素：力量悬殊（IP 轨） */
  powerGap?: string;
};

const DEFAULT_SYNOPSIS_PARTS: SynopsisParts = {
  identity: "",
  conflict: "",
  turn: "",
  finger: "",
  powerGap: "",
};

type OutlineTextEpisode = {
  title: string;
  summary: string;
  beats: string[];
  thrill: string;
  trap: string;
  block: string;
};

const OUTLINE_LITERAL_PREFIX = "JSON ";

function outlineLiteral(value: string | string[]): string {
  return OUTLINE_LITERAL_PREFIX + JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function outlineNeedsLiteral(value: string): boolean {
  return value.startsWith(OUTLINE_LITERAL_PREFIX) || /[\r\n\u2028\u2029]/.test(value) || value.trim() !== value;
}

function outlineStringToken(value: unknown): string {
  const text = outlineField(value);
  return outlineNeedsLiteral(text) ? outlineLiteral(text) : text;
}

function readOutlineLiteral(text: string): unknown {
  if (!text.startsWith(OUTLINE_LITERAL_PREFIX)) return undefined;
  try {
    return JSON.parse(text.slice(OUTLINE_LITERAL_PREFIX.length));
  } catch {
    return undefined;
  }
}

function outlineStringValue(text: string): string {
  const value = readOutlineLiteral(text);
  return typeof value === "string" ? value : text;
}

function parseOutlineText(text: string) {
  const matches = [...text.matchAll(/^第(\d+)集[ \t]*(.*)$/gm)];
  const parsed = new Map<number, OutlineTextEpisode>();
  for (const [index, match] of matches.entries()) {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? text.length;
    const block = text.slice(start, end).trim();
    const line = (label: string) => {
      const found = block.match(new RegExp(`^${label}[：:][ \t]*(.*)$`, "m"));
      return found?.[1]?.trim() ?? "";
    };
    const episodeNo = Number(match[1]);
    if (parsed.has(episodeNo)) return null;
    const beatText = line("情节点");
    const beatLiteral = readOutlineLiteral(beatText);
    const beats = Array.isArray(beatLiteral) && beatLiteral.every((beat) => typeof beat === "string")
      ? beatLiteral
      : beatText.split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
    parsed.set(episodeNo, {
      title: outlineStringValue(match[2]?.trim() ?? ""),
      summary: outlineStringValue(line("摘要")),
      beats,
      thrill: outlineStringValue(line("爽点")),
      trap: outlineStringValue(line("卡点")),
      block,
    });
  }
  return parsed;
}

function outlineField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function outlineEpisodeNo(artifact: Artifact): number {
  const value = artifact.bodyJson?.episodeNo;
  const number = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function outlineFallbackMarkdown(artifact: Artifact): string | undefined {
  const markdown = artifact.bodyMarkdown;
  return !outlineField(artifact.bodyJson?.summary).trim() && markdown?.trim() ? markdown : undefined;
}

function composeEpisodeBlock(artifact: Artifact, episodeNo: number): string {
  const body = artifact.bodyJson ?? {};
  const beats = Array.isArray(body.beats) ? body.beats.filter((beat) => typeof beat === "string") : [];
  const beatText = beats.some((beat) => !beat || /[、,，]/.test(beat) || outlineNeedsLiteral(beat))
    ? outlineLiteral(beats)
    : beats.join("、");
  return [
    `第${episodeNo}集 ${outlineStringToken(body.title)}`,
    `摘要：${outlineStringToken(body.summary)}`,
    `情节点：${beatText}`,
    `爽点：${outlineStringToken(body.thrill)}`,
    `卡点：${outlineStringToken(body.trap)}`,
  ].join("\n");
}

type OutlineTextRow = { artifact: Artifact; episodeNo: number; block: string };
type OutlineTextDraft = { text: string; rows: OutlineTextRow[] };

function ambiguousOutlineEpisodes(rows: OutlineTextRow[]): Set<number> {
  const seen = new Set<number>();
  const ambiguous = new Set<number>();
  for (const { episodeNo } of rows) {
    if (seen.has(episodeNo)) ambiguous.add(episodeNo);
    seen.add(episodeNo);
  }
  return ambiguous;
}

function outlineDraftText(rows: OutlineTextRow[]): string {
  const ambiguous = ambiguousOutlineEpisodes(rows);
  return rows.filter((row) => !ambiguous.has(row.episodeNo)).map((row) => row.block).join("\n\n");
}

export function OutlineStoredVersion({ row }: { row?: OutlineTextRow }) {
  if (!row) return <pre className="prose-block">请选择集数</pre>;
  const markdown = row.artifact.bodyMarkdown;
  return (
    <div className="stack">
      <div>
        <strong>当前表格字段</strong>
        <pre className="prose-block">{row.block}</pre>
      </div>
      {markdown && markdown !== row.block ? (
        <div>
          <strong>原样存档 Markdown</strong>
          <pre className="prose-block">{markdown}</pre>
        </div>
      ) : null}
    </div>
  );
}

export function createOutlineTextDraft(artifacts: Artifact[]): OutlineTextDraft {
  const rows = artifacts.flatMap((artifact) => {
    const episodeNo = outlineEpisodeNo(artifact);
    return episodeNo ? [{ artifact, episodeNo, block: composeEpisodeBlock(artifact, episodeNo) }] : [];
  });
  return { rows, text: outlineDraftText(rows) };
}

export function outlineTextUpdates(draft: OutlineTextDraft) {
  const parsed = parseOutlineText(draft.text);
  const ambiguous = ambiguousOutlineEpisodes(draft.rows);
  if (!parsed?.size || [...ambiguous].some((episodeNo) => parsed.has(episodeNo))) return null;

  return draft.rows.flatMap(({ artifact, episodeNo, block }) => {
    const episode = parsed.get(episodeNo);
    if (!episode || episode.block === block) return [];
    const body = artifact.bodyJson ?? {};
    const fallbackMarkdown = outlineFallbackMarkdown(artifact);
    return [{
      artifactId: artifact.id,
      episodeNo,
      block: episode.block,
      patch: {
        expectedVersion: artifact.version,
        bodyJson: {
          ...body,
          title: episode.title || body.title,
          ...(episode.summary || (!fallbackMarkdown && body.summary !== undefined)
            ? { summary: episode.summary }
            : {}),
          beats: episode.beats,
          ...(episode.thrill || body.thrill !== undefined ? { thrill: episode.thrill } : {}),
          ...(episode.trap || body.trap !== undefined ? { trap: episode.trap } : {}),
          revisedAt: new Date().toISOString(),
        },
        bodyMarkdown: fallbackMarkdown ?? episode.block,
      },
    }];
  });
}

export function rebaseOutlineTextRow(draft: OutlineTextDraft, latest: OutlineTextRow): OutlineTextDraft {
  return {
    ...draft,
    rows: draft.rows.map((row) => row.artifact.id === latest.artifact.id ? latest : row),
  };
}

export async function saveOutlineTextDraft(
  draft: OutlineTextDraft,
  update: (artifactId: string, patch: Parameters<typeof api.updateArtifact>[2]) => Promise<Artifact>,
) {
  const updates = outlineTextUpdates(draft);
  if (!updates) return null;
  const results = await Promise.allSettled(updates.map(async ({ artifactId, patch }) => update(artifactId, patch)));
  const saved = new Map<string, OutlineTextRow>();
  const conflicts: number[] = [];
  const failed: number[] = [];
  results.forEach((result, index) => {
    const { artifactId, episodeNo, block } = updates[index];
    if (result.status === "fulfilled") {
      saved.set(artifactId, { artifact: result.value, episodeNo, block });
    } else if (result.reason instanceof Error && result.reason.message.includes('"version_conflict"')) {
      conflicts.push(episodeNo);
    } else {
      failed.push(episodeNo);
    }
  });
  return {
    draft: { ...draft, rows: draft.rows.map((row) => saved.get(row.artifact.id) ?? row) },
    saved,
    conflicts,
    failed,
  };
}

function composeSynopsis(parts: SynopsisParts) {
  const identity = parts.identity.trim();
  const conflict = parts.conflict.trim();
  const turn = parts.turn.trim();
  const finger = parts.finger.trim();
  const powerGap = (parts.powerGap ?? "").trim();
  if (!identity && !conflict && !turn && !finger && !powerGap) return "";
  const base = `${identity || "（身份）"}，面对${conflict || "（矛盾）"}，因${turn || "（转折）"}，靠${finger || "（金手指）"}破局。`;
  return powerGap ? `${base}力量悬殊：${powerGap}` : base;
}

function loadSynopsisParts(projectId?: string): SynopsisParts {
  if (!projectId) return DEFAULT_SYNOPSIS_PARTS;
  try {
    const raw = localStorage.getItem(`synopsis-parts:${projectId}`);
    if (!raw) return DEFAULT_SYNOPSIS_PARTS;
    return { ...DEFAULT_SYNOPSIS_PARTS, ...(JSON.parse(raw) as SynopsisParts) };
  } catch {
    return DEFAULT_SYNOPSIS_PARTS;
  }
}

/** 九格投稿公文包：核心梗 + 人物小传 + 分集大纲 + 正文 */
export type DeliverableId =
  | "package"
  | "hook"
  | "synopsis"
  | "setting"
  | "characters"
  | "outline"
  | "emotion"
  | "manuscript"
  | "qc"
  | "foresight";

export const MANJU_DELIVERABLES: {
  id: DeliverableId;
  label: string;
  hint: string;
}[] = [
  { id: "package", label: "交稿包", hint: "3 集正文 + 10 集大纲 + 小传 + 核心梗" },
  { id: "hook", label: "核心梗", hint: "标题钩 / 动机 / 危机 / 开篇" },
  { id: "synopsis", label: "一句话梗概", hint: "身份 + 矛盾 + 转折 + 金手指" },
  { id: "setting", label: "设定包", hint: "五要素 · 金手指 · 世界观" },
  { id: "characters", label: "人物小传", hint: "外貌 / 动机 / 关系网" },
  { id: "outline", label: "分集大纲", hint: "表格 ↔ 文字双视图 · 爽点/卡点" },
  { id: "emotion", label: "情绪曲线", hint: "-10～+10 量化" },
  { id: "manuscript", label: "分集正文", hint: "分镜画面 + 台词" },
  { id: "foresight", label: "伏笔钩子", hint: "从结局倒推集尾" },
  { id: "qc", label: "质检门禁", hint: "五维精修 · 去 AI 味" },
];

const FORMAT_DELIVERABLE_OVERRIDES: Record<
  Exclude<Parameters<typeof deliverablesForFormat>[0], "manju">,
  Partial<Record<DeliverableId, { label: string; hint: string }>>
> = {
  duanju: {
    package: { label: "投稿包", hint: "十集大纲 + 人物 + 分场剧本 + 质检" },
    synopsis: { label: "一句话卖点", hint: "身份 + 欲望 + 阻力 + 反转" },
    characters: { label: "人物小传", hint: "功能位 / 欲望 / 恐惧 / 关系" },
    outline: { label: "十集大纲", hint: "爽点 / 卡点 / 集尾钩" },
    manuscript: { label: "分场剧本", hint: "场景 / 动作 / 台词" },
    qc: { label: "短剧质检", hint: "节拍 / 卡点 / 付费点" },
  },
  short_novel: {
    package: { label: "短篇交稿包", hint: "拆书参数 + 换元 + 总纲 + 章纲细纲 + 成稿" },
    synopsis: { label: "总纲/故事梗概", hint: "大期待·小期待·因果；禁止跳过直接写细纲" },
    characters: { label: "框架·人设", hint: "短篇可省世界观/金手指；文风与角色通常必填" },
    outline: {
      label: "章纲·细纲·七步法",
      hint: "单元故事排列 → 情节点控长 → 目标阻碍行动结果意外转折结局",
    },
    manuscript: { label: "正文初稿", hint: "分段 2000～3000 字；用情节点个数控长" },
    qc: { label: "修改·质检", hint: "P1框架→P2情绪节奏→P3去AI味；写一章改一章" },
  },
  male_long: {
    package: { label: "男频样章包", hint: "人设 + 卷纲 + 样章 + 爽点报告" },
    synopsis: { label: "一句话梗概", hint: "身份 + 金手指 + 升级目标" },
    characters: { label: "人设卡", hint: "主性格稳定 / 能力成长" },
    outline: { label: "卷纲章纲", hint: "升级循环 / 爽点密度" },
    manuscript: { label: "样章正文", hint: "压抑 → 爆发 → 打脸 → 新目标" },
    qc: { label: "爽点雷区", hint: "金手指限制 / 爽点对比 / 风险" },
  },
  female_long: {
    package: { label: "女频样章包", hint: "人设 + 卷纲 + 样章 + 节奏报告" },
    synopsis: { label: "一句话梗概", hint: "关系张力 + 成长目标 + 反转" },
    characters: { label: "人设卡", hint: "动机 / 关系 / 成长弧" },
    outline: { label: "卷纲章纲", hint: "追妻火葬场 / 拉扯节奏" },
    manuscript: { label: "样章正文", hint: "情绪推进 / 关系变化" },
    qc: { label: "女频质检", hint: "雷区 / 付费点 / 留存" },
  },
  ip_adapt: {
    package: { label: "改编交稿包", hint: "锚定表 + 单元 + 情绪 + 剧本" },
    synopsis: { label: "改编梗概", hint: "主语 + 冲突 + 单元 + 压缩方向" },
    characters: { label: "人物锚定", hint: "原作保留 / 合并 / 删减" },
    outline: { label: "单元故事表", hint: "主线保留 / 支线合并" },
    manuscript: { label: "压缩剧本", hint: "单集节奏 / 付费卡点" },
    qc: { label: "改编质检", hint: "情绪量化 / 信息密度 / 风险" },
  },
};

export function deliverablesForFormat(format: ProjectFormat) {
  if (format === "manju") return MANJU_DELIVERABLES;
  // 非漫剧不挂「漫剧情绪曲线 / -10~+10」交付物：各格式的节奏/爽点/情绪轨迹
  // 已在各自面板（查理五爽点 / IP 情绪轨迹 / 女频节奏）内表达，不在左栏重复漫剧口径。
  const ids = [
    "package",
    "synopsis",
    "characters",
    "outline",
    "manuscript",
    "qc",
  ] as const;
  const overrides = FORMAT_DELIVERABLE_OVERRIDES[format];
  return ids.map((id) => ({
    ...MANJU_DELIVERABLES.find((item) => item.id === id)!,
    ...overrides[id],
  }));
}

function artifactHasBody(artifact: Artifact): boolean {
  if (artifact.bodyMarkdown?.trim()) return true;
  const body = artifact.bodyJson;
  return Boolean(body && typeof body === "object" && Object.keys(body).length > 0);
}

function outlineIsReady(artifact: Artifact, format: ProjectFormat): boolean {
  // 非分集格式的大纲产物类型不同：章纲/细纲/总纲/卷纲都算「大纲」交付。
  const chapterLike = new Set([
    "chapter_outline",
    "beat_sheet",
    "master_outline",
    "volume_outline",
  ]);
  if (chapterLike.has(artifact.type)) {
    return artifactHasBody(artifact);
  }
  if (artifact.type !== "episode_outline") return false;
  const body = artifact.bodyJson;
  const markdown = artifact.bodyMarkdown?.trim();
  if (format === "manju" || format === "duanju") {
    const parsed = EpisodeOutlineBodySchema.safeParse({
      ...body,
      summary: body?.summary === undefined ? markdown : body.summary,
    });
    if (!parsed.success) return false;
    const outline = parsed.data;
    const hasSummary = Boolean(outline.summary.trim() || markdown);
    const hasPaywall = Boolean(
      outline.paywallPoint?.trim() ||
        outline.paywallHint?.trim() ||
        outline.cliffType.trim() ||
        outline.cliffText.trim(),
    );
    return hasSummary && outline.beats.some((beat) => beat.trim()) && hasPaywall;
  }
  const summary = body?.summary as string | undefined;
  return Boolean(summary?.trim() || markdown);
}

export type DeliverableCompletion = {
  hasHook: boolean;
  hasSynopsis: boolean;
  hasCharacters: boolean;
  hasSetting: boolean;
  hasEmotion: boolean;
  hasForesight: boolean;
  hasQc: boolean;
  outlineReadyCount: number;
  outlineTarget: number;
  bodyReadyCount: number;
  bodyCount: number;
  bodyTarget: number;
  done: Partial<Record<DeliverableId, boolean>>;
};

/** 各格式共用同一套「真实完成」判定，避免非漫剧误用漫剧四件套。 */
export function deliverableCompletion(
  format: ProjectFormat,
  artifacts: Artifact[],
  synopsis = "",
): DeliverableCompletion {
  const hasHook = artifacts.some(
    (artifact) => artifact.type === "core_hook" && artifact.status === "adopted",
  );
  const hasLogline = artifacts.some(
    (artifact) => artifact.type === "logline" && artifactHasBody(artifact),
  );
  const hasSynopsis = synopsis.trim().length >= 8 || hasLogline;
  const hasCharacters = artifacts.some(
    (artifact) => artifact.type === "character" && artifactHasBody(artifact),
  );
  const hasSetting = artifacts.some(
    (artifact) =>
      (artifact.type === "world" || artifact.type === "world_setting") &&
      artifactHasBody(artifact),
  );
  const hasEmotion = artifacts.some(
    (artifact) => artifact.type === "emotion_curve" && artifactHasBody(artifact),
  );
  const hasForesight = artifacts.some(
    (artifact) =>
      artifact.type === "foreshadow_ledger" ||
      (artifact.type === "other" && artifact.bodyJson?.kind === "foreshadow_ledger"),
  );
  const hasQc = artifacts.some(
    (artifact) => artifact.type === "qc_report" && artifact.status === "adopted",
  );
  const countUnits = (rows: Artifact[]) =>
    new Set(rows.map(row => bodyUnitNo(row) || row.id)).size;
  const outlineReadyCount = countUnits(artifacts.filter(artifact => outlineIsReady(artifact, format)));
  const manuscripts = artifacts.filter(
    (artifact) => artifact.type === (format === "duanju" ? "scene" : "manuscript"),
  );
  const bodyReadyCount = countUnits(manuscripts.filter(artifact => artifact.status === "adopted"));
  const outlineTarget = format === "manju" || format === "duanju" ? 10 : 1;
  const bodyTarget = format === "manju" ? 3 : format === "duanju" ? 10 : 1;
  const firstItemReady = format === "manju" ? hasHook : hasSynopsis;
  /** IP：AdaptPitchPack＝锚定(人设)＋单元＋情绪＋剧本；≠ 漫剧 10+3 */
  const packageDone =
    format === "ip_adapt"
      ? hasCharacters &&
        outlineReadyCount >= 1 &&
        hasEmotion &&
        bodyReadyCount >= 1
      : (format !== "duanju" || hasQc) && firstItemReady &&
        hasCharacters &&
        outlineReadyCount >= outlineTarget &&
        bodyReadyCount >= bodyTarget;

  return {
    hasHook,
    hasSynopsis,
    hasCharacters,
    hasSetting,
    hasEmotion,
    hasForesight,
    hasQc,
    outlineReadyCount,
    outlineTarget,
    bodyReadyCount,
    bodyCount: manuscripts.length,
    bodyTarget,
    done: {
      package: packageDone,
      hook: hasHook,
      synopsis: hasSynopsis,
      setting: hasSetting,
      characters: hasCharacters,
      outline: outlineReadyCount >= outlineTarget,
      emotion: hasEmotion,
      manuscript: bodyReadyCount >= bodyTarget,
      foresight: hasForesight,
      qc: hasQc,
    },
  };
}

/** 正文产物类型：duanju 场级正文落库为 scene，其余格式为 manuscript。 */
export function bodyTypesFor(format: ProjectFormat): string[] {
  return format === "duanju" ? ["scene"] : ["manuscript"];
}

/** 正文序号：manuscript 用 episodeNo/chapterNo；scene 用 scene_header 首位数字。 */
/** 正文文本：manuscript 取 bodyMarkdown；scene 取 script_body。 */
export function bodyTextOf(artifact: Artifact): string {
  if (artifact.type === "scene") {
    return ((artifact.bodyJson as { script_body?: string } | null)?.script_body ?? "");
  }
  return artifact.bodyMarkdown ?? "";
}

export type MilestoneItem = {
  key: DeliverableId;
  label: string;
  done: boolean;
  detail: string;
};

export function MilestoneBar({
  items,
  active,
  onSelect,
}: {
  items: MilestoneItem[];
  active?: DeliverableId;
  onSelect?: (id: DeliverableId) => void;
}) {
  return (
    <div className="milestone" role="navigation" aria-label="九格交稿里程碑">
      {items.map((i, index) => (
        <div key={i.key} className="milestone__wrap">
          {index > 0 ? (
            <span className="milestone__connector" aria-hidden>
              <ChevronRight size={14} />
            </span>
          ) : null}
          <button
            type="button"
            className="milestone__item"
            data-done={i.done}
            data-active={active === i.key}
            onClick={() => onSelect?.(i.key)}
            aria-current={active === i.key ? "step" : undefined}
          >
            <span className="milestone__index">
              {i.done ? <Check size={13} aria-hidden /> : index + 1}
            </span>
            <span className="milestone__text">
              <strong>{i.label}</strong>
              <span className="muted">{i.detail}</span>
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

export function PackagePanel({
  hasHook,
  hasBio,
  outlineCount,
  bodyCount,
  synopsis,
  projectId,
  artifacts,
  projectTitle,
  format = "manju",
}: {
  hasHook: boolean;
  hasBio: boolean;
  outlineCount: number;
  bodyCount: number;
  synopsis?: string;
  projectId?: string;
  artifacts?: Artifact[];
  projectTitle?: string;
  format?: ProjectFormat;
}) {
  return (
    <div className="stack studio-package">
      <PitchSpecWorkbench
        projectId={projectId}
        hasHook={hasHook}
        hasBio={hasBio}
        outlineCount={outlineCount}
        bodyCount={bodyCount}
        synopsis={synopsis}
        format={format}
        artifacts={artifacts}
        projectTitle={projectTitle}
      />
    </div>
  );
}

export function SynopsisPanel({
  value,
  onChange,
  projectId,
  format,
}: {
  value: string;
  onChange: (v: string) => void;
  projectId?: string;
  format?: ProjectFormat;
}) {
  const [parts, setParts] = useState<SynopsisParts>(() => loadSynopsisParts(projectId));
  const [persistMsg, setPersistMsg] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const setPart = (key: keyof SynopsisParts, v: string) => {
    const next = { ...parts, [key]: v };
    setParts(next);
    onChange(composeSynopsis(next));
    if (projectId) {
      try { localStorage.setItem(`synopsis-parts:${projectId}`, JSON.stringify(next)); } catch { /* storage unavailable */ }
    }
  };

  const persist = async () => {
    if (!projectId) {
      setPersistMsg("缺少项目，已仅写入本地");
      return;
    }
    try {
      localStorage.setItem(`synopsis-parts:${projectId}`, JSON.stringify(parts));
      localStorage.setItem(`synopsis:${projectId}`, value);
      await api.patchProject(projectId, {
        coverMeta: {
          logline: value.trim(),
        },
      });
      void queryClient.invalidateQueries({queryKey: ["project", projectId]});
      setPersistMsg("梗概已保存到作品，四要素已保存在此设备");
    } catch (e) {
      setPersistMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Panel
      title="一句话梗概"
      actions={
        <div className="row" style={{ gap: 8 }}>
          <Badge>
            {format === "ip_adapt"
              ? "四要素 + 双方实力差距"
              : "身份 + 矛盾 + 转折 + 金手指"}
          </Badge>
          <Button variant="primary" disabled={!projectId && !value} onClick={() => void persist()}>
            保存
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        可直接写梗概，也可选填下方要素来组合一句话：什么人 · 什么冲突/契约 · 转折契机 · 靠什么能力破局
        {format === "ip_adapt" ? "；IP 导语另加力量悬殊" : ""}
        。四要素保存在此设备，梗概可同步到当前作品。
      </p>
      <textarea
        className="textarea"
        rows={4}
        value={value}
        onChange={(e) => {

          onChange(e.target.value);
        }}
        style={{ fontFamily: "var(--font-display)", fontSize: 15, lineHeight: 1.6 }}
      />
      <div className="field-grid" style={{ marginTop: 12 }}>
        <div className="field">
          <label>身份</label>
          <input
            className="input"
            value={parts.identity}
            onChange={(e) => setPart("identity", e.target.value)}
            placeholder="例：重生回高考前夜的落魄子弟"
          />
        </div>
        <div className="field">
          <label>核心矛盾</label>
          <input
            className="input"
            value={parts.conflict}
            onChange={(e) => setPart("conflict", e.target.value)}
            placeholder="例：三年内阻止家族破产"
          />
        </div>
        <div className="field">
          <label>转折契机</label>
          <input
            className="input"
            value={parts.turn}
            onChange={(e) => setPart("turn", e.target.value)}
            placeholder="例：命运回放系统觉醒"
          />
        </div>
        <div className="field">
          <label>金手指</label>
          <input
            className="input"
            value={parts.finger}
            onChange={(e) => setPart("finger", e.target.value)}
            placeholder="例：可见十年后关键节点"
          />
        </div>
        {format === "ip_adapt" ? (
          <div className="field">
            <label>双方实力差距（选填）</label>
            <input
              className="input"
              value={parts.powerGap ?? ""}
              onChange={(e) => setPart("powerGap", e.target.value)}
              placeholder="例：宗门碾压凡人"
            />
          </div>
        ) : null}
      </div>
      {persistMsg ? (
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          {persistMsg}
        </p>
      ) : null}
    </Panel>
  );
}

export function SettingPanel({ projectId }: { projectId?: string }) {
  return <SettingWorkbench projectId={projectId} />;
}

const characterStatus: Record<string, string> = {
  draft: "草稿", candidate: "候选", adopted: "已采纳", rejected: "已驳回", archived: "已归档",
};
const scalarCharacterFields = [
  ["desire", "欲望"], ["fear", "恐惧"], ["secret", "秘密"], ["role", "功能位"],
] as const;

function bioAgentFor(format?: string) {
  if (format === "duanju") return "char.mini_bio";
  if (format === "male_long" || format === "female_long") return "char.seven_step";
  if (format === "short_novel" || format === "ip_adapt") return "char.bible_big5";
  return "char.bio_manju";
}

export function CharacterBiblePanel({
  artifacts,
  projectId,
  format,
}: {
  artifacts: Artifact[];
  projectId?: string;
  format?: string;
}) {
  const characterArtifacts = useMemo(() => artifacts.filter((a) => a.type === "character"), [artifacts]);
  const profiles = useMemo(() => characterProfiles(characterArtifacts), [characterArtifacts]);
  const bioAgent = bioAgentFor(format);
  const [active, setActive] = useState(profiles[0]?.key);
  const current = profiles.find((profile) => profile.key === active) ?? profiles[0];
  return (
    <div className="stack">
      <CharacterEditor key={JSON.stringify([projectId, current?.key])}
        {...{ projectId, current, profiles, bioAgent, setActive }} />
      <CollapsibleSection title="七步人物设计（选填）" defaultOpen={false}>
        <SevenStepCharWorkbench projectId={projectId} artifacts={artifacts} />
      </CollapsibleSection>
      <CharacterGraphPanel
        key={projectId}
        projectId={projectId}
        profiles={profiles}
        characterArtifacts={characterArtifacts}
        manuscripts={artifacts.filter((a) => a.type === "manuscript")}
        graphArtifacts={artifacts.filter((a) => a.type === "character_graph")}
      />
    </div>
  );
}

function CharacterEditor({ projectId, current, profiles, bioAgent, setActive }: {
  projectId?: string; current?: CharacterProfile; profiles: CharacterProfile[];
  bioAgent: string; setActive: (key: string) => void;
}) {
  const qc = useQueryClient();
  const artifact = current?.artifact;
  const bundled = current?.index !== undefined;
  const json = current?.fields ?? {};
  const role = json.role ?? json.function;
  const profileFields = biographyFields.filter(({ key }) => {
    const value = key === "role" ? role : json[key];
    return typeof value === "string" || typeof value === "number";
  });
  const original: Record<string, string> = bundled
    ? Object.fromEntries(profileFields.map(({ key }) => [key, String(key === "role" ? role : json[key])]))
    : {
        desire: String(json.desire ?? ""), fear: String(json.fear ?? ""),
        secret: String(json.secret ?? ""), role: String(role ?? "主角"),
        body: artifact?.bodyMarkdown ?? "",
      };
  type Draft = typeof original;
  const source = "character:" + current?.key;
  const [local, setLocal] = useState<{ fields: Draft; version: number } | null>(() => {
    if (!projectId) return null;
    const saved = readManuscriptDraft(localStorage, projectId, source);
    if (saved?.version === undefined) return null;
    try {
      const fields = JSON.parse(saved.text);
      if (fields && typeof fields === "object" && !Array.isArray(fields) &&
          Object.values(fields).every((value) => typeof value === "string") &&
          (bundled || Object.keys(original).every((key) => typeof fields[key] === "string")))
        return { fields, version: saved.version };
    } catch { /* fall back to the project copy */ }
    return null;
  });
  useLayoutEffect(() => {
    if (!projectId) return;
    return observeDraftSave(projectId, source, reconcile => {
      setLocal(latest => {
        if (!latest) return null;
        const previous = {text: JSON.stringify(latest.fields), version: latest.version};
        const next = reconcile(previous);
        if (next === previous) return latest;
        return next?.version === undefined ? null : {...latest, version:next.version};
      });
    });
  }, [projectId, source]);
  const draft = local?.fields ?? original;
  const changedKeys = Object.keys(original).filter((key) => draft[key] !== undefined && draft[key] !== original[key]);
  const stale = local !== null && artifact?.version !== local.version;
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bioView, setBioView] = useState<"edit" | "preview">("edit");
  function setField(key: string, value: string) {
    if (!projectId || !artifact) return;
    const fields = { ...draft, [key]: value };
    const version = local?.version ?? artifact.version;
    writeManuscriptDraft(localStorage, projectId, source, {text:JSON.stringify(fields), version});
    setLocal({ fields, version });
    setSaveMsg(null);
  }

  const save = async () => {
    if (!projectId || !artifact || !current || stale) return;
    const version = local?.version ?? artifact.version;
    const edits = Object.fromEntries(changedKeys.map((key) => [key, draft[key]]));
    try {
      setSaving(true);
      const updated = await api.updateArtifact(projectId, artifact.id, bundled ? {
        expectedVersion: version,
        bodyJson: updateBiographyProfile(current, edits),
      } : {
        expectedVersion: version,
        bodyMarkdown: draft.body,
        bodyJson: {
          ...json,
          desire: draft.desire,
          fear: draft.fear,
          secret: draft.secret,
          role: draft.role,
        },
      });
      finishDraftSave(localStorage, projectId, source, {text: JSON.stringify(draft), version}, updated.version);
      qc.setQueryData<Artifact[]>(["artifacts", projectId], old => old?.map(item =>
        item.id === updated.id && item.version <= updated.version ? updated : item));
      void qc.invalidateQueries({queryKey:["artifacts", projectId]});
      void qc.invalidateQueries({queryKey:["artifact-versions", projectId, artifact.id]});
      setSaveMsg("本次提交已保存");
    } catch (e) {
      void qc.invalidateQueries({queryKey:["artifacts", projectId]});
      setSaveMsg("保存失败，本地修改已保留：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <CollapsibleSection
        title="人物档案与关系"
        badge={artifact ? `${profiles.length} 个角色 · 第 ${artifact.version} 版 · ${(characterStatus[artifact.status] ?? "状态待确认")}` : "待生成"}
        storageKey={projectId ? `deliverable-${projectId}-character-files` : undefined}
      >
        <div className="split" style={{ height: "auto", minHeight: 320 }}>
          <Panel
            title="角色列表"
            actions={
              <Button disabled={!projectId}
                onClick={() => projectId && void runAgentFeedback(projectId, bioAgent, { label: bioAgent })}>
                生成小传候选
              </Button>
            }
          >
            {profiles.map((profile) => (
              <button key={profile.key} type="button" className="binder-item"
                data-active={profile.key === current?.key} onClick={() => setActive(profile.key)}>
                <span className="binder-item__check" data-done="true" />
                {profile.name}
              </button>
            ))}
            {!profiles.length && <div className="empty">暂无人设 — 大纲前必须先写小传</div>}
          </Panel>
          <Panel
            title={current ? `${current.name} · 人物小传` : "人物小传"}
            actions={
              <Button variant="primary" disabled={saving || !current || !projectId || stale || (bundled && !changedKeys.length)}
                onClick={() => void save()}>
                保存
              </Button>
            }
          >
            {current && artifact ? (
              <div className="stack">
                {stale && <div role="status">
                  本地修改基于第 {local.version} 版，作品已更新到第 {artifact.version} 版。
                  <details><summary>查看作品当前内容</summary>
                    {bundled ? (
                      <dl>{profileFields.map(({key, label}) => (
                        <Fragment key={key}><dt>{label}</dt><dd>{original[key]}</dd></Fragment>
                      ))}</dl>
                    ) : (
                      <>
                        <MarkdownDocument source={artifact.bodyMarkdown ?? ""} />
                        <p>欲望：{original.desire} · 恐惧：{original.fear} · 秘密：{original.secret} · 功能位：{original.role}</p>
                      </>
                    )}
                  </details>
                  <Button disabled={saving} onClick={() => {
                    if (!projectId) return;
                    clearSavedDraft(localStorage, projectId, source, JSON.stringify(local.fields));
                    setLocal(null);
                    setSaveMsg("已载入作品当前版本");
                  }}>放弃本地修改并载入当前版本</Button>
                </div>}
                <div className="field-grid">
                  {bundled ? profileFields.map((field) => (
                    <label className={"multiline" in field ? "field full" : "field"} key={field.key}>
                      <span>{field.label}</span>
                      {"multiline" in field ? (
                        <textarea className="textarea" rows={3} value={draft[field.key] ?? original[field.key] ?? ""}
                          onChange={(e) => setField(field.key, e.target.value)} />
                      ) : (
                        <input className="input" type={typeof json[field.key] === "number" ? "number" : "text"}
                          value={draft[field.key] ?? original[field.key] ?? ""} onChange={(e) => setField(field.key, e.target.value)} />
                      )}
                    </label>
                  )) : scalarCharacterFields.map(([key, label]) => (
                    <label className="field" key={key}>
                      <span>{label}</span>
                      <input className="input" aria-label={label} value={draft[key]} onChange={(e) => setField(key, e.target.value)} />
                    </label>
                  ))}
                </div>
                {bundled ? (
                  <details>
                    <summary>小传原文与共享设定</summary>
                    <p className="muted">这里保留产物原文，角色档案的字段可在上方编辑。</p>
                    <MarkdownDocument source={artifact.bodyMarkdown ?? ""} />
                  </details>
                ) : (
                  <label className="field full">
                    <span className="row" style={{ justifyContent: "space-between", gap: 6 }}>
                      <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-muted)", fontWeight: 600 }}>
                        小传正文（含 Big5 / 灵魂三问 / 欲惧秘）
                      </span>
                      <span className="row" style={{ gap: 4 }}>
                        <Button size="sm" variant={bioView === "edit" ? "primary" : "ghost"} onClick={() => setBioView("edit")}>
                          编辑
                        </Button>
                        <Button size="sm" variant={bioView === "preview" ? "primary" : "ghost"} onClick={() => setBioView("preview")}>
                          预览
                        </Button>
                      </span>
                    </span>
                    {bioView === "edit" ? (
                      <textarea className="textarea" rows={10} aria-label="小传正文" value={draft.body}
                        onChange={(e) => setField("body", e.target.value)} />
                    ) : (
                      <div style={{ border: "1px solid var(--border, #e5e5e5)", borderRadius: 8, padding: "8px 10px", maxHeight: 360, overflowY: "auto" }}>
                        <MarkdownDocument source={draft.body ?? ""} />
                      </div>
                    )}
                  </label>
                )}
                {saveMsg && <p className="muted" role="status">{saveMsg}</p>}
              </div>
            ) : (
              <div className="empty">选择或生成角色</div>
            )}
          </Panel>
        </div>
      </CollapsibleSection>
      {bundled && (
        <p className="muted">
          回滚会恢复整份合集，包括其中所有角色。角色字段与合集原文分别保存。版本对比和 Markdown 导出使用合集原文。
        </p>
      )}
      {artifact ? (
        <ArtifactVersionHistory
          projectId={projectId}
          artifactId={artifact.id}
          currentBody={bundled ? artifact.bodyMarkdown : draft.body}
          currentVersion={artifact.version}
          dirty={changedKeys.length > 0}
          storageKey={projectId ? `deliverable-${projectId}-character-version` : undefined}
        />
      ) : null}
    </>
  );
}

export function OutlineDualView({
  artifacts,
  projectId,
}: {
  artifacts: Artifact[];
  projectId?: string;
}) {
  const qc = useQueryClient();
  const [view, setView] = useState("table");
  const sorted = useMemo(
    () => artifacts.filter((a) => a.type === "episode_outline")
      .sort((a, b) => outlineEpisodeNo(a) - outlineEpisodeNo(b)),
    [artifacts],
  );
  const currentDraft = useMemo(() => createOutlineTextDraft(sorted), [sorted]);
  const [local, setLocal] = useState<{ projectId?: string; draft: OutlineTextDraft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [diffId, setDiffId] = useState("");
  const localDraft = local?.projectId === projectId ? local?.draft : undefined;
  const draft = localDraft ?? currentDraft;
  const ambiguous = ambiguousOutlineEpisodes(draft.rows);
  const currentRow = currentDraft.rows.find((row) => row.artifact.id === diffId) ?? currentDraft.rows[0];
  const baseline = currentRow && draft.rows.find((row) => row.artifact.id === currentRow.artifact.id);
  const newerVersion = baseline && currentRow.artifact.version > baseline.artifact.version;

  const saveText = async () => {
    if (!projectId || !draft.rows.length) {
      setSaveMsg("无可保存大纲");
      return;
    }
    if (!localDraft || saving) return;
    setSaving(true);
    try {
      const result = await saveOutlineTextDraft(localDraft, (artifactId, patch) =>
        api.updateArtifact(projectId, artifactId, patch),
      );
      if (!result) {
        setSaveMsg("请保留「第 N 集」标题。每个集号须对应一份大纲和一个文字段落。");
        return;
      }
      const { saved, conflicts, failed } = result;
      const savedEpisodes = [...saved.values()].map((row) => row.episodeNo);
      const episodes = (numbers: number[]) => numbers.map((n) => `第 ${n} 集`).join("、");
      const messages = [
        saved.size ? `已逐集回写 ${saved.size} 集大纲（${episodes(savedEpisodes)}）` : "",
        conflicts.length ? `${episodes(conflicts)}存档已更新，草稿已保留，请打开对照差异` : "",
        failed.length ? `${episodes(failed)}保存失败，草稿已保留` : "",
      ].filter(Boolean);
      setSaveMsg(messages.join("。") || "没有需要保存的修改");
      const queryKey = ["artifacts", projectId];
      if (saved.size) {
        qc.setQueryData<Artifact[]>(queryKey, (rows) => rows?.map((row) => {
          const updated = saved.get(row.id)?.artifact;
          return updated && updated.version > row.version ? updated : row;
        }));
      }
      const fullySaved = !conflicts.length && !failed.length &&
        result.draft.text.trim() === outlineDraftText(result.draft.rows);
      setLocal((previous) => previous === local
        ? (fullySaved ? null : { projectId, draft: result.draft })
        : previous);
      if (messages.length) await qc.invalidateQueries({ queryKey });
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <CollapsibleSection
      title="分集大纲 · 双视图"
      badge={`${sorted.length} 集`}
      storageKey={projectId ? `deliverable-${projectId}-outline-view` : undefined}
    >
      <Tabs
        tabs={[
          { id: "table", label: "表格（爽点/卡点）" },
          { id: "text", label: "文字版校正" },
          { id: "diff", label: "对照差异" },
        ]}
        value={view}
        onChange={setView}
      />
      {view === "table" && (
        <table className="table">
          <thead>
            <tr>
              <th>集</th>
              <th>分集内容</th>
              <th>爽点</th>
              <th>卡点（笑点/危机）</th>
              <th>付费点</th>
              <th>情绪峰</th>
              <th>钩子</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => {
              const b = a.bodyJson ?? {};
              return (
                <tr key={a.id}>
                  <td>{outlineEpisodeNo(a) || "—"}</td>
                  <td>{outlineField(b.summary) || a.bodyMarkdown || "—"}</td>
                  <td>{outlineField(b.thrill) || "—"}</td>
                  <td>{outlineField(b.trap) || "—"}</td>
                  <td>
                    {outlineField(b.paywallPoint) || outlineField(b.paywallHint) || (
                      <span className="muted">未标</span>
                    )}
                  </td>
                  <td>
                    {typeof b.emotionPeak === "number" ? (
                      <Badge tone={b.emotionPeak >= 6 ? "ok" : b.emotionPeak <= -3 ? "fail" : "warn"}>
                        {b.emotionPeak}
                      </Badge>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <Badge tone={b.hookAtEnd === true ? "ok" : "warn"}>
                      {b.hookAtEnd === true ? "有" : b.hookAtEnd === false ? "无" : "未标"}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {view === "text" && (
        <div className="stack">
          {ambiguous.size ? (
            <p className="muted">同一集有多份大纲时，可在表格和对照中查看各份存档。文字版只保存集号唯一的大纲。</p>
          ) : null}
          {draft.text.includes(`：${OUTLINE_LITERAL_PREFIX}`) || draft.text.includes(`集 ${OUTLINE_LITERAL_PREFIX}`) ? (
            <p className="muted">部分字段用 JSON 显示，以保留换行和标点。编辑这些字段时请保留引号和转义。</p>
          ) : null}
          <textarea
            className="textarea"
            rows={18}
            value={draft.text}
            disabled={saving}
            onChange={(e) => setLocal({ projectId, draft: { ...draft, text: e.target.value } })}
          />
          {currentDraft.rows.map(({ artifact, episodeNo }) => {
            const markdown = outlineFallbackMarkdown(artifact);
            return markdown ? (
              <details key={artifact.id}>
                <summary>第 {episodeNo} 集原稿 Markdown（单独保留）</summary>
                <pre className="prose-block">{markdown}</pre>
              </details>
            ) : null;
          })}
          <div className="row">
            <Button variant="primary" disabled={!projectId || saving || !localDraft} onClick={() => void saveText()}>
              保存文字版
            </Button>
            {saveMsg ? <span className="muted" role="status">{saveMsg}</span> : null}
          </div>
        </div>
      )}
      {view === "diff" && (
        <div className="stack">
          <div className="row" style={{ alignItems: "center", gap: 8 }}>
            <label className="field" style={{ minWidth: 180 }}>
              <span style={{ fontSize: "var(--fs-xs)", color: "var(--ink-muted)" }}>
                逐集定位
              </span>
              <Select
                className="select"
                value={currentRow?.artifact.id ?? ""}
                onChange={(e) => setDiffId(e.target.value)}
              >
                {currentDraft.rows.map(({ artifact, episodeNo }) => (
                  <option key={artifact.id} value={artifact.id}>
                    第{episodeNo}集 {outlineField(artifact.bodyJson?.title)}
                  </option>
                ))}
              </Select>
            </label>
            <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
              表格侧（当前存档）↔ 文字版草稿，按集全文对照。
            </span>
          </div>
          <DiffCompare
            leftTitle={currentRow ? `当前存档 · 第 ${currentRow.artifact.version} 版` : "当前存档"}
            rightTitle="文字版（当前草稿）"
            left={<OutlineStoredVersion row={currentRow} />}
            right={<pre className="prose-block">{currentRow
              ? parseOutlineText(draft.text)?.get(currentRow.episodeNo)?.block ?? "（未找到唯一对应的文字版草稿）"
              : "请选择集数"}</pre>}
          />
          {newerVersion && (
            <div className="row">
              <span className="muted">存档已更新。请对照并合并修改后，再以当前版本继续编辑。</span>
              <Button
                disabled={saving}
                onClick={() => {
                  setLocal({ projectId, draft: rebaseOutlineTextRow(draft, currentRow) });
                  setView("text");
                }}
              >
                以第 {currentRow.artifact.version} 版继续编辑
              </Button>
            </div>
          )}
        </div>
      )}
      <p className="muted" style={{ marginTop: 8 }}>
        课程要点：表格生产 → 转文字校正 → 改正文必须同步改纲。集尾钩子供参考，每集能否使用由作者决定。
      </p>
    </CollapsibleSection>
  );
}

export function EmotionCurvePanel({
  values,
  projectId,
  artifacts,
}: {
  values: number[];
  projectId?: string;
  artifacts?: Artifact[];
}) {
  return <CoolPointWorkbench projectId={projectId} emotionValues={values} artifacts={artifacts} />;
}

export function ForesightPanel({ projectId }: { projectId?: string }) {
  return <ForesightWorkbench projectId={projectId} />;
}

export function QcGatePanel({ projectId, format }: { projectId?: string; format?: ProjectFormat }) {
  return <DeAiWorkbench projectId={projectId} format={format} />;
}

export function ManuscriptStudio({
  artifacts,
  projectId,
  activeId,
  format = "manju",
}: {
  artifacts: Artifact[];
  projectId?: string;
  activeId?: string;
  format?: ProjectFormat;
}) {
  const qc = useQueryClient();
  // duanju 场级正文落库为 `scene`，其余格式为 `manuscript`。
  const list = artifacts.filter((a) =>
    format === "duanju" ? a.type === "scene" : a.type === "manuscript",
  );
  const effectiveId = activeId ?? list[0]?.id;
  const cur = list.find((m) => m.id === effectiveId) ?? list[0];
  const isScene = format === "duanju";
  const isScript = format === "manju" || format === "duanju" || format === "ip_adapt";
  const body = cur?.bodyJson as
    | {
        episodeNo: number;
        wordCount: number;
        queueStatus: string;
        anchors?: StoryAnchor[];
        gates?: unknown;
        scene_header?: string;
        script_body?: string;
      }
    | undefined;
  /** 场级正文（duanju）正文在 script_body；小说/漫剧正文在 bodyMarkdown。 */
  const bodyText = (m: typeof cur) =>
    m?.type === "scene"
      ? ((m.bodyJson as { script_body?: string } | undefined)?.script_body ?? "")
      : (m?.bodyMarkdown ?? "");
  const [draft, setDraft] = useState(bodyText(cur));
  const liveDraft = useRef(draft);
  liveDraft.current = draft;
  const sourceId = manuscriptSourceId(projectId, cur?.id);
  const liveSourceId = useRef<string | null>(sourceId);
  liveSourceId.current = sourceId;
  useEffect(() => {
    liveSourceId.current = sourceId;
    return () => { liveSourceId.current = null; };
  }, [sourceId]);
  const loadedDraft = useRef({id:cur?.id,text:bodyText(cur)});
  const draftBaseVersion = useRef<number | undefined>(cur?.version);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [cowriteSeed, setCowriteSeed] = useState("");
  const [selectionRange, setSelectionRange] = useState<{start:number;end:number} | null>(null);
  const [cowriteBase, setCowriteBase] = useState<{sourceId:string;text:string} | null>(null);
  const [cowriteSeedKey, setCowriteSeedKey] = useState(0);
  const [selRange, setSelRange] = useState<{ start: number; end: number } | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [view, setView] = useState<"edit" | "annotate" | "en">("edit");
  const [editing, setEditing] = useState(false);
  const [englishDraft, setEnglishDraft] = useState("");
  const [translating, setTranslating] = useState(false);
  const [enMsg, setEnMsg] = useState<string | null>(null);
  const [wordTarget, setWordTarget] = useState<WordTarget>(() =>
    loadWordTarget(projectId, format),
  );

  const wordCount = draft.replace(/\s/g, "").length;
  const inRange = wordCount >= wordTarget.min && wordCount <= wordTarget.max;

  const outlineLatest = useMemo(() => {
    const ts = artifacts
      .filter((a) => a.type === "episode_outline")
      .map((a) => new Date(a.updatedAt).getTime());
    return ts.length ? Math.max(...ts) : 0;
  }, [artifacts]);
  // 仅当用户对正文有未保存改动时提示“改正文须同步改纲”，
  // 避免“正文生成时间必然晚于大纲”造成的误报。
  const needsOutlineSync =
    outlineLatest > 0 &&
    Boolean(cur) &&
    draft.trim() !== bodyText(cur).trim();

  useEffect(() => {
    if (loadedDraft.current.id === cur?.id && liveDraft.current !== loadedDraft.current.text) {
      if (bodyText(cur) !== liveDraft.current) setSaveMsg("来源已更新，未覆盖本地编辑；保存时会检查版本");
      loadedDraft.current = {id:cur?.id,text:bodyText(cur)};
      return;
    }
    loadedDraft.current = {id:cur?.id,text:bodyText(cur)};
    const restored = projectId ? readManuscriptDraft(localStorage, projectId, sourceId) : null;
    draftBaseVersion.current = restored ? restored.version : cur?.version;
    setDraft(restored?.text ?? bodyText(cur));
    setEnglishDraft(cur ? englishOf(cur) : "");
    setCowriteSeed(bodyText(cur));
    setSelRange(null);
    setSelectionRange(null);
    setCowriteBase({sourceId,text:bodyText(cur)});
    setSaveMsg(null);
    setEnMsg(null);
    setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, cur?.id, cur?.updatedAt]);

  useEffect(() => {
    setWordTarget(loadWordTarget(projectId, format));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, format]);

  const applyWordTarget = (next: WordTarget) => {
    setWordTarget(next);
    persistWordTarget(projectId, next);
  };

  const editDraft = (text: string) => {
    liveDraft.current = text;
    setDraft(text);
    if (projectId) writeManuscriptDraft(localStorage, projectId, sourceId, {text, version:draftBaseVersion.current});
  };

  const saving = useRef(false);
  const createKey = firstManuscriptKey(projectId, sourceId);
  const creating = useIsMutating({mutationKey:createKey, exact:true}) > 0;
  const createPending = () => {
    if (qc.isMutating({mutationKey:createKey, exact:true}) > 0) return true;
    // The cache can receive the created artifact before React replaces the empty editor.
    return !cur && Boolean(qc.getQueryData<Artifact[]>(["artifacts", projectId])
      ?.some(a => a.type === (isScene ? "scene" : "manuscript")));
  };
  const createFirst = useMutation({
    mutationKey: createKey,
    mutationFn: async ({project, temporarySource, submitted, input}: {
      project:string; temporarySource:string; submitted:string; input:Parameters<typeof api.createArtifact>[1];
    }) => {
      const created = await api.createArtifact(project, input);
      const queryKey = ["artifacts", project];
      await qc.cancelQueries({queryKey, exact:true});
      reconcileFirstManuscript(localStorage, project, temporarySource, submitted, created.id, created.version);
      qc.setQueryData<Artifact[]>(queryKey, old => [created, ...(old ?? []).filter(a => a.id !== created.id)]);
      return created;
    },
  });
  const save = async () => {
    if (!projectId || saving.current || createPending() || (!cur && !draft.trim())) return null;
    saving.current = true;
    const wordCount = draft.replace(/\s/g, "").length;
    try {
      const unit = isScript ? {episodeNo: 1} : {chapterNo: 1};
      const patch = isScene
        ? { bodyJson: { ...(cur ? body : {...unit, scene_header: "1-1"}), script_body: draft, wordCount } }
        : { bodyJson: { ...(cur ? body : unit), wordCount, format: isScript ? "manju_script" : "novel_chapter", wordTarget }, bodyMarkdown: draft };
      const updated = cur
        ? await api.updateArtifact(projectId, cur.id, {...patch, expectedVersion:draftBaseVersion.current})
        : await createFirst.mutateAsync({project:projectId, temporarySource:sourceId, submitted:draft, input:{
            ...patch, type: isScene ? "scene" : "manuscript", status: "draft",
            title: isScene ? "场 1-1" : isScript ? "第1集" : "第1章",
          }});
      if (cur) clearSavedDraft(localStorage, projectId, sourceId, draft);
      if (liveSourceId.current !== sourceId) {
        void qc.invalidateQueries({queryKey:["artifacts",projectId]});
        return null;
      }
      draftBaseVersion.current = updated.version;
      if (liveDraft.current !== draft) {
        writeManuscriptDraft(localStorage, projectId, updated.id, {text:liveDraft.current, version:updated.version});
      }
      if (cur) qc.setQueryData<Artifact[]>(["artifacts",projectId], old => old?.map(a => a.id === updated.id ? updated : a));
      await qc.invalidateQueries({queryKey:["artifacts",projectId]});
      await qc.invalidateQueries({queryKey:["artifact-versions",projectId,updated.id]});
      setSaveMsg("已保存");
      return updated;
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      saving.current = false;
    }
  };

  const storyboard = async () => {
    if (!projectId || !draft.trim()) return;
    await runAgentFeedback(projectId, "prose.storyboard", {
      label: "prose.storyboard",
      inputJson: { text: draft },
    });
    toast.ok("已入队分镜化（去小说化），结果写进产物列表");
  };

  const adopt = async () => {
    if (!projectId || !cur) return;
    try {
      const target = draft === bodyText(cur) ? cur : await save();
      if (!target) return;
      await api.adoptArtifact(projectId, cur.id, "strong", target.version);
      await qc.invalidateQueries({ queryKey: ["artifacts", projectId] });
      setSaveMsg("本集已采纳，可计入交稿包");
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const rewriteSelection = () => {
    const el = textareaRef.current;
    if (!el || el.selectionStart === el.selectionEnd) {
      toast.info("先在正文里选中要改写的一段");
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    setSelRange({ start, end });
    setCowriteBase({sourceId,text:draft});
    setCowriteSeed(draft.slice(start, end));
    setCowriteSeedKey((k) => k + 1);
  };

  useEffect(() => {
    return registerDraftTarget(sourceId, async (ref: ContextRef, next: string, insert: boolean) => {
      if (saving.current || createPending() || ref.projectId !== projectId) throw new Error("原稿正在保存或项目已切换");
      if (cur?.version !== draftBaseVersion.current || (ref.version !== undefined && ref.version !== draftBaseVersion.current)) throw new Error("来源版本已变化，请重新引用");
      const baseline = liveDraft.current;
      if (ref.contentHash && await textHash(baseline) !== ref.contentHash) throw new Error("原稿已修改，请比较差异后重新引用");
      if (saving.current || createPending() || liveSourceId.current !== ref.sourceId || liveDraft.current !== baseline) throw new Error("原稿已修改或切换，请重新引用");
      const replacement = insert ? `${ref.quote}\n${next}` : next;
      const updated = applySelectionEdit(sourceId,baseline,ref,replacement);
      editDraft(updated);
      setSelectionRange(null);
      setEditing(true);
    });
  }, [sourceId,projectId,cur?.version]);

  const applyCowrite = (next: string) => {
    if (saving.current || createPending() || !cowriteBase || cowriteBase.sourceId !== sourceId || cowriteBase.text !== draft) {
      toast.info("原稿已修改或切换，请重新选中段落后改写");
      return;
    }
    editDraft(selRange ? applySelectionEdit(sourceId,draft,{kind:cur ? "artifact" : "draft",sourceId,start:selRange.start,end:selRange.end,quote:cowriteBase.text.slice(selRange.start,selRange.end),draftText:cowriteBase.text},next) : next);
    setSelRange(null);
    setCowriteBase(null);
  };

  const translateToEnglish = async () => {
    if (!projectId || !cur) return;
    if (!draft.trim()) {
      toast.info("先写正文再翻译");
      return;
    }
    setTranslating(true);
    setEnMsg(null);
    try {
      const saved = await save();
      if (!saved) { setEnMsg("原稿保存失败，未开始翻译"); return; }
      const updated = await api.translateArtifact(projectId, cur.id, { text: draft, expectedVersion:saved.version });
      setEnglishDraft(englishOf(updated));
      setView("en");
      await qc.invalidateQueries({ queryKey: ["artifacts", projectId] });
      toast.ok("翻译完成：原文与译文都已保存");
    } catch (e) {
      setEnMsg(e instanceof Error ? e.message : "翻译失败");
      toast.fail("翻译失败，请稍后重试");
    } finally {
      setTranslating(false);
    }
  };

  const saveEnglish = async () => {
    if (!projectId || !cur) return;
    try {
      await api.updateArtifact(projectId, cur.id, {
        expectedVersion:cur.version,
        bodyJson: {
          ...((cur.bodyJson as Record<string, unknown> | null) ?? {}),
          english: englishDraft,
          englishAt: new Date().toISOString(),
        },
      });
      await qc.invalidateQueries({ queryKey: ["artifacts", projectId] });
      setEnMsg("译文已保存");
    } catch (e) {
      setEnMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const copyEnglish = async () => {
    try {
      await navigator.clipboard.writeText(englishDraft);
      toast.ok("译文已复制");
    } catch {
      toast.fail("复制失败");
    }
  };

  const exportCurrent = async (fmt: ExportFormat) => {
    if (!projectId) {
      toast.info("缺少项目，无法导出");
      return;
    }
    const name = cur?.title ?? `${curUnitLabel}正文`;
    const sections = [
      { heading: `${titleLabel} · ${curUnitLabel} ${cur?.title ?? ""}`, body: draft },
    ];
    const en = englishDraft.trim();
    if (en) {
      sections.push({ heading: `English · ${curUnitLabel} ${cur?.title ?? ""}`, body: en });
    }
    try {
      const filename = await downloadExport(projectId, name, sections, fmt);
      toast.ok(`已导出 ${filename}`);
    } catch (e) {
      toast.fail(e instanceof Error ? e.message : "导出失败");
    }
  };

  const unitWord = isScript ? "集" : "章";
  const curUnitLabel = isScene
    ? (body?.scene_header ? `场 ${body.scene_header}` : (cur?.title || "场"))
    : `第${cur ? bodyUnitNo(cur) || "?" : 1}${unitWord}`;
  const titleLabel = isScene ? "分场正文" : isScript ? "分集正文" : "分章正文";
  const formatHint = isScene
    ? "场三件套格式：场头「场号|场景|内外|天时」+ 环境·动作·对白；每场信息 / 推进 / 变化三件事都要落地，不写机位配乐。"
    : isScript
      ? "剧本格式：场 X-Y 场头 + △ 动作 + 角色台词 + OS 内心 / VO 旁白 + 结尾卡点；每集 800–1200 字、场景 ≤3。"
      : "小说章节格式（番茄/晋江）：分段叙述、主视角推进、章末留读者预知；每章约 2000–3000 字。";
  const placeholder = isScene
    ? "场头示例：1|客厅|内|日\n\n△ 环境一句话带过\n角色名：（态度）台词\n\n【三件套】信息 / 推进 / 变化"
    : isScript
      ? "第1集：标题\n场1-1：场景【时间：日】【内外：外】【地点：…】【人物：…】\n△动作描写\n角色名：（神态）台词\nVO（居中，标红）：旁白\n【结尾卡点：危机降临，……】"
      : "第1章：标题\n\n（主视角：所见→五感→思考→金手指问题→行动）\n\n……\n\n章末留一句读者预知：他还没意识到，接下来会发生什么。";

  return (
    <div className="stack">
      {needsOutlineSync ? (
        <div className="help-callout help-callout--warn" style={{ margin: 0 }}>
          <div className="help-callout__title">正文已改，请同步改纲</div>
          <div className="help-callout__body">
            如果修改涉及情节或集尾，请同步核对大纲。
          </div>
        </div>
      ) : null}
      <CollapsibleSection
        title={titleLabel}
        badge={`${list.length} ${isScene ? "场" : unitWord}`}
        summary={cur ? `${curUnitLabel} · ${wordCount}/${wordTarget.target} 字` : "暂无正文"}
        storageKey={projectId ? `deliverable-${projectId}-manuscript` : undefined}
        actions={
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" variant={view === "edit" ? "primary" : "ghost"} onClick={() => setView("edit")}>
              编辑
            </Button>
            <Button size="sm" variant={view === "annotate" ? "primary" : "ghost"} onClick={() => setView("annotate")}>
              标注
            </Button>
            <Button size="sm" variant={view === "en" ? "primary" : "ghost"} onClick={() => setView("en")}>
              英文
            </Button>
          </div>
        }
      >
        <div className="stack">
          <div className="muted" style={{ fontSize: "var(--fs-xs)", lineHeight: 1.6 }}>
            {formatHint}
          </div>
          <div className="field-grid">
            <label className="field">
              <span>目标字数</span>
              <input
                className="input"
                type="number"
                value={wordTarget.target}
                onChange={(e) => applyWordTarget({ ...wordTarget, target: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="field">
              <span>最少</span>
              <input
                className="input"
                type="number"
                value={wordTarget.min}
                onChange={(e) => applyWordTarget({ ...wordTarget, min: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="field">
              <span>最多</span>
              <input
                className="input"
                type="number"
                value={wordTarget.max}
                onChange={(e) => applyWordTarget({ ...wordTarget, max: Number(e.target.value) || 0 })}
              />
            </label>
          </div>
          {view === "edit" ? (
            <>
              <textarea ref={textareaRef} className="textarea manuscript-editor" rows={24} value={draft}
                readOnly={creating || (Boolean(cur) && !editing)} onChange={e => {if (createPending()) return; editDraft(e.target.value);setSelectionRange(null);}}
                onSelect={e => setSelectionRange({start:e.currentTarget.selectionStart,end:e.currentTarget.selectionEnd})}
                placeholder={placeholder} aria-label="正文，支持选中文本引用给助手"
                style={{minHeight:460,fontFamily:"var(--font-display)",lineHeight:1.8}} />
              <SelectionActions source={{kind:cur && draft === bodyText(cur) ? "artifact" : "draft",sourceId,projectId,version:draftBaseVersion.current,title:cur?.title}} text={draft} range={selectionRange} />
              <Button size="sm" variant="ghost" onClick={() => setEditing(v => !v)}>{editing ? "完成编辑" : "编辑正文"}</Button>
            </>
          ) : view === "annotate" ? (
            <ManuscriptAnnotatedView
              text={draft}
              format={format}
              anchors={body?.anchors ?? []}
              artifactId={cur?.id}
              projectId={projectId}
              artifactVersion={cur?.version}
              referenceSource={{kind:cur && draft === bodyText(cur) ? "artifact" : "draft",sourceId,projectId,version:draftBaseVersion.current,title:cur?.title}}
            />
          ) : (
            <div className="stack">
              <textarea
                className="textarea"
                rows={20}
                value={englishDraft}
                onChange={(e) => setEnglishDraft(e.target.value)}
                placeholder="点击「译成英语」生成译文；译文可手动修改，保存后写入本集产物。"
                style={{ minHeight: 420, fontFamily: "var(--font-display)", lineHeight: 1.8 }}
              />
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!projectId || !cur || !englishDraft.trim()}
                  onClick={() => void saveEnglish()}
                >
                  保存译文
                </Button>
                <Button size="sm" disabled={!englishDraft.trim()} onClick={() => void copyEnglish()}>
                  复制译文
                </Button>
                <Button
                  size="sm"
                  disabled={!draft.trim() || translating}
                  onClick={() => void translateToEnglish()}
                >
                  {translating ? "翻译中…" : "重新翻译"}
                </Button>
                {enMsg ? <span className="muted">{enMsg}</span> : null}
              </div>
            </div>
          )}
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <Badge tone={!cur ? "default" : inRange ? "ok" : "warn"}>
              {`${wordCount} 字`}
              {cur && !inRange
                ? wordCount < wordTarget.min
                  ? ` · 不足 ${wordTarget.min}`
                  : ` · 超 ${wordTarget.max}`
                : ""}
            </Badge>
            <ProgressBar
              value={Math.min(100, Math.round((wordCount / Math.max(1, wordTarget.target)) * 100))}
              style={{ flex: 1, minWidth: 80 }}
            />
            <Button variant="primary" disabled={creating || !projectId || (!cur && !draft.trim())} onClick={() => void save()}>
              保存
            </Button>
            <Button
              disabled={!projectId || !cur || !draft.trim() || translating}
              onClick={() => void translateToEnglish()}
            >
              {translating ? "翻译中…" : "译成英语"}
            </Button>
            <Button
              disabled={!projectId || !cur || cur?.status === "adopted"}
              onClick={() => void adopt()}
            >
              {cur?.status === "adopted" ? "已采纳" : "采纳本集"}
            </Button>
            {format === "manju" && (
              <Button disabled={!draft.trim()} onClick={() => void storyboard()}>
                分镜化（去小说化）
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={!draft.trim()}
              onClick={rewriteSelection}
            >
              改写选中
            </Button>
            {saveMsg ? <span className="muted">{saveMsg}</span> : null}
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
              导出本集（正文自动去掉 #、* 等 Markdown 符号）：
            </span>
            <Button size="sm" variant="ghost" disabled={!draft.trim()} onClick={() => void exportCurrent("txt")}>
              TXT
            </Button>
            <Button size="sm" variant="ghost" disabled={!draft.trim()} onClick={() => void exportCurrent("docx")}>
              DOCX
            </Button>
            <Button size="sm" variant="ghost" disabled={!draft.trim()} onClick={() => void exportCurrent("pdf")}>
              PDF
            </Button>
          </div>
        </div>
      </CollapsibleSection>
      {isScript && <DialogueTripleWorkbench projectId={projectId} artifacts={artifacts} />}
      {cur ? (
        <CollapsibleSection
          title="共写 / 定向改写本集"
          summary="选中一段续写、润色、去 AI 味，或按卡点/爽点/20拍定向改"
          storageKey={projectId ? `deliverable-${projectId}-manuscript-cowrite` : undefined}
          defaultOpen={false}
        >
          <CowritePanel
            key={`${cur.id}-${cowriteSeedKey}`}
            projectId={projectId}
            initialText={cowriteSeed || draft}
            compact
            onReplace={applyCowrite}
          />
        </CollapsibleSection>
      ) : null}
      {cur ? (
        <ArtifactVersionHistory
          projectId={projectId}
          artifactId={cur.id}
          currentBody={bodyText(cur)}
          currentVersion={cur.version}
          dirty={draft !== bodyText(cur) || englishDraft !== englishOf(cur)}
          format={format}
          storageKey={projectId ? `deliverable-${projectId}-manuscript-version` : undefined}
        />
      ) : null}
      {cur ? (
        <ArtifactEvalPanel
          artifactId={cur.id}
          projectId={projectId}
          format={format}
          artifactType={cur.type}
          text={draft || bodyText(cur)}
        />
      ) : null}
      {cur ? (
        <BestOfNPanel projectId={projectId} artifactId={cur.id} format={format} />
      ) : null}
    </div>
  );
}
