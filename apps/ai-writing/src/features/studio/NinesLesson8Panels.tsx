/**
 * 九格基础课（8.md）灵感成故事总装工作台：
 * 结构四层级判层 → 路径 A/B/C → 故事线/七步法/关系网/五部曲 → 章纲树/细纲四描写 → AI 抽卡。
 * 不重建 short_novel Stage；七步法嵌入 DeepMethod；追妻四段保留，本台提供五部曲完备视图。
 */
import {
  CHASE_WIFE_FIVE_ACT_LABELS,
  CORE_EVENT_EXPAND_MANTRA,
  FIVE_ACT_TO_FOUR_PHASE,
  INSPIRATION_TO_STORY_CHECKPOINTS,
  RELATIONSHIP_NET_CASE_TEMPLATE,
  RELATIONSHIP_ROLE_LABELS,
  SCENE_FOUR_RAIN_HERB_TEMPLATE,
  STORY_STRUCTURE_LEVEL_META,
  aiReviseCompleteness,
  fiveActCompleteness,
  inspirationClassifyCompleteness,
  inspirationToStoryWorkflowCompleteness,
  plotThreeCompleteness,
  recommendPathForLevel,
  sceneFourCompleteness,
  summarizeInspirationToStoryToMaster,
  syncFiveActToChaseWifeFour,
  validateCoreEventDump,
  validateEarlyForgive,
  validateLengthPace,
  validateSceneFourDry,
  validateThemeAlignment,
  type ChaseWifeFiveActPhase,
  type InspirationRoutePath,
  type InspirationToStoryWorkflow,
  type MasterOutlineBody,
  type RelationshipRole,
  type StoryStructureLevel,
} from "@xiezuomanju/domain";
import { Badge, Button, CollapsibleSection, Panel, Tabs } from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useMemo, type Dispatch, type SetStateAction } from "react";
import { SevenStepCharWorkbench } from "./DeepMethodPanels";
import { runAgentFeedback } from "./runAgentFeedback";
import { usePersistedState } from "./usePersistedState";

export function emptyInspirationToStory(): InspirationToStoryWorkflow {
  return {
    schemaVersion: "nines-8.md/1",
    currentStep: 0,
    classify: [],
    storyline: {
      oneLiner: "",
      setting: "",
      process: "",
      result: "",
      structureTag: "",
      emotionTag: "",
      relationTag: "",
      microInnovation: "",
      themeAligned: false,
      themeNote: "",
    },
    sevenStepsDone: false,
    relationNet: [],
    coreExpand: {
      rawCore: "",
      headTail: "",
      causalBranches: ["", ""],
      characterConflict: "",
      coolPoints: ["", ""],
      linkedCoolPoint: "",
      done: false,
    },
    plotThree: {
      person: "",
      matter: "",
      conflictPhysical: "",
      conflictEmotional: "",
      conflictGoalBlock: "",
      sceneAtmosphere: "",
    },
    fiveAct: {
      beats: [
        { phase: "breakup", heroineGoal: "", heroState: "", emotionIntensity: 8, events: [], done: false },
        { phase: "turning", heroineGoal: "", heroState: "", emotionIntensity: 6, events: [], done: false },
        { phase: "awakening", heroineGoal: "", heroState: "", emotionIntensity: 7, events: [], done: false },
        { phase: "chase", heroineGoal: "", heroState: "", emotionIntensity: 8, events: [], done: false },
        { phase: "ending", heroineGoal: "", heroState: "", emotionIntensity: 9, events: [], done: false },
      ],
      earlyForgiveWarned: false,
      forgiveTooEarlyNote: "",
    },
    intensityLadder: { events: [], dumpWarnThreshold: 2 },
    chapterTree: [],
    scenes: [],
    lengthPace: {
      form: "short",
      densePull: true,
      slowPushOk: false,
      mismatchWarned: false,
      note: "",
    },
    genreGuard: {
      zhiguaiRedlineChecked: false,
      materialReserveOk: false,
      commodityMindsetNoted: false,
      note: "",
    },
    aiRevise: {
      drafts: [
        { version: "v1", text: "", selected: false },
        { version: "v2", text: "", selected: false },
        { version: "v3", text: "", selected: false },
        { version: "v4", text: "", selected: false },
      ],
      compared: false,
      readAloudSmooth: false,
      readAloudGap: false,
      readAloudWeird: false,
      qcEmotion: false,
      qcBenchmark: false,
      qcPace: false,
      qcHook: false,
      qcSuspense: false,
      hasChapterOutline: false,
      done: false,
    },
    handedOffToShortNovel: false,
    notes: "",
  };
}

type ItsCtl = {
  projectId?: string;
  wf?: InspirationToStoryWorkflow;
  setWf?: Dispatch<SetStateAction<InspirationToStoryWorkflow>>;
};

function useItsWf({ projectId, wf, setWf }: ItsCtl) {
  const persisted = usePersistedState<InspirationToStoryWorkflow>(
    projectId,
    "inspiration-to-story-wf",
    emptyInspirationToStory(),
  );
  if (wf && setWf) return [wf, setWf] as const;
  return persisted;
}

const LEVEL_OPTS = (Object.keys(STORY_STRUCTURE_LEVEL_META) as StoryStructureLevel[]).map((k) => ({
  v: k,
  l: STORY_STRUCTURE_LEVEL_META[k].label,
  form: STORY_STRUCTURE_LEVEL_META[k].textForm,
}));

const PATH_LABELS: Record<InspirationRoutePath, string> = {
  A: "路径A·故事线下行",
  B: "路径B·口诀四步",
  C: "路径C·三要素上行",
  nest: "归巢·事件并入情节/核心事件",
};

const FOUR_PHASE_ZH: Record<string, string> = {
  destroy: "毁",
  abuse: "虐",
  chase: "追",
  union: "合",
};

/* ═══════════════ 判层 ═══════════════ */

export function StructureLevelClassifyPanel(props: ItsCtl) {
  const [wf, setWf] = useItsWf(props);
  const score = inspirationClassifyCompleteness(wf.classify);

  const addItem = () => {
    setWf((s) => ({
      ...s,
      classify: [
        ...s.classify,
        {
          id: `cls-${Date.now()}`,
          rawText: "",
          source: "灵感",
          reason: "",
        },
      ],
    }));
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        结构四层级 ≠ 灵感采集层级（一念/灵感/创意/选题）。本步判：故事线/核心事件/情节/事件，并绑定简介/大纲/章纲/细纲形态。
      </p>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {LEVEL_OPTS.map((o) => (
          <Badge key={o.v}>
            {o.l}→{o.form}
          </Badge>
        ))}
        <Badge tone={score.complete ? "ok" : "warn"}>
          判层 {score.filled}/{wf.classify.length || 0}
        </Badge>
      </div>
      {wf.classify.map((item, i) => (
        <Panel
          key={item.id}
          title={
            <>
              条目 {i + 1}
              {item.level && (
                <Badge>{STORY_STRUCTURE_LEVEL_META[item.level].label}</Badge>
              )}
            </>
          }
        >
          <div className="stack" style={{ gap: 6 }}>
            <textarea
              className="textarea"
              rows={2}
              placeholder="粘贴灵感原文"
              value={item.rawText}
              onChange={(e) => {
                const classify = [...wf.classify];
                classify[i] = { ...item, rawText: e.target.value };
                setWf((s) => ({ ...s, classify }));
              }}
            />
            <div className="field-grid">
              <label className="field">
                <span>来源</span>
                <input
                  className="input"
                  value={item.source}
                  onChange={(e) => {
                    const classify = [...wf.classify];
                    classify[i] = { ...item, source: e.target.value };
                    setWf((s) => ({ ...s, classify }));
                  }}
                />
              </label>
              <label className="field">
                <span>判定层级</span>
                <Select
                  className="select"
                  value={item.level ?? ""}
                  onChange={(e) => {
                    const level = (e.target.value || undefined) as StoryStructureLevel | undefined;
                    const recommendedPath = level ? recommendPathForLevel(level) : undefined;
                    const classify = [...wf.classify];
                    classify[i] = { ...item, level, recommendedPath };
                    setWf((s) => ({
                      ...s,
                      classify,
                      activePath: recommendedPath ?? s.activePath,
                    }));
                  }}
                >
                  <option value="">未判定</option>
                  {LEVEL_OPTS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.l}（{o.form}）
                    </option>
                  ))}
                </Select>
              </label>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                <span>判定理由</span>
                <input
                  className="input"
                  value={item.reason}
                  onChange={(e) => {
                    const classify = [...wf.classify];
                    classify[i] = { ...item, reason: e.target.value };
                    setWf((s) => ({ ...s, classify }));
                  }}
                />
              </label>
            </div>
            {item.level && (
              <p className="muted" style={{ fontSize: 11, margin: 0 }}>
                例：{STORY_STRUCTURE_LEVEL_META[item.level].example}
                {item.recommendedPath && ` · 推荐 ${PATH_LABELS[item.recommendedPath]}`}
              </p>
            )}
          </div>
        </Panel>
      ))}
      <Button size="sm" onClick={addItem}>
        新增判层条目
      </Button>
    </div>
  );
}

/* ═══════════════ 路径路由 ═══════════════ */

export function PathABCRouter(props: ItsCtl) {
  const [wf, setWf] = useItsWf(props);
  const paths: InspirationRoutePath[] = ["A", "B", "C", "nest"];

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        A：故事线→七步法→关系网→核心事件。B：口诀四步扩展核心事件。C：人/事/冲突→上行。事件级选 nest 归入情节或核心事件。
      </p>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {paths.map((p) => (
          <button
            key={p}
            type="button"
            className="btn btn-sm"
            style={{
              outline: wf.activePath === p ? "2px solid var(--accent, #126b5b)" : undefined,
            }}
            onClick={() => setWf((s) => ({ ...s, activePath: p }))}
          >
            {PATH_LABELS[p]}
          </button>
        ))}
      </div>
      {wf.activePath === "B" && (
        <Panel title="路径B · 核心事件口诀四步">
          <p className="muted" style={{ fontSize: 12 }}>
            {CORE_EVENT_EXPAND_MANTRA}
          </p>
          <label className="field">
            <span>核心事件原文</span>
            <textarea
              className="textarea"
              rows={2}
              value={wf.coreExpand.rawCore}
              onChange={(e) =>
                setWf((s) => ({ ...s, coreExpand: { ...s.coreExpand, rawCore: e.target.value } }))
              }
            />
          </label>
          <label className="field">
            <span>1.上补头尾</span>
            <textarea
              className="textarea"
              rows={2}
              value={wf.coreExpand.headTail}
              onChange={(e) =>
                setWf((s) => ({ ...s, coreExpand: { ...s.coreExpand, headTail: e.target.value } }))
              }
            />
          </label>
          <label className="field">
            <span>2.下猜因果（≥2，换行分隔）</span>
            <textarea
              className="textarea"
              rows={2}
              value={wf.coreExpand.causalBranches.join("\n")}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  coreExpand: {
                    ...s.coreExpand,
                    causalBranches: e.target.value.split("\n"),
                  },
                }))
              }
            />
          </label>
          <label className="field">
            <span>3.人设驱动冲突</span>
            <input
              className="input"
              value={wf.coreExpand.characterConflict}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  coreExpand: { ...s.coreExpand, characterConflict: e.target.value },
                }))
              }
            />
          </label>
          <label className="field">
            <span>4.爽点≥2（换行；可链 L6）</span>
            <textarea
              className="textarea"
              rows={2}
              value={wf.coreExpand.coolPoints.join("\n")}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  coreExpand: { ...s.coreExpand, coolPoints: e.target.value.split("\n") },
                }))
              }
            />
          </label>
          <label className="field">
            <span>链 L6 linkedCoolPoint</span>
            <input
              className="input"
              value={wf.coreExpand.linkedCoolPoint}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  coreExpand: { ...s.coreExpand, linkedCoolPoint: e.target.value },
                }))
              }
            />
          </label>
        </Panel>
      )}
      {wf.activePath === "C" && (
        <Panel title="路径C · 情节三要素（人/事/冲突+场景）">
          {(() => {
            const p3 = plotThreeCompleteness(wf.plotThree);
            return (
              <Badge tone={p3.complete ? "ok" : "warn"}>
                {p3.filled}/{p3.total}
                {!p3.complete && p3.missing.length ? ` 缺:${p3.missing.join(",")}` : ""}
              </Badge>
            );
          })()}
          <div className="field-grid" style={{ marginTop: 8 }}>
            {(
              [
                ["person", "人"],
                ["matter", "事"],
                ["conflictPhysical", "冲突·物理"],
                ["conflictEmotional", "冲突·情感"],
                ["conflictGoalBlock", "冲突·目标阻碍"],
                ["sceneAtmosphere", "场景氛围"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="field">
                <span>{label}</span>
                <input
                  className="input"
                  value={wf.plotThree[k]}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      plotThree: { ...s.plotThree, [k]: e.target.value },
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </Panel>
      )}
      {wf.activePath === "nest" && (
        <p className="muted" style={{ fontSize: 12 }}>
          事件级请并入「情节」章纲节点或「核心事件」口诀扩展，勿单独当故事线开写。
        </p>
      )}
    </div>
  );
}

/* ═══════════════ 故事线卡 ═══════════════ */

export function StorylineCardPanel(props: ItsCtl) {
  const [wf, setWf] = useItsWf(props);
  const theme = validateThemeAlignment(wf.storyline);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <Badge tone={theme.ok ? "ok" : "warn"}>{theme.message}</Badge>
      <label className="field">
        <span>一句话主线</span>
        <input
          className="input"
          value={wf.storyline.oneLiner}
          onChange={(e) =>
            setWf((s) => ({ ...s, storyline: { ...s.storyline, oneLiner: e.target.value } }))
          }
        />
      </label>
      <div className="field-grid">
        {(
          [
            ["setting", "设定"],
            ["process", "过程"],
            ["result", "结果"],
            ["structureTag", "结构标签"],
            ["emotionTag", "情绪标签"],
            ["relationTag", "关系标签"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="field">
            <span>{label}</span>
            <input
              className="input"
              value={wf.storyline[k]}
              onChange={(e) =>
                setWf((s) => ({ ...s, storyline: { ...s.storyline, [k]: e.target.value } }))
              }
            />
          </label>
        ))}
      </div>
      <label className="field">
        <span>微创新备注</span>
        <textarea
          className="textarea"
          rows={2}
          value={wf.storyline.microInnovation}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              storyline: { ...s.storyline, microInnovation: e.target.value },
            }))
          }
        />
      </label>
      <label className="row" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={wf.storyline.themeAligned}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              storyline: { ...s.storyline, themeAligned: e.target.checked },
            }))
          }
        />
        <span style={{ fontSize: 12 }}>主题对齐已确认</span>
      </label>
    </div>
  );
}

/* ═══════════════ 关系网 ═══════════════ */

export function RelationshipNetPanel(props: ItsCtl) {
  const [wf, setWf] = useItsWf(props);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        仅主角+主配。可轻链人物图，不重建图引擎。案例侧栏可载入「避孕药」关系网模板。
      </p>
      <div className="row" style={{ gap: 6 }}>
        <Button
          size="sm"
          onClick={() =>
            setWf((s) => ({
              ...s,
              relationNet: [
                ...s.relationNet,
                {
                  id: `rel-${Date.now()}`,
                  name: "",
                  role: "ally",
                  goalPain: "",
                  function: "",
                  relationToHero: "",
                },
              ],
            }))
          }
        >
          加一行
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setWf((s) => ({ ...s, relationNet: [...RELATIONSHIP_NET_CASE_TEMPLATE] }))}
        >
          载入案例模板
        </Button>
      </div>
      {wf.relationNet.map((row, i) => (
        <div key={row.id} className="field-grid">
          <label className="field">
            <span>姓名</span>
            <input
              className="input"
              value={row.name}
              onChange={(e) => {
                const relationNet = [...wf.relationNet];
                relationNet[i] = { ...row, name: e.target.value };
                setWf((s) => ({ ...s, relationNet }));
              }}
            />
          </label>
          <label className="field">
            <span>定位</span>
            <Select
              className="select"
              value={row.role}
              onChange={(e) => {
                const relationNet = [...wf.relationNet];
                relationNet[i] = { ...row, role: e.target.value as RelationshipRole };
                setWf((s) => ({ ...s, relationNet }));
              }}
            >
              {(Object.keys(RELATIONSHIP_ROLE_LABELS) as RelationshipRole[]).map((r) => (
                <option key={r} value={r}>
                  {RELATIONSHIP_ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span>目标/痛点</span>
            <input
              className="input"
              value={row.goalPain}
              onChange={(e) => {
                const relationNet = [...wf.relationNet];
                relationNet[i] = { ...row, goalPain: e.target.value };
                setWf((s) => ({ ...s, relationNet }));
              }}
            />
          </label>
          <label className="field">
            <span>功能</span>
            <input
              className="input"
              value={row.function}
              onChange={(e) => {
                const relationNet = [...wf.relationNet];
                relationNet[i] = { ...row, function: e.target.value };
                setWf((s) => ({ ...s, relationNet }));
              }}
            />
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>与主角关系</span>
            <input
              className="input"
              value={row.relationToHero}
              onChange={(e) => {
                const relationNet = [...wf.relationNet];
                relationNet[i] = { ...row, relationToHero: e.target.value };
                setWf((s) => ({ ...s, relationNet }));
              }}
            />
          </label>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════ 五部曲 ═══════════════ */

export function ChaseWifeFiveActPanel(props: ItsCtl) {
  const [wf, setWf] = useItsWf(props);
  const five = fiveActCompleteness(wf.fiveAct);
  const early = validateEarlyForgive(wf.fiveAct);
  const dump = validateCoreEventDump(wf.intensityLadder);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        决裂→转折→觉醒→追妻→结局。与 L2 虐毁追合互标：决裂≈毁，转折+觉醒≈虐，追妻≈追，结局≈合。勿删四段台。
      </p>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <Badge>
          五部曲 {five.filled}/{five.total}
        </Badge>
        <Badge tone={early.ok ? "ok" : "warn"}>{early.message}</Badge>
        <Badge tone={dump.ok ? "ok" : "warn"}>{dump.message}</Badge>
      </div>
      {wf.fiveAct.beats.map((beat, i) => (
        <Panel
          key={beat.phase}
          title={
            <>
              {CHASE_WIFE_FIVE_ACT_LABELS[beat.phase]}{" "}
              <Badge>
                ≈{FOUR_PHASE_ZH[FIVE_ACT_TO_FOUR_PHASE[beat.phase]]}
              </Badge>
            </>
          }
        >
          <div className="field-grid">
            <label className="field">
              <span>女主目标</span>
              <input
                className="input"
                value={beat.heroineGoal}
                onChange={(e) => {
                  const beats = [...wf.fiveAct.beats];
                  beats[i] = { ...beat, heroineGoal: e.target.value };
                  setWf((s) => ({ ...s, fiveAct: { ...s.fiveAct, beats } }));
                }}
              />
            </label>
            <label className="field">
              <span>男主状态</span>
              <input
                className="input"
                value={beat.heroState}
                onChange={(e) => {
                  const beats = [...wf.fiveAct.beats];
                  beats[i] = { ...beat, heroState: e.target.value };
                  setWf((s) => ({ ...s, fiveAct: { ...s.fiveAct, beats } }));
                }}
              />
            </label>
            <label className="field">
              <span>情绪强度 1–10</span>
              <input
                className="input"
                type="number"
                min={1}
                max={10}
                value={beat.emotionIntensity}
                onChange={(e) => {
                  const beats = [...wf.fiveAct.beats];
                  beats[i] = { ...beat, emotionIntensity: Number(e.target.value) || 5 };
                  setWf((s) => ({ ...s, fiveAct: { ...s.fiveAct, beats } }));
                }}
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>事件（换行）</span>
              <textarea
                className="textarea"
                rows={2}
                value={beat.events.join("\n")}
                onChange={(e) => {
                  const beats = [...wf.fiveAct.beats];
                  beats[i] = { ...beat, events: e.target.value.split("\n").filter(Boolean) };
                  setWf((s) => ({ ...s, fiveAct: { ...s.fiveAct, beats } }));
                }}
              />
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={beat.done}
                onChange={(e) => {
                  const beats = [...wf.fiveAct.beats];
                  beats[i] = { ...beat, done: e.target.checked };
                  setWf((s) => ({ ...s, fiveAct: { ...s.fiveAct, beats } }));
                }}
              />
              <span style={{ fontSize: 12 }}>本阶段完成</span>
            </label>
          </div>
        </Panel>
      ))}
      <label className="row" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={wf.fiveAct.earlyForgiveWarned}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              fiveAct: { ...s.fiveAct, earlyForgiveWarned: e.target.checked },
            }))
          }
        />
        <span style={{ fontSize: 12 }}>自检：存在过早原谅风险（勾选则告警）</span>
      </label>
      <label className="field">
        <span>过早原谅备注</span>
        <input
          className="input"
          value={wf.fiveAct.forgiveTooEarlyNote}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              fiveAct: { ...s.fiveAct, forgiveTooEarlyNote: e.target.value },
            }))
          }
        />
      </label>
      <CollapsibleSection title="强度阶梯（核心事件勿同章倾泻）">
        <Button
          size="sm"
          onClick={() =>
            setWf((s) => ({
              ...s,
              intensityLadder: {
                ...s.intensityLadder,
                events: [
                  ...s.intensityLadder.events,
                  {
                    id: `ev-${Date.now()}`,
                    label: "",
                    intensity: 5,
                    chapterNo: 1,
                  },
                ],
              },
            }))
          }
        >
          加事件
        </Button>
        {wf.intensityLadder.events.map((ev, i) => (
          <div key={ev.id} className="field-grid" style={{ marginTop: 6 }}>
            <label className="field">
              <span>标签</span>
              <input
                className="input"
                value={ev.label}
                onChange={(e) => {
                  const events = [...wf.intensityLadder.events];
                  events[i] = { ...ev, label: e.target.value };
                  setWf((s) => ({
                    ...s,
                    intensityLadder: { ...s.intensityLadder, events },
                  }));
                }}
              />
            </label>
            <label className="field">
              <span>强度</span>
              <input
                className="input"
                type="number"
                min={1}
                max={10}
                value={ev.intensity}
                onChange={(e) => {
                  const events = [...wf.intensityLadder.events];
                  events[i] = { ...ev, intensity: Number(e.target.value) || 5 };
                  setWf((s) => ({
                    ...s,
                    intensityLadder: { ...s.intensityLadder, events },
                  }));
                }}
              />
            </label>
            <label className="field">
              <span>章号</span>
              <input
                className="input"
                type="number"
                min={1}
                value={ev.chapterNo ?? 1}
                onChange={(e) => {
                  const events = [...wf.intensityLadder.events];
                  events[i] = { ...ev, chapterNo: Number(e.target.value) || 1 };
                  setWf((s) => ({
                    ...s,
                    intensityLadder: { ...s.intensityLadder, events },
                  }));
                }}
              />
            </label>
          </div>
        ))}
      </CollapsibleSection>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          const sync = syncFiveActToChaseWifeFour(wf.fiveAct);
          if (props.projectId) {
            try {
              const key = `deep:${props.projectId}:chase-wife`;
              const prev = localStorage.getItem(key);
              const base = prev ? JSON.parse(prev) : {};
              localStorage.setItem(
                key,
                JSON.stringify({
                  ...base,
                  destroyHow: sync.destroyHow || base.destroyHow,
                  notes: sync.notes,
                }),
              );
            } catch {
              /* ignore */
            }
          }
        }}
      >
        同步摘要到四段台（毁）
      </Button>
    </div>
  );
}

/* ═══════════════ 章纲树 ═══════════════ */

export function ChapterTreePanel(props: ItsCtl) {
  const [wf, setWf] = useItsWf(props);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        核心事件 → 章 → 情节点（建议 3–10）。勾选是否围绕核心事件。与 L5 四维 / L6 打脸并排互标。
      </p>
      <Button
        size="sm"
        onClick={() =>
          setWf((s) => ({
            ...s,
            chapterTree: [
              ...s.chapterTree,
              {
                id: `ch-${Date.now()}`,
                coreEventId: "",
                chapterNo: s.chapterTree.length + 1,
                title: "",
                plotPoints: ["", "", ""],
                aroundCoreEvent: true,
              },
            ],
          }))
        }
      >
        加章
      </Button>
      {wf.chapterTree.map((node, i) => (
        <Panel key={node.id} title={`第 ${node.chapterNo} 章`}>
          <div className="field-grid">
            <label className="field">
              <span>标题</span>
              <input
                className="input"
                value={node.title}
                onChange={(e) => {
                  const chapterTree = [...wf.chapterTree];
                  chapterTree[i] = { ...node, title: e.target.value };
                  setWf((s) => ({ ...s, chapterTree }));
                }}
              />
            </label>
            <label className="field">
              <span>核心事件 id</span>
              <input
                className="input"
                value={node.coreEventId}
                onChange={(e) => {
                  const chapterTree = [...wf.chapterTree];
                  chapterTree[i] = { ...node, coreEventId: e.target.value };
                  setWf((s) => ({ ...s, chapterTree }));
                }}
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>情节点（换行，3–10）</span>
              <textarea
                className="textarea"
                rows={3}
                value={node.plotPoints.join("\n")}
                onChange={(e) => {
                  const chapterTree = [...wf.chapterTree];
                  chapterTree[i] = {
                    ...node,
                    plotPoints: e.target.value.split("\n"),
                  };
                  setWf((s) => ({ ...s, chapterTree }));
                }}
              />
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={node.aroundCoreEvent}
                onChange={(e) => {
                  const chapterTree = [...wf.chapterTree];
                  chapterTree[i] = { ...node, aroundCoreEvent: e.target.checked };
                  setWf((s) => ({ ...s, chapterTree }));
                }}
              />
              <span style={{ fontSize: 12 }}>围绕核心事件</span>
            </label>
          </div>
        </Panel>
      ))}
    </div>
  );
}

/* ═══════════════ 细纲四描写 ═══════════════ */

export function SceneFourRenderWorkbench(props: ItsCtl) {
  const [wf, setWf] = useItsWf(props);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        对话 / 动作 / 神态 / 环境 + 起因 / 过程 / 情绪拉伸。禁止只写「发生了什么」。
      </p>
      <div className="row" style={{ gap: 6 }}>
        <Button
          size="sm"
          onClick={() =>
            setWf((s) => ({
              ...s,
              scenes: [
                ...s.scenes,
                {
                  id: `sc-${Date.now()}`,
                  chapterNo: 1,
                  title: "",
                  dialogue: "",
                  action: "",
                  expression: "",
                  environment: "",
                  cause: "",
                  process: "",
                  emotionStretch: "",
                  onlyWhatHappened: false,
                },
              ],
            }))
          }
        >
          加场景卡
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            setWf((s) => ({
              ...s,
              scenes: [...s.scenes, { ...SCENE_FOUR_RAIN_HERB_TEMPLATE, id: `sc-${Date.now()}` }],
            }))
          }
        >
          载入暴雨抢药材
        </Button>
      </div>
      {wf.scenes.map((sc, i) => {
        const c = sceneFourCompleteness(sc);
        const dry = validateSceneFourDry(sc);
        return (
          <Panel
            key={sc.id}
            title={
              <>
                {sc.title || `场景 ${i + 1}`}
                <Badge tone={dry.ok ? "ok" : "fail"}>
                  {dry.message}
                </Badge>
              </>
            }
          >
            <div className="field-grid">
              <label className="field">
                <span>标题</span>
                <input
                  className="input"
                  value={sc.title}
                  onChange={(e) => {
                    const scenes = [...wf.scenes];
                    scenes[i] = { ...sc, title: e.target.value };
                    setWf((s) => ({ ...s, scenes }));
                  }}
                />
              </label>
              {(
                [
                  ["dialogue", "对话"],
                  ["action", "动作"],
                  ["expression", "神态"],
                  ["environment", "环境"],
                  ["cause", "一起因"],
                  ["process", "二过程"],
                  ["emotionStretch", "三情绪拉伸"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="field" style={{ gridColumn: "1 / -1" }}>
                  <span>{label}</span>
                  <textarea
                    className="textarea"
                    rows={2}
                    value={sc[k]}
                    onChange={(e) => {
                      const scenes = [...wf.scenes];
                      scenes[i] = { ...sc, [k]: e.target.value };
                      setWf((s) => ({ ...s, scenes }));
                    }}
                  />
                </label>
              ))}
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={sc.onlyWhatHappened}
                  onChange={(e) => {
                    const scenes = [...wf.scenes];
                    scenes[i] = { ...sc, onlyWhatHappened: e.target.checked };
                    setWf((s) => ({ ...s, scenes }));
                  }}
                />
                <span style={{ fontSize: 12 }}>仅写发生了什么（触发干货闸 fail）</span>
              </label>
              <Badge>
                完成度 {c.filled}/7
              </Badge>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

/* ═══════════════ AI 抽卡 ═══════════════ */

export function AiReviseFlowPanel(props: ItsCtl) {
  const [wf, setWf] = useItsWf(props);
  const ai = aiReviseCompleteness(wf.aiRevise);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        禁止无章纲直出。抽卡 v1–v4 → 对比勾选 → 朗读三检 → 质检五问。Agent 复用既有 qc。
      </p>
      <Badge tone={ai.canMarkDone ? "ok" : "warn"}>
        {ai.canMarkDone ? "可标完成" : `未齐 ${ai.filled}/${ai.total}`}
      </Badge>
      <label className="row" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={wf.aiRevise.hasChapterOutline}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              aiRevise: { ...s.aiRevise, hasChapterOutline: e.target.checked },
            }))
          }
        />
        <span style={{ fontSize: 12 }}>已有章纲约束</span>
      </label>
      {wf.aiRevise.drafts.map((d, i) => (
        <label key={d.version} className="field">
          <span>
            抽卡 {d.version}
            <input
              type="checkbox"
              style={{ marginLeft: 8 }}
              checked={d.selected}
              onChange={(e) => {
                const drafts = wf.aiRevise.drafts.map((x, j) =>
                  j === i ? { ...x, selected: e.target.checked } : x,
                );
                setWf((s) => ({ ...s, aiRevise: { ...s.aiRevise, drafts } }));
              }}
            />{" "}
            选用
          </span>
          <textarea
            className="textarea"
            rows={3}
            value={d.text}
            onChange={(e) => {
              const drafts = [...wf.aiRevise.drafts];
              drafts[i] = { ...d, text: e.target.value };
              setWf((s) => ({ ...s, aiRevise: { ...s.aiRevise, drafts } }));
            }}
          />
        </label>
      ))}
      <label className="row" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={wf.aiRevise.compared}
          onChange={(e) =>
            setWf((s) => ({ ...s, aiRevise: { ...s.aiRevise, compared: e.target.checked } }))
          }
        />
        <span style={{ fontSize: 12 }}>已对比勾选</span>
      </label>
      <strong style={{ fontSize: 13 }}>朗读三检</strong>
      {(
        [
          ["readAloudSmooth", "通顺"],
          ["readAloudGap", "有断层"],
          ["readAloudWeird", "有怪感"],
        ] as const
      ).map(([k, label]) => (
        <label key={k} className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={wf.aiRevise[k]}
            onChange={(e) =>
              setWf((s) => ({ ...s, aiRevise: { ...s.aiRevise, [k]: e.target.checked } }))
            }
          />
          <span style={{ fontSize: 12 }}>{label}</span>
        </label>
      ))}
      <strong style={{ fontSize: 13 }}>质检五问</strong>
      {(
        [
          ["qcEmotion", "情绪"],
          ["qcBenchmark", "对标强度"],
          ["qcPace", "节奏"],
          ["qcHook", "钩子"],
          ["qcSuspense", "悬念"],
        ] as const
      ).map(([k, label]) => (
        <label key={k} className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={wf.aiRevise[k]}
            onChange={(e) =>
              setWf((s) => ({ ...s, aiRevise: { ...s.aiRevise, [k]: e.target.checked } }))
            }
          />
          <span style={{ fontSize: 12 }}>{label}</span>
        </label>
      ))}
      <label className="row" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={wf.aiRevise.done}
          disabled={!ai.canMarkDone}
          onChange={(e) =>
            setWf((s) => ({ ...s, aiRevise: { ...s.aiRevise, done: e.target.checked } }))
          }
        />
        <span style={{ fontSize: 12 }}>标完成（须有章纲、草稿和对比记录；朗读与五问可选）</span>
      </label>
      {props.projectId && (
        <Button
          size="sm"
          disabled={!wf.aiRevise.hasChapterOutline}
          onClick={() =>
            void runAgentFeedback(props.projectId!, "qc.priority", {
              label: "8课抽卡质检",
              inputJson: { aiRevise: wf.aiRevise },
            })
          }
        >
          跑 QC Agent
        </Button>
      )}
    </div>
  );
}

export function GenreGuardHints(props: ItsCtl) {
  const [wf, setWf] = useItsWf(props);
  const pace = validateLengthPace(wf.lengthPace);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <Badge tone={pace.ok ? "ok" : "warn"}>{pace.message}</Badge>
      <label className="field">
        <span>篇幅</span>
        <Select
          className="select"
          value={wf.lengthPace.form}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              lengthPace: {
                ...s.lengthPace,
                form: e.target.value as "short" | "long",
                densePull: e.target.value === "short",
                slowPushOk: e.target.value === "long",
              },
            }))
          }
        >
          <option value="short">短篇·密拉扯</option>
          <option value="long">长篇·可慢推</option>
        </Select>
      </label>
      {(
        [
          ["zhiguaiRedlineChecked", "志怪审核红线已自检"],
          ["materialReserveOk", "素材储备 30–50 万量级已评估"],
          ["commodityMindsetNoted", "商品思维软闸已注意"],
        ] as const
      ).map(([k, label]) => (
        <label key={k} className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={wf.genreGuard[k]}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                genreGuard: { ...s.genreGuard, [k]: e.target.checked },
              }))
            }
          />
          <span style={{ fontSize: 12 }}>{label}</span>
        </label>
      ))}
    </div>
  );
}

/* ═══════════════ 主台 ═══════════════ */

export function InspirationToStoryWorkbench({
  projectId,
  onSyncMaster,
}: {
  projectId?: string;
  onSyncMaster?: (thin: ReturnType<typeof summarizeInspirationToStoryToMaster>) => void;
}) {
  const [wf, setWf] = useItsWf({ projectId });
  const score = useMemo(() => inspirationToStoryWorkflowCompleteness(wf), [wf]);
  const [tab, setTab] = usePersistedState(projectId, "its-l8-tab", "overview");

  const syncThin = () => {
    const thin = summarizeInspirationToStoryToMaster(wf);
    onSyncMaster?.(thin);
    if (projectId) {
      try {
        const key = `deep:${projectId}:master-outline`;
        const prev = localStorage.getItem(key);
        const base = prev ? (JSON.parse(prev) as MasterOutlineBody) : {};
        localStorage.setItem(key, JSON.stringify({ ...base, ...thin }));
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <Panel
      title="灵感成故事（8.md 十步总装）"
      actions={
        <div className="row" style={{ gap: 6 }}>
          <Badge>
            步骤完成 {score.filledSteps}/{score.totalSteps}
          </Badge>
          <Button size="sm" onClick={syncThin}>
            回写总纲摘要
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        L2–L6 是零件；本课是判层→选路径→人设/关系/核心事件→章纲/细纲→汇入短篇 Stage→抽卡改稿的总装。不另建第二套短篇管线。
      </p>
      {score.missing.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Badge tone="warn">未完成：{score.missing.join("、")}</Badge>
        </div>
      )}
      <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {INSPIRATION_TO_STORY_CHECKPOINTS.map((cp, i) => (
          <button
            key={cp.id}
            type="button"
            className="btn btn-sm"
            style={{
              outline: wf.currentStep === i ? "2px solid var(--accent, #126b5b)" : undefined,
              opacity: i < score.filledSteps ? 1 : 0.75,
            }}
            onClick={() => setWf((s) => ({ ...s, currentStep: i }))}
            title={`${cp.userAction}\nAI：${cp.aiAction}`}
          >
            {i + 1}. {cp.label.replace(/^\d+\./, "")}
          </button>
        ))}
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "总览" },
          { id: "classify", label: "判层" },
          { id: "path", label: "路径A/B/C" },
          { id: "storyline", label: "故事线" },
          { id: "seven", label: "七步法" },
          { id: "relation", label: "关系网" },
          { id: "five", label: "五部曲" },
          { id: "chapter", label: "章纲树" },
          { id: "scene", label: "细纲四描写" },
          { id: "ai", label: "抽卡质检" },
          { id: "guard", label: "题材闸" },
        ]}
      />
      {tab === "overview" && (
        <div className="stack" style={{ gap: 8 }}>
          <p style={{ fontSize: 13, margin: 0 }}>
            当前路径：{wf.activePath ? PATH_LABELS[wf.activePath] : "未选"} · 汇入短篇：
            {wf.handedOffToShortNovel ? "是" : "否"}
          </p>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.sevenStepsDone}
              onChange={(e) => setWf((s) => ({ ...s, sevenStepsDone: e.target.checked }))}
            />
            <span style={{ fontSize: 12 }}>七步法人设已在 DeepMethod 完成</span>
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.handedOffToShortNovel}
              onChange={(e) => setWf((s) => ({ ...s, handedOffToShortNovel: e.target.checked }))}
            />
            <span style={{ fontSize: 12 }}>已汇入 short_novel Stage（不另建管线）</span>
          </label>
          <label className="field">
            <span>备注</span>
            <textarea
              className="textarea"
              rows={2}
              value={wf.notes}
              onChange={(e) => setWf((s) => ({ ...s, notes: e.target.value }))}
            />
          </label>
        </div>
      )}
      {tab === "classify" && <StructureLevelClassifyPanel projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "path" && <PathABCRouter projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "storyline" && <StorylineCardPanel projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "seven" && (
        <div className="stack" style={{ gap: 8 }}>
          <Badge>复用 DeepMethod 七步法 · 属 8 课创作入口</Badge>
          <SevenStepCharWorkbench projectId={projectId} />
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.sevenStepsDone}
              onChange={(e) => setWf((s) => ({ ...s, sevenStepsDone: e.target.checked }))}
            />
            <span style={{ fontSize: 12 }}>本课闸：七步法已完成</span>
          </label>
        </div>
      )}
      {tab === "relation" && <RelationshipNetPanel projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "five" && <ChaseWifeFiveActPanel projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "chapter" && <ChapterTreePanel projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "scene" && <SceneFourRenderWorkbench projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "ai" && <AiReviseFlowPanel projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "guard" && <GenreGuardHints projectId={projectId} wf={wf} setWf={setWf} />}
    </Panel>
  );
}

/** 供类型消歧：五部曲阶段列表 */
export const FIVE_ACT_PHASE_ORDER: ChaseWifeFiveActPhase[] = [
  "breakup",
  "turning",
  "awakening",
  "chase",
  "ending",
];
