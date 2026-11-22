import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertParallelSize,
  assertSubagentDepth,
  resolveSubagent,
  DEFAULT_SUBAGENT_POLICY,
} from "./subagents.ts";

describe("subagents", () => {
  it("resolves scout with readonly-oriented allowlist", () => {
    const s = resolveSubagent("scout");
    assert.equal(s.role, "scout");
    assert.ok(s.toolsAllowlist?.includes("kb_search"));
    assert.ok(s.toolsAllowlist?.includes("web_search"));
    assert.ok(!s.toolsAllowlist?.includes("bible_write"));
    assert.ok(!s.toolsAllowlist?.includes("artifact_create"));
  });

  it("resolves every builtin role to a concrete agentId", () => {
    for (const role of ["scout", "planner", "worker", "reviewer"] as const) {
      const spec = resolveSubagent(role);
      assert.ok(spec.agentId, `${role} should have a concrete agentId`);
    }
  });

  it("enforces max depth", () => {
    assert.doesNotThrow(() => assertSubagentDepth(DEFAULT_SUBAGENT_POLICY.maxDepth));
    assert.throws(() => assertSubagentDepth(DEFAULT_SUBAGENT_POLICY.maxDepth + 1));
  });

  it("assertParallelSize throws on empty tasks", () => {
    assert.throws(() => assertParallelSize([]), /required/);
  });

  it("assertParallelSize throws when over maxParallel", () => {
    assert.throws(() => assertParallelSize(["a", "b", "c", "d"]), /exceeds max/);
  });

  it("assertParallelSize passes within maxParallel", () => {
    assert.doesNotThrow(() => assertParallelSize(["a", "b", "c"]));
  });
});
