import assert from "node:assert/strict";
import { test } from "node:test";

test("old project manuscripts cannot satisfy a new run contract", async () => {
  const { selectCompletionArtifacts } = await import("../src/completionArtifacts.js");
  const artifacts = [{ id: "old", type: "episode_body", createdByRunId: "old-run" }, { id: "new", type: "episode_body", createdByRunId: "current" }];
  assert.deepEqual(selectCompletionArtifacts(artifacts, { runId: "current" }).map(a => a.id), ["new"]);
  assert.deepEqual(selectCompletionArtifacts(artifacts, {}).map(a => a.id), []);
});
test("only explicit existing reuse references and proven successful descendants count", async () => {
  const { selectCompletionArtifacts } = await import("../src/completionArtifacts.js");
  const artifacts = [{ id: "reused", createdByRunId: "old" }, { id: "child", created_by_run_id: "child-run" }, { id: "unrelated", createdByRunId: "other" }];
  assert.deepEqual(selectCompletionArtifacts(artifacts, { runId: "parent", reuseArtifactIds: ["reused"], descendantRunIds: new Set(["child-run"]) }).map(a => a.id), ["reused", "child"]);
  assert.throws(() => selectCompletionArtifacts(artifacts, { runId: "parent", reuseArtifactIds: ["missing"] }), /复用产物/);
  assert.throws(() => selectCompletionArtifacts(artifacts, { runId: "parent", reuseArtifactIds: "reused" }), /复用产物/);
});
test("descendant completion IDs require persisted successful child lineage", async () => {
  const { successfulDescendantRunIds } = await import("../src/completionArtifacts.js");
  const steps = [
    { kind: "subagent", payload: { status: "succeeded", parent_run_id: "parent", child_run_id: "child" } },
    { kind: "subagent", payload: { status: "failed", parent_run_id: "parent", child_run_id: "failed" } },
    { kind: "subagent", payload: { status: "succeeded", parent_run_id: "else", child_run_id: "foreign" } },
  ];
  assert.deepEqual([...successfulDescendantRunIds(steps, "parent")], ["child"]);
});

function childEvent(parent, child, fields) {
  return { kind: "subagent", payload: { spawning_run_id: parent, spawned_run_id: child, ...fields } };
}

test("only children admitted for the effective parent revision count on replay", async () => {
  const { successfulDescendantRunIds } = await import("../src/completionArtifacts.js");
  const steps = [
    childEvent("parent", "original", { phase: "admitted", parentSteerRevision: null }),
    childEvent("parent", "current", { phase: "admitted", parentSteerRevision: "rev-2" }),
    childEvent("parent", "older-ref", { phase: "admitted", parentSteerRevision: "rev-1" }),
    childEvent("parent", "older-ref", { status: "succeeded" }),
    childEvent("parent", "current", { status: "succeeded", parentSteerRevision: "rev-2" }),
    childEvent("parent", "original", { status: "succeeded", parentSteerRevision: null }),
    childEvent("parent", "unadmitted", { status: "succeeded", parentSteerRevision: "rev-2" }),
  ];
  assert.deepEqual([...successfulDescendantRunIds(steps, "parent", "rev-2")], ["current"]);
  assert.deepEqual([...successfulDescendantRunIds(steps, "parent", "rev-1")], ["older-ref"]);
  assert.deepEqual([...successfulDescendantRunIds(steps, "parent")], ["original"]);
});

test("unmarked legacy child success only counts on an unsteered parent", async () => {
  const { successfulDescendantRunIds } = await import("../src/completionArtifacts.js");
  const steps = [childEvent("parent", "legacy", { status: "succeeded" })];
  assert.deepEqual([...successfulDescendantRunIds(steps, "parent")], ["legacy"]);
  assert.deepEqual([...successfulDescendantRunIds(steps, "parent", "rev-2")], []);
});

test("transitive completion follows current successful child branches", async () => {
  const { successfulDescendantRunIds } = await import("../src/completionArtifacts.js");
  const steps = [
    childEvent("parent", "good", { phase: "admitted", parentSteerRevision: "root-rev" }),
    childEvent("good", "grandchild", { phase: "admitted", parentSteerRevision: "child-rev" }),
    childEvent("good", "grandchild", { status: "succeeded", parentSteerRevision: "child-rev" }),
    childEvent("good", "stale-grandchild", { status: "succeeded" }),
    childEvent("parent", "failed", { status: "failed" }),
    childEvent("failed", "orphan", { status: "succeeded" }),
    childEvent("foreign", "unrelated", { status: "succeeded" }),
    childEvent("parent", "good", { status: "succeeded", parentSteerRevision: "root-rev",
      descendant_run_ids: ["grandchild", "orphan", "unrelated"] }),
  ];
  assert.deepEqual([...successfulDescendantRunIds(steps, "parent", "root-rev")], ["good", "grandchild"]);
});
