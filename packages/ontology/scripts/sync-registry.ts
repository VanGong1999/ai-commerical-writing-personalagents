/**
 * 扫描 domain Schema 导出 + 合并 curated catalog → ontology-registry.json
 * Run: pnpm --filter @xiezuomanju/ontology run sync-registry
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTION_ONLY_ARTIFACT_TYPES,
  ACTION_TYPES,
  FUNCTIONS,
  INTERFACES,
  LINK_TYPES,
  OBJECT_TYPES,
  SHARED_PROPERTIES,
  VIEWS,
  type CatalogEntry,
} from "../src/catalog.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const domainSrc = join(root, "..", "domain", "src");
const outPath = join(root, "ontology-registry.json");

const SCHEMA_RE = /export const (\w+Schema)\s*=/g;
const OBJECT_SCHEMA_EXPORTS = new Set(
  OBJECT_TYPES.map((o) => o.schemaExport).filter(Boolean) as string[],
);

function scanSchemas(file: string): { name: string; kindHint: "enum" | "object" | "unknown" }[] {
  const text = readFileSync(join(domainSrc, file), "utf8");
  const names = [...text.matchAll(SCHEMA_RE)].map((m) => m[1]);
  return names.map((name) => {
    const idx = text.indexOf(`export const ${name}`);
    const slice = text.slice(idx, idx + 400);
    const kindHint = slice.includes("z.enum(")
      ? "enum"
      : slice.includes("z.object(")
        ? "object"
        : "unknown";
    return { name, kindHint };
  });
}

function apiNameFromSchema(schema: string): string {
  return schema.replace(/Schema$/, "");
}

function build() {
  const files = ["nines-workflow.ts", "story-graph.ts", "entities.ts", "enums.ts", "gates.ts"];
  const scanned: { name: string; kindHint: string; source: string }[] = [];
  for (const f of files) {
    for (const s of scanSchemas(f)) {
      scanned.push({ ...s, source: f });
    }
  }

  const valueTypes: CatalogEntry[] = [];
  const structs: CatalogEntry[] = [];
  const seen = new Set<string>();

  for (const s of scanned) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    const apiName = apiNameFromSchema(s.name);
    if (OBJECT_SCHEMA_EXPORTS.has(s.name)) continue;
    if (s.kindHint === "enum") {
      valueTypes.push({
        apiName,
        displayName: apiName,
        kind: "value_type",
        schemaExport: s.name,
        description: `from ${s.source}`,
      });
    } else {
      structs.push({
        apiName,
        displayName: apiName,
        kind: "struct",
        schemaExport: s.name,
        description: `from ${s.source}`,
      });
    }
  }

  const backingMaps: CatalogEntry[] = OBJECT_TYPES.filter((o) => o.artifactType).map((o) => ({
    apiName: `map_${o.apiName}`,
    displayName: `${o.apiName} → ${o.artifactType}`,
    kind: "backing_map",
    artifactType: o.artifactType,
    memoryPath: o.memoryPath,
    description: `ObjectType ${o.apiName} materializes ArtifactType ${o.artifactType}`,
  }));

  const registry = {
    schemaVersion: "writing-ontology/1",
    generatedAt: new Date().toISOString(),
    sharedProperties: SHARED_PROPERTIES,
    interfaces: INTERFACES,
    objectTypes: OBJECT_TYPES,
    linkTypes: LINK_TYPES,
    valueTypes,
    structs,
    actionTypes: ACTION_TYPES,
    functions: FUNCTIONS,
    views: VIEWS,
    backingMaps,
    actionOnlyArtifactTypes: [...ACTION_ONLY_ARTIFACT_TYPES],
    scannedSchemaCount: scanned.length,
    counts: {
      objectTypes: OBJECT_TYPES.length,
      linkTypes: LINK_TYPES.length,
      interfaces: INTERFACES.length,
      valueTypes: valueTypes.length,
      structs: structs.length,
      actionTypes: ACTION_TYPES.length,
      functions: FUNCTIONS.length,
      views: VIEWS.length,
      backingMaps: backingMaps.length,
      scannedSchemas: scanned.length,
    },
  };

  const body = JSON.stringify(registry, null, 2) + "\n";
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 16);
  (registry as { contentHash?: string }).contentHash = hash;
  const finalBody = JSON.stringify(registry, null, 2) + "\n";
  writeFileSync(outPath, finalBody);
  console.log(
    `wrote ${outPath}\n  OT=${OBJECT_TYPES.length} LT=${LINK_TYPES.length} IT=${INTERFACES.length} VT=${valueTypes.length} Struct=${structs.length} Action=${ACTION_TYPES.length} Fn=${FUNCTIONS.length} Views=${VIEWS.length} scanned=${scanned.length}`,
  );
}

build();
