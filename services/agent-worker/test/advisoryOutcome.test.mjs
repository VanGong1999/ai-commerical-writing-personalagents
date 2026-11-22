import assert from "node:assert/strict";
import test from "node:test";
import { createWritingTools } from "../src/tools.js";

const cases = [
  ["suspense_budget_check", {openHooks:["甲","乙","丙","丁"], payoffs:["一","二","三","四"]}, {withinBudget:false}],
  ["one_plus_one_suggest", {openHooks:["谁取走了信"], payoffs:["妹妹承认"]}, {meetsExerciseTarget:false}],
  ["same_loc_task_change_check", {scenes:[{location:"病房",task:"等结果"},{location:"病房",task:"等结果",info:"发现遗嘱"}]}, {sameTaskFlagged:true}],
  ["voice_diversity_score", {bySpeaker:{甲:"我亲眼见他走了",乙:"我亲眼见他走了"}}, {maxOverlap:1}],
  ["ner_realworld", {text:"她问：这是华为吗？"}, {hits:["华为"]}],
  ["duration_risk_flag", {beats:["特写：报纸上印着车祸二字"]}, {durationAssessment:"unknown"}],
  ["hook_100word_check", {text:"她要争夺抚养权", minChars:7,maxChars:7}, {lengthWithinRange:true}],
  ["hook_100word_check", {text:"短", minChars:7,maxChars:7}, {lengthWithinRange:false}],
  ["spec_pitch_validate", {}, {meetsSpec:false}],
  ["spec_pitch_validate", {logline:"字".repeat(121),bioCount:4,outlineCount:10}, {meetsSpec:true}],
];

for (const [name, args, expected] of cases) {
  test(name + " " + JSON.stringify(expected), async () => {
    const tools = createWritingTools({projectId:"fixture",runId:"fixture",allowlist:[name],publish() {}});
    const tool = tools._allGated.find(t => t.name === name);
    for (let i = 0; i < 3; i++) {
      const result = JSON.parse((await tool.execute(String(i), args)).content[0].text);
      assert.equal(result.ok, true);
      assert.ok(!result.isError);
      for (const [field, value] of Object.entries(expected)) assert.deepEqual(result[field], value);
    }
    if (name === "voice_diversity_score") {
      const bad = await tool.execute("invalid", {bySpeaker:{甲:42}});
      assert.equal(JSON.parse(bad.content[0].text).ok, false);
    }
  });
}
