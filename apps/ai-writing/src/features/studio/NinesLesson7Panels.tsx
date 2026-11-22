/**
 * 九格 7.md 深度工作台：爽点设计进阶（马斯洛 12 套路 + 装逼打脸三阶 + 代入感）。
 * 完整装逼打脸细节见 NinesLesson6Panels.CoolFaceSlapWorkbench；本面板聚焦「12 套路选型 + 细则勾选 + 缺口—满足」。
 */
import {
  COOL12_TROPE_IDS,
  COOL12_TROPE_META,
  MASLOW_NEED_LABELS,
  buildTropeRecipeChecks,
  cool12PlanCompleteness,
  type Cool12TropeId,
  type MaslowCool12Plan,
} from "@xiezuomanju/domain";
import { Badge, CollapsibleSection, Panel } from "@xiezuomanju/ui";
import { useMemo } from "react";
import { usePersistedState } from "./usePersistedState";

const NEED_IDS = Object.keys(MASLOW_NEED_LABELS) as Array<keyof typeof MASLOW_NEED_LABELS>;

function emptyPlan(): MaslowCool12Plan {
  return {
    schemaVersion: undefined as never,
    primaryNeed: "esteem",
    tropeIds: [],
    coreTropeId: undefined,
    multiStackNote: "多梗叠加，禁止单一套路；可循环叠加核心梗。",
    chapterMapping: [],
    eroticEdgeBlocked: true,
    needGap: "",
    satisfyBeat: "",
    rewardUpgrade: "",
    channelNote: "",
    tropeRecipeChecks: [],
  } as unknown as MaslowCool12Plan;
}

export function MaslowCool12Workbench({ projectId }: { projectId?: string }) {
  const [plan, setPlan] = usePersistedState<MaslowCool12Plan>(
    projectId,
    "cool12-maslow",
    emptyPlan(),
  );

  const toggleTrope = (id: Cool12TropeId) => {
    setPlan((p) => {
      const has = p.tropeIds.includes(id);
      const tropeIds = has ? p.tropeIds.filter((x) => x !== id) : [...p.tropeIds, id];
      const tropeRecipeChecks = has
        ? p.tropeRecipeChecks.filter((c) => c.tropeId !== id)
        : [...p.tropeRecipeChecks, buildTropeRecipeChecks(id)];
      return {
        ...p,
        tropeIds,
        coreTropeId: has && p.coreTropeId === id ? undefined : p.coreTropeId,
        tropeRecipeChecks,
      };
    });
  };

  const toggleRecipe = (tropeId: Cool12TropeId, itemId: string) => {
    setPlan((p) => ({
      ...p,
      tropeRecipeChecks: p.tropeRecipeChecks.map((c) =>
        c.tropeId === tropeId
          ? {
              ...c,
              items: c.items.map((it) =>
                it.id === itemId ? { ...it, done: !it.done } : it,
              ),
            }
          : c,
      ),
    }));
  };

  const completeness = useMemo(() => cool12PlanCompleteness(plan), [plan]);

  return (
    <CollapsibleSection
      title="爽点进阶 · 马斯洛 12 套路（7.md）"
      badge={`${completeness.pct}%`}
      summary="先缺口（虐/压抑）再满足（爽/释放）；多梗叠加≥2；生理套路禁擦边"
      storageKey={projectId ? `deliverable-${projectId}-cool12` : undefined}
      defaultOpen={false}
    >
      <Panel title="马斯洛五层需求 → 十二套路">
        <div className="stack" style={{ gap: 8 }}>
          {NEED_IDS.map((need) => (
            <div key={need} className="row" style={{ alignItems: "flex-start", gap: 8 }}>
              <Badge>{MASLOW_NEED_LABELS[need]}</Badge>
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                {COOL12_TROPE_IDS.filter((t) => COOL12_TROPE_META[t].need === need).map((t) => {
                  const meta = COOL12_TROPE_META[t];
                  const on = plan.tropeIds.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      className="badge"
                      onClick={() => toggleTrope(t)}
                      title={`${meta.index}. ${meta.label}`}
                      style={{
                        cursor: "pointer",
                        borderColor: on ? "var(--accent)" : undefined,
                        background: on ? "var(--accent-soft)" : undefined,
                        opacity: on ? 1 : 0.6,
                      }}
                    >
                      {meta.index}. {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="缺口—满足（先虐后爽）">
        <div className="field-grid">
          <div className="field">
            <label>缺口 / 压抑（虐）</label>
            <input
              className="input"
              value={plan.needGap}
              onChange={(e) => setPlan((p) => ({ ...p, needGap: e.target.value }))}
              placeholder="如：被家族羞辱、资源被夺、无路可退"
            />
          </div>
          <div className="field">
            <label>满足 / 释放（爽）</label>
            <input
              className="input"
              value={plan.satisfyBeat}
              onChange={(e) => setPlan((p) => ({ ...p, satisfyBeat: e.target.value }))}
              placeholder="如：当众反杀、身份揭露、超额兑现"
            />
          </div>
        </div>
        <div className="field" style={{ marginTop: 8 }}>
          <label>危机后奖励 / 二次升级（可选）</label>
          <input
            className="input"
            value={plan.rewardUpgrade}
            onChange={(e) => setPlan((p) => ({ ...p, rewardUpgrade: e.target.value }))}
            placeholder="如：脱险后获得神器，再掀一层爽点"
          />
        </div>
        {completeness.missing.length > 0 && (
          <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>
            待补：{completeness.missing.join("、")}
          </div>
        )}
      </Panel>

      {plan.tropeIds.length > 0 && (
        <Panel title="套路细则勾选">
          <div className="stack" style={{ gap: 12 }}>
            {plan.tropeIds.map((t) => {
              const check = plan.tropeRecipeChecks.find((c) => c.tropeId === t);
              const items = check?.items ?? [];
              const done = items.filter((x) => x.done).length;
              return (
                <div key={t} className="stack" style={{ gap: 6 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong style={{ fontSize: 13 }}>
                      {COOL12_TROPE_META[t].index}. {COOL12_TROPE_META[t].label}
                    </strong>
                    <span className="faint" style={{ fontSize: 12 }}>
                      {done}/{items.length}
                    </span>
                  </div>
                  {items.map((it) => (
                    <label key={it.id} className="row" style={{ gap: 8, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={it.done}
                        onChange={() => toggleRecipe(t, it.id)}
                      />
                      {it.label}
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </CollapsibleSection>
  );
}
