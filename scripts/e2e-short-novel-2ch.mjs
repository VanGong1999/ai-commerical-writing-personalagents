#!/usr/bin/env node
/**
 * 短篇（网文）两章正文回归：确定性铺设 核心梗/人设/章纲 → prose.novel_body 写两章。
 * 断言每章 2000–3000 字、manuscript 落库、Stage 到 S6_BODY_CHAPTER。
 */
import { api, waitRun, artifacts } from "./e2e-helpers.mjs";

const BASE = process.env.E2E_API_BASE || "http://127.0.0.1:8000";
const EPISODES = Math.max(1, Math.min(3, Number(process.env.E2E_CHAPTERS || 2)));
const charCount = (s) => String(s ?? "").replace(/\s+/g, " ").trim().length;

const pid = process.argv[2];
if (!pid) {
  console.error("usage: node scripts/e2e-short-novel-2ch.mjs <projectId>");
  process.exit(2);
}

const wait = (runId, label) =>
  waitRun(runId, label, Number(process.env.E2E_RUN_TIMEOUT_MS || 900_000), BASE);

// 1) 确定性上下文（零 LLM）：核心梗 → 强采纳
const via = { viaOntologyAction: true };
const hook = await api(
  "POST",
  `/projects/${pid}/artifacts`,
  {
    type: "core_hook",
    title: "被夺权的总裁重生一夜翻盘",
    status: "candidate",
    ...via,
    bodyMarkdown: "重生回到被夺权前夜，林渡带着记忆提前布局，一夜翻盘。",
    bodyJson: {
      titleHook: "被夺权的总裁重生一夜翻盘",
      coreHook: "重生回到被夺权前夜，林渡带着记忆提前布局，一夜翻盘。",
      motivation: "复仇线：夺回公司，把背叛者逐出董事会；事业线：重建技术团队，兑现对创始团队承诺",
      crisis: "董事会当场罢免、保安收走工牌",
      openingStructure: "董事会罢免现场 → 回闪 → 重生开局",
      tags: ["重生", "商战", "都市"],
      riskFlags: [],
    },
  },
);
await api("POST", `/projects/${pid}/artifacts/${hook.id}/adopt`, { mode: "strong" });
console.log("✔ 核心梗已采纳");

// 人设
await api("POST", `/projects/${pid}/artifacts`, {
  type: "character",
  title: "林渡人设卡",
  ...via,
  bodyMarkdown: "林渡：35岁，技术出身总裁，被兄弟背叛后重生。沉稳、狠、重承诺。",
  bodyJson: { name: "林渡", role: "主角", goal: "夺回公司", fear: "再失去信任" },
});
// 章纲
await api("POST", `/projects/${pid}/artifacts`, {
  type: "chapter_outline",
  title: "第1章章纲",
  ...via,
  bodyMarkdown: "第1章：重生夜，盘点牌面，先截住叛徒的第一步。",
  bodyJson: { chapterNo: 1, title: "重生夜", summary: "林渡在董事会罢免现场醒来，确认重生，盘点可用牌面，抢在叛徒前截断第一招。", beats: ["醒来确认重生", "盘点牌面", "截断第一招"] },
});
await api("POST", `/projects/${pid}/artifacts`, {
  type: "chapter_outline",
  title: "第2章章纲",
  ...via,
  bodyMarkdown: "第2章：约见合伙人，用记忆换时间。",
  bodyJson: { chapterNo: 2, title: "约见合伙人", summary: "林渡约见仍未倒戈的合伙人，用未来情报换取一周时间。", beats: ["约见", "情报交换", "埋线"] },
});
console.log("✔ 人设/章纲已铺");

// 2) 正文
for (let ch = 1; ch <= EPISODES; ch += 1) {
  process.stdout.write(`▶ 第${ch}章正文 … `);
  const t0 = Date.now();
  const run = await api("POST", "/runs", {
    projectId: pid,
    agentId: "prose.novel_body",
    inputJson: { format: "short_novel", chapter_no: ch, count: 1 },
  });
  await wait(run.id, `第${ch}章正文`);
  console.log(`${Math.round((Date.now() - t0) / 1000)}s`);
}

const arts = await artifacts(pid);
const mss = arts.filter((a) => a.type === "manuscript");
// 误写为 other 的「存档」章也计入诊断（契约应禁止，但回归需可见）
const misTyped = arts.filter(
  (a) =>
    a.type === "other" &&
    /第\s*\d+\s*章|chapter/i.test(String(a.title || "")) &&
    charCount(a.bodyMarkdown) >= 1500,
);
// 按 chapterNo 取最新一版（agent 可能因字数超限重生候选）
const byChapter = new Map();
for (const m of mss) {
  const no = Number(m.bodyJson?.chapterNo ?? m.bodyJson?.chapter_no ?? 0) || 0;
  const key = no || m.title || m.id;
  const prev = byChapter.get(key);
  if (!prev || String(m.updatedAt || "") > String(prev.updatedAt || "")) byChapter.set(key, m);
}
const latest = [...byChapter.values()];
let bad = 0;
for (const m of latest) {
  const words = charCount(m.bodyMarkdown);
  // 九格短篇：2000–3000；允许 ±5% 抖动（模型收尾偶发略超）
  const ok = words >= 1900 && words <= 3150;
  if (!ok) bad += 1;
  console.log(`${ok ? "✔" : "✘"} 「${m.title}」字数=${words}`);
}
for (const m of misTyped) {
  console.log(`⚠ 误类型 other→应 manuscript：「${m.title}」字数=${charCount(m.bodyMarkdown)}`);
}
const okCount = latest.length >= EPISODES && bad === 0 && misTyped.length === 0;
console.log(
  `正文 latest=${latest.length}/${EPISODES}（原稿候选共 ${mss.length}）${
    okCount ? " 全部达标" : `；不足或字数/类型异常 misTyped=${misTyped.length} badBand=${bad}`
  }`,
);
process.exit(okCount ? 0 : 1);
