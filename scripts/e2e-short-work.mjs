#!/usr/bin/env node
/**
 * 短篇完整流回归（真实 API + agent-worker）：
 *   选题 → 人物小传 → 分集大纲 → 逐集正文（默认 3 集）→ 全剧连续性图。
 *   断言：run 全部成功、manuscript 数量 = 目标集数、
 *         story_graph 已落库且 mermaid 为可解析的 flowchart TD。
 *
 * 用法：
 *   E2E_API_BASE=http://127.0.0.1:8000 node scripts/e2e-short-work.mjs
 *   E2E_FORMAT=duanju E2E_EPISODES=5 node scripts/e2e-short-work.mjs
 *   E2E_CLEANUP=1 结束后删除 E2E 项目
 */

const BASE = (process.env.E2E_API_BASE || "http://127.0.0.1:8000").replace(/\/$/, "");
const FORMAT = process.env.E2E_FORMAT || "manju";
const EPISODES = Number(process.env.E2E_EPISODES || 3);
const RUN_TIMEOUT_MS = Number(process.env.E2E_RUN_TIMEOUT_MS || 480_000);
const CLEANUP = process.env.E2E_CLEANUP === "1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json();
}

async function waitRun(runId, label) {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let last = null;
  for (;;) {
    last = await api("GET", `/runs/${runId}`);
    if (["succeeded", "failed", "completed"].includes(last.status)) break;
    if (Date.now() > deadline) break;
    await sleep(5000);
  }
  if (!["succeeded", "completed"].includes(last?.status)) {
    throw new Error(`${label} 未成功（status=${last?.status ?? "?"}，超时/失败）`);
  }
  return last;
}

async function runAgent(pid, agentId, label, inputJson = {}) {
  const run = await api("POST", "/runs", { projectId: pid, agentId, inputJson });
  await waitRun(run.id, label);
  return run;
}

async function artifacts(pid, type) {
  return api("GET", `/projects/${pid}/artifacts${type ? `?type=${encodeURIComponent(type)}` : ""}`);
}

async function adoptLatest(pid, type) {
  const arts = await artifacts(pid, type);
  const candidates = [...arts]
    .filter((a) => a.status !== "adopted")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const c of candidates) {
    try {
      await api("POST", `/projects/${pid}/artifacts/${c.id}/adopt`, { mode: "strong" });
      return c;
    } catch {
      // 强采纳被门禁拒绝时退回 draft（与创作台行为一致），再换下一个候选
      try {
        await api("POST", `/projects/${pid}/artifacts/${c.id}/adopt`, { mode: "draft" });
        return c;
      } catch {
        // 换下一个候选
      }
    }
  }
  throw new Error(`${type} 无可用候选可采纳`);
}

function assert(cond, message) {
  if (!cond) throw new Error(`断言失败：${message}`);
}

async function main() {
  const project = await api("POST", "/projects", {
    title: `E2E-short-${FORMAT}-${Date.now()}`,
    format: FORMAT,
    genreTags: FORMAT === "manju" ? ["重生", "商业"] : ["逆袭"],
    market: "cn",
    startFrom: "blank",
    coverMeta: {},
  });
  const pid = project.id;
  console.log(`[e2e-short] 项目 ${pid}（${FORMAT}，目标 ${EPISODES} 集）`);
  try {
    console.log("[1/6] 核心梗…");
    await runAgent(pid, "topic.core_hook_batch", "core_hook", {
      format: FORMAT,
      count: 10,
      gender: "男频",
      genre: ["重生", "商业"],
    });
    await adoptLatest(pid, "core_hook");

    console.log("[2/6] 人物小传…");
    await runAgent(pid, FORMAT === "duanju" ? "char.mini_bio" : "char.bio_manju", "bio");
    await adoptLatest(pid, "character");

    console.log("[3/6] 分集大纲…");
    await runAgent(
      pid,
      FORMAT === "duanju" ? "struct.ep_outline_duanju" : "struct.episode_outline",
      "outline",
    );
    const outlines = await artifacts(pid, "episode_outline");
    assert(outlines.length >= EPISODES, `大纲不足 ${EPISODES} 集（实际 ${outlines.length}）`);

    console.log(`[4/6] 逐集正文（${EPISODES} 集）…`);
    for (let ep = 1; ep <= EPISODES; ep += 1) {
      console.log(`  写 EP${ep}…`);
      await runAgent(
        pid,
        FORMAT === "duanju" ? "orch.batch_writer" : "prose.episode_body",
        `body-ep${ep}`,
        { ep_no: ep, episodeNo: ep, count: 1, wordTarget: 1800 },
      );
    }

    console.log("[5/6] 校验产物…");
    const manuscripts = await artifacts(pid, "manuscript");
    const writtenNos = new Set(
      manuscripts
        .map((a) => Number(a.bodyJson?.episodeNo ?? a.bodyJson?.episode_no ?? 0))
        .filter((n) => n > 0),
    );
    for (let ep = 1; ep <= EPISODES; ep += 1) {
      assert(writtenNos.has(ep), `第 ${ep} 集正文缺失`);
    }

    console.log("[6/6] 连续性图…");
    const graphArts = await artifacts(pid, "story_graph");
    if (!graphArts.length) {
      await runAgent(pid, "struct.story_graph", "story-graph");
    }
    const graphs = await artifacts(pid, "story_graph");
    assert(graphs.length >= 1, "story_graph 未落库");
    const mermaid = String(graphs[0].bodyJson?.mermaid || "");
    assert(/flowchart\s+TD/i.test(mermaid), "mermaid 不是 flowchart TD");
    assert(mermaid.trim().length > 20, "mermaid 内容过短");

    console.log(
      `[e2e-short] PASS：${FORMAT} 项目 ${pid} 已完整写到 ${EPISODES} 集，图 OK`,
    );
  } finally {
    if (CLEANUP) {
      await api("DELETE", `/projects/${pid}`).catch(() => {});
      console.log(`[e2e-short] 已清理项目 ${pid}`);
    }
  }
}

main().catch((err) => {
  console.error("[e2e-short] FAIL:", err.message);
  process.exit(1);
});
