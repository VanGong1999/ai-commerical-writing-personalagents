/**
 * 九格基础课（6.md + 7.md 深化）深度工作台：
 * Maslow+cool12 · 装逼打脸三阶/信息差 · 代入感五维 · 文字表现力。
 * 7.md 与 6.md 同堂：深化缺口—满足/写法卡/四线/审稿六问，不另建 Lesson7 台。
 * 不重复 4.md 爽点四步 / 5.md 三轮拉扯 / DeepMethod 仅选型薄台。
 */
import {
  ACTIVE_SUB_MODE_LABELS,
  COOL12_TROPE_IDS,
  COOL12_TROPE_META,
  COOL12_TROPE_RECIPE,
  COOL_FACE_SLAP_CHECKPOINTS,
  EDITORIAL_ASK_LABELS,
  FACE_SLAP_TIER_LABELS,
  IMMERSION_ISSUE_LABELS,
  MASLOW_NEED_LABELS,
  SLAP_VARIANT_LABELS,
  STELLA_CASE_SKELETONS,
  buildTropeRecipeChecks,
  cool12PlanCompleteness,
  coolFaceSlapWorkflowCompleteness,
  defaultBeatsForTier,
  faceSlapPremiseCompleteness,
  immersionFiveCompleteness,
  suggestEmotionIntensity,
  summarizeCoolFaceSlapToMaster,
  validatePowerRevealLayers,
  validateTierInfoGap,
  validateToolspersonStatus,
  type ActiveSubMode,
  type Cool12TropeId,
  type CoolFaceSlapWorkflow,
  type EditorialAsk,
  type FaceSlapTier,
  type ImmersionIssue,
  type InfoGapKnowLevel,
  type MaslowNeedLevel,
  type MasterOutlineBody,
  type SlapVariant,
} from "@xiezuomanju/domain";
import { Badge, Button, CollapsibleSection, Panel, Tabs } from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useMemo, type Dispatch, type SetStateAction } from "react";
import { runAgentFeedback } from "./runAgentFeedback";
import { usePersistedState } from "./usePersistedState";

export function emptyCoolFaceSlap(): CoolFaceSlapWorkflow {
  return {
    schemaVersion: "nines-6.md/1",
    cool12: {
      primaryNeed: "esteem",
      tropeIds: [],
      multiStackNote: "多梗叠加，禁止单一套路；可循环叠加核心梗。",
      chapterMapping: [],
      eroticEdgeBlocked: true,
      needGap: "",
      satisfyBeat: "",
      rewardUpgrade: "",
      channelNote: "",
      tropeRecipeChecks: [],
    },
    flexShow: {
      power: false,
      appropriate: false,
      competitiveEdge: false,
      psychologicalEdge: false,
      powerCarrier: "",
      triggerReason: "",
      appropriateDetail: "",
      note: "四要素不必全齐，具备其一亦可；网文装逼偏褒义（表面装、实际真牛）。",
    },
    premise: {
      slapper: "",
      slapped: "",
      purpose: "",
      mode: "direct",
      slapVariant: "flex_slap",
      done: false,
    },
    infoGap: {
      protagonist: "full",
      reader: "full",
      villain: "unknown",
      atmosphere: "unknown",
      insider: "unknown",
      toolsperson: "unknown",
      note: "信息差是打脸爽感引擎：谁知道主角实力决定爽度。",
    },
    beat: {
      tier: "active",
      emotionIntensity: 1,
      beats: defaultBeatsForTier("active"),
      activeSubMode: undefined,
      toolspersonName: "",
      toolspersonHasStatus: false,
      powerRevealPct: 0,
      powerRevealSecondPct: 100,
      sceneLabel: "",
      slapperTag: "",
      slappedTag: "",
    },
    psyche: {
      villain: "未开始",
      hero: "未开始",
      atmosphere: "未开始",
      insider: "未开始",
      note: "7.md：反派/主角/气氛组/知情配角四线",
    },
    linkedCoolPointFirst: "",
    linkedPullRound: 0,
    immersion: {
      fiveAsk: {
        background: "",
        coreDesire: "",
        fear: "",
        values: "",
        behaviorPattern: "",
        catchphrase: "",
      },
      traits: [],
      contrastHook: "",
      proactivePerChapter: false,
      arc: { defect: "", keyEvent: "", overcome: "", newState: "" },
      tension: { goal: "", failCost: "", countdown: "", crisisChain: "", baseFear: "" },
      villain: {
        stagePowerGap: "",
        conflictGoal: "",
        motive: "",
        weakness: "",
        activePressure: "",
      },
      issues: [],
      levels: {},
      resonanceCheck: "",
      fixPlan: "",
      impressionPoint: "",
      standingBeat: "",
      editorialAsk: {
        mainlineClear: false,
        characterClear: false,
        conflictEnough: false,
        immersionOk: false,
        expectationOk: false,
        paceOk: false,
      },
    },
    prose: {
      filterWordsScanned: false,
      filterHits: [],
      sensesUsed: [],
      bodyReaction: "",
      innerMonologue: "",
      vagueVerbsReplaced: false,
      spatialOrder: "unset",
      noDirectEmotionTell: false,
      note: "过滤词：看到/听到/觉得…；五感≥3+生理+内心；禁「他很生气」直述。",
    },
    curveAlign: {
      benchmarkRounds: 0,
      imitateRounds: 0,
      alignedUpDown: false,
      note: "它上你上、它下你下；一上一下为一轮（常约三轮，链5.md）。",
      dissectMode: "both",
      chapterBundleSize: 10,
      longFormTargetChapters: 50,
      linkedDissectDocId: "",
      stella5w1hNote:
        "5W1H 变异：Who/What/When/What action/What goal/How（链拆书，不重建 11 项）",
    },
    currentStep: 1,
    notes: "",
  };
}

type CfsCtl = {
  projectId?: string;
  wf?: CoolFaceSlapWorkflow;
  setWf?: Dispatch<SetStateAction<CoolFaceSlapWorkflow>>;
};

function useCfsWf({ projectId, wf, setWf }: CfsCtl) {
  const persisted = usePersistedState<CoolFaceSlapWorkflow>(
    projectId,
    "cool-face-slap-wf",
    emptyCoolFaceSlap(),
  );
  if (wf && setWf) return [wf, setWf] as const;
  return persisted;
}

const KNOW_OPTS: { v: InfoGapKnowLevel; l: string }[] = [
  { v: "unknown", l: "不知" },
  { v: "slight", l: "稍知" },
  { v: "full", l: "全知" },
  { v: "reader_only", l: "仅读者" },
];

/* ═══════════════ cool12 ═══════════════ */

export function MaslowCool12Panel(props: CfsCtl) {
  const [wf, setWf] = useCfsWf(props);
  const score = cool12PlanCompleteness(wf.cool12);
  const { projectId } = props;

  const toggleTrope = (id: Cool12TropeId) => {
    setWf((s) => {
      const has = s.cool12.tropeIds.includes(id);
      const tropeIds = has
        ? s.cool12.tropeIds.filter((x) => x !== id)
        : [...s.cool12.tropeIds, id];
      return { ...s, cool12: { ...s.cool12, tropeIds } };
    });
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        先定 Maslow 需求层再选套路；建议 ≥2 叠加。7.md 强调「先缺口再满足」。DeepMethod 仅选型薄入口。
        选完可在「链 L4」回写爽点一句话，不重建四步法。
      </p>
      <div className="row" style={{ gap: 6 }}>
        <Badge tone={score.stackOk ? "ok" : "warn"}>
          已选 {wf.cool12.tropeIds.length}（需≥2）
        </Badge>
        <Badge tone={score.gapSatisfyOk ? "ok" : "warn"}>缺口—满足</Badge>
      </div>
      <label className="field">
        <span>需求缺口（虐/压抑）</span>
        <textarea
          className="textarea"
          rows={2}
          value={wf.cool12.needGap}
          onChange={(e) =>
            setWf((s) => ({ ...s, cool12: { ...s.cool12, needGap: e.target.value } }))
          }
        />
      </label>
      <label className="field">
        <span>满足/释放场面</span>
        <textarea
          className="textarea"
          rows={2}
          value={wf.cool12.satisfyBeat}
          onChange={(e) =>
            setWf((s) => ({ ...s, cool12: { ...s.cool12, satisfyBeat: e.target.value } }))
          }
        />
      </label>
      <label className="field">
        <span>二次升级（危机后再奖励，可选）</span>
        <input
          className="input"
          value={wf.cool12.rewardUpgrade}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              cool12: { ...s.cool12, rewardUpgrade: e.target.value },
            }))
          }
        />
      </label>
      <label className="field">
        <span>赛道提示（女频专一独宠等）</span>
        <input
          className="input"
          value={wf.cool12.channelNote}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              cool12: { ...s.cool12, channelNote: e.target.value },
            }))
          }
        />
      </label>
      <label className="field">
        <span>主需求层</span>
        <Select
          className="select"
          value={wf.cool12.primaryNeed}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              cool12: { ...s.cool12, primaryNeed: e.target.value as MaslowNeedLevel },
            }))
          }
        >
          {(Object.keys(MASLOW_NEED_LABELS) as MaslowNeedLevel[]).map((k) => (
            <option key={k} value={k}>
              {MASLOW_NEED_LABELS[k]}
            </option>
          ))}
        </Select>
      </label>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {COOL12_TROPE_IDS.map((id) => {
          const meta = COOL12_TROPE_META[id];
          const on = wf.cool12.tropeIds.includes(id);
          const inNeed = meta.need === wf.cool12.primaryNeed;
          return (
            <button
              key={id}
              type="button"
              className="badge"
              style={{
                opacity: inNeed ? 1 : 0.55,
                borderColor: on ? "var(--accent)" : undefined,
              }}
              onClick={() => toggleTrope(id)}
            >
              {meta.index}. {meta.label}
            </button>
          );
        })}
      </div>
      <label className="field">
        <span>核心套路</span>
        <Select
          className="select"
          value={wf.cool12.coreTropeId ?? ""}
          onChange={(e) => {
            const coreTropeId = (e.target.value || undefined) as Cool12TropeId | undefined;
            setWf((s) => ({
              ...s,
              cool12: {
                ...s.cool12,
                coreTropeId,
                tropeRecipeChecks: coreTropeId
                  ? [buildTropeRecipeChecks(coreTropeId)]
                  : [],
              },
            }));
          }}
        >
          <option value="">（未定）</option>
          {wf.cool12.tropeIds.map((id) => (
            <option key={id} value={id}>
              {COOL12_TROPE_META[id].label}
            </option>
          ))}
        </Select>
      </label>
      {wf.cool12.coreTropeId && (
        <Panel title={`写法卡：${COOL12_TROPE_META[wf.cool12.coreTropeId].label}`}>
          {(
            wf.cool12.tropeRecipeChecks[0]?.items ??
            COOL12_TROPE_RECIPE[wf.cool12.coreTropeId].map((x) => ({ ...x, done: false }))
          ).map((it, idx) => (
            <label key={it.id} className="row" style={{ gap: 6, marginBottom: 4 }}>
              <input
                type="checkbox"
                checked={it.done}
                onChange={() =>
                  setWf((s) => {
                    const checks =
                      s.cool12.tropeRecipeChecks.length > 0
                        ? s.cool12.tropeRecipeChecks
                        : [buildTropeRecipeChecks(s.cool12.coreTropeId!)];
                    const items = checks[0]!.items.map((x, i) =>
                      i === idx ? { ...x, done: !x.done } : x,
                    );
                    return {
                      ...s,
                      cool12: {
                        ...s.cool12,
                        tropeRecipeChecks: [{ ...checks[0]!, items }],
                      },
                    };
                  })
                }
              />
              <span style={{ fontSize: 13 }}>{it.label}</span>
            </label>
          ))}
        </Panel>
      )}
      <label className="row" style={{ gap: 4 }}>
        <input
          type="checkbox"
          checked={wf.cool12.eroticEdgeBlocked}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              cool12: { ...s.cool12, eroticEdgeBlocked: e.target.checked },
            }))
          }
        />
        生存类禁擦边开车
      </label>
      <Button
        size="sm"
        variant="primary"
        disabled={!projectId}
        onClick={() =>
          projectId &&
          void runAgentFeedback(projectId, "struct.cool12", {
            label: "struct.cool12",
            inputJson: wf.cool12,
          })
        }
      >
        跑 struct.cool12
      </Button>
    </div>
  );
}

/* ═══════════════ 装逼 + 四前提 + 信息差 + 三阶 ═══════════════ */

export function FaceSlapDesignWorkbench(props: CfsCtl) {
  const [wf, setWf] = useCfsWf(props);
  const prem = faceSlapPremiseCompleteness(wf.premise);
  const gapV = validateTierInfoGap(wf.beat.tier, wf.infoGap);
  const tool = validateToolspersonStatus(wf.beat);
  const power = validatePowerRevealLayers(wf.beat);
  const { projectId } = props;

  const setTier = (tier: FaceSlapTier) => {
    setWf((s) => ({
      ...s,
      beat: {
        ...s.beat,
        tier,
        emotionIntensity: suggestEmotionIntensity(tier),
        beats: defaultBeatsForTier(tier),
      },
    }));
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <Panel title="装逼四要素">
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          {wf.flexShow.note}
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
          {(
            [
              ["power", "力量"],
              ["appropriate", "适当"],
              ["competitiveEdge", "竞争优势"],
              ["psychologicalEdge", "心理优势"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="row" style={{ gap: 4 }}>
              <input
                type="checkbox"
                checked={wf.flexShow[key]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    flexShow: { ...s.flexShow, [key]: e.target.checked },
                  }))
                }
              />
              {label}
            </label>
          ))}
        </div>
        <div className="field-grid">
          <label className="field">
            <span>力量载体</span>
            <input
              className="input"
              value={wf.flexShow.powerCarrier}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  flexShow: { ...s.flexShow, powerCarrier: e.target.value },
                }))
              }
            />
          </label>
          <label className="field">
            <span>触发理由</span>
            <input
              className="input"
              value={wf.flexShow.triggerReason}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  flexShow: { ...s.flexShow, triggerReason: e.target.value },
                }))
              }
            />
          </label>
        </div>
      </Panel>

      <Panel title="打脸四前提（未齐不可标完成）">
        <div className="row" style={{ gap: 6 }}>
          {prem.complete ? (
            <Badge tone="ok">四前提齐全</Badge>
          ) : (
            <Badge tone="fail">缺：{prem.missing.join("、")}</Badge>
          )}
        </div>
        <label className="field">
          <span>版本（7.md：纯打脸 vs 装逼打脸）</span>
          <Select
            className="select"
            value={wf.premise.slapVariant}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                premise: {
                  ...s.premise,
                  slapVariant: e.target.value as SlapVariant,
                },
              }))
            }
          >
            {(Object.keys(SLAP_VARIANT_LABELS) as SlapVariant[]).map((k) => (
              <option key={k} value={k}>
                {SLAP_VARIANT_LABELS[k]}
              </option>
            ))}
          </Select>
        </label>
        <div className="field-grid">
          <label className="field">
            <span>谁打（主角）</span>
            <input
              className="input"
              value={wf.premise.slapper}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  premise: { ...s.premise, slapper: e.target.value },
                }))
              }
            />
          </label>
          <label className="field">
            <span>打谁（反派）</span>
            <input
              className="input"
              value={wf.premise.slapped}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  premise: { ...s.premise, slapped: e.target.value },
                }))
              }
            />
          </label>
          <label className="field">
            <span>为何打</span>
            <input
              className="input"
              value={wf.premise.purpose}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  premise: { ...s.premise, purpose: e.target.value },
                }))
              }
            />
          </label>
          <label className="field">
            <span>方式</span>
            <Select
              className="select"
              value={wf.premise.mode}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  premise: {
                    ...s.premise,
                    mode: e.target.value as "direct" | "indirect",
                  },
                }))
              }
            >
              <option value="direct">直接</option>
              <option value="indirect">间接</option>
            </Select>
          </label>
        </div>
        <label className="row" style={{ gap: 4 }}>
          <input
            type="checkbox"
            checked={wf.premise.done}
            disabled={!prem.complete}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                premise: { ...s.premise, done: e.target.checked },
              }))
            }
          />
          标四前提完成（须先填齐）
        </label>
      </Panel>

      <Panel title="信息差矩阵（打脸引擎）">
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          {wf.infoGap.note} 气氛组在本课是见证扩散镜头，非 4.md 三类情绪链。
        </p>
        {(
          [
            ["protagonist", "主角"],
            ["reader", "读者"],
            ["villain", "反派"],
            ["atmosphere", "气氛组"],
            ["insider", "知情煽火"],
            ["toolsperson", "工具人"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="field">
            <span>{label}</span>
            <Select
              className="select"
              value={wf.infoGap[key]}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  infoGap: {
                    ...s.infoGap,
                    [key]: e.target.value as InfoGapKnowLevel,
                  },
                }))
              }
            >
              {KNOW_OPTS.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.l}
                </option>
              ))}
            </Select>
          </label>
        ))}
        {!gapV.ok &&
          gapV.warnings.map((w) => (
            <Badge key={w} tone="warn">
              {w}
            </Badge>
          ))}
      </Panel>

      <Panel title="选阶 + 节奏 checklist">
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {(Object.keys(FACE_SLAP_TIER_LABELS) as FaceSlapTier[]).map((t) => (
            <button
              key={t}
              type="button"
              className="badge"
              style={{
                borderColor: wf.beat.tier === t ? "var(--accent)" : undefined,
              }}
              onClick={() => setTier(t)}
            >
              {FACE_SLAP_TIER_LABELS[t]}
            </button>
          ))}
          <Badge>强度 {wf.beat.emotionIntensity}/10</Badge>
        </div>
        {wf.beat.tier === "active" && (
          <label className="field">
            <span>初阶三子模式（7.md 必选）</span>
            <Select
              className="select"
              value={wf.beat.activeSubMode ?? ""}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  beat: {
                    ...s.beat,
                    activeSubMode: (e.target.value || undefined) as
                      | ActiveSubMode
                      | undefined,
                  },
                }))
              }
            >
              <option value="">（未选）</option>
              {(Object.keys(ACTIVE_SUB_MODE_LABELS) as ActiveSubMode[]).map((k) => (
                <option key={k} value={k}>
                  {ACTIVE_SUB_MODE_LABELS[k]}
                </option>
              ))}
            </Select>
          </label>
        )}
        {wf.beat.beats.map((b, idx) => (
          <label key={b.id} className="row" style={{ gap: 6, marginBottom: 4 }}>
            <input
              type="checkbox"
              checked={b.done}
              onChange={() =>
                setWf((s) => ({
                  ...s,
                  beat: {
                    ...s.beat,
                    beats: s.beat.beats.map((x, i) =>
                      i === idx ? { ...x, done: !x.done } : x,
                    ),
                  },
                }))
              }
            />
            <span style={{ fontSize: 13 }}>{b.label}</span>
          </label>
        ))}
        {wf.beat.tier === "passive" && (
          <div className="field-grid">
            <label className="field">
              <span>工具人姓名</span>
              <input
                className="input"
                value={wf.beat.toolspersonName}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    beat: { ...s.beat, toolspersonName: e.target.value },
                  }))
                }
              />
            </label>
            <label className="row" style={{ gap: 4, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={wf.beat.toolspersonHasStatus}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    beat: { ...s.beat, toolspersonHasStatus: e.target.checked },
                  }))
                }
              />
              有身份地位名声
            </label>
            <label className="field">
              <span>第一次实力%</span>
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                value={wf.beat.powerRevealPct}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    beat: { ...s.beat, powerRevealPct: Number(e.target.value) || 0 },
                  }))
                }
              />
            </label>
            <label className="field">
              <span>第二次实力%</span>
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                value={wf.beat.powerRevealSecondPct}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    beat: {
                      ...s.beat,
                      powerRevealSecondPct: Number(e.target.value) || 0,
                    },
                  }))
                }
              />
            </label>
          </div>
        )}
        {!tool.ok && <Badge tone="fail">{tool.warning}</Badge>}
        {!power.ok && <Badge tone="fail">{power.warning}</Badge>}
        <div className="field-grid">
          <label className="field">
            <span>反派心理</span>
            <Select
              className="select"
              value={wf.psyche.villain}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  psyche: {
                    ...s.psyche,
                    villain: e.target.value as typeof s.psyche.villain,
                  },
                }))
              }
            >
              {["未开始", "得意忘形", "诚惶诚恐", "追悔莫及", "讨好"].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span>主角心理</span>
            <Select
              className="select"
              value={wf.psyche.hero}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  psyche: {
                    ...s.psyche,
                    hero: e.target.value as typeof s.psyche.hero,
                  },
                }))
              }
            >
              {["未开始", "胜券在握", "志得意满", "嗤之以鼻"].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span>气氛组（7.md）</span>
            <Select
              className="select"
              value={wf.psyche.atmosphere}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  psyche: {
                    ...s.psyche,
                    atmosphere: e.target.value as typeof s.psyche.atmosphere,
                  },
                }))
              }
            >
              {["未开始", "捧高", "震惊", "回踩"].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span>知情配角（7.md）</span>
            <Select
              className="select"
              value={wf.psyche.insider}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  psyche: {
                    ...s.psyche,
                    insider: e.target.value as typeof s.psyche.insider,
                  },
                }))
              }
            >
              {["未开始", "煽火", "幸灾乐祸", "崇拜坐等"].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span>分场·装逼方</span>
            <input
              className="input"
              value={wf.beat.slapperTag}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  beat: { ...s.beat, slapperTag: e.target.value },
                }))
              }
            />
          </label>
          <label className="field">
            <span>分场·打脸方</span>
            <input
              className="input"
              value={wf.beat.slappedTag}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  beat: { ...s.beat, slappedTag: e.target.value },
                }))
              }
            />
          </label>
        </div>
        <Button
          size="sm"
          variant="primary"
          disabled={!projectId}
          onClick={() =>
            projectId &&
            void runAgentFeedback(projectId, "struct.face_slap", {
              label: "struct.face_slap",
              inputJson: { premise: wf.premise, beat: wf.beat, infoGap: wf.infoGap },
            })
          }
        >
          跑 struct.face_slap
        </Button>
      </Panel>
    </div>
  );
}

/* ═══════════════ 代入感 + 文字 + 曲线 ═══════════════ */

export function ImmersionFiveWorkbench(props: CfsCtl) {
  const [wf, setWf] = useCfsWf(props);
  const imm = immersionFiveCompleteness(wf.immersion);
  const { projectId } = props;

  return (
    <div className="stack" style={{ gap: 8 }}>
      <Badge>
        代入感 {imm.filled}/{imm.total}
      </Badge>
      <Panel title="人设五问 + 口头禅">
        {(
          [
            ["background", "背景"],
            ["coreDesire", "核心欲望"],
            ["fear", "恐惧"],
            ["values", "价值观"],
            ["behaviorPattern", "行为模式"],
            ["catchphrase", "口头禅"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="field">
            <span>{label}</span>
            <input
              className="input"
              value={wf.immersion.fiveAsk[key]}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  immersion: {
                    ...s.immersion,
                    fiveAsk: { ...s.immersion.fiveAsk, [key]: e.target.value },
                  },
                }))
              }
            />
          </label>
        ))}
      </Panel>
      <label className="field">
        <span>特质（逗号分隔，≥2）</span>
        <input
          className="input"
          value={wf.immersion.traits.join(",")}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              immersion: {
                ...s.immersion,
                traits: e.target.value
                  .split(/[,，]/)
                  .map((x) => x.trim())
                  .filter(Boolean),
              },
            }))
          }
        />
      </label>
      <label className="field">
        <span>反差萌点</span>
        <input
          className="input"
          value={wf.immersion.contrastHook}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              immersion: { ...s.immersion, contrastHook: e.target.value },
            }))
          }
        />
      </label>
      <label className="row" style={{ gap: 4 }}>
        <input
          type="checkbox"
          checked={wf.immersion.proactivePerChapter}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              immersion: { ...s.immersion, proactivePerChapter: e.target.checked },
            }))
          }
        />
        每章有主动选择
      </label>
      <Panel title="弧线四栏">
        <div className="field-grid">
          {(
            [
              ["defect", "起始缺陷"],
              ["keyEvent", "关键事件"],
              ["overcome", "克服动作"],
              ["newState", "终态"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="field">
              <span>{label}</span>
              <input
                className="input"
                value={wf.immersion.arc[key]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    immersion: {
                      ...s.immersion,
                      arc: { ...s.immersion.arc, [key]: e.target.value },
                    },
                  }))
                }
              />
            </label>
          ))}
        </div>
      </Panel>
      <Panel title="紧迫感包">
        <div className="field-grid">
          {(
            [
              ["goal", "核心目标"],
              ["failCost", "失败代价（须致命）"],
              ["countdown", "倒计时"],
              ["crisisChain", "危机链"],
              ["baseFear", "基础恐惧"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="field">
              <span>{label}</span>
              <input
                className="input"
                value={wf.immersion.tension[key]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    immersion: {
                      ...s.immersion,
                      tension: { ...s.immersion.tension, [key]: e.target.value },
                    },
                  }))
                }
              />
            </label>
          ))}
        </div>
      </Panel>
      <Panel title="反派卡">
        <div className="field-grid">
          {(
            [
              ["stagePowerGap", "阶段性实力差"],
              ["conflictGoal", "冲突目标"],
              ["motive", "内在动机"],
              ["weakness", "弱点"],
              ["activePressure", "主动施压"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="field">
              <span>{label}</span>
              <input
                className="input"
                value={wf.immersion.villain[key]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    immersion: {
                      ...s.immersion,
                      villain: { ...s.immersion.villain, [key]: e.target.value },
                    },
                  }))
                }
              />
            </label>
          ))}
        </div>
      </Panel>
      <Panel title="五维问题勾选">
        {(Object.keys(IMMERSION_ISSUE_LABELS) as ImmersionIssue[]).map((id) => (
          <label key={id} className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.immersion.issues.includes(id)}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  immersion: {
                    ...s.immersion,
                    issues: e.target.checked
                      ? [...s.immersion.issues, id]
                      : s.immersion.issues.filter((x) => x !== id),
                  },
                }))
              }
            />
            {IMMERSION_ISSUE_LABELS[id]}
          </label>
        ))}
      </Panel>
      <label className="field">
        <span>共鸣检验（会否为角色心痛/开心）</span>
        <textarea
          className="textarea"
          rows={2}
          value={wf.immersion.resonanceCheck}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              immersion: { ...s.immersion, resonanceCheck: e.target.value },
            }))
          }
        />
      </label>
      <Panel title="人物立住（7.md）">
        <label className="field">
          <span>印象点</span>
          <input
            className="input"
            value={wf.immersion.impressionPoint}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                immersion: { ...s.immersion, impressionPoint: e.target.value },
              }))
            }
          />
        </label>
        <label className="field">
          <span>魅力爆发场</span>
          <input
            className="input"
            value={wf.immersion.standingBeat}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                immersion: { ...s.immersion, standingBeat: e.target.value },
              }))
            }
          />
        </label>
      </Panel>
      <Panel title="审稿自检六问（≥3）">
        <Badge tone={imm.editorialOk ? "ok" : "warn"}>
          已勾 {Object.values(wf.immersion.editorialAsk).filter(Boolean).length}/6
        </Badge>
        {(Object.keys(EDITORIAL_ASK_LABELS) as (keyof EditorialAsk)[]).map((key) => (
          <label key={key} className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.immersion.editorialAsk[key]}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  immersion: {
                    ...s.immersion,
                    editorialAsk: {
                      ...s.immersion.editorialAsk,
                      [key]: e.target.checked,
                    },
                  },
                }))
              }
            />
            {EDITORIAL_ASK_LABELS[key]}
          </label>
        ))}
      </Panel>
      <Button
        size="sm"
        variant="primary"
        disabled={!projectId}
        onClick={() =>
          projectId &&
          void runAgentFeedback(projectId, "qc.immersion", {
            label: "qc.immersion",
            inputJson: wf.immersion,
          })
        }
      >
        跑 qc.immersion
      </Button>
    </div>
  );
}

export function ProseForcePanel(props: CfsCtl) {
  const [wf, setWf] = useCfsWf(props);
  const senses = ["视", "听", "嗅", "触", "味"];
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        {wf.prose.note} 与 5.md「展示非告知」互补：本课偏过滤词/五感/动词。
      </p>
      <label className="row" style={{ gap: 4 }}>
        <input
          type="checkbox"
          checked={wf.prose.filterWordsScanned}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              prose: { ...s.prose, filterWordsScanned: e.target.checked },
            }))
          }
        />
        已扫描过滤词
      </label>
      <label className="field">
        <span>过滤词命中（逗号分隔）</span>
        <input
          className="input"
          value={wf.prose.filterHits.join(",")}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              prose: {
                ...s.prose,
                filterHits: e.target.value
                  .split(/[,，]/)
                  .map((x) => x.trim())
                  .filter(Boolean),
              },
            }))
          }
        />
      </label>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {senses.map((se) => (
          <label key={se} className="row" style={{ gap: 4 }}>
            <input
              type="checkbox"
              checked={wf.prose.sensesUsed.includes(se)}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  prose: {
                    ...s.prose,
                    sensesUsed: e.target.checked
                      ? [...s.prose.sensesUsed, se]
                      : s.prose.sensesUsed.filter((x) => x !== se),
                  },
                }))
              }
            />
            {se}
          </label>
        ))}
      </div>
      <label className="row" style={{ gap: 4 }}>
        <input
          type="checkbox"
          checked={wf.prose.noDirectEmotionTell}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              prose: { ...s.prose, noDirectEmotionTell: e.target.checked },
            }))
          }
        />
        无情绪直述
      </label>
      <label className="row" style={{ gap: 4 }}>
        <input
          type="checkbox"
          checked={wf.prose.vagueVerbsReplaced}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              prose: { ...s.prose, vagueVerbsReplaced: e.target.checked },
            }))
          }
        />
        笼统动词已替换
      </label>
      <label className="field">
        <span>描写顺序</span>
        <Select
          className="select"
          value={wf.prose.spatialOrder}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              prose: {
                ...s.prose,
                spatialOrder: e.target.value as typeof s.prose.spatialOrder,
              },
            }))
          }
        >
          <option value="unset">未定</option>
          <option value="far_near">远→近</option>
          <option value="top_bottom">上→下</option>
          <option value="logic">逻辑顺序</option>
        </Select>
      </label>
    </div>
  );
}

/* ═══════════════ 十步主台 ═══════════════ */

export function CoolFaceSlapWorkbench({
  projectId,
  onSyncMaster,
}: {
  projectId?: string;
  onSyncMaster?: (thin: ReturnType<typeof summarizeCoolFaceSlapToMaster>) => void;
}) {
  const [wf, setWf] = useCfsWf({ projectId });
  const score = useMemo(() => coolFaceSlapWorkflowCompleteness(wf), [wf]);
  const [tab, setTab] = usePersistedState(projectId, "cfs-l6-tab", "overview");

  const syncThin = () => {
    const thin = summarizeCoolFaceSlapToMaster(wf);
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
      title="爽点打脸 + 代入感（6.md 十步）"
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
        L4=爽点=满足期待；L5=情绪如何经拉扯写出；本课=选哪类爽 + 怎么打脸 + 代入感验收。
        7.md 与 6.md 同堂：深化缺口—满足/写法卡/四线/审稿六问，不另建 Lesson7 台。
      </p>
      {score.missing.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Badge tone="warn">未完成：{score.missing.join("、")}</Badge>
        </div>
      )}
      <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {COOL_FACE_SLAP_CHECKPOINTS.map((cp, i) => (
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
          { id: "cool12", label: "cool12" },
          { id: "slap", label: "打脸设计" },
          { id: "link", label: "链L4/L5" },
          { id: "immersion", label: "代入感" },
          { id: "prose", label: "文字" },
          { id: "curve", label: "曲线校准" },
          { id: "cases", label: "7.md案例" },
        ]}
      />
      {tab === "overview" && (
        <div className="stack" style={{ marginTop: 10, gap: 8 }}>
          {COOL_FACE_SLAP_CHECKPOINTS.map((cp) => (
            <div
              key={cp.id}
              style={{ fontSize: 12, padding: 8, borderLeft: "3px solid var(--border, #ddd)" }}
            >
              <strong>{cp.label}</strong>
              <div className="muted">你：{cp.userAction}</div>
              <div className="muted">AI：{cp.aiAction}</div>
            </div>
          ))}
        </div>
      )}
      {tab === "cool12" && <MaslowCool12Panel projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "slap" && <FaceSlapDesignWorkbench projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "link" && (
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            可选回写 4.md `coolPointFirst`；链 5.md 三轮序号。不打开四步/三轮完整表单。
          </p>
          <label className="field">
            <span>爽点一句话（可同步 L4）</span>
            <input
              className="input"
              value={wf.linkedCoolPointFirst}
              onChange={(e) =>
                setWf((s) => ({ ...s, linkedCoolPointFirst: e.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>关联三轮轮次 0–3</span>
            <input
              className="input"
              type="number"
              min={0}
              max={3}
              value={wf.linkedPullRound}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  linkedPullRound: Number(e.target.value) || 0,
                }))
              }
            />
          </label>
        </div>
      )}
      {tab === "immersion" && (
        <ImmersionFiveWorkbench projectId={projectId} wf={wf} setWf={setWf} />
      )}
      {tab === "prose" && <ProseForcePanel projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "curve" && (
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            {wf.curveAlign.note} {wf.curveAlign.stella5w1hNote}
          </p>
          <div className="field-grid">
            <label className="field">
              <span>对标轮次</span>
              <input
                className="input"
                type="number"
                min={0}
                value={wf.curveAlign.benchmarkRounds}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    curveAlign: {
                      ...s.curveAlign,
                      benchmarkRounds: Number(e.target.value) || 0,
                    },
                  }))
                }
              />
            </label>
            <label className="field">
              <span>仿写轮次</span>
              <input
                className="input"
                type="number"
                min={0}
                value={wf.curveAlign.imitateRounds}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    curveAlign: {
                      ...s.curveAlign,
                      imitateRounds: Number(e.target.value) || 0,
                    },
                  }))
                }
              />
            </label>
            <label className="field">
              <span>拆书模式（合并/分章）</span>
              <Select
                className="select"
                value={wf.curveAlign.dissectMode}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    curveAlign: {
                      ...s.curveAlign,
                      dissectMode: e.target.value as "merge" | "chapter" | "both",
                    },
                  }))
                }
              >
                <option value="merge">合并拆（约10章一批）</option>
                <option value="chapter">分章拆</option>
                <option value="both">合并+分章</option>
              </Select>
            </label>
            <label className="field">
              <span>合并批次章数</span>
              <input
                className="input"
                type="number"
                min={1}
                value={wf.curveAlign.chapterBundleSize}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    curveAlign: {
                      ...s.curveAlign,
                      chapterBundleSize: Number(e.target.value) || 10,
                    },
                  }))
                }
              />
            </label>
            <label className="field">
              <span>长篇知套路目标章数</span>
              <input
                className="input"
                type="number"
                min={1}
                value={wf.curveAlign.longFormTargetChapters}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    curveAlign: {
                      ...s.curveAlign,
                      longFormTargetChapters: Number(e.target.value) || 50,
                    },
                  }))
                }
              />
            </label>
            <label className="field">
              <span>链拆书 docId（可选）</span>
              <input
                className="input"
                value={wf.curveAlign.linkedDissectDocId}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    curveAlign: {
                      ...s.curveAlign,
                      linkedDissectDocId: e.target.value,
                    },
                  }))
                }
              />
            </label>
          </div>
          <label className="row" style={{ gap: 4 }}>
            <input
              type="checkbox"
              checked={wf.curveAlign.alignedUpDown}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  curveAlign: { ...s.curveAlign, alignedUpDown: e.target.checked },
                }))
              }
            />
            上下对齐（它上你上）
          </label>
        </div>
      )}
      {tab === "cases" && (
        <CollapsibleSection title="7.md Stella 案例骨架">
          <div className="stack" style={{ gap: 8 }}>
            {STELLA_CASE_SKELETONS.map((c) => (
              <div
                key={c.id}
                style={{ fontSize: 12, padding: 8, borderLeft: "3px solid var(--border, #ddd)" }}
              >
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
      )}
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
