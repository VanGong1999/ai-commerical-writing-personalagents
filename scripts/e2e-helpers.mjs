#!/usr/bin/env node
/**
 * E2E 共享 helpers：六格式回归 / 三章正文回归共用的 API 封装与舞台推进工具。
 */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(method, path, body, base = process.env.E2E_API_BASE || "http://127.0.0.1:8000", options = {}) {
  const retryable = options.retry !== false && ["GET", "HEAD"].includes(method.toUpperCase());
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/api/v1${path}`, {
        method,
        signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 15000)]) : AbortSignal.timeout(options.timeoutMs ?? 15000),
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        // 5xx / 热重载瞬间：退避重试
        if (retryable && res.status >= 500 && attempt < 3) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
      }
      return res.status === 204 ? null : await res.json();
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      if (retryable && /UND_ERR_SOCKET|ECONNREFUSED|ECONNRESET|fetch failed|other side closed/i.test(msg) && attempt < 3) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error(`${method} ${path} failed`);
}

export async function waitRun(runId, label, timeoutMs = 480_000, base) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  /** 瞬时 failed 可能被 worker/LLM 重试改回 queued/running（502 竞态），连续确认后再判死。 */
  let failedStreak = 0;
  for (;;) {
    last = await api("GET", `/runs/${runId}`, undefined, base);
    const st = last?.status;
    if (["succeeded", "completed"].includes(st)) break;
    if (st === "dead" || st === "cancelled") break;
    if (st === "failed") {
      failedStreak += 1;
      // 连续 3 次（约 15s）仍 failed 才认为终态；期间若回到 queued/running 则清零
      if (failedStreak >= 3) break;
    } else {
      failedStreak = 0;
    }
    if (Date.now() > deadline) break;
    await sleep(5000);
  }
  if (!["succeeded", "completed"].includes(last?.status)) {
    throw new Error(`${label} 未成功（status=${last?.status ?? "?"}，超时/失败）`);
  }
  // Gate 语义断言：inconclusive 不得被当作 pass 放行。
  for (const g of last.gateResults ?? []) {
    const verdict = g.verdict ?? g.status ?? g.result ?? "";
    if (g.passed === true && String(verdict).toLowerCase() === "inconclusive") {
      throw new Error(`${label}：Gate「${g.name ?? g.gate ?? "?"}」inconclusive 被当作 pass`);
    }
  }
  return last;
}

export async function runAgent(pid, agentId, label = agentId, inputJson = {}, base) {
  const run = await api("POST", "/runs", { projectId: pid, agentId, inputJson }, base);
  await waitRun(run.id, label, undefined, base);
  return run;
}

export async function artifacts(pid, base) {
  return api("GET", `/projects/${pid}/artifacts`, undefined, base);
}

export async function adoptLatest(pid, type, mode = "strong", base) {
  const arts = await artifacts(pid, base);
  const pool = arts.filter((a) => (type ? a.type === type : true));
  const candidates = [...pool]
    .filter((a) => a.status !== "adopted")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!candidates.length) return null;
  let lastError = null;
  for (const c of candidates) {
    try {
      await api("POST", `/projects/${pid}/artifacts/${c.id}/adopt`, { mode }, base);
      return c;
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`adopt ${type} 全部候选未通过门禁：${String(lastError?.message || lastError).slice(0, 200)}`);
}

/** 模拟用户从批量核心梗里挑一条：先落单梗 artifact（字段拍平），再强采纳。 */
export function flattenHookItem(item) {
  if (!item || typeof item !== "object") return null;
  if (item.candidate && typeof item.candidate === "object") item = item.candidate;
  const coreHook = String(item.core_hook ?? item.coreHook ?? "");
  const titleHook = String(item.title ?? item.titleHook ?? "");
  if (!coreHook && !titleHook) return null;
  let motivation = "";
  const mot = item.motivation;
  if (typeof mot === "string") motivation = mot;
  else if (mot && typeof mot === "object") {
    motivation = Object.entries(mot)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}：${String(v)}`)
      .join("；");
  }
  if (!motivation) {
    const four = item.four_step ?? item.fourStep ?? {};
    const parts = [];
    if (item.crisis) parts.push(`冲突线：${String(item.crisis)}`);
    if (four?.hook_point ?? four?.hookPoint) parts.push(`追剧点：${String(four.hook_point ?? four.hookPoint)}`);
    motivation = parts.join("；");
  }
  const opening = String(item.opening ?? item.openingStructure ?? item.opening_structure ?? "");
  const unwrap = (v) => {
    if (v == null) return [];
    if (typeof v === "string") return [v];
    if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
    if (typeof v === "object" && Array.isArray(v.item)) return unwrap(v.item);
    if (typeof v === "object" && Array.isArray(v.items)) return unwrap(v.items);
    return [];
  };
  return {
    titleHook,
    coreHook,
    tags: unwrap(item.tags),
    motivation: motivation || undefined,
    crisis: item.crisis ? String(item.crisis) : undefined,
    openingStructure: opening || undefined,
    openingBeats: unwrap(item.opening_beats ?? item.openingBeats),
    riskFlags: unwrap(item.risk_flags ?? item.riskFlags),
  };
}

export async function adoptCoreHook(pid, base) {
  const arts = await artifacts(pid, base);
  const hooks = arts.filter((a) => a.type === "core_hook" && a.status !== "adopted");
  for (const a of hooks) {
    const items = a.bodyJson?.items;
    if (Array.isArray(items) && items.length) {
      for (const item of items) {
        const flat = flattenHookItem(item);
        if (!flat || !flat.motivation || !flat.openingStructure) continue;
        const created = await api(
          "POST",
          `/projects/${pid}/artifacts`,
          {
            type: "core_hook",
            title: flat.titleHook,
            bodyJson: flat,
            status: "candidate",
            viaOntologyAction: true,
          },
          base,
        );
        await api("POST", `/projects/${pid}/artifacts/${created.id}/adopt`, { mode: "strong" }, base);
        return created;
      }
    } else if (a.bodyJson?.candidate && typeof a.bodyJson.candidate === "object") {
      const flat = flattenHookItem(a.bodyJson.candidate);
      if (flat && flat.motivation && flat.openingStructure) {
        await api("POST", `/projects/${pid}/artifacts/${a.id}/adopt`, { mode: "strong" }, base);
        return a;
      }
    }
  }
  const flatHook = [...hooks]
    .filter((a) => !Array.isArray(a.bodyJson?.items))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (flatHook) {
    await api("POST", `/projects/${pid}/artifacts/${flatHook.id}/adopt`, { mode: "strong" }, base);
    return flatHook;
  }
  throw new Error("没有可采纳的核心梗候选（批量产物缺少 motivation/opening）");
}

export async function stageLock(pid, format, currentStageId, completed, action, extra = {}, base) {
  const res = await api(
    "POST",
    "/agents/stage-lock",
    { format, currentStageId, completed, action, ...extra },
    base,
  );
  if (!res.ok && !res.locked) {
    throw new Error(`stage-lock ${format}/${currentStageId} ${action} 失败: ${JSON.stringify(res)}`);
  }
  return res;
}

/** 一路 advance 到目标 Stage：遇到 requiresUserAck 未确认时先 ack 再继续。 */
export async function advanceTo(pid, format, currentStageId, completed, target, base) {
  let stage = currentStageId;
  let done = [...completed];
  for (let i = 0; i < 40; i += 1) {
    if (stage === target) break;
    const res = await stageLock(pid, format, stage, done, "advance", {}, base);
    if (res.locked) {
      const acked = await stageLock(pid, format, stage, done, "ack", {}, base);
      done = acked.state.completed;
      continue;
    }
    stage = res.state.currentStageId;
    done = res.state.completed;
    if (res.nextStageIds?.length === 0) break;
  }
  if (stage !== target) {
    throw new Error(`${format}: advanceTo ${target} 失败，停在 ${stage}`);
  }
  await api("PATCH", `/projects/${pid}`, { stage }, base);
  return { stage, completed: done };
}
