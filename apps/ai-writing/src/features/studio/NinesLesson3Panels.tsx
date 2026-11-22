/**
 * 九格基础课（3.md）深度工作台：
 * 方法谱系 · 洗稿定基调 · 六大元素 · 换元七步 · 节奏量化 ·
 * 情绪上下行对照 · 人物三位一体 · 质检优先级。
 * 不重复 2.md 的拆书 11 项 / PromptCompose / GenerationPolicy / 故事七步。
 */
import {
  DEFAULT_GENERATION_POLICY,
  DEFAULT_RHYTHM_QUANT,
  EMOTION_SLOPE_LABELS,
  METHOD_SPECTRUM_META,
  SIX_ELEMENT_KEYS,
  SIX_ELEMENT_LABELS,
  SWAP_SEVEN_STEP_CHECKPOINTS,
  defaultSixElementsMapping,
  emotionSlopeCompleteness,
  qcPriorityCompleteness,
  rhythmQuantCompleteness,
  sixElementsCompleteness,
  swapImitateCompleteness,
  type EmotionSlope,
  type MethodSpectrumStep,
  type QcPriorityChecklist,
  type RhythmQuant,
  type SixElementsMapping,
  type SwapImitateWorkflow,
  type WashSegmentWorkflow,
} from "@xiezuomanju/domain";
import { Badge, Button, CollapsibleSection, Panel, Tabs } from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { DeAiWorkbench } from "./DeAiWorkbench";
import { GenerationPolicyPanel } from "./NinesLesson2Panels";
import { AiCandidateScreenPanel } from "./NinesLesson4Panels";
import { runAgentFeedback } from "./runAgentFeedback";
import { usePersistedState } from "./usePersistedState";

type SwapCtl = {
  projectId?: string;
  wf?: SwapImitateWorkflow;
  setWf?: Dispatch<SetStateAction<SwapImitateWorkflow>>;
};

function emptySwap(): SwapImitateWorkflow {
  return {
    sourceSynopsis: "",
    swapCandidates: [],
    selectedSwapId: null,
    newSynopsis: "",
    chapterOutlineReady: false,
    beatSwapProgress: [],
    method: {
      selected: "swap",
      preferredDegree: "once",
      genrePreference: "爽文",
      avoidSciFi: true,
      avoidAbuse: true,
      notes: "",
    },
    sixElements: defaultSixElementsMapping("once"),
    fourLayers: {
      comprehensiveDone: false,
      chapterOutlineDone: false,
      beatAndRhythmDone: false,
      characterDone: false,
      effectivePlotPoints: [],
      crossCheckNote: "",
      crossCheckPassed: null,
    },
    rhythmQuant: { ...DEFAULT_RHYTHM_QUANT },
    emotionSlope: {
      items: [],
      principleNote:
        "仿写重点是情绪起伏方式与原文对应（上行/下行），偏离则重新生成该节点。",
    },
    beatBatchSize: 3,
    currentBeatBatch: 0,
    formatLock: "short_novel",
    castCount: 3,
    castMin: 2,
    castMax: 6,
    characters: [],
    sanzijing: {
      skinPlusFlaw: "",
      supportingTrait: "",
      identityViaCostume: "",
      microGrowth: "",
      catchphrase: "",
    },
    chapterReviseBeforeNext: true,
    chaptersRevised: [],
    qc: {
      p1Framework: [
        { id: "logic", label: "逻辑自洽", done: false, note: "" },
        { id: "character_break", label: "人设未崩", done: false, note: "" },
        { id: "core_conflict", label: "核心矛盾/设定成立", done: false, note: "" },
        { id: "mainline", label: "主线目标清晰且贯穿", done: false, note: "" },
        { id: "world_consistent", label: "世界观自洽（如有）", done: false, note: "" },
        { id: "foreshadow_p1", label: "关键伏笔可回收", done: false, note: "" },
        { id: "expect_1plus3", label: "期待感 1+3 成立（4.md）", done: false, note: "" },
        { id: "conflict_six", label: "冲突六要素齐（4.md）", done: false, note: "" },
        { id: "opening_reveal", label: "开篇亮核心期待（4.md）", done: false, note: "" },
        { id: "anti_deus_ex", label: "无机械降神（4.md）", done: false, note: "" },
      ],
      p2EmotionRhythm: [
        { id: "emotion", label: "情绪走向对（上下行）", done: false, note: "" },
        { id: "rhythm", label: "节奏不拖（章数/情节点密度）", done: false, note: "" },
        { id: "foreshadow", label: "伏笔已收回", done: false, note: "" },
      ],
      p3Language: [
        { id: "wording", label: "用词与台词", done: false, note: "" },
        { id: "ai_taste", label: "去 AI 味（见五维精修）", done: false, note: "" },
        { id: "punctuation", label: "标点等细节（影响检测）", done: false, note: "" },
      ],
      selfReviseRounds: 0,
      editorReviseRounds: 0,
      frameworkSuspect: false,
      humanReviewed: false,
      selfDissectCompareNote: "",
    },
    currentStep: 1,
    notes: "",
  };
}

function useSwapWf({ projectId, wf, setWf }: SwapCtl) {
  const persisted = usePersistedState<SwapImitateWorkflow>(
    projectId,
    "swap-imitate-l3",
    emptySwap(),
  );
  if (wf && setWf) return [wf, setWf] as const;
  return persisted;
}

function syncDegreeMapping(
  prev: SixElementsMapping,
  degree: "once" | "twice",
): SixElementsMapping {
  const fresh = defaultSixElementsMapping(degree);
  return {
    ...fresh,
    rows: fresh.rows.map((row) => {
      const old = prev.rows.find((r) => r.key === row.key);
      return old
        ? { ...row, source: old.source, target: degree === "once" && row.key === "event" ? "" : old.target, note: row.note || old.note }
        : row;
    }),
  };
}

/* ═══════════════ 方法谱系 ═══════════════ */

export function MethodSpectrumPanel(props: SwapCtl) {
  const [wf, setWf] = useSwapWf(props);
  const { projectId } = props;
  const steps = Object.keys(METHOD_SPECTRUM_META) as MethodSpectrumStep[];

  return (
    <CollapsibleSection
      title="方法谱系：洗稿 → 仿写 → 换元 → 融梗 → 改编"
      storageKey={projectId ? `nines3-${projectId}-spectrum` : undefined}
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        难度递增。本课深做洗稿与换元；融梗/改编仅展示谱系，不提供假完整工作流。
      </p>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {steps.map((id) => {
          const meta = METHOD_SPECTRUM_META[id];
          return (
            <button
              key={id}
              type="button"
              className="btn btn-sm"
              style={{
                opacity: meta.lesson3Deep ? 1 : 0.55,
                outline: wf.method.selected === id ? "2px solid var(--accent, #126b5b)" : undefined,
              }}
              onClick={() =>
                setWf((s) => ({
                  ...s,
                  method: { ...s.method, selected: id },
                }))
              }
            >
              <Badge>{meta.difficulty}</Badge> {meta.label}
              {!meta.lesson3Deep ? " · 更高课次" : ""}
            </button>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        {METHOD_SPECTRUM_META[wf.method.selected].relation}
      </p>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <label className="field">
          <span>置换度（新人默认一度）</span>
          <Select
            className="select"
            value={wf.method.preferredDegree}
            onChange={(e) => {
              const preferredDegree = e.target.value as "once" | "twice";
              setWf((s) => ({
                ...s,
                method: { ...s.method, preferredDegree },
                sixElements: syncDegreeMapping(s.sixElements, preferredDegree),
              }));
            }}
          >
            <option value="once">一度：换背景/人物/道具，不换核心事件</option>
            <option value="twice">二度：必须换核心事件</option>
          </Select>
        </label>
        <label className="field">
          <span>入门题材</span>
          <Select
            className="select"
            value={wf.method.genrePreference}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                method: {
                  ...s.method,
                  genrePreference: e.target.value as typeof s.method.genrePreference,
                },
              }))
            }
          >
            {["爽文", "甜文", "世情", "悬疑", "追妻", "末日", "其他"].map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={wf.method.avoidSciFi}
            onChange={(e) =>
              setWf((s) => ({ ...s, method: { ...s.method, avoidSciFi: e.target.checked } }))
            }
          />
          <span style={{ fontSize: 12 }}>不要科幻（DeepSeek 常偏科幻）</span>
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={wf.method.avoidAbuse}
            onChange={(e) =>
              setWf((s) => ({ ...s, method: { ...s.method, avoidAbuse: e.target.checked } }))
            }
          />
          <span style={{ fontSize: 12 }}>不建议虐文入门</span>
        </label>
      </div>
    </CollapsibleSection>
  );
}

/* ═══════════════ 洗稿定基调 ═══════════════ */

export function WashSegmentWorkbench({ projectId }: { projectId?: string }) {
  const [wash, setWash] = usePersistedState<WashSegmentWorkflow>(projectId, "wash-segment", {
    baseTonePrompt: "核心点：字数、节奏、风格保持一致。人物可以换（换名字或换职业）。",
    baseToneLocked: false,
    baseToneOutput: "",
    characterCheckNames: [],
    sourceWordCap: 20000,
    segmentMaxChars: 3000,
    segments: [],
    reviewedThinking: false,
    notes: "",
  });

  return (
    <CollapsibleSection
      title="洗稿：定基调 + 分段迭代"
      storageKey={projectId ? `nines3-${projectId}-wash` : undefined}
      actions={
        <Button
          variant="primary"
          size="sm"
          disabled={!projectId || !wash.baseTonePrompt.trim()}
          onClick={() =>
            projectId &&
            void runAgentFeedback(projectId, "imitate.wash", {
              label: "洗稿·定基调（第一步）",
              inputJson: {
                baseTonePrompt: wash.baseTonePrompt,
                segment: wash.segments[0]?.sourceExcerpt ?? "",
                characterCheckNames: wash.characterCheckNames,
              },
            })
          }
        >
          跑第一步定基调
        </Button>
      }
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        第一个思考定整篇基调；偏了后面全偏。个人洗稿投入产出比不高，流程适合自动化批处理。
        文风字段见 2.md「文风提取」purpose=wash，此处不重复。
      </p>
      <label className="field">
        <span>基调提示词（第一步）</span>
        <textarea
          className="textarea"
          rows={2}
          value={wash.baseTonePrompt}
          onChange={(e) => setWash((s) => ({ ...s, baseTonePrompt: e.target.value }))}
        />
      </label>
      <label className="row" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={wash.baseToneLocked}
          onChange={(e) => setWash((s) => ({ ...s, baseToneLocked: e.target.checked }))}
        />
        <span style={{ fontSize: 12 }}>基调已锁定（后续段必须继承）</span>
      </label>
      <label className="field">
        <span>人设校验名（洗稿通常只换名，供 AI 不乱跑）</span>
        <input
          className="input"
          value={wash.characterCheckNames.join("、")}
          onChange={(e) =>
            setWash((s) => ({
              ...s,
              characterCheckNames: e.target.value
                .split(/[、,，]/)
                .map((x) => x.trim())
                .filter(Boolean),
            }))
          }
        />
      </label>
      <label className="field">
        <span>分段原文（每行一段；建议 ≤3000 字/段，全文 ≤2 万）</span>
        <textarea
          className="textarea"
          rows={4}
          placeholder="粘贴分段后的原文…"
          value={wash.segments.map((seg) => seg.sourceExcerpt).join("\n---\n")}
          onChange={(e) => {
            const parts = e.target.value.split(/\n---\n/);
            setWash((s) => ({
              ...s,
              segments: parts.map((sourceExcerpt, index) => ({
                index,
                sourceExcerpt,
                output: s.segments[index]?.output ?? "",
                inheritsBaseTone: index > 0,
                done: s.segments[index]?.done ?? false,
              })),
            }));
          }}
        />
      </label>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Badge>段数 {wash.segments.length}</Badge>
        <Badge>上限 {wash.sourceWordCap} 字</Badge>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={wash.reviewedThinking}
            onChange={(e) => setWash((s) => ({ ...s, reviewedThinking: e.target.checked }))}
          />
          <span style={{ fontSize: 12 }}>已查看 AI 思考过程</span>
        </label>
      </div>
      {wash.baseToneLocked && (
        <Button
          size="sm"
          disabled={!projectId || wash.segments.length < 2}
          onClick={() =>
            projectId &&
            void runAgentFeedback(projectId, "imitate.wash", {
              label: "洗稿·分段迭代",
              inputJson: {
                mode: "iterate",
                prompt: "根据上述历史策略/历史记录，重新仿写，保持一致，人物替换。",
                segments: wash.segments,
              },
            })
          }
        >
          按历史策略迭代后续段
        </Button>
      )}
    </CollapsibleSection>
  );
}

/* ═══════════════ 六大元素映射 ═══════════════ */

export function SixElementsMappingWorkbench(props: SwapCtl) {
  const [wf, setWf] = useSwapWf(props);
  const { projectId } = props;
  const score = sixElementsCompleteness(wf.sixElements);

  return (
    <CollapsibleSection
      title="六大元素映射（事件·结构·主体·背景·人物·道具）"
      storageKey={projectId ? `nines3-${projectId}-six` : undefined}
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        一度不换核心事件；二度必须换。主体（价值观）通常少换。反面案例：换皮不换骨。
      </p>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <Badge>
          完成 {score.filled}/{score.total}（{score.pct}%）
        </Badge>
        {score.degreeConflict && <Badge tone="fail">一度/二度与事件置换冲突</Badge>}
        {wf.sixElements.skinOnlyRisk && <Badge tone="warn">疑似换皮不换骨</Badge>}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>元素</th>
            <th>原文</th>
            <th>置换为</th>
            <th>可换</th>
          </tr>
        </thead>
        <tbody>
          {SIX_ELEMENT_KEYS.map((key) => {
            const row = wf.sixElements.rows.find((r) => r.key === key) ?? {
              key,
              source: "",
              target: "",
              swappable: true,
              note: "",
            };
            return (
              <tr key={key}>
                <td style={{ fontWeight: 600 }}>
                  {SIX_ELEMENT_LABELS[key]}
                  {row.note ? (
                    <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
                      {row.note}
                    </div>
                  ) : null}
                </td>
                <td>
                  <input
                    className="input"
                    value={row.source}
                    onChange={(e) =>
                      setWf((s) => ({
                        ...s,
                        sixElements: {
                          ...s.sixElements,
                          rows: s.sixElements.rows.map((r) =>
                            r.key === key ? { ...r, source: e.target.value } : r,
                          ),
                        },
                      }))
                    }
                  />
                </td>
                <td>
                  <input
                    className="input"
                    value={row.target}
                    disabled={!row.swappable}
                    placeholder={row.swappable ? "置换为" : "本度不换"}
                    onChange={(e) =>
                      setWf((s) => ({
                        ...s,
                        sixElements: {
                          ...s.sixElements,
                          rows: s.sixElements.rows.map((r) =>
                            r.key === key ? { ...r, target: e.target.value } : r,
                          ),
                        },
                      }))
                    }
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={row.swappable}
                    onChange={(e) =>
                      setWf((s) => ({
                        ...s,
                        sixElements: {
                          ...s.sixElements,
                          rows: s.sixElements.rows.map((r) =>
                            r.key === key ? { ...r, swappable: e.target.checked } : r,
                          ),
                        },
                      }))
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <label className="row" style={{ gap: 6, marginTop: 8 }}>
        <input
          type="checkbox"
          checked={wf.sixElements.skinOnlyRisk}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              sixElements: { ...s.sixElements, skinOnlyRisk: e.target.checked },
            }))
          }
        />
        <span style={{ fontSize: 12 }}>自检：是否只换皮不换骨（结构/事件没动）</span>
      </label>
    </CollapsibleSection>
  );
}

/* ═══════════════ 节奏量化（并存 GenerationPolicy） ═══════════════ */

export function RhythmQuantPanel({ projectId }: { projectId?: string }) {
  const [r, setR] = usePersistedState<RhythmQuant>(projectId, "rhythm-quant", {
    ...DEFAULT_RHYTHM_QUANT,
  });
  const check = rhythmQuantCompleteness(r);

  return (
    <CollapsibleSection
      title="节奏量化目标（整篇）· 与单次控长并存"
      storageKey={projectId ? `nines3-${projectId}-rhythm` : undefined}
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        RhythmQuant = 整篇故事节奏目标（约 12 章 × 800 字 × 每章 6–8 情节点）。
        GenerationPolicy = 单次 AI 输出带宽（默认 {DEFAULT_GENERATION_POLICY.minChars}–
        {DEFAULT_GENERATION_POLICY.maxChars} 字 / plotPointCount=
        {DEFAULT_GENERATION_POLICY.plotPointCount}）。二者不互相替换。
      </p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {(
          [
            ["targetChapters", "目标章数"],
            ["charsPerChapter", "每章字数"],
            ["plotPointsPerChapterMin", "情节点下限"],
            ["plotPointsPerChapterMax", "情节点上限"],
            ["charsPerPlotPointMin", "节点字数下限"],
            ["charsPerPlotPointMax", "节点字数上限"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="field" style={{ minWidth: 120 }}>
            <span>{label}</span>
            <input
              className="input"
              type="number"
              value={r[key]}
              onChange={(e) => setR((s) => ({ ...s, [key]: Number(e.target.value) || 0 }))}
            />
          </label>
        ))}
        <label className="field" style={{ minWidth: 120 }}>
          <span>实际章数</span>
          <input
            className="input"
            type="number"
            value={r.actualChapters ?? ""}
            onChange={(e) =>
              setR((s) => ({
                ...s,
                actualChapters: e.target.value === "" ? undefined : Number(e.target.value),
              }))
            }
          />
        </label>
      </div>
      <label className="field">
        <span>各章实际情节点数（逗号分隔）</span>
        <input
          className="input"
          value={r.actualPlotPointsPerChapter.join(",")}
          onChange={(e) =>
            setR((s) => ({
              ...s,
              actualPlotPointsPerChapter: e.target.value
                .split(/[,，\s]+/)
                .map((x) => Number(x))
                .filter((n) => !Number.isNaN(n)),
            }))
          }
        />
      </label>
      {!check.ok &&
        check.warnings.map((w) => (
          <Badge key={w} tone="warn">
            {w}
          </Badge>
        ))}
      <GenerationPolicyPanel projectId={projectId} />
    </CollapsibleSection>
  );
}

/* ═══════════════ 情绪上下行对照 ═══════════════ */

export function EmotionSlopeCompareWorkbench(props: SwapCtl) {
  const [wf, setWf] = useSwapWf(props);
  const { projectId } = props;
  const slope = emotionSlopeCompleteness(wf.emotionSlope);

  const addChapter = () => {
    const nextNo =
      (wf.emotionSlope.items[wf.emotionSlope.items.length - 1]?.chapterNo ?? 0) + 1;
    setWf((s) => ({
      ...s,
      emotionSlope: {
        ...s.emotionSlope,
        items: [
          ...s.emotionSlope.items,
          {
            chapterNo: nextNo,
            sourceSlope: "flat",
            sourceNote: "",
            newSlope: "flat",
            newNote: "",
            aligned: true,
            regenerated: false,
          },
        ],
      },
    }));
  };

  return (
    <CollapsibleSection
      title="情绪上下行对照（仿写重点）"
      storageKey={projectId ? `nines3-${projectId}-slope` : undefined}
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        {wf.emotionSlope.principleNote}
      </p>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <Badge>
          对齐 {slope.aligned}/{slope.total}
        </Badge>
        {slope.misaligned > 0 && (
          <Badge tone="fail">偏离章：{slope.misalignedChapters.join(", ")}</Badge>
        )}
        <Button size="sm" onClick={addChapter}>
          加一章对照
        </Button>
      </div>
      {wf.emotionSlope.items.map((item, idx) => (
        <div
          key={item.chapterNo}
          className="row"
          style={{ gap: 8, flexWrap: "wrap", marginBottom: 8, alignItems: "flex-end" }}
        >
          <Badge>第 {item.chapterNo} 章</Badge>
          <label className="field">
            <span>原文斜率</span>
            <Select
              className="select"
              value={item.sourceSlope}
              onChange={(e) => {
                const sourceSlope = e.target.value as EmotionSlope;
                setWf((s) => {
                  const items = [...s.emotionSlope.items];
                  const cur = { ...items[idx]! };
                  cur.sourceSlope = sourceSlope;
                  cur.aligned = cur.sourceSlope === cur.newSlope;
                  items[idx] = cur;
                  return { ...s, emotionSlope: { ...s.emotionSlope, items } };
                });
              }}
            >
              {(Object.keys(EMOTION_SLOPE_LABELS) as EmotionSlope[]).map((k) => (
                <option key={k} value={k}>
                  {EMOTION_SLOPE_LABELS[k]}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span>新稿斜率</span>
            <Select
              className="select"
              value={item.newSlope}
              onChange={(e) => {
                const newSlope = e.target.value as EmotionSlope;
                setWf((s) => {
                  const items = [...s.emotionSlope.items];
                  const cur = { ...items[idx]! };
                  cur.newSlope = newSlope;
                  cur.aligned = cur.sourceSlope === cur.newSlope;
                  items[idx] = cur;
                  return { ...s, emotionSlope: { ...s.emotionSlope, items } };
                });
              }}
            >
              {(Object.keys(EMOTION_SLOPE_LABELS) as EmotionSlope[]).map((k) => (
                <option key={k} value={k}>
                  {EMOTION_SLOPE_LABELS[k]}
                </option>
              ))}
            </Select>
          </label>
          <label className="field" style={{ flex: 1, minWidth: 140 }}>
            <span>备注</span>
            <input
              className="input"
              value={item.newNote || item.sourceNote}
              onChange={(e) =>
                setWf((s) => {
                  const items = [...s.emotionSlope.items];
                  items[idx] = { ...items[idx]!, newNote: e.target.value };
                  return { ...s, emotionSlope: { ...s.emotionSlope, items } };
                })
              }
            />
          </label>
          {!item.aligned && <Badge tone="fail">偏离</Badge>}
          {!item.aligned && (
            <Button
              size="sm"
              onClick={() =>
                setWf((s) => {
                  const items = [...s.emotionSlope.items];
                  items[idx] = { ...items[idx]!, regenerated: true };
                  return { ...s, emotionSlope: { ...s.emotionSlope, items } };
                })
              }
            >
              标记已重生该节点
            </Button>
          )}
        </div>
      ))}
    </CollapsibleSection>
  );
}

/* ═══════════════ 人物三位一体 + 三字经 ═══════════════ */

export function CharacterTrinityWorkbench(props: SwapCtl) {
  const [wf, setWf] = useSwapWf(props);
  const { projectId } = props;

  return (
    <CollapsibleSection
      title="人物：三位一体 + 三字经（短篇 2～6 人）"
      storageKey={projectId ? `nines3-${projectId}-char` : undefined}
    >
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <label className="field">
          <span>角色人数</span>
          <input
            className="input"
            type="number"
            min={wf.castMin}
            max={wf.castMax}
            value={wf.castCount}
            onChange={(e) => setWf((s) => ({ ...s, castCount: Number(e.target.value) || 2 }))}
          />
        </label>
        {(wf.castCount < wf.castMin || wf.castCount > wf.castMax) && (
          <Badge tone="warn">短篇建议 {wf.castMin}～{wf.castMax} 人</Badge>
        )}
        <Button
          size="sm"
          onClick={() =>
            setWf((s) => ({
              ...s,
              characters: [
                ...s.characters,
                {
                  name: "",
                  role: s.characters.length === 0 ? "protagonist" : "supporting",
                  background: "",
                  personality: "",
                  behavior: "",
                  contrast: "",
                  trinityOk: null,
                },
              ],
            }))
          }
        >
          加角色
        </Button>
      </div>
      {wf.characters.map((ch, i) => (
        <Panel key={i} title={`${ch.name || `角色 ${i + 1}`}（${ch.role}）`}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label className="field">
              <span>姓名</span>
              <input
                className="input"
                value={ch.name}
                onChange={(e) =>
                  setWf((s) => {
                    const characters = [...s.characters];
                    characters[i] = { ...characters[i]!, name: e.target.value };
                    return { ...s, characters };
                  })
                }
              />
            </label>
            <label className="field">
              <span>背景 →</span>
              <input
                className="input"
                value={ch.background}
                onChange={(e) =>
                  setWf((s) => {
                    const characters = [...s.characters];
                    characters[i] = { ...characters[i]!, background: e.target.value };
                    return { ...s, characters };
                  })
                }
              />
            </label>
            <label className="field">
              <span>性格 →</span>
              <input
                className="input"
                value={ch.personality}
                onChange={(e) =>
                  setWf((s) => {
                    const characters = [...s.characters];
                    characters[i] = { ...characters[i]!, personality: e.target.value };
                    return { ...s, characters };
                  })
                }
              />
            </label>
            <label className="field">
              <span>行为</span>
              <input
                className="input"
                value={ch.behavior}
                onChange={(e) =>
                  setWf((s) => {
                    const characters = [...s.characters];
                    characters[i] = { ...characters[i]!, behavior: e.target.value };
                    return { ...s, characters };
                  })
                }
              />
            </label>
            <label className="field">
              <span>反差记忆点</span>
              <input
                className="input"
                value={ch.contrast}
                onChange={(e) =>
                  setWf((s) => {
                    const characters = [...s.characters];
                    characters[i] = { ...characters[i]!, contrast: e.target.value };
                    return { ...s, characters };
                  })
                }
              />
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={ch.trinityOk === true}
                onChange={(e) =>
                  setWf((s) => {
                    const characters = [...s.characters];
                    characters[i] = {
                      ...characters[i]!,
                      trinityOk: e.target.checked ? true : false,
                    };
                    return { ...s, characters };
                  })
                }
              />
              <span style={{ fontSize: 12 }}>三位一体自洽</span>
            </label>
          </div>
        </Panel>
      ))}
      <Panel title="人物三字经自查">
        {(
          [
            ["skinPlusFlaw", "人物皮加缺点"],
            ["supportingTrait", "配角弱加特征"],
            ["identityViaCostume", "显身份，服饰定"],
            ["microGrowth", "微起伏，写成长"],
            ["catchphrase", "记忆点口头禅"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="field">
            <span>{label}</span>
            <input
              className="input"
              value={wf.sanzijing[key]}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  sanzijing: { ...s.sanzijing, [key]: e.target.value },
                }))
              }
            />
          </label>
        ))}
      </Panel>
    </CollapsibleSection>
  );
}

/* ═══════════════ 质检优先级（P3 挂去 AI 味） ═══════════════ */

export function QcPriorityWorkbench(props: SwapCtl) {
  const [wf, setWf] = useSwapWf(props);
  const { projectId } = props;
  const score = qcPriorityCompleteness(wf.qc);

  const toggle = (
    tier: keyof Pick<QcPriorityChecklist, "p1Framework" | "p2EmotionRhythm" | "p3Language">,
    id: string,
  ) => {
    setWf((s) => ({
      ...s,
      qc: {
        ...s.qc,
        [tier]: s.qc[tier].map((it) => (it.id === id ? { ...it, done: !it.done } : it)),
      },
    }));
  };

  return (
    <div className="stack">
      <CollapsibleSection
        title="质检优先级：P1 框架 → P2 情绪节奏 → P3 语言/AI 味"
        storageKey={projectId ? `nines3-${projectId}-qc` : undefined}
      >
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          框架性问题 AI 可辅约 90%；情绪与节奏必须人工改。改太多=框架有问题，回框架层。
          反对 AI 直出不改就交稿。
        </p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <Badge>
            P1 {score.p1.filled}/{score.p1.total}
          </Badge>
          <Badge>
            P2 {score.p2.filled}/{score.p2.total}
          </Badge>
          <Badge>
            P3 {score.p3.filled}/{score.p3.total}
          </Badge>
          {score.frameworkSuspect && <Badge tone="fail">疑框架问题（修稿过多）</Badge>}
          {score.readyToSubmit ? (
            <Badge tone="ok">可交稿</Badge>
          ) : (
            <Badge tone="warn">未达交稿条件</Badge>
          )}
        </div>

        <Panel title="P1 致命·框架（AI 可辅助）">
          {wf.qc.p1Framework.map((it) => (
            <label key={it.id} className="row" style={{ gap: 6, marginBottom: 4 }}>
              <input type="checkbox" checked={it.done} onChange={() => toggle("p1Framework", it.id)} />
              <span style={{ fontSize: 13 }}>{it.label}</span>
            </label>
          ))}
        </Panel>
        <Panel title="P2 重点·情绪/节奏/伏笔（必须人工）">
          {wf.qc.p2EmotionRhythm.map((it) => (
            <label key={it.id} className="row" style={{ gap: 6, marginBottom: 4 }}>
              <input
                type="checkbox"
                checked={it.done}
                onChange={() => toggle("p2EmotionRhythm", it.id)}
              />
              <span style={{ fontSize: 13 }}>{it.label}</span>
            </label>
          ))}
        </Panel>
        <Panel title="P3 语言细节（去 AI 味见下方五维）">
          {wf.qc.p3Language.map((it) => (
            <label key={it.id} className="row" style={{ gap: 6, marginBottom: 4 }}>
              <input type="checkbox" checked={it.done} onChange={() => toggle("p3Language", it.id)} />
              <span style={{ fontSize: 13 }}>{it.label}</span>
            </label>
          ))}
        </Panel>

        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <label className="field">
            <span>自己修稿次数</span>
            <input
              className="input"
              type="number"
              min={0}
              value={wf.qc.selfReviseRounds}
              onChange={(e) => {
                const selfReviseRounds = Number(e.target.value) || 0;
                setWf((s) => ({
                  ...s,
                  qc: {
                    ...s.qc,
                    selfReviseRounds,
                    frameworkSuspect: selfReviseRounds >= 4 || s.qc.editorReviseRounds >= 5,
                  },
                }));
              }}
            />
          </label>
          <label className="field">
            <span>编辑后修改次数</span>
            <input
              className="input"
              type="number"
              min={0}
              value={wf.qc.editorReviseRounds}
              onChange={(e) => {
                const editorReviseRounds = Number(e.target.value) || 0;
                setWf((s) => ({
                  ...s,
                  qc: {
                    ...s.qc,
                    editorReviseRounds,
                    frameworkSuspect: s.qc.selfReviseRounds >= 4 || editorReviseRounds >= 5,
                  },
                }));
              }}
            />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.qc.humanReviewed}
              onChange={(e) =>
                setWf((s) => ({ ...s, qc: { ...s.qc, humanReviewed: e.target.checked } }))
              }
            />
            <span style={{ fontSize: 12 }}>本人已通读修改（非 AI 直出）</span>
          </label>
        </div>
        <label className="field">
          <span>自拆对照原文（可选）</span>
          <textarea
            className="textarea"
            rows={2}
            value={wf.qc.selfDissectCompareNote}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                qc: { ...s.qc, selfDissectCompareNote: e.target.value },
              }))
            }
          />
        </label>
      </CollapsibleSection>
      <DeAiWorkbench projectId={projectId} />
    </div>
  );
}

/* ═══════════════ 换元七步主台 ═══════════════ */

export function SwapSevenStepWorkbench({ projectId }: { projectId?: string }) {
  const [wf, setWf] = usePersistedState<SwapImitateWorkflow>(projectId, "swap-imitate-l3", emptySwap());
  const [swapCount, setSwapCount] = useState(10);
  const progress = swapImitateCompleteness(wf);
  const stepMeta = SWAP_SEVEN_STEP_CHECKPOINTS[wf.currentStep - 1];

  const tabs = useMemo(
    () =>
      SWAP_SEVEN_STEP_CHECKPOINTS.map((_, i) => ({
        id: String(i + 1),
        label: `${i + 1}`,
      })),
    [],
  );

  return (
    <div className="stack">
      <Panel
        title="换元法七步工作流"
        actions={
          <div className="row" style={{ gap: 6 }}>
            <Badge>
              完成步骤 {progress.filledSteps}/7
            </Badge>
            {progress.missing.slice(0, 2).map((m) => (
              <Badge key={m} tone="warn">
                缺：{m}
              </Badge>
            ))}
          </div>
        }
      >
        <Tabs
          tabs={tabs}
          value={String(wf.currentStep)}
          onChange={(id) => setWf((s) => ({ ...s, currentStep: Number(id) || 1 }))}
        />
        {stepMeta && (
          <div style={{ marginTop: 8 }}>
            <strong>{stepMeta.label}</strong>
            <p className="muted" style={{ fontSize: 12, margin: "4px 0" }}>
              你要做：{stepMeta.userAction}
            </p>
            <p className="muted" style={{ fontSize: 12, margin: "4px 0" }}>
              AI 可做：{stepMeta.aiAction}
            </p>
            <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
              {stepMeta.displayFields.map((f) => (
                <Badge key={f}>{f}</Badge>
              ))}
            </div>
          </div>
        )}
      </Panel>

      {wf.currentStep === 1 && (
        <MethodSpectrumPanel projectId={projectId} wf={wf} setWf={setWf} />
      )}
      {wf.currentStep === 1 && wf.method.selected === "wash" && (
        <WashSegmentWorkbench projectId={projectId} />
      )}

      {wf.currentStep === 2 && (
        <CollapsibleSection title="拆模板四层（复用 11 项，不重填）" defaultOpen>
          <p className="muted" style={{ fontSize: 12 }}>
            综合→梗概；章纲→故事线；细纲+节奏→有效情节点（两遍互校）；人设按需。拆书 11 项见
            S1 拆书工作台。
          </p>
          {(
            [
              ["comprehensiveDone", "综合（故事梗概）已拆"],
              ["chapterOutlineDone", "章纲（故事线）已拆"],
              ["beatAndRhythmDone", "细纲 + 节奏已拆并互校"],
              ["characterDone", "人设已拆（按需）"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="row" style={{ gap: 6, marginBottom: 4 }}>
              <input
                type="checkbox"
                checked={wf.fourLayers[key]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    fourLayers: { ...s.fourLayers, [key]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 13 }}>{label}</span>
            </label>
          ))}
          <label className="field">
            <span>有效情节点（删了故事就断；每行：章号|情节点|为何关键）</span>
            <textarea
              className="textarea"
              rows={4}
              value={wf.fourLayers.effectivePlotPoints
                .map((p) => `${p.chapterNo}|${p.text}|${p.whyCritical}`)
                .join("\n")}
              onChange={(e) => {
                const effectivePlotPoints = e.target.value
                  .split("\n")
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .map((l) => {
                    const [chapterNo = "1", text = "", whyCritical = ""] = l.split("|");
                    return {
                      chapterNo: Number(chapterNo) || 1,
                      text,
                      whyCritical,
                    };
                  });
                setWf((s) => ({
                  ...s,
                  fourLayers: { ...s.fourLayers, effectivePlotPoints },
                }));
              }}
            />
          </label>
          <label className="field">
            <span>细纲 vs 节奏互校备注</span>
            <textarea
              className="textarea"
              rows={2}
              value={wf.fourLayers.crossCheckNote}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  fourLayers: { ...s.fourLayers, crossCheckNote: e.target.value },
                }))
              }
            />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.fourLayers.crossCheckPassed === true}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  fourLayers: {
                    ...s.fourLayers,
                    crossCheckPassed: e.target.checked ? true : false,
                  },
                }))
              }
            />
            <span style={{ fontSize: 12 }}>互校通过</span>
          </label>
        </CollapsibleSection>
      )}

      {wf.currentStep === 3 && (
        <>
          <SixElementsMappingWorkbench projectId={projectId} wf={wf} setWf={setWf} />
          <CollapsibleSection title="分层置换：方案人选" defaultOpen>
            <label className="field">
              <span>原故事梗概</span>
              <textarea
                className="textarea"
                rows={3}
                value={wf.sourceSynopsis}
                onChange={(e) => setWf((s) => ({ ...s, sourceSynopsis: e.target.value }))}
              />
            </label>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label className="field" style={{ margin: 0 }}>
                <span style={{ fontSize: 11 }}>方案数</span>
                <Select
                  className="select"
                  value={swapCount}
                  onChange={(e) => setSwapCount(Number(e.target.value))}
                >
                  {[3, 10, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </label>
              <Button
                variant="primary"
                disabled={!projectId || !wf.sourceSynopsis.trim()}
                onClick={() =>
                  projectId &&
                  void runAgentFeedback(projectId, "swap.master", {
                    label: "出多个换元方案（人来选）",
                    inputJson: {
                      synopsis: wf.sourceSynopsis,
                      degree: wf.method.preferredDegree,
                      avoidSciFi: wf.method.avoidSciFi,
                      sixElements: wf.sixElements,
                      count: swapCount,
                    },
                  })
                }
              >
                生成换元方案（{swapCount}）
              </Button>
            </div>
            {wf.swapCandidates.map((c) => (
              <div key={c.id} style={{ marginTop: 8 }}>
                <label className="row" style={{ gap: 8 }}>
                  <input
                    type="radio"
                    name="swap-pick-l3"
                    checked={wf.selectedSwapId === c.id}
                    onChange={() => {
                      const low = c.screenScore?.lowScoreWarned;
                      if (low && typeof window !== "undefined") {
                        const ok = window.confirm(
                          `该方案筛选分偏低（${c.screenScore?.total ?? 0}/7）。仍可选手选，确认选定？`,
                        );
                        if (!ok) return;
                      }
                      setWf((s) => ({
                        ...s,
                        selectedSwapId: c.id,
                        newSynopsis: c.summary,
                        swapCandidates: s.swapCandidates.map((x) => ({
                          ...x,
                          selected: x.id === c.id,
                        })),
                      }));
                    }}
                  />
                  <span style={{ fontSize: 12 }}>
                    <Badge>{c.degree === "once" ? "一度" : "二度"}</Badge> {c.summary}
                  </span>
                </label>
                <AiCandidateScreenPanel
                  candidate={c}
                  onChange={(screenScore) =>
                    setWf((s) => ({
                      ...s,
                      swapCandidates: s.swapCandidates.map((x) =>
                        x.id === c.id ? { ...x, screenScore } : x,
                      ),
                    }))
                  }
                />
              </div>
            ))}
            <Button
              size="sm"
              onClick={() => {
                const id = `swap-${Date.now()}`;
                setWf((s) => ({
                  ...s,
                  swapCandidates: [
                    ...s.swapCandidates,
                    {
                      id,
                      summary: s.newSynopsis || "（手写方案）",
                      degree: s.method.preferredDegree,
                      selected: false,
                      sixElementsBrief: "",
                      background: "",
                      event: "",
                      prop: "",
                      characterRelations: "",
                      eventFeelsStale: null,
                    },
                  ],
                }));
              }}
            >
              手动加入候选
            </Button>
            <label className="field">
              <span>选定后的新故事梗概（背景/事件/道具/人物关系）</span>
              <textarea
                className="textarea"
                rows={3}
                value={wf.newSynopsis}
                onChange={(e) => setWf((s) => ({ ...s, newSynopsis: e.target.value }))}
              />
            </label>
            {!wf.selectedSwapId && <Badge tone="warn">必须 radio 选定方案</Badge>}
          </CollapsibleSection>
        </>
      )}

      {wf.currentStep === 4 && (
        <>
          <CollapsibleSection title="搭结构：章纲 + 细纲批次（≤5 章/批）" defaultOpen>
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.chapterOutlineReady}
                onChange={(e) => setWf((s) => ({ ...s, chapterOutlineReady: e.target.checked }))}
              />
              <span style={{ fontSize: 12 }}>章纲已确认（情绪走向已对照）</span>
            </label>
            <label className="field">
              <span>细纲批次大小（1～5，禁止一次全书）</span>
              <input
                className="input"
                type="number"
                min={1}
                max={5}
                value={wf.beatBatchSize}
                onChange={(e) => {
                  const n = Math.min(5, Math.max(1, Number(e.target.value) || 3));
                  setWf((s) => ({ ...s, beatBatchSize: n }));
                }}
              />
            </label>
            <label className="field">
              <span>逐章细纲进度（章号|done/todo|备注）</span>
              <textarea
                className="textarea"
                rows={4}
                value={wf.beatSwapProgress
                  .map((b) => `${b.chapterNo}|${b.done ? "done" : "todo"}|${b.note}`)
                  .join("\n")}
                onChange={(e) => {
                  const beatSwapProgress = e.target.value
                    .split("\n")
                    .map((l) => l.trim())
                    .filter(Boolean)
                    .map((l) => {
                      const [no = "1", st = "todo", note = ""] = l.split("|");
                      return {
                        chapterNo: Number(no) || 1,
                        done: st === "done",
                        note,
                        batchIndex: Math.floor(((Number(no) || 1) - 1) / wf.beatBatchSize),
                      };
                    });
                  setWf((s) => ({ ...s, beatSwapProgress }));
                }}
              />
            </label>
            <Button
              size="sm"
              disabled={!projectId || !wf.chapterOutlineReady}
              onClick={() =>
                projectId &&
                void runAgentFeedback(projectId, "swap.master", {
                  label: `细纲批次 ${wf.currentBeatBatch + 1}（≤${wf.beatBatchSize} 章）`,
                  inputJson: {
                    mode: "beat_batch",
                    batchSize: wf.beatBatchSize,
                    batchIndex: wf.currentBeatBatch,
                    synopsis: wf.newSynopsis,
                  },
                })
              }
            >
              生成本批细纲（≤{wf.beatBatchSize} 章）
            </Button>
          </CollapsibleSection>
          <EmotionSlopeCompareWorkbench projectId={projectId} wf={wf} setWf={setWf} />
          <RhythmQuantPanel projectId={projectId} />
        </>
      )}

      {wf.currentStep === 5 && (
        <>
          <CollapsibleSection title="填细节：格式锁 + 省略项" defaultOpen>
            <label className="field">
              <span>格式（最大开关）</span>
              <Select
                className="select"
                value={wf.formatLock}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    formatLock: e.target.value as SwapImitateWorkflow["formatLock"],
                  }))
                }
              >
                <option value="short_novel">短篇</option>
                <option value="long_novel">长篇</option>
                <option value="duanju">短剧</option>
                <option value="manju">漫剧</option>
              </Select>
            </label>
            {wf.formatLock === "short_novel" && (
              <p className="muted" style={{ fontSize: 12 }}>
                短篇可不填世界观 / 力量体系 / 势力组织 / 金手指（见框架 omit；2.md 已有）。
              </p>
            )}
          </CollapsibleSection>
          <CharacterTrinityWorkbench projectId={projectId} wf={wf} setWf={setWf} />
        </>
      )}

      {wf.currentStep === 6 && (
        <CollapsibleSection title="写正文：写一章改好一章" defaultOpen>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.chapterReviseBeforeNext}
              onChange={(e) =>
                setWf((s) => ({ ...s, chapterReviseBeforeNext: e.target.checked }))
              }
            />
            <span style={{ fontSize: 12 }}>强制：本章改好后再生成下一章</span>
          </label>
          <label className="field">
            <span>章节状态（章号|generated|polished|humanRevised）</span>
            <textarea
              className="textarea"
              rows={4}
              value={wf.chaptersRevised
                .map(
                  (c) =>
                    `${c.chapterNo}|${c.generated ? "1" : "0"}|${c.polished ? "1" : "0"}|${c.humanRevised ? "1" : "0"}`,
                )
                .join("\n")}
              onChange={(e) => {
                const chaptersRevised = e.target.value
                  .split("\n")
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .map((l) => {
                    const [no = "1", g = "0", p = "0", h = "0"] = l.split("|");
                    return {
                      chapterNo: Number(no) || 1,
                      generated: g === "1",
                      polished: p === "1",
                      humanRevised: h === "1",
                    };
                  });
                setWf((s) => ({ ...s, chaptersRevised }));
              }}
            />
          </label>
          {wf.chapterReviseBeforeNext &&
            wf.chaptersRevised.some((c) => c.generated && !c.humanRevised) && (
              <Badge tone="fail">存在已生成未改好的章，禁止推进下一章</Badge>
            )}
          <Button
            size="sm"
            disabled={
              !projectId ||
              (wf.chapterReviseBeforeNext &&
                wf.chaptersRevised.some((c) => c.generated && !c.humanRevised))
            }
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "prose.short_opening", {
                label: "按细纲生成下一章",
                inputJson: { synopsis: wf.newSynopsis, reviseGate: wf.chapterReviseBeforeNext },
              })
            }
          >
            生成下一章
          </Button>
        </CollapsibleSection>
      )}

      {wf.currentStep === 7 && (
        <QcPriorityWorkbench projectId={projectId} wf={wf} setWf={setWf} />
      )}
    </div>
  );
}

/** 短篇 3.md 聚合工作区（按 Stage 也可拆开挂载） */
export function ShortNovelLesson3Workspace({ projectId }: { projectId?: string }) {
  return (
    <div className="stack">
      <SwapSevenStepWorkbench projectId={projectId} />
      <WashSegmentWorkbench projectId={projectId} />
      <RhythmQuantPanel projectId={projectId} />
    </div>
  );
}

/** 供 2.md 薄桩兼容：深化后的换元入口 */
export function SwapImitateWorkbenchV3({ projectId }: { projectId?: string }) {
  return <SwapSevenStepWorkbench projectId={projectId} />;
}
