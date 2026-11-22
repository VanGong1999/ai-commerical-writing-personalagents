/**
 * 从 loop.ts 写出 loop-graphs.json（真源单一化），写前先做 DAG 环检测。
 * Run: pnpm --filter @xiezuomanju/agent-runtime run sync-loop-graphs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOOPS, assertLoopGraphAcyclic } from "../src/loop.ts";

assertLoopGraphAcyclic(LOOPS);

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "loop-graphs.json");

writeFileSync(out, JSON.stringify({ loops: LOOPS }, null, 2) + "\n");
console.log(`wrote ${out} · loops=${LOOPS.map((l) => l.id).join(",")}`);
