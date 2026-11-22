/**
 * Worker 侧租约守护（控制平面的数据面端点）：
 *   acquire → 周期心跳（同时上报执行 checkpoint）→ release
 * 心跳返回的 action=pause|stop、lease_lost 会转成对 AbortController 的 abort，
 * 由 index.js 按 reason 区分处理（paused / cancelled / lease_lost）。
 *
 * 默认 fail-closed：租约 API 不可达时拒绝执行（避免双跑）。
 * 仅当 AGENT_REQUIRE_LEASE=0/false 时降级为无租约旧路径。
 */

export const LEASE_TTL_S = Number(process.env.AGENT_LEASE_TTL_S || 90);

/** 生产默认要求租约；显式关闭才允许无 fencing 执行。 */
export function requireLease() {
  const v = String(process.env.AGENT_REQUIRE_LEASE ?? "true").toLowerCase();
  return !(v === "0" || v === "false" || v === "off" || v === "no");
}

export function heartbeatIntervalMs(ttlS = LEASE_TTL_S) {
  return Math.max(2000, Math.floor((ttlS * 1000) / 3));
}

/**
 * @returns {Promise<{ok:true, keeper: object, resume: boolean, checkpoint: object|null, attempt:number}
 *   | {ok:false, reason:string} | null>} null = 降级（无租约）
 */
export async function acquireRunLease(api, runId, owner, { ttlS = LEASE_TTL_S } = {}) {
  if (!runId) return null;
  let res;
  try {
    res = await api.acquireLease(runId, { owner, ttlS });
  } catch (err) {
    const msg = String(err?.message || err);
    // 404：run 不存在 → 跳过；409：冲突；其余网络错误按 requireLease 决定
    if (msg.includes("404")) return null;
    if (msg.includes("409")) return { ok: false, reason: "conflict" };
    if (requireLease()) return { ok: false, reason: "lease_unavailable" };
    return null;
  }
  if (!res?.ok) return { ok: false, reason: res?.reason || "denied" };
  return {
    ok: true,
    leaseVersion: res.leaseVersion,
    resume: Boolean(res.resume),
    checkpoint: res.checkpoint || null,
    attempt: res.attempt || 1,
  };
}

// A boundary arriving during an older probe must wait for a newer snapshot.
// Concurrent waiters may share the first probe started after their arrival.
export function serializeLeaseProbes(probe) {
  let pending;
  return async (fresh = false) => {
    if (fresh && pending) await pending;
    if (!pending) pending = Promise.resolve().then(probe).finally(() => { pending = undefined; });
    return pending;
  };
}

/**
 * 启动心跳；返回 { stop(), leaseVersion }。
 * @param {object} p
 * @param {object} p.api
 * @param {string} p.runId
 * @param {string} p.owner
 * @param {number} p.leaseVersion
 * @param {(e: Error) => void} p.abort      心跳判定需要中断时调用（index.js 里指向当前 AbortController）
 * @param {() => object} [p.getCheckpoint]  每次心跳取最新执行态
 * @param {number} [p.intervalMs]
 */
export function startLeaseKeeper({ api, runId, owner, leaseVersion, abort, getCheckpoint, ttlS = LEASE_TTL_S, intervalMs }) {
  let stopped = false;
  let lost = false;
  const beat = serializeLeaseProbes(async () => {
    if (stopped) return "lease_unverified";
    let reason;
    try {
      const res = await api.heartbeatRun(runId, {
        owner, leaseVersion, ttlS, checkpoint: getCheckpoint?.(),
      });
      if (res?.ok === false) reason = "lease_lost";
      else if (res?.ok !== true) return "lease_unverified";
      else if (res.action === "continue") return "continue";
      else if (res.action === "pause") reason = "paused";
      else if (res.action === "stop") reason = "cancelled";
      else return "lease_unverified";
    } catch (error) {
      if (!/^409\b/.test(String(error?.message))) return "lease_unverified";
      reason = "lease_lost";
    }
    if (reason === "lease_lost") lost = true;
    abort(new Error(reason));
    return reason;
  });
  const timer = setInterval(() => void beat(), intervalMs || heartbeatIntervalMs(ttlS));
  timer.unref?.();
  return {
    leaseVersion,
    isLost: () => lost,
    beat,
    stop: () => {
      stopped = true;
      clearInterval(timer);
      return beat();
    },
  };
}

/** 供 runSession 在崩溃续跑时注入给模型的提示（短、可执行；不重放，靠 artifacts 与 ledger 判断已完成项）。
 * 对齐 Hermes pause-safe / OpenClaw cold-start：先核对再续，给出首步动作与已知风险。 */
export function buildResumeNote(checkpoint, attempt = 1) {
  if (!checkpoint || typeof checkpoint !== "object") return "";
  const parts = [`【续跑提示】这是第 ${attempt} 次执行；上次实例异常中断，请先核对再继续，不要重复已完成的产出。`];
  if (checkpoint.turn) parts.push(`上次进行到第 ${checkpoint.turn} 轮${checkpoint.stage ? `（${checkpoint.stage}）` : ""}。`);
  if (checkpoint.lastTool?.name) {
    const st = checkpoint.lastTool.status;
    const stLabel =
      st === "done" ? "已完成" : st === "error" ? "失败（勿盲重放副作用，先核对产物/记忆）" : "结果未知，先读取确认再决定是否重做";
    parts.push(`最后一次工具调用：${checkpoint.lastTool.name}（${stLabel}）。`);
  }
  if (checkpoint.sessionHint) parts.push(String(checkpoint.sessionHint).slice(0, 800));
  if (Array.isArray(checkpoint.artifactIds) && checkpoint.artifactIds.length)
    parts.push(`已存在产物 ID：${checkpoint.artifactIds.slice(0, 12).join(", ")}（先读取再增量修改）。`);
  const pending = Array.isArray(checkpoint.pendingLedger)
    ? checkpoint.pendingLedger.filter((x) => x && x.status === "pending")
    : [];
  if (pending.length) {
    parts.push(
      `副作用账本有 ${pending.length} 条 pending（${pending
        .slice(0, 4)
        .map((x) => x.kind || x.tool || "?")
        .join(",")}）：先 artifact_list / memory_search 核对，已落地则跳过重做。`,
    );
  }
  // cold-start 首步：可读、可验证、可继续（禁止盲重放写工具）
  parts.push(
    "【首步】project_get → artifact_list →（若有）读取最近产物 → 再决定下一工具；写类工具须换新 idempotencyKey 或确认未落地后再执行。",
  );
  return parts.join("\n");
}

/** 构造随心跳上报的 checkpoint 快照（浅拷贝、限长）。 */
export function snapshotExecState(state) {
  if (!state) return undefined;
  const { turn, stage, lastTool, compactions, handoffs, artifactIds, traceId } = state;
  return {
    traceId,
    turn,
    stage,
    lastTool,
    compactions,
    handoffs,
    artifactIds: Array.isArray(artifactIds) ? artifactIds.slice(0, 40) : undefined,
    at: new Date().toISOString(),
  };
}
