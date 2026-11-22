/**
 * 校验 stage-graphs.json ↔ stages.ts ↔ domain enums（含 agentIds）。
 * 用法：pnpm --filter @xiezuomanju/agent-runtime run check-stage-graph-drift
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DUANJU_STAGE_SKELETON,
  FEMALE_LONG_STAGES,
  IP_ADAPT_STAGES,
  MALE_LONG_STAGES,
  MANJU_STAGES,
  SHORT_NOVEL_STAGES,
  exportStageGraph,
} from "../src/stages.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const graphs = JSON.parse(
  readFileSync(join(root, "stage-graphs.json"), "utf8"),
) as Record<
  string,
  Array<{ id: string; agentIds?: string[]; next?: string[]; requiresUserAck?: boolean }>
>;

const domainEnums = readFileSync(join(root, "../domain/src/enums.ts"), "utf8");

const FROM_TS: Record<string, string[]> = {
  manju: MANJU_STAGES.map((s) => s.id),
  duanju: DUANJU_STAGE_SKELETON.map((s) => s.id),
  male_long: MALE_LONG_STAGES.map((s) => s.id),
  female_long: FEMALE_LONG_STAGES.map((s) => s.id),
  short_novel: SHORT_NOVEL_STAGES.map((s) => s.id),
  ip_adapt: IP_ADAPT_STAGES.map((s) => s.id),
};

const SCHEMA_NAMES: Record<string, string> = {
  manju: "ManjuStageSchema",
  duanju: "DuanjuStageSchema",
  male_long: "MaleLongStageSchema",
  female_long: "FemaleLongStageSchema",
  short_novel: "ShortNovelStageSchema",
  ip_adapt: "IpAdaptStageSchema",
};

function extractEnumOptions(src: string, name: string): string[] {
  const re = new RegExp(
    `export const ${name} = z\\.enum\\(\\[([\\s\\S]*?)\\]\\);`,
  );
  const m = src.match(re);
  if (!m?.[1]) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return [...a].sort().join("\0") === [...b].sort().join("\0");
}

const errors: string[] = [];

for (const [fmt, tsIds] of Object.entries(FROM_TS)) {
  const jsonNodes = graphs[fmt] || [];
  const jsonIds = jsonNodes.map((s) => s.id);
  if (!sameSet(tsIds, jsonIds)) {
    errors.push(
      `[${fmt}] stages.ts ↔ stage-graphs.json id 不一致\n` +
        `  ts:   ${tsIds.join(", ")}\n` +
        `  json: ${jsonIds.join(", ")}`,
    );
  }
  if (tsIds.join("|") !== jsonIds.join("|")) {
    errors.push(`[${fmt}] Stage 顺序漂移（id 集合可能相同但顺序不同）`);
  }

  const exported = exportStageGraph(fmt);
  for (const node of exported) {
    const j = jsonNodes.find((x) => x.id === node.id);
    if (!j) continue;
    const tsAgents = [...(node.agentIds || [])].sort();
    const jsonAgents = [...(j.agentIds || [])].sort();
    if (tsAgents.join("|") !== jsonAgents.join("|")) {
      errors.push(
        `[${fmt}/${node.id}] agentIds 漂移\n` +
          `  ts:   ${tsAgents.join(", ") || "(empty)"}\n` +
          `  json: ${jsonAgents.join(", ") || "(empty)"}`,
      );
    }
  }

  const schema = SCHEMA_NAMES[fmt];
  if (schema) {
    const domainIds = extractEnumOptions(domainEnums, schema);
    if (!domainIds.length) {
      errors.push(`[${fmt}] domain 未解析到 ${schema}`);
    } else if (!sameSet(tsIds, domainIds)) {
      errors.push(
        `[${fmt}] stages.ts ↔ domain ${schema} 不一致\n` +
          `  ts:     ${tsIds.join(", ")}\n` +
          `  domain: ${domainIds.join(", ")}`,
      );
    }
  }
}

if (errors.length) {
  console.error("Stage graph drift detected:\n" + errors.join("\n\n"));
  process.exit(1);
}

console.log(
  `OK: stage graphs aligned (ids + agentIds) for ${Object.keys(FROM_TS).join(", ")}`,
);
