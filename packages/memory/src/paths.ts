export const MEMORY_ROOT = "/memories";

/** 显式 Memory Store id（与 API resolve_store_id 对齐） */
export function projectBibleStoreId(projectId: string): string {
  return `project.${projectId}.bible`;
}

export function projectJournalStoreId(projectId: string): string {
  return `project.${projectId}.journal`;
}

export function agentLessonsStoreId(agentId: string): string {
  return `agent.${agentId}.lessons`;
}

export function projectBiblePath(projectId: string): string {
  return `${MEMORY_ROOT}/projects/${projectId}/bible.md`;
}

export function projectDecisionsPath(projectId: string): string {
  return `${MEMORY_ROOT}/projects/${projectId}/decisions.md`;
}

export function projectIndexPath(projectId: string): string {
  return `${MEMORY_ROOT}/projects/${projectId}/INDEX.md`;
}

export function projectSemanticFactsPath(projectId: string): string {
  return `${MEMORY_ROOT}/projects/${projectId}/semantic/facts.md`;
}

export function projectEpisodicPath(projectId: string, sessionOrRunId: string): string {
  return `${MEMORY_ROOT}/projects/${projectId}/episodes/${sessionOrRunId}.md`;
}

export function projectProceduralPath(projectId: string, agentId: string): string {
  return `${MEMORY_ROOT}/projects/${projectId}/procedural/${agentId}.md`;
}

export function projectStoryGraphPath(projectId: string): string {
  return `${MEMORY_ROOT}/projects/${projectId}/story_graph.md`;
}

export function projectEpisodeGraphPath(projectId: string, ep: number | string): string {
  const pad = String(ep).padStart(3, "0");
  return `${MEMORY_ROOT}/projects/${projectId}/graphs/ep-${pad}.md`;
}

export function projectForeshadowLedgerPath(projectId: string): string {
  return `${MEMORY_ROOT}/projects/${projectId}/foreshadow_ledger.json`;
}

export function hypothesisPath(projectId: string, name: string): string {
  return `${MEMORY_ROOT}/projects/${projectId}/hypothesis:${name}.md`;
}

export function assertMemoryPath(path: string): void {
  if (!path.startsWith(MEMORY_ROOT)) {
    throw new Error(`memory path must start with ${MEMORY_ROOT}`);
  }
}
