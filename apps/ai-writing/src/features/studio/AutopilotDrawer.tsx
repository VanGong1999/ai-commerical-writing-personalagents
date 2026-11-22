import { buildBatchPlan } from "./pendingUnits";
import type { ProjectFormat } from "@xiezuomanju/domain";
import { Button, Drawer, toast } from "@xiezuomanju/ui";
import { Loader2, Rocket } from "lucide-react";
import { useState } from "react";
import { api, type AutopilotStepIn } from "../../api/client";
import {
  autopilotPipelineFor,
  type AutopilotStep,
} from "./autopilotPipeline";
import { isFeatureOn, useFeatureToggles } from "./featureToggles";

const EPISODE_FORMATS = new Set<ProjectFormat>(["manju", "duanju", "ip_adapt"]);

/** 正文产物类型：duanju 场级正文为 scene，其余为 manuscript。 */
function bodyTypeFor(format: ProjectFormat): string {
  return format === "duanju" ? "scene" : "manuscript";
}

/** 每个步骤对应的功能开关（默认开；关闭后自动跳过辅助步骤）。 */
function toggleForStep(step: AutopilotStep): string | null {
  const agentId = step.agentId;
  if (agentId.startsWith("qc.de_ai")) return "qcDeAi";
  if (agentId.startsWith("qc.revise20")) return "revise20";
  if (agentId.startsWith("male.cool_density")) return "coolDensity";
  if (agentId.startsWith("struct.paywall") || agentId.startsWith("female.pace")) return "pacePaywall";
  if (agentId.startsWith("qc.logic_heuristic")) return "logicScan";
  return null;
}

export function AutopilotDrawer({
  initialMode,
  open,
  onClose,
  projectId,
  format,
  hasHook,
  hasCharacters,
  outlineReadyCount,
  outlineTarget,
  bodyReadyCount,
  bodyTarget,
  onDone,
}: {
  initialMode: "auto" | "step";
  open: boolean;
  onClose: () => void;
  projectId?: string;
  format: ProjectFormat;
  hasHook: boolean;
  hasCharacters: boolean;
  outlineReadyCount: number;
  outlineTarget: number;
  bodyReadyCount: number;
  bodyTarget: number;
  onDone?: () => void;
}) {
  const toggles = useFeatureToggles();
  const [mode, setMode] = useState<"step" | "auto">(initialMode);
  const [bodyLimit, setBodyLimit] = useState<"3" | "5" | "10" | "all">("5");
  const [submitting, setSubmitting] = useState(false);

  const outlineArtifactType = EPISODE_FORMATS.has(format) ? "episode_outline" : "chapter_outline";

  const buildPlan = async () => {
    if (!projectId) throw new Error("缺少项目");
    const chain = autopilotPipelineFor(format);
    const [outlineArts, manuscripts] = await Promise.all([
      api.listArtifacts(projectId, outlineArtifactType),
      api.listArtifacts(projectId, bodyTypeFor(format)),
    ]);
    return buildBatchPlan({
      chain, hasHook, hasCharacters, outlineReadyCount, outlineTarget, bodyReadyCount, bodyTarget,
      episodeBased: EPISODE_FORMATS.has(format), outlineArts, manuscripts, bodyLimit,
      enabled: step => {
        const toggle = toggleForStep(step);
        return !toggle || isFeatureOn(toggles, toggle);
      },
    });
  };

  const start = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const planItems = await buildPlan();
      if (!planItems.length) {
        toast.ok("本稿已全部完成，无需补全");
        return;
      }
      const steps: AutopilotStepIn[] = planItems.map((item, i) => ({
        id: item.key,
        agentId: item.step.agentId,
        label: item.label,
        adoptType: item.step.adoptType,
        adoptMode: item.step.adoptMode,
        episodeNo: item.episodeNo,
        dependsOn: i > 0 ? [planItems[i - 1].key] : [],
      }));
      await api.startAutopilot(projectId!, { mode, steps });
      toast.ok("已提交补全，去运行中面板查看");
      onClose();
      onDone?.();
    } catch (e) {
      toast.fail(e instanceof Error ? e.message : "补全失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={(o) => !o && !submitting && onClose()} title="补全本稿" width={440}>
      <div className="stack">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <label className="row" style={{ gap: 5 }}>
            <input
              type="radio"
              name="autopilot-mode"
              checked={mode === "step"}
              disabled={submitting}
              onChange={() => setMode("step")}
            />
            分步确认
          </label>
          <label className="row" style={{ gap: 5 }}>
            <input
              type="radio"
              name="autopilot-mode"
              checked={mode === "auto"}
              disabled={submitting}
              onChange={() => setMode("auto")}
            />
            一键自动
          </label>
          {EPISODE_FORMATS.has(format) && (
            <label className="row" style={{ gap: 5, marginLeft: "auto" }}>
              写到
              <select
                className="select"
                value={bodyLimit}
                disabled={submitting}
                onChange={(e) => setBodyLimit(e.target.value as typeof bodyLimit)}
              >
                <option value="3">前 3 集</option>
                <option value="5">前 5 集</option>
                <option value="10">前 10 集</option>
                <option value="all">全部大纲集数</option>
              </select>
            </label>
          )}
        </div>
        <div className="muted" style={{ fontSize: "var(--fs-xs)", lineHeight: 1.6 }}>
          {mode === "step"
            ? "分步确认：每完成一步就暂停，检查产物后可继续。适合慢工出细活、控制用量。"
            : "一键自动：连续补齐缺失步骤并按流程自动采纳候选稿，直至正文写完目标集数。适合批量生产。"}
        </div>
        <div className="empty">
          点「开始」{EPISODE_FORMATS.has(format) ? bodyLimit === "all" ? "补齐大纲对应的正文" : `补齐前 ${Number(bodyLimit)} 集正文` : "补齐当前稿"}。
        </div>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <Button variant="primary" disabled={submitting || !projectId} onClick={() => void start()}>
            {submitting ? <Loader2 size={15} className="assistant__spinner" /> : <Rocket size={15} />}
            {submitting ? "提交中…" : mode === "step" ? "开始" : "开始补全"}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
