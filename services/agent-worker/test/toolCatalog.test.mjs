import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TOOL_CATALOG,
  CORE_TOOL_NAMES,
  catalogNames,
  getCatalogEntry,
  resolveToolAccess,
  searchCatalog,
  formatCategoryIndexForPrompt,
} from "../src/toolCatalog.js";

const HERE = dirname(fileURLToPath(import.meta.url));

test("每个目录项有 snake_case 名、category、keywords、risk", () => {
  for (const e of TOOL_CATALOG) {
    assert.match(e.name, /^[a-z][a-z0-9_]*$/, `bad name: ${e.name}`);
    assert.ok(e.category, `missing category: ${e.name}`);
    assert.ok(Array.isArray(e.keywords) && e.keywords.length > 0, `keywords: ${e.name}`);
    assert.ok(["read", "write", "meta"].includes(e.risk), `risk: ${e.name}`);
  }
  const names = catalogNames();
  assert.equal(new Set(names).size, names.length, "duplicate catalog names");
});

test("CORE_TOOL_NAMES 覆盖关键交付路径", () => {
  for (const n of [
    "tool_search",
    "skill_read",
    "artifact_create",
    "artifact_list",
    "bible_read",
    "memory_search",
    "gate_run",
    "done_check",
  ]) {
    assert.ok(CORE_TOOL_NAMES.includes(n), n);
  }
});

test("目录覆盖 tools.js 中注册的工具名", () => {
  const src = readFileSync(join(HERE, "../src/tools.js"), "utf8");
  const registered = [
    ...src.matchAll(/^\s*name:\s*"([a-z0-9_]+)"/gm),
  ].map((m) => m[1]);
  const unique = [...new Set(registered)];
  const cat = new Set(catalogNames());
  const missing = unique.filter((n) => !cat.has(n));
  assert.deepEqual(missing, [], `catalog missing: ${missing.join(", ")}`);
});

test("写类不在 allowlist 时不可搜", () => {
  const { searchable, callable } = resolveToolAccess({
    allowlist: ["scan_length"],
    securityMode: "safe",
  });
  assert.ok(searchable.has("scan_length"));
  assert.ok(searchable.has("gate_run")); // core
  assert.ok(searchable.has("want_how_concretize")); // read deferred
  assert.equal(searchable.has("bible_write"), false);
  assert.equal(callable.has("bible_write"), false);
  assert.ok(getCatalogEntry("artifact.create")?.name === "artifact_create" || getCatalogEntry("artifact_create"));
});

test("中文关键词能搜到工具", () => {
  const hits = searchCatalog("20节拍");
  assert.ok(hits.some((h) => h.name === "beat20_scaffold"), JSON.stringify(hits));
  const hits2 = searchCatalog("去AI味");
  assert.ok(hits2.some((h) => h.name === "scan_banned_phrases"));
});

test("类别索引非空", () => {
  const text = formatCategoryIndexForPrompt();
  assert.match(text, /结构/);
  assert.match(text, /tool_search/);
});

test("lesson_note 对所有 Agent 可搜可调（仅写自己的私有经验）", () => {
  const { searchable, callable } = resolveToolAccess({ allowlist: [], securityMode: "safe" });
  assert.ok(searchable.has("lesson_note"));
  assert.ok(callable.has("lesson_note"));
  assert.equal(callable.has("bible_write"), false);
});
