import assert from "node:assert/strict";
import { test } from "node:test";
import { listSkillFiles, loadSkill } from "./skills.ts";
import { getAgent, listAgents } from "./registry.ts";
import {
  DUANJU_STAGE_SKELETON,
  FEMALE_LONG_STAGES,
  IP_ADAPT_STAGES,
  MALE_LONG_STAGES,
  MANJU_STAGES,
  SHORT_NOVEL_STAGES,
} from "./stages.ts";

const REQUIRED_SECTIONS = ["角色", "输入", "步骤", "输出", "硬约束"];

test("skills count and frontmatter quality", () => {
  const files = listSkillFiles();
  assert.ok(files.length >= 40, `expected >=40 skills, got ${files.length}`);

  const thin: string[] = [];
  const missingSection: string[] = [];
  for (const f of files) {
    const rel = f.includes("/skills/") ? f.split("/skills/")[1] : f;
    const skill = loadSkill(`skills/${rel}`);
    assert.ok(skill.name, `missing name: ${rel}`);
    assert.ok(skill.description.length >= 8, `thin description: ${rel}`);
    if (skill.body.length < 400 && !rel.includes("_meta")) {
      thin.push(rel);
    }
    for (const sec of REQUIRED_SECTIONS) {
      if (!skill.body.includes(sec) && !rel.includes("_meta")) {
        missingSection.push(`${rel}:${sec}`);
      }
    }
  }
  assert.deepEqual(thin, [], `skills too thin (<400 chars body):\n${thin.join("\n")}`);
  assert.deepEqual(
    missingSection,
    [],
    `skills missing required sections:\n${missingSection.join("\n")}`,
  );
});

test("registered agents point to existing skills", () => {
  const agents = listAgents();
  assert.ok(agents.length >= 30, `expected >=30 agents, got ${agents.length}`);
  for (const a of agents) {
    const skill = loadSkill(a.skillPath);
    assert.ok(skill.body.length > 0, `empty skill for ${a.id}`);
  }
});

test("manju stage agents are registered", () => {
  for (const stage of MANJU_STAGES) {
    for (const id of stage.agentIds) {
      assert.ok(getAgent(id), `manju stage ${stage.id} missing agent ${id}`);
    }
  }
});

test("duanju stage agents are registered", () => {
  for (const stage of DUANJU_STAGE_SKELETON) {
    for (const id of stage.agentIds) {
      assert.ok(getAgent(id), `duanju stage ${stage.id} missing agent ${id}`);
    }
  }
  assert.ok(getAgent("topic.want_how"));
  assert.ok(getAgent("struct.beat20"));
  assert.ok(getAgent("scene.triple"));
  assert.ok(getAgent("qc.revise20"));
});

test("male_long stage agents are registered", () => {
  for (const stage of MALE_LONG_STAGES) {
    for (const id of stage.agentIds) {
      assert.ok(getAgent(id), `male_long stage ${stage.id} missing agent ${id}`);
    }
  }
});

test("short female ip stage agents are registered", () => {
  for (const [label, stages] of [
    ["short_novel", SHORT_NOVEL_STAGES],
    ["female_long", FEMALE_LONG_STAGES],
    ["ip_adapt", IP_ADAPT_STAGES],
  ] as const) {
    assert.ok(stages.length >= 8, `${label} stages too few`);
    for (const stage of stages) {
      for (const id of stage.agentIds) {
        assert.ok(getAgent(id), `${label} stage ${stage.id} missing agent ${id}`);
      }
    }
  }
});

test("core manju skills encode handbook constraints", () => {
  const hook = loadSkill("skills/manju/core-hook/SKILL.md");
  assert.match(hook.body, /四步|金手指|开篇结构/);
  assert.match(hook.body, /10/);

  const outline = loadSkill("skills/manju/episode-outline/SKILL.md");
  assert.match(outline.body, /爽点|卡点/);

  const storyboard = loadSkill("skills/manju/storyboard/SKILL.md");
  assert.match(storyboard.body, /800|1200|分镜|小说/);

  const deai = loadSkill("skills/quality/de-ai-v3.8/SKILL.md");
  assert.match(deai.body, /20\s*字|比喻|自查/);

  const swap = loadSkill("skills/swap/master/SKILL.md");
  assert.match(swap.body, /一度|二度|六大/);
});

test("prompt skill shortlist prioritizes active domain and task relevance independent of source order", async () => {
  const { selectRelevantSkills } = await import("./skills.ts");
  const entries = [
    { name: "Unrelated", description: "payment report", category: "ip", relativePath: "ip/payments/SKILL.md" },
    { name: "Body", description: "episode body writing", category: "manju", relativePath: "manju/body/SKILL.md" },
    { name: "Episode outline", description: "episode structure", category: "manju", relativePath: "manju/episode-outline/SKILL.md" },
    { name: "Character", description: "character dialogue", category: "character", relativePath: "character/dialogue/SKILL.md" },
  ];
  const opts = { activePath: "manju/body/SKILL.md", query: "episode outline", format: "manju", limit: 2 };
  const selected = selectRelevantSkills(entries, opts);
  assert.deepEqual(selected.map(e => e.name), ["Body", "Episode outline"]);
  assert.deepEqual(selectRelevantSkills([...entries].reverse(), opts), selected);
});

test("editorial prompts preserve author choice in source and served catalog", async () => {
  const { readFile } = await import("node:fs/promises");
  const catalog = JSON.parse(await readFile(new URL("../skills/catalog.json", import.meta.url), "utf8"));
  for (const [id, imperative] of [
    ["manju/qa-correct", /按集纲卡点类型重写集尾|强制留钩/],
    ["short_novel/opening-attract", /前 3 段必须出现|无钩子不得宣称过门|打回精简/],
    ["duanju/structure/ep-outline-cool", /爽点不得连续 3 集/],
  ] as const) {
    const body = loadSkill(`skills/${id}/SKILL.md`).body;
    assert.doesNotMatch(body, imperative);
    assert.match(body, /用户明确要求/);
    assert.equal(catalog.skills.find((entry: { id: string }) => entry.id === id)?.body, body);
  }
});

const hookSkillCases = [
  {
    id: "manju/core-hook",
    editorialMandates: /沙雕\/强脑洞更易过稿|从主流池选|禁止(?:金手指无敌|谜题壳当主壳)/,
    required: [/作者明确要求/, /职业.{0,24}(?:知识|资源)/, /课程.{0,24}(?:示例|举例)/,
      /prompt_validate_lock\(\{promptId: "manju\.hook\.batch"\}\)/, /恰好 10/, /纯字符串数组/,
      /"goldfinger_limit"/, /artifact_create/, /Schema \+ ChunkPolicy/],
    gates: ["Schema", "ChunkPolicy"],
  },
  {
    id: "manju/core-hook-critic",
    editorialMandates: /硬淘汰|任一即淘汰|必须拉开差距|底部.{0,10}淘汰/,
    required: [/作者明确要求/, /同分/, /证据/, /不确定|待核实/, /expectedVersion/, /reviews/,
      /全批 rank/, /保持正文与采纳状态/, /建议采用.{0,12}可改后再评.{0,12}淘汰/,
      /独立于排名|建议.{0,18}不受排名/, /采纳由作者确认/],
    gates: ["Schema"],
  },
];

for (const { id, editorialMandates, required, gates } of hookSkillCases) {
  test(`${id} preserves the writing contract and leaves creative decisions to the author`, async () => {
    const { readFile } = await import("node:fs/promises");
    const catalog = JSON.parse(await readFile(new URL("../skills/catalog.json", import.meta.url), "utf8"));
    const skill = loadSkill(`skills/${id}/SKILL.md`);
    const served = catalog.skills.find((entry: { id: string }) => entry.id === id);
    assert.equal(served?.body, skill.body);
    assert.equal(served?.description, skill.description);
    assert.deepEqual(served?.gates, gates);
    assert.deepEqual(skill.gates, gates);
    assert.deepEqual(skill.locks, ["no_whole_book", "format_switch"]);
    assert.doesNotMatch(skill.body, editorialMandates);
    for (const contract of required) assert.match(skill.body, contract);
  });
}
