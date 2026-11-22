#!/usr/bin/env node
/**
 * Harness 改动 A/B 校验（Session 5 控制组 vs 候选组的轻量等价物）：
 * 以 agent-runtime 的确定性用例为 staged cases，跑当前树（candidate），
 * 与基线快照（control）对比，回归即失败。
 *
 * 用法：
 *   node scripts/harness-ab-check.mjs --baseline   # 记录/刷新基线
 *   node scripts/harness-ab-check.mjs               # 校验当前树不劣于基线
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, ".harness-baseline.json");

function runHarnessTests() {
  const r = spawnSync(
    "pnpm --filter @xiezuomanju/agent-runtime test",
    { cwd: ROOT, encoding: "utf8", env: process.env, shell: true },
  );
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  const pass = Number(/# pass (\d+)/.exec(out)?.[1] || 0);
  const fail = Number(/# fail (\d+)/.exec(out)?.[1] || 0);
  return { pass, fail, code: r.status, out };
}

const args = process.argv.slice(2);
const record = args.includes("--baseline");
const current = runHarnessTests();

if (record) {
  writeFileSync(
    BASELINE,
    `${JSON.stringify({ pass: current.pass, fail: 0, ts: new Date().toISOString() }, null, 2)}\n`,
  );
  console.log(`harness baseline recorded: pass=${current.pass}`);
  process.exit(current.fail === 0 && current.code === 0 ? 0 : 1);
}

if (current.fail > 0) {
  console.error("candidate harness cases have failures");
  process.exit(1);
}

if (!existsSync(BASELINE)) {
  console.error("no harness baseline; run with --baseline first");
  process.exit(2);
}

const base = JSON.parse(readFileSync(BASELINE, "utf8"));
if (current.pass < base.pass) {
  console.error(
    `A/B regress: candidate pass=${current.pass} < baseline pass=${base.pass}`,
  );
  process.exit(1);
}

console.log(`harness A/B ok: candidate pass=${current.pass} >= baseline pass=${base.pass}`);
process.exit(0);
