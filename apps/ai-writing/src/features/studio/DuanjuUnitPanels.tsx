/**
 * 查理章回体单元剧 / 探案工作台（独立于线性 Stage 链）。
 * 选 archetype → 编辑 UnitSitcomPlan 五字段 → struct.unit_sitcom 生成 →
 * validateUnitSitcomPlan 校验 → 落 unit_sitcom_plan 产物。
 */
import {
  CHARLIE_UNIT_ARCHETYPES,
  UnitSitcomPlanSchema,
  validateUnitSitcomPlan,
  type CharlieUnitArchetype,
  type UnitSitcomPlan,
} from "@xiezuomanju/domain";
import { Badge, Button, Panel, Tabs, toast } from "@xiezuomanju/ui";
import { useMemo } from "react";
import { api } from "../../api/client";
import { runAgentFeedback } from "./runAgentFeedback";
import { usePersistedState } from "./usePersistedState";

export function emptyUnitSitcomPlan(): UnitSitcomPlan {
  return UnitSitcomPlanSchema.parse({});
}

const FIELD_LABELS: { key: keyof Omit<UnitSitcomPlan, "schemaVersion" | "archetype">; label: string; hint: string; rows?: number }[] = [
  { key: "residentCast", label: "常驻班底", hint: "固定人设（姓名+功能标签），不换主角只换事件", rows: 2 },
  { key: "residentScene", label: "常驻场景", hint: "主场景，少换景", rows: 1 },
  { key: "unitFormula", label: "单元公式", hint: "每集一目标一冲突一收束（探案：案发→排查→反转→破案）", rows: 2 },
  { key: "throughLine", label: "主线串珠", hint: "单元间主线升级钩，避免纯单元散装", rows: 2 },
  { key: "pilotUnit", label: "第一单元示范", hint: "第一集/第一案完整起承转合，可复制", rows: 3 },
];

export function DuanjuUnitWorkbench({ projectId }: { projectId?: string }) {
  const [plan, setPlan] = usePersistedState(projectId, "duanju-unit-plan", emptyUnitSitcomPlan());
  const [tab, setTab] = usePersistedState(projectId, "duanju-unit-tab", "edit");

  const verdict = useMemo(() => validateUnitSitcomPlan(plan), [plan]);
  const archetype = CHARLIE_UNIT_ARCHETYPES.find((a) => a.id === plan.archetype) ?? CHARLIE_UNIT_ARCHETYPES[0];

  const runGenerate = () => {
    if (!projectId) return;
    void runAgentFeedback(projectId, "struct.unit_sitcom", {
      label: "struct.unit_sitcom",
      inputJson: {
        archetype: plan.archetype,
        residentCast: plan.residentCast,
        residentScene: plan.residentScene,
        unitFormula: plan.unitFormula,
        throughLine: plan.throughLine,
        pilotUnit: plan.pilotUnit,
      },
    });
  };

  const writeArtifact = async () => {
    if (!projectId) return;
    if (!verdict.ok) {
      toast.fail(`未通过校验：${verdict.message}`);
      return;
    }
    try {
      await api.createArtifact(projectId, {
        type: "unit_sitcom_plan",
        title: archetype.id === "detective_procedural" ? "探案任务方案" : "章回体单元剧方案",
        status: "candidate",
        bodyMarkdown: [
          `# ${archetype.label}`,
          "",
          `**常驻班底**：${plan.residentCast}`,
          `**常驻场景**：${plan.residentScene}`,
          `**单元公式**：${plan.unitFormula}`,
          `**主线串珠**：${plan.throughLine}`,
          "",
          "## 第一单元示范",
          plan.pilotUnit,
        ].join("\n"),
        bodyJson: plan,
      });
      toast.ok("已落 unit_sitcom_plan 产物");
    } catch (e) {
      toast.fail(e instanceof Error ? e.message : "落产物失败");
    }
  };

  return (
    <Panel
      title="查理 · 章回体单元剧 / 探案"
      actions={
        <div className="row" style={{ gap: 6 }}>
          <Badge tone={verdict.ok ? "ok" : "warn"}>{verdict.message}</Badge>
          <Button size="sm" variant="primary" disabled={!projectId} onClick={runGenerate}>
            生成骨架
          </Button>
          <Button size="sm" disabled={!projectId} onClick={() => void writeArtifact()}>
            落产物
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        独立工作台，不塞进线性 Stage 链。单元剧靠固定班底跑量；探案每案一个单元、主角有硬任务。
      </p>
      <div className="row" style={{ flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
        {CHARLIE_UNIT_ARCHETYPES.map((a) => (
          <button
            key={a.id}
            type="button"
            className="btn btn-sm"
            style={{ outline: plan.archetype === a.id ? "2px solid var(--accent)" : undefined }}
            title={a.tip}
            onClick={() => setPlan((s) => ({ ...s, archetype: a.id as CharlieUnitArchetype }))}
          >
            {a.label}
          </button>
        ))}
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "edit", label: "编辑字段" },
          { id: "help", label: "用法" },
        ]}
      />
      {tab === "edit" && (
        <div className="stack" style={{ gap: 10 }}>
          {FIELD_LABELS.map(({ key, label, hint, rows }) => (
            <label key={key} className="field">
              <span>
                {label}
                <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                  {hint}
                </span>
              </span>
              <textarea
                className="textarea"
                rows={rows ?? 2}
                value={plan[key]}
                onChange={(e) => setPlan((s) => ({ ...s, [key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      )}
      {tab === "help" && (
        <div className="stack" style={{ gap: 6 }}>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            与「单元喜剧关系驱动」分工：本台专注章回体骨架（班底/公式/串珠/示范），关系黏度交给
            genre_ext/unit-sitcom。探案须在单元公式中点明「案发→排查→反转→破案」。
          </p>
          <Badge tone={verdict.ok ? "ok" : "warn"}>{verdict.message}</Badge>
        </div>
      )}
    </Panel>
  );
}
