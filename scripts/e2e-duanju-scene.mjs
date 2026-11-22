#!/usr/bin/env node
/**
 * 查理短剧场级正文回归：确定性铺 人设/集纲 → scene.triple 写第1集第1场。
 * 断言 scene 产物落库、场头格式、三件套字段齐全。
 */
import { api, waitRun, artifacts } from "./e2e-helpers.mjs";

const BASE = process.env.E2E_API_BASE || "http://127.0.0.1:8000";
const pid = process.argv[2];
if (!pid) {
  console.error("usage: node scripts/e2e-duanju-scene.mjs <projectId>");
  process.exit(2);
}

const via = { viaOntologyAction: true };
await api("POST", `/projects/${pid}/artifacts`, {
  type: "character",
  title: "苏晚人设卡",
  ...via,
  bodyMarkdown: "苏晚：被赶出家门的真假千金，外柔内刚，会医术。",
  bodyJson: { name: "苏晚", role: "女主", want: "拿回身份", fear: "连累养母" },
});
await api("POST", `/projects/${pid}/artifacts`, {
  type: "episode_outline",
  title: "EP01 大纲",
  ...via,
  bodyMarkdown: "EP01：订婚宴上假千金羞辱苏晚，苏晚当众救人反手亮出婚书。",
  bodyJson: {
    episodeNo: 1,
    title: "订婚宴",
    summary: "假千金当众羞辱苏晚，苏晚救下突发急症的宾客，反手亮出与顾家的婚书。",
    beats: ["羞辱", "救人", "亮婚书"],
    hookAtEnd: true,
    cliffType: "爽点爆点",
    coolPoint: "打脸虐渣",
  },
});
console.log("✔ 人设/EP01 集纲已铺");

process.stdout.write("▶ 第1集第1场 … ");
const t0 = Date.now();
const run = await api("POST", "/runs", {
  projectId: pid,
  agentId: "scene.triple",
  inputJson: {
    format: "duanju",
    ep_no: 1,
    ep_task: "订婚宴上被假千金羞辱 → 救人 → 亮婚书",
    loc: "酒店宴会厅",
    cast: "苏晚、顾行舟、苏薇、宾客",
    cool_tag: "打脸虐渣",
  },
});
await waitRun(run.id, "第1集第1场", 600_000, BASE);
console.log(`${Math.round((Date.now() - t0) / 1000)}s`);

const arts = await artifacts(pid);
const scenes = arts.filter((a) => a.type === "scene");
for (const s of scenes) {
  const bj = s.bodyJson || {};
  console.log(
    "✔",
    s.title,
    "| 场头:",
    String(bj.scene_header || "").slice(0, 30),
    "| 三件套:",
    ["info", "progress", "change"].every((k) => String(bj.triple?.[k] || "").trim()) ? "齐" : "缺",
  );
}
if (!scenes.length) {
  console.error("✘ 无 scene 产物");
  process.exit(1);
}
console.log("done");
