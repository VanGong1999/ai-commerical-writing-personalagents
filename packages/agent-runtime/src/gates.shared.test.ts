import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import * as extended from "./gates.extended.ts";
import { checkMidpointIndex } from "./gates.extended.ts";
import { allPassed, checkPromptLockHash, simpleHash } from "./gates.ts";
import { checkCoreHookAdoption as frontendAdoption } from "../../domain/src/gates.ts";

test("PromptLock battery blocks missing phrases for camelCase and snake_case payloads", () => {
  for (const payload of [
    { lockedSystem: "locked", lockedHash: simpleHash("locked"), editableInstruction: "动机", requiredPhrases: ["开篇"] },
    { current_locked_system: "locked", locked_hash: simpleHash("locked"), editable_instruction: "动机", required_phrases: ["开篇"] },
  ]) {
    assert.equal(allPassed(extended.runGateBattery("PromptLock", payload)), false);
  }
});

test("shared browser SHA256 matches Node across Unicode and padding boundaries", () => {
  for (const value of ["", "abc", "锁定😀", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(1000)]) {
    const expected = `h${createHash("sha256").update(value).digest("hex").slice(0, 12)}`;
    assert.equal(simpleHash(value), expected);
    assert.equal(checkPromptLockHash(value, expected).result, "pass");
    assert.equal(checkPromptLockHash(value + "!", expected).result, "fail");
  }
});

test("runtime adoption keeps aliases and intentional frontend requirements separate", () => {
  assert.deepEqual(extended.checkCoreHookAdoption({ candidate: { motivation: "动机", opening_structure: "开篇", risk_flags: ["风险"] } }).map(c => [c.id, c.result]), [
    ["motivation", "pass"], ["opening", "pass"], ["risk", "warn"],
  ]);
  const minimal = { motivation: "动机", openingStructure: "开篇", riskFlags: [] };
  assert.equal(allPassed(extended.checkCoreHookAdoption(minimal)), true);
  assert.equal(allPassed(frontendAdoption(minimal as Parameters<typeof frontendAdoption>[0], "strong")), false);
  assert.equal(allPassed(extended.checkCoreHookAdoption({ motivation: {}, opening_structure: [] })), false);
});

test("numeric midpoint preserves Python's inclusive recommendation boundaries", () => {
  for (const [index, expected] of [[null, "fail"], [7, "warn"], [8, "pass"], [13, "pass"], [14, "warn"]] as const) {
    assert.equal(checkMidpointIndex(index).result, expected);
  }
  assert.equal(checkMidpointIndex(4, 10).result, "pass");
  assert.equal(extended.checkMidpointPosition({ midpoint: "真相半露" }).result, "pass");
});

test("MidpointPosition battery accepts numeric index and retains categorical bodies", () => {
  for (const [payload, expected] of [
    [{ index: 10 }, "pass"], [{ index: 2 }, "warn"], [{ index: 4, total: 10 }, "pass"],
    [{ index: null, body: { midpoint: "真相半露" } }, "fail"],
    [{ body: { midpoint: "真相半露" } }, "pass"],
  ] as const) {
    assert.equal(extended.runGateBattery("MidpointPosition", payload)[0].result, expected);
  }
});

test("nonempty string riskFlags remain visible as warnings", () => {
  const checks = extended.checkCoreHookAdoption({ motivation: "动机", opening_structure: "开篇", riskFlags: "risk" });
  assert.equal(checks.find(c => c.id === "risk")?.result, "warn");
  assert.match(checks.find(c => c.id === "risk")!.message, /risk/);
});

test("battery zero limits retain legacy defaults without changing direct explicit zero", () => {
  assert.equal(extended.runGateBattery("SceneCount", { text: "场景1：客厅 日", max_scenes: 0 })[0].result, "pass");
  assert.equal(extended.checkSceneCount("场景1：客厅 日", 0).result, "fail");
  assert.equal(extended.runGateBattery("ChunkPolicy", { requested_chars: 100, max_chars: 0 })[0].result, "pass");
  assert.equal(extended.runGateBattery("ChunkPolicy", { requested_chars: 3001, max_chars: 0 })[0].result, "fail");
});

test("required fields and cool markers reject empty JSON content", () => {
  for (const missing of [false, 0, null, [], {}, "", "  "]) {
    assert.equal(extended.checkRequiredFields({ text: missing }, ["text"], "required", "字段").result, "fail");
    assert.equal(extended.checkCoolFocus({ cool_focus: missing }).result, "fail");
    assert.equal(extended.checkCoolPerEp({ cool_per_ep: missing }).result, "fail");
  }
  for (const content of [true, 1, "有效内容", ["内容"], { text: "内容" }]) {
    assert.equal(extended.checkRequiredFields({ text: content }, ["text"], "required", "字段").result, "pass");
    assert.equal(extended.checkCoolFocus({ cool_focus: content }).result, "pass");
    assert.equal(extended.checkCoolPerEp({ cool_per_ep: content }).result, "pass");
  }
});

test("Revise20 rejects empty JSON pass flags while retaining explicit pass status", () => {
  for (const pass of [false, 0, null, [], {}, ""]) {
    assert.equal(extended.checkRevise20Pass(Array.from({ length: 20 }, () => ({ pass }))).result, "fail");
  }
  for (const status of ["fail", "warn", "inconclusive", false, [], {}]) {
    assert.equal(extended.checkRevise20Pass(Array.from({ length: 20 }, () => ({ status }))).result, "fail");
  }
  assert.equal(extended.checkRevise20Pass(Array.from({ length: 20 }, () => ({ status: "PASS" }))).result, "pass");
  assert.equal(extended.checkRevise20Pass(Array.from({ length: 20 }, () => ({ pass: true }))).result, "pass");
});

test("human approval gates require explicit true even for malformed JSON flags", () => {
  for (const name of ["LogicAck", "HumanConfirm", "Logline100Ack", "PriorityLock"]) {
    for (const acked of [[], {}, false, "false"]) {
      assert.equal(extended.runGateBattery(name, { acked, logline: "测试文案" })[0].result, "fail", `${name}: ${JSON.stringify(acked)}`);
    }
    assert.equal(extended.runGateBattery(name, { acked: true, logline: "测试文案" })[0].result, "pass");
  }
});
