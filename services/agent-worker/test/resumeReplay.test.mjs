import assert from "node:assert/strict";
import { test } from "node:test";

import { messagesFromSteps } from "../src/resumeReplay.js";

test("tool_call → assistant tool_calls；tool_result → role:tool；reply → assistant content", () => {
  const { messages, resumeCursor } = messagesFromSteps([
    { seq: 1, kind: "tool_call", payload: { name: "artifact_list", args: {}, id: "call_1" } },
    { seq: 2, kind: "tool_result", payload: { name: "artifact_list", result: "[]", id: "call_1" } },
    { seq: 3, kind: "reply", payload: { text: "已核对" } },
  ]);

  assert.equal(messages.length, 3);
  assert.deepEqual(messages[0], {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: { name: "artifact_list", arguments: "{}" },
      },
    ],
  });
  assert.deepEqual(messages[1], { role: "tool", tool_call_id: "call_1", content: "[]" });
  assert.deepEqual(messages[2], { role: "assistant", content: "已核对" });
  assert.equal(resumeCursor, 3);
});

test("按 seq 排序，乱序输入也能正确重建", () => {
  const { messages } = messagesFromSteps([
    { seq: 3, kind: "reply", payload: { text: "done" } },
    { seq: 1, kind: "tool_call", payload: { name: "artifact_list", args: {}, id: "c1" } },
    { seq: 2, kind: "tool_result", payload: { result: "[]", id: "c1" } },
  ]);
  assert.equal(messages[0].role, "assistant");
  assert.equal(messages[1].role, "tool");
  assert.equal(messages[2].content, "done");
});

test("reply 与 tool_call 同轮合并为带 content 的 assistant 消息", () => {
  const { messages, resumeCursor } = messagesFromSteps([
    { seq: 1, kind: "reply", payload: { text: "我先核对" } },
    { seq: 2, kind: "tool_call", payload: { name: "artifact_list", args: {}, id: "c1" } },
    { seq: 3, kind: "tool_result", payload: { result: "[]", id: "c1" } },
  ]);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "assistant");
  assert.equal(messages[0].content, "我先核对");
  assert.equal(messages[0].tool_calls.length, 1);
  assert.equal(messages[1].role, "tool");
  assert.equal(resumeCursor, 3);
});

test("并行多个 tool_call 合入同一条 assistant 消息", () => {
  const { messages, resumeCursor } = messagesFromSteps([
    { seq: 1, kind: "tool_call", payload: { name: "a", args: {}, id: "c1" } },
    { seq: 2, kind: "tool_call", payload: { name: "b", args: {}, id: "c2" } },
    { seq: 3, kind: "tool_result", payload: { result: "r1", id: "c1" } },
    { seq: 4, kind: "tool_result", payload: { result: "r2", id: "c2" } },
  ]);
  assert.equal(messages.length, 3);
  assert.equal(messages[0].tool_calls.length, 2);
  assert.deepEqual(
    messages[0].tool_calls.map((c) => c.function.name),
    ["a", "b"],
  );
  assert.equal(messages[1].tool_call_id, "c1");
  assert.equal(messages[2].tool_call_id, "c2");
  assert.equal(resumeCursor, 4);
});

test("thinking 跳过；bash 视作 tool_call", () => {
  const { messages, resumeCursor } = messagesFromSteps([
    { seq: 1, kind: "thinking", payload: { text: "内部推理" } },
    { seq: 2, kind: "bash", payload: { name: "bash", args: { command: "ls" }, id: "b1" } },
    { seq: 3, kind: "tool_result", payload: { result: "a.txt", id: "b1" } },
  ]);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "assistant");
  assert.equal(messages[0].tool_calls[0].function.name, "bash");
  assert.equal(resumeCursor, 3);
});

test("末尾未完成的 tool_call（崩溃边界）被丢弃，游标停在最后完成步骤之后", () => {
  const { messages, resumeCursor } = messagesFromSteps([
    { seq: 1, kind: "tool_call", payload: { name: "a", args: {}, id: "c1" } },
    { seq: 2, kind: "tool_result", payload: { result: "r1", id: "c1" } },
    { seq: 3, kind: "tool_call", payload: { name: "b", args: {}, id: "c2" } },
  ]);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].tool_calls[0].function.name, "a");
  assert.equal(messages[1].role, "tool");
  assert.equal(resumeCursor, 2);
});

test("末尾 reply + 未完成 tool_call 整轮丢弃", () => {
  const { messages, resumeCursor } = messagesFromSteps([
    { seq: 1, kind: "tool_call", payload: { name: "a", args: {}, id: "c1" } },
    { seq: 2, kind: "tool_result", payload: { result: "r1", id: "c1" } },
    { seq: 3, kind: "reply", payload: { text: "再来一次" } },
    { seq: 4, kind: "tool_call", payload: { name: "b", args: {}, id: "c2" } },
  ]);
  assert.equal(messages.length, 2);
  assert.equal(resumeCursor, 2);
});

test("空输入与非法输入安全返回", () => {
  assert.deepEqual(messagesFromSteps(), { messages: [], resumeCursor: 0 });
  assert.deepEqual(messagesFromSteps(null), { messages: [], resumeCursor: 0 });
  assert.deepEqual(messagesFromSteps([]), { messages: [], resumeCursor: 0 });
});

test("arguments 已是字符串时不重复 stringify", () => {
  const { messages } = messagesFromSteps([
    { seq: 1, kind: "tool_call", payload: { name: "a", args: "{\"x\":1}", id: "c1" } },
    { seq: 2, kind: "tool_result", payload: { result: "ok", id: "c1" } },
  ]);
  assert.equal(messages[0].tool_calls[0].function.arguments, '{"x":1}');
});

test("partial parallel round is withheld with completed results preserved as evidence", () => {
  const replay = messagesFromSteps([
    { seq: 1, kind: "reply", payload: { text: "before", turn_id: "t0" } },
    { seq: 2, kind: "tool_call", payload: { name: "write", id: "a", turn_id: "t1" } },
    { seq: 3, kind: "tool_call", payload: { name: "read", id: "b", turn_id: "t1" } },
    { seq: 4, kind: "tool_result", payload: { id: "a", result: "saved", turn_id: "t1" } },
    { seq: 5, kind: "thinking", payload: {} },
    { seq: 6, kind: "context", payload: {} },
  ]);
  assert.deepEqual(replay.messages, [{ role: "assistant", content: "before" }]);
  assert.equal(replay.resumeCursor, 1);
  assert.deepEqual(replay.incompleteRound.pendingToolCallIds, ["b"]);
  assert.equal(replay.incompleteRound.completedResults[0].result, "saved");
});

test("legacy partial parallel round also never emits dangling calls", () => {
  const replay = messagesFromSteps([
    { seq: 1, kind: "tool_call", payload: { name: "write", id: "a" } },
    { seq: 2, kind: "tool_call", payload: { name: "read", id: "b" } },
    { seq: 3, kind: "tool_result", payload: { id: "a", result: "saved" } },
    { seq: 4, kind: "thinking" },
  ]);
  assert.deepEqual(replay.messages, []);
  assert.equal(replay.resumeCursor, 0);
});

test("turn identity collects late reply and interleaved calls, deduplicates results and rejects orphans", () => {
  const steps = [
    { seq: 1, kind: "tool_call", payload: { name: "a", id: "a", turn_id: "t" } },
    { seq: 2, kind: "tool_result", payload: { id: "a", result: "A", turn_id: "t" } },
    { seq: 3, kind: "tool_call", payload: { name: "b", id: "b", turn_id: "t" } },
    { seq: 4, kind: "tool_result", payload: { id: "b", result: "B", turn_id: "t" } },
    { seq: 5, kind: "reply", payload: { text: "late", turn_id: "t" } },
    { seq: 6, kind: "tool_result", payload: { id: "orphan", result: "no" } },
  ];
  const replay = messagesFromSteps([...steps, steps[0], steps[1]]);
  assert.equal(replay.messages.length, 3);
  assert.equal(replay.messages[0].content, "late");
  assert.deepEqual(replay.messages[0].tool_calls.map(c => c.id), ["a", "b"]);
  assert.deepEqual(replay.messages.slice(1).map(m => m.tool_call_id), ["a", "b"]);
});

test("parallel results may arrive before calls and in reverse order", () => {
  const replay = messagesFromSteps([
    { seq: 1, kind: "tool_result", payload: { id: "b", result: "B", turn_id: "t" } },
    { seq: 2, kind: "tool_call", payload: { name: "a", id: "a", turn_id: "t" } },
    { seq: 3, kind: "tool_call", payload: { name: "b", id: "b", turn_id: "t" } },
    { seq: 4, kind: "tool_result", payload: { id: "a", result: "A", turn_id: "t" } },
  ]);
  assert.equal(replay.messages.length, 3);
  assert.deepEqual(replay.messages.slice(1).map(m => m.tool_call_id), ["a", "b"]);
});

test("model response declares entire round before first tool execution", () => {
  const replay = messagesFromSteps([
    { seq: 1, kind: "model_response", payload: { turn_id: "t", tool_calls: [
      { id: "a", function: { name: "write", arguments: "{}" } },
      { id: "b", function: { name: "read", arguments: "{}" } },
    ] } },
    { seq: 2, kind: "tool_call", payload: { id: "a", name: "write", turn_id: "t" } },
    { seq: 3, kind: "tool_result", payload: { id: "a", result: "saved", turn_id: "t" } },
  ]);
  assert.equal(replay.resumeCursor, 0);
  assert.deepEqual(replay.messages, []);
  assert.deepEqual(replay.incompleteRound.pendingToolCallIds, ["b"]);
});

test("completed writes are reused while unresolved writes require review", async () => {
  const { incompleteRoundNeedsReview } = await import("../src/resumeReplay.js");
  const replay = messagesFromSteps([
    { seq: 1, kind: "tool_call", payload: { id: "a", name: "artifact_create" } },
    { seq: 2, kind: "tool_call", payload: { id: "b", name: "artifact_list" } },
    { seq: 3, kind: "tool_result", payload: { id: "a", result: "saved" } },
  ]);
  assert.equal(incompleteRoundNeedsReview(replay, n => n === "artifact_create" ? "artifact_write" : "none"), false);
  assert.equal(incompleteRoundNeedsReview({ ...replay, incompleteRound: { pendingToolCallIds: ["c"], toolCalls: [{ id: "c", function: { name: "artifact_list" } }] } }, () => "none"), false);
});

test("non-message events of an incomplete turn cannot move the complete boundary", () => {
  const replay = messagesFromSteps([
    { seq: 1, kind: "model_call", payload: { turn_id: "t" } },
    { seq: 2, kind: "thinking", payload: { turn_id: "t" } },
    { seq: 3, kind: "tool_call", payload: { id: "a", name: "read", turn_id: "t" } },
    { seq: 4, kind: "usage", payload: { turn_id: "t" } },
  ]);
  assert.equal(replay.resumeCursor, 0);
});
test("distinct events sharing seq are retained while identical deliveries are ignored", () => {
  const call = { seq: 1, kind: "tool_call", payload: { id: "a", name: "read" } };
  const replay = messagesFromSteps([call, call, { seq: 1, kind: "tool_result", payload: { id: "a", result: "ok" } }]);
  assert.equal(replay.messages.length, 2);
  assert.equal(replay.resumeCursor, 3);
});

test("pending-only recovery reuses completed writes and executes only missing reads", async () => {
  const { recoverReadonlyRound } = await import("../src/resumeReplay.js");
  const replay = messagesFromSteps([
    { seq: 1, kind: "tool_call", payload: { id: "a", name: "artifact_create" } },
    { seq: 2, kind: "tool_call", payload: { id: "b", name: "artifact_list" } },
    { seq: 3, kind: "tool_result", payload: { id: "a", result: "saved" } },
  ]);
  let executed = [];
  const messages = await recoverReadonlyRound(replay, n => n === "artifact_list", async call => { executed.push(call.id); return "listed"; });
  assert.deepEqual(executed, ["b"]);
  assert.deepEqual(messages.slice(1).map(m => m.content), ["saved", "listed"]);
  assert.deepEqual(messages[0].tool_calls.map(c => c.id), ["a", "b"]);
});
test("pending-only recovery refuses unknown writes before executing any call", async () => {
  const { recoverReadonlyRound } = await import("../src/resumeReplay.js");
  const replay = messagesFromSteps([{ kind: "tool_call", payload: { id: "a", name: "write" } }]);
  await assert.rejects(recoverReadonlyRound(replay, () => false, async () => { assert.fail("unsafe execution"); }), /未完成工具轮/);
});

test("child execution facts never contaminate parent provider messages", () => {
  const replay = messagesFromSteps([
    { seq: 1, kind: "reply", payload: { text: "child", child_run_id: "child" } },
    { seq: 2, kind: "tool_call", payload: { name: "write", id: "child_call", child_run_id: "child" } },
    { seq: 3, kind: "reply", payload: { text: "parent" } },
  ]);
  assert.deepEqual(replay.messages, [{ role: "assistant", content: "parent" }]);
  assert.equal(replay.incompleteRound, undefined);
});

test("recovery stops when later rounds would otherwise be silently discarded", async () => {
  const { recoverReadonlyRound } = await import("../src/resumeReplay.js");
  const replay = messagesFromSteps([
    { seq: 1, kind: "tool_call", payload: { id: "a", name: "read", turn_id: "t1" } },
    { seq: 2, kind: "tool_call", payload: { id: "b", name: "write", turn_id: "t2" } },
    { seq: 3, kind: "tool_result", payload: { id: "b", result: "saved", turn_id: "t2" } },
  ]);
  await assert.rejects(recoverReadonlyRound(replay, () => true, async () => "read"), /未完成工具轮/);
});

test("explicit operator resume records unknown write result without invoking write and remains idempotent on restore", async () => {
  const { recoverReadonlyRound } = await import("../src/resumeReplay.js");
  const steps = [
    { seq: 1, kind: "tool_call", payload: { id: "known", name: "artifact_create", turn_id: "t" } },
    { seq: 2, kind: "tool_call", payload: { id: "unknown", name: "artifact_create", turn_id: "t" } },
    { seq: 3, kind: "tool_call", payload: { id: "read", name: "artifact_list", turn_id: "t" } },
    { seq: 4, kind: "tool_result", payload: { id: "known", result: "saved", turn_id: "t" } },
  ];
  const replay = messagesFromSteps(steps);
  const executed = [];
  const recorded = [];
  const messages = await recoverReadonlyRound(replay, name => name === "artifact_list", async call => { executed.push(call.id); return "listed"; }, {
    operatorDecision: "resume",
    recordPolicy: async policy => { recorded.push(policy); },
    persistUnknown: async (call, turnId, result) => { steps.push({ seq: 5, kind: "tool_result", payload: { id: call.id, turn_id: turnId, result } }); },
  });
  assert.deepEqual(executed, ["read"]);
  assert.equal(recorded[0].operatorDecision, "resume");
  assert.equal(messages[0].tool_calls.length, 3);
  const unknown = JSON.parse(messages.find(m => m.tool_call_id === "unknown").content);
  assert.equal(unknown.status, "unknown_after_interrupt");
  assert.equal(unknown.notReplayed, true);
  assert.equal(unknown.requiresVerification, true);
  assert.match(messages.at(-1).content, /artifact_list/);
  // A crash before missing read result persisted must not create another synthetic write result.
  const restored = messagesFromSteps(steps);
  let repeated = 0;
  await recoverReadonlyRound(restored, name => name === "artifact_list", async () => "listed", {
    operatorDecision: "resume", persistUnknown: async () => { repeated += 1; }, recordPolicy: async () => {},
  });
  assert.equal(repeated, 0);
  assert.equal(restored.requiresVerification, true);
});

test("resume never overrides explicit refuse or mark_done without independent completion proof", async () => {
  const { recoverReadonlyRound } = await import("../src/resumeReplay.js");
  const replay = messagesFromSteps([{ kind: "tool_call", payload: { id: "write", name: "write" } }]);
  for (const operatorDecision of [undefined, "refuse", "mark_done"]) {
    await assert.rejects(recoverReadonlyRound(replay, () => false, async () => assert.fail("write replayed"), { operatorDecision }), /未完成工具轮/);
  }
});

test("uncertain-write inspection barrier only permits proven reads until durable verification", async () => {
  const { recoveryToolAllowed } = await import("../src/resumeReplay.js");
  assert.equal(recoveryToolAllowed(true, "artifact_create", () => false), false);
  assert.equal(recoveryToolAllowed(true, "artifact_list", () => true), true);
  assert.equal(recoveryToolAllowed(false, "artifact_create", () => false), true);
  const result = JSON.stringify({ status: "unknown_after_interrupt", notReplayed: true, requiresVerification: true });
  const steps = [
    { seq: 1, kind: "tool_call", payload: { id: "x", name: "write", turn_id: "t" } },
    { seq: 2, kind: "tool_result", payload: { id: "x", result, turn_id: "t" } },
  ];
  assert.equal(messagesFromSteps(steps).requiresVerification, true);
  steps.push({ seq: 3, kind: "recovery", payload: { action: "inspection_verified" } });
  assert.equal(messagesFromSteps(steps).requiresVerification, undefined);
});

test('transport-uncertain mutation keeps inspection barrier across a process restart', () => {
  const result = JSON.stringify({ status: 'mutation_result_unknown', notReplayed: true, requiresVerification: true, retryable: false });
  const steps = [
    { seq: 1, kind: 'tool_call', payload: { id: 'lost', name: 'artifact_create', turn_id: 'turn' } },
    { seq: 2, kind: 'tool_result', payload: { id: 'lost', result, status: 'error', turn_id: 'turn' } },
  ];
  assert.equal(messagesFromSteps(steps).requiresVerification, true);
  steps.push({ seq: 3, kind: 'recovery', payload: { action: 'inspection_verified' } });
  assert.equal(messagesFromSteps(steps).requiresVerification, undefined);
});
