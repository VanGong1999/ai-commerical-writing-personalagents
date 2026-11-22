// Only the outer worker knows whether a failed attempt will be retried.
export async function notifyFleetTerminal(api, jobId, runId, status, summary = '') {
  if (!['succeeded', 'failed', 'cancelled'].includes(status)) return;
  const job = await api.getJob(jobId);
  const payload = job?.payload || {};
  if (!payload.fleetId || payload.fleetSynthesis) return;
  await api.patchFleetMember(payload.fleetId, {
    index: payload.fleetIndex,
    name: payload.input?.fleetMember,
    status: status === 'succeeded' ? 'done' : 'failed',
    summary: String(summary).slice(0, 2000),
    runId, jobId,
  });
}
