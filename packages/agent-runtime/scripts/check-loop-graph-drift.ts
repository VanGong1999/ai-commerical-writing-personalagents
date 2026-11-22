/**
 * 校验 loop-graphs.json ↔ loop.ts 一致，并做 DAG 环检测。
 * Run: pnpm --filter @xiezuomanju/agent-runtime run check-loop-graph-drift
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOOPS, assertLoopGraphAcyclic } from "../src/loop.ts";

assertLoopGraphAcyclic(LOOPS);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = JSON.parse(readFileSync(join(root, "loop-graphs.json"), "utf8"));
const jsonLoops = json?.loops || [];

if (JSON.stringify(LOOPS) !== JSON.stringify(jsonLoops)) {
  console.error(
    "Loop graph drift detected:\n  loop.ts ↔ loop-graphs.json 不一致（重新运行 sync-loop-graphs）",
  );
  process.exit(1);
}

console.log("OK: loop graphs aligned (ids + edges acyclic)");
