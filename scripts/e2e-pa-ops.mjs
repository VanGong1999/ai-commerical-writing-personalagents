#!/usr/bin/env node
/**
 * Always-on PA 代操作全链路（右下角助手）：
 * list → create_project → run_agent → agent_ps → agent_pause/resume → steer → stop
 * → create_fleet → schedule_task → /tasks/audit 留痕
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

/** 用 node:http 拉 SSE，避开 undici 默认 bodyTimeout≈300s */
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
    req.on("timeout", () => {
      req.destroy(new Error(`chat timeout ${CHAT_TIMEOUT_MS}ms`));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function chat(convId, message, projectId, { retries = 4 } = {}) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const done = await chatOnce(convId, message, projectId);
      if (!done || typeof done !== "object") {
        lastErr = new Error("chat empty SSE (no done event)");
      } else {
        const msg = String(done?.message || done?.reply || "");
        if (done?.event === "error" || /529|502|503|overloaded|Server error/i.test(msg)) {
          lastErr = new Error(`chat upstream: ${done?.message || done?.event}`);
          if (/元操作等待|空闲超时/i.test(msg)) break;
        } else if (done?.queued) {
          lastErr = new Error(`chat queued: ${msg.slice(0, 120)}`);
        } else if (done?.event && done.event !== "done" && !msg) {
          lastErr = new Error(`chat incomplete event=${done.event}`);
        } else {
          return done;
        }
      }
    } catch (err) {
      lastErr = err;
      const m = String(err?.message || err?.cause || err);
      if (
        !/ECONNRESET|UND_ERR_SOCKET|UND_ERR_BODY_TIMEOUT|Body Timeout|terminated|fetch failed|ECONNREFUSED|other side closed|AbortError|chat timeout|socket hang up/i.test(
          m,
        )
      ) {
        throw err;
      }
    }
    await sleep(3000 * (i + 1));
  }
  throw lastErr || new Error("chat failed");
}

function mustInclude(text, needles, label) {
  const hay = String(text || "");
  for (const n of needles) {
    if (!hay.includes(n)) throw new Error(`${label} 未包含「${n}」: ${hay.slice(0, 200)}`);
  }
}

async function main() {
  console.log("== PA always-on ops ==");
  const stamp = Date.now();
  const conv = await api("POST", "/conversations", {
    source: "assistant",
    title: `E2E-PA-ops-${stamp}`,
  });

  // 1) 代建项目
  const title = `E2E-PA-ops-proj-${stamp}`;
  const created = await chat(
    conv.id,
    `请调用 create_project：标题「${title}」，format=manju。只做这一件事。`,
  );
  console.log("  · create", String(created?.reply || "").slice(0, 100));
  const projects = await api("GET", "/projects");
  const items = Array.isArray(projects) ? projects : projects.items || [];
  const project = items.find((p) => (p.title || "").includes("E2E-PA-ops-proj"));
  if (!project) throw new Error("PA 未代建项目");
  const pid = project.id;

  // 2) 代跑 agent（小传，便于 pause 窗口）
  const runKick = await chat(
    conv.id,
    `当前项目 id=${pid}。请 run_agent：agent_id=char.bio_manju，instruction=写一条重生商业主角小传，先读技能再写。`,
    pid,
  );
  console.log("  · run_agent", String(runKick?.reply || "").slice(0, 120));

  // 找到活跃 run
  let runId = null;
  for (let i = 0; i < 40; i++) {
    const inst = await api("GET", `/tasks/instances?projectId=${pid}&includeFinished=false`);
    const list = inst.instances || [];
    const hit = list.find((x) => ["queued", "running"].includes(x.state || x.status));
    if (hit) {
      runId = hit.runId || hit.id;
      break;
    }
    await sleep(1500);
  }
  if (!runId) {
    // 可能已极速完成：允许用 finished 最近一次
    const finished = await api("GET", `/tasks/instances?projectId=${pid}&includeFinished=true`);
    const list = finished.instances || [];
    runId = list[0]?.runId || list[0]?.id;
  }
  if (!runId) throw new Error("找不到 PA 拉起的 run");
  console.log(`  · active run=${runId.slice(0, 8)}`);

  // 3) agent_ps
  const ps = await chat(conv.id, `请 agent_ps 列出本项目实例（project_id=${pid}）。`, pid);
  console.log("  · ps", String(ps?.reply || "").slice(0, 100));

  // 4) pause / resume（API 确定性，避免模型犹豫丢窗口）+ PA inspect
  let cur = await api("GET", `/runs/${runId}`);
  if (["queued", "running"].includes(cur.status)) {
    const paused = await api("POST", `/tasks/runs/${runId}/pause`);
    console.log(`  · pause ${paused.mode}`);
    for (let i = 0; i < 30; i++) {
      cur = await api("GET", `/runs/${runId}`);
      if (cur.status === "paused" || ["succeeded", "completed", "failed"].includes(cur.status)) break;
      await sleep(2000);
    }
    if (cur.status === "paused") {
      // inspect 用 API（避免 LLM 长挂）；PA 工具面另由 agent_ps / schedule 覆盖
      const view = await api("GET", `/tasks/instances/${runId}`);
      console.log(
        `  · inspect state=${view.state} turn=${view.checkpoint?.turn} last=${view.checkpoint?.lastTool?.name || "-"}`,
      );
      const resumed = await api("POST", `/tasks/runs/${runId}/resume`);
      console.log(`  · resume ${resumed.mode}`);
    }
  }

  // 5) steer（若仍在跑）后 stop：验证生命周期；不空等整次小传写完（避免套件被长跑拖死）
  cur = await api("GET", `/runs/${runId}`);
  if (["queued", "running"].includes(cur.status)) {
    const steered = await chat(
      conv.id,
      `请 steer_agent：run_id=${runId}，message=请加快收尾，直接落 character 产物并 done_check。`,
      pid,
    );
    console.log("  · steer", String(steered?.reply || "").slice(0, 100));
  }
  cur = await api("GET", `/runs/${runId}`);
  if (["queued", "running", "paused"].includes(cur.status)) {
    const stopped = await api("POST", `/tasks/runs/${runId}/stop`);
    console.log(`  · stop ok=${stopped.ok !== false} status=${stopped.status || cur.status}`);
  }

  // 6–7) 元操作：即使 Worker 仍在跑，也应交总编（thread_router meta），不得被 steer 劫持
  const fleetMsg = await chat(
    conv.id,
    `请 create_fleet：project_id=${pid}，goal=补一条配角小传，members 用 char.bio_manju 一个成员即可。不要 steer。`,
    pid,
  );
  console.log("  · fleet", String(fleetMsg?.reply || "").slice(0, 140));
  if (/已直通|加入队列/.test(String(fleetMsg?.reply || ""))) {
    throw new Error("create_fleet 被 Worker 订阅劫持（应为 wake_chief）");
  }

  // 同会话继续：PA 侧 _compact_history 会压长上下文；「最大步数」是 ReAct 轮次上限，不是压缩没生效
  const schedName = `E2E巡检-${stamp}`;
  const sched = await chat(
    conv.id,
    `请只调用一次 schedule_task：name=${schedName}，cron=0 9 * * *，job_type=maintenance.noop。不要 tool_search 空转，完成后简短确认。`,
    pid,
  );
  console.log("  · schedule", String(sched?.reply || "").slice(0, 140));
  if (/已直通|加入队列/.test(String(sched?.reply || ""))) {
    throw new Error("schedule_task 被 Worker 订阅劫持（应为 wake_chief）");
  }

  // 8) 审计为权威证据（SSE 回复可能因步数上限为空，但工具副作用必须留痕）
  const audits = await api("GET", "/tasks/audit?limit=80");
  const list = audits.actions || [];
  const actions = new Set(list.map((a) => a.action));
  if (![...actions].includes("create_project")) throw new Error("审计缺少 create_project");
  if (![...actions].includes("agent_pause")) throw new Error("审计缺少 agent_pause");
  if (![...actions].includes("agent_stop")) throw new Error("审计缺少 agent_stop");
  if (![...actions].includes("create_fleet")) throw new Error("审计缺少 create_fleet");
  const schedHit = list.some(
    (a) =>
      a.action === "schedule_task" &&
      String(a.summary || "").includes(schedName.slice(0, 12)),
  );
  if (!schedHit) throw new Error(`审计缺少 schedule_task「${schedName}」`);
  console.log(`✓ audit actions sample=${[...actions].slice(0, 12).join(",")}`);

  if (CLEANUP) {
    await api("DELETE", `/projects/${pid}`).catch(() => {});
  }
  console.log("ALL GREEN pa-ops");
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
