/**
 * 对比当前 ontology-registry.json 与同步生成结果；有漂移则 exit 1。
 * 不改写已提交的 registry（仅当无漂移时保持原文件）。
 */
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const registryPath = join(root, "ontology-registry.json");
const bakPath = join(root, ".ontology-registry.bak.json");

function stableHash(raw: string): string {
  const parsed = JSON.parse(raw) as { generatedAt?: string; contentHash?: string };
  delete parsed.generatedAt;
  delete parsed.contentHash;
  return createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
}

const before = readFileSync(registryPath, "utf8");
const beforeHash = stableHash(before);
copyFileSync(registryPath, bakPath);

const sync = spawnSync(
  process.execPath,
  ["--experimental-strip-types", join(here, "sync-registry.ts")],
  { cwd: root, encoding: "utf8" },
);
if (sync.status !== 0) {
  renameSync(bakPath, registryPath);
  console.error(sync.stderr || sync.stdout);
  process.exit(sync.status || 1);
}

const after = readFileSync(registryPath, "utf8");
const afterHash = stableHash(after);
renameSync(bakPath, registryPath);

if (beforeHash !== afterHash) {
  console.error(
    "ontology-registry.json drift detected. Run: pnpm --filter @xiezuomanju/ontology run sync-registry",
  );
  process.exit(1);
}

try {
  unlinkSync(bakPath);
} catch {
  /* ignore */
}
console.log("ontology-registry.json OK (no drift)");
