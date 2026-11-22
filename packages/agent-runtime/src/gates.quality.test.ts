import { test } from "node:test";
import assert from "node:assert/strict";
import { checkHookPresence } from "./gates.ts";
import { checkDeAIChecklist, runGateBattery } from "./gates.extended.ts";

test("hook keywords and question marks cannot decide substantive suspense", () => {
  for (const text of ["他解开最后一道锁，箱中放着十年前自己的死亡证明。", "突然？", "下集悬念钩子", "他关门离开。"])
    assert.equal(checkHookPresence(text).result, "warn");
  assert.equal(checkHookPresence("正文", true).result, "pass");
  assert.equal(checkHookPresence("突然？", false).result, "warn");
});

test("style phrases advise without failing valid prose; quotes are contextual", () => {
  assert.equal(checkDeAIChecklist("月色宛如薄霜，河水犹如碎银，他不禁停步。").result, "warn");
  assert.equal(checkDeAIChecklist("“综上所述，值得注意的是。”").result, "pass");
  assert.equal(checkDeAIChecklist("个人口头禅", ["口头禅"]).result, "warn");
  assert.equal(runGateBattery("Schema", { body: {}, required: ["title"] })[0].result, "fail");
});

test("novelization markers leave both dialogue and narration available for contextual review", () => {
  for (const text of ["△哥哥把房契压在桌上。\n妹妹：他想卖房，她想留下。你倒好，连内心独白都替人写好了。", "他想她想得明白，内心独白如潮。"]) {
    const check = runGateBattery("Novelization", { text })[0];
    assert.equal(check.result, "warn");
    assert.match(check.message, /第[12]行「.*他想.*可拍性/s);
  }
});

test("lexical suspicion covers prohibitive and affirmative contexts", () => {
  for (const text of ["班主任：我们讨论的是如何避免美化自残。", "他要求美化自残。"]) {
    assert.equal(runGateBattery("RedlineHard", { text })[0].result, "warn");
  }
});

import { AGENT_REGISTRY } from "./registry.ts";
import { evaluateDoneContract } from "./doneContract.ts";

test("storyboard and revision contracts close on current manuscript delivery", () => {
  for (const id of ["prose.storyboard", "qc.de_ai"]) {
    const contract = AGENT_REGISTRY.find(agent => agent.id === id)!.doneContract!;
    const successfulTools = new Set(["artifact_create"]);
    assert.equal(evaluateDoneContract(contract, {successfulTools}).ok, false);
    assert.equal(evaluateDoneContract(contract, {successfulTools, artifactCounts: {manuscript: 1}}).ok, true);
  }
});
