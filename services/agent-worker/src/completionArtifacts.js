import { createHash } from "node:crypto";
import { CoreHookFullBodySchema } from "../../../packages/domain/src/nines-workflow.ts";

export function isActiveCompletionArtifact(artifact) {
  return artifact.status !== "archived" && artifact.status !== "rejected";
}

// Read the stored aliases directly. The adoption normalizer can derive missing
// motivation from other fields, which cannot prove a candidate was delivered.
const hookFields = CoreHookFullBodySchema.pick({
  titleHook: true, coreHook: true, motivation: true, openingStructure: true,
  crisis: true, tags: true, openingBeats: true,
});

function isSavedCoreHook(row, artifactTitle) {
  const candidate = row?.candidate ?? row;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const rawMotivation = candidate.motivation;
  const motivation = rawMotivation && typeof rawMotivation === "object" && !Array.isArray(rawMotivation)
    ? Object.values(rawMotivation).filter(line => typeof line === "string" && line.trim()).join("；")
    : rawMotivation;
  const parsed = hookFields.safeParse({
    ...candidate,
    motivation,
    titleHook: candidate.titleHook ?? candidate.title ?? candidate.title_hook ?? artifactTitle,
    coreHook: candidate.coreHook ?? candidate.core_hook,
    openingStructure: candidate.openingStructure ?? candidate.opening_structure ?? candidate.opening,
    openingBeats: candidate.openingBeats ?? candidate.opening_beats,
  });
  if (!parsed.success) return false;
  const hook = parsed.data;
  return [hook.titleHook, hook.coreHook, hook.motivation, hook.openingStructure, hook.crisis]
    .every(value => value?.trim()) && hook.tags.length > 0 && hook.tags.every(tag => tag.trim());
}

export function countCompletionArtifacts(scopedArtifacts) {
  const counts = {};
  for (const artifact of scopedArtifacts) {
    const type = artifact.type || artifact.artifactType || "other";
    let units = 1;
    if (type === "core_hook") {
      const body = artifact.bodyJson;
      if (body && Object.hasOwn(body, "items")) {
        units = Array.isArray(body.items) ? body.items.filter(row => isSavedCoreHook(row)).length : 0;
      } else {
        units = Number(isSavedCoreHook(body, artifact.title));
      }
    }
    counts[type] = (counts[type] || 0) + units;
  }
  return counts;
}

/** Completion evidence belongs to this task. Existing project artifacts remain
 * readable dependencies, but count only when explicitly selected for reuse.
 * Descendant IDs must come from acknowledged successful child execution facts.
 */
export function selectCompletionArtifacts(artifacts, { runId, reuseArtifactIds = [], descendantRunIds = [] } = {}) {
  if (!Array.isArray(reuseArtifactIds) || reuseArtifactIds.length > 100 ||
      reuseArtifactIds.some(id => typeof id !== "string" || !id.trim())) {
    throw new Error("复用产物必须是最多 100 个有效产物 ID");
  }
  const rows = Array.isArray(artifacts) ? artifacts : [];
  const existing = new Set(rows.map(a => a.id));
  if (reuseArtifactIds.some(id => !existing.has(id))) throw new Error("复用产物不存在或不属于当前项目");
  const reused = new Set(reuseArtifactIds);
  const owners = new Set([...(runId ? [runId] : []), ...descendantRunIds]);
  return rows.filter(a => isActiveCompletionArtifact(a) &&
    (reused.has(a.id) || owners.has(a.createdByRunId ?? a.created_by_run_id)));
}

function childOutcomes(steps) {
  const admissions = new Map();
  const outcomes = new Map();
  for (const step of steps || []) {
    if ((step.kind || step.type) !== "subagent") continue;
    const p = step.payload || {};
    const parent = p.spawning_run_id || p.parent_run_id;
    const child = p.spawned_run_id || p.child_run_id;
    if (!parent || !child || parent === child) continue;
    const key = JSON.stringify([parent, child]);
    if (p.phase === "admitted") admissions.set(key, p);
    if (p.status) outcomes.set(key, {parent, child, outcome:p});
  }
  const byParent = new Map();
  for (const [key, branch] of outcomes) {
    const admission = admissions.get(key);
    const revision = admission?.parentSteerRevision ?? null;
    // Legacy terminal rows can inherit their marked admission, or belong to
    // the original unsteered task when neither record carried a revision.
    if (Object.hasOwn(branch.outcome, "parentSteerRevision") &&
        (!admission || branch.outcome.parentSteerRevision !== revision)) continue;
    const siblings = byParent.get(branch.parent) || [];
    siblings.push({...branch, revision});
    byParent.set(branch.parent, siblings);
  }
  return byParent;
}

export function currentChildOutcomes(steps, runId, revision) {
  return (childOutcomes(steps).get(runId) || [])
    .filter(branch => branch.revision === (revision ?? null));
}

export function successfulDescendantRunIds(steps, runId, revision) {
  const byParent = childOutcomes(steps);
  const descendants = new Set();
  const visit = (parent, limits) => {
    for (const branch of byParent.get(parent) || []) {
      const {child, outcome} = branch;
      if (outcome.status !== "succeeded" || outcome.withheld || child === runId || descendants.has(child) ||
          (parent === runId && branch.revision !== (revision ?? null)) ||
          limits.some(limit => !limit.has(child))) continue;
      descendants.add(child);
      // This child certified its own descendants at its own local revision.
      // Each claimed ID still needs a successful chain of ledger entries.
      const declared = outcome.descendant_run_ids;
      visit(child, Array.isArray(declared) ? [...limits, new Set(declared)] : limits);
    }
  };
  visit(runId, []);
  return descendants;
}

/** Join both durable tables. A project artifact alone cannot certify a KB save. */
export function completedKbArtifacts(artifacts, reports, {docId, runId, projectId}) {
  const types = new Set();
  return selectCompletionArtifacts(artifacts, {runId}).filter(a => {
    const r = reports.find(row => row.id === a.bodyJson?.reportId);
    const meta = r?.bodyJson;
    if (a.type !== "analysis_report" || a.createdByRunId !== runId || !docId ||
        r?.docId !== docId || meta?.status !== "completed" || meta.projectId !== projectId ||
        meta.runId !== runId || meta.artifactId !== a.id || r.reportType !== a.bodyJson.reportType ||
        !r.bodyMarkdown?.trim() || a.bodyMarkdown !== r.bodyMarkdown || a.bodyJson.docId !== docId ||
        createHash("sha256").update(r.bodyMarkdown).digest("hex") !== meta.contentHash || types.has(r.reportType)) return false;
    types.add(r.reportType);
    return true;
  });
}
