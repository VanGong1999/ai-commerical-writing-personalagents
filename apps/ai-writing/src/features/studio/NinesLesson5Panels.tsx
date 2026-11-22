/**
 * 九格基础课（5.md）深度工作台：
 * 情绪锚定 · 三轮拉扯 · 以事见人 · Show/Don't Tell · 节奏四维 · 导语四轴。
 * 不重复 2.md 拆书薄字段 / 3.md 换元七步与 EmotionSlope / 4.md 三类情绪链。
 * 装逼打脸/cool12 完备台见 NinesLesson6Panels（6.md）；本课只链三轮序号。
 * RhythmQuant（3.md）嵌入疏密维，不替换。
 */
import {
  CORE_EMOTION_LABELS,
  DEFAULT_EMOTION_RENDER_ITEMS,
  DEFAULT_RHYTHM_QUANT,
  EDITOR_REJECT_ROUTE,
  EMOTION_CASE_SKELETONS,
  EMOTION_RHYTHM_CHECKPOINTS,
  PROTAGONIST_HARM_LABELS,
  SCENE_SIX_ELEMENTS_ORDER,
  SCENE_SIX_ELEMENT_PACE,
  classifyWorkGenreByHarm,
  emotionRhythmWorkflowCompleteness,
  seePersonCompleteness,
  summarizeEmotionRhythmToMaster,
  threeRoundPullCompleteness,
  validateObstacleEscalation,
  validateRanBoundToShuang,
  validateTightLooseMatch,
  validateZhangChiSequence,
  type CoreEmotionType,
  type EmotionRhythmWorkflow,
  type EmotionSceneBeat,
  type MasterOutlineBody,
  type ProtagonistHarmLevel,
  type ZhangChiKind,
} from "@xiezuomanju/domain";
import { Badge, Button, CollapsibleSection, Panel, Tabs } from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useMemo, type Dispatch, type SetStateAction } from "react";
import { RhythmQuantPanel } from "./NinesLesson3Panels";
import { runAgentFeedback } from "./runAgentFeedback";
import { usePersistedState } from "./usePersistedState";

export function emptyEmotionRhythm(): EmotionRhythmWorkflow {
  return {
    schemaVersion: "nines-5.md/1",
    anchor: {
      core: "爽",
      protagonistState: "",
      harmLevel: "none_irreversible",
      genreLabel: "未判定",
      noviceSingleCoreLocked: true,
      ranBoundToShuang: false,
      secondaryEmotions: [],
      note: "",
    },
    platform: {
      manjuShuangMain: true,
      heiyanShuangNueOnly: true,
      fanqieTianScarce: true,
      duanjuShuangTianMix: true,
      discourageNewbieSuspenseHorrorHeal: true,
      danmeiDomesticClosed: true,
      lingyiNoGhostGod: true,
      hints: [
        "漫剧基本以爽文为主",
        "黑岩基本只收爽/虐，不收甜",
        "番茄长篇甜文少；短剧又爽又甜反而多",
        "新手勿先写悬疑/恐/治愈（难、正反馈慢）",
        "耽美向国内不要写；灵异可写但不能出鬼/神",
      ],
    },
    pull: {
      isomorphicNote:
        "与 4.md 的 1+3、七步法、三幕式同构：铺垫建预期 → 引爆 → 宣泄满足或落空。",
      gapExpectation: "",
      linkedExpectationId: "",
      rounds: [
        {
          index: 1,
          partialSatisfy: "",
          obstacle: "",
          obstacleLevel: 3,
          resolveOrFake: "",
          escalate: "",
          expectationNote: "",
          emotionNote: "",
        },
        {
          index: 2,
          partialSatisfy: "",
          obstacle: "",
          obstacleLevel: 6,
          resolveOrFake: "",
          escalate: "",
          expectationNote: "",
          emotionNote: "",
        },
        {
          index: 3,
          partialSatisfy: "",
          obstacle: "",
          obstacleLevel: 9,
          resolveOrFake: "",
          escalate: "",
          expectationNote: "",
          emotionNote: "",
        },
      ],
      outcome: "overpay",
      refuseFate: true,
      villainEnding: "undecided",
      replayAmplify: "",
      replayMode: "未定",
      surpriseGain: "",
    },
    seePerson: {
      scenes: [],
      principleNote:
        "以事见人：主角反应必须有；对照组与气氛组强化情绪强度。本结构是场景写法，非 4.md 三类情绪链。",
    },
    showDontTell: {
      hits: [],
      scanned: false,
      note: "审稿时专门搜索「他感到」「他觉得」；出现则重点检查是否告知。",
    },
    renderChecklist: DEFAULT_EMOTION_RENDER_ITEMS.map((i) => ({ ...i })),
    rhythm: {
      kuaiman: {
        volumeCharsMin: 100_000,
        volumeCharsMax: 150_000,
        unitCharsMin: 10_000,
        unitCharsMax: 15_000,
        chapterCharsMin: 2000,
        chapterCharsMax: 3000,
        normalEventChapters: "1-2",
        climaxEventChapters: "3-4",
        climaxGapChapters: "10-15 或 2-3 小节",
        scriptThreePhases: "",
        attentionNote:
          "章 2000–3000 字约对应阅读 4–5 分钟注意力节奏；开篇/结尾算特殊事件。",
      },
      shumi: { ...DEFAULT_RHYTHM_QUANT },
      imitateQuantBrief: "仿写量化：多少章 × 每章多少字 × 每章多少情节点 × 每节点多少字",
      zhangChi: [],
      tenseOverRelax: true,
      attributeDriftWarned: false,
      monotoneEscalateWarned: false,
      jinhuan: [],
      fightPipeline: "环境 → 嘴炮(语言) → 心理 → 开打(动作+感受) → 打完写伤势状态",
      notes: "",
    },
    hookLead: {
      purposeNote:
        "导语目的是吸引往下看，不是堆「最激烈冲突」（无前因则激烈表现不出）。",
      antiCommonSense: "",
      deepMeaning: "",
      emotionWave: "",
      suspense: "",
      draft: "",
      noFabricatedPrompt: true,
    },
    blindWrite: {
      sourceBeat: "",
      verbalDissect: "",
      nonverbalDissect: "",
      environmentDissect: "",
      twistPoint: "",
      blindWrite: "",
      compareNote: "",
      retries: 0,
    },
    diagnose: { reasons: [], notes: "", fixPlan: "" },
    crisisOpenEye: false,
    shortPaceLongForm: false,
    currentStep: 1,
    notes: "",
  };
}

type ErCtl = {
  projectId?: string;
  wf?: EmotionRhythmWorkflow;
  setWf?: Dispatch<SetStateAction<EmotionRhythmWorkflow>>;
};

function useErWf({ projectId, wf, setWf }: ErCtl) {
  const persisted = usePersistedState<EmotionRhythmWorkflow>(
    projectId,
    "emotion-rhythm-wf",
    emptyEmotionRhythm(),
  );
  if (wf && setWf) return [wf, setWf] as const;
  return persisted;
}

function emptyScene(id: string): EmotionSceneBeat {
  return {
    id,
    sceneLabel: "",
    protagonistReaction: "",
    controlGroup: "",
    atmosphereGroup: "",
    atmospherePolarity: "mixed",
    environmentCue: "",
    causeBeforeEffect: "",
    subtext: "",
    actionMemoryPoint: "",
    actionPurpose: "",
    appearanceAsMood: "",
    sensoryRecall: "",
    countdownTimer: "",
    sentenceTension: "mixed",
    payload: {
      verbal: "",
      nonverbalAction: "",
      nonverbalReaction: "",
      nonverbalOs: "",
      inferredEmotion: "",
    },
    intensityWarn: false,
  };
}

/* ═══════════════ 锚定 + 伤害判定 + 平台 ═══════════════ */

export function EmotionAnchorPanel(props: ErCtl) {
  const [wf, setWf] = useErWf(props);
  const ran = validateRanBoundToShuang(wf.anchor);
  const genre = classifyWorkGenreByHarm(wf.anchor.harmLevel, wf.anchor.core);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        核心情绪只有一个；过程可有小情绪。新手先锁单一核心。三类情绪链（主角/反派/气氛）见 4.md
        爽点附属，本课是场景级「以事见人」。
      </p>
      <div className="field-grid">
        <label className="field">
          <span>核心情绪</span>
          <Select
            className="select"
            value={wf.anchor.core}
            onChange={(e) => {
              const core = e.target.value as CoreEmotionType;
              setWf((s) => ({
                ...s,
                anchor: {
                  ...s.anchor,
                  core,
                  genreLabel: classifyWorkGenreByHarm(s.anchor.harmLevel, core),
                },
              }));
            }}
          >
            {(Object.keys(CORE_EMOTION_LABELS) as CoreEmotionType[]).map((k) => (
              <option key={k} value={k}>
                {CORE_EMOTION_LABELS[k]}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span>对主角伤害程度</span>
          <Select
            className="select"
            value={wf.anchor.harmLevel}
            onChange={(e) => {
              const harmLevel = e.target.value as ProtagonistHarmLevel;
              setWf((s) => ({
                ...s,
                anchor: {
                  ...s.anchor,
                  harmLevel,
                  genreLabel: classifyWorkGenreByHarm(harmLevel, s.anchor.core),
                },
              }));
            }}
          >
            {(Object.keys(PROTAGONIST_HARM_LABELS) as ProtagonistHarmLevel[]).map((k) => (
              <option key={k} value={k}>
                {PROTAGONIST_HARM_LABELS[k]}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Badge tone="ok">判定类型：{wf.anchor.genreLabel !== "未判定" ? wf.anchor.genreLabel : genre}</Badge>
        {!ran.ok && <Badge tone="fail">{ran.warning}</Badge>}
      </div>
      <label className="field">
        <span>主角当前情绪状态（锚定说明）</span>
        <textarea
          className="textarea"
          rows={2}
          value={wf.anchor.protagonistState}
          onChange={(e) =>
            setWf((s) => ({ ...s, anchor: { ...s.anchor, protagonistState: e.target.value } }))
          }
        />
      </label>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <label className="row" style={{ gap: 4 }}>
          <input
            type="checkbox"
            checked={wf.anchor.noviceSingleCoreLocked}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                anchor: { ...s.anchor, noviceSingleCoreLocked: e.target.checked },
              }))
            }
          />
          新手锁单一核心
        </label>
        <label className="row" style={{ gap: 4 }}>
          <input
            type="checkbox"
            checked={wf.anchor.ranBoundToShuang}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                anchor: { ...s.anchor, ranBoundToShuang: e.target.checked },
              }))
            }
          />
          燃已绑定爽
        </label>
      </div>
      <CollapsibleSection title="平台收稿提示" storageKey={props.projectId ? `er-plat-${props.projectId}` : undefined}>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
          {wf.platform.hints.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      </CollapsibleSection>
    </div>
  );
}

/* ═══════════════ 三轮拉扯 ═══════════════ */

export function ThreeRoundPullWorkbench(props: ErCtl) {
  const [wf, setWf] = useErWf(props);
  const pullC = threeRoundPullCompleteness(wf.pull);
  const esc = validateObstacleEscalation(wf.pull);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        铺垫 → 引爆 → 宣泄。与 4.md 的 1+3 同构，不另造期待系统。阻碍须层层递进、单调不减。
      </p>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <Badge>
          完成 {pullC.filled}/{pullC.total}
        </Badge>
        {esc.ok ? <Badge tone="ok">阻碍递进 OK</Badge> : <Badge tone="fail">阻碍递减</Badge>}
        {!pullC.refuseFateOk && <Badge tone="fail">虐文须不认命</Badge>}
      </div>
      {!esc.ok &&
        esc.warnings.map((w) => (
          <Badge key={w} tone="warn">
            {w}
          </Badge>
        ))}
      <label className="field">
        <span>制造缺口 / 建立预期（可链 L4 期待 id）</span>
        <textarea
          className="textarea"
          rows={2}
          value={wf.pull.gapExpectation}
          onChange={(e) =>
            setWf((s) => ({ ...s, pull: { ...s.pull, gapExpectation: e.target.value } }))
          }
        />
      </label>
      <label className="field">
        <span>关联 L4 期待 id（可选）</span>
        <input
          className="input"
          value={wf.pull.linkedExpectationId}
          onChange={(e) =>
            setWf((s) => ({ ...s, pull: { ...s.pull, linkedExpectationId: e.target.value } }))
          }
        />
      </label>
      {wf.pull.rounds.map((r, idx) => (
        <div
          key={r.index}
          style={{ padding: 8, border: "1px solid var(--border, #e8eae5)", borderRadius: 8 }}
        >
          <strong style={{ fontSize: 13 }}>第 {r.index} 轮</strong>
          <div className="field-grid" style={{ marginTop: 6 }}>
            <label className="field">
              <span>部分满足</span>
              <input
                className="input"
                value={r.partialSatisfy}
                onChange={(e) => {
                  const v = e.target.value;
                  setWf((s) => {
                    const rounds = s.pull.rounds.map((x, i) =>
                      i === idx ? { ...x, partialSatisfy: v } : x,
                    );
                    return { ...s, pull: { ...s.pull, rounds } };
                  });
                }}
              />
            </label>
            <label className="field">
              <span>阻碍</span>
              <input
                className="input"
                value={r.obstacle}
                onChange={(e) => {
                  const v = e.target.value;
                  setWf((s) => {
                    const rounds = s.pull.rounds.map((x, i) =>
                      i === idx ? { ...x, obstacle: v } : x,
                    );
                    return { ...s, pull: { ...s.pull, rounds } };
                  });
                }}
              />
            </label>
            <label className="field">
              <span>阻碍强度 1–10</span>
              <input
                className="input"
                type="number"
                min={1}
                max={10}
                value={r.obstacleLevel}
                onChange={(e) => {
                  const v = Number(e.target.value) || 1;
                  setWf((s) => {
                    const rounds = s.pull.rounds.map((x, i) =>
                      i === idx ? { ...x, obstacleLevel: v } : x,
                    );
                    return { ...s, pull: { ...s.pull, rounds } };
                  });
                }}
              />
            </label>
            <label className="field">
              <span>真/假破局</span>
              <input
                className="input"
                value={r.resolveOrFake}
                onChange={(e) => {
                  const v = e.target.value;
                  setWf((s) => {
                    const rounds = s.pull.rounds.map((x, i) =>
                      i === idx ? { ...x, resolveOrFake: v } : x,
                    );
                    return { ...s, pull: { ...s.pull, rounds } };
                  });
                }}
              />
            </label>
          </div>
        </div>
      ))}
      <div className="field-grid">
        <label className="field">
          <span>结局</span>
          <Select
            className="select"
            value={wf.pull.outcome}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                pull: {
                  ...s.pull,
                  outcome: e.target.value as "overpay" | "fallthrough",
                },
              }))
            }
          >
            <option value="overpay">满足到极致（爽）</option>
            <option value="fallthrough">预期落空（虐）</option>
          </Select>
        </label>
        <label className="field">
          <span>复盘放大模式</span>
          <Select
            className="select"
            value={wf.pull.replayMode}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                pull: {
                  ...s.pull,
                  replayMode: e.target.value as "升华" | "留白" | "未定",
                },
              }))
            }
          >
            <option value="未定">未定</option>
            <option value="升华">升华</option>
            <option value="留白">留白</option>
          </Select>
        </label>
        <label className="field">
          <span>反派下场</span>
          <Select
            className="select"
            value={wf.pull.villainEnding}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                pull: {
                  ...s.pull,
                  villainEnding: e.target.value as
                    | "yield"
                    | "dead"
                    | "prison"
                    | "undecided",
                },
              }))
            }
          >
            <option value="undecided">未定</option>
            <option value="dead">死</option>
            <option value="prison">入狱</option>
            <option value="yield">服软</option>
          </Select>
        </label>
      </div>
      <label className="row" style={{ gap: 4 }}>
        <input
          type="checkbox"
          checked={wf.pull.refuseFate}
          onChange={(e) =>
            setWf((s) => ({ ...s, pull: { ...s.pull, refuseFate: e.target.checked } }))
          }
        />
        主角不认命（虐文硬规则）
      </label>
      <label className="field">
        <span>复盘放大 / 意外收获</span>
        <textarea
          className="textarea"
          rows={2}
          value={wf.pull.replayAmplify}
          onChange={(e) =>
            setWf((s) => ({ ...s, pull: { ...s.pull, replayAmplify: e.target.value } }))
          }
        />
      </label>
      <label className="field">
        <span>爽文意外收获</span>
        <input
          className="input"
          value={wf.pull.surpriseGain}
          onChange={(e) =>
            setWf((s) => ({ ...s, pull: { ...s.pull, surpriseGain: e.target.value } }))
          }
        />
      </label>
    </div>
  );
}

/* ═══════════════ 以事见人 ═══════════════ */

export function SeePersonThroughEventWorkbench(props: ErCtl) {
  const [wf, setWf] = useErWf(props);
  const see = seePersonCompleteness(wf.seePerson);

  const addScene = () => {
    const id = `sc${wf.seePerson.scenes.length + 1}`;
    setWf((s) => ({
      ...s,
      seePerson: { ...s.seePerson, scenes: [...s.seePerson.scenes, emptyScene(id)] },
    }));
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        {wf.seePerson.principleNote}
      </p>
      <div className="row" style={{ gap: 6 }}>
        <Badge tone={see.canMarkDone ? "ok" : "warn"}>
          反应齐全 {see.filled}/{see.total}
        </Badge>
        <Button size="sm" onClick={addScene}>
          加一场
        </Button>
      </div>
      {see.intensityWarnings.map((w) => (
        <Badge key={w} tone="warn">
          {w}
        </Badge>
      ))}
      {wf.seePerson.scenes.map((sc, idx) => (
        <div
          key={sc.id}
          style={{ padding: 8, border: "1px solid var(--border, #e8eae5)", borderRadius: 8 }}
        >
          <label className="field">
            <span>场景标签</span>
            <input
              className="input"
              value={sc.sceneLabel}
              onChange={(e) => {
                const v = e.target.value;
                setWf((s) => {
                  const scenes = s.seePerson.scenes.map((x, i) =>
                    i === idx ? { ...x, sceneLabel: v } : x,
                  );
                  return { ...s, seePerson: { ...s.seePerson, scenes } };
                });
              }}
            />
          </label>
          <label className="field">
            <span>主角反应（必填）</span>
            <textarea
              className="textarea"
              rows={2}
              value={sc.protagonistReaction}
              onChange={(e) => {
                const v = e.target.value;
                setWf((s) => {
                  const scenes = s.seePerson.scenes.map((x, i) =>
                    i === idx ? { ...x, protagonistReaction: v } : x,
                  );
                  return { ...s, seePerson: { ...s.seePerson, scenes } };
                });
              }}
            />
          </label>
          <div className="field-grid">
            <label className="field">
              <span>对照组</span>
              <input
                className="input"
                value={sc.controlGroup}
                onChange={(e) => {
                  const v = e.target.value;
                  setWf((s) => {
                    const scenes = s.seePerson.scenes.map((x, i) =>
                      i === idx ? { ...x, controlGroup: v } : x,
                    );
                    return { ...s, seePerson: { ...s.seePerson, scenes } };
                  });
                }}
              />
            </label>
            <label className="field">
              <span>气氛组</span>
              <input
                className="input"
                value={sc.atmosphereGroup}
                onChange={(e) => {
                  const v = e.target.value;
                  setWf((s) => {
                    const scenes = s.seePerson.scenes.map((x, i) =>
                      i === idx ? { ...x, atmosphereGroup: v } : x,
                    );
                    return { ...s, seePerson: { ...s.seePerson, scenes } };
                  });
                }}
              />
            </label>
          </div>
          <label className="field">
            <span>先因后果（前因）</span>
            <input
              className="input"
              value={sc.causeBeforeEffect}
              onChange={(e) => {
                const v = e.target.value;
                setWf((s) => {
                  const scenes = s.seePerson.scenes.map((x, i) =>
                    i === idx ? { ...x, causeBeforeEffect: v } : x,
                  );
                  return { ...s, seePerson: { ...s.seePerson, scenes } };
                });
              }}
            />
          </label>
          <div className="field-grid">
            <label className="field">
              <span>台词层</span>
              <input
                className="input"
                value={sc.payload.verbal}
                onChange={(e) => {
                  const v = e.target.value;
                  setWf((s) => {
                    const scenes = s.seePerson.scenes.map((x, i) =>
                      i === idx ? { ...x, payload: { ...x.payload, verbal: v } } : x,
                    );
                    return { ...s, seePerson: { ...s.seePerson, scenes } };
                  });
                }}
              />
            </label>
            <label className="field">
              <span>非语言·动作</span>
              <input
                className="input"
                value={sc.payload.nonverbalAction}
                onChange={(e) => {
                  const v = e.target.value;
                  setWf((s) => {
                    const scenes = s.seePerson.scenes.map((x, i) =>
                      i === idx
                        ? { ...x, payload: { ...x.payload, nonverbalAction: v } }
                        : x,
                    );
                    return { ...s, seePerson: { ...s.seePerson, scenes } };
                  });
                }}
              />
            </label>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════ Show / Don't Tell ═══════════════ */

export function ShowDontTellWorkbench(props: ErCtl) {
  const [wf, setWf] = useErWf(props);
  const { projectId } = props;

  const addHit = () => {
    setWf((s) => ({
      ...s,
      showDontTell: {
        ...s.showDontTell,
        hits: [
          ...s.showDontTell.hits,
          { excerpt: "", pattern: "他感到", rewrite: "", fixed: false },
        ],
        scanned: true,
      },
    }));
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        {wf.showDontTell.note}
      </p>
      <div className="row" style={{ gap: 6 }}>
        <label className="row" style={{ gap: 4 }}>
          <input
            type="checkbox"
            checked={wf.showDontTell.scanned}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                showDontTell: { ...s.showDontTell, scanned: e.target.checked },
              }))
            }
          />
          已扫描告知句（可选，可保留原句）
        </label>
        <Button size="sm" onClick={addHit}>
          登记一处告知
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!projectId}
          onClick={() =>
            projectId &&
            void runAgentFeedback(projectId, "qc.show_dont_tell", {
              label: "qc.show_dont_tell",
              inputJson: wf.showDontTell,
            })
          }
        >
          跑 show_dont_tell
        </Button>
      </div>
      {wf.showDontTell.hits.map((h, idx) => (
        <div
          key={idx}
          style={{ padding: 8, border: "1px solid var(--border, #e8eae5)", borderRadius: 8 }}
        >
          <div className="field-grid">
            <label className="field">
              <span>原文摘录</span>
              <input
                className="input"
                value={h.excerpt}
                onChange={(e) => {
                  const v = e.target.value;
                  setWf((s) => {
                    const hits = s.showDontTell.hits.map((x, i) =>
                      i === idx ? { ...x, excerpt: v } : x,
                    );
                    return { ...s, showDontTell: { ...s.showDontTell, hits } };
                  });
                }}
              />
            </label>
            <label className="field">
              <span>模式词</span>
              <input
                className="input"
                value={h.pattern}
                onChange={(e) => {
                  const v = e.target.value;
                  setWf((s) => {
                    const hits = s.showDontTell.hits.map((x, i) =>
                      i === idx ? { ...x, pattern: v } : x,
                    );
                    return { ...s, showDontTell: { ...s.showDontTell, hits } };
                  });
                }}
              />
            </label>
          </div>
          <label className="field">
            <span>改写（展示）</span>
            <textarea
              className="textarea"
              rows={2}
              value={h.rewrite}
              onChange={(e) => {
                const v = e.target.value;
                setWf((s) => {
                  const hits = s.showDontTell.hits.map((x, i) =>
                    i === idx ? { ...x, rewrite: v } : x,
                  );
                  return { ...s, showDontTell: { ...s.showDontTell, hits } };
                });
              }}
            />
          </label>
          <label className="row" style={{ gap: 4 }}>
            <input
              type="checkbox"
              checked={h.fixed}
              onChange={(e) => {
                const v = e.target.checked;
                setWf((s) => {
                  const hits = s.showDontTell.hits.map((x, i) =>
                    i === idx ? { ...x, fixed: v } : x,
                  );
                  return { ...s, showDontTell: { ...s.showDontTell, hits } };
                });
              }}
            />
            已改写
          </label>
        </div>
      ))}
      <Panel title="渲染细则清单">
        {wf.renderChecklist.map((it) => (
          <label key={it.id} className="row" style={{ gap: 6, marginBottom: 4 }}>
            <input
              type="checkbox"
              checked={it.done}
              onChange={() =>
                setWf((s) => ({
                  ...s,
                  renderChecklist: s.renderChecklist.map((x) =>
                    x.id === it.id ? { ...x, done: !x.done } : x,
                  ),
                }))
              }
            />
            <span style={{ fontSize: 13 }}>{it.label}</span>
          </label>
        ))}
      </Panel>
    </div>
  );
}

/* ═══════════════ 节奏四维 ═══════════════ */

export function RhythmFourDimDashboard(props: ErCtl) {
  const [wf, setWf] = useErWf(props);
  const zc = validateZhangChiSequence(wf.rhythm.zhangChi);
  const { projectId } = props;

  const addZhangChi = (kind: ZhangChiKind) => {
    setWf((s) => ({
      ...s,
      rhythm: {
        ...s.rhythm,
        zhangChi: [
          ...s.rhythm.zhangChi,
          { unitLabel: `单元${s.rhythm.zhangChi.length + 1}`, kind, note: "" },
        ],
      },
    }));
  };

  const addJinhuan = () => {
    setWf((s) => ({
      ...s,
      rhythm: {
        ...s.rhythm,
        jinhuan: [
          ...s.rhythm.jinhuan,
          {
            beatLabel: `情节点${s.rhythm.jinhuan.length + 1}`,
            targetEmotion: "紧张",
            selectedElements: ["动作", "感受"],
            mismatchWarned: false,
            note: "",
          },
        ],
      },
    }));
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        节奏四维 = 快慢 / 疏密 / 张弛 / 紧缓。下方「节奏量化」为 3.md RhythmQuant，嵌入疏密维、不替换。
        情绪上下行对照（EmotionSlope）仍在章纲台，属仿写斜率，非本课以事见人。
      </p>
      <Panel title="快慢 · 结构篇幅">
        <div className="field-grid">
          {(
            [
              ["volumeCharsMin", "一卷下限"],
              ["volumeCharsMax", "一卷上限"],
              ["unitCharsMin", "单元下限"],
              ["unitCharsMax", "单元上限"],
              ["chapterCharsMin", "章下限"],
              ["chapterCharsMax", "章上限"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="field">
              <span>{label}</span>
              <input
                className="input"
                type="number"
                value={wf.rhythm.kuaiman[key]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    rhythm: {
                      ...s.rhythm,
                      kuaiman: {
                        ...s.rhythm.kuaiman,
                        [key]: Number(e.target.value) || 0,
                      },
                    },
                  }))
                }
              />
            </label>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          {wf.rhythm.kuaiman.attentionNote}
        </p>
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <label className="row" style={{ gap: 4 }}>
            <input
              type="checkbox"
              checked={wf.crisisOpenEye}
              onChange={(e) => setWf((s) => ({ ...s, crisisOpenEye: e.target.checked }))}
            />
            危机睁眼流开篇
          </label>
          <label className="row" style={{ gap: 4 }}>
            <input
              type="checkbox"
              checked={wf.shortPaceLongForm}
              onChange={(e) => setWf((s) => ({ ...s, shortPaceLongForm: e.target.checked }))}
            />
            短篇节奏写长篇（约 1000 字/章）
          </label>
        </div>
      </Panel>

      <Panel title="疏密 · 嵌入 RhythmQuant（3.md）">
        <label className="field">
          <span>仿写量化指令结构</span>
          <input
            className="input"
            value={wf.rhythm.imitateQuantBrief}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                rhythm: { ...s.rhythm, imitateQuantBrief: e.target.value },
              }))
            }
          />
        </label>
        <RhythmQuantPanel projectId={projectId} />
      </Panel>

      <Panel title="张弛 · 单元之间">
        <div className="row" style={{ gap: 6 }}>
          <Button size="sm" onClick={() => addZhangChi("tense")}>
            +紧张
          </Button>
          <Button size="sm" onClick={() => addZhangChi("relax")}>
            +松弛
          </Button>
          {zc.ok ? (
            <Badge tone="ok">
              张弛 OK（紧{zc.tenseCount}/松{zc.relaxCount}）
            </Badge>
          ) : (
            <Badge tone="fail">情绪透支风险</Badge>
          )}
        </div>
        {zc.warnings.map((w) => (
          <Badge key={w} tone="warn">
            {w}
          </Badge>
        ))}
        {wf.rhythm.zhangChi.map((u, idx) => (
          <div key={idx} className="row" style={{ gap: 8, marginTop: 4 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              value={u.unitLabel}
              onChange={(e) => {
                const v = e.target.value;
                setWf((s) => {
                  const zhangChi = s.rhythm.zhangChi.map((x, i) =>
                    i === idx ? { ...x, unitLabel: v } : x,
                  );
                  return { ...s, rhythm: { ...s.rhythm, zhangChi } };
                });
              }}
            />
            <Select
              className="select"
              value={u.kind}
              onChange={(e) => {
                const v = e.target.value as ZhangChiKind;
                setWf((s) => {
                  const zhangChi = s.rhythm.zhangChi.map((x, i) =>
                    i === idx ? { ...x, kind: v } : x,
                  );
                  return { ...s, rhythm: { ...s.rhythm, zhangChi } };
                });
              }}
            >
              <option value="tense">紧张</option>
              <option value="relax">松弛</option>
            </Select>
          </div>
        ))}
      </Panel>

      <SceneSixElementsPanel {...props} onAddBeat={addJinhuan} />
    </div>
  );
}

export function SceneSixElementsPanel(
  props: ErCtl & { onAddBeat?: () => void },
) {
  const [wf, setWf] = useErWf(props);

  return (
    <Panel title="紧缓 · 场景六要素（缓→紧）">
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        打戏流水线：{wf.rhythm.fightPipeline}
      </p>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {SCENE_SIX_ELEMENTS_ORDER.map((el) => (
          <Badge key={el}>
            {el}·{SCENE_SIX_ELEMENT_PACE[el]}
          </Badge>
        ))}
        <Button size="sm" onClick={() => props.onAddBeat?.()}>
          +情节点写法
        </Button>
      </div>
      {wf.rhythm.jinhuan.map((b, idx) => {
        const v = validateTightLooseMatch(b);
        return (
          <div
            key={idx}
            style={{
              padding: 8,
              border: "1px solid var(--border, #e8eae5)",
              borderRadius: 8,
              marginBottom: 6,
            }}
          >
            <div className="field-grid">
              <label className="field">
                <span>情节点</span>
                <input
                  className="input"
                  value={b.beatLabel}
                  onChange={(e) => {
                    const val = e.target.value;
                    setWf((s) => {
                      const jinhuan = s.rhythm.jinhuan.map((x, i) =>
                        i === idx ? { ...x, beatLabel: val } : x,
                      );
                      return { ...s, rhythm: { ...s.rhythm, jinhuan } };
                    });
                  }}
                />
              </label>
              <label className="field">
                <span>目标情绪</span>
                <input
                  className="input"
                  value={b.targetEmotion}
                  onChange={(e) => {
                    const val = e.target.value;
                    setWf((s) => {
                      const jinhuan = s.rhythm.jinhuan.map((x, i) =>
                        i === idx ? { ...x, targetEmotion: val } : x,
                      );
                      return { ...s, rhythm: { ...s.rhythm, jinhuan } };
                    });
                  }}
                />
              </label>
            </div>
            <div className="row" style={{ flexWrap: "wrap", gap: 8, fontSize: 12 }}>
              {SCENE_SIX_ELEMENTS_ORDER.map((el) => (
                <label key={el} className="row" style={{ gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={b.selectedElements.includes(el)}
                    onChange={(e) => {
                      setWf((s) => {
                        const jinhuan = s.rhythm.jinhuan.map((x, i) => {
                          if (i !== idx) return x;
                          const selectedElements = e.target.checked
                            ? [...x.selectedElements, el]
                            : x.selectedElements.filter((y) => y !== el);
                          const next = { ...x, selectedElements };
                          const check = validateTightLooseMatch(next);
                          return { ...next, mismatchWarned: !check.ok };
                        });
                        return { ...s, rhythm: { ...s.rhythm, jinhuan } };
                      });
                    }}
                  />
                  {el}
                </label>
              ))}
            </div>
            {!v.ok && <Badge tone="fail">{v.warning}</Badge>}
          </div>
        );
      })}
    </Panel>
  );
}

/* ═══════════════ 导语 / 盲写 / 诊断 / 案例 ═══════════════ */

export function HookLeadFourAxesPanel(props: ErCtl) {
  const [wf, setWf] = useErWf(props);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        {wf.hookLead.purposeNote} 课上未展示 Prompt 原文，本面板只落四轴设计要点（不伪造）。
      </p>
      {(
        [
          ["antiCommonSense", "反常识"],
          ["deepMeaning", "内涵深刻"],
          ["emotionWave", "引起情绪波动"],
          ["suspense", "有悬念"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="field">
          <span>{label}</span>
          <input
            className="input"
            value={wf.hookLead[key]}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                hookLead: { ...s.hookLead, [key]: e.target.value },
              }))
            }
          />
        </label>
      ))}
      <label className="field">
        <span>导语草稿</span>
        <textarea
          className="textarea"
          rows={3}
          value={wf.hookLead.draft}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              hookLead: { ...s.hookLead, draft: e.target.value },
            }))
          }
        />
      </label>
    </div>
  );
}

export function BlindWriteDrillPanel(props: ErCtl) {
  const [wf, setWf] = useErWf(props);
  const b = wf.blindWrite;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        找共情情节点 → 拆台词/非语言/环境/转折 → 盲写 → 对比 → 再试。
      </p>
      {(
        [
          ["sourceBeat", "共情情节点"],
          ["verbalDissect", "台词拆解"],
          ["nonverbalDissect", "非语言拆解"],
          ["environmentDissect", "环境"],
          ["twistPoint", "转折点"],
          ["blindWrite", "盲写正文"],
          ["compareNote", "对比差距"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="field">
          <span>{label}</span>
          <textarea
            className="textarea"
            rows={key === "blindWrite" ? 4 : 2}
            value={b[key]}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                blindWrite: { ...s.blindWrite, [key]: e.target.value },
              }))
            }
          />
        </label>
      ))}
      <label className="field">
        <span>重试次数</span>
        <input
          className="input"
          type="number"
          min={0}
          value={b.retries}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              blindWrite: { ...s.blindWrite, retries: Number(e.target.value) || 0 },
            }))
          }
        />
      </label>
    </div>
  );
}

export function EditorRejectDiagnosePanel(props: ErCtl) {
  const [wf, setWf] = useErWf(props);
  const reasons = Object.entries(EDITOR_REJECT_ROUTE) as [
    keyof typeof EDITOR_REJECT_ROUTE,
    { label: string; route: string },
  ][];

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        编辑退稿四因 → 修复路由（矛盾/期待走 4.md；拉扯/节奏走本课）。
      </p>
      {reasons.map(([id, meta]) => (
        <label key={id} className="row" style={{ gap: 6, alignItems: "flex-start" }}>
          <input
            type="checkbox"
            checked={wf.diagnose.reasons.includes(id)}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                diagnose: {
                  ...s.diagnose,
                  reasons: e.target.checked
                    ? [...s.diagnose.reasons, id]
                    : s.diagnose.reasons.filter((r) => r !== id),
                },
              }))
            }
          />
          <span style={{ fontSize: 13 }}>
            <strong>{meta.label}</strong>
            <span className="muted"> → {meta.route}</span>
          </span>
        </label>
      ))}
      <label className="field">
        <span>修复计划</span>
        <textarea
          className="textarea"
          rows={2}
          value={wf.diagnose.fixPlan}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              diagnose: { ...s.diagnose, fixPlan: e.target.value },
            }))
          }
        />
      </label>
    </div>
  );
}

export function CaseSkeletonSidebar() {
  return (
    <CollapsibleSection title="案例骨架库（5.md）">
      <div className="stack" style={{ gap: 8 }}>
        {EMOTION_CASE_SKELETONS.map((c) => (
          <div key={c.id} style={{ fontSize: 12, padding: 8, borderLeft: "3px solid var(--border, #ddd)" }}>
            <Badge>{c.kind}</Badge> <strong>{c.title}</strong>
            <ol style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {c.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}

/* ═══════════════ 十步主台 ═══════════════ */

export function EmotionRhythmWorkbench({
  projectId,
  onSyncMaster,
}: {
  projectId?: string;
  onSyncMaster?: (thin: ReturnType<typeof summarizeEmotionRhythmToMaster>) => void;
}) {
  const [wf, setWf] = useErWf({ projectId });
  const score = useMemo(() => emotionRhythmWorkflowCompleteness(wf), [wf]);
  const [tab, setTab] = usePersistedState(projectId, "er-l5-tab", "overview");

  const syncThin = () => {
    const thin = summarizeEmotionRhythmToMaster(wf);
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
      title="情绪与节奏（5.md 十步）"
      actions={
        <div className="row" style={{ gap: 6 }}>
          <Badge>
            必做步骤完成 {score.filledSteps}/{score.totalSteps}
          </Badge>
          <Button size="sm" onClick={syncThin}>
            回写总纲摘要
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!projectId}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "qc.show_dont_tell", {
                label: "emotion-rhythm",
                inputJson: wf,
              })
            }
          >
            跑情绪诊断
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        主线：矛盾/阻碍 → 期待感 → 情绪三轮拉扯 → 节奏四维。复用 3.md RhythmQuant 与 4.md
        期待/矛盾，不重建。
      </p>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        <Badge>矛盾·期待（4.md）</Badge>
        <span style={{ fontSize: 12 }}>→</span>
        <Badge tone={score.filledSteps >= 3 ? "ok" : "warn"}>情绪拉扯</Badge>
        <span style={{ fontSize: 12 }}>→</span>
        <Badge tone={score.canMarkSeePersonDone ? "ok" : "warn"}>以事见人</Badge>
        <span style={{ fontSize: 12 }}>→</span>
        <Badge tone={score.filledSteps >= 8 ? "ok" : "warn"}>节奏四维</Badge>
      </div>
      {score.missing.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Badge tone="warn">未完成：{score.missing.join("、")}</Badge>
        </div>
      )}
      <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {EMOTION_RHYTHM_CHECKPOINTS.map((cp, i) => (
          <button
            key={cp.id}
            type="button"
            className="btn btn-sm"
            style={{
              outline: wf.currentStep === i + 1 ? "2px solid var(--accent, #126b5b)" : undefined,
              opacity: i < score.filledSteps ? 1 : 0.75,
            }}
            onClick={() => setWf((s) => ({ ...s, currentStep: i + 1 }))}
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
          { id: "anchor", label: "锚定" },
          { id: "pull", label: "三轮" },
          { id: "see", label: "以事见人" },
          { id: "show", label: "展示" },
          { id: "rhythm", label: "四维节奏" },
          { id: "hook", label: "导语·诊断" },
          { id: "drill", label: "盲写" },
          { id: "cases", label: "案例" },
        ]}
      />
      {tab === "overview" && (
        <div className="stack" style={{ marginTop: 10, gap: 8 }}>
          {EMOTION_RHYTHM_CHECKPOINTS.map((cp) => (
            <div
              key={cp.id}
              style={{ fontSize: 12, padding: 8, borderLeft: "3px solid var(--border, #ddd)" }}
            >
              <strong>{cp.label}</strong>
              <div className="muted">你：{cp.userAction}</div>
              <div className="muted">AI：{cp.aiAction}</div>
              <div className="muted">展示：{cp.displayFields.join(", ")}</div>
            </div>
          ))}
        </div>
      )}
      {tab === "anchor" && <EmotionAnchorPanel projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "pull" && <ThreeRoundPullWorkbench projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "see" && (
        <SeePersonThroughEventWorkbench projectId={projectId} wf={wf} setWf={setWf} />
      )}
      {tab === "show" && <ShowDontTellWorkbench projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "rhythm" && <RhythmFourDimDashboard projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "hook" && (
        <div className="stack" style={{ gap: 12, marginTop: 8 }}>
          <HookLeadFourAxesPanel projectId={projectId} wf={wf} setWf={setWf} />
          <EditorRejectDiagnosePanel projectId={projectId} wf={wf} setWf={setWf} />
        </div>
      )}
      {tab === "drill" && <BlindWriteDrillPanel projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "cases" && <CaseSkeletonSidebar />}
      <label className="field" style={{ marginTop: 12 }}>
        <span>备注</span>
        <textarea
          className="textarea"
          rows={2}
          value={wf.notes}
          onChange={(e) => setWf((s) => ({ ...s, notes: e.target.value }))}
        />
      </label>
    </Panel>
  );
}

/** BODY/POLISH：正文侧挂载完整十步台（同源持久化 emotion-rhythm-wf） */
export function EmotionWriteLiteWorkbench({ projectId }: { projectId?: string }) {
  return (
    <div className="stack">
      <EmotionRhythmWorkbench projectId={projectId} />
      <p className="muted" style={{ fontSize: 11 }}>
        当前 Stage 侧重正文/润色：优先完成「以事见人」与「展示非告知」；四维节奏亦可在章纲/细纲台并排查看。
      </p>
    </div>
  );
}
