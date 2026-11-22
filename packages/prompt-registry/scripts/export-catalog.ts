import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentLinks, packs, prompts, skillLinks } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "catalog.json");

writeFileSync(
  out,
  JSON.stringify(
    {
      version: 1,
      generatedAt: new Date().toISOString(),
      prompts,
      packs,
      skillLinks,
      agentLinks,
    },
    null,
    2,
  ),
);

console.log(`wrote ${out} · prompts=${prompts.length} packs=${packs.length}`);
