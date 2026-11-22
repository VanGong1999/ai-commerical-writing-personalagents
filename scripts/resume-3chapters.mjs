#!/usr/bin/env node
/** 从 S4_EP10_OUTLINE 续跑：前十集大纲 → 前三集正文（复用 e2e-helpers）。 */
import {
  api,
  waitRun,
  artifacts,
  adoptLatest,
  advanceTo,
} from "./e2e-helpers.mjs";

const BASE = (process.env.E2E_API_BASE || "http://127.0.0.1:8000").replace(/\/$/, "");
const pid = process.argv[2];
const EPISODES = Math.max(1, Math.min(10, Number(process.env.E2E_EPISODES || 3)));
if (!pid) {
  console.error("usage: node scripts/resume-3chapters.mjs <projectId>");
  process.exit(2);
}

const wait = (runId, label) => waitRun(runId, label, 600_000, BASE);
const runAgent = async (agentId, label, inputJson = {}) => {
  const run = await api("POST", "/runs", { projectId: pid, agentId, inputJson });
  await wait(run.id, label);
  return run;
};
// 与 LengthBand 门禁同口径：全文去空白长度。
const charCount = (s) => String(s ?? "").replace(/\s+/g, " ").trim().length;

const proj = await api("GET", `/projects/${pid}`);
let stage = proj.stage;
console.log(`▶ 续跑项目 ${proj.title}（当前 stage=${stage}）`);

if (stage === "S4_EP10_OUTLINE") {
  console.log("▶ 前十集大纲 …");
  await runAgent("struct.episode_outline", "前十集大纲", { format: "manju" });
  await adoptLatest(pid, "episode_outline");
}

({ stage } = await advanceTo(pid, "manju", stage, [], "S5_EP_BODY_BATCH"));
for (let ep = 1; ep <= EPISODES; ep += 1) {
  process.stdout.write(`▶ 第${ep}集正文 … `);
  const t0 = Date.now();
  await runAgent("prose.episode_body", `第${ep}集正文`, { format: "manju", ep_no: ep });
  console.log(`${Math.round((Date.now() - t0) / 1000)}s`);
}

const arts = await artifacts(pid);
const mss = arts
  .filter((a) => a.type === "manuscript")
  .sort((a, b) => (a.bodyJson?.episodeNo ?? 0) - (b.bodyJson?.episodeNo ?? 0));
let bad = 0;
for (const m of mss) {
  const words = charCount(m.bodyMarkdown);
  if (words < 700) bad += 1;
  console.log(`${words >= 700 ? "✔" : "✘"} 第${m.bodyJson?.episodeNo ?? "?"}集「${m.title}」字数=${words}`);
}
const fresh = await api("GET", `/projects/${pid}`);
console.log(`\n最终 stage=${fresh.stage} · 正文 ${mss.length} 集${bad ? `（${bad} 集不达标）` : " 全部达标"}`);
process.exit(mss.length >= EPISODES && bad === 0 ? 0 : 1);
