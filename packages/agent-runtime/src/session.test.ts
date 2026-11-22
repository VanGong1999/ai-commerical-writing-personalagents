import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  inspectCrashBoundary,
  type SessionEvent,
  type SessionEventType,
} from "./session.ts";

function ev(type: SessionEventType, payload?: Record<string, unknown>): SessionEvent {
  return { ts: "2026-01-01T00:00:00.000Z", type, runId: "r1", payload };
}

describe("inspectCrashBoundary", () => {
  it("空日志不存疑", () => {
    assert.equal(inspectCrashBoundary([]).inDoubt, false);
  });

  it("tool_call 后崩溃判 inDoubt 且带 pendingToolCall", () => {
    const r = inspectCrashBoundary([ev("tool_call", { name: "artifact_create", id: "call_1" })]);
    assert.equal(r.inDoubt, true);
    assert.equal(r.lastType, "tool_call");
    assert.deepEqual(r.pendingToolCall, { name: "artifact_create", id: "call_1" });
  });

  it("model_call 后崩溃可安全重试", () => {
    const r = inspectCrashBoundary([ev("model_call")]);
    assert.equal(r.inDoubt, true);
    assert.equal(r.lastType, "model_call");
    assert.match(r.reason ?? "", /可安全重试/);
  });

  it("thinking/reply 与 model_call 同类：仍判 inDoubt、走续跑门禁", () => {
    for (const t of ["thinking", "reply"] as const) {
      const r = inspectCrashBoundary([ev(t)]);
      assert.equal(r.inDoubt, true, `${t} 应判 inDoubt`);
      assert.equal(r.lastType, t);
      assert.match(r.reason ?? "", /可安全重试/);
    }
  });

  it("run_end/receipt 后不存疑", () => {
    assert.equal(inspectCrashBoundary([ev("run_end")]).inDoubt, false);
    assert.equal(inspectCrashBoundary([ev("receipt")]).inDoubt, false);
  });
});
