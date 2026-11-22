import { claimAvailableJob, shouldExecuteJob, createExecutionGuard } from "./queueClaim.js";
import {notifyFleetTerminal} from './fleetLifecycle.js';
import {jobRetryDecision,abortableDelay} from './requestRetry.js';
import {waitBeforeJobRetry} from './retryControl.js';
import Redis from "ioredis";
import { config } from "./config.js";
import { api, RateLimitedApiError } from "./apiClient.js";
import { runAgentJob } from "./runSession.js";
import { initOtel } from "./otel.js";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { acquireRunLease, startLeaseKeeper, snapshotExecState, requireLease } from "./leaseKeeper.js";

const WORKER_ID = `${os.hostname()}:${process.pid}`;
/** runId → leaseVersion（patchRun 自动带 fencing token） */
const leaseVersions = new Map();
const executionGuard = createExecutionGuard();

/** 带 fencing 的 run 状态回写：旧 worker（租约已被回收）会收到 409，不会覆盖新实例的状态。 */
function patchRun(runId, body) {
  const lv = leaseVersions.get(runId);
  return api.patchRunStatus(runId, lv != null ? { ...body, leaseVersion: lv } : body);
}

const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
let redisOk = false;

const concurrencyCap = Math.max(
  1,
  Math.min(16, Number(process.env.AGENT_WORKER_CONCURRENCY || config.concurrency || 4)),
);
/** 运行时可调：由 LLM Governor 刷新（多 worker 共用同一 effective） */
let effectiveConcurrency = concurrencyCap;
let throttledUntil = 0;
/** @type {Map<string, AbortController>} */
const controllers = new Map();
/** @type {Set<Promise<void>>} */
const activeTasks = new Set();

async function refreshGovernor() {
  try {
    const view = await api.getLlmGovernor();
    if (!view) return;
    const next = Number(view.effective ?? view.cap ?? concurrencyCap);
    if (Number.isFinite(next) && next >= 1) {
      effectiveConcurrency = Math.max(1, Math.min(16, Math.min(concurrencyCap, next)));
    }
    if (view.throttled && view.throttleUntil) {
      throttledUntil = Number(view.throttleUntil) * 1000;
    } else if (!view.throttled) {
      throttledUntil = 0;
    }
  } catch {
    /* keep previous */
  }
}

function isThrottleWindow() {
  return throttledUntil > Date.now();
}

async function ensureRedis() {
  try {
    await redis.connect();
    await redis.ping();
    redisOk = true;
    console.log("[agent-worker] redis connected", config.redisUrl);
  } catch (err) {
    redisOk = false;
    console.warn("[agent-worker] redis unavailable, will poll API jobs:", err.message);
  }
}

function publish(jobId, event) {
  const payload = JSON.stringify(event);
  if (redisOk) {
    const channel = `${config.eventsPrefix}${jobId}`;
    redis.publish(channel, payload).catch(() => {});
    redis
      .xadd(`${channel}:stream`, "MAXLEN", "~", 500, "*", "data", payload)
      .catch(() => {});
  }
  if (event.type === "token") {
    process.stdout.write(event.text || "");
  }
}

async function isCancelled(jobId) {
  if (!redisOk) return false;
  const v = await redis.get(`${config.cancelPrefix}${jobId}`);
  return Boolean(v);
}

async function isInterrupted(runId) {
  if (!runId) return false;
  if (!redisOk) return false;
  const v = await redis.get(`interrupt:${runId}`);
  return Boolean(v);
}

async function clearInterrupted(runId) {
  if (!runId || !redisOk) return;
  return redis.del(`interrupt:${runId}`);
}

async function claimFromRedis() {
  if (!redisOk) return null;
  const item = await redis.brpop(config.jobQueueKey, 2);
  if (!item) return null;
  try {
    return JSON.parse(item[1]);
  } catch {
    return null;
  }
}

/** Redis 不可用时从 API 原子领取 queued agent jobs（按 priority） */
async function claimFromApi() {
  try {
    const claimed = await api.claimJob("agent.run,agent.batch");
    if (!claimed?.jobId) return null;
    return {
      jobId: claimed.jobId,
      type: claimed.type,
      payload: claimed.payload,
      runId: claimed.runId,
      attempts: claimed.attempts,
      maxAttempts: claimed.maxAttempts,
    };
  } catch {
    return null;
  }
}

function isRateLimitMessage(message) {
  return /429|rate_limited|限流|Too Many Requests|529|overloaded/i.test(String(message || ""));
}

async function requeueOrFail(jobId, runId, message, jobMeta = {}) {
  const attempts = Number(jobMeta.attempts || 0);
  const maxAttempts = Number(jobMeta.maxAttempts || 3);
  const decision=jobRetryDecision(jobMeta.error,attempts,maxAttempts);
  const rateLimited = Boolean(jobMeta.rateLimited) || isRateLimitMessage(message);
  const friendly = jobMeta.error?.retryable===false ? message : decision.local ? '本地容量等待中，任务已保留' : rateLimited
    ? "上游限流，已排队自动重试"
    : message;
  if (decision.retry) {
    const delayMs = rateLimited
      ? Math.max(15_000, Number(jobMeta.retryAfterMs) || 15_000)
      : 0;
    if (delayMs > 0) {
      // Both pause paths finish through the owning keeper. The helper's
      // unconfirmed paused event is superseded by finishPause's checked one.
      const retryApi = {...api, releaseLease: jobMeta.finishPause};
      const proceed = await waitBeforeJobRetry(delayMs, {
        signal:jobMeta.signal, api:retryApi, jobId, runId, owner:jobMeta.owner,
        leaseVersion:leaseVersions.get(runId), checkpoint:jobMeta.checkpoint,
        publish: event => { if (event.status !== "paused") publish(jobId, event); },
        notifyTerminal:notifyFleetTerminal,
      });
      if (!proceed) return;
    }
    // 重新入队：status=queued，保留 attempts；限流期间不标 failed
    await api
      .patchJobStatus(jobId, {
        status: "queued",
        attempts: decision.nextAttempts,
        error: decision.local ? friendly : `retry ${attempts}/${maxAttempts}: ${friendly}`,
      })
      .catch(() => {});
    if (runId) {
      await patchRun(runId, { status: "queued", error: friendly }).catch(() => {});
      if (rateLimited) {
        await api
          .patchRunProgress(runId, { progressStage: decision.local ? '本地容量排队' : "上游限流排队" })
          .catch(() => {});
      }
    }
    // 若从 Redis BRPOP 误领且需延后：由调用方 LPUSH；此处只改 DB 状态
    if (redisOk && rateLimited && jobMeta.envelope) {
      try {
        await redis.lpush(config.jobQueueKey, JSON.stringify(jobMeta.envelope));
      } catch {
        /* ignore */
      }
    }
    publish(jobId, { type: "status", status: "queued", retry: !decision.local, attempts:decision.nextAttempts, maxAttempts, rateLimited,source:jobMeta.error?.source });
    publish(jobId, { type: "done", status: "queued" });
    return;
  }
  const failMsg = rateLimited && jobMeta.error?.retryable!==false
    ? `${friendly}（已达重试上限，请切换备用 Provider 或降低并发）`
    : message;
  await api.patchJobStatus(jobId, { status: "failed", error: failMsg }).catch(() => {});
  if (runId) {
    await patchRun(runId, { status: "failed", error: failMsg }).catch(() => {});
  }
  publish(jobId, { type: "error", message: failMsg });
  publish(jobId, { type: "status", status: "failed" });
  publish(jobId, { type: "done", status: "failed" });
  await notifyFleetTerminal(api, jobId, runId, 'failed', failMsg).catch(() => {});
}

async function interruptedInput(runId, original) {
  // If polling is unavailable, terminal delivery still fences this original revision.
  const steered = runId ? await api.getSteer(runId).catch(() => null) : {};
  if (!steered) return original;
  if (steered.inputJson?.steerRevision) return steered.inputJson;
  const extra = (steered.messages || []).filter(Boolean).join("\n");
  return {...original, assistantPrompt:
    `${original?.assistantPrompt || ""}\n\n【中断后新指令】${extra || "按最新指令继续"}`.trim()};
}

function startWatchSignals(jobId, runId, ac) {
  const timer = setInterval(async () => {
    try {
      if (await isCancelled(jobId)) {
        ac.abort(new Error("cancelled"));
        return;
      }
      if (runId && (await isInterrupted(runId))) {
        ac.abort(new Error("interrupted"));
      }
    } catch {
      /* ignore */
    }
  }, 1000);
  return () => clearInterval(timer);
}

async function processEnvelope(envelope) {
  const jobId = envelope.jobId || envelope.job_id;
  if (!jobId) return;
  let job;
  try {
    job = await api.getJob(jobId);
  } catch (err) {
    if (String(err?.message || "").includes("404")) {
      // 项目被删除时队列里可能残留任务：静默跳过，不打「failed」噪音。
      console.log(`[agent-worker] skip job ${jobId} (not found, project deleted)`);
      return;
    }
    throw err;
  }
  if (!job) return;
  const runId = job.resultRef || job.payload?.runId;
  return executionGuard.run([`job:${jobId}`, runId ? `run:${runId}` : null],
    () => executeEnvelope(envelope, job));
}

async function executeEnvelope(envelope, job) {
  const jobId = job.id || envelope.jobId || envelope.job_id;
  const executionOwner = `${WORKER_ID}:${randomUUID()}`;
  if (!shouldExecuteJob(job)) return;
  if (job.status === "cancelled" || (await isCancelled(jobId))) {
    await api.patchJobStatus(jobId, { status: "cancelled" }).catch(() => {});
    const rid = job.resultRef || job.payload?.runId;
    if (rid) await patchRun(rid, { status: "cancelled" }).catch(() => {});
    publish(jobId, { type: "status", status: "cancelled" });
    publish(jobId, { type: "done", status: "cancelled" });
    return;
  }
  if (job.type !== "agent.run" && job.type !== "agent.batch") {
    return;
  }

  publish(jobId, { type: "status", status: "running", jobId });
  const runId = job.resultRef || job.payload?.runId;
  const run = runId ? await api.getRun(runId).catch(() => null) : null;
  // —— 租约：同一 run 只能有一个执行者；暂停/停止/他人持有 → 跳过 ——
  // 默认 fail-closed：API 不可达时不裸跑（防双写）；AGENT_REQUIRE_LEASE=0 才降级。
  const lease = runId ? await acquireRunLease(api, runId, executionOwner) : null;
  if (lease && !lease.ok) {
    console.log(`[agent-worker] skip run ${runId}: lease ${lease.reason}`);
    publish(jobId, { type: "status", status: lease.reason, jobId, runId });
    if (lease.reason === "lease_unavailable") {
      await requeueOrFail(jobId, runId, "lease_unavailable: 控制面不可达，拒绝无租约执行", {
        attempts: envelope.attempts ?? job.attempts,
        maxAttempts: envelope.maxAttempts ?? job.maxAttempts,
      });
    }
    return;
  }
  if (runId && lease == null && requireLease()) {
    console.log(`[agent-worker] skip run ${runId}: lease required but unavailable`);
    publish(jobId, { type: "status", status: "lease_unavailable", jobId, runId });
    await requeueOrFail(jobId, runId, "lease_required: acquire 返回空，拒绝无 fencing 执行", {
      attempts: envelope.attempts ?? job.attempts,
      maxAttempts: envelope.maxAttempts ?? job.maxAttempts,
    });
    return;
  }
  const execState = { traceId: runId ? `${runId}:${lease?.attempt || 1}` : undefined };
  let ac = new AbortController();
  controllers.set(jobId, ac);
  let stopWatch = startWatchSignals(jobId, runId, ac);
  let keeper = null;
  if (lease?.ok) {
    leaseVersions.set(runId, lease.leaseVersion);
    keeper = startLeaseKeeper({
      api,
      runId,
      owner: executionOwner,
      leaseVersion: lease.leaseVersion,
      abort: (e) => controllers.get(jobId)?.abort(e),
      getCheckpoint: () => snapshotExecState(execState),
    });
    if (lease.resume) {
      publish(jobId, { type: "status", status: "resumed", attempt: lease.attempt, jobId, runId });
    }
  }
  const resume = lease?.ok && lease.resume ? { checkpoint: lease.checkpoint, attempt: lease.attempt } : null;

  await api.patchJobStatus(jobId, { status: "running" }).catch(() => {});
  if (runId) {
    await patchRun(runId, { status: "running" }).catch(() => {});
    await api
      .patchRunProgress(runId, { progressPct: 5, progressStage: "启动中", status: "running" })
      .catch(() => {});
  }

  const finishPause = async () => {
    await keeper?.stop();
    const release = await api.releaseLease(runId, {
      owner: executionOwner, leaseVersion: leaseVersions.get(runId),
      state: "paused", checkpoint: snapshotExecState(execState),
    });
    if (release?.ok !== true || release.status !== "paused") return;
    publish(jobId, { type: "status", status: "paused", jobId, runId });
    publish(jobId, { type: "done", status: "paused" });
  };

  const execute = async (input, replacement) => {
    const controller = ac;
    const checkAdmission = async () => {
      controller.signal.throwIfAborted();
      try {
        if (await isCancelled(jobId)) controller.abort(new Error("cancelled"));
        else if (await isInterrupted(runId)) controller.abort(new Error("interrupted"));
      } catch (cause) {
        if (!keeper) throw cause;
        controller.abort(new Error("lease_unverified", {cause}));
      }
      controller.signal.throwIfAborted();
      if (keeper) {
        const reason = await keeper.beat(true);
        if (reason !== "continue") controller.abort(new Error(reason));
      }
      controller.signal.throwIfAborted();
    };
    const result = await runAgentJob({
      job: {
        id: job.id,
        leaseVersion: lease?.leaseVersion,
        projectId: job.projectId,
        // A compacted run binds the original dispatch input into its scope.
        payload: replacement && !run ? { ...job.payload, input } : job.payload,
        type: job.type,
        attempts: job.attempts ?? envelope.attempts ?? 0,
      },
      run: run ? { id: run.id, agentId: run.agentId, projectId: run.projectId, inputJson: input } : null,
      publish: (e) => publish(jobId, e),
      signal: controller.signal,
      checkAdmission, execState, resume,
      onProgress: (pct, stage) => {
        if (runId) void api.patchRunProgress(runId, { progressPct: pct, progressStage: stage }).catch(() => {});
        publish(jobId, { type: "progress", progressPct: pct, progressStage: stage, runId });
      },
    });
    await checkAdmission();
    return result;
  };
  try {
    let input = run?.inputJson || job.payload?.input;
    let replacement = false;
    for (;;) {
      try {
        const result = await execute(input, replacement);
        const artifactIds = result?.artifactIds || result?.outputArtifactIds || [];
        const status = result?.receipt?.status === "failed" ? "failed" : "succeeded";
        await finalize(jobId, runId, status, artifactIds, result);
        break;
      } catch (error) {
        if ((ac.signal.reason?.message || error?.message) !== "interrupted") throw error;
        stopWatch();
        const removed = await clearInterrupted(runId).catch(() => undefined);
        // Zero is a confirmed acknowledgement too: the key is already gone.
        if (removed !== 0 && removed !== 1) {
          throw Object.assign(new Error("Interrupt acknowledgement unavailable"), {code: "INTERRUPT_ACK_UNVERIFIED"});
        }
        publish(jobId, { type: "status", status: "interrupted", jobId, runId });
        ac = new AbortController();
        controllers.set(jobId, ac);
        stopWatch = startWatchSignals(jobId, runId, ac);
        input = await interruptedInput(runId, input || {});
        replacement = true;
      }
    }
  } catch (err) {
    const message = String(err.message || err);
    const abortReason = ac.signal.reason?.message;
    if (abortReason === "lease_unverified" || err.code === "INTERRUPT_ACK_UNVERIFIED") {
      console.warn(`[agent-worker] cannot verify lease for ${runId}; leaving it for recovery`);
      return;
    }
    if (abortReason === "lease_lost" || keeper?.isLost()) {
      // 租约已被回收：新实例接管，本 worker 静默退出，不写任何状态（fencing）
      console.warn(`[agent-worker] run ${runId} lease lost, abandoning`);
      return;
    }
    if (abortReason === "paused") {
      await finishPause();
      return;
    }
    if (abortReason === "cancelled" || message.includes("cancelled") || (await isCancelled(jobId))) {
      await api.patchJobStatus(jobId, { status: "cancelled" }).catch(() => {});
      if (runId) await patchRun(runId, { status: "cancelled" }).catch(() => {});
      publish(jobId, { type: "status", status: "cancelled" });
      publish(jobId, { type: "done", status: "cancelled" });
      await notifyFleetTerminal(api, jobId, runId, 'cancelled', message).catch(() => {});
      return;
    }
    const rateLimited =
      err instanceof RateLimitedApiError || isRateLimitMessage(message);
    // API 服务是 provider 限流唯一上报者；本地排队和同一429不能在这里重复降低容量。
    await requeueOrFail(jobId, runId, message, {
      attempts: job.attempts ?? envelope.attempts,
      maxAttempts: job.maxAttempts ?? envelope.maxAttempts ?? 3,
      rateLimited,
      retryAfterMs: err instanceof RateLimitedApiError ? err.retryAfter * 1000 : 15_000,
      envelope,
      error:err,
      signal:ac.signal,
      finishPause,
      owner:executionOwner,
      checkpoint:snapshotExecState(execState),
    });
  } finally {
    stopWatch();
    await keeper?.stop();
    leaseVersions.delete(runId);
    controllers.delete(jobId);
  }
}

async function finalize(jobId, runId, finalStatus, artifactIds, result) {
  // 成功/限流按模型请求统计，由 API 统一维护，不再按 Job 再计一次。
  if (!runId || !leaseVersions.has(runId)) {
    await api.patchJobStatus(jobId, { status: finalStatus, resultRef: runId || undefined });
  }
  if (runId) {
    const terminal = {
        status: finalStatus,
        steerRevision: result?.steerRevision,
        outputArtifactIds: Array.isArray(artifactIds) ? artifactIds : [],
        receiptId: result?.receiptId,
        gateResults: result?.gates || [],
        tokenPrompt: result?.receipt?.tokenPrompt,
        tokenCompletion: result?.receipt?.tokenCompletion,
        tokenCacheHit: result?.receipt?.tokenCacheHit,
        tokenCacheMiss: result?.receipt?.tokenCacheMiss,
        receipt: result?.receipt
          ? {
              attestation: result.receipt.attestation,
              outputVersions: result.outputVersions,
              exitReason: result.exitReason,
              narrative: result.receipt.narrative,
              handoff: result.receipt.handoff,
              runId,
              status: finalStatus,
            }
          : undefined,
    };
    if (leaseVersions.has(runId)) terminal.terminalJobId = jobId;
    // Retrying only this idempotent write cannot invoke the model again.
    while (true) {
      try {
        const delivered = await patchRun(runId, terminal);
        if (delivered?.status === "queued") {
          publish(jobId, {type: "status", status: "queued", runId});
          return;
        }
        break;
      } catch (error) {
        const signal = controllers.get(jobId)?.signal;
        const status = error.status || Number(/^(4\d\d) /.exec(String(error.message))?.[1]);
        if (status === 409) {
          console.warn(`[agent-worker] terminal delivery fenced for ${runId}; leaving existing rows for recovery`);
          return;
        }
        if (signal?.aborted || (status >= 400 && status < 500 && status !== 429)) throw error;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    await api
      .patchRunProgress(runId, {
        progressPct: finalStatus === "succeeded" ? 100 : undefined,
        progressStage: result?.exitReason === "pending_human_ack" ? "清单已保存，待人工确认" :
          finalStatus === "succeeded" ? "完成" : "失败",
      })
      .catch(() => {});
  }
  await notifyFleetTerminal(api, jobId, runId, finalStatus,
    result?.handoff || result?.receipt?.handoff || finalStatus).catch(() => {});
  publish(jobId, { type: "status", status: finalStatus, receipt: result });
  publish(jobId, { type: "done", status: finalStatus });
}

async function waitForSlot() {
  // 定期回到主循环刷新容量，避免降到1后被慢任务阻塞而看不见恢复后的额度。
  await Promise.race([...activeTasks,abortableDelay(1000)]);
}

/** 单个任务的失败只记录日志，绝不能让 worker 进程因未处理的 rejection 退出 */
function track(promise) {
  const tracked = promise
    .catch((err) => {
      console.error("[agent-worker] job failed outside handler:", err?.message || err);
    })
    .finally(() => activeTasks.delete(tracked));
  activeTasks.add(tracked);
}

async function main() {
  console.log(
    `[agent-worker] starting — concurrencyCap=${concurrencyCap} (AGENT_WORKER_CONCURRENCY), adaptive via llm-governor`,
  );
  await initOtel();
  await ensureRedis();
  await refreshGovernor();
  let lastGovRefresh = Date.now();
  for (;;) {
    try {
      if (Date.now() - lastGovRefresh > 2000) {
        await refreshGovernor();
        lastGovRefresh = Date.now();
      }
      // 节流窗或有效并发已满：停止 claim（BRPOP 即领取，误领需回队）
      if (isThrottleWindow() || activeTasks.size >= effectiveConcurrency) {
        if (activeTasks.size >= effectiveConcurrency) {
          await waitForSlot();
        } else {
          await new Promise((r) => setTimeout(r, 500));
        }
        continue;
      }
      let envelope = await claimAvailableJob(claimFromRedis, claimFromApi);
      // claim 后若并发被压低或进入节流：回队，避免误领占坑
      if (
        envelope &&
        redisOk &&
        (isThrottleWindow() || activeTasks.size >= effectiveConcurrency)
      ) {
        await redis.lpush(config.jobQueueKey, JSON.stringify(envelope));
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      if (envelope) {
        if (
          envelope.type === "agent.run" ||
          envelope.type === "agent.batch" ||
          envelope.payload?.runId
        ) {
          track(processEnvelope(envelope));
        } else if (redisOk) {
          await redis.lpush(config.jobQueueKey, JSON.stringify(envelope));
          await new Promise((r) => setTimeout(r, 200));
        }
      } else {
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (err) {
      console.error("[agent-worker] loop error", err);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// 进程级兜底：未捕获异常不得静默退出（无日志就无法区分 OOM / 未处理 rejection）
process.on("uncaughtException", (err) => {
  console.error("[agent-worker] uncaughtException", err?.stack || err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[agent-worker] unhandledRejection", reason);
});

main().catch((err) => {
  console.error("[agent-worker] fatal", err?.stack || err);
  process.exit(1);
});
