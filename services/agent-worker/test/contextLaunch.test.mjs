import assert from "node:assert/strict";
import { test } from "node:test";
import { listAgents, loadSkill } from "@xiezuomanju/agent-runtime";
import { buildAgentSystemSlots } from "../src/runSession.js";

test("every registered agent assembles a bounded active-skill prompt with intact critical slots", () => {
  const agents = listAgents();
  assert.ok(agents.length > 30);
  for (const agent of agents) {
    const skill = loadSkill(agent.skillPath);
    for (const progressiveSkills of [true, false]) {
      const prompt = buildAgentSystemSlots(agent, skill, { progressiveSkills }, { coreFacts: "必须保留锁定决策尾部", format: agent.format?.[0] });
      assert.ok(prompt.system.includes("必须保留锁定决策尾部"), agent.id);
      assert.ok(prompt.slots.filter(slot => ["contract", "core_facts"].includes(slot.id)).every(slot => !slot.truncated), agent.id);
      if (progressiveSkills) {
        const catalog = prompt.slots.find(slot => slot.id === "skill_catalog");
        assert.ok(catalog.text.includes(skill.name), agent.id);
        assert.ok(catalog.text.split("\n").filter(line => line.startsWith("- ")).length <= 8, agent.id);
      }
    }
  }
});

test("approval authority survives ordinary, scoped and scout prompts without implying approval", () => {
  for (const agent of listAgents()) {
    const skill = loadSkill(agent.skillPath);
    for (const progressiveSkills of [true, false]) {
      for (const flags of [{}, { scopedRole: true }, { scopedRole: true, scout: true }]) {
        const options = { ...flags, now: new Date("2026-11-21T00:00:00Z") };
        const prompt = buildAgentSystemSlots(agent, skill, { progressiveSkills }, options);
        const contract = prompt.slots.find(slot => slot.id === "contract");
        const label = `${agent.id}/${progressiveSkills}/${JSON.stringify(flags)}`;
        assert.match(contract.text, /状态.*记录时点/, label);
        assert.match(contract.text, /持久化审批.*QA.*签阅/, label);
        assert.match(contract.text, /项目、审批类型和来源版本/, label);
        assert.match(contract.text, /查不到、范围或版本不匹配.*待确认/, label);
        assert.match(contract.text, /无权读取.*无法核实/, label);
        assert.equal(contract.truncated, false, label);
        if (flags.scopedRole) {
          assert.equal(prompt.slots.find(slot => slot.id === "skill_catalog")?.text ?? "", "", label);
          assert.equal(prompt.slots.find(slot => slot.id === "tool_index")?.text ?? "", "", label);
          const otherTask = buildAgentSystemSlots(agent, skill, { progressiveSkills }, {
            ...flags, task: "另一任务", coreFacts: "另一项目", now: new Date("2026-11-22T00:00:00Z"),
          });
          assert.equal(prompt.staticPrefixHash, otherTask.staticPrefixHash, label);
        }
      }
    }
  }
});
