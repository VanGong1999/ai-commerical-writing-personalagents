/**
 * 九格基础课（2.md）深度工作台：
 * 拆书 11 项参数 · 单元故事七步法 · 商业大纲层级 · 核心梗详情 ·
 * 提示词规则+指令 · 生成控长 · 追妻火葬场 · 文风提取 · 换元选方案。
 * 信息密度优先：每一步展示用户操作与中间产物细节，不简化。
 */
import type { Artifact } from "@xiezuomanju/domain";
import {
  CHASE_WIFE_PHASE_LABELS,
  COGNITIVE_GAP_LABELS,
  COMMERCIAL_WORKFLOW_ORDER,
  CORE_HOOK_CATEGORY_LABELS,
  CORE_HOOK_KIND_HINTS,
  CORE_HOOK_SIZE_LABELS,
  DEFAULT_GENERATION_POLICY,
  DISSECT_PURPOSE_LABELS,
  OUTLINE_LEVEL_LABELS,
  SHORT_NOVEL_CHECKPOINTS,
  STORY_SCALE_LABELS,
  UNIT_SEVEN_STEP_IDS,
  UNIT_SEVEN_STEP_LABELS,
  dissectParamsCompleteness,
  unitSevenStepsCompleteness,
  type ChaseWifeTemplate,
  type CognitiveGapQuadrant,
  type CoreHookCategory,
  type CoreHookFullBody,
  type CoreHookKind,
  type CoreHookSize,
  type DissectParamsBody,
  type DissectPurpose,
  type FrameworkBody,
  type GenerationPolicy,
  MasterOutlineBodySchema,
  type MasterOutlineBody,
  type OutlineLevel,
  type PromptCompose,
  type StyleExtractWorkflow,
  type UnitSevenSteps,
  type UnitStoryBody,
} from "@xiezuomanju/domain";
import {
  Badge,
  Button,
  CollapsibleSection,
  Panel,
  Tabs,
  toast,
} from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useMemo, useState } from "react";
import { DissectExpectationDesignInline } from "./NinesLesson4Panels";
import { runAgentFeedback } from "./runAgentFeedback";
import { usePersistedState } from "./usePersistedState";

const emptyDissect = (): DissectParamsBody => ({
  schemaVersion: "nines-2.md/1",
  purpose: "full_params",
  textCheck: {
    encoding: "unknown",
    lineEnding: "unknown",
    cleanedHierarchyNoise: false,
  },
  basic: { synopsis: "", genre: "", typeLabel: "" },
  expectations: { big: "", small: [] },
  setting: { background: "", protagonist: "", supporting: [] },
  storyline: {
    coreContent: "",
    note: "此处「核心内容」不是核心梗定义",
  },
  conflicts: [],
  conflictDesigns: [],
  emotionCurve: [],
  relationships: [],
  twists: [],
  qiChengZhuanHe: { qi: "", cheng: "", zhuan: "", he: "" },
  sevenSteps: {
    goal: "",
    obstacle: "",
    action: "",
    result: "",
    accident: "",
    twist: "",
    ending: "",
    reverseValidate: true,
  },
  rhythmStyle: { rhythm: "", style: "" },
  unitStories: [],
  extractedHooks: [],
  proofread: { comparedWithSource: false, rounds: 0, issues: [] },
  favoriteWorthDeep: [],
});

function listEdit(value: string, sep = /[、,，\n]/): string[] {
  return value
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ═══════════════ 1. 拆书参数 11 项 ═══════════════ */

export function DissectParamsWorkbench({
  projectId,
  artifacts,
}: {
  projectId?: string;
  artifacts?: Artifact[];
}) {
  const fromArt = artifacts?.find((a) => a.type === "dissect_params");
  const seedDissect: DissectParamsBody = (() => {
    const j = fromArt?.bodyJson as DissectParamsBody | undefined;
    return j?.schemaVersion ? { ...emptyDissect(), ...j } : emptyDissect();
  })();
  const [body, setBody] = usePersistedState<DissectParamsBody>(
    projectId,
    "dissect-params-v1",
    seedDissect,
  );
  const [tab, setTab] = useState("basic");
  const [busy, setBusy] = useState(false);
  const completeness = useMemo(() => dissectParamsCompleteness(body), [body]);
  const seven = useMemo(
    () => unitSevenStepsCompleteness(body.sevenSteps),
    [body.sevenSteps],
  );

  const runDissect = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      await runAgentFeedback(projectId, "kb.report_pipeline", {
        label: "拆书参数（11 项）",
        inputJson: {
          purpose: body.purpose,
          sourceTitle: body.sourceTitle,
          textCheck: body.textCheck,
          preferDeepUnits: body.favoriteWorthDeep,
        },
      });
      toast.info("已入队拆书分析，完成后可回写参数表");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <CollapsibleSection
        title="拆书参数模板（2.md · 11 项）"
        storageKey={projectId ? `nines2-${projectId}-dissect` : undefined}
        actions={
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <Badge tone={completeness.pct >= 80 ? "ok" : "warn"}>
              {completeness.filled}/{completeness.total} · {completeness.pct}%
            </Badge>
            <Badge tone={body.proofread.comparedWithSource ? "ok" : "fail"}>
              {body.proofread.comparedWithSource
                ? `已校对 ${body.proofread.rounds} 轮`
                : "未与原文校对"}
            </Badge>
            <Button variant="primary" disabled={!projectId || busy} onClick={() => void runDissect()}>
              {busy ? "分析中…" : "跑拆书流水线"}
            </Button>
          </div>
        }
      >
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          拆书积累是创作第一关键点。先明确目的 → 按单元故事拆 → 重点拆写得好的部分 →
          七步法反向验证 → 提取核心梗。禁止「把 100 万字全拆完」。文件须 TXT + UTF-8（Windows）。
        </p>

        <div className="field-grid" style={{ marginBottom: 10 }}>
          <label className="field">
            <span>拆书目的</span>
            <Select
              className="select"
              value={body.purpose}
              onChange={(e) =>
                setBody((s) => ({ ...s, purpose: e.target.value as DissectPurpose }))
              }
            >
              {(Object.keys(DISSECT_PURPOSE_LABELS) as DissectPurpose[]).map((k) => (
                <option key={k} value={k}>
                  {DISSECT_PURPOSE_LABELS[k]}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span>对标作品名</span>
            <input
              className="input"
              value={body.sourceTitle ?? ""}
              onChange={(e) => setBody((s) => ({ ...s, sourceTitle: e.target.value }))}
              placeholder="如《大奉打更人》碎银案单元"
            />
          </label>
          <label className="field">
            <span>文本编码</span>
            <Select
              className="select"
              value={body.textCheck.encoding}
              onChange={(e) =>
                setBody((s) => ({
                  ...s,
                  textCheck: {
                    ...s.textCheck,
                    encoding: e.target.value as DissectParamsBody["textCheck"]["encoding"],
                  },
                }))
              }
            >
              <option value="utf8_windows">UTF-8 Windows（推荐）</option>
              <option value="utf8_unix">UTF-8 Unix LF（易出问题）</option>
              <option value="other">其他</option>
              <option value="unknown">未检查</option>
            </Select>
          </label>
          <label className="field">
            <span>行尾</span>
            <Select
              className="select"
              value={body.textCheck.lineEnding}
              onChange={(e) =>
                setBody((s) => ({
                  ...s,
                  textCheck: {
                    ...s.textCheck,
                    lineEnding: e.target.value as DissectParamsBody["textCheck"]["lineEnding"],
                  },
                }))
              }
            >
              <option value="crlf">CRLF</option>
              <option value="lf">LF</option>
              <option value="mixed">混合</option>
              <option value="unknown">未知</option>
            </Select>
          </label>
        </div>
        <label className="row" style={{ gap: 8, marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={body.textCheck.cleanedHierarchyNoise}
            onChange={(e) =>
              setBody((s) => ({
                ...s,
                textCheck: { ...s.textCheck, cleanedHierarchyNoise: e.target.checked },
              }))
            }
          />
          <span style={{ fontSize: 12 }}>已清理多余层级数字，保留「第一集、第二集」结构</span>
        </label>

        {completeness.missing.length > 0 && (
          <p className="muted" style={{ fontSize: 12 }}>
            未填项：{completeness.missing.join("、")}
          </p>
        )}

        <Tabs
          tabs={[
            { id: "basic", label: "1 基本信息" },
            { id: "expect", label: "2 期待感" },
            { id: "setting", label: "3 设定" },
            { id: "storyline", label: "4 脉络" },
            { id: "conflict", label: "5 冲突" },
            { id: "emotion", label: "6 情绪" },
            { id: "relation", label: "7 关系" },
            { id: "twist", label: "8 反转" },
            { id: "qczh", label: "9 起承转合" },
            { id: "seven", label: "10 七步法" },
            { id: "rhythm", label: "11 节奏" },
            { id: "units", label: "单元故事" },
            { id: "proof", label: "校对" },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === "basic" && (
          <div className="field-grid" style={{ marginTop: 10 }}>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>故事梗概（什么样的故事）</span>
              <textarea
                className="textarea"
                rows={3}
                value={body.basic.synopsis}
                onChange={(e) =>
                  setBody((s) => ({ ...s, basic: { ...s.basic, synopsis: e.target.value } }))
                }
              />
            </label>
            <label className="field">
              <span>题材</span>
              <input
                className="input"
                value={body.basic.genre}
                onChange={(e) =>
                  setBody((s) => ({ ...s, basic: { ...s.basic, genre: e.target.value } }))
                }
              />
            </label>
            <label className="field">
              <span>类型</span>
              <input
                className="input"
                value={body.basic.typeLabel}
                onChange={(e) =>
                  setBody((s) => ({ ...s, basic: { ...s.basic, typeLabel: e.target.value } }))
                }
                placeholder="短篇 / 长篇 / 短剧 / 漫剧"
              />
            </label>
            <label className="field">
              <span>大致字数</span>
              <input
                className="input"
                type="number"
                value={body.basic.approxWords ?? ""}
                onChange={(e) =>
                  setBody((s) => ({
                    ...s,
                    basic: {
                      ...s.basic,
                      approxWords: e.target.value ? Number(e.target.value) : undefined,
                    },
                  }))
                }
              />
            </label>
          </div>
        )}

        {tab === "expect" && (
          <div className="stack" style={{ marginTop: 10, gap: 8 }}>
            <DissectExpectationDesignInline
              big={body.expectations.big}
              small={body.expectations.small}
              design={body.expectations.design}
              onThinChange={(big, small) =>
                setBody((s) => ({
                  ...s,
                  expectations: { ...s.expectations, big, small },
                }))
              }
              onChange={(design) =>
                setBody((s) => ({
                  ...s,
                  expectations: {
                    ...s.expectations,
                    design,
                    big: design.core.content || s.expectations.big,
                    small: design.small.map((x) => x.content).filter(Boolean),
                  },
                }))
              }
            />
          </div>
        )}

        {tab === "setting" && (
          <div className="field-grid" style={{ marginTop: 10 }}>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>背景</span>
              <textarea
                className="textarea"
                rows={2}
                value={body.setting.background}
                onChange={(e) =>
                  setBody((s) => ({
                    ...s,
                    setting: { ...s.setting, background: e.target.value },
                  }))
                }
              />
            </label>
            <label className="field">
              <span>主角</span>
              <input
                className="input"
                value={body.setting.protagonist}
                onChange={(e) =>
                  setBody((s) => ({
                    ...s,
                    setting: { ...s.setting, protagonist: e.target.value },
                  }))
                }
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>配角（顿号分隔）</span>
              <input
                className="input"
                value={body.setting.supporting.join("、")}
                onChange={(e) =>
                  setBody((s) => ({
                    ...s,
                    setting: { ...s.setting, supporting: listEdit(e.target.value) },
                  }))
                }
              />
            </label>
          </div>
        )}

        {tab === "storyline" && (
          <div className="stack" style={{ marginTop: 10 }}>
            <Badge tone="warn">注意：此处「核心内容」≠ 核心梗定义</Badge>
            <label className="field">
              <span>故事脉络 / 核心内容</span>
              <textarea
                className="textarea"
                rows={4}
                value={body.storyline.coreContent}
                onChange={(e) =>
                  setBody((s) => ({
                    ...s,
                    storyline: { ...s.storyline, coreContent: e.target.value },
                  }))
                }
              />
            </label>
          </div>
        )}

        {tab === "conflict" && (
          <div className="stack" style={{ marginTop: 10, gap: 8 }}>
            <label className="field">
              <span>核心冲突（薄字段，可多个，换行）</span>
              <textarea
                className="textarea"
                rows={3}
                value={body.conflicts.join("\n")}
                onChange={(e) => setBody((s) => ({ ...s, conflicts: listEdit(e.target.value, /\n/) }))}
                placeholder={"例：\n主角与老员工抢项目\n真相与谎言"}
              />
            </label>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              六要素 / 升级路径设计态见 SYNOPSIS 阶段「期待感 + 矛盾」九步台；此处仍属拆书 11 项第 5 项，不新增第 12 项。
            </p>
            <label className="field">
              <span>冲突设计态摘要（oneLiner，换行；写入 conflictDesigns）</span>
              <textarea
                className="textarea"
                rows={3}
                value={(body.conflictDesigns ?? []).map((c) => c.oneLiner).join("\n")}
                onChange={(e) => {
                  const lines = listEdit(e.target.value, /\n/);
                  setBody((s) => ({
                    ...s,
                    conflictDesigns: lines.map((oneLiner, i) => ({
                      ...(s.conflictDesigns?.[i] ?? {
                        id: `cd-${i}`,
                        kind: "hostile" as const,
                        locus: "external" as const,
                        targetPriority: "protagonist" as const,
                        opponentStrong: false,
                        consequenceSevere: false,
                        goalStrong: false,
                        upgradeMode: "singleEvent" as const,
                        upgradeSteps: [],
                        chainUnbroken: true,
                        antiDeusEx: false,
                        resolutionStyle: "",
                        villainEnding: "undecided" as const,
                        noWinWin: true,
                        passiveHive: true,
                        six: { items: [] },
                        linkedExpectationId: "",
                      }),
                      oneLiner,
                      id: s.conflictDesigns?.[i]?.id || `cd-${i}`,
                    })),
                    conflicts: lines.length ? lines : s.conflicts,
                  }));
                }}
              />
            </label>
          </div>
        )}

        {tab === "emotion" && (
          <div className="stack" style={{ marginTop: 10, gap: 8 }}>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              仿写仿的核心就是节奏和情绪。例：紧张→迷茫→绝望→伤感→微光希望→有点希望。
            </p>
            <label className="field">
              <span>情绪点（格式：标签|分值|备注，一行一个，分值 -10～+10）</span>
              <textarea
                className="textarea"
                rows={5}
                value={body.emotionCurve
                  .map((p) => `${p.beatLabel}|${p.value}|${p.note ?? ""}`)
                  .join("\n")}
                onChange={(e) => {
                  const emotionCurve = e.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line) => {
                      const [beatLabel = "", valueRaw = "0", note = ""] = line.split("|");
                      const value = Math.max(-10, Math.min(10, Number(valueRaw) || 0));
                      return { beatLabel, value, note: note || undefined };
                    });
                  setBody((s) => ({ ...s, emotionCurve }));
                }}
              />
            </label>
            {body.emotionCurve.length > 0 && (
              <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
                {body.emotionCurve.map((p, i) => (
                  <Badge key={i} tone={p.value >= 0 ? "ok" : "warn"}>
                    {p.beatLabel || `#${i + 1}`} {p.value > 0 ? `+${p.value}` : p.value}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "relation" && (
          <label className="field" style={{ marginTop: 10 }}>
            <span>人物关系（格式：甲→乙：纽带，一行一个）</span>
            <textarea
              className="textarea"
              rows={4}
              value={body.relationships
                .map((r) => `${r.from}→${r.to}：${r.bond}`)
                .join("\n")}
              onChange={(e) => {
                const relationships = e.target.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line) => {
                    const m = line.match(/^(.+?)→(.+?)[：:](.+)$/);
                    if (!m) return { from: line, to: "", bond: "" };
                    return { from: m[1].trim(), to: m[2].trim(), bond: m[3].trim() };
                  });
                setBody((s) => ({ ...s, relationships }));
              }}
            />
          </label>
        )}

        {tab === "twist" && (
          <label className="field" style={{ marginTop: 10 }}>
            <span>故事反转（可二次/多次，换行）</span>
            <textarea
              className="textarea"
              rows={3}
              value={body.twists.join("\n")}
              onChange={(e) => setBody((s) => ({ ...s, twists: listEdit(e.target.value, /\n/) }))}
            />
          </label>
        )}

        {tab === "qczh" && (
          <div className="field-grid" style={{ marginTop: 10 }}>
            {(
              [
                ["qi", "起"],
                ["cheng", "承"],
                ["zhuan", "转"],
                ["he", "合"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="field" style={{ gridColumn: "1 / -1" }}>
                <span>{label}</span>
                <textarea
                  className="textarea"
                  rows={2}
                  value={body.qiChengZhuanHe[k]}
                  onChange={(e) =>
                    setBody((s) => ({
                      ...s,
                      qiChengZhuanHe: { ...s.qiChengZhuanHe, [k]: e.target.value },
                    }))
                  }
                />
              </label>
            ))}
            <label className="field">
              <span>对应章节范围</span>
              <input
                className="input"
                value={body.qiChengZhuanHe.chapterRange ?? ""}
                onChange={(e) =>
                  setBody((s) => ({
                    ...s,
                    qiChengZhuanHe: { ...s.qiChengZhuanHe, chapterRange: e.target.value },
                  }))
                }
                placeholder="如 1～5 章"
              />
            </label>
          </div>
        )}

        {tab === "seven" && (
          <div className="stack" style={{ marginTop: 10, gap: 8 }}>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <Badge tone={seven.filled === 7 ? "ok" : "warn"}>
                {seven.filled}/7 步
              </Badge>
              {seven.earlySuccessRisk && (
                <Badge tone="fail">风险：结果过早成功，缺意外→爽点不足</Badge>
              )}
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={body.sevenSteps.reverseValidate}
                  onChange={(e) =>
                    setBody((s) => ({
                      ...s,
                      sevenSteps: { ...s.sevenSteps, reverseValidate: e.target.checked },
                    }))
                  }
                />
                <span style={{ fontSize: 12 }}>反向拆书验证模式</span>
              </label>
            </div>
            {UNIT_SEVEN_STEP_IDS.map((id) => (
              <label key={id} className="field">
                <span>
                  {UNIT_SEVEN_STEP_LABELS[id]}
                  {!body.sevenSteps[id].trim() && <Badge tone="fail">缺</Badge>}
                </span>
                <textarea
                  className="textarea"
                  rows={2}
                  value={body.sevenSteps[id]}
                  onChange={(e) =>
                    setBody((s) => ({
                      ...s,
                      sevenSteps: { ...s.sevenSteps, [id]: e.target.value },
                    }))
                  }
                />
              </label>
            ))}
          </div>
        )}

        {tab === "rhythm" && (
          <div className="field-grid" style={{ marginTop: 10 }}>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>整体节奏</span>
              <textarea
                className="textarea"
                rows={2}
                value={body.rhythmStyle.rhythm}
                onChange={(e) =>
                  setBody((s) => ({
                    ...s,
                    rhythmStyle: { ...s.rhythmStyle, rhythm: e.target.value },
                  }))
                }
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>风格</span>
              <textarea
                className="textarea"
                rows={2}
                value={body.rhythmStyle.style}
                onChange={(e) =>
                  setBody((s) => ({
                    ...s,
                    rhythmStyle: { ...s.rhythmStyle, style: e.target.value },
                  }))
                }
                placeholder="如写实风格"
              />
            </label>
          </div>
        )}

        {tab === "units" && (
          <UnitStoriesEditor
            units={body.unitStories}
            favorite={body.favoriteWorthDeep}
            onChange={(unitStories, favoriteWorthDeep) =>
              setBody((s) => ({ ...s, unitStories, favoriteWorthDeep }))
            }
          />
        )}

        {tab === "proof" && (
          <div className="stack" style={{ marginTop: 10, gap: 8 }}>
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={body.proofread.comparedWithSource}
                onChange={(e) =>
                  setBody((s) => ({
                    ...s,
                    proofread: { ...s.proofread, comparedWithSource: e.target.checked },
                  }))
                }
              />
              <span>已与原剧/原文对比校对</span>
            </label>
            <label className="field">
              <span>校对轮次</span>
              <input
                className="input"
                type="number"
                min={0}
                value={body.proofread.rounds}
                onChange={(e) =>
                  setBody((s) => ({
                    ...s,
                    proofread: { ...s.proofread, rounds: Number(e.target.value) || 0 },
                  }))
                }
              />
            </label>
            <label className="field">
              <span>发现问题（换行）</span>
              <textarea
                className="textarea"
                rows={3}
                value={body.proofread.issues.join("\n")}
                onChange={(e) =>
                  setBody((s) => ({
                    ...s,
                    proofread: {
                      ...s.proofread,
                      issues: listEdit(e.target.value, /\n/),
                    },
                  }))
                }
              />
            </label>
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}

function UnitStoriesEditor({
  units,
  favorite,
  onChange,
}: {
  units: UnitStoryBody[];
  favorite: string[];
  onChange: (units: UnitStoryBody[], favorite: string[]) => void;
}) {
  const add = () => {
    const id = `u${units.length + 1}`;
    onChange(
      [
        ...units,
        {
          id,
          title: "",
          scale: "unit",
          chapterRange: "",
          purpose: "",
          worthDeepDissect: false,
          summary: "",
        },
      ],
      favorite,
    );
  };
  return (
    <div className="stack" style={{ marginTop: 10, gap: 10 }}>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        大=全篇 · 中=一卷 · 小=单元（约 1 万字）。长篇=N 个单元；剧本≈5～8 个单元。例：大奉 1～5
        碎银案 / 6～9 家庭 / 10～15 杀人案 / 16～17 勾栏听曲——重点拆碎银案。
      </p>
      {units.map((u, idx) => (
        <Panel key={u.id || idx} title={`单元 ${idx + 1}${u.title ? ` · ${u.title}` : ""}`}>
          <div className="field-grid">
            <label className="field">
              <span>标题</span>
              <input
                className="input"
                value={u.title}
                onChange={(e) => {
                  const next = [...units];
                  next[idx] = { ...u, title: e.target.value };
                  onChange(next, favorite);
                }}
              />
            </label>
            <label className="field">
              <span>层级</span>
              <Select
                className="select"
                value={u.scale}
                onChange={(e) => {
                  const next = [...units];
                  next[idx] = {
                    ...u,
                    scale: e.target.value as UnitStoryBody["scale"],
                  };
                  onChange(next, favorite);
                }}
              >
                {(Object.keys(STORY_SCALE_LABELS) as UnitStoryBody["scale"][]).map((k) => (
                  <option key={k} value={k}>
                    {STORY_SCALE_LABELS[k].label}（{STORY_SCALE_LABELS[k].scale}）
                  </option>
                ))}
              </Select>
            </label>
            <label className="field">
              <span>章节范围</span>
              <input
                className="input"
                value={u.chapterRange}
                onChange={(e) => {
                  const next = [...units];
                  next[idx] = { ...u, chapterRange: e.target.value };
                  onChange(next, favorite);
                }}
                placeholder="1～5 章"
              />
            </label>
            <label className="row" style={{ gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={u.worthDeepDissect}
                onChange={(e) => {
                  const next = [...units];
                  next[idx] = { ...u, worthDeepDissect: e.target.checked };
                  const fav = e.target.checked
                    ? [...new Set([...favorite, u.id || u.title])]
                    : favorite.filter((x) => x !== u.id && x !== u.title);
                  onChange(next, fav);
                }}
              />
              <span style={{ fontSize: 12 }}>值得深拆细纲</span>
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>摘要</span>
              <textarea
                className="textarea"
                rows={2}
                value={u.summary}
                onChange={(e) => {
                  const next = [...units];
                  next[idx] = { ...u, summary: e.target.value };
                  onChange(next, favorite);
                }}
              />
            </label>
          </div>
        </Panel>
      ))}
      <Button size="sm" onClick={add}>
        + 添加单元故事
      </Button>
    </div>
  );
}

/* ═══════════════ 2. 单元故事七步法 ═══════════════ */

export function UnitSevenStepWorkbench({ projectId }: { projectId?: string }) {
  const [steps, setSteps] = usePersistedState<UnitSevenSteps>(projectId, "unit-seven", {
    goal: "",
    obstacle: "",
    action: "",
    result: "",
    accident: "",
    twist: "",
    ending: "",
    reverseValidate: false,
    nestedUnder: "",
    notes: "",
  });
  const c = unitSevenStepsCompleteness(steps);

  return (
    <CollapsibleSection
      title="单元故事七步法（目标→阻碍→行动→结果→意外→转折→结局）"
      storageKey={projectId ? `nines2-${projectId}-unit7` : undefined}
      actions={
        <div className="row" style={{ gap: 6 }}>
          <Badge tone={c.filled === 7 ? "ok" : "warn"}>
            {c.filled}/7
          </Badge>
          {c.earlySuccessRisk && <Badge tone="fail">过早成功风险</Badge>}
          <Button
            variant="primary"
            disabled={!projectId || c.filled < 4}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "struct.beat_sheet", {
                label: "按七步法展开细纲",
                inputJson: { sevenSteps: steps },
              })
            }
          >
            按七步展开细纲
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
        与「人设七步」不同：这是故事推进公式。前四步通常失败——一下成功就没有爽点；可嵌套进大/中/小层级；拆书时反向提问验证 AI。
      </p>
      {UNIT_SEVEN_STEP_IDS.map((id) => (
        <label key={id} className="field" style={{ marginBottom: 8 }}>
          <span>{UNIT_SEVEN_STEP_LABELS[id]}</span>
          <textarea
            className="textarea"
            rows={2}
            value={steps[id]}
            onChange={(e) => setSteps((s) => ({ ...s, [id]: e.target.value }))}
          />
        </label>
      ))}
      <label className="field">
        <span>嵌套于（更大故事目标）</span>
        <input
          className="input"
          value={steps.nestedUnder ?? ""}
          onChange={(e) => setSteps((s) => ({ ...s, nestedUnder: e.target.value }))}
        />
      </label>
    </CollapsibleSection>
  );
}

/* ═══════════════ 3. 商业大纲层级工作台 ═══════════════ */

export function CommercialOutlineWorkbench({ projectId }: { projectId?: string }) {
  const [level, setLevel] = usePersistedState<OutlineLevel>(projectId, "outline-level", "master");
  const [master, setMaster] = usePersistedState<MasterOutlineBody>(
    projectId,
    "master-outline",
    MasterOutlineBodySchema.parse({ formatHint: "short_novel" }),
  );
  const [framework, setFramework] = usePersistedState<FrameworkBody>(projectId, "framework", {
    charactersBrief: "",
    worldview: "",
    powerSystem: "",
    factions: "",
    goldFinger: "",
    styleRules: "",
    omit: {
      omitWorldview: true,
      omitPowerSystem: true,
      omitFactions: true,
      omitGoldFinger: true,
      requireStyle: true,
      requireCharacters: true,
    },
  });
  const [checkpoints, setCheckpoints] = usePersistedState(
    projectId,
    "workflow-checkpoints",
    SHORT_NOVEL_CHECKPOINTS,
  );

  return (
    <div className="stack">
      <CollapsibleSection
        title="商业创作工作流（灵感→总纲→框架→章纲→细纲→初稿→修改）"
        storageKey={projectId ? `nines2-${projectId}-workflow` : undefined}
      >
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          「大纲」歧义太重——请用总纲/框架/章纲/细纲/卷纲。前面每一步都是对 AI 的限制条件；跳过故事梗概直接写细纲是常见错误。
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {COMMERCIAL_WORKFLOW_ORDER.map((lv) => (
            <button
              key={lv}
              type="button"
              className="badge"
              style={level === lv ? { borderColor: "var(--accent)" } : undefined}
              onClick={() => setLevel(lv)}
            >
              {OUTLINE_LEVEL_LABELS[lv]}
            </button>
          ))}
        </div>

        <div className="stack" style={{ gap: 6, marginBottom: 12 }}>
          <strong style={{ fontSize: 13 }}>检查点（用户操作）</strong>
          {checkpoints.map((cp, i) => (
            <label key={cp.id} className="row" style={{ gap: 8, alignItems: "flex-start" }}>
              <input
                type="checkbox"
                checked={cp.done}
                onChange={(e) => {
                  const next = [...checkpoints];
                  next[i] = { ...cp, done: e.target.checked };
                  setCheckpoints(next);
                }}
              />
              <span style={{ fontSize: 12 }}>
                <strong>{cp.label}</strong>
                <span className="muted">
                  {" "}
                  · 你：{cp.userAction} · AI：{cp.aiAction}
                </span>
                {cp.displayFields.length > 0 && (
                  <span className="muted"> · 展示：{cp.displayFields.join("、")}</span>
                )}
              </span>
            </label>
          ))}
        </div>

        {(level === "master" || level === "inspiration") && (
          <div className="field-grid">
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>总纲 / 故事梗概</span>
              <textarea
                className="textarea"
                rows={3}
                value={master.logline}
                onChange={(e) => setMaster((s) => ({ ...s, logline: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>题材</span>
              <input
                className="input"
                value={master.genre}
                onChange={(e) => setMaster((s) => ({ ...s, genre: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>核心冲突一句话</span>
              <input
                className="input"
                value={master.coreConflictOneLiner}
                onChange={(e) =>
                  setMaster((s) => ({ ...s, coreConflictOneLiner: e.target.value }))
                }
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>大期待</span>
              <input
                className="input"
                value={master.bigExpectation}
                onChange={(e) => setMaster((s) => ({ ...s, bigExpectation: e.target.value }))}
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>小期待（顿号分隔）</span>
              <input
                className="input"
                value={master.smallExpectations.join("、")}
                onChange={(e) =>
                  setMaster((s) => ({ ...s, smallExpectations: listEdit(e.target.value) }))
                }
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>配对摘要（4.md 回写）</span>
              <input
                className="input"
                value={master.pairingSummary ?? ""}
                onChange={(e) => setMaster((s) => ({ ...s, pairingSummary: e.target.value }))}
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>筛选分摘要（换元候选）</span>
              <input
                className="input"
                value={master.screenScoreSummary ?? ""}
                onChange={(e) => setMaster((s) => ({ ...s, screenScoreSummary: e.target.value }))}
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>情绪节奏摘要（5.md）</span>
              <input
                className="input"
                value={master.emotionRhythmSummary ?? ""}
                onChange={(e) => setMaster((s) => ({ ...s, emotionRhythmSummary: e.target.value }))}
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>爽点打脸摘要（6.md）</span>
              <input
                className="input"
                value={master.coolFaceSlapSummary ?? ""}
                onChange={(e) => setMaster((s) => ({ ...s, coolFaceSlapSummary: e.target.value }))}
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>灵感成故事摘要（8.md）</span>
              <input
                className="input"
                value={master.inspirationToStorySummary ?? ""}
                onChange={(e) =>
                  setMaster((s) => ({ ...s, inspirationToStorySummary: e.target.value }))
                }
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>短篇选题摘要（9.md）</span>
              <input
                className="input"
                value={master.topicSelectionSummary ?? ""}
                onChange={(e) =>
                  setMaster((s) => ({ ...s, topicSelectionSummary: e.target.value }))
                }
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>人设深度摘要（10.md）</span>
              <input
                className="input"
                value={master.characterDepthSummary ?? ""}
                onChange={(e) =>
                  setMaster((s) => ({ ...s, characterDepthSummary: e.target.value }))
                }
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>漫剧管线摘要（11.md）</span>
              <input
                className="input"
                value={master.manjuPipelineSummary ?? ""}
                onChange={(e) =>
                  setMaster((s) => ({ ...s, manjuPipelineSummary: e.target.value }))
                }
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>漫剧题材轨摘要（12.md）</span>
              <input
                className="input"
                value={master.manjuGenreTrackSummary ?? ""}
                onChange={(e) =>
                  setMaster((s) => ({ ...s, manjuGenreTrackSummary: e.target.value }))
                }
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>IP 改编摘要（13.md）</span>
              <input
                className="input"
                value={master.ipAdaptSummary ?? ""}
                onChange={(e) =>
                  setMaster((s) => ({ ...s, ipAdaptSummary: e.target.value }))
                }
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>女频长篇深度摘要（14.md）</span>
              <input
                className="input"
                value={master.femaleLongDepthSummary ?? ""}
                onChange={(e) =>
                  setMaster((s) => ({ ...s, femaleLongDepthSummary: e.target.value }))
                }
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>女频节奏下半摘要（15.md）</span>
              <input
                className="input"
                value={master.femalePaceDepthSummary ?? ""}
                onChange={(e) =>
                  setMaster((s) => ({ ...s, femalePaceDepthSummary: e.target.value }))
                }
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>考拉流水线摘要（16.md）</span>
              <input
                className="input"
                value={master.manjuKoalaSummary ?? ""}
                onChange={(e) =>
                  setMaster((s) => ({ ...s, manjuKoalaSummary: e.target.value }))
                }
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>漫剧进阶摘要（17.md）</span>
              <input
                className="input"
                value={master.manjuAdvancedSummary ?? ""}
                onChange={(e) =>
                  setMaster((s) => ({ ...s, manjuAdvancedSummary: e.target.value }))
                }
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>实操手册SOP摘要</span>
              <input
                className="input"
                value={master.manjuHandbookSummary ?? ""}
                onChange={(e) =>
                  setMaster((s) => ({ ...s, manjuHandbookSummary: e.target.value }))
                }
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>投稿三块摘要</span>
              <input
                className="input"
                value={master.manjuPitchPackSummary ?? ""}
                onChange={(e) =>
                  setMaster((s) => ({ ...s, manjuPitchPackSummary: e.target.value }))
                }
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>查理短剧摘要</span>
              <input
                className="input"
                value={master.duanjuCharlieSummary ?? ""}
                onChange={(e) =>
                  setMaster((s) => ({ ...s, duanjuCharlieSummary: e.target.value }))
                }
              />
            </label>
            <p className="muted" style={{ fontSize: 11, gridColumn: "1 / -1" }}>
              短篇见四–十；漫剧十一/十二/十六/十七+手册SOP；IP 十三；女频十四/十五；短剧查理 Ops。此处仅薄摘要。
            </p>
          </div>
        )}

        {level === "framework" && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {(
                [
                  ["omitWorldview", "省略世界观"],
                  ["omitPowerSystem", "省略力量体系"],
                  ["omitFactions", "省略势力组织"],
                  ["omitGoldFinger", "省略金手指"],
                  ["requireStyle", "需要文风"],
                  ["requireCharacters", "需要角色"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="row" style={{ gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={!!framework.omit[k]}
                    onChange={(e) =>
                      setFramework((s) => ({
                        ...s,
                        omit: { ...s.omit, [k]: e.target.checked },
                      }))
                    }
                  />
                  <span style={{ fontSize: 12 }}>{label}</span>
                </label>
              ))}
            </div>
            <label className="field">
              <span>角色简述</span>
              <textarea
                className="textarea"
                rows={2}
                value={framework.charactersBrief}
                onChange={(e) =>
                  setFramework((s) => ({ ...s, charactersBrief: e.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>文风规则</span>
              <textarea
                className="textarea"
                rows={2}
                value={framework.styleRules}
                onChange={(e) => setFramework((s) => ({ ...s, styleRules: e.target.value }))}
              />
            </label>
            {!framework.omit.omitWorldview && (
              <label className="field">
                <span>世界观</span>
                <textarea
                  className="textarea"
                  rows={2}
                  value={framework.worldview}
                  onChange={(e) => setFramework((s) => ({ ...s, worldview: e.target.value }))}
                />
              </label>
            )}
            {!framework.omit.omitGoldFinger && (
              <label className="field">
                <span>金手指</span>
                <input
                  className="input"
                  value={framework.goldFinger}
                  onChange={(e) => setFramework((s) => ({ ...s, goldFinger: e.target.value }))}
                />
              </label>
            )}
          </div>
        )}

        {(level === "chapter" || level === "beat" || level === "draft") && (
          <GenerationPolicyPanel projectId={projectId} />
        )}
      </CollapsibleSection>
    </div>
  );
}

/* ═══════════════ 4. 生成控长 ═══════════════ */

export function GenerationPolicyPanel({ projectId }: { projectId?: string }) {
  const [policy, setPolicy] = usePersistedState<GenerationPolicy>(
    projectId,
    "gen-policy",
    DEFAULT_GENERATION_POLICY,
  );
  return (
    <Panel title="生成控长策略（情节点个数，非精确字数）">
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        AI 单次优质输出约 2000～3000 汉字；理解「写 521 字」但执行不准。用情节点个数控长；禁止一次全书。
      </p>
      <div className="field-grid">
        <label className="field">
          <span>情节点个数</span>
          <input
            className="input"
            type="number"
            min={1}
            max={12}
            value={policy.plotPointCount}
            onChange={(e) =>
              setPolicy((s) => ({ ...s, plotPointCount: Number(e.target.value) || 3 }))
            }
          />
        </label>
        <label className="field">
          <span>汉字下限</span>
          <input
            className="input"
            type="number"
            value={policy.minChars}
            onChange={(e) =>
              setPolicy((s) => ({ ...s, minChars: Number(e.target.value) || 2000 }))
            }
          />
        </label>
        <label className="field">
          <span>汉字上限</span>
          <input
            className="input"
            type="number"
            value={policy.maxChars}
            onChange={(e) =>
              setPolicy((s) => ({ ...s, maxChars: Number(e.target.value) || 3000 }))
            }
          />
        </label>
        <label className="field">
          <span>分段模式</span>
          <Select
            className="select"
            value={policy.chunkMode}
            onChange={(e) =>
              setPolicy((s) => ({
                ...s,
                chunkMode: e.target.value as GenerationPolicy["chunkMode"],
              }))
            }
          >
            <option value="beat_batch">按情节点批次</option>
            <option value="chapter">按章</option>
            <option value="episode">按集</option>
          </Select>
        </label>
        <label className="field">
          <span>窗口策略</span>
          <Select
            className="select"
            value={policy.windowPolicy}
            onChange={(e) =>
              setPolicy((s) => ({
                ...s,
                windowPolicy: e.target.value as GenerationPolicy["windowPolicy"],
              }))
            }
          >
            <option value="one_topic_per_window">一类问题一个窗口（推荐）</option>
            <option value="carry_full_context">摘取前文全量续写</option>
          </Select>
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={policy.forbidWholeBook}
            onChange={(e) => setPolicy((s) => ({ ...s, forbidWholeBook: e.target.checked }))}
          />
          <span style={{ fontSize: 12 }}>禁止一次性全书 / 万字整篇</span>
        </label>
      </div>
    </Panel>
  );
}

/* ═══════════════ 5. 核心梗详情（vs 情节卡） ═══════════════ */

export function CoreHookDetailWorkbench({
  projectId,
  artifacts,
}: {
  projectId?: string;
  artifacts?: Artifact[];
}) {
  const adopted = artifacts?.find((a) => a.type === "core_hook" && a.status === "adopted");
  const seedHook: CoreHookFullBody = (() => {
    const j = adopted?.bodyJson as Partial<CoreHookFullBody> | undefined;
    return {
      kind: "core_hook",
      size: "unit",
      titleHook: j?.titleHook ?? adopted?.title ?? "",
      coreHook: j?.coreHook ?? "",
      emotionChain: j?.emotionChain ?? [],
      tags: j?.tags ?? [],
      motivation: j?.motivation ?? "",
      crisis: j?.crisis ?? "",
      openingStructure: j?.openingStructure ?? "",
      openingBeats: j?.openingBeats ?? [],
      abstractions: j?.abstractions ?? [],
      conflicts: j?.conflicts ?? [],
      favorited: false,
      riskFlags: j?.riskFlags ?? [],
      plotCardSteps: [],
      category: j?.category,
    };
  })();
  const [hook, setHook] = usePersistedState<CoreHookFullBody>(
    projectId,
    "core-hook-full",
    seedHook,
  );

  return (
    <CollapsibleSection
      title="核心梗详情（梗 vs 情节卡 · 情绪链条 · 大小层级）"
      storageKey={projectId ? `nines2-${projectId}-hook` : undefined}
      actions={
        <Button
          variant="primary"
          disabled={!projectId}
          onClick={() =>
            projectId &&
            void runAgentFeedback(projectId, "topic.core_hook_batch", {
              label: "核心梗批量（含类型/情绪链）",
              inputJson: {
                count: 10,
                category: hook.category,
                kind: hook.kind,
                seed: hook.coreHook,
              },
            })
          }
        >
          批量生成候选
        </Button>
      }
    >
      <div className="field-grid">
        <label className="field">
          <span>类型判定</span>
          <Select
            className="select"
            value={hook.kind}
            onChange={(e) => setHook((s) => ({ ...s, kind: e.target.value as CoreHookKind }))}
          >
            <option value="core_hook">核心梗</option>
            <option value="plot_card">情节卡</option>
          </Select>
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {CORE_HOOK_KIND_HINTS[hook.kind]}
          </span>
        </label>
        <label className="field">
          <span>分类</span>
          <Select
            className="select"
            value={hook.category ?? ""}
            onChange={(e) =>
              setHook((s) => ({
                ...s,
                category: (e.target.value || undefined) as CoreHookCategory | undefined,
              }))
            }
          >
            <option value="">未选</option>
            {(Object.keys(CORE_HOOK_CATEGORY_LABELS) as CoreHookCategory[]).map((k) => (
              <option key={k} value={k}>
                {CORE_HOOK_CATEGORY_LABELS[k]}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span>大小层级</span>
          <Select
            className="select"
            value={hook.size}
            onChange={(e) => setHook((s) => ({ ...s, size: e.target.value as CoreHookSize }))}
          >
            {(Object.keys(CORE_HOOK_SIZE_LABELS) as CoreHookSize[]).map((k) => (
              <option key={k} value={k}>
                {CORE_HOOK_SIZE_LABELS[k]}
              </option>
            ))}
          </Select>
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>标题钩</span>
          <input
            className="input"
            value={hook.titleHook}
            onChange={(e) => setHook((s) => ({ ...s, titleHook: e.target.value }))}
          />
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>核心梗（情绪过程，不锁步骤/人物/场景）</span>
          <textarea
            className="textarea"
            rows={3}
            value={hook.coreHook}
            onChange={(e) => setHook((s) => ({ ...s, coreHook: e.target.value }))}
          />
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>情绪链条（格式：侧|标签|强度，一行一个；侧=hurt/hurter/shared/reader）</span>
          <textarea
            className="textarea"
            rows={4}
            value={hook.emotionChain
              .map((n) => `${n.side}|${n.label}|${n.intensity ?? ""}`)
              .join("\n")}
            onChange={(e) => {
              const emotionChain = e.target.value
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean)
                .map((l) => {
                  const [sideRaw, label = "", intensityRaw = ""] = l.split("|");
                  const side = (["hurt", "hurter", "shared", "reader"].includes(sideRaw)
                    ? sideRaw
                    : "shared") as CoreHookFullBody["emotionChain"][number]["side"];
                  return {
                    side,
                    label: label || sideRaw,
                    intensity: intensityRaw ? Number(intensityRaw) : undefined,
                  };
                });
              setHook((s) => ({ ...s, emotionChain }));
            }}
            placeholder={"hurt|受挫|-4\nhurt|期待|-2\nhurter|幡然醒悟|3"}
          />
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>抽象化（具体→通用，格式：客栈→公共空间）</span>
          <textarea
            className="textarea"
            rows={2}
            value={hook.abstractions.map((a) => `${a.concrete}→${a.abstract}`).join("\n")}
            onChange={(e) => {
              const abstractions = e.target.value
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean)
                .map((l) => {
                  const [concrete = "", abstract = ""] = l.split(/→|->/);
                  return { concrete: concrete.trim(), abstract: abstract.trim() };
                });
              setHook((s) => ({ ...s, abstractions }));
            }}
          />
        </label>
        {hook.kind === "plot_card" && (
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>情节卡固定步骤（换行）</span>
            <textarea
              className="textarea"
              rows={3}
              value={hook.plotCardSteps.join("\n")}
              onChange={(e) =>
                setHook((s) => ({ ...s, plotCardSteps: listEdit(e.target.value, /\n/) }))
              }
            />
          </label>
        )}
      </div>
    </CollapsibleSection>
  );
}

/* ═══════════════ 6. 提示词规则+指令 ═══════════════ */

export function PromptComposeWorkbench({ projectId }: { projectId?: string }) {
  const [form, setForm] = usePersistedState<PromptCompose>(projectId, "prompt-compose", {
    cognitiveGap: "human_knows",
    rules: "",
    instruction: "",
    sevenW: { why: "", what: "", who: "", when: "", where: "", which: "", how: "" },
    examples: [],
    want: [],
    avoid: [],
    wrapSourceInBlockquote: true,
  });

  const composed = useMemo(() => {
    const parts: string[] = [];
    if (form.rules.trim()) parts.push(`# 规则\n${form.rules.trim()}`);
    if (form.instruction.trim()) parts.push(`# 指令\n${form.instruction.trim()}`);
    const w = form.sevenW;
    const sevenLines = Object.entries(w)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => `- ${k}: ${v}`);
    if (sevenLines.length) parts.push(`# 7W 补全\n${sevenLines.join("\n")}`);
    if (form.want.length) parts.push(`# 要什么\n${form.want.map((x) => `- ${x}`).join("\n")}`);
    if (form.avoid.length)
      parts.push(`# 不要什么（双重限定）\n${form.avoid.map((x) => `- ${x}`).join("\n")}`);
    if (form.examples.length)
      parts.push(`# 示例（仿节奏/情绪）\n${form.examples.map((x, i) => `${i + 1}. ${x}`).join("\n")}`);
    if (form.sourceExcerpt?.trim()) {
      const body = form.wrapSourceInBlockquote
        ? form.sourceExcerpt
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n")
        : form.sourceExcerpt;
      parts.push(`# 原文\n${body}`);
    }
    return parts.join("\n\n");
  }, [form]);

  return (
    <CollapsibleSection
      title="提示词工作台（规则 + 指令 + 双重限定 + 认知差）"
      storageKey={projectId ? `nines2-${projectId}-prompt` : undefined}
      actions={
        <Button
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(composed);
            toast.ok("已复制组合提示词");
          }}
        >
          复制组合结果
        </Button>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
        提示词能力本质是行业知识总结。由人提意见让 AI 配合，不让 AI 乱选。简洁直接、给示例、分解任务、Markdown、双重限定。
      </p>
      <label className="field">
        <span>认知差四象限</span>
        <Select
          className="select"
          value={form.cognitiveGap}
          onChange={(e) =>
            setForm((s) => ({
              ...s,
              cognitiveGap: e.target.value as CognitiveGapQuadrant,
            }))
          }
        >
          {(Object.keys(COGNITIVE_GAP_LABELS) as CognitiveGapQuadrant[]).map((k) => (
            <option key={k} value={k}>
              {COGNITIVE_GAP_LABELS[k]}
            </option>
          ))}
        </Select>
      </label>
      <label className="field">
        <span>规则（角色提示词）</span>
        <textarea
          className="textarea"
          rows={3}
          value={form.rules}
          onChange={(e) => setForm((s) => ({ ...s, rules: e.target.value }))}
          placeholder="你是谁、按什么方式工作…"
        />
      </label>
      <label className="field">
        <span>指令（具体命令）</span>
        <textarea
          className="textarea"
          rows={2}
          value={form.instruction}
          onChange={(e) => setForm((s) => ({ ...s, instruction: e.target.value }))}
          placeholder="例：换成古代版本，给我出三个方案"
        />
      </label>
      <div className="field-grid">
        {(
          [
            ["why", "Why"],
            ["what", "What"],
            ["who", "Who"],
            ["when", "When"],
            ["where", "Where"],
            ["which", "Which"],
            ["how", "How"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="field">
            <span>{label}</span>
            <input
              className="input"
              value={form.sevenW[k]}
              onChange={(e) =>
                setForm((s) => ({ ...s, sevenW: { ...s.sevenW, [k]: e.target.value } }))
              }
            />
          </label>
        ))}
      </div>
      <label className="field">
        <span>要什么（换行）</span>
        <textarea
          className="textarea"
          rows={2}
          value={form.want.join("\n")}
          onChange={(e) => setForm((s) => ({ ...s, want: listEdit(e.target.value, /\n/) }))}
        />
      </label>
      <label className="field">
        <span>不要什么（双重限定，换行）</span>
        <textarea
          className="textarea"
          rows={2}
          value={form.avoid.join("\n")}
          onChange={(e) => setForm((s) => ({ ...s, avoid: listEdit(e.target.value, /\n/) }))}
          placeholder="不要科幻"
        />
      </label>
      <label className="field">
        <span>示例（换行；须能代表你自己的想法）</span>
        <textarea
          className="textarea"
          rows={2}
          value={form.examples.join("\n")}
          onChange={(e) => setForm((s) => ({ ...s, examples: listEdit(e.target.value, /\n/) }))}
        />
      </label>
      <label className="field">
        <span>原文摘录</span>
        <textarea
          className="textarea"
          rows={3}
          value={form.sourceExcerpt ?? ""}
          onChange={(e) => setForm((s) => ({ ...s, sourceExcerpt: e.target.value }))}
        />
      </label>
      <label className="row" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={form.wrapSourceInBlockquote}
          onChange={(e) => setForm((s) => ({ ...s, wrapSourceInBlockquote: e.target.checked }))}
        />
        <span style={{ fontSize: 12 }}>用 Markdown 引用符包裹原文</span>
      </label>
      <Panel title="组合预览">
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: 0 }}>{composed || "（空）"}</pre>
      </Panel>
    </CollapsibleSection>
  );
}

/* ═══════════════ 7. 追妻火葬场 ═══════════════ */

export function ChaseWifeWorkbench({ projectId }: { projectId?: string }) {
  const [tpl, setTpl] = usePersistedState<ChaseWifeTemplate>(projectId, "chase-wife", {
    hurtChain: ["受挫", "期待", "委屈", "积累失望", "决裂"],
    hurterChain: ["忽视/过错", "后知后觉", "幡然醒悟", "悔恨", "付出"],
    abuseRounds: [
      { round: 1, event: "", location: "", emotionHurt: "", emotionHurter: "" },
      { round: 2, event: "", location: "", emotionHurt: "", emotionHurter: "" },
      { round: 3, event: "", location: "", emotionHurt: "", emotionHurter: "" },
    ],
    destroyHow: "",
    chaseRounds: [
      { round: 1, event: "", location: "", emotionHurt: "", emotionHurter: "" },
      { round: 2, event: "", location: "", emotionHurt: "", emotionHurter: "" },
      { round: 3, event: "", location: "", emotionHurt: "", emotionHurter: "" },
    ],
    unionEnding: "HE",
    villainFate: "反派（含白月光）无好下场：被抓或死，无中间态",
    relatedTropes: ["破镜重圆（相近但有别）"],
  });
  const [chaseTab, setChaseTab] = usePersistedState(projectId, "chase-wife-view", "four");

  return (
    <CollapsibleSection
      title="追妻火葬场（虐→毁→追→合）"
      storageKey={projectId ? `nines2-${projectId}-chase` : undefined}
      actions={
        <Button
          variant="primary"
          disabled={!projectId}
          onClick={() =>
            projectId &&
            void runAgentFeedback(projectId, "struct.chase_wife", {
              label: "追妻五部曲展开",
              inputJson: tpl,
            })
          }
        >
          展开卷纲/章纲
        </Button>
      }
    >
      <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-sm"
          style={{ outline: chaseTab === "four" ? "2px solid var(--accent, #126b5b)" : undefined }}
          onClick={() => setChaseTab("four")}
        >
          四段：虐毁追合
        </button>
        <button
          type="button"
          className="btn btn-sm"
          style={{ outline: chaseTab === "five" ? "2px solid var(--accent, #126b5b)" : undefined }}
          onClick={() => setChaseTab("five")}
        >
          五部曲映射（8课）
        </button>
      </div>
      {chaseTab === "five" && (
        <div className="stack" style={{ gap: 6, marginBottom: 10 }}>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            映射：决裂≈毁 · 转折+觉醒≈虐递进 · 追妻≈追 · 结局≈合。完备五部曲编辑在 Lesson8「灵感成故事」台；此处不删四段。
          </p>
          <Badge>决裂期 → destroyHow</Badge>
          <Badge>转折期 + 男主觉醒期 → abuseRounds</Badge>
          <Badge>追妻期 → chaseRounds</Badge>
          <Badge>结局 → unionEnding</Badge>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            闸门：禁过早原谅（决裂后须经转折/觉醒/追妻再合）。
          </p>
        </div>
      )}
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        {Object.values(CHASE_WIFE_PHASE_LABELS).join(" · ")}
      </p>
      <div className="field-grid">
        <label className="field">
          <span>被伤害方情绪链</span>
          <input
            className="input"
            value={tpl.hurtChain.join(" → ")}
            onChange={(e) =>
              setTpl((s) => ({
                ...s,
                hurtChain: e.target.value.split(/→|->/).map((x) => x.trim()).filter(Boolean),
              }))
            }
          />
        </label>
        <label className="field">
          <span>伤害方情绪链</span>
          <input
            className="input"
            value={tpl.hurterChain.join(" → ")}
            onChange={(e) =>
              setTpl((s) => ({
                ...s,
                hurterChain: e.target.value.split(/→|->/).map((x) => x.trim()).filter(Boolean),
              }))
            }
          />
        </label>
      </div>
      <strong style={{ fontSize: 13 }}>虐 · 三轮递进</strong>
      {tpl.abuseRounds.map((r, i) => (
        <div key={`a${r.round}`} className="field-grid" style={{ marginTop: 6 }}>
          <Badge>第 {r.round} 轮虐</Badge>
          <label className="field">
            <span>事件</span>
            <input
              className="input"
              value={r.event}
              onChange={(e) => {
                const abuseRounds = [...tpl.abuseRounds];
                abuseRounds[i] = { ...r, event: e.target.value };
                setTpl((s) => ({ ...s, abuseRounds }));
              }}
            />
          </label>
          <label className="field">
            <span>地点</span>
            <input
              className="input"
              value={r.location}
              placeholder="医院/家里/监狱/酒吧/墓地"
              onChange={(e) => {
                const abuseRounds = [...tpl.abuseRounds];
                abuseRounds[i] = { ...r, location: e.target.value };
                setTpl((s) => ({ ...s, abuseRounds }));
              }}
            />
          </label>
        </div>
      ))}
      <label className="field">
        <span>毁 · 决裂方式</span>
        <textarea
          className="textarea"
          rows={2}
          value={tpl.destroyHow}
          onChange={(e) => setTpl((s) => ({ ...s, destroyHow: e.target.value }))}
        />
      </label>
      <strong style={{ fontSize: 13 }}>追 · 三轮</strong>
      {tpl.chaseRounds.map((r, i) => (
        <div key={`c${r.round}`} className="field-grid" style={{ marginTop: 6 }}>
          <Badge>第 {r.round} 轮追</Badge>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>事件</span>
            <input
              className="input"
              value={r.event}
              onChange={(e) => {
                const chaseRounds = [...tpl.chaseRounds];
                chaseRounds[i] = { ...r, event: e.target.value };
                setTpl((s) => ({ ...s, chaseRounds }));
              }}
            />
          </label>
        </div>
      ))}
      <div className="field-grid">
        <label className="field">
          <span>合 · 结局</span>
          <Select
            className="select"
            value={tpl.unionEnding}
            onChange={(e) =>
              setTpl((s) => ({
                ...s,
                unionEnding: e.target.value as ChaseWifeTemplate["unionEnding"],
              }))
            }
          >
            <option value="HE">HE</option>
            <option value="BE">BE</option>
            <option value="open">开放</option>
          </Select>
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>反派下场</span>
          <input
            className="input"
            value={tpl.villainFate}
            onChange={(e) => setTpl((s) => ({ ...s, villainFate: e.target.value }))}
          />
        </label>
      </div>
    </CollapsibleSection>
  );
}

/* ═══════════════ 8. 文风提取 ═══════════════ */

export function StyleExtractWorkbench({ projectId }: { projectId?: string }) {
  const [wf, setWf] = usePersistedState<StyleExtractWorkflow>(projectId, "style-extract", {
    sourceExcerpt: "",
    aiExtract: {
      atmosphere: "",
      narrativeStructure: "",
      languageStyle: "",
      tone: "",
      lengthComplexity: "",
      pacing: "",
      characterization: "",
      detail: "",
      dialogue: "",
      emotionExpression: "",
    },
    humanAgreesWithAi: null,
    disagreementNotes: "",
    styleRulesPrompt: "",
    purpose: "style_only",
  });

  const fields = [
    ["atmosphere", "氛围"],
    ["narrativeStructure", "叙事结构"],
    ["languageStyle", "语言风格"],
    ["tone", "语气"],
    ["lengthComplexity", "长度/复杂度"],
    ["pacing", "节奏"],
    ["characterization", "人物塑造"],
    ["detail", "细节"],
    ["dialogue", "对话"],
    ["emotionExpression", "情感表达"],
  ] as const;

  return (
    <CollapsibleSection
      title="文风提取工作流（抽要素→对齐理解→整理规则）"
      storageKey={projectId ? `nines2-${projectId}-style` : undefined}
      actions={
        <Button
          disabled={!projectId || !wf.sourceExcerpt.trim()}
          onClick={() =>
            projectId &&
            void runAgentFeedback(projectId, "kb.style_extract", {
              label: "抽取文风要素",
              inputJson: { excerpt: wf.sourceExcerpt, purpose: wf.purpose },
            })
          }
        >
          AI 抽取文风
        </Button>
      }
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        一般不直接丢原文写（易过像），除非目的就是洗稿。先抽要素，判断「你理解的文风」与「AI
        理解」是否一致，再整理成规则。
      </p>
      <label className="field">
        <span>目的</span>
        <Select
          className="select"
          value={wf.purpose}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              purpose: e.target.value as StyleExtractWorkflow["purpose"],
            }))
          }
        >
          <option value="style_only">只要文风相似</option>
          <option value="imitate_piece">仿写这一篇</option>
          <option value="wash">洗稿模式</option>
        </Select>
      </label>
      <label className="field">
        <span>原文</span>
        <textarea
          className="textarea"
          rows={4}
          value={wf.sourceExcerpt}
          onChange={(e) => setWf((s) => ({ ...s, sourceExcerpt: e.target.value }))}
        />
      </label>
      <div className="field-grid">
        {fields.map(([k, label]) => (
          <label key={k} className="field">
            <span>{label}</span>
            <input
              className="input"
              value={wf.aiExtract[k]}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  aiExtract: { ...s.aiExtract, [k]: e.target.value },
                }))
              }
            />
          </label>
        ))}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12 }}>你与 AI 理解是否一致：</span>
        {(
          [
            [true, "一致"],
            [false, "不一致"],
            [null, "未判断"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={String(v)}
            type="button"
            className="badge"
            style={wf.humanAgreesWithAi === v ? { borderColor: "var(--accent)" } : undefined}
            onClick={() => setWf((s) => ({ ...s, humanAgreesWithAi: v }))}
          >
            {label}
          </button>
        ))}
      </div>
      {wf.humanAgreesWithAi === false && (
        <label className="field">
          <span>分歧说明</span>
          <textarea
            className="textarea"
            rows={2}
            value={wf.disagreementNotes}
            onChange={(e) => setWf((s) => ({ ...s, disagreementNotes: e.target.value }))}
          />
        </label>
      )}
      <label className="field">
        <span>整理后的文风规则提示词</span>
        <textarea
          className="textarea"
          rows={3}
          value={wf.styleRulesPrompt}
          onChange={(e) => setWf((s) => ({ ...s, styleRulesPrompt: e.target.value }))}
        />
      </label>
    </CollapsibleSection>
  );
}

/* ═══════════════ 聚合：短篇全流程工作区（换元七步见 NinesLesson3Panels） ═══════════════ */

export function ShortNovelLesson2Workspace({
  projectId,
  artifacts,
}: {
  projectId?: string;
  artifacts?: Artifact[];
}) {
  return (
    <div className="stack">
      <CommercialOutlineWorkbench projectId={projectId} />
      <DissectParamsWorkbench projectId={projectId} artifacts={artifacts} />
      {/* 换元七步由 FormatWorkspaces S2_SWAP / ShortNovelLesson3Workspace 挂载，避免与 3.md 循环依赖 */}
      <CoreHookDetailWorkbench projectId={projectId} artifacts={artifacts} />
      <UnitSevenStepWorkbench projectId={projectId} />
      <PromptComposeWorkbench projectId={projectId} />
      <StyleExtractWorkbench projectId={projectId} />
      <ChaseWifeWorkbench projectId={projectId} />
      <GenerationPolicyPanel projectId={projectId} />
    </div>
  );
}
