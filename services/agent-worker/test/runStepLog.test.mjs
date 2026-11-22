import assert from "node:assert/strict";
import { test } from "node:test";

import { runStepForEvent } from "../src/runStepLog.js";

test("reply 事件 → kind=reply 且带全文", () => {
  const s = runStepForEvent({ type: "reply", text: "这是完整回答" }, "r1", "agent");
  assert.equal(s.kind, "reply");
  assert.equal(s.payload.text, "这是完整回答");
});

test("tool_result → 全量 payload（非 400 字 preview）", () => {
  const s = runStepForEvent(
    { type: "tool_result", payload: { result: "x".repeat(1000) } },
    "r1",
    "agent",
  );
  assert.equal(s.payload.result.length, 1000);
});

test("thinking → kind=thinking", () => {
  const s = runStepForEvent({ type: "thinking", text: "推理" }, "r1", "agent");
  assert.equal(s.kind, "thinking");
  assert.equal(s.payload.text, "推理");
});

test("tool_call → kind=tool_call，透传 name/args/id", () => {
  const s = runStepForEvent(
    { type: "tool_call", payload: { name: "artifact_create", args: { title: "t" }, id: "call_1" } },
    "r1",
    "agent",
  );
  assert.equal(s.kind, "tool_call");
  assert.equal(s.actor, "agent:agent");
  assert.equal(s.payload.name, "artifact_create");
  assert.equal(s.payload.id, "call_1");
  assert.deepEqual(s.payload.args, { title: "t" });
});

test("tool_call 名称为 bash 时映射为 kind=bash", () => {
  const s = runStepForEvent(
    { type: "tool_call", payload: { name: "bash", args: { command: "ls" }, id: "call_2" } },
    "r1",
    "agent",
  );
  assert.equal(s.kind, "bash");
});

test("reply/thinking 兼容 payload.text（runSession emit 形状）", () => {
  const r = runStepForEvent({ type: "reply", payload: { text: "带 payload 的回复" } }, "r1", "agent");
  assert.equal(r.payload.text, "带 payload 的回复");
  const t = runStepForEvent({ type: "thinking", payload: { text: "payload 推理" } }, "r1", "agent");
  assert.equal(t.payload.text, "payload 推理");
});

test("无法映射的事件返回 null", () => {
  assert.equal(runStepForEvent(null, "r1", "agent"), null);
  assert.equal(runStepForEvent(undefined, "r1", "agent"), null);
  assert.equal(runStepForEvent({}, "r1", "agent"), null);
});

for (const type of ["context", "gate", "policy", "subagent", "usage", "recovery", "ledger", "model_response", "model_call", "compaction", "handoff", "receipt"]) {
  test(`${type} retains factual payload and causality`, () => {
    const payload = { turn_id: "t1", id: "c1", parent_tool_call_id: "parent", status: "done" };
    const step = runStepForEvent({ type, payload }, "r1", "agent");
    assert.equal(step.kind, type);
    assert.deepEqual(step.payload, payload);
  });
}
test("reply and tool calls retain turn identity", () => {
  for (const type of ["reply", "tool_call", "thinking"]) {
    assert.equal(runStepForEvent({ type, payload: { turn_id: "t" } }, "r", "a").payload.turn_id, "t");
  }
});

test("persistence waits for acknowledgement and stops safely on append failure", async () => {
  const { persistRunStep } = await import("../src/runStepLog.js");
  let acknowledge;
  let finished = false;
  const pending = persistRunStep({ appendRunStep: () => new Promise(resolve => { acknowledge = resolve; }) }, "r", { type: "tool_call", payload: { id: "c" } }, "a").then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  acknowledge({});
  await pending;
  await assert.rejects(persistRunStep({ appendRunStep: async () => { throw new Error("secret-provider-key"); } }, "r", { type: "tool_result" }, "a"), error => {
    assert.equal(error.code, "RUN_STEP_PERSIST_FAILED");
    assert.equal(error.message.includes("secret-provider-key"), false);
    return true;
  });
});

test("persisted step carries turn ID in control-plane envelope", async () => {
  const { persistRunStep } = await import("../src/runStepLog.js");
  let saved;
  await persistRunStep({ appendRunStep: async (_id, step) => { saved = step; } }, "r", { type: "reply", payload: { text: "ok", turn_id: "t" } }, "a");
  assert.equal(saved.turn_id, "t");
});
