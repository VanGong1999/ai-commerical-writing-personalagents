import { config } from "./config.js";
import {retryRejectedModelRequest,abortableDelay} from './requestRetry.js';

export class RateLimitedApiError extends Error {
  constructor(message, { retryAfter = 15, path = "",code='rate_limited',source='provider',retryable=true,governorReported=false,status=429,providerCode,traceId } = {}) {
    super(message);
    this.name = "RateLimitedApiError";
    this.code = code;
    this.source = source;
    this.retryable = retryable;
    this.governorReported = governorReported;
    this.status = status;
    this.providerCode = providerCode;
    this.traceId = traceId;
    this.retryAfter = Number(retryAfter) || 15;
    this.path = path;
  }
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function uncertainMutation(path, cause) {
  if (path.startsWith("/llm/")) {
    const error = new Error(`${path}: 未收到有效模型回复（${cause?.message || "连接中断"}），请查看模型服务状态后恢复。`);
    error.code = "llm_request_failed";
    error.cause = cause;
    return error;
  }
  const error = new Error(`${path}: 写入结果未知，请先读取现有产物核查，禁止直接重复提交。`);
  error.code = "mutation_result_unknown";
  error.cause = cause;
  return error;
}

async function req(path, init, readOnlyPost = false) {
  // 读取可重试；非幂等写入发生连接丢失时保留不确定结果，交由核查恢复。
  const { retryAttempts, retryBackoffMs, ...fetchInit } = init || {};
  const readOnly = readOnlyPost || ["GET", "HEAD", "OPTIONS"].includes(String(fetchInit.method || "GET").toUpperCase());
  // Mutations may have committed even when the response is lost. Only reads retry.
  const attempts = readOnly ? Number(retryAttempts || 3) : 1;
  const backoffBase = Number(retryBackoffMs || 2000);
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(20_000, backoffBase * attempt) + Math.floor(Math.random() * 800)),
      );
    }
    try {
      const res = await fetch(`${config.apiBase}/api/v1${path}`, {
        ...fetchInit,
        headers: {
          "Content-Type": "application/json",
          ...(process.env.LOCAL_API_TOKEN ? {"X-XZM-Local-Token": process.env.LOCAL_API_TOKEN} : {}),
          ...(fetchInit?.headers || {}),
        },
      });
      if (res.status === 429 || res.status === 503) {
        const text = await res.text().catch(() => "");
        const body = parseJsonSafe(text) || {};
        if (res.status === 503 && !['local_queue_timeout','local_capacity','provider_rate_limited','rate_limited'].includes(body.code)) {
          if (!readOnly) throw uncertainMutation(path,new Error(body.message || body.detail || 'HTTP 503'));
          lastError=new Error(`503 ${path}（服务暂时不可用）`);
          continue;
        }
        const retryAfter =
          Number(body.retryAfter || body.retry_after) ||
          Number(res.headers.get("retry-after")) ||
          15;
        const provenance={code:body.code || 'rate_limited',source:body.source || 'provider',
          retryable:body.retryable!==false,governorReported:body.governorReported===true,status:res.status,
          providerCode:body.providerCode,traceId:body.traceId};
        if (provenance.retryable && attempt < attempts - 1) {
          lastError = new RateLimitedApiError(`429 ${path}（限流，${retryAfter}s 后重试）`, {
            retryAfter,
            path,
            ...provenance,
          });
          await abortableDelay(Math.max(1,retryAfter*1000),fetchInit.signal);
          continue;
        }
        throw new RateLimitedApiError(
          body.message || body.detail || `429 ${path}: 上游限流，已排队自动重试`,
          { retryAfter, path, ...provenance },
        );
      }
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        const text = await res.text().catch(() => "");
        const envelope = parseJsonSafe(text) || {};
        const body = typeof envelope.detail==='object' && envelope.detail ? {...envelope,...envelope.detail} : envelope;
        if(['invalid_model_response','context_length_exceeded'].includes(body.code)) {
          const error=new Error(body.message || body.detail || '模型服务响应格式无效');
          error.code=body.code;error.status=res.status;
          throw error;
        }
        if (body.code === "rate_limited") {
          const retryAfter = Number(body.retryAfter || 15);
          throw new RateLimitedApiError(body.message || "上游限流，已排队自动重试", {
            retryAfter,
            path,
            code:body.code,source:body.source || 'provider',retryable:body.retryable!==false,
            governorReported:body.governorReported===true,status:res.status,
          });
        }
        if (!readOnly) throw uncertainMutation(path, new Error(body.message || body.detail || `HTTP ${res.status}`));
        lastError = new Error(`${res.status} ${path}（服务暂时不可用）`);
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status} ${path}: ${text}`);
      }
      if (res.status === 204) return null;
      return res.json();
    } catch (error) {
      if (error?.name === "AbortError") {
        throw error;
      }
      if (error instanceof RateLimitedApiError) {
        throw error;
      }
      const isNetwork = error instanceof TypeError || /fetch failed|ECONNRESET|ECONNREFUSED|aborted/i.test(String(error?.message || error));
      if (isNetwork && !readOnly) throw uncertainMutation(path, error);
      if (isNetwork && attempt < attempts - 1) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error(`${path}: request failed`);
}

/** Ontology action-only Artifact types（与 packages/ontology catalog 对齐） */
export const ONTOLOGY_ACTION_ONLY_TYPES = new Set([
  "core_hook",
  "character",
  "episode_outline",
  "story_graph",
  "episode_graph",
  "foreshadow_ledger",
  "expectation_conflict",
  "manuscript",
  "master_outline",
  "framework",
  "character_graph",
]);

export const ARTIFACT_TO_OBJECT_TYPE = {
  core_hook: "CoreHook",
  character: "Character",
  episode_outline: "EpisodeOutline",
  story_graph: "StoryGraph",
  episode_graph: "EpisodeGraph",
  foreshadow_ledger: "ForeshadowEntry",
  expectation_conflict: "ExpectationConflict",
  manuscript: "Manuscript",
  master_outline: "MasterOutline",
  framework: "Framework",
  character_graph: "CharacterRelation",
};

export const api = {
  knowledgeRole: (run, job) => req(`/runs/${encodeURIComponent(run)}/knowledge-role?${new URLSearchParams({job_id:job})}`),
  knowledgeReports: async (run, job, version) => {
    const result = await req(`/runs/${encodeURIComponent(run)}/knowledge-outputs?${new URLSearchParams({job_id:job,version,evidence:"true"})}`);
    if (!Array.isArray(result?.artifacts)) throw new Error("无法核对本次知识报告");
    return result.artifacts;
  },
  reviseKnowledgeReport: async (run, job, artifactId, body) => {
    const path = `/runs/${encodeURIComponent(run)}/knowledge-outputs/${encodeURIComponent(artifactId)}?${new URLSearchParams({job_id:job})}`;
    try {
      const row = await req(path, {method:"PATCH", body:JSON.stringify(body)});
      if (row?.id !== artifactId || row?.createdByRunId !== run || row?.version !== body.expectedVersion + 1)
        throw uncertainMutation(path, new Error("缺少本次修订的版本回执"));
      return row;
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof TypeError || /^5\d\d /.test(error.message))
        throw uncertainMutation(path, error);
      throw error;
    }
  },
  knowledgeOutputs: (run, job, version) => req(`/runs/${encodeURIComponent(run)}/knowledge-outputs?${new URLSearchParams({job_id:job,version})}`),
  knowledgeCitations: (run, job, roleVersion, citations) =>
    req(`/runs/${encodeURIComponent(run)}/knowledge-citations?${new URLSearchParams({job_id:job})}`,
      {method:"POST", body:JSON.stringify({roleVersion, citations})}, true),
  knowledgePage: (run, job, doc, offset, limit, version) => req(`/runs/${encodeURIComponent(run)}/knowledge-doc/${encodeURIComponent(doc)}?${new URLSearchParams({job_id:job,offset,limit,version})}`),
  knowledgeSearch: (run, job, q, limit, version) => req(`/runs/${encodeURIComponent(run)}/knowledge-search?${new URLSearchParams({job_id:job,q,limit,version})}`),
  listProposals: () => req("/task-proposals"),
  saveProposalChecklist: (projectId,runId,body) => req(`/projects/${projectId}/runs/${runId}/proposal-checklist`, {method:"POST",body:JSON.stringify(body)}),
  getJob: (id) => req(`/jobs/${id}`),
  getRun: (id) => req(`/runs/${id}`),
  getProject: (id) => req(`/projects/${id}`),
  getPersonalizationContext: (id) => req(`/projects/${encodeURIComponent(id)}/personalization-context`),
  getAppSettings: () => req(`/settings/app`).catch(() => ({ featureToggles: {} })),
  listJobs: (projectId) =>
    req(`/jobs${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`),
  claimJob: (types = "agent.run,agent.batch") =>
    req(`/jobs/claim?types=${encodeURIComponent(types)}`, { method: "POST" }),
  createSecurityAsk: (runId, body) =>
    req(`/runs/${encodeURIComponent(runId)}/security-ask`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getSecurityAsk: (runId, askId) =>
    req(`/runs/${encodeURIComponent(runId)}/security-ask/${encodeURIComponent(askId)}`),
  respondSecurityAsk: (runId, askId, approve = true, reason = "") =>
    req(
      `/runs/${encodeURIComponent(runId)}/security-ask/${encodeURIComponent(askId)}/respond?approve=${approve ? "true" : "false"}&reason=${encodeURIComponent(reason)}`,
      { method: "POST" },
    ),
  listArtifacts: (projectId, type) =>
    req(`/projects/${projectId}/artifacts${type ? `?type=${encodeURIComponent(type)}` : ""}`),
  ontologySubmit: (body) =>
    req(`/ontology/actions/submit`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ontologyQuery: (body) =>
    req(`/ontology/query`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ontologyObjects: (projectId, typeApiName) =>
    req(
      `/ontology/projects/${projectId}/objects${typeApiName ? `?typeApiName=${encodeURIComponent(typeApiName)}` : ""}`,
    ),
  ontologyRegistry: () => req(`/ontology/registry`),
  listArtifactVersions: (projectId, id) => req(`/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(id)}/versions`),
  createArtifact: async (projectId, body) => {
    // 真实写入失败必须向上抛错（由工具层转成 tool-error 回喂模型），
    // 禁止伪造成功 UUID：假成功会让模型以为产物已落库，造成幽灵产物与死循环。
    const type = body?.type;
    if (ONTOLOGY_ACTION_ONLY_TYPES.has(type)) {
      const typeApiName = ARTIFACT_TO_OBJECT_TYPE[type] || "Manuscript";
      const actionApiName =
        type === "story_graph"
          ? "UpsertStoryGraph"
          : type === "foreshadow_ledger"
            ? "UpsertForeshadow"
            : "UpsertObject";
      const parameters =
        actionApiName === "UpsertStoryGraph"
          ? { graph: { ...(body.bodyJson || {}), title: body.title }, title: body.title }
          : actionApiName === "UpsertForeshadow"
            ? { entry: { ...(body.bodyJson || {}), title: body.title } }
            : {
                typeApiName,
                properties: {
                  ...(body.bodyJson || {}),
                  title: body.title,
                  bodyMarkdown: body.bodyMarkdown,
                  status: body.status || "candidate",
                },
              };
      // 把 run 关联透传到 ontology 物化路径（后端按 created_by_run_id 采纳本步产物）
      parameters.createdByRunId = body.createdByRunId;
      const result = await api.ontologySubmit({
        actionApiName,
        projectId,
        actor: "agent",
        parameters,
      });
      if (!result?.ok) {
        throw new Error(`ontology_action_failed: ${JSON.stringify(result)}`);
      }
      const rows = await api.listArtifacts(projectId, type);
      const materializedIds = new Set((result.applied || []).map(edit => edit.artifactId).filter(Boolean));
      if (materializedIds.size) {
        const exact = (rows || []).find(row => materializedIds.has(row.id));
        if (!exact) throw new Error("物化产物未能读取，请按 Action 返回的 artifactId 核对，禁止重复创建");
        if (!body.createdByRunId) return exact;
        const edit = result.applied.find(e => e.artifactId === exact.id);
        if (Number.isInteger(edit.artifactVersion) && edit.artifactVersion === exact.version) return exact;
        const history = await api.listArtifactVersions(projectId, exact.id);
        const written = history.find(v => v.artifactId === exact.id && v.actor === `agent:${body.createdByRunId}` &&
          (edit.artifactVersion == null || v.version === edit.artifactVersion));
        if (!written) throw new Error("缺少本次运行对应的不可变物化版本，请核对收据。");
        return {...exact, version:written.version, title:written.title, bodyMarkdown:written.bodyMarkdown,
          bodyJson:written.bodyJson, status:written.status};
      }
      if (body.createdByRunId) throw new Error("缺少 Action 物化收据，请核对后继续。");
      const hit =
        (rows || []).filter((r) => r.title === body.title && (!body.createdByRunId || r.createdByRunId === body.createdByRunId))
          .sort((a,b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
      if (hit) return hit;
      return req(`/projects/${projectId}/artifacts`, {
        method: "POST",
        body: JSON.stringify({ ...body, viaOntologyAction: true }),
      });
    }
    // 非名单类型也带上 via，避免 registry 扩容后 worker 未同步仍 409
    return req(`/projects/${projectId}/artifacts`, {
      method: "POST",
      body: JSON.stringify({ ...body, viaOntologyAction: true }),
    });
  },
  updateArtifact: (projectId, artifactId, body) =>
    req(`/projects/${projectId}/artifacts/${artifactId}`, {
      method: "PATCH",
      body: JSON.stringify({ ...body, viaOntologyAction: true }),
    }),
  enqueueJob: (body) =>
    req(`/jobs`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cancelJob: (jobId) => req(`/jobs/${jobId}/cancel`, { method: "POST" }),
  memoryTree: (opts = {}) => {
    const qs = new URLSearchParams();
    if (opts.storeId) qs.set("store_id", opts.storeId);
    if (opts.projectId) qs.set("project_id", opts.projectId);
    const q = qs.toString();
    return req(`/memory/tree${q ? `?${q}` : ""}`);
  },
  getMemoryFile: (path) => req(`/memory/file?path=${encodeURIComponent(path)}`),
  putMemoryFile: (body) =>
    req(`/memory/file`, { method: "PUT", body: JSON.stringify(body) }),
  /**
   * CAS 写入：带 expected_hash；409 时抛出含 current 的错误对象。
   */
  putMemoryFileCas: async (body) => {
    let res, text;
    try {
      res = await fetch(`${config.apiBase}/api/v1/memory/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(process.env.LOCAL_API_TOKEN ? {"X-XZM-Local-Token": process.env.LOCAL_API_TOKEN} : {}) },
        body: JSON.stringify(body),
      });
      text = await res.text();
    } catch (error) {
      // A lost response does not prove the mutation failed. Inspect before retrying.
      throw uncertainMutation("/memory/file", error);
    }
    if ([502, 503, 504].includes(res.status)) {
      throw uncertainMutation("/memory/file", new Error(`HTTP ${res.status}`));
    }
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (res.status === 409) {
      const err = new Error(`memory_conflict ${body.path}`);
      err.code = "memory_conflict";
      err.status = 409;
      err.detail = data?.detail || data;
      throw err;
    }
    if (!res.ok) {
      throw new Error(`${res.status} /memory/file: ${text}`);
    }
    return data;
  },
  freezeMemoryFile: (path) =>
    req(`/memory/freeze?path=${encodeURIComponent(path)}`, { method: "POST" }),
  touchMemory: (path) =>
    req(`/memory/touch?path=${encodeURIComponent(path)}`, { method: "POST" }).catch(() => null),
  searchMemory: (q, opts = {}) => {
    const qs = new URLSearchParams({ q: q || "" });
    if (opts.storeId) qs.set("store_id", opts.storeId);
    if (opts.projectId) qs.set("project_id", opts.projectId);
    if (opts.limit) qs.set("limit", String(opts.limit));
    return req(`/memory/search?${qs}`, { method: "POST" });
  },
  listMemoryStores: (projectId) =>
    req(`/memory/stores${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`),
  bootstrapMemoryMounts: (projectId, opts = {}) => {
    const qs = new URLSearchParams({ project_id: projectId });
    if (opts.conversationId) qs.set("conversation_id", opts.conversationId);
    if (opts.runId) qs.set("run_id", opts.runId);
    if (opts.agentId) qs.set("agent_id", opts.agentId);
    return req(`/memory/mounts/bootstrap?${qs}`, { method: "POST" });
  },
  createDream: (body) =>
    req(`/memory/dreams`, { method: "POST", body: JSON.stringify(body) }),
  listDreams: (opts = {}) => {
    const qs = new URLSearchParams();
    if (opts.projectId) qs.set("project_id", opts.projectId);
    if (opts.storeId) qs.set("store_id", opts.storeId);
    const q = qs.toString();
    return req(`/memory/dreams${q ? `?${q}` : ""}`);
  },
  listKbDocs: () => req(`/kb/docs`),
  getKbDoc: (id) => req(`/kb/docs/${encodeURIComponent(id)}`),
  /** 蒸馏 knowledge/ 语料（kb_search 命中的 id/path） */
  getKnowledgeDoc: (id, opts = {}) => req(`/kb/knowledge/docs/${encodeURIComponent(String(id || "").replace(/^\/+/, ""))}?${new URLSearchParams({ offset: String(opts.offset ?? 0), limit: String(opts.limit ?? 6000) })}`),
  getKbDocText: (id, opts = {}) => req(`/kb/docs/${encodeURIComponent(id)}/text?${new URLSearchParams({ offset: String(opts.offset ?? 0), limit: String(opts.limit ?? 6000) })}`),
  searchUploadedKb: (q) => req(`/kb/search?${new URLSearchParams({ q, includeWeb: "false" })}`),
  dispatchBatch: (projectId, runId) => req(`/autopilot/start?project_id=${encodeURIComponent(projectId)}`, {
    method:"POST",body:JSON.stringify({dispatcherRunId:runId})
  }),
  listKbReports: docId => req(`/kb/docs/${encodeURIComponent(docId)}/reports`),
  writeKbReport: (docId, reportType, body) =>
    req(`/kb/docs/${docId}/reports/${encodeURIComponent(reportType)}`, {
      method: "POST",
      body: body == null ? undefined : JSON.stringify(body),
    }),
  searchKnowledge: (q, opts = {}) => {
    const qs = new URLSearchParams({
      q,
      limit: String(opts.limit ?? 8),
      mode: opts.mode || "hybrid",
    });
    if (opts.category) qs.set("category", opts.category);
    return req(`/kb/knowledge/search?${qs}`);
  },
  detectDeai: (text) => req("/quality/deai-detect", { method: "POST", body: JSON.stringify({ text }) }),
  listPrompts: () => req(`/prompts`),
  chat: (messages, opts = {}) =>
    req("/llm/chat", {
      signal: opts.signal,
      method: "POST",
      body: JSON.stringify({
        messages,
        model: opts.model,
        provider: opts.provider,
        purpose: opts.purpose,
        temperature: opts.temperature ?? 0.7,
        maxTokens: opts.maxTokens,
        projectId: opts.projectId,
        agentId: opts.agentId,
        runId: opts.runId,
      }),
    }),
  agentChat: (body, init = {}) => {
    const {maxWaitMs, maxAttempts, onRetry, checkAdmission, ...requestInit} = init;
    return retryRejectedModelRequest(async () => {
      await checkAdmission?.();
      return req("/llm/agent-chat", { ...requestInit, method: "POST", body: JSON.stringify(body) });
    }, {signal:init.signal, maxWaitMs:maxWaitMs ?? Number(process.env.AGENT_MODEL_RETRY_MAX_WAIT_MS || 120000),
      maxAttempts:maxAttempts ?? Number(process.env.AGENT_MODEL_RETRY_MAX_ATTEMPTS || 12), onRetry});
  },
  getLlmGovernor: () => req("/internal/llm-governor").catch(() => null),
  reportLlmGovernor: (body) =>
    req("/internal/llm-governor/report", {
      method: "POST",
      body: JSON.stringify(body || {}),
      retryAttempts: 1,
    }).catch(() => null),
  webSearch: (q) => req(`/kb/search?q=${encodeURIComponent(q)}&includeWeb=true`),
  stageLock: (body) =>
    req("/agents/stage-lock", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchJobStatus: (jobId, body) =>
    req(`/jobs/${jobId}/status`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  // —— Agent Instance 租约（控制平面）——
  acquireLease: (runId, body) =>
    req(`/tasks/runs/${runId}/lease`, { method: "POST", body: JSON.stringify(body) }),
  heartbeatRun: (runId, body) =>
    req(`/tasks/runs/${runId}/heartbeat`, { method: "PATCH", body: JSON.stringify(body) }),
  releaseLease: (runId, body) =>
    req(`/tasks/runs/${runId}/release`, { method: "POST", body: JSON.stringify(body) }),
  patchRunStatus: (runId, body) =>
    req(`/runs/${runId}/status`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  getFleet: (fleetId) => req(`/agents/fleet/${encodeURIComponent(fleetId)}`),
  patchFleetMember: (fleetId, body) =>
    req(`/agents/fleet/${encodeURIComponent(fleetId)}/member`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  createRun: (body) =>
    req(`/runs`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  appendRunStep: (runId, body) =>
    req(`/runs/${runId}/steps`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** 控制面步骤账本（可跨 worker 迁移；续跑优先于此而非本地 JSONL） */
  getRunReplay: (runId) =>
    req(`/runs/${encodeURIComponent(runId)}/replay?cursor_rows=true`).catch(() => null),
  getSteer: (runId) =>
    req(`/runs/${encodeURIComponent(runId)}/steer`).catch(() => ({ messages: [], count: 0 })),
  patchRunProgress: (runId, body) =>
    req(`/tasks/runs/${encodeURIComponent(runId)}/progress`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }).catch(() => null),
  fsLs: (path = "/", opts = {}) => {
    const qs = new URLSearchParams({ path });
    if (opts.project_id) qs.set("project_id", opts.project_id);
    if (opts.agent_id) qs.set("agent_id", opts.agent_id);
    return req(`/fs/ls?${qs}`);
  },
  fsRead: (path, opts = {}) => {
    const qs = new URLSearchParams({ path });
    if (opts.project_id) qs.set("project_id", opts.project_id);
    if (opts.agent_id) qs.set("agent_id", opts.agent_id);
    if (opts.offset != null) qs.set("offset", String(opts.offset));
    if (opts.limit != null) qs.set("limit", String(opts.limit));
    return req(`/fs/read?${qs}`);
  },
  fsWrite: (body) => req(`/fs/write`, { method: "PUT", body: JSON.stringify(body) }),
  fsEdit: (body) => req(`/fs/edit`, { method: "POST", body: JSON.stringify(body) }),
  fsGrep: (body) => req(`/fs/grep`, { method: "POST", body: JSON.stringify(body) }),
  fsFind: (body) => req(`/fs/find`, { method: "POST", body: JSON.stringify(body) }),
};
