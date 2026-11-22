/**
 * 九格基础课（10.md）人设深度：Big5 / 欲惧秘 / CP / 灵魂三问 / 短篇手搓12。
 * 嵌七步法；手搓与漫剧十二检分键；关系网可同步 L8。
 */
import {
  BIG5_PRESIDENT_TEMPLATE,
  BIG5_SWEET_REPORTER_TEMPLATE,
  CHARACTER_DEPTH_CHECKPOINTS,
  DIFF_CP_PRESET_LABELS,
  SHORT_HAND_EDIT_12_LABELS,
  SOUL_PROBE_QUESTIONS,
  characterDepthWorkflowCompleteness,
  handEdit12Completeness,
  summarizeCharacterDepthToMaster,
  syncRelationNetFromCharacterSheet,
  validateForeshadowRecover,
  validatePurposeExclusive,
  validateShortSubmitGate,
  validateSoulProbe,
  type CharacterDepthWorkflow,
  type DiffCpPreset,
  type MasterOutlineBody,
} from "@xiezuomanju/domain";
import { Badge, Button, Panel, Tabs } from "@xiezuomanju/ui";
import { useMemo, type Dispatch, type SetStateAction } from "react";
import { SevenStepCharWorkbench } from "./DeepMethodPanels";
import { usePersistedState } from "./usePersistedState";

export function emptyCharacterDepth(): CharacterDepthWorkflow {
  return {
    schemaVersion: "nines-10.md/1",
    currentStep: 0,
    purpose: { exclusiveConfirmed: false, note: "择一为重" },
    big5: {
      openness: { level: 3, fitBehavior: "", unfitBehavior: "" },
      conscientiousness: { level: 3, fitBehavior: "", unfitBehavior: "" },
      extraversion: { level: 3, fitBehavior: "", unfitBehavior: "" },
      agreeableness: { level: 3, fitBehavior: "", unfitBehavior: "" },
      neuroticism: { level: 3, fitBehavior: "", unfitBehavior: "" },
      templateId: "",
      blendNote: "",
    },
    desireFearSecret: {
      desireSurface: "",
      desireDeep: "",
      fearShadow: "",
      ultimateSecret: "",
      secretAsTwist: false,
    },
    cp: {
      preset: "custom",
      customLabel: "",
      openingChecklist: [],
      climaxChecklist: [],
      note: "",
    },
    sheet: {
      basic: "",
      appearance: "",
      mbtiProsCons: "",
      motiveThree: "",
      hallmarkProp: "",
      relationNetRef: "",
      behaviorBoundary: "",
      sevenStepsDone: false,
    },
    soul: { rows: [], questions: [...SOUL_PROBE_QUESTIONS] },
    foreshadow: [],
    handEdit: {
      steps: SHORT_HAND_EDIT_12_LABELS.map((label, i) => ({
        id: `he${i + 1}`,
        label,
        done: false,
      })),
      note: "短篇手搓12步；≠漫剧十二检",
    },
    submitGate: {
      wordCount: 0,
      targetWords: 12000,
      zhihuOverlongWarned: false,
      chapterTitlePlain: false,
      clearedStarsAndExtraLines: false,
      oneHeroine: false,
      oneHero: false,
      hasVillain: false,
      extrasOk: false,
    },
    pitfalls: { noPerfect: false, contrastNeedsBeat: false, noLabelOnly: false },
    sceneBehaviorChecked: false,
    notes: "",
  };
}

type Ctl = {
  projectId?: string;
  wf?: CharacterDepthWorkflow;
  setWf?: Dispatch<SetStateAction<CharacterDepthWorkflow>>;
};

function useCd(props: Ctl) {
  const persisted = usePersistedState(
    props.projectId,
    "character-depth-wf",
    emptyCharacterDepth(),
  );
  if (props.wf && props.setWf) return [props.wf, props.setWf] as const;
  return persisted;
}

export function ShortFictionHandEdit12Panel(props: Ctl) {
  const [wf, setWf] = useCd(props);
  const he = handEdit12Completeness(wf.handEdit);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <Badge tone={he.complete ? "ok" : "warn"}>
        手搓 {he.filled}/{he.total}（≠漫剧十二检）
      </Badge>
      {wf.handEdit.steps.map((step, i) => (
        <label key={step.id} className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={step.done}
            onChange={(e) => {
              const steps = [...wf.handEdit.steps];
              steps[i] = { ...step, done: e.target.checked };
              setWf((s) => ({ ...s, handEdit: { ...s.handEdit, steps } }));
            }}
          />
          <span style={{ fontSize: 12 }}>
            {i + 1}. {step.label}
          </span>
        </label>
      ))}
    </div>
  );
}

export function CharacterDepthWorkbench({
  projectId,
  onSyncMaster,
}: {
  projectId?: string;
  onSyncMaster?: (thin: ReturnType<typeof summarizeCharacterDepthToMaster>) => void;
}) {
  const [wf, setWf] = useCd({ projectId });
  const score = useMemo(() => characterDepthWorkflowCompleteness(wf), [wf]);
  const [tab, setTab] = usePersistedState(projectId, "cd-l10-tab", "overview");
  const pur = validatePurposeExclusive(wf.purpose);
  const soul = validateSoulProbe(wf.soul);
  const fs = validateForeshadowRecover(wf.foreshadow);
  const sub = validateShortSubmitGate(wf.submitGate);

  const syncThin = () => {
    const thin = summarizeCharacterDepthToMaster(wf);
    onSyncMaster?.(thin);
    if (projectId) {
      try {
        const key = `deep:${projectId}:master-outline`;
        const prev = localStorage.getItem(key);
        const base = prev ? (JSON.parse(prev) as MasterOutlineBody) : {};
        localStorage.setItem(key, JSON.stringify({ ...base, ...thin }));
        const rel = syncRelationNetFromCharacterSheet(wf.sheet);
        if (rel.length) {
          const itsKey = `deep:${projectId}:inspiration-to-story-wf`;
          const itsPrev = localStorage.getItem(itsKey);
          if (itsPrev) {
            const its = JSON.parse(itsPrev) as { relationNet?: unknown[] };
            localStorage.setItem(
              itsKey,
              JSON.stringify({
                ...its,
                relationNet: [...(its.relationNet ?? []), ...rel],
              }),
            );
          }
        }
      } catch {
        /* ignore */
      }
    }
  };

  const big5Keys = [
    ["openness", "开放性 O"],
    ["conscientiousness", "尽责性 C"],
    ["extraversion", "外向性 E"],
    ["agreeableness", "宜人性 A"],
    ["neuroticism", "神经质 N"],
  ] as const;

  return (
    <Panel
      title="人设深度（10.md 十步）"
      actions={
        <div className="row" style={{ gap: 6 }}>
          <Badge>
            {score.filledSteps}/{score.totalSteps}
          </Badge>
          <Button size="sm" onClick={syncThin}>
            回写总纲+关系网
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        角色与剧情双向服务。七步法嵌入复用；灵魂三问用课内原文；短篇手搓≠漫剧十二检。
      </p>
      {score.missing.length > 0 && (
        <Badge tone="warn">未完成：{score.missing.join("、")}</Badge>
      )}
      <div className="row" style={{ flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
        {CHARACTER_DEPTH_CHECKPOINTS.map((cp, i) => (
          <button
            key={cp.id}
            type="button"
            className="btn btn-sm"
            style={{
              outline: wf.currentStep === i ? "2px solid var(--accent, #126b5b)" : undefined,
            }}
            onClick={() => setWf((s) => ({ ...s, currentStep: i }))}
            title={cp.userAction}
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
          { id: "purpose", label: "目的" },
          { id: "big5", label: "Big5" },
          { id: "dfs", label: "欲惧秘" },
          { id: "sheet", label: "清单/七步" },
          { id: "cp", label: "CP" },
          { id: "soul", label: "灵魂三问" },
          { id: "hand", label: "手搓12" },
          { id: "submit", label: "投稿闸" },
        ]}
      />
      {tab === "overview" && (
        <div className="stack" style={{ gap: 6 }}>
          <Badge tone={pur.ok ? "ok" : "warn"}>{pur.message}</Badge>
          <Badge tone={soul.ok ? "ok" : "fail"}>{soul.message}</Badge>
          <Badge tone={fs.ok ? "ok" : "fail"}>{fs.message}</Badge>
          <Badge tone={sub.ok ? "ok" : "warn"}>{sub.message}</Badge>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.sceneBehaviorChecked}
              onChange={(e) =>
                setWf((s) => ({ ...s, sceneBehaviorChecked: e.target.checked }))
              }
            />
            <span style={{ fontSize: 12 }}>场景符合/不符合行为已核对</span>
          </label>
          {(
            [
              ["noPerfect", "勿完美人设"],
              ["contrastNeedsBeat", "反差须有暴击情节"],
              ["noLabelOnly", "勿标签化"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.pitfalls[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    pitfalls: { ...s.pitfalls, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
        </div>
      )}
      {tab === "purpose" && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 6 }}>
            {(["commercial", "literary"] as const).map((p) => (
              <button
                key={p}
                type="button"
                className="btn btn-sm"
                style={{
                  outline: wf.purpose.purpose === p ? "2px solid var(--accent)" : undefined,
                }}
                onClick={() =>
                  setWf((s) => ({ ...s, purpose: { ...s.purpose, purpose: p } }))
                }
              >
                {p === "commercial" ? "商业" : "文艺"}
              </button>
            ))}
          </div>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.purpose.exclusiveConfirmed}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  purpose: { ...s.purpose, exclusiveConfirmed: e.target.checked },
                }))
              }
            />
            <span style={{ fontSize: 12 }}>择一为重已确认</span>
          </label>
        </div>
      )}
      {tab === "big5" && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 6 }}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setWf((s) => ({ ...s, big5: { ...BIG5_PRESIDENT_TEMPLATE } }))}
            >
              载入高冷总裁
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setWf((s) => ({ ...s, big5: { ...BIG5_SWEET_REPORTER_TEMPLATE } }))
              }
            >
              载入甜妹记者
            </Button>
          </div>
          {big5Keys.map(([k, label]) => (
            <Panel key={k} title={label}>
              <label className="field">
                <span>档位 1–5</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={5}
                  value={wf.big5[k].level}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      big5: {
                        ...s.big5,
                        [k]: { ...s.big5[k], level: Number(e.target.value) || 3 },
                      },
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>符合行为</span>
                <input
                  className="input"
                  value={wf.big5[k].fitBehavior}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      big5: {
                        ...s.big5,
                        [k]: { ...s.big5[k], fitBehavior: e.target.value },
                      },
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>不符合行为</span>
                <input
                  className="input"
                  value={wf.big5[k].unfitBehavior}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      big5: {
                        ...s.big5,
                        [k]: { ...s.big5[k], unfitBehavior: e.target.value },
                      },
                    }))
                  }
                />
              </label>
            </Panel>
          ))}
        </div>
      )}
      {tab === "dfs" && (
        <div className="stack" style={{ gap: 8 }}>
          {(
            [
              ["desireSurface", "欲望表层"],
              ["desireDeep", "欲望深层"],
              ["fearShadow", "恐惧阴影"],
              ["ultimateSecret", "终极秘密"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span>{l}</span>
              <textarea
                className="textarea"
                rows={2}
                value={wf.desireFearSecret[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    desireFearSecret: { ...s.desireFearSecret, [k]: e.target.value },
                  }))
                }
              />
            </label>
          ))}
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.desireFearSecret.secretAsTwist}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  desireFearSecret: {
                    ...s.desireFearSecret,
                    secretAsTwist: e.target.checked,
                  },
                }))
              }
            />
            <span style={{ fontSize: 12 }}>秘密可作爆点/伏笔</span>
          </label>
        </div>
      )}
      {tab === "sheet" && (
        <div className="stack" style={{ gap: 8 }}>
          <Badge>复用 DeepMethod 七步法 · 属 10 课入口</Badge>
          <SevenStepCharWorkbench projectId={projectId} />
          {(
            [
              ["basic", "基本（姓名年龄职业）"],
              ["appearance", "外貌"],
              ["mbtiProsCons", "MBTI+优缺点"],
              ["motiveThree", "动机三问"],
              ["hallmarkProp", "标志物"],
              ["relationNetRef", "关系网"],
              ["behaviorBoundary", "行为边界"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span>{l}</span>
              <input
                className="input"
                value={wf.sheet[k]}
                onChange={(e) =>
                  setWf((s) => ({ ...s, sheet: { ...s.sheet, [k]: e.target.value } }))
                }
              />
            </label>
          ))}
        </div>
      )}
      {tab === "cp" && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {(Object.keys(DIFF_CP_PRESET_LABELS) as DiffCpPreset[]).map((p) => (
              <button
                key={p}
                type="button"
                className="btn btn-sm"
                style={{
                  outline: wf.cp.preset === p ? "2px solid var(--accent)" : undefined,
                }}
                onClick={() => setWf((s) => ({ ...s, cp: { ...s.cp, preset: p } }))}
              >
                {DIFF_CP_PRESET_LABELS[p]}
              </button>
            ))}
          </div>
          {wf.cp.preset === "custom" && (
            <label className="field">
              <span>自定义 CP</span>
              <input
                className="input"
                value={wf.cp.customLabel}
                onChange={(e) =>
                  setWf((s) => ({ ...s, cp: { ...s.cp, customLabel: e.target.value } }))
                }
              />
            </label>
          )}
          <label className="field">
            <span>开端 checklist（换行）</span>
            <textarea
              className="textarea"
              rows={3}
              value={wf.cp.openingChecklist.join("\n")}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  cp: {
                    ...s.cp,
                    openingChecklist: e.target.value.split("\n").filter(Boolean),
                  },
                }))
              }
            />
          </label>
          <label className="field">
            <span>高潮 checklist（换行）</span>
            <textarea
              className="textarea"
              rows={3}
              value={wf.cp.climaxChecklist.join("\n")}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  cp: {
                    ...s.cp,
                    climaxChecklist: e.target.value.split("\n").filter(Boolean),
                  },
                }))
              }
            />
          </label>
        </div>
      )}
      {tab === "soul" && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            {SOUL_PROBE_QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join(" ")}
          </p>
          <Button
            size="sm"
            onClick={() =>
              setWf((s) => ({
                ...s,
                soul: {
                  ...s.soul,
                  rows: [
                    ...s.soul.rows,
                    {
                      id: `sp-${Date.now()}`,
                      beatLabel: "",
                      q1Pass: false,
                      q2Pass: false,
                      q3Pass: false,
                      oocFix: "",
                    },
                  ],
                },
              }))
            }
          >
            加 beat 行
          </Button>
          {wf.soul.rows.map((row, i) => (
            <Panel key={row.id} title={row.beatLabel || `Beat ${i + 1}`}>
              <label className="field">
                <span>情节</span>
                <input
                  className="input"
                  value={row.beatLabel}
                  onChange={(e) => {
                    const rows = [...wf.soul.rows];
                    rows[i] = { ...row, beatLabel: e.target.value };
                    setWf((s) => ({ ...s, soul: { ...s.soul, rows } }));
                  }}
                />
              </label>
              {(
                [
                  ["q1Pass", "Q1"],
                  ["q2Pass", "Q2"],
                  ["q3Pass", "Q3"],
                ] as const
              ).map(([k, l]) => (
                <label key={k} className="row" style={{ gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={row[k]}
                    onChange={(e) => {
                      const rows = [...wf.soul.rows];
                      rows[i] = { ...row, [k]: e.target.checked };
                      setWf((s) => ({ ...s, soul: { ...s.soul, rows } }));
                    }}
                  />
                  <span style={{ fontSize: 12 }}>{l} 通过</span>
                </label>
              ))}
              <label className="field">
                <span>OOC 改法</span>
                <input
                  className="input"
                  value={row.oocFix}
                  onChange={(e) => {
                    const rows = [...wf.soul.rows];
                    rows[i] = { ...row, oocFix: e.target.value };
                    setWf((s) => ({ ...s, soul: { ...s.soul, rows } }));
                  }}
                />
              </label>
            </Panel>
          ))}
        </div>
      )}
      {tab === "hand" && (
        <ShortFictionHandEdit12Panel projectId={projectId} wf={wf} setWf={setWf} />
      )}
      {tab === "submit" && (
        <div className="stack" style={{ gap: 8 }}>
          <Badge tone={sub.ok ? "ok" : "warn"}>{sub.message}</Badge>
          <Badge tone={fs.ok ? "ok" : "fail"}>{fs.message}</Badge>
          <label className="field">
            <span>字数</span>
            <input
              className="input"
              type="number"
              value={wf.submitGate.wordCount}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  submitGate: {
                    ...s.submitGate,
                    wordCount: Number(e.target.value) || 0,
                  },
                }))
              }
            />
          </label>
          {(
            [
              ["zhihuOverlongWarned", "已知晓知乎超长风险"],
              ["chapterTitlePlain", "章用一、二无副标题"],
              ["clearedStarsAndExtraLines", "已清***与多余空行"],
              ["oneHeroine", "1 女主"],
              ["oneHero", "1 男主"],
              ["hasVillain", "有反派"],
              ["extrasOk", "配角/龙套策略OK"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.submitGate[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    submitGate: { ...s.submitGate, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
          <Button
            size="sm"
            onClick={() =>
              setWf((s) => ({
                ...s,
                foreshadow: [
                  ...s.foreshadow,
                  { id: `f-${Date.now()}`, plant: "", recover: "", recovered: false },
                ],
              }))
            }
          >
            加伏笔
          </Button>
          {wf.foreshadow.map((item, i) => (
            <div key={item.id} className="field-grid">
              <label className="field">
                <span>埋</span>
                <input
                  className="input"
                  value={item.plant}
                  onChange={(e) => {
                    const foreshadow = [...wf.foreshadow];
                    foreshadow[i] = { ...item, plant: e.target.value };
                    setWf((s) => ({ ...s, foreshadow }));
                  }}
                />
              </label>
              <label className="field">
                <span>收</span>
                <input
                  className="input"
                  value={item.recover}
                  onChange={(e) => {
                    const foreshadow = [...wf.foreshadow];
                    foreshadow[i] = { ...item, recover: e.target.value };
                    setWf((s) => ({ ...s, foreshadow }));
                  }}
                />
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={item.recovered}
                  onChange={(e) => {
                    const foreshadow = [...wf.foreshadow];
                    foreshadow[i] = { ...item, recovered: e.target.checked };
                    setWf((s) => ({ ...s, foreshadow }));
                  }}
                />
                <span style={{ fontSize: 12 }}>已回收</span>
              </label>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
