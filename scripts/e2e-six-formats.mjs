#!/usr/bin/env node
/**
 * 六格式端到端回归（真实 API + agent-worker）：
 *   每格式走最小 happy path（选题/人设/大纲/正文 + 人工闸 ack），
 *   断言：run 全部 succeeded、生成型 agent 产出新产物、Stage 按图前进、
 *   Gate 不被 inconclusive 放行、analytics-charts 有阶段时长数据。
 *
 * 用法：
 *   E2E_API_BASE=http://127.0.0.1:8000 node scripts/e2e-six-formats.mjs
 *   可选：E2E_SKIP=manju,ip_adapt 跳过指定格式；E2E_RUN_TIMEOUT_MS 单 run 超时（默认 480s）
 *   可选：E2E_CLEANUP=1 结束后删除 E2E 项目
 */

const BASE = (process.env.E2E_API_BASE || "http://127.0.0.1:8000").replace(/\/$/, "");
const RUN_TIMEOUT_MS = Number(process.env.E2E_RUN_TIMEOUT_MS || 480_000);
const CLEANUP = process.env.E2E_CLEANUP === "1";
const SKIP = new Set((process.env.E2E_SKIP || "").split(",").map((s) => s.trim()).filter(Boolean));

import {
  sleep,
  api,
  waitRun,
  artifacts,
  adoptLatest,
  adoptCoreHook,
  stageLock,
  advanceTo,
} from "./e2e-helpers.mjs";

const waitRunLocal = (runId, label) => waitRun(runId, label, RUN_TIMEOUT_MS, BASE);

const runAgent = async (pid, agentId, label = agentId, inputJson = {}) => {
  const run = await api("POST", "/runs", { projectId: pid, agentId, inputJson });
  await waitRunLocal(run.id, label);
  return run;
};

/** 各格式最小 happy path：advance 链 + 生成 agent + 人工闸。 */
const FLOWS = {
  manju: {
    expectStageAfterAdopt: "S2_LOGLINE_100",
    steps: [
      { kind: "advanceTo", target: "S1_HOOK_BATCH" },
      { kind: "run", agent: "topic.core_hook_batch", grow: true },
      { kind: "adopt", type: "core_hook" },
      { kind: "assertStage", target: "S2_LOGLINE_100" },
      { kind: "ack" },
      { kind: "advanceTo", target: "S3_BIO" },
      { kind: "run", agent: "char.bio_manju", grow: true },
      { kind: "adopt", type: "character" },
      { kind: "ack" }, // S3_BIO_ACK
      { kind: "advanceTo", target: "S4_EP10_OUTLINE" },
      { kind: "run", agent: "struct.episode_outline", grow: true },
      { kind: "adopt", type: "episode_outline" },
      { kind: "advanceTo", target: "S5_EP_BODY_BATCH" },
      { kind: "run", agent: "prose.episode_body", grow: true },
    ],
    expectTypes: ["core_hook", "character", "episode_outline", "manuscript"],
  },
  duanju: {
    steps: [
      { kind: "advanceTo", target: "S1_TOPIC" },
      { kind: "run", agent: "topic.want_how" },
      { kind: "advanceTo", target: "S3_BEAT20" },
      { kind: "run", agent: "struct.beat20", grow: true },
      { kind: "advanceTo", target: "S4_EP10_DRAFT" },
      { kind: "run", agent: "struct.ep_outline_duanju", grow: true },
      { kind: "advanceTo", target: "S5_SCENE" },
      { kind: "run", agent: "scene.triple", grow: true },
      { kind: "advanceTo", target: "S6_REVISE20" },
      { kind: "run", agent: "qc.revise20" },
    ],
    expectTypes: [],
  },
  short_novel: {
    steps: [
      { kind: "advanceTo", target: "S2_SWAP" },
      { kind: "run", agent: "swap.master", grow: true },
      { kind: "advanceTo", target: "S3_SYNOPSIS" },
      { kind: "run", agent: "struct.expectation", grow: true },
      { kind: "run", agent: "char.bible_big5", grow: true },
      { kind: "advanceTo", target: "S6_BODY_CHAPTER" },
      { kind: "run", agent: "prose.novel_body", grow: true },
    ],
    expectTypes: ["manuscript"],
  },
  male_long: {
    steps: [
      { kind: "advanceTo", target: "S1_TOPIC_SCAN" },
      { kind: "run", agent: "male.opening", grow: true },
      { kind: "advanceTo", target: "S2_GOLD_FINGER" },
      { kind: "run", agent: "male.gold_finger", grow: true },
      { kind: "advanceTo", target: "S4_VOLUME" },
      { kind: "run", agent: "male.upgrade_loop", grow: true },
      { kind: "run", agent: "char.bible_big5", grow: true },
      { kind: "advanceTo", target: "S7_BODY" },
      { kind: "run", agent: "prose.novel_body", grow: true },
    ],
    expectTypes: ["manuscript"],
  },
  female_long: {
    steps: [
      { kind: "advanceTo", target: "S1_TOPIC" },
      { kind: "run", agent: "struct.chase_wife", grow: true },
      { kind: "advanceTo", target: "S1_FOUR_SWAP" },
      { kind: "ack" },
      { kind: "advanceTo", target: "S3_VOLUME" },
      { kind: "run", agent: "female.pace", grow: true },
      { kind: "run", agent: "char.bible_big5", grow: true },
      { kind: "advanceTo", target: "S6_BODY" },
      { kind: "run", agent: "prose.novel_body", grow: true },
      { kind: "advanceTo", target: "S9_PAYWALL" },
      { kind: "run", agent: "struct.paywall", grow: true },
    ],
    expectTypes: ["manuscript"],
  },
  ip_adapt: {
    steps: [
      { kind: "advanceTo", target: "S1_IP_EVAL" },
      { kind: "run", agent: "ip.select_score", grow: true },
      { kind: "advanceTo", target: "S2_UNIT_SPLIT" },
      { kind: "run", agent: "ip.unit_cut", grow: true },
      { kind: "run", agent: "char.bible_big5", grow: true },
      { kind: "advanceTo", target: "S7_SCRIPT" },
      { kind: "run", agent: "prose.episode_body", grow: true },
    ],
    expectTypes: ["manuscript"],
  },
};

async function runFlow(format, flow) {
  const stamp = Date.now();
  const title = `E2E-${format}-${stamp}`;
  const project = await api("POST", "/projects", {
    title,
    format,
    genreTags: ["E2E"],
    coverMeta: { e2e: true },
  });
  const pid = project.id;
  let stage = project.stage;
  let completed = [];
  const runs = [];
  const notes = [];
  try {
    for (const step of flow.steps) {
      if (step.kind === "advanceTo") {
        const r = await advanceTo(pid, format, stage, completed, step.target);
        stage = r.stage;
        completed = r.completed;
      } else if (step.kind === "ack") {
        const r = await stageLock(pid, format, stage, completed, "ack");
        completed = r.state.completed;
      } else if (step.kind === "assertStage") {
        const fresh = await api("GET", `/projects/${pid}`);
        if (fresh.stage !== step.target) {
          throw new Error(`${format}: 强采纳后 stage=${fresh.stage}，期望 ${step.target}`);
        }
        stage = fresh.stage;
      } else if (step.kind === "run") {
        const before = (await artifacts(pid)).length;
        const run = await runAgent(pid, step.agent, step.agent, { format });
        runs.push({ agent: step.agent, status: run.status });
        const after = (await artifacts(pid)).length;
        if (step.grow && after <= before) {
          throw new Error(`${format}: ${step.agent} 成功但未产生新产物`);
        }
      } else if (step.kind === "adopt") {
        const adopted =
          step.type === "core_hook"
            ? await adoptCoreHook(pid)
            : await adoptLatest(pid, step.type);
        if (adopted) notes.push(`采纳 ${adopted.type}「${adopted.title}」`);
        else notes.push(`（无待采纳 ${step.type}，跳过）`);
      }
    }

    const arts = await artifacts(pid);
    const types = new Set(arts.map((a) => a.type));
    const missing = flow.expectTypes.filter((t) => !types.has(t));
    if (missing.length) {
      throw new Error(`${format}: 缺少产物类型 ${missing.join(",")}（现有 ${[...types].join(",")}）`);
    }
    const charts = await api("GET", `/projects/${pid}/analytics-charts`);
    if (!Array.isArray(charts.stageDurations) || charts.stageDurations.length < 2) {
      throw new Error(`${format}: analytics-charts stageDurations 不足（${JSON.stringify(charts.stageDurations)}）`);
    }
    const fresh = await api("GET", `/projects/${pid}`);
    return {
      ok: true,
      projectId: pid,
      title,
      finalStage: fresh.stage,
      artifacts: arts.length,
      runs,
      notes,
      stageDurations: charts.stageDurations.length,
    };
  } catch (e) {
    return { ok: false, projectId: pid, title, error: String(e.message || e), runs, notes };
  } finally {
    if (CLEANUP) {
      try {
        await api("DELETE", `/projects/${pid}`);
      } catch {
        /* 保留现场 */
      }
    }
  }
}

async function main() {
  console.log(`六格式 E2E 回归 · API ${BASE}\n`);
  const rows = [];
  for (const [format, flow] of Object.entries(FLOWS)) {
    if (SKIP.has(format)) {
      rows.push([format, "SKIPPED", "", ""]);
      continue;
    }
    process.stdout.write(`▶ ${format} …\n`);
    const started = Date.now();
    const result = await runFlow(format, flow);
    const cost = `${Math.round((Date.now() - started) / 1000)}s`;
    if (result.ok) {
      rows.push([format, "PASS", result.finalStage, `${result.artifacts} 产物 · ${result.runs.length} runs · ${cost}`]);
      console.log(`  ✔ ${result.finalStage} · ${result.artifacts} 产物 · ${cost}`);
    } else {
      rows.push([format, "FAIL", "", result.error]);
      console.log(`  ✘ ${result.error}`);
    }
  }

  const lines = [
    "# 六格式 E2E 回归报告",
    "",
    `- 时间：${new Date().toISOString()}`,
    `- API：${BASE}`,
    "",
    "| 格式 | 结果 | 最终 Stage | 说明 |",
    "| --- | --- | --- | --- |",
    ...rows.map(([f, r, s, n]) => `| ${f} | ${r} | ${s || "—"} | ${n || ""} |`),
    "",
  ];
  const report = lines.join("\n");
  console.log(`\n${report}`);
  const failed = rows.filter((r) => r[1] === "FAIL").length;
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("E2E 脚本异常：", e);
  process.exit(1);
});
