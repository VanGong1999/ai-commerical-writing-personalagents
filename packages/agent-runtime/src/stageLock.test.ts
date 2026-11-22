import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ackStage,
  advanceStage,
  canJumpTo,
  createInitialLockState,
  exportStageGraph,
  isStageLocked,
} from "./stages.ts";

test("manju graph exports agents", () => {
  const g = exportStageGraph("manju");
  assert.ok(g.length >= 10);
  const hook = g.find((s) => s.id === "S1_HOOK_BATCH");
  assert.ok(hook?.agentIds.includes("topic.core_hook_batch"));
});

test("human qc stage locks until ack", () => {
  const state = createInitialLockState("manju", "S10_HUMAN_QC");
  const lock = isStageLocked("manju", "S10_HUMAN_QC", state);
  assert.equal(lock.locked, true);
  assert.equal(lock.requiresUserAck, true);
  const failed = advanceStage(state);
  assert.equal(failed.ok, false);
  const acked = ackStage(state);
  const ok = advanceStage(acked);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.ok(ok.nextStageIds.length >= 1);
});

test("cannot skip forward without force", () => {
  const state = createInitialLockState("manju", "S0_SETUP");
  const jump = canJumpTo("manju", state, "S5_EP_BODY_BATCH");
  assert.equal(jump.ok, false);
  const forced = canJumpTo("manju", state, "S5_EP_BODY_BATCH", { force: true });
  assert.equal(forced.ok, true);
});

test("duanju topic ack locks", () => {
  const state = createInitialLockState("duanju", "S1_TOPIC_ACK");
  assert.equal(isStageLocked("duanju", "S1_TOPIC_ACK", state).locked, true);
});

test("male_long graph exports upgrade + cool agents", () => {
  const g = exportStageGraph("male_long");
  assert.ok(g.length >= 10);
  const vol = g.find((s) => s.id === "S4_VOLUME");
  assert.ok(vol?.agentIds.includes("male.upgrade_loop"));
  const cool = g.find((s) => s.id === "S8_COOL_DENSITY");
  assert.ok(cool?.agentIds.includes("male.cool_density"));
});

test("female_long and short_novel graphs non-empty", () => {
  assert.ok(exportStageGraph("female_long").length >= 8);
  assert.ok(exportStageGraph("short_novel").length >= 8);
  assert.ok(exportStageGraph("ip_adapt").length >= 7);
});

test("short female ip graphs hang dense agents", () => {
  const short = exportStageGraph("short_novel");
  assert.ok(short.find((s) => s.id === "S2_SWAP")?.agentIds.includes("swap.master"));
  assert.ok(short.find((s) => s.id === "S6_BODY_CHAPTER")?.agentIds.includes("prose.short_opening"));
  const female = exportStageGraph("female_long");
  assert.ok(female.find((s) => s.id === "S3_VOLUME")?.agentIds.includes("female.pace"));
  assert.ok(female.find((s) => s.id === "S8_TABOO")?.agentIds.includes("female.risk"));
  const ip = exportStageGraph("ip_adapt");
  assert.ok(ip.find((s) => s.id === "S1_IP_EVAL")?.agentIds.includes("ip.select_score"));
  assert.ok(ip.find((s) => s.id === "S4_COMPRESS")?.agentIds.includes("ip.rebuild"));
  assert.ok((ip.find((s) => s.id === "S7_SCRIPT")?.agentIds.length ?? 0) >= 2);
});
