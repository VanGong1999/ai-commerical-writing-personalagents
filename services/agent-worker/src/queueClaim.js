/** Redis is a delivery hint; queued API jobs remain the durable source. */
export async function claimAvailableJob(claimRedis, claimApi) {
  let envelope;
  try {
    envelope = await claimRedis();
  } catch {
    // Connection loss must not strand durable jobs while the worker is alive.
  }
  return envelope || await claimApi();
}

export function shouldExecuteJob(job) {
  return Boolean(job && ["queued", "running"].includes(job.status));
}

/** Claim all delivery/run keys before the first await; release on every exit. */
export function createExecutionGuard() {
  const active = new Set();
  return {
    async run(keys, execute) {
      const unique = [...new Set(keys.filter(Boolean))];
      if (unique.some(key => active.has(key))) return;
      for (const key of unique) active.add(key);
      try {
        return await execute();
      } finally {
        for (const key of unique) active.delete(key);
      }
    },
  };
}
