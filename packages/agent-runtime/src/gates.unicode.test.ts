import assert from "node:assert/strict";
import { test } from "node:test";
import { checkLogline100Ack } from "./gates.ts";
import { checkCoreHookAdoption, checkDialogueLen, checkEpisodeStandalone, checkFormatContract, checkGoldFingerMinimal, checkHotTopicDepth, checkPuzzleShell, checkTitleClarity } from "./gates.extended.ts";

test("human logline acknowledgment is mandatory regardless of text length", () => {
  for (const text of ["😀".repeat(61), "中".repeat(130)]) {
    assert.equal(checkLogline100Ack(false, text).result, "fail");
  }
  assert.equal(checkLogline100Ack(true, "😀".repeat(61)).result, "pass");
  assert.equal(checkLogline100Ack(true, "😀".repeat(121)).result, "warn");
});

test("minimum text lengths count emoji once for episode, puzzle reason, and emotion", () => {
  const episode = { scene_header: "场景1", triple: { info: "线索", progress: "推进", change: "变化" }, clip_candidate: "钩子" };
  assert.equal(checkEpisodeStandalone({ ...episode, script_body: "😀".repeat(60) }).result, "fail");
  assert.equal(checkEpisodeStandalone({ ...episode, script_body: "😀".repeat(120) }).result, "pass");
  assert.equal(checkPuzzleShell({ shell: "谜题", reason: "😀".repeat(6) }).result, "fail");
  assert.equal(checkPuzzleShell({ shell: "谜题", reason: "😀".repeat(12) }).result, "pass");
  assert.equal(checkHotTopicDepth({ hotspot: "热点", emotion: "😀😀" }).result, "fail");
  assert.equal(checkHotTopicDepth({ hotspot: "热点", emotion: "😀😀😀😀" }).result, "pass");
});

test("maximum text lengths count codepoints for titles, dialogue and ability rules", () => {
  assert.equal(checkTitleClarity("😀".repeat(13)).result, "pass");
  assert.equal(checkTitleClarity("😀".repeat(25)).result, "fail");
  assert.equal(checkDialogueLen("😀".repeat(251)).result, "pass");
  assert.equal(checkDialogueLen("😀".repeat(501)).result, "fail");
  assert.equal(checkGoldFingerMinimal({ rule: "😀".repeat(141) }).result, "pass");
  assert.equal(checkGoldFingerMinimal({ rule: "😀".repeat(281) }).result, "warn");
});

test("format contract's 200-character threshold counts emoji once", () => {
  assert.equal(checkFormatContract("心中暗想不禁想到" + "😀".repeat(100), "manju").result, "pass");
  assert.equal(checkFormatContract("心中暗想不禁想到" + "😀".repeat(200), "manju").result, "fail");
});

test("empty camelCase risk array does not mask populated snake_case advisory", () => {
  const checks = checkCoreHookAdoption({ motivation: "动机", openingStructure: "开篇", riskFlags: [], risk_flags: ["风险"] });
  assert.equal(checks.find(c => c.id === "risk")?.result, "warn");
});
