/**
 * 九格基础课（4.md）深度工作台：
 * 期待感 1+3 · 冲突六要素 · 配对 · 爽点反推 · 开篇门禁 · AI 筛选分。
 * 不重复 2.md 拆书薄字段 / 3.md 换元七步 / 5.md 情绪节奏 / 6–7 打脸矩阵。
 */
import {
  CONFLICT_SIX_ELEMENT_IDS,
  CONFLICT_SIX_ELEMENT_LABELS,
  DEFAULT_EXPECTATION_REVISE_ITEMS,
  EXPECTATION_CONFLICT_CHECKPOINTS,
  GENERIC_ARC_PHASE_LABELS,
  SCREEN_SCORE_THRESHOLD,
  computeAiCandidateScreenScore,
  conflictSixCompleteness,
  expectation1Plus3Completeness,
  expectationConflictWorkflowCompleteness,
  pairingCompleteness,
  summarizeExpectationConflictToMaster,
  type AiCandidateScreenScore,
  type ConflictDesign,
  type ConflictSixElementId,
  type ExpectationConflictWorkflow,
  type ExpectationDesign1Plus3,
  type ExpectationHookUnit,
  type GenericArcPhase,
  type MasterOutlineBody,
  type SwapCandidate,
} from "@xiezuomanju/domain";
import { Badge, Button, CollapsibleSection, Panel, Tabs } from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useMemo, type Dispatch, type SetStateAction } from "react";
import { runAgentFeedback } from "./runAgentFeedback";
import { usePersistedState } from "./usePersistedState";

function emptyHook(partial?: Partial<ExpectationHookUnit>): ExpectationHookUnit {
  return {
    id: partial?.id ?? "",
    content: partial?.content ?? "",
    layer: partial?.layer ?? "small",
    span: partial?.span ?? "near",
    size: partial?.size ?? "small",
    horizon: partial?.horizon ?? "short",
    castAt: partial?.castAt ?? "",
    payoffAt: partial?.payoffAt ?? "",
    maxCharsHint: partial?.maxCharsHint ?? 1000,
    urgency: partial?.urgency ?? "",
    timeCrisis: partial?.timeCrisis ?? "",
    decayRisk: partial?.decayRisk ?? "none",
    decayRemedy: partial?.decayRemedy ?? "",
    status: partial?.status ?? "open",
  };
}

function emptyConflict(id = "c0"): ConflictDesign {
  return {
    id,
    oneLiner: "",
    kind: "hostile",
    locus: "external",
    targetPriority: "protagonist",
    opponentStrong: false,
    consequenceSevere: false,
    goalStrong: false,
    upgradeMode: "singleEvent",
    upgradeSteps: ["", "", ""],
    chainUnbroken: true,
    antiDeusEx: false,
    resolutionStyle: "",
    villainEnding: "undecided",
    noWinWin: true,
    passiveHive: true,
    six: {
      items: CONFLICT_SIX_ELEMENT_IDS.map((sid) => ({ id: sid, done: false, evidence: "" })),
    },
    linkedExpectationId: "",
  };
}

export function emptyExpectationConflict(): ExpectationConflictWorkflow {
  return {
    schemaVersion: "nines-4.md/1",
    synopsis: "",
    logline: "",
    design: {
      core: emptyHook({ id: "core", layer: "core", size: "big", span: "far", horizon: "long", maxCharsHint: 3000 }),
      small: [
        emptyHook({ id: "s1", maxCharsHint: 1000 }),
        emptyHook({ id: "s2", maxCharsHint: 1000 }),
        emptyHook({ id: "s3", maxCharsHint: 1000 }),
      ],
      openingRevealByChars: 3000,
      goldChapterChars: 500,
      farNearStrategy: "远期待打底、近期待拉满：大目标分解为子目标（升级/装备/队友）再落到具体获得。",
      subGoals: [],
      concreteGains: [],
      noSidePlot: true,
      midImmersionNote: "",
    },
    conflicts: [emptyConflict("c0")],
    pairing: {
      coreExpectationId: "core",
      coreConflictId: "c0",
      smallPairs: [
        { expectationId: "s1", conflictId: "", ok: false },
        { expectationId: "s2", conflictId: "", ok: false },
        { expectationId: "s3", conflictId: "", ok: false },
      ],
      note: "",
    },
    coolReverse: {
      coolPointFirst: "",
      fourStep: {
        pull: "",
        intensify: "",
        feint: "",
        overpay: "",
        emotionChain: { protagonist: "", antagonist: "", atmosphere: "" },
      },
      reverseHooks: [],
      reverseDone: false,
      appendedToForeshadow: false,
    },
    arc: {
      enabled: true,
      isReferenceNotStandard: true,
      phases: (["opening", "mid", "late", "ending"] as GenericArcPhase[]).map((phase) => ({
        phase,
        action: GENERIC_ARC_PHASE_LABELS[phase],
        done: false,
      })),
    },
    characterContrast: [],
    reviseChecklist: DEFAULT_EXPECTATION_REVISE_ITEMS.map((i) => ({ ...i })),
    currentStep: 1,
    notes: "",
  };
}

type EcCtl = {
  projectId?: string;
  wf?: ExpectationConflictWorkflow;
  setWf?: Dispatch<SetStateAction<ExpectationConflictWorkflow>>;
};

function useEcWf({ projectId, wf, setWf }: EcCtl) {
  const persisted = usePersistedState<ExpectationConflictWorkflow>(
    projectId,
    "expect-conflict-l4",
    emptyExpectationConflict(),
  );
  if (wf && setWf) return [wf, setWf] as const;
  return persisted;
}

function HookEditor({
  label,
  unit,
  onChange,
}: {
  label: string;
  unit: ExpectationHookUnit;
  onChange: (u: ExpectationHookUnit) => void;
}) {
  return (
    <div className="stack" style={{ gap: 6, padding: 8, border: "1px solid var(--border, #e8eae5)", borderRadius: 8 }}>
      <strong style={{ fontSize: 13 }}>{label}</strong>
      <label className="field">
        <span>内容</span>
        <textarea
          className="textarea"
          rows={2}
          value={unit.content}
          onChange={(e) => onChange({ ...unit, content: e.target.value })}
        />
      </label>
      <div className="field-grid">
        <label className="field">
          <span>近/远</span>
          <Select
            className="select"
            value={unit.span}
            onChange={(e) => onChange({ ...unit, span: e.target.value as ExpectationHookUnit["span"] })}
          >
            <option value="near">近期待</option>
            <option value="far">远期待</option>
          </Select>
        </label>
        <label className="field">
          <span>短/长</span>
          <Select
            className="select"
            value={unit.horizon}
            onChange={(e) => onChange({ ...unit, horizon: e.target.value as ExpectationHookUnit["horizon"] })}
          >
            <option value="short">短期</option>
            <option value="long">长期</option>
          </Select>
        </label>
        <label className="field">
          <span>抛钩位置</span>
          <input className="input" value={unit.castAt} onChange={(e) => onChange({ ...unit, castAt: e.target.value })} />
        </label>
        <label className="field">
          <span>收钩位置</span>
          <input
            className="input"
            value={unit.payoffAt}
            onChange={(e) => onChange({ ...unit, payoffAt: e.target.value })}
          />
        </label>
        <label className="field">
          <span>字数上限提示</span>
          <input
            className="input"
            type="number"
            value={unit.maxCharsHint}
            onChange={(e) => onChange({ ...unit, maxCharsHint: Number(e.target.value) || 1000 })}
          />
        </label>
        <label className="field">
          <span>紧迫度</span>
          <input className="input" value={unit.urgency} onChange={(e) => onChange({ ...unit, urgency: e.target.value })} />
        </label>
        <label className="field">
          <span>时间/危机</span>
          <input
            className="input"
            value={unit.timeCrisis}
            onChange={(e) => onChange({ ...unit, timeCrisis: e.target.value })}
            placeholder="如 24 小时内"
          />
        </label>
        <label className="field">
          <span>递减风险</span>
          <Select
            className="select"
            value={unit.decayRisk}
            onChange={(e) => onChange({ ...unit, decayRisk: e.target.value as ExpectationHookUnit["decayRisk"] })}
          >
            <option value="none">无</option>
            <option value="forget">远期待遗忘</option>
            <option value="delay">近期待拖久</option>
            <option value="fatigue">同题材腻</option>
          </Select>
        </label>
        <label className="field">
          <span>状态</span>
          <Select
            className="select"
            value={unit.status}
            onChange={(e) => onChange({ ...unit, status: e.target.value as ExpectationHookUnit["status"] })}
          >
            <option value="open">未收（open）</option>
            <option value="paid">已收（paid）</option>
          </Select>
        </label>
      </div>
      {unit.decayRisk !== "none" && (
        <label className="field">
          <span>递减补救</span>
          <input
            className="input"
            value={unit.decayRemedy}
            onChange={(e) => onChange({ ...unit, decayRemedy: e.target.value })}
            placeholder="反复拉远期待 / 加快近期待收钩 / 换小方案"
          />
        </label>
      )}
    </div>
  );
}

/* ═══════════════ 1+3 ═══════════════ */

export function Expectation1Plus3Panel(props: EcCtl) {
  const [wf, setWf] = useEcWf(props);
  const score = expectation1Plus3Completeness(wf.design);
  const setDesign = (patch: Partial<ExpectationDesign1Plus3> | ((d: ExpectationDesign1Plus3) => ExpectationDesign1Plus3)) =>
    setWf((s) => ({
      ...s,
      design: typeof patch === "function" ? patch(s.design) : { ...s.design, ...patch },
    }));

  return (
    <CollapsibleSection
      title="期待感 1+3（核心 + 三小钩）"
      storageKey={props.projectId ? `nines4-${props.projectId}-1p3` : undefined}
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        薄字段 big/small 仍在拆书 11 项；此处是 4.md 设计态。小期待 ≤1000 字快抛快收；短篇禁支线。
      </p>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <Badge>
          完成 {score.filled}/{score.total}（{score.pct}%）· 小钩 {score.smallSlotCount}/3
        </Badge>
        {score.missing.length > 0 && <Badge tone="warn">缺：{score.missing.join("、")}</Badge>}
      </div>
      <HookEditor
        label="核心期待（1）"
        unit={wf.design.core}
        onChange={(core) => setDesign({ core: { ...core, id: core.id || "core", layer: "core" } })}
      />
      {wf.design.small.map((u, i) => (
        <HookEditor
          key={u.id || i}
          label={`小期待 ${i + 1}/3`}
          unit={u}
          onChange={(next) =>
            setDesign((d) => ({
              ...d,
              small: d.small.map((x, j) => (j === i ? { ...next, id: next.id || `s${i + 1}`, layer: "small" } : x)),
            }))
          }
        />
      ))}
      <label className="field">
        <span>远近策略</span>
        <textarea
          className="textarea"
          rows={2}
          value={wf.design.farNearStrategy}
          onChange={(e) => setDesign({ farNearStrategy: e.target.value })}
        />
      </label>
      <label className="field">
        <span>子目标（顿号分隔）</span>
        <input
          className="input"
          value={wf.design.subGoals.join("、")}
          onChange={(e) =>
            setDesign({
              subGoals: e.target.value
                .split(/[、,，]/)
                .map((x) => x.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
      <label className="field">
        <span>具体获得（中期代入期待）</span>
        <input
          className="input"
          value={wf.design.concreteGains.join("、")}
          onChange={(e) =>
            setDesign({
              concreteGains: e.target.value
                .split(/[、,，]/)
                .map((x) => x.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
      <label className="row" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={wf.design.noSidePlot}
          onChange={(e) => setDesign({ noSidePlot: e.target.checked })}
        />
        <span style={{ fontSize: 12 }}>短篇禁支线（所有情节围绕核心期待）</span>
      </label>
    </CollapsibleSection>
  );
}

/* ═══════════════ 六要素 + 升级 ═══════════════ */

export function ConflictSixElementsWorkbench(props: EcCtl) {
  const [wf, setWf] = useEcWf(props);
  const conflict = wf.conflicts[0] ?? emptyConflict();
  const six = conflictSixCompleteness(conflict);

  const patchConflict = (patch: Partial<ConflictDesign>) =>
    setWf((s) => {
      const list = s.conflicts.length ? s.conflicts : [emptyConflict()];
      return {
        ...s,
        conflicts: list.map((c, i) => (i === 0 ? { ...c, ...patch } : c)),
      };
    });

  return (
    <CollapsibleSection
      title="冲突六要素 + 升级路径"
      storageKey={props.projectId ? `nines4-${props.projectId}-six` : undefined}
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        口诀：冲主角，必绝路，层层升级，别断步，先爽正三观，老套路也能出爆款。六要素未齐不可标完成。
      </p>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <Badge tone={six.complete ? "ok" : "warn"}>
          六要素 {six.filled}/{six.total}
        </Badge>
        {!six.complete && <Badge tone="fail">缺：{six.missing.join("、")}</Badge>}
      </div>
      <label className="field">
        <span>核心矛盾一句话</span>
        <textarea
          className="textarea"
          rows={2}
          value={conflict.oneLiner}
          onChange={(e) => patchConflict({ oneLiner: e.target.value })}
        />
      </label>
      <div className="field-grid">
        <label className="field">
          <span>类型</span>
          <Select
            className="select"
            value={conflict.kind}
            onChange={(e) => patchConflict({ kind: e.target.value as ConflictDesign["kind"] })}
          >
            <option value="hostile">敌对型</option>
            <option value="compete">竞争型</option>
          </Select>
        </label>
        <label className="field">
          <span>内/外</span>
          <Select
            className="select"
            value={conflict.locus}
            onChange={(e) => patchConflict({ locus: e.target.value as ConflictDesign["locus"] })}
          >
            <option value="external">外部（网文主）</option>
            <option value="internal">内部</option>
          </Select>
        </label>
        <label className="field">
          <span>冲谁</span>
          <Select
            className="select"
            value={conflict.targetPriority}
            onChange={(e) =>
              patchConflict({ targetPriority: e.target.value as ConflictDesign["targetPriority"] })
            }
          >
            <option value="protagonist">主角</option>
            <option value="importantOther">主角重要的人</option>
          </Select>
        </label>
        <label className="field">
          <span>升级方式</span>
          <Select
            className="select"
            value={conflict.upgradeMode}
            onChange={(e) =>
              patchConflict({ upgradeMode: e.target.value as ConflictDesign["upgradeMode"] })
            }
          >
            <option value="singleEvent">单事件升级</option>
            <option value="multiEvent">多事件升级</option>
          </Select>
        </label>
        <label className="field">
          <span>反派收尾</span>
          <Select
            className="select"
            value={conflict.villainEnding}
            onChange={(e) =>
              patchConflict({ villainEnding: e.target.value as ConflictDesign["villainEnding"] })
            }
          >
            <option value="undecided">未定</option>
            <option value="yield">彻底服软</option>
            <option value="dead">死</option>
            <option value="prison">进监狱</option>
          </Select>
        </label>
      </div>
      <div className="row" style={{ gap: 12, flexWrap: "wrap", fontSize: 12 }}>
        {(
          [
            ["opponentStrong", "对手很强"],
            ["consequenceSevere", "后果严重"],
            ["goalStrong", "主角目标强"],
            ["chainUnbroken", "升级链条不断"],
            ["antiDeusEx", "已防机械降神"],
            ["noWinWin", "禁合作共赢"],
            ["passiveHive", "被动捅马蜂窝"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="row" style={{ gap: 4 }}>
            <input
              type="checkbox"
              checked={Boolean(conflict[key])}
              onChange={(e) => patchConflict({ [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="stack" style={{ gap: 6, marginTop: 8 }}>
        <strong style={{ fontSize: 13 }}>六要素勾选 + 证据</strong>
        {CONFLICT_SIX_ELEMENT_IDS.map((id) => {
          const item = conflict.six.items.find((x) => x.id === id) ?? {
            id,
            done: false,
            evidence: "",
          };
          return (
            <div key={id} className="row" style={{ gap: 8, alignItems: "flex-start" }}>
              <label className="row" style={{ gap: 4, minWidth: 160 }}>
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={(e) =>
                    patchConflict({
                      six: {
                        items: CONFLICT_SIX_ELEMENT_IDS.map((sid) => {
                          const cur = conflict.six.items.find((x) => x.id === sid) ?? {
                            id: sid,
                            done: false,
                            evidence: "",
                          };
                          return sid === id ? { ...cur, done: e.target.checked } : cur;
                        }),
                      },
                    })
                  }
                />
                <span style={{ fontSize: 12 }}>{CONFLICT_SIX_ELEMENT_LABELS[id as ConflictSixElementId]}</span>
              </label>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="证据/补强"
                value={item.evidence}
                onChange={(e) =>
                  patchConflict({
                    six: {
                      items: CONFLICT_SIX_ELEMENT_IDS.map((sid) => {
                        const cur = conflict.six.items.find((x) => x.id === sid) ?? {
                          id: sid,
                          done: false,
                          evidence: "",
                        };
                        return sid === id ? { ...cur, evidence: e.target.value } : cur;
                      }),
                    },
                  })
                }
              />
            </div>
          );
        })}
      </div>
      <div className="stack" style={{ marginTop: 8, gap: 6 }}>
        <strong style={{ fontSize: 13 }}>升级步骤（2～3 级，中间不穿插无关事件）</strong>
        {(conflict.upgradeSteps.length ? conflict.upgradeSteps : ["", "", ""]).map((step, i) => (
          <input
            key={i}
            className="input"
            placeholder={`第 ${i + 1} 级升级`}
            value={step}
            onChange={(e) => {
              const upgradeSteps = [...(conflict.upgradeSteps.length ? conflict.upgradeSteps : ["", "", ""])];
              upgradeSteps[i] = e.target.value;
              patchConflict({ upgradeSteps });
            }}
          />
        ))}
      </div>
      <label className="field" style={{ marginTop: 8 }}>
        <span>解决方式（先爽 + 三观正）</span>
        <textarea
          className="textarea"
          rows={2}
          value={conflict.resolutionStyle}
          onChange={(e) => patchConflict({ resolutionStyle: e.target.value })}
        />
      </label>
      {!six.complete && (
        <div style={{ marginTop: 8 }}>
          <Badge tone="fail">六要素未齐，不可标「冲突设计完成」</Badge>
        </div>
      )}
    </CollapsibleSection>
  );
}

/* ═══════════════ 配对 ═══════════════ */

export function ExpectationConflictPairingPanel(props: EcCtl) {
  const [wf, setWf] = useEcWf(props);
  const pair = pairingCompleteness(wf.pairing);

  return (
    <CollapsibleSection
      title="期待 ↔ 矛盾一一配对"
      storageKey={props.projectId ? `nines4-${props.projectId}-pair` : undefined}
    >
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        {pair.complete ? <Badge tone="ok">配对完成</Badge> : <Badge tone="fail">缺：{pair.missing.join("、")}</Badge>}
      </div>
      <div className="field-grid">
        <label className="field">
          <span>核心期待 id</span>
          <input
            className="input"
            value={wf.pairing.coreExpectationId}
            onChange={(e) => setWf((s) => ({ ...s, pairing: { ...s.pairing, coreExpectationId: e.target.value } }))}
          />
        </label>
        <label className="field">
          <span>核心矛盾 id</span>
          <input
            className="input"
            value={wf.pairing.coreConflictId}
            onChange={(e) => setWf((s) => ({ ...s, pairing: { ...s.pairing, coreConflictId: e.target.value } }))}
          />
        </label>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>小期待 id</th>
            <th>矛盾 ABC id</th>
            <th>OK</th>
          </tr>
        </thead>
        <tbody>
          {wf.pairing.smallPairs.map((p, i) => (
            <tr key={i}>
              <td>
                <input
                  className="input"
                  value={p.expectationId}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      pairing: {
                        ...s.pairing,
                        smallPairs: s.pairing.smallPairs.map((x, j) =>
                          j === i ? { ...x, expectationId: e.target.value } : x,
                        ),
                      },
                    }))
                  }
                />
              </td>
              <td>
                <input
                  className="input"
                  value={p.conflictId}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      pairing: {
                        ...s.pairing,
                        smallPairs: s.pairing.smallPairs.map((x, j) =>
                          j === i ? { ...x, conflictId: e.target.value } : x,
                        ),
                      },
                    }))
                  }
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={p.ok || Boolean(p.expectationId && p.conflictId)}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      pairing: {
                        ...s.pairing,
                        smallPairs: s.pairing.smallPairs.map((x, j) =>
                          j === i ? { ...x, ok: e.target.checked } : x,
                        ),
                      },
                    }))
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: 12 }}>
        核心期待「{wf.design.core.content || "未填"}」↔ 核心矛盾「{wf.conflicts[0]?.oneLiner || "未填"}」
      </p>
    </CollapsibleSection>
  );
}

/* ═══════════════ 爽点反推 ═══════════════ */

export function CoolPointReverseWorkbench({
  projectId,
  wf: wfProp,
  setWf: setWfProp,
  onAppendForeshadow,
}: EcCtl & {
  onAppendForeshadow?: (rows: { bury: string; hook: string; payoff: string; status: string }[]) => void;
}) {
  const [wf, setWf] = useEcWf({ projectId, wf: wfProp, setWf: setWfProp });
  const score = expectationConflictWorkflowCompleteness(wf);
  const cr = wf.coolReverse;

  return (
    <CollapsibleSection
      title="爽点四步法 → 反推钩子"
      storageKey={projectId ? `nines4-${projectId}-cool` : undefined}
      actions={
        <Button
          size="sm"
          disabled={!projectId}
          onClick={() =>
            projectId &&
            void runAgentFeedback(projectId, "struct.expectation", {
              label: "期待感诊断",
              inputJson: {
                design: wf.design,
                conflicts: wf.conflicts,
                coolReverse: wf.coolReverse,
              },
            })
          }
        >
          期待感诊断
        </Button>
      }
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        先定爽点再埋钩子（反向思维）。未填爽点不可标反推完成。三类情绪链属本讲附属，非 5.md 情绪曲线。
      </p>
      <label className="field">
        <span>爽点（先写）</span>
        <textarea
          className="textarea"
          rows={2}
          value={cr.coolPointFirst}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              coolReverse: { ...s.coolReverse, coolPointFirst: e.target.value, reverseDone: false },
            }))
          }
        />
      </label>
      <div className="field-grid">
        {(
          [
            ["pull", "① 拉期待"],
            ["intensify", "② 强化期待"],
            ["feint", "③ 虚晃一枪"],
            ["overpay", "④ 超额满足"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="field" style={{ gridColumn: "1 / -1" }}>
            <span>{label}</span>
            <input
              className="input"
              value={cr.fourStep[key]}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  coolReverse: {
                    ...s.coolReverse,
                    fourStep: { ...s.coolReverse.fourStep, [key]: e.target.value },
                  },
                }))
              }
            />
          </label>
        ))}
      </div>
      <strong style={{ fontSize: 13 }}>三类情绪链</strong>
      <div className="field-grid">
        {(
          [
            ["protagonist", "主角反应"],
            ["antagonist", "反派反应"],
            ["atmosphere", "气氛组反应"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="field">
            <span>{label}</span>
            <input
              className="input"
              value={cr.fourStep.emotionChain[key]}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  coolReverse: {
                    ...s.coolReverse,
                    fourStep: {
                      ...s.coolReverse.fourStep,
                      emotionChain: {
                        ...s.coolReverse.fourStep.emotionChain,
                        [key]: e.target.value,
                      },
                    },
                  },
                }))
              }
            />
          </label>
        ))}
      </div>
      <table className="table" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>反推钩子</th>
            <th>埋点</th>
            <th>回收</th>
            <th>关联期待</th>
          </tr>
        </thead>
        <tbody>
          {cr.reverseHooks.map((h, i) => (
            <tr key={i}>
              {(["hook", "buryAt", "payoffAt", "linkedExpectationId"] as const).map((k) => (
                <td key={k}>
                  <input
                    className="input"
                    value={h[k]}
                    onChange={(e) =>
                      setWf((s) => ({
                        ...s,
                        coolReverse: {
                          ...s.coolReverse,
                          reverseHooks: s.coolReverse.reverseHooks.map((x, j) =>
                            j === i ? { ...x, [k]: e.target.value } : x,
                          ),
                        },
                      }))
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <Button
          size="sm"
          onClick={() =>
            setWf((s) => ({
              ...s,
              coolReverse: {
                ...s.coolReverse,
                reverseHooks: [
                  ...s.coolReverse.reverseHooks,
                  { hook: "", buryAt: "", payoffAt: "", linkedExpectationId: "" },
                ],
              },
            }))
          }
        >
          加钩子行
        </Button>
        <label className="row" style={{ gap: 4, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={cr.reverseDone}
            disabled={!score.canMarkReverseDone}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                coolReverse: { ...s.coolReverse, reverseDone: e.target.checked },
              }))
            }
          />
          反推完成{!score.canMarkReverseDone ? "（须先填爽点）" : ""}
        </label>
        <Button
          size="sm"
          disabled={!cr.reverseHooks.length}
          onClick={() => {
            onAppendForeshadow?.(
              cr.reverseHooks.map((h) => ({
                bury: h.buryAt,
                hook: h.hook,
                payoff: h.payoffAt,
                status: "open",
              })),
            );
            setWf((s) => ({
              ...s,
              coolReverse: { ...s.coolReverse, appendedToForeshadow: true },
            }));
          }}
        >
          追加到伏笔台账
        </Button>
        {cr.appendedToForeshadow && <Badge tone="ok">已标记追加</Badge>}
      </div>
    </CollapsibleSection>
  );
}

/* ═══════════════ 开篇门禁 + 通用架构 ═══════════════ */

export function GenericArcHintPanel(props: EcCtl) {
  const [wf, setWf] = useEcWf(props);
  return (
    <CollapsibleSection
      title="通用架构（参考答案，非标准答案）"
      storageKey={props.projectId ? `nines4-${props.projectId}-arc` : undefined}
    >
      <label className="row" style={{ gap: 6, marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={wf.arc.enabled}
          onChange={(e) => setWf((s) => ({ ...s, arc: { ...s.arc, enabled: e.target.checked } }))}
        />
        <span style={{ fontSize: 12 }}>启用四阶段参考架构</span>
      </label>
      {wf.arc.phases.map((p, i) => (
        <label key={p.phase} className="row" style={{ gap: 8, marginBottom: 6, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={p.done}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                arc: {
                  ...s.arc,
                  phases: s.arc.phases.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)),
                },
              }))
            }
          />
          <span>{GENERIC_ARC_PHASE_LABELS[p.phase]}</span>
        </label>
      ))}
    </CollapsibleSection>
  );
}

export function OpeningGatePanel(props: EcCtl) {
  const [wf, setWf] = useEcWf(props);
  const okReveal =
    wf.design.openingRevealByChars >= 2000 && wf.design.openingRevealByChars <= 3000;
  const okGold = wf.design.goldChapterChars >= 300 && wf.design.goldChapterChars <= 500;

  return (
    <CollapsibleSection
      title="开篇门禁（黄金一章）"
      storageKey={props.projectId ? `nines4-${props.projectId}-open` : undefined}
    >
      <div className="field-grid">
        <label className="field">
          <span>亮核心期待字数上限（2000～3000）</span>
          <input
            className="input"
            type="number"
            value={wf.design.openingRevealByChars}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                design: { ...s.design, openingRevealByChars: Number(e.target.value) || 3000 },
              }))
            }
          />
          {!okReveal && <Badge tone="fail">须在 2000～3000</Badge>}
        </label>
        <label className="field">
          <span>黄金一章字数（300～500）</span>
          <input
            className="input"
            type="number"
            value={wf.design.goldChapterChars}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                design: { ...s.design, goldChapterChars: Number(e.target.value) || 500 },
              }))
            }
          />
          {!okGold && <Badge tone="fail">须在 300～500</Badge>}
        </label>
      </div>
      <label className="field">
        <span>中期代入期待备注</span>
        <textarea
          className="textarea"
          rows={2}
          value={wf.design.midImmersionNote}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              design: { ...s.design, midImmersionNote: e.target.value },
            }))
          }
          placeholder="中期落地到具体获得（武器/盔甲/队友），勿只喊远期待"
        />
      </label>
    </CollapsibleSection>
  );
}

/* ═══════════════ 改稿清单 ═══════════════ */

export function ExpectationReviseChecklist(props: EcCtl) {
  const [wf, setWf] = useEcWf(props);
  const done = wf.reviseChecklist.filter((i) => i.done).length;

  return (
    <CollapsibleSection
      title="改稿清单（期待感 + 矛盾）"
      storageKey={props.projectId ? `nines4-${props.projectId}-revise` : undefined}
    >
      <Badge>
        {done}/{wf.reviseChecklist.length}
      </Badge>
      <div className="stack" style={{ gap: 6, marginTop: 8 }}>
        {wf.reviseChecklist.map((item, i) => (
          <label key={item.id} className="row" style={{ gap: 8, alignItems: "flex-start", fontSize: 12 }}>
            <input
              type="checkbox"
              checked={item.done}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  reviseChecklist: s.reviseChecklist.map((x, j) =>
                    j === i ? { ...x, done: e.target.checked } : x,
                  ),
                }))
              }
            />
            <span style={{ flex: 1 }}>{item.label}</span>
            <input
              className="input"
              style={{ maxWidth: 200 }}
              placeholder="备注"
              value={item.note}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  reviseChecklist: s.reviseChecklist.map((x, j) =>
                    j === i ? { ...x, note: e.target.value } : x,
                  ),
                }))
              }
            />
          </label>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 11 }}>
        Tip：漫剧过稿约一成；中期崩多因代入期待缺失。魔改≠改（IP 经验仅提示，完整流水线更高课次）。
      </p>
    </CollapsibleSection>
  );
}

/* ═══════════════ AI 筛选分（嵌入换元候选） ═══════════════ */

const SCREEN_FLAGS: { key: keyof Omit<AiCandidateScreenScore, "total" | "lowScoreWarned" | "note">; label: string }[] = [
  { key: "expectClear", label: "核心期待清晰" },
  { key: "expect1Plus3", label: "有 1+3" },
  { key: "expectUrgency", label: "时间紧迫" },
  { key: "expectEnding", label: "结尾可见" },
  { key: "conflictHitsProtagonist", label: "冲突冲主角" },
  { key: "conflictDeadEnd", label: "逼上绝路" },
  { key: "conflictEscalates", label: "层层递进" },
];

export function AiCandidateScreenPanel({
  candidate,
  onChange,
}: {
  candidate: SwapCandidate;
  onChange: (score: AiCandidateScreenScore) => void;
}) {
  const score =
    candidate.screenScore ??
    computeAiCandidateScreenScore({
      expectClear: false,
      expect1Plus3: false,
      expectUrgency: false,
      expectEnding: false,
      conflictHitsProtagonist: false,
      conflictDeadEnd: false,
      conflictEscalates: false,
      note: "",
    });

  return (
    <div
      className="stack"
      style={{ gap: 4, marginTop: 6, padding: 8, background: "var(--surface-2, #f1f2ef)", borderRadius: 6 }}
    >
      <div className="row" style={{ gap: 8 }}>
        <Badge tone={score.lowScoreWarned ? "warn" : "ok"}>
          筛选分 {score.total}/7（门槛 {SCREEN_SCORE_THRESHOLD}）
        </Badge>
        {score.lowScoreWarned && <Badge tone="fail">低分告警：仍可选手选，但风险高</Badge>}
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 8, fontSize: 12 }}>
        {SCREEN_FLAGS.map(({ key, label }) => (
          <label key={key} className="row" style={{ gap: 4 }}>
            <input
              type="checkbox"
              checked={Boolean(score[key])}
              onChange={(e) =>
                onChange(
                  computeAiCandidateScreenScore({
                    ...score,
                    [key]: e.target.checked,
                  }),
                )
              }
            />
            {label}
          </label>
        ))}
      </div>
      <input
        className="input"
        placeholder="筛选备注"
        value={score.note}
        onChange={(e) => onChange(computeAiCandidateScreenScore({ ...score, note: e.target.value }))}
      />
    </div>
  );
}

/* ═══════════════ 九步主台 ═══════════════ */

export function ExpectationConflictWorkbench({
  projectId,
  onSyncMaster,
}: {
  projectId?: string;
  onSyncMaster?: (thin: ReturnType<typeof summarizeExpectationConflictToMaster>) => void;
}) {
  const [wf, setWf] = useEcWf({ projectId });
  const score = useMemo(() => expectationConflictWorkflowCompleteness(wf), [wf]);
  const [tab, setTab] = usePersistedState(projectId, "ec-l4-tab", "overview");

  const syncThin = () => {
    const thin = summarizeExpectationConflictToMaster(wf);
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
      title="期待感 + 矛盾（4.md 九步）"
      actions={
        <div className="row" style={{ gap: 6 }}>
          <Badge>
            步骤完成 {score.filledSteps}/{score.totalSteps}
          </Badge>
          <Button size="sm" onClick={syncThin}>
            回写总纲薄字段
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!projectId}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "struct.expectation", {
                label: "struct.expectation",
                inputJson: wf,
              })
            }
          >
            跑诊断 Agent
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        故事梗概阶段定生死。复用拆书/换元产物，不重建 11 项与换元七步。情绪写法与节奏四维见
        NinesLesson5Panels（5.md），本课三类情绪链仅为爽点附属。
      </p>
      {score.missing.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Badge tone="warn">未完成：{score.missing.join("、")}</Badge>
        </div>
      )}
      <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {EXPECTATION_CONFLICT_CHECKPOINTS.map((cp, i) => (
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
      <div className="stack" style={{ gap: 8, marginBottom: 12 }}>
        <label className="field">
          <span>一句话 / 故事梗概</span>
          <textarea
            className="textarea"
            rows={2}
            value={wf.synopsis}
            onChange={(e) => setWf((s) => ({ ...s, synopsis: e.target.value }))}
          />
        </label>
        <label className="field">
          <span>Logline</span>
          <input
            className="input"
            value={wf.logline}
            onChange={(e) => setWf((s) => ({ ...s, logline: e.target.value }))}
          />
        </label>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "总览" },
          { id: "expect", label: "1+3" },
          { id: "conflict", label: "六要素" },
          { id: "pair", label: "配对" },
          { id: "cool", label: "爽点反推" },
          { id: "opening", label: "开篇·架构" },
          { id: "revise", label: "改稿" },
        ]}
      />
      {tab === "overview" && (
        <div className="stack" style={{ marginTop: 10, gap: 8 }}>
          {EXPECTATION_CONFLICT_CHECKPOINTS.map((cp) => (
            <div key={cp.id} style={{ fontSize: 12, padding: 8, borderLeft: "3px solid var(--border, #ddd)" }}>
              <strong>{cp.label}</strong>
              <div className="muted">你：{cp.userAction}</div>
              <div className="muted">AI：{cp.aiAction}</div>
              <div className="muted">展示：{cp.displayFields.join(", ")}</div>
            </div>
          ))}
        </div>
      )}
      {tab === "expect" && <Expectation1Plus3Panel projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "conflict" && <ConflictSixElementsWorkbench projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "pair" && <ExpectationConflictPairingPanel projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "cool" && <CoolPointReverseWorkbench projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "opening" && (
        <div className="stack">
          <OpeningGatePanel projectId={projectId} wf={wf} setWf={setWf} />
          <GenericArcHintPanel projectId={projectId} wf={wf} setWf={setWf} />
        </div>
      )}
      {tab === "revise" && <ExpectationReviseChecklist projectId={projectId} wf={wf} setWf={setWf} />}
    </Panel>
  );
}

/** 拆书 Tab 内嵌：期待感设计态（不新增第 12 项） */
export function DissectExpectationDesignInline({
  design,
  onChange,
  big,
  small,
  onThinChange,
}: {
  design?: ExpectationDesign1Plus3;
  onChange: (d: ExpectationDesign1Plus3) => void;
  big: string;
  small: string[];
  onThinChange: (big: string, small: string[]) => void;
}) {
  const [open, setOpen] = usePersistedState(undefined, "dissect-expect-design", false);
  const d = design ?? emptyExpectationConflict().design;

  return (
    <div className="stack" style={{ gap: 8 }}>
      <label className="field">
        <span>大期待（薄字段）</span>
        <textarea
          className="textarea"
          rows={2}
          value={big}
          onChange={(e) => onThinChange(e.target.value, small)}
        />
      </label>
      <label className="field">
        <span>小期待（薄字段，顿号分隔）</span>
        <textarea
          className="textarea"
          rows={2}
          value={small.join("、")}
          onChange={(e) =>
            onThinChange(
              big,
              e.target.value
                .split(/[、,，]/)
                .map((x) => x.trim())
                .filter(Boolean),
            )
          }
        />
      </label>
      <Button size="sm" onClick={() => setOpen((v) => !v)}>
        {open ? "收起" : "展开"} 4.md 设计态（抛钩/收钩/递减）
      </Button>
      {open && (
        <Expectation1Plus3Panel
          wf={{
            ...emptyExpectationConflict(),
            design: {
              ...d,
              core: { ...d.core, content: d.core.content || big },
              small: d.small.map((s, i) => ({
                ...s,
                content: s.content || small[i] || "",
              })),
            },
          }}
          setWf={(updater) => {
            const next =
              typeof updater === "function"
                ? updater({ ...emptyExpectationConflict(), design: d })
                : updater;
            onChange(next.design);
            onThinChange(
              next.design.core.content,
              next.design.small.map((s) => s.content).filter(Boolean),
            );
          }}
        />
      )}
    </div>
  );
}

export type { MasterOutlineBody };
