import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildToolIndex,
  closestToolNames,
  editDistance,
  lookupTool,
  normalizeToolName,
  unknownToolMessage,
} from "../src/toolNames.js";

test("normalizeToolName 把点号名转下划线并小写", () => {
  assert.equal(normalizeToolName("artifact.create"), "artifact_create");
  assert.equal(normalizeToolName("  Bible.Read  "), "bible_read");
  assert.equal(normalizeToolName("gate.run"), "gate_run");
});

test("editDistance 与 closestToolNames 给出 did-you-mean", () => {
  assert.equal(editDistance("artifact_create", "artifact_create"), 0);
  assert.equal(editDistance("memory_list", "memory_list"), 0);
  const names = ["memory_search", "memory_get", "memory_write", "artifact_create"];
  assert.deepEqual(closestToolNames(names, "memory_list"), ["memory_get", "memory_write", "memory_search"]);
});

test("buildToolIndex 同时命中点号与下划线名", () => {
  const tools = [{ name: "artifact_create" }, { name: "bible_read" }];
  const index = buildToolIndex(tools);
  assert.equal(lookupTool(index, "artifact.create")?.name, "artifact_create");
  assert.equal(lookupTool(index, "artifact_create")?.name, "artifact_create");
  assert.equal(lookupTool(index, "Bible.Read")?.name, "bible_read");
});

test("unknownToolMessage 包含候选与指引", () => {
  const msg = unknownToolMessage(
    "memory_list",
    ["memory_search", "memory_get"],
    ["artifact_create", "done_check"],
    2,
  );
  assert.match(msg, /最接近的可用工具：memory_get \/ memory_search/);
  assert.match(msg, /tool_search/);
  assert.match(msg, /第 4 次将熔断/);
});
