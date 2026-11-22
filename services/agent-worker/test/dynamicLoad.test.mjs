import assert from "node:assert/strict";
import { test } from "node:test";
import { CORE_TOOL_NAMES, resolveToolAccess, searchCatalog } from "../src/toolCatalog.js";
import { buildProviderTool } from "../src/toolSchema.js";
import { Type } from "@sinclair/typebox";

test("动态加载：search 只返回 callable，且带 load 候选", () => {
  const { searchable, callable } = resolveToolAccess({
    allowlist: ["scan_length"],
    securityMode: "safe",
  });
  const hits = searchCatalog("字数", { searchable, limit: 5 });
  assert.ok(hits.length >= 1);
  for (const h of hits) assert.ok(callable.has(h.name) || searchable.has(h.name));
  assert.equal(callable.has("bible_write"), false);
});

test("provider schema 非空 object", () => {
  const tool = {
    name: "gate_run",
    description: "run gate",
    parameters: Type.Object({
      name: Type.String(),
      payload: Type.Optional(Type.Object({})),
    }),
  };
  const p = buildProviderTool(tool);
  assert.ok(Object.keys(p.function.parameters.properties || {}).length > 0);
  assert.ok(CORE_TOOL_NAMES.includes("tool_search"));
});
