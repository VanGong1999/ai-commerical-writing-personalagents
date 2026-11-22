type InstanceScope = {runId: string; conversationId?: string | null; taskGroupId?: string | null};
type GroupScope = {id: string; runs: {runId: string}[]};

export function instancesInScope<T extends InstanceScope>(instances: T[], groups: GroupScope[], conversationId?: string | null) {
  if (!conversationId) return instances;
  const groupIds = new Set(groups.map(group => group.id));
  const runIds = new Set(groups.flatMap(group => group.runs.map(run => run.runId)));
  return instances.filter(instance =>
    instance.conversationId === conversationId ||
    (instance.taskGroupId && groupIds.has(instance.taskGroupId)) ||
    runIds.has(instance.runId)
  );
}
