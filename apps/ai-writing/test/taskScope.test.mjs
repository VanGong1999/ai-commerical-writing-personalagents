import assert from "node:assert/strict";
import test from "node:test";
import { instancesInScope } from "../src/features/agent/taskScope.ts";

test("current conversation includes direct and grouped work and excludes other conversations", () => {
  const instances = [
    { runId: "direct", conversationId: "here" },
    { runId: "grouped", taskGroupId: "group" },
    { runId: "member" },
    { runId: "other", conversationId: "elsewhere" },
  ];
  const groups = [{ id: "group", runs: [{runId: "member"}] }];
  assert.deepEqual(instancesInScope(instances, groups, "here"), instances.slice(0, 3));
  assert.deepEqual(instancesInScope(instances, groups), instances);
});
