#!/usr/bin/env node
/**
 * 三章正文端到端回归（真实 API + agent-worker）：
 *   manju 漫剧最小 happy path（核心梗→人设→大纲→前三集正文），
 *   断言：每集正文 artifact 非空、字数落在 LengthBand、Stage 推进到 S5_EP_BODY_BATCH。
 *
 * 用法：
 *   E2E_API_BASE=http://127.0.0.1:8000 node scripts/e2e-3chapters.mjs
 *   可选：E2E_EPISODES=2 只写前两集；E2E_RUN_TIMEOUT_MS 单 run 超时（默认 480s）
 *   可选：E2E_CLEANUP=1 结束后删除项目
 */

import {
  api,
  waitRun,
  artifacts,
  adoptLatest,
  adoptCoreHook,
  stageLock,
  advanceTo,
} from "./e2e-helpers.mjs";

const BASE = (process.env.E2E_API_BASE || "http://127.0.0.1:8000").replace(/\/$/, "");
const EPISODES = Math.max(1, Math.min(10, Number(process.env.E2E_EPISODES || 3)));
const RUN_TIMEOUT_MS = Number(process.env.E2E_RUN_TIMEOUT_MS || 480_000);
const CLEANUP = process.env.E2E_CLEANUP === "1";

const waitRunLocal = (runId, label) => waitRun(runId, label, RUN_TIMEOUT_MS, BASE);

const runAgent = async (pid, agentId, label = agentId, inputJson = {}) => {
  const run = await api("POST", "/runs", { projectId: pid, agentId, inputJson });
  await waitRunLocal(run.id, label);
  return run;
};

// 与 LengthBand 门禁同口径：去首尾空白后的全文字符数（含标点/空格，不含换行首尾）。
const charCount = (s) => String(s ?? "").replace(/\s+/g, " ").trim().length;

async function main() {
  const stamp = Date.now();
  const project = await api("POST", "/projects", {
    title: `三章回归-${stamp}`,
    format: "manju",
    genreTags: ["都市", "逆袭"],
    coverMeta: { e2e3: true },
  });
  const pid = project.id;
  let stage = project.stage;
  let completed = [];
  const notes = [];
  console.log(`▶ 项目 ${project.title}（${pid.slice(0, 8)}）`);

  try {
    // S1 核心梗批量 → 人工挑选采纳
    ({ stage, completed } = await advanceTo(pid, "manju", stage, completed, "S1_HOOK_BATCH"));
    await runAgent(pid, "topic.core_hook_batch", "核心梗批量", { format: "manju" });
    const hook = await adoptCoreHook(pid);
    notes.push(`采纳核心梗「${hook?.title}」`);
    const afterHook = await api("GET", `/projects/${pid}`);
    if (afterHook.stage !== "S2_LOGLINE_100") {
      throw new Error(`强采纳后 stage=${afterHook.stage}，期望 S2_LOGLINE_100`);
    }
    stage = afterHook.stage;
    const ack1 = await stageLock(pid, "manju", stage, completed, "ack");
    completed = ack1.state.completed;

    // S3 人物小传 → 采纳 → ack
    ({ stage, completed } = await advanceTo(pid, "manju", stage, completed, "S3_BIO"));
    await runAgent(pid, "char.bio_manju", "人物小传", { format: "manju" });
    const bio = await adoptLatest(pid, "character");
    notes.push(`采纳人物小传「${bio?.title}」`);
    const ack2 = await stageLock(pid, "manju", stage, completed, "ack");
    completed = ack2.state.completed;

    // S4 前十集大纲 → 采纳
    ({ stage, completed } = await advanceTo(pid, "manju", stage, completed, "S4_EP10_OUTLINE"));
    await runAgent(pid, "struct.episode_outline", "前十集大纲", { format: "manju" });
    await adoptLatest(pid, "episode_outline");

    // S5 分集正文：写前 N 集，逐集断言内容
    ({ stage, completed } = await advanceTo(pid, "manju", stage, completed, "S5_EP_BODY_BATCH"));
    for (let ep = 1; ep <= EPISODES; ep += 1) {
      process.stdout.write(`▶ 第${ep}集正文 … `);
      const t0 = Date.now();
      await runAgent(pid, "prose.episode_body", `第${ep}集正文`, {
        format: "manju",
        ep_no: ep,
      });
      console.log(`${Math.round((Date.now() - t0) / 1000)}s`);
    }

    const arts = await artifacts(pid);
    const mss = arts
      .filter((a) => a.type === "manuscript")
      .sort((a, b) => (a.bodyJson?.episodeNo ?? 0) - (b.bodyJson?.episodeNo ?? 0));
    console.log(`\n生成正文 artifact：${mss.length} 集`);
    for (const m of mss) {
      const words = charCount(m.bodyMarkdown);
      const ok = words >= 700;
      console.log(
        `${ok ? "✔" : "✘"} 第${m.bodyJson?.episodeNo ?? "?"}集「${m.title}」字数=${words} ${ok ? "" : "（不达标）"}`,
      );
      console.log(`   ${String(m.bodyMarkdown).replace(/\n+/g, " ").slice(0, 80)}…`);
    }
    const bad = mss.filter((m) => charCount(m.bodyMarkdown) < 700);
    if (mss.length < EPISODES) throw new Error(`正文不足 ${EPISODES} 集（实际 ${mss.length}）`);
    if (bad.length) throw new Error(`正文字数不达标：${bad.map((m) => m.title).join("、")}`);

    const fresh = await api("GET", `/projects/${pid}`);
    console.log(`\n最终 stage=${fresh.stage} · 产物=${arts.length} · 正文 ${mss.length} 集全通过`);
    console.log(`项目：http://127.0.0.1:5173/projects/${pid}`);
    return { ok: true, pid, episodes: mss.length };
  } catch (e) {
    console.error(`✘ ${String(e.message || e)}`);
    return { ok: false, pid, error: String(e.message || e) };
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

main()
  .then((r) => {
    process.exitCode = r.ok ? 0 : 1;
  })
  .catch((e) => {
    console.error("E2E 脚本异常：", e);
    process.exit(1);
  });
