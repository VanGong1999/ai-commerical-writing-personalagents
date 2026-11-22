import assert from "node:assert/strict";
import { test } from "node:test";
import { api } from "../src/apiClient.js";
import { persistRunStep } from "../src/runStepLog.js";

test("real API adapter propagates rejected ledger appends to the fail-closed writer", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("credentials must stay private", { status: 400 });
    await assert.rejects(persistRunStep(api, "r", { type: "tool_result", payload: { id: "a" } }, "agent"), error => {
      assert.equal(error.code, "RUN_STEP_PERSIST_FAILED");
      assert.equal(error.message.includes("credentials"), false);
      return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});

test("operator synthetic events are appended once locally while remote acknowledgement may retry", async () => {
  const { persistEvent } = await import("../src/runSession.js");
  const original = api.appendRunStep;
  const local = [];
  let remoteWrites = 0;
  const store = { append: event => local.push(event), readAll: () => local };
  const event = { type: "tool_result", runId: "r", agentId: "a", payload: {
    id: "write", turn_id: "t", event_id: "operator-resume:r:t:write", result: JSON.stringify({ status: "unknown_after_interrupt", notReplayed: true, requiresVerification: true }),
  } };
  try {
    api.appendRunStep = async () => { remoteWrites += 1; if (remoteWrites === 1) throw Error("ack lost"); return {}; };
    await assert.rejects(persistEvent(store, event));
    await persistEvent(store, event);
    assert.equal(local.length, 1);
    assert.equal(remoteWrites, 2);
    assert.equal(local[0].payload.event_id, event.payload.event_id);
  } finally { api.appendRunStep = original; }
});
