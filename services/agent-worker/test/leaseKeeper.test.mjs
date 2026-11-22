import test from "node:test";
import assert from "node:assert/strict";
import {
  acquireRunLease,
  startLeaseKeeper,
  buildResumeNote,
  snapshotExecState,
  heartbeatIntervalMs,
  requireLease,
} from "../src/leaseKeeper.js";
import { sideEffectOfTool } from "../src/toolCatalog.js";
import { pendingToolName, stepsToSessionEvents, buildSessionHintFromSteps } from "../src/runSession.js";

test("acquire：成功 / 被拒 / 404 跳过；网络错误默认 fail-closed", async () => {
  const prev = process.env.AGENT_REQUIRE_LEASE;
  process.env.AGENT_REQUIRE_LEASE = "true";
  try {
    const ok = await acquireRunLease(
      { acquireLease: async () => ({ ok: true, leaseVersion: 3, resume: true, checkpoint: { turn: 2 }, attempt: 2 }) },
      "r1",
      "w1",
    );
    assert.equal(ok.ok, true);
    assert.equal(ok.leaseVersion, 3);
    assert.equal(ok.resume, true);

    const denied = await acquireRunLease({ acquireLease: async () => ({ ok: false, reason: "paused" }) }, "r1", "w1");
    assert.deepEqual(denied, { ok: false, reason: "paused" });

    assert.equal(await acquireRunLease({ acquireLease: async () => { throw new Error("404 /x"); } }, "r1", "w1"), null);
    assert.deepEqual(
      await acquireRunLease({ acquireLease: async () => { throw new Error("ECONNREFUSED"); } }, "r1", "w1"),
      { ok: false, reason: "lease_unavailable" },
    );
    assert.equal(await acquireRunLease({}, "", "w1"), null);
    assert.equal(requireLease(), true);
  } finally {
    if (prev == null) delete process.env.AGENT_REQUIRE_LEASE;
    else process.env.AGENT_REQUIRE_LEASE = prev;
  }
});

test("acquire：AGENT_REQUIRE_LEASE=0 时网络错误可降级 null", async () => {
  const prev = process.env.AGENT_REQUIRE_LEASE;
  process.env.AGENT_REQUIRE_LEASE = "0";
  try {
    assert.equal(requireLease(), false);
    assert.equal(
      await acquireRunLease({ acquireLease: async () => { throw new Error("ECONNREFUSED"); } }, "r1", "w1"),
      null,
    );
  } finally {
    if (prev == null) delete process.env.AGENT_REQUIRE_LEASE;
    else process.env.AGENT_REQUIRE_LEASE = prev;
  }
});

test("keeper：心跳上报 checkpoint；pause/stop/lease_lost 转成 abort reason", async () => {
  const reasons = [];
  const beats = [];
  let action = "continue";
  let okFlag = true;
  const api = {
    heartbeatRun: async (_id, body) => {
      beats.push(body);
      return okFlag ? { ok: true, action } : { ok: false, reason: "lease_lost" };
    },
  };
  const keeper = startLeaseKeeper({
    api,
    runId: "r1",
    owner: "w1",
    leaseVersion: 2,
    abort: (e) => reasons.push(e.message),
    getCheckpoint: () => ({ turn: 5 }),
    intervalMs: 100000,
  });
  await keeper.beat();
  assert.deepEqual(beats[0], { owner: "w1", leaseVersion: 2, ttlS: 90, checkpoint: { turn: 5 } });
  assert.deepEqual(reasons, []);
  action = "pause";
  await keeper.beat();
  action = "stop";
  await keeper.beat();
  okFlag = false;
  await keeper.beat();
  assert.deepEqual(reasons, ["paused", "cancelled", "lease_lost"]);
  assert.equal(keeper.isLost(), true);
  keeper.stop();
  const n = beats.length;
  await keeper.beat();
  assert.equal(beats.length, n, "stop 之后不再心跳");
});

test("keeper：409 视为 lease_lost，网络抖动忽略", async () => {
  const reasons = [];
  let err = new Error("ECONNRESET");
  const keeper = startLeaseKeeper({
    api: { heartbeatRun: async () => { throw err; } },
    runId: "r",
    owner: "w",
    leaseVersion: 1,
    abort: (e) => reasons.push(e.message),
    intervalMs: 100000,
  });
  await keeper.beat();
  assert.deepEqual(reasons, []);
  err = new Error("409 /tasks/runs/r/heartbeat");
  await keeper.beat();
  assert.deepEqual(reasons, ["lease_lost"]);
  keeper.stop();
});

test("heartbeatIntervalMs ≈ TTL/3 且有下限；resume note 与 snapshot", () => {
  assert.equal(heartbeatIntervalMs(90), 30000);
  assert.equal(heartbeatIntervalMs(3), 2000);
  assert.equal(buildResumeNote(null), "");
  const note = buildResumeNote(
    { turn: 7, stage: "Turn 7/24", lastTool: { name: "artifact_write", status: "pending" }, artifactIds: ["a1", "a2"] },
    2,
  );
  assert.match(note, /第 2 次执行/);
  assert.match(note, /第 7 轮/);
  assert.match(note, /artifact_write.*结果未知/);
  assert.match(note, /a1, a2/);
  const snap = snapshotExecState({ turn: 1, stage: "x", artifactIds: Array.from({ length: 100 }, (_, i) => `a${i}`) });
  assert.equal(snap.artifactIds.length, 40);
  assert.equal(snapshotExecState(null), undefined);
});

test("崩溃边界：按工具风险分类副作用，读类可续跑", () => {
  assert.equal(sideEffectOfTool("tool_search"), "none");
  assert.equal(sideEffectOfTool("unknown_tool_xyz"), "none");
  assert.equal(sideEffectOfTool("lesson_note"), "memory_write");
  assert.equal(sideEffectOfTool("memory_merge"), "memory_write");
  assert.equal(sideEffectOfTool("job_enqueue"), "job_enqueue");
  const events = [
    { type: "tool_call", payload: { name: "memory_search" } },
    { type: "tool_result", payload: {} },
    { type: "tool_call", payload: { name: "artifact_write" } },
  ];
  assert.equal(pendingToolName(events), "artifact_write");
  assert.equal(pendingToolName(events.slice(0, 2)), "");
});

test("控制面步骤可转 session 事件并生成续跑摘要", () => {
  const steps = [
    { kind: "tool_call", payload: { name: "bible_read", id: "c1" } },
    { kind: "tool_result", payload: { name: "bible_read", status: "done", id: "c1" } },
    { kind: "tool_call", payload: { name: "artifact_create", id: "c2" } },
  ];
  const ev = stepsToSessionEvents(steps, "run1");
  assert.equal(ev.length, 3);
  assert.equal(pendingToolName(ev), "artifact_create");
  const hint = buildSessionHintFromSteps(steps);
  assert.match(hint, /控制面步骤摘要/);
  assert.match(hint, /artifact_create/);
  const note = buildResumeNote(
    { turn: 3, lastTool: { name: "artifact_create", status: "error" }, sessionHint: hint },
    2,
  );
  assert.match(note, /失败/);
  assert.match(note, /控制面步骤摘要/);
});
