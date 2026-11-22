/**
 * Rewrite agent-catalog.json from AGENT_REGISTRY.
 * Run: pnpm --filter @xiezuomanju/agent-runtime run sync-agent-catalog
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_REGISTRY } from "../src/registry.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "agent-catalog.json");

const agents = AGENT_REGISTRY.map((a) => ({
  id: a.id,
  name: a.name,
  description: a.description,
  summary: a.description,
  persona: a.persona,
  team: a.team,
  skillPath: (a.skillPath || "").replace(/^skills\//, "").replace(/\/SKILL\.md$/, ""),
  when: a.stage ? `Stage ${a.stage}` : "按创作台 / Job 调用",
  format: a.format ?? ["*"],
  formats: a.format ?? ["*"],
  stage: a.stage,
  modelProfile: a.modelProfile,
  tools: a.tools,
}));

writeFileSync(
  out,
  JSON.stringify(
    {
      version: 3,
      updated: new Date().toISOString().slice(0, 10),
      count: agents.length,
      generatedAt: new Date().toISOString(),
      agents,
    },
    null,
    2,
  ) + "\n",
);

console.log(`wrote ${out} · agents=${agents.length}`);
