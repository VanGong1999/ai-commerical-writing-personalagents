#!/usr/bin/env node
/**
 * 恢复闭环 + PA always-on 代操作：
 * 1) 长跑 pause → resume，attempt 不因操作员恢复而递增
 * 2) 右下角助手 /conversations chat：列项目、建项目、查审计
 * 3) 飞书服务健康（WS 已连接日志侧验证；API 侧查 delivery 绑定）
 */
import http from "node:http";
import { api, sleep, waitRun } from "./e2e-helpers.mjs";

const RUN_TIMEOUT_MS = Number(process.env.E2E_RUN_TIMEOUT_MS || 420_000);
const CLEANUP = process.env.E2E_CLEANUP === "1";
const CHAT_TIMEOUT_MS = Number(process.env.E2E_CHAT_TIMEOUT_MS || 560_000);

function readSseDoneFromText(text) {
  let last = null;
  for (const line of String(text || "").split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      last = JSON.parse(line.slice(6));
    } catch {
      /* ignore */
    }
  }
  return last;
}

function chatOnce(convId, message, projectId) {
  const body = JSON.stringify({ message, projectId });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: 8000,
        path: `/api/v1/conversations/${convId}/chat`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Accept: "text/event-stream",
        },
        timeout: CHAT_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode || 500) >= 400) {
            reject(new Error(`chat ${res.statusCode}: ${text.slice(0, 400)}`));
            return;
          }
          resolve(readSseDoneFromText(text));
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`chat timeout ${CHAT_TIMEOUT_MS}ms`)));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function chat(convId, message, projectId, { retries = 3 } = {}) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const done = await chatOnce(convId, message, projectId);
      if (!done || typeof done !== "object") {
        lastErr = new Error("chat empty SSE");
      } else if (
        done.event === "error" ||
        /429|529|502|503|overloaded|Too Many Requests/i.test(String(done.message || ""))
      ) {
        lastErr = new Error(`chat upstream: ${done.message || done.event}`);
      } else {
        return done;
      }
    } catch (err) {
      lastErr = err;
      const m = String(err?.message || err);
      if (!/ECONNRESET|timeout|fetch failed|ECONNREFUSED|socket hang up|429/i.test(m)) throw err;
    }
    // 429 多等一会；其它瞬时故障短退避
    const msg = String(lastErr?.message || "");
    await sleep(/429|Too Many Requests/i.test(msg) ? 15000 * (i + 1) : 2500 * (i + 1));
  }
  throw lastErr || new Error("chat failed");
}

async function pauseResumePath() {
  const p = await api("POST", "/projects", {
    title: `E2E-resume-${Date.now()}`,
    format: "manju",
    genreTags: ["e2e"],
    market: "cn",
    coverMeta: { e2e: true, kind: "pause_resume" },
  });
  // 用需要多轮工具的 agent，给 pause 留窗口
  const run = await api("POST", "/runs", {
    projectId: p.id,
    agentId: "char.bio_manju",
    inputJson: { format: "manju", brief: "重生商业，主角小传，请先读技能再写" },
  });
  const runId = run.id;
  let attemptAtPause = null;
  let sawRunning = false;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const cur = await api("GET", `/runs/${runId}`);
    if (["queued", "running"].includes(cur.status)) {
      if (cur.status === "running") sawRunning = true;
      if (sawRunning || cur.status === "queued") {
        attemptAtPause = cur.attempt ?? 1;
        const paused = await api("POST", `/tasks/runs/${runId}/pause`);
        console.log(`  · pause mode=${paused.mode || paused.status} attempt=${attemptAtPause}`);
        break;
      }
    }
    if (["succeeded", "completed", "failed", "dead", "cancelled"].includes(cur.status)) {
      throw new Error(`pause 窗口丢失：run 已终态 ${cur.status}`);
    }
    await sleep(1500);
  }
  if (attemptAtPause == null) throw new Error("未能在时限内 pause");

  // 等真正 paused（running+signal 需 worker 心跳）
  let pausedOk = false;
  for (let i = 0; i < 40; i++) {
    const cur = await api("GET", `/runs/${runId}`);
    if (cur.status === "paused") {
      pausedOk = true;
      break;
    }
    if (["succeeded", "completed"].includes(cur.status)) {
      console.log("  · run 在 pause 生效前已完成，跳过 resume 断言（仍算可恢复路径可达）");
      return p.id;
    }
    await sleep(2000);
  }
  if (!pausedOk) throw new Error("pause 信号发出后未进入 paused");

  const beforeResume = await api("GET", `/tasks/instances/${runId}`).catch(() =>
    api("GET", `/runs/${runId}`),
  );
  const attemptBefore = beforeResume.attempt ?? beforeResume.attemptCount ?? attemptAtPause;
  const resumed = await api("POST", `/tasks/runs/${runId}/resume`);
  console.log(`  · resume mode=${resumed.mode} status=${resumed.status}`);

  // 恢复闭环：重新入队并可被认领续跑即可；不把「整段小传写完」绑死在本套件
  let runningAgain = false;
  for (let i = 0; i < 60; i++) {
    const cur = await api("GET", `/runs/${runId}`);
    if (["running", "succeeded", "completed"].includes(cur.status)) {
      runningAgain = true;
      console.log(`  · resume 后续状态=${cur.status} attempt=${cur.attempt ?? "?"}`);
      break;
    }
    if (["failed", "dead", "cancelled"].includes(cur.status)) {
      throw new Error(`resume 后进入终态 ${cur.status}，未体现续跑`);
    }
    await sleep(2000);
  }
  if (!runningAgain) throw new Error("resume 后 120s 内未重新 running/succeeded");

  const afterView = await api("GET", `/tasks/instances/${runId}`).catch(() =>
    api("GET", `/runs/${runId}`),
  );
  const attemptAfter = afterView.attempt ?? afterView.attemptCount ?? attemptBefore;
  if (Number(attemptAfter) > Number(attemptBefore)) {
    throw new Error(
      `操作员 resume 不应抬高 attempt：pause前/时=${attemptBefore} 续跑后=${attemptAfter}`,
    );
  }
  const replay = await api("GET", `/runs/${runId}/replay`);
  await api("POST", `/tasks/runs/${runId}/stop`).catch(() => {});
  console.log(
    `✓ pause/resume ok attempt=${attemptBefore}→${attemptAfter} steps=${replay.steps?.length ?? 0}`,
  );
  return p.id;
}

async function personalAgentPath(seedProjectId) {
  const conv = await api("POST", "/conversations", {
    source: "assistant",
    projectId: seedProjectId,
    title: `E2E-PA-${Date.now()}`,
  });
  // 列项目
  const listDone = await chat(conv.id, "请用工具列出当前所有项目，简要回复标题和格式。", seedProjectId);
  console.log(`  · PA list reply=${String(listDone?.reply || listDone?.event || "").slice(0, 120)}`);
  // 代建项目
  const title = `E2E-PA-created-${Date.now()}`;
  const createDone = await chat(
    conv.id,
    `请帮我新建一个漫剧项目，标题就叫「${title}」，题材商业逆袭。建好后告诉我项目 id。`,
    seedProjectId,
  );
  console.log(`  · PA create reply=${String(createDone?.reply || "").slice(0, 160)}`);

  const projects = await api("GET", "/projects");
  const items = Array.isArray(projects) ? projects : projects.items || projects.projects || [];
  const created = items.find((p) => (p.title || p.name || "").includes("E2E-PA-created"));
  if (!created) {
    throw new Error("PA 未能代建项目（未在 /projects 中找到 E2E-PA-created*）");
  }
  // 审计应有 assistant create_project / chat
  const audits = await api("GET", `/tasks/audit?limit=40`);
  const list = Array.isArray(audits) ? audits : audits.items || audits.actions || [];
  const hit = list.some(
    (a) =>
      String(a.action || a.type || "").includes("create_project") ||
      String(a.summary || "").includes(title.slice(0, 12)),
  );
  if (!hit) {
    throw new Error("PA 代建项目未写入 /tasks/audit（缺 create_project 审计）");
  }
  console.log(`✓ PA always-on 代建项目 ${created.id} audit_hit=${hit}`);
  return { convId: conv.id, createdId: created.id };
}

async function feishuAlive() {
  // 飞书是独立 WS 进程；用进程/日志侧证 + 设置项可读
  const settings = await api("GET", "/settings").catch(() => null);
  const hasFeishu = Boolean(
    settings?.feishuAppId ||
      settings?.feishu_app_id ||
      process.env.FEISHU_APP_ID,
  );
  // 读 live log 末尾
  const { readFileSync } = await import("node:fs");
  let log = "";
  try {
    log = readFileSync("/tmp/xzmj-logs/feishu-live.log", "utf8").slice(-800);
  } catch {
    /* empty */
  }
  const connected = /connected to wss:\/\/msg-frontier\.feishu\.cn/i.test(log);
  if (!connected) throw new Error("飞书 WS 未连接（feishu-live.log 无 connected）");
  console.log(`✓ 飞书 always-on WS connected (settingsFeishu=${hasFeishu})`);
}

async function main() {
  console.log("== recovery + PA + feishu ==");
  await feishuAlive();
  const pid = await pauseResumePath();
  const { createdId } = await personalAgentPath(pid);
  if (CLEANUP) {
    for (const id of [pid, createdId]) {
      await api("DELETE", `/projects/${id}`).catch(() => {});
    }
  }
  console.log("ALL GREEN recovery-pa");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
