import assert from "node:assert/strict";
import { test } from "node:test";
import type { CoreHookBody, GateCheck } from "./entities";
import { canStrongAdopt, checkCoreHookAdoption, checkEpisodeHook, checkPromptLock, simpleHash } from "./gates.ts";

const hook = (body: Record<string, unknown>) => body as CoreHookBody;

test("strong adoption rejects fail and inconclusive, permits warnings and legacy empty checks", () => {
  for (const [result, expected] of [["pass", true], ["warn", true], ["fail", false], ["inconclusive", false]] as const) {
    assert.equal(canStrongAdopt([{ id: "x", name: "x", result, message: "x" }] as GateCheck[]), expected);
  }
  assert.equal(canStrongAdopt([]), true);
});

test("frontend adoption requires tags and crisis while draft warns", () => {
  const body = hook({ motivation: "动机", openingStructure: "开篇", riskFlags: [] });
  assert.deepEqual(checkCoreHookAdoption(body, "strong").map(c => [c.id, c.result]), [
    ["motivation", "pass"], ["opening", "pass"], ["tags", "fail"], ["crisis", "fail"],
  ]);
  assert.equal(canStrongAdopt(checkCoreHookAdoption(body, "draft")), true);
  assert.equal(canStrongAdopt(checkCoreHookAdoption(hook({ ...body, tags: ["复仇"], crisis: "危机" }), "strong")), true);
});

test("frontend adoption unwraps a candidate and handles malformed text fields safely", () => {
  const checks = checkCoreHookAdoption(hook({ candidate: { motivation: {}, openingStructure: [], tags: [], crisis: "", riskFlags: [] } }), "strong");
  assert.equal(checks.filter(c => c.result === "fail").length, 4);
});

test("prompt lock validates SHA256 and all phrases with stable browser hash vectors", () => {
  assert.equal(simpleHash(""), "he3b0c44298fc");
  assert.equal(simpleHash("abc"), "hba7816bf8f01");
  const hash = simpleHash("锁定😀");
  assert.equal(checkPromptLock("动机与开篇", ["动机", "开篇"], hash, "锁定😀").every(c => c.result === "pass"), true);
  assert.equal(checkPromptLock("动机", ["开篇"], hash, "已改动").filter(c => c.result === "fail").length, 2);
  assert.deepEqual(checkPromptLock("", [], hash, "锁定😀").map(c => c.id), ["prompt_lock_hash"]);
});

test("episode completion requires the explicit end hook", () => {
  assert.equal(checkEpisodeHook(false).result, "fail");
  assert.equal(checkEpisodeHook(true).result, "pass");
});
