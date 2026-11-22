import assert from "node:assert/strict";
import { test } from "node:test";

test("durable queued jobs are claimed even when a healthy Redis queue is empty", async () => {
  const { claimAvailableJob } = await import("../src/queueClaim.js");
  assert.deepEqual(await claimAvailableJob(async () => null, async () => ({ jobId: "durable" })), { jobId: "durable" });
});
test("Redis failure falls through to durable API queue", async () => {
  const { claimAvailableJob } = await import("../src/queueClaim.js");
  assert.deepEqual(await claimAvailableJob(async () => { throw new Error("offline"); }, async () => ({ jobId: "fallback" })), { jobId: "fallback" });
});
test("Redis delivery takes precedence over API claim", async () => {
  const { claimAvailableJob } = await import("../src/queueClaim.js");
  assert.deepEqual(await claimAvailableJob(async () => ({ jobId: "redis" }), async () => { throw new Error("unexpected second claim"); }), { jobId: "redis" });
});

test("stale deliveries never execute terminal jobs", async () => {
  const { shouldExecuteJob } = await import("../src/queueClaim.js");
  for (const status of ["succeeded", "failed", "cancelled"]) assert.equal(shouldExecuteJob({ status }), false);
  for (const status of ["queued", "running"]) assert.equal(shouldExecuteJob({ status }), true);
  assert.equal(shouldExecuteJob(null), false);
});
