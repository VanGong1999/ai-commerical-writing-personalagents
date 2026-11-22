import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveSkill,
  formatSkillCatalogForPrompt,
  listSkillIndex,
} from "@xiezuomanju/agent-runtime";

test("resolveSkill 接受 relativePath 与 name", () => {
  const byPath = resolveSkill("manju/core-hook/SKILL.md");
  assert.equal(byPath.ok, true);
  const byName = resolveSkill(byPath.entry.name);
  assert.equal(byName.ok, true);
});

test("resolveSkill 拒绝 gates 门禁名", () => {
  const r = resolveSkill("gates/SKILL.md");
  assert.equal(r.ok, false);
  assert.match(r.message, /门禁/);
  const r2 = resolveSkill("LengthBand");
  assert.equal(r2.ok, false);
});

test("formatSkillCatalogForPrompt 含 relativePath 与 gates 警告", () => {
  const text = formatSkillCatalogForPrompt(listSkillIndex(), 8, { format: "manju" });
  assert.match(text, /\|/);
  assert.match(text, /gate_run/);
  assert.match(text, /SKILL\.md/);
});
