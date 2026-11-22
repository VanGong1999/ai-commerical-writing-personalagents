#!/usr/bin/env node
/**
 * 147 Agent 可启动性全量校验（确定性、零 LLM）：
 * - SKILL 文件存在
 * - tools 白名单全部能解析到 worker 工具
 * - doneContract 的 gate 全部可解析（含 Gate 后缀别名）
 * - format 取值合法
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = readFileSync(join(ROOT, "packages/agent-runtime/src/registry.ts"), "utf8");
const gatesSrc = readFileSync(join(ROOT, "packages/agent-runtime/src/gates.extended.ts"), "utf8");
const toolsSrc = readFileSync(join(ROOT, "services/agent-worker/src/tools.js"), "utf8");

const toolNames = new Set();
for (const m of toolsSrc.matchAll(/name:\s*"([a-z0-9_.]+)"/g)) {
  toolNames.add(m[1].replace(/\./g, "_"));
}
// 元工具（loop 内部提供，不在 tools.js 对象列表）
for (const meta of ["tool_search", "tool_schema_get", "tool_invoke", "done_check", "skill_read"]) {
  toolNames.add(meta);
}

const registeredGates = new Set();
for (const m of gatesSrc.matchAll(/case "([A-Za-z0-9_]+)":/g)) registeredGates.add(m[1]);
const gateResolvable = (name) =>
  registeredGates.has(name) ||
  (name.endsWith("Gate") && registeredGates.has(name.slice(0, -4)));

const VALID_FORMATS = new Set([
  "manju", "duanju", "short_novel", "male_long", "female_long", "ip_adapt", "*",
]);

const problems = [];
let agentCount = 0;
let skillOk = 0;
let toolOk = 0;
let gateOk = 0;
const agentRe = /id:\s*"([a-z0-9_.]+)"[\s\S]*?skillPath:\s*"([^"]+)"[\s\S]*?tools:\s*\[([^\]]*)\][\s\S]*?doneContract:\s*\[([\s\S]*?)\]/g;
let m;
while ((m = agentRe.exec(registry))) {
  agentCount++;
  const [, id, skillPath, toolsRaw, contractRaw] = m;
  const skill = join(ROOT, "packages/agent-runtime", skillPath);
  if (!existsSync(skill)) {
    problems.push(`${id}: SKILL 文件缺失 ${skillPath}`);
  } else {
    skillOk++;
  }
  const tools = [...toolsRaw.matchAll(/"([a-z0-9_.]+)"/g)].map((x) => x[1]);
  const badTools = tools.filter((t) => !toolNames.has(t.replace(/\./g, "_")));
  if (badTools.length) {
    problems.push(`${id}: 工具不可解析 ${badTools.join("、")}`);
  } else {
    toolOk++;
  }
  const badGates = [...contractRaw.matchAll(/gates:\s*\[([^\]]*)\]/g)]
    .flatMap((x) => x[1].match(/"([A-Za-z0-9_]+)"/g) || [])
    .map((x) => x.replace(/"/g, ""))
    .filter((g) => !gateResolvable(g));
  if (badGates.length) {
    problems.push(`${id}: Gate 不可解析 ${badGates.join("、")}`);
  } else {
    gateOk++;
  }
  const format = (m[0].match(/format:\s*\[([^\]]*)\]/) || [])[1] || "";
  const fmts = [...format.matchAll(/"([a-z_*]+)"/g)].map((x) => x[1]);
  if (fmts.length && fmts.some((f) => !VALID_FORMATS.has(f))) {
    problems.push(`${id}: 非法 format ${fmts.join("、")}`);
  }
}

console.log(
  `Agent ${agentCount} · SKILL ${skillOk}/${agentCount} · 工具 ${toolOk}/${agentCount} · Gate ${gateOk}/${agentCount} · worker 工具 ${toolNames.size} · 注册 Gate ${registeredGates.size}`,
);
if (problems.length) {
  console.log(`✘ ${problems.length} 处问题：`);
  for (const p of problems) console.log("  " + p);
  process.exit(1);
}
console.log("✔ 全部 agent 可启动（SKILL/工具/Gate/格式均可解析）");
