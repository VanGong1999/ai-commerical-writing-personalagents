import type { ProjectFormat } from "@xiezuomanju/domain";

export type WordTarget = { min: number; max: number; target: number };

export function isScriptFormat(format: ProjectFormat): boolean {
  return format === "manju" || format === "duanju" || format === "ip_adapt";
}

export function defaultWordTarget(format: ProjectFormat): WordTarget {
  return isScriptFormat(format)
    ? { min: 800, max: 1200, target: 1000 }
    : { min: 2000, max: 3000, target: 2000 };
}

export function loadWordTarget(
  projectId: string | undefined,
  format: ProjectFormat,
): WordTarget {
  const def = defaultWordTarget(format);
  if (!projectId) return def;
  try {
    const raw = localStorage.getItem(`word-target:${projectId}`);
    if (!raw) return def;
    const p = JSON.parse(raw) as Partial<WordTarget>;
    return {
      min: Number(p.min) || def.min,
      max: Number(p.max) || def.max,
      target: Number(p.target) || def.target,
    };
  } catch {
    return def;
  }
}

export function persistWordTarget(
  projectId: string | undefined,
  target: WordTarget,
): void {
  if (!projectId) return;
  try {
    localStorage.setItem(`word-target:${projectId}`, JSON.stringify(target));
  } catch {
    /* ignore */
  }
}
