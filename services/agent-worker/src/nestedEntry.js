/**
 * 子智能体进程级隔离入口：父进程 fork 本文件，通过 NESTED_AGENT_SPEC 传入 job/run，
 * 结果以 JSONL 行写回 stdout（{kind:'event'|'result'|'error'}）。
 */

import { parentAdmission, writeFrame } from "./nestedProcess.js";

const raw = process.env.NESTED_AGENT_SPEC;
if (!raw) {
  process.stderr.write("missing NESTED_AGENT_SPEC\n");
  process.exit(2);
}

let spec;
try {
  spec = JSON.parse(raw);
} catch (err) {
  process.stderr.write(`bad NESTED_AGENT_SPEC: ${err.message}\n`);
  process.exit(2);
}

const { job, run } = spec || {};
if (!job?.id || !run?.id) {
  process.stderr.write("NESTED_AGENT_SPEC requires job.id and run.id\n");
  process.exit(2);
}

// 懒加载：校验通过后再引入重依赖（TS 源 / OpenAI / OTel / api client）
const control = parentAdmission();
const { runAgentJob } = await import("./runSession.js");

const publish = (e) => writeFrame({ kind: "event", event: e });

try {
  const result = await runAgentJob({ job, run, publish, ...control });
  await writeFrame({ kind: "result", result });
  process.exit(0);
} catch (err) {
  await writeFrame({ kind: "error", message: String(err?.message || err) });
  process.exit(1);
}
