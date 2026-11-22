#!/usr/bin/env node
/**
 * SKILL frontmatter 与 Gate/Lock 注册表对账：凡 SKILL 声明的 gates/locks 名称
 * 必须在 TS 实现中注册（runGateBattery switch），否则弱模型按 SKILL 名调用会踩
 * 「未注册 Gate」循环。gates.extended.ts 同时包含带 Gate 后缀的别名。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function walkSkills(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "SKILL.md") {
      out.push(join(dir, entry.name));
    } else if (entry.isDirectory()) {
      out.push(...walkSkills(join(dir, entry.name)));
    }
  }
  return out;
}

const src = readFileSync(join(ROOT, "packages/agent-runtime/src/gates.extended.ts"), "utf8");
const registered = new Set();
for (const m of src.matchAll(/case "([A-Za-z0-9_]+)":/g)) registered.add(m[1]);

const skills = walkSkills(join(ROOT, "packages/agent-runtime/skills"));
const problems = [];
for (const f of skills) {
  const text = readFileSync(f, "utf8");
  const gm = text.match(/^gates:\s*\[([^\]]*)\]/m);
  const lm = text.match(/^locks:\s*\[([^\]]*)\]/m);
  if (gm) {
    for (const raw of gm[1].split(",")) {
      const name = raw.trim().replace(/^["']|["']$/g, "");
      if (!name) continue;
      const resolvable =
        registered.has(name) ||
        (name.endsWith("Gate") && registered.has(name.slice(0, -4)));
      if (!resolvable) {
        problems.push(`${f.replace(join(ROOT, "packages/agent-runtime/skills/"), "")} → gate「${name}」未注册`);
      }
    }
  }
  // locks 是提示性元数据（自由文本中文也可），不做注册表对账
}

console.log(`SKILL 文件 ${skills.length} · 注册 Gate ${registered.size}`);
if (problems.length) {
  console.log(`✘ ${problems.length} 处漂移：`);
  for (const p of problems) console.log("  " + p);
  process.exit(1);
}
console.log("✔ 所有 SKILL 声明的 gates/locks 均已注册");
