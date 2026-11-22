#!/usr/bin/env node
/**
 * 回放 agent-worker 会话 JSONL，输出工具调用治理指标。
 * Usage: node scripts/tool-metrics.mjs [sessionsDir]
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = join(
  HERE,
  "..",
  "services",
  "agent-worker",
  ".data",
  "sessions",
  "sessions",
);

const META_TOOLS = new Set([
  "tool_search",
  "tool_schema_get",
  "tool_invoke",
  "search_tools",
  "invoke_tool",
]);

const ERR_KEYS = [
  "unknown_tool",
  "invalid_args_json",
  "tool_not_allowed",
  "tool_not_found",
  "tool_crash",
  "skill_not_found",
];

function loadSessions(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(dir, f));
}

function analyzeFile(path) {
  const calls = [];
  const results = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let modelCalls = 0;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const p = e.payload || {};
    if (e.type === "tool_call") {
      calls.push({ name: p.name || "", args: p.args, id: p.id });
    } else if (e.type === "tool_result") {
      results.push({ name: p.name || "", preview: String(p.preview || "") });
    } else if (e.type === "model_call") {
      modelCalls += 1;
    } else if (e.type === "receipt" || e.type === "run_end") {
      if (p.tokenPrompt) promptTokens = Number(p.tokenPrompt) || promptTokens;
      if (p.tokenCompletion) completionTokens = Number(p.tokenCompletion) || completionTokens;
    }
  }

  const errs = Object.fromEntries(ERR_KEYS.map((k) => [k, 0]));
  let skillRead = 0;
  let skillFail = 0;
  const callNames = calls.map((c) => c.name);
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    for (const k of ERR_KEYS) {
      if (r.preview.includes(k)) errs[k] += 1;
    }
    if (r.name === "skill_read" || (calls[i] && calls[i].name === "skill_read")) {
      skillRead += 1;
      if (r.preview.includes("skill_not_found")) skillFail += 1;
    }
  }
  // skill_read 按 call 计数更准
  skillRead = callNames.filter((n) => n === "skill_read").length;
  skillFail = 0;
  const skillCallIdx = [];
  calls.forEach((c, i) => {
    if (c.name === "skill_read") skillCallIdx.push(i);
  });
  // 结果按顺序配对：找 name=skill_read 的 result
  const skillResults = results.filter((r) => r.name === "skill_read");
  for (const r of skillResults) {
    if (r.preview.includes("skill_not_found")) skillFail += 1;
  }
  if (skillResults.length === 0 && skillRead > 0) {
    // 旧日志 result.name 可能缺失，用 preview 扫
    for (const r of results) {
      if (r.preview.includes("skill_not_found")) skillFail += 1;
    }
  }

  const metaCount = callNames.filter((n) => META_TOOLS.has(n)).length;
  return {
    path,
    calls: callNames.length,
    metaCount,
    metaRatio: callNames.length ? metaCount / callNames.length : 0,
    errs,
    skillRead,
    skillFail,
    modelCalls,
    promptTokens,
    completionTokens,
  };
}

function main() {
  const dir = process.argv[2] || DEFAULT_DIR;
  const files = loadSessions(dir);
  if (!files.length) {
    console.log(JSON.stringify({ ok: false, message: `no sessions in ${dir}`, dir }, null, 2));
    process.exit(0);
  }

  const rows = files.map(analyzeFile);
  const totalCalls = rows.reduce((s, r) => s + r.calls, 0);
  const totalMeta = rows.reduce((s, r) => s + r.metaCount, 0);
  const errTotals = Object.fromEntries(ERR_KEYS.map((k) => [k, 0]));
  let skillRead = 0;
  let skillFail = 0;
  let promptSum = 0;
  let runsWithPrompt = 0;

  for (const r of rows) {
    for (const k of ERR_KEYS) errTotals[k] += r.errs[k];
    skillRead += r.skillRead;
    skillFail += r.skillFail;
    if (r.promptTokens > 0) {
      promptSum += r.promptTokens;
      runsWithPrompt += 1;
    }
  }

  const report = {
    dir,
    runs: rows.length,
    totalCalls,
    metaCalls: totalMeta,
    metaRatio: totalCalls ? +(totalMeta / totalCalls).toFixed(4) : 0,
    errors: errTotals,
    skillRead,
    skillFail,
    skillFailRate: skillRead ? +(skillFail / skillRead).toFixed(4) : 0,
    avgPromptTokens: runsWithPrompt ? Math.round(promptSum / runsWithPrompt) : null,
    targets: {
      metaRatio: "<0.10",
      skillFailRate: "<0.05",
      tool_not_allowed: "~0",
      unknown_tool: "~0",
      tool_crash_reduction: ">=80%",
    },
    topHeavyRuns: rows
      .map((r) => ({
        file: r.path.split("/").pop(),
        calls: r.calls,
        metaRatio: +r.metaRatio.toFixed(3),
        skillFail: r.skillFail,
        errs: r.errs,
      }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 8),
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
