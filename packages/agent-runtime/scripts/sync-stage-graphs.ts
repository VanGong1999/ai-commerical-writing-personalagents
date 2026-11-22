/**
 * 从 stages.ts 写出 stage-graphs.json（真源单一化）。
 * Run: pnpm --filter @xiezuomanju/agent-runtime run sync-stage-graphs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportStageGraph } from "../src/stages.ts";

const FORMATS = [
  "manju",
  "duanju",
  "male_long",
  "female_long",
  "short_novel",
  "ip_adapt",
] as const;

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "stage-graphs.json");

const graphs: Record<string, ReturnType<typeof exportStageGraph>> = {};
for (const fmt of FORMATS) {
  graphs[fmt] = exportStageGraph(fmt);
}

writeFileSync(out, JSON.stringify(graphs, null, 2) + "\n");
console.log(
  `wrote ${out} · formats=${FORMATS.join(",")} · stages=${Object.values(graphs)
    .map((g) => g.length)
    .join("/")}`,
);
