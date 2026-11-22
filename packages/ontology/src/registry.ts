import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION_ONLY_ARTIFACT_TYPES } from "./catalog.ts";

export type OntologyRegistry = {
  schemaVersion: string;
  generatedAt?: string;
  contentHash?: string;
  objectTypes: { apiName: string; artifactType?: string; schemaExport?: string }[];
  linkTypes: { apiName: string }[];
  interfaces: { apiName: string }[];
  valueTypes: { apiName: string; schemaExport?: string }[];
  structs: { apiName: string; schemaExport?: string }[];
  actionTypes: { apiName: string; formats?: string[]; criteria?: string[] }[];
  functions: { apiName: string }[];
  views: { apiName: string }[];
  backingMaps: { apiName: string; artifactType?: string }[];
  actionOnlyArtifactTypes: string[];
  counts: Record<string, number>;
  scannedSchemaCount: number;
};

let cached: OntologyRegistry | null = null;

export function loadRegistry(): OntologyRegistry {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "..", "ontology-registry.json");
  cached = JSON.parse(readFileSync(path, "utf8")) as OntologyRegistry;
  return cached;
}

export function isActionOnlyArtifactType(type: string): boolean {
  const reg = (() => {
    try {
      return loadRegistry();
    } catch {
      return null;
    }
  })();
  const list = reg?.actionOnlyArtifactTypes ?? [...ACTION_ONLY_ARTIFACT_TYPES];
  return list.includes(type);
}

export function artifactTypeToObjectApiName(artifactType: string): string | null {
  try {
    const ot = loadRegistry().objectTypes.find((o) => o.artifactType === artifactType);
    return ot?.apiName ?? null;
  } catch {
    return null;
  }
}

export function actionsForFormat(format: string) {
  return loadRegistry().actionTypes.filter(
    (a) => !a.formats?.length || a.formats.includes(format),
  );
}
