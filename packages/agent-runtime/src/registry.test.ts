import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_REGISTRY, assertRegistered, CHIEF, getAgent, listAgents } from "./registry.ts";
import {
  checkLogicAck,
  allPassed,
  checkLengthDecay,
  checkLogline100Ack,
  checkPitchFourPack,
  checkOutlineNoEvenActs,
} from "./gates.ts";
import { MANJU_STAGES, nextStages, migrateManjuLockState } from "./stages.ts";
import { listSkillFiles, loadSkill } from "./skills.ts";

test("every agent has unique non-empty persona and team", () => {
  assert.equal(AGENT_REGISTRY.length, 148);
  const personas = AGENT_REGISTRY.map((a) => a.persona?.trim() ?? "");
  assert.ok(personas.every((p) => p.length > 0), "every agent needs non-empty persona");
  assert.equal(new Set(personas).size, personas.length, "personas must be unique");
  assert.ok(
    AGENT_REGISTRY.every((a) => Boolean(a.team?.trim())),
    "every agent needs team",
  );
  assert.equal(CHIEF.persona, "总编");
  assert.equal(CHIEF.team, "编排");
  assert.equal(getAgent("orch.writing")?.persona, "执行主编");
  assert.equal(getAgent("topic.core_hook_batch")?.persona, "灵感猎手");
  assert.equal(getAgent("mem.dreams")?.persona, "梦境策展人");
});

test("agent registry contains manju core path", () => {
  assert.ok(getAgent("topic.core_hook_batch"));
  assert.ok(getAgent("prose.episode_body"));
  assert.ok(getAgent("qc.de_ai"));
  assert.ok(getAgent("deliver.pitch_pack"));
  assert.ok(getAgent("struct.extend_outline"));
  assert.ok(getAgent("struct.cool_expand"));
  assert.ok(getAgent("hook.episode_alts"));
  assert.ok(getAgent("topic.core_hook_critic"));
  assert.ok(getAgent("topic.hotspot"));
  assert.equal(assertRegistered("qc.human_checklist").id, "qc.human_checklist");
  assert.ok(listAgents("manju").length >= 12);
  assert.ok(listAgents("duanju").length >= 10);
});

test("S2_COOL_BATCH includes cool_expand", () => {
  const cool = MANJU_STAGES.find((s) => s.id === "S2_COOL_BATCH");
  assert.ok(cool?.agentIds.includes("struct.cool18"));
  assert.ok(cool?.agentIds.includes("struct.cool_expand"));
  const outline = MANJU_STAGES.find((s) => s.id === "S4_EP10_OUTLINE");
  assert.ok(outline?.agentIds.includes("hook.episode_alts"));
});

test("male_long agents registered", () => {
  assert.ok(getAgent("male.opening"));
  assert.ok(getAgent("male.gold_finger"));
  assert.ok(getAgent("male.upgrade_loop"));
  assert.ok(getAgent("male.cool_density"));
  assert.ok(getAgent("male.risk"));
  assert.ok(listAgents("male_long").length >= 5);
});

test("colleague mem analytics agents registered", () => {
  assert.ok(getAgent("colleague.proactive"));
  assert.ok(getAgent("mem.curator"));
  assert.ok(getAgent("analytics.review"));
  assert.ok(getAgent("mem.dreams"));
  assert.ok(getAgent("harness.refine"));
  assert.ok(getAgent("prose.dialogue_voice"));
});

test("logic ack never auto-passes", () => {
  assert.equal(checkLogicAck(false).result, "fail");
  assert.ok(allPassed([checkLogicAck(true)]));
});

test("manju stage graph ordered — bio before outline", () => {
  assert.ok(MANJU_STAGES.some((s) => s.id === "S1_HOOK_BATCH"));
  const next = nextStages("manju", "S1_HOOK_BATCH");
  assert.equal(next[0]?.id, "S2_HOOK_CRITIC");
  assert.equal(nextStages("manju", "S2_HOOK_SELECT")[0]?.id, "S2_LOGLINE_100");
  assert.equal(nextStages("manju", "S2_COOL_BATCH")[0]?.id, "S3_BIO");
  assert.equal(nextStages("manju", "S3_BIO_ACK")[0]?.id, "S4_EP10_OUTLINE");
  assert.equal(nextStages("manju", "S4_OUTLINE_ACK")[0]?.id, "S5_EP_BODY_BATCH");
  const bioIdx = MANJU_STAGES.findIndex((s) => s.id === "S3_BIO");
  const outlineIdx = MANJU_STAGES.findIndex((s) => s.id === "S4_EP10_OUTLINE");
  assert.ok(bioIdx < outlineIdx, "人设必须排在大纲之前");
});

test("length decay hard-stops short episodes", () => {
  assert.equal(checkLengthDecay({ lengths: [1000, 500] }).result, "fail");
  assert.equal(checkLengthDecay({ currentChars: 600 }).result, "fail");
  assert.equal(checkLengthDecay({ lengths: [1000, 950] }).result, "pass");
});

test("logline100 and pitch four pack gates", () => {
  assert.equal(checkLogline100Ack(false, "短测试").result, "fail");
  assert.equal(checkLogline100Ack(true, "约一百字的受众测试文案").result, "pass");
  assert.equal(
    checkPitchFourPack({ coreHook: 1, character: 1, episodeOutline: 10, manuscript: 3 }).result,
    "pass",
  );
  assert.equal(
    checkPitchFourPack({ coreHook: 1, character: 0, episodeOutline: 10, manuscript: 3 }).result,
    "fail",
  );
  assert.equal(
    checkPitchFourPack({
      format: "ip_adapt",
      adaptAnchorDone: true,
      adaptUnitCount: 1,
      adaptEmotionPoints: 1,
      adaptScriptCount: 1,
    }).result,
    "pass",
  );
  assert.equal(
    checkPitchFourPack({
      format: "ip_adapt",
      adaptAnchorDone: true,
      adaptUnitCount: 0,
      adaptEmotionPoints: 1,
      adaptScriptCount: 1,
    }).result,
    "fail",
  );
  assert.equal(checkOutlineNoEvenActs("本集平均分配起承转合").result, "warn");
});

test("migrate old manju outline-first projects to bio ack", () => {
  const migrated = migrateManjuLockState({
    format: "manju",
    currentStageId: "S3_EP10_OUTLINE",
    completed: ["S0_SETUP", "S1_HOOK_BATCH", "S2_HOOK_SELECT", "S3_EP10_OUTLINE"],
    hasOutlineArtifact: true,
  });
  assert.equal(migrated.currentStageId, "S3_BIO_ACK");
  assert.ok(migrated.migrationHint);
});

test("skills exist on disk", () => {
  const files = listSkillFiles();
  assert.ok(files.length >= 8);
  const skill = loadSkill("skills/manju/core-hook/SKILL.md");
  assert.match(skill.body, /硬约束/);
  assert.ok(getAgent("qc.bible_guard"));
  assert.ok(getAgent("prose.length_decay_fix"));
  assert.ok(getAgent("hook.foreshadow_ledger"));
  assert.ok(getAgent("char.seven_step"));
  assert.ok(getAgent("struct.cool12"));
  assert.ok(getAgent("topic.world_setting"));
});

test("episode writer can revise the same artifact after a failed quality gate", () => {
  assert.ok(getAgent("prose.episode_body")?.tools.includes("artifact_update"));
});

test('world setting requires its saved schema, artifact creation and bible persistence',()=>{
 const contract=getAgent('topic.world_setting')!.doneContract;
 assert.ok(contract.some(c=>c.type==='gate_pass' && !c.gates.includes('GoldFingerMinimal') && c.gates.includes('Schema')));
 for(const tool of ['artifact_create','bible_write']) assert.ok(contract.some(c=>c.type==='tool_success' && c.tool===tool));
});

test("business roles can read relation sources and persist the required bible pack", () => {
  const guard = assertRegistered("qc.bible_guard");
  assert.ok(guard.tools.includes("memory_write"));
  assert.ok(guard.doneContract.some(c => c.type === "tool_success" && c.tool === "memory_write"));
  assert.ok(assertRegistered("char.relation_net").tools.includes("kb_read"));
});
