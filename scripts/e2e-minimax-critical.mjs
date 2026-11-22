#!/usr/bin/env node
/**
 * MiniMax 关键路径（轻量）：三格式各 1 个快 agent + 回放 + Fleet + PA 会话。
 * 避免 core_hook_batch 十候选长链拖垮超时。
 */
import {
  api,
  waitRun,
  artifacts,
  adoptLatest,
  advanceTo,
} from "./e2e-helpers.mjs";

const RUN_TIMEOUT_MS = Number(process.env.E2E_RUN_TIMEOUT_MS || 360_000);
const CLEANUP = process.env.E2E_CLEANUP === "1";
const wait = (id, label) => waitRun(id, label, RUN_TIMEOUT_MS);

async function assertMinimaxDefault() {
  const providers = await api("GET", "/settings/providers");
  const def = providers.find((p) => p.isDefault);
  if (!def || !String(def.name || "").toLowerCase().includes("minimax")) {
    throw new Error(`默认 Provider 不是 MiniMax：${def?.name}`);
  }
  console.log(`✓ 默认 Provider = ${def.name} / ${def.selectedModel}`);
}

async function createProject(format, title) {
  return api("POST", "/projects", {
    title,
    format,
    genreTags: ["e2e"],
    market: "cn",
    coverMeta: { e2e: true, provider: "minimax" },
  });
}

async function runAgent(pid, agentId, label, inputJson = {}) {
  const before = (await artifacts(pid)).length;
  const run = await api("POST", "/runs", { projectId: pid, agentId, inputJson });
  const finished = await wait(run.id, label || agentId);
  const after = await artifacts(pid);
  console.log(
    `  · ${label}: status=${finished.status} artifacts ${before}→${after.length} model=${finished.model || "?"}`,
  );
  return { run: finished, arts: after };
}

async function assertReplay(pid, { minRuns = 1 } = {}) {
  const replay = await api("GET", `/projects/${pid}/replay?limit=100`);
  if ((replay.runCount || 0) < minRuns) {
    throw new Error(`回放 runCount=${replay.runCount} < ${minRuns}`);
  }
  if (!replay.events?.length) throw new Error("回放 events 为空");
  const lastRun = (replay.runs || []).slice(-1)[0];
  if (lastRun) {
    const detail = await api("GET", `/runs/${lastRun.id}/replay`);
    console.log(
      `  · run replay ${lastRun.agentId}: steps=${detail.steps?.length ?? 0} status=${detail.run?.status}`,
    );
  }
  console.log(`✓ 回放 runs=${replay.runCount} events=${replay.events.length}`);
  return replay;
}

async function manjuPath() {
  const p = await createProject("manju", `E2E-minimax-manju-${Date.now()}`);
  let stage = p.stage;
  let completed = [];
  ({ stage, completed } = await advanceTo(p.id, "manju", stage, completed, "S2_LOGLINE_100"));
  await runAgent(p.id, "topic.logline_title", "manju.logline", {
    format: "manju",
    brief: "重生商业逆袭，三年内阻止家族破产",
  });
  await adoptLatest(p.id, "logline").catch(() => null);
  ({ stage, completed } = await advanceTo(p.id, "manju", stage, completed, "S3_BIO"));
  await runAgent(p.id, "char.bio_manju", "manju.bio", { format: "manju" });
  await adoptLatest(p.id, "character").catch(() => null);
  await assertReplay(p.id, { minRuns: 2 });
  console.log("✓ 漫剧关键路径");
  return p.id;
}

async function shortNovelPath() {
  const p = await createProject("short_novel", `E2E-minimax-short-${Date.now()}`);
  let stage = p.stage;
  let completed = [];
  ({ stage, completed } = await advanceTo(p.id, "short_novel", stage, completed, "S2_SWAP"));
  // 换元必须带对标源（见 scripts/e2e-swap.mjs）；空项目只有 format 会盲探 fs_ls 被沙箱拒绝后熔断
  await runAgent(p.id, "swap.master", "short.swap", {
    format: "short_novel",
    source_work:
      "对标作品《赘婿》：现代商界精英穿越到古代赘婿身上，靠现代商业知识逆袭，扮猪吃虎逐步掌权。",
    goal: "现代感 + 身份倒置",
    degree: "twice",
  });
  await assertReplay(p.id, { minRuns: 1 });
  console.log("✓ 短篇关键路径");
  return p.id;
}

async function duanjuPath() {
  const p = await createProject("duanju", `E2E-minimax-duanju-${Date.now()}`);
  let stage = p.stage;
  let completed = [];
  ({ stage, completed } = await advanceTo(p.id, "duanju", stage, completed, "S5_SCENE"));
  await runAgent(p.id, "scene.triple", "duanju.scene", {
    format: "duanju",
    brief: "酒店宴会厅对峙，内/夜",
  });
  const scenes = (await artifacts(p.id)).filter((a) => a.type === "scene");
  console.log(`  · scene 产物 ${scenes.length}`);
  await assertReplay(p.id, { minRuns: 1 });
  console.log("✓ 短剧关键路径");
  return p.id;
}

async function colleagueFleet(projectId) {
  const fleet = await api("POST", "/agents/fleet", {
    projectId,
    mode: "ordered",
    mergePolicy: "human",
    members: [
      {
        name: "bio",
        task: "写一条主角小传",
        agentId: "char.bio_manju",
      },
      {
        name: "logline",
        task: "基于已有故事写一条片名与一句话卖点，读取专职技能并创建一个 logline 候选。",
        agentId: "topic.logline_title",
      },
    ],
  });
  const id = fleet.planId || fleet.id || fleet.fleetId;
  if (!id) throw new Error(`fleet 未返回 id: ${JSON.stringify(fleet).slice(0, 200)}`);
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let last = fleet;
  while (Date.now() < deadline) {
    last = await api("GET", `/agents/fleet/${id}`);
    const reports = last.reports || last.members || [];
    if (
      reports.length &&
      reports.every((m) =>
        ["done", "succeeded", "failed", "dead", "completed"].includes(String(m.status)),
      )
    ) {
      break;
    }
    if (["completed", "merged", "failed", "cancelled"].includes(String(last.status || last.state))) {
      break;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  if (!last.reports?.length || !last.reports.every(r => r.status === "done")) {
    throw new Error(`Fleet 未全部完成（超时/失败）：${JSON.stringify(last.reports || [])}`);
  }
  for (const member of last.reports) await wait(member.runId, `Fleet.${member.name}`);
  console.log(`✓ AI同事 Fleet ${id}`);
  return id;
}

async function workbenchConversation(projectId) {
  const conv = await api("POST", "/conversations", {
    source: "assistant",
    projectId,
    title: `E2E-workbench-${Date.now()}`,
  });
  if (!conv.id) throw new Error("conversation 创建失败");
  await api("GET", `/conversations/${conv.id}/runtime`).catch(() => null);
  await api("GET", `/conversations/${conv.id}/steps`).catch(() => ({ steps: [] }));
  // 绑定项目后回放应可查
  await assertReplay(projectId, { minRuns: 1 });
  console.log(`✓ Agent 工作台会话 ${conv.id}`);
  return conv.id;
}

async function main() {
  console.log("== MiniMax critical path (light) ==");
  await assertMinimaxDefault();
  const manjuId = await manjuPath();
  const shortId = await shortNovelPath();
  const duanjuId = await duanjuPath();
  await colleagueFleet(manjuId);
  await workbenchConversation(manjuId);
  if (CLEANUP) {
    for (const id of [manjuId, shortId, duanjuId]) {
      await api("DELETE", `/projects/${id}`).catch(() => {});
    }
  }
  console.log("ALL GREEN");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
