import { makeRid } from "./rid.ts";
import { contentHash } from "./hash.ts";

export type ScenarioObject = {
  rid: string;
  projectId: string;
  properties: Record<string, unknown>;
  version: number;
  status: string;
  contentHash?: string;
};
export type ScenarioFork = {
  rid: string;
  projectId: string;
  label: string;
  baseRids: string[];
  baselines: Record<string, {contentHash: string; version: number; status: string}>;
  forkedProperties: Record<string, Record<string, unknown>>;
  status: "open" | "merged" | "discarded";
  createdAt: string;
};

/** Forks preserve source/review metadata and a CAS baseline without editing canon. */
export function createScenario(opts: {
  projectId: string;
  label: string;
  objects: ScenarioObject[];
}): ScenarioFork {
  const forked: ScenarioFork['forkedProperties'] = {};
  const baselines: ScenarioFork['baselines'] = {};
  for (const o of opts.objects) {
    if (o.projectId !== opts.projectId) throw new Error(`project_boundary:${o.rid}`);
    forked[o.rid] = structuredClone(o.properties);
    baselines[o.rid] = {contentHash: o.contentHash ?? contentHash(o.properties), version: o.version, status: o.status};
  }
  return {
    rid: makeRid("Scenario"), projectId: opts.projectId, label: opts.label,
    baseRids: [...new Set(opts.objects.map((o) => o.rid))], baselines,
    forkedProperties: forked, status: "open", createdAt: new Date().toISOString(),
  };
}

/** Validate the entire merge before returning any patches. Storage must apply CAS atomically. */
export function mergeScenarioPatches(scenario: ScenarioFork, currentObjects: ScenarioObject[]): {
  rid: string; properties: Record<string, unknown>; contentHash: string; previousHash: string; previousVersion: number;
}[] {
  if (scenario.status === 'merged') return [];
  if (scenario.status !== 'open') throw new Error('scenario_not_open');
  const objects = new Map(currentObjects.map(o => [o.rid, o]));
  for (const rid of scenario.baseRids) {
    const current = objects.get(rid);
    if (current && current.projectId !== scenario.projectId) throw new Error(`project_boundary:${rid}`);
    const baseline = scenario.baselines?.[rid];
    if (!current || !baseline || !scenario.forkedProperties[rid] ||
        baseline.contentHash !== (current.contentHash ?? contentHash(current.properties)) ||
        baseline.version !== current.version || baseline.status !== current.status) {
      throw new Error(`scenario_conflict:${rid}`);
    }
  }
  if (Object.keys(scenario.forkedProperties).some(rid => !scenario.baseRids.includes(rid))) {
    throw new Error('scenario_unknown_objects');
  }
  return scenario.baseRids.flatMap(rid => {
    const properties = structuredClone(scenario.forkedProperties[rid]);
    if (contentHash(properties) === contentHash(objects.get(rid)!.properties)) return [];
    const baseline = scenario.baselines[rid];
    return [{rid, properties, contentHash: contentHash(properties), previousHash: baseline.contentHash, previousVersion: baseline.version}];
  });
}
