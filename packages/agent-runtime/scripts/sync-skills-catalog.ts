/**
 * Scan every skills/.../SKILL.md and rewrite skills/catalog.json.
 * Source of truth = on-disk SKILL.md files.
 * Run: pnpm --filter @xiezuomanju/agent-runtime run sync-skills-catalog
 */
import { writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { listSkillFiles, loadSkill, SKILLS_ROOT } from "../src/skills.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "skills", "catalog.json");

const files = listSkillFiles().sort((a, b) => a.localeCompare(b));
const skills = files.map((abs) => {
  const relFromSkills = relative(SKILLS_ROOT, abs).replace(/\\/g, "/");
  const folder = relFromSkills.replace(/\/SKILL\.md$/, "");
  const id = folder === "." ? "_meta" : folder;
  const skill = loadSkill(abs);
  return {
    id,
    name: skill.name,
    description: skill.description,
    gates: skill.gates ?? ["Schema"],
    locks: skill.locks ?? ["no_whole_book"],
    path: `skills/${relFromSkills}`,
    body: skill.body,
    folder: folder.includes("/") ? folder.split("/")[0] : folder,
  };
});

writeFileSync(
  out,
  JSON.stringify(
    {
      version: 1,
      count: skills.length,
      generatedAt: new Date().toISOString(),
      skills,
    },
    null,
    2,
  ) + "\n",
);

console.log(`wrote ${out} · skills=${skills.length}`);
