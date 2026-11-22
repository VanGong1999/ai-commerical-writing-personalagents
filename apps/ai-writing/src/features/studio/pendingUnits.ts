import type { AutopilotStep } from "./autopilotPipeline";
type UnitArtifact = { bodyJson?: unknown };

export function bodyUnitNo(artifact: UnitArtifact): number {
  const b = (artifact.bodyJson ?? {}) as Record<string, unknown>;
  const n = Number(b.episodeNo ?? b.episode_no ?? b.chapterNo ?? b.chapter_no);
  if (Number.isSafeInteger(n) && n > 0) return n;
  return Number(String(b.scene_header ?? "").match(/^\s*(\d+)/)?.[1] ?? 0);
}

export function pendingUnits(outlines: UnitArtifact[], bodies: UnitArtifact[], limit: string, defaultOutlineCount: number): number[] {
  const available = [...new Set(outlines.map(bodyUnitNo))].filter(n => n > 0);
  const count = limit === "all" ? defaultOutlineCount : Number(limit);
  const requested = limit === "all" && available.length ? available : Array.from({length: count}, (_, i) => i + 1);
  const written = new Set(bodies.map(bodyUnitNo));
  return requested.filter(n => !written.has(n)).sort((a, b) => a - b);
}

type PlanItem = {
  key: string;
  label: string;
  step: AutopilotStep;
  /** 正文分集任务携带目标集号 */
  episodeNo?: number;
};

export function buildBatchPlan({
  chain, hasHook, hasCharacters, outlineReadyCount, outlineTarget, bodyReadyCount, bodyTarget,
  episodeBased, outlineArts, manuscripts, bodyLimit, enabled,
}: {
  chain: AutopilotStep[]; hasHook: boolean; hasCharacters: boolean;
  outlineReadyCount: number; outlineTarget: number; bodyReadyCount: number; bodyTarget: number;
  episodeBased: boolean; outlineArts: UnitArtifact[]; manuscripts: UnitArtifact[];
  bodyLimit: string; enabled: (step: AutopilotStep) => boolean;
}): PlanItem[] {
  const planItems: PlanItem[] = [];
  for (const step of chain) {
    if (step.id === "hook" && hasHook) continue;
    if (step.id === "char" && hasCharacters) continue;
    if (step.id === "outline" && outlineReadyCount >= outlineTarget) continue;
    if (!enabled(step)) continue;
    if (step.id !== "body") {
      planItems.push({ key: step.id, label: step.label, step });
      continue;
    }
    if (episodeBased) {
      const pending = pendingUnits(outlineArts, manuscripts, bodyLimit, outlineTarget);
      for (const ep of pending) {
        planItems.push({
          key: `body-ep${ep}`,
          label: `正文 EP${String(ep).padStart(2, "0")}`,
          step,
          episodeNo: ep,
        });
      }
    } else {
      if (manuscripts.length || bodyReadyCount >= bodyTarget) continue;
      planItems.push({ key: "body", label: step.label, step });
    }
  }
  return planItems;
}
