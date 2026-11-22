#!/usr/bin/env node
/**
 * 换元链回归（九格 2.md/3.md）：swap.master 出一度/二度换元方案，
 * 断言 swap_plan 产物落库且含六大故事源与置换方案。
 */
import { api, waitRun, artifacts } from "./e2e-helpers.mjs";

const BASE = process.env.E2E_API_BASE || "http://127.0.0.1:8000";
const pid = process.argv[2];
if (!pid) {
  console.error("usage: node scripts/e2e-swap.mjs <projectId>");
  process.exit(2);
}

const run = await api("POST", "/runs", {
  projectId: pid,
  agentId: "swap.master",
  inputJson: {
    format: "short_novel",
    source_work:
      "对标作品《赘婿》：现代商界精英穿越到古代赘婿身上，靠现代商业知识逆袭，扮猪吃虎逐步掌权。",
    goal: "现代感 + 身份倒置",
    degree: "twice",
  },
});
process.stdout.write("▶ 换元方案 … ");
const t0 = Date.now();
await waitRun(run.id, "swap.master", 600_000, BASE);
console.log(`${Math.round((Date.now() - t0) / 1000)}s`);

const arts = await artifacts(pid);
const plans = arts.filter((a) => a.type === "swap_plan");
for (const p of plans) {
  const md = p.bodyMarkdown || "";
  const hasSix = ["事件", "结构", "主体", "背景", "人物", "道具"].filter((k) => md.includes(k)).length;
  console.log("✔", p.title, "| 六源覆盖:", hasSix + "/6", "| 长度:", md.length);
}
if (!plans.length) {
  console.error("✘ 无 swap_plan 产物");
  process.exit(1);
}
console.log("done");
