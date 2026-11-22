import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkBeatCompleteness,
  checkComedyDose,
  checkDialogueFormula,
  checkEightTropeCoverage,
  checkFemaleOmniscience,
  checkMidpointPosition,
  checkPayMotive,
  checkRedlineHard,
  checkRelationDriver,
  checkSceneTriple,
  checkShellGate,
  checkSimilarityRisk,
  checkVoiceDiversity,
  normalizeGateName,
  runGateBattery,
} from "./gates.extended.ts";
import { allPassed } from "./gates.ts";

test("scene triple requires three fields", () => {
  assert.equal(checkSceneTriple({}).result, "fail");
  assert.equal(
    checkSceneTriple({ goal: "要钥匙", conflict: "反派拦路", turn: "反杀" }).result,
    "pass",
  );
});

test("beat completeness", () => {
  assert.equal(checkBeatCompleteness([], 20).result, "fail");
  const beats = Array.from({ length: 20 }, (_, i) => ({ summary: `拍${i + 1}` }));
  assert.equal(checkBeatCompleteness(beats, 20).result, "pass");
});

test("shell and pay motive", () => {
  assert.equal(checkShellGate("复仇壳").result, "pass");
  assert.equal(checkShellGate("").result, "fail");
  assert.equal(checkPayMotive({ want: "爽", how: "打脸", via_what: "系统" }).result, "pass");
});

test("redline hard", () => {
  assert.equal(checkRedlineHard("普通剧情").result, "pass");
  assert.ok(allPassed(runGateBattery("GenderPath", { path: "男频" })));
  assert.ok(!allPassed(runGateBattery("HumanConfirm", { acked: false })));
});

test("eight trope / midpoint / similarity battery", () => {
  assert.equal(checkEightTropeCoverage(["打脸", "误会", "反转"], 3).result, "pass");
  assert.equal(checkMidpointPosition({ midpoint: "身份反转" }).result, "pass");
  assert.equal(checkSimilarityRisk(0.8).result, "warn");
  assert.equal(checkSimilarityRisk(0.4).result, "pass");
  assert.ok(allPassed(runGateBattery("EightTropeCoverage", { tropes: ["a", "b", "c"] })));
  assert.ok(allPassed(runGateBattery("MidpointPosition", { body: { midpoint: "真相半露" } })));
});

test("dialogue / voice / female omniscience", () => {
  assert.equal(
    checkDialogueFormula({ attitude: "冷", info: "合同", subtext: "试探" }).result,
    "pass",
  );
  assert.equal(checkVoiceDiversity(0.6).result, "warn");
  assert.equal(checkFemaleOmniscience({ text: "普通对白" }).result, "pass");
  assert.equal(checkFemaleOmniscience({ text: "其实真相是她早知道" }).result, "fail");
});

test("doc04 soft gates: puzzle / goldfinger / classic / show", () => {
  assert.equal(
    runGateBattery("PuzzleShellGate", {
      body: { shell: "谜题", puzzleReason: "短" },
    })[0].result,
    "fail",
  );
  assert.ok(
    allPassed(
      runGateBattery("PuzzleShell", {
        body: { shell: "升级", reason: "n/a" },
      }),
    ),
  );
  assert.equal(
    runGateBattery("GoldFingerMinimal", {
      body: { goldFinger: "x".repeat(300) },
    })[0].result,
    "warn",
  );
  assert.equal(
    runGateBattery("ClassicNarrativeGate", {
      body: { leadCount: 2 },
    })[0].result,
    "fail",
  );
  assert.equal(
    runGateBattery("ShowDontTell", {
      text: "他很愤怒。她很伤心。气氛很紧张。终于明白了。",
    })[0].result,
    "warn",
  );
  assert.equal(
    runGateBattery("HotTopicDepthGate", {
      body: { hotspot: "热搜A", emotion: "" },
    })[0].result,
    "fail",
  );
  assert.ok(
    allPassed(
      runGateBattery("CoreHookComplete", {
        body: {
          world: "末世",
          identity: "弃子实为掌局",
          goldFinger: "限次透视",
          hook: "揭身份",
        },
      }),
    ),
  );
});

test("gate name normalization: snake_case → CamelCase", () => {
  assert.equal(normalizeGateName("format_selected"), "FormatSelected");
  assert.equal(normalizeGateName("chunk_policy"), "ChunkPolicy");
  assert.equal(normalizeGateName("deai_checklist"), "DeAIChecklist");
  assert.equal(normalizeGateName("length_band"), "LengthBand");
  // 已 CamelCase（含大写且无分隔符）原样返回
  assert.equal(normalizeGateName("DeAIChecklist"), "DeAIChecklist");
  assert.equal(normalizeGateName("FormatSelected"), "FormatSelected");
});

test("battery dispatches snake_case gate names (no more silent inconclusive)", () => {
  assert.ok(allPassed(runGateBattery("format_selected", { format: "manju" })));
  assert.ok(allPassed(runGateBattery("chunk_policy", { requested_chars: 1000 })));
  assert.ok(!allPassed(runGateBattery("logic_ack", { acked: false })));
  assert.equal(runGateBattery("prompt_lock", { lockedSystem: "", lockedHash: "" })[0].result, "fail");
});

test("unknown gate returns fail, not inconclusive", () => {
  const checks = runGateBattery("totally_unknown_gate", {});
  assert.equal(checks[0].result, "fail");
  assert.ok(!allPassed(checks));
});

test("CoreHookAdoption / Budget gates wired into battery", () => {
  assert.ok(
    allPassed(
      runGateBattery("CoreHookAdoption", {
        body: { motivation: "复仇", openingStructure: "先婚后爱" },
      }),
    ),
  );
  assert.equal(
    runGateBattery("core_hook_adoption", { body: { motivation: "", openingStructure: "" } })[0]
      .result,
    "fail",
  );
  assert.ok(allPassed(runGateBattery("budget", { used: 100, budget: 1000 })));
  assert.equal(runGateBattery("Budget", { used: 1000, budget: 1000 })[0].result, "fail");
});

test("comedy dose / relation driver", () => {
  assert.equal(
    checkComedyDose({
      dose: "整部",
      pay_model: "重付费",
      yy_intensity: "强",
    }).result,
    "warn",
  );
  assert.equal(
    checkComedyDose({
      dose: "元素",
      pay_model: "重付费",
      yy_intensity: "强",
      comedy_inserts: [{ offense: "当众破防", distance: "闹剧窗", superiority: "" }],
    }).result,
    "warn",
  );
  assert.equal(checkRelationDriver({}).result, "fail");
  assert.equal(
    checkRelationDriver({
      a_motive: "夺回股份",
      b_motive: "隐瞒身份",
      escalation: "婚礼对峙",
    }).result,
    "pass",
  );
  assert.ok(
    allPassed(
      runGateBattery("ComedyDoseGate", {
        body: {
          dose: "一人物",
          comedy_cast_count: 1,
          offense: "口误连环",
        },
      }),
    ),
  );
});

test("course ShellGate validates stored fields and payment constraints", () => {
 const body = {story_shell:"困境",shell_reason:"危机逼迫主角作决定",pay_model:"重付费",midpoint_type:"错应对对应对"};
 const gate = (fields: Record<string, unknown>) => runGateBattery("ShellGate",{body:fields})[0].result;
 assert.equal(gate(body),"pass");
 assert.equal(gate({...body,story_shell:"谜题",midpoint_type:"找答案→解谜面"}),"warn");
 assert.equal(gate({...body,pay_model:"轻付费",story_shell:"谜题",midpoint_type:"找答案→解谜面"}),"pass");
 assert.equal(gate({...body,shell_reason:""}),"fail");
});

test("rule field count alone cannot measure rule length",()=>{
 const [result]=runGateBattery("GoldFingerMinimal",{body:{ruleFieldCount:2}});
 assert.equal(result.result,"warn");
 assert.match(result.message,/篇幅未评估/);
 assert.match(result.message,/字段数 2/);
 assert.doesNotMatch(result.message,/字数 0/);
});
