import { createHash } from "node:crypto";

const causalKinds = new Set(["model_response", "reply", "tool_call", "bash", "tool_result", "steer"]);
export function hasExecutionHistory(steps) {
  return steps.some(s => !s.payload?.child_run_id && (!s.payload?.event || s.payload?.event_id) &&
    (causalKinds.has(s.kind) || ["run_start","model_call","usage","ledger"].includes(s.kind)));
}

export function causalBoundary(steps) {
  const last = steps.findLast(s => !s.payload?.child_run_id && causalKinds.has(s.kind));
  return last?.payload?.event_id || last?.id || null;
}

export function workingHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function recoveryMarker(steps, scope) {
  const marker = steps.findLast(s => !s.payload?.child_run_id && s.payload?.workingContextRef &&
    ["compaction","handoff"].includes(s.kind));
  if (marker && marker.payload.workingContextScope !== scope)
    throw new Error("执行上下文权限或角色定义已变化，请重新核对任务");
  return marker;
}

const steerPrefix = "【追加指令】";
const steerSeparator = "\n\n" + steerPrefix;
const recordedRevisions = new WeakMap();

// Match an entire submitted event (which may itself contain quoted markers).
// The inbox appends a separator before each event; the payload must end at
// the next separator or the end of the accepted input.
function framePositions(prompt, message, start, currentRevision) {
  const text = message.content;
  const revision = recordedRevisions.get(message);
  let relation = "unknown";
  if (revision && currentRevision) relation = revision === currentRevision ? "current" : "earlier";
  const positions = [];
  for (let pos = prompt.indexOf(text, start); pos >= 0; pos = prompt.indexOf(text, pos + 1)) {
    const end = pos + text.length;
    if (pos !== 0 && prompt.slice(pos - 2, pos) !== "\n\n") continue;
    if (end === prompt.length) {
      if (relation !== "earlier") positions.push(pos);
    } else if (relation !== "current" && prompt.startsWith(steerSeparator, end)) {
      positions.push(pos);
    }
  }
  return positions;
}

export function admittedTask(input, dispatched, history = []) {
  const prompt = input.assistantPrompt;
  if (!input.steerRevision || typeof prompt !== "string") return {base:prompt, history};
  let base = typeof dispatched === "string" &&
    (prompt === dispatched || prompt.startsWith(dispatched + steerSeparator)) ? dispatched : undefined;
  const recorded = history.filter(m => m.role === "user" && m.content?.startsWith(steerPrefix));
  const matches = recorded.map(message => ({
    message, positions:framePositions(prompt,message,base?.length || 0,input.steerRevision),
  })).filter(row => row.positions.length);
  // Forward/backward alignment distinguishes repeated but uniquely ordered
  // events from indistinguishable same-text revisions with a missing receipt.
  let after = base?.length || 0;
  for (const row of matches) {
    row.first = row.positions.find(pos => pos >= after);
    after = (row.first ?? Infinity) + row.message.content.length;
  }
  let before = prompt.length;
  for (const row of [...matches].reverse()) {
    row.last = row.positions.findLast(pos => pos + row.message.content.length <= before);
    before = row.last ?? -1;
  }
  const orderConflict = matches.some(row => row.first === undefined || row.last === undefined);
  if (base === undefined && !prompt.startsWith(steerPrefix)) {
    if (!matches.length) return {base, history, currentDirective:prompt, goalDirective:prompt};
    const first = matches[0];
    // Without a dispatch snapshot, only a unique, confirmed frame can mark
    // where the original task ends. Otherwise keep the entire source together.
    if (!orderConflict && first.first === first.last) base = prompt.slice(0,first.first - 2);
  }
  let offset = base?.length || 0;
  const goalDirective = prompt.slice(offset).trimStart();
  const replacement = new Map();
  for (let i = 0; i < matches.length; i++) {
    const row = matches[i];
    if (!orderConflict && row.first === row.last) {
      const missed = prompt.slice(offset,Math.max(offset,row.first - 2)).trimStart();
      const earlier = missed ? [{role:"user",content:"【恢复记录】下列原文在下一条指令前已接纳，首次送达的工具轮次缺少独立记录。\n" + missed}] : [];
      replacement.set(row.message, [...earlier,row.message]);
      offset = row.first + row.message.content.length;
      continue;
    }
    // Preserve the admitted source exactly once. In an ambiguous block the
    // ledger proves delivery at each recorded position, not which duplicate it was.
    let j = i;
    let end = row.positions.at(-1) + row.message.content.length;
    if (!orderConflict) end = row.last + row.message.content.length;
    while (j + 1 < matches.length && (orderConflict || matches[j+1].first < end)) {
      const next = matches[++j];
      end = Math.max(end, (orderConflict ? next.positions.at(-1) : next.last) + next.message.content.length);
    }
    const source = prompt.slice(offset,end).trimStart();
    for (let n = i; n <= j; n++) {
      const content = n === i
        ? "【恢复记录】下列接纳原文按输入顺序保留。记录不足以逐条定位到工具轮次，已执行动作以工具回执为准。\n" + source
        : "【恢复记录】此轮前已收到上列原文中的追加指令，修订位置无法唯一核对。";
      replacement.set(matches[n].message,[{role:"user",content}]);
    }
    offset = end;
    i = j;
  }
  return {base,history:history.flatMap(m => replacement.get(m) || [m]),
    currentDirective:prompt.slice(offset).trimStart(),goalDirective};
}

export function taskInputLine(input, base, knowledge) {
  const contextInput = {...input, assistantPrompt:base};
  if (knowledge) delete contextInput.__evalOverrides;
  return "任务输入 JSON: " + JSON.stringify(contextInput, null, 2);
}

export function workingHistorySlots(messages, taskMessage) {
  return messages.filter(m => m.role !== "system").map(m => m === taskMessage ? {taskSlot:true} : m);
}

export function assembleWorkingHistory(taskMessage, history, restored, resumeNote, currentDirective) {
  if (restored) {
    const prior = restored.state.messages.map(m => m.taskSlot ? taskMessage : m);
    return [...prior, ...restored.suffix.messages,
      ...(restored.newDirective ? [{role:"user",content:restored.newDirective}] : [])];
  }
  return [taskMessage, ...(history || []),
    ...(resumeNote ? [{role:"user",content:resumeNote}] : []),
    ...(currentDirective ? [{role:"user",content:currentDirective}] : [])];
}

// The marker's actual server sequence bounds the suffix; seq numbers may have
// gaps because other roles share the conversation. Unconfirmed local entries
// cannot initiate restoration.
export function restoreWorkingContext(steps, local, scope, admittedPrompt, currentRevision) {
  const marker = recoveryMarker(steps, scope);
  if (!marker) return;
  if (!Number.isSafeInteger(marker.seq) ||
      marker.payload.workingContextBoundary !== causalBoundary(steps.filter(s => s.seq < marker.seq))) return;
  const entry = local.findLast(e => e.type === "private_working_context" &&
    e.payload?.ref === marker.payload.workingContextRef)?.payload;
  const state = entry?.state;
  if (state?.schema !== 1 || state.scope !== scope || workingHash(state) !== entry.ref ||
      !Number.isInteger(state.leaseVersion) || state.leaseVersion !== marker.payload.leaseVersion ||
      state.boundary !== marker.payload.workingContextBoundary || !Array.isArray(state.messages)) return;
  const accepted = admittedPrompt.slice(0,state.promptLength);
  if (!Number.isSafeInteger(state.promptLength) || state.promptLength < 0 || workingHash(accepted) !== state.promptHash ||
      (accepted !== admittedPrompt && accepted && !admittedPrompt.startsWith(accepted + "\n\n【追加指令】"))) return;
  const suffix = messagesFromSteps(steps.filter(s => s.seq > marker.seq), {steers:true});
  if (suffix.incompleteRound || suffix.requiresVerification) return;
  let consumed = accepted;
  for (const m of suffix.messages) {
    if (m.role !== "user" || !m.content.startsWith(steerPrefix)) continue;
    const positions = framePositions(admittedPrompt,m,consumed.length,currentRevision);
    // Missing or ambiguous frames need the receipt reconstruction path.
    if (positions.length !== 1 || positions[0] !== (consumed ? consumed.length + 2 : 0)) return;
    consumed = consumed ? consumed + "\n\n" + m.content : m.content;
  }
  if (consumed !== admittedPrompt && !admittedPrompt.startsWith(consumed ? consumed + "\n\n【追加指令】" : "【追加指令】")) return;
  return {state, suffix, newDirective:admittedPrompt.slice(consumed.length).trimStart()};
}

export const RECOVERY_INSPECTION_INSTRUCTION = "【中断恢复核查】存在执行结果未知的写操作，系统没有重放该操作。必须先调用 artifact_list 核对现有产物及来源，必要时读取原文或产物确认影响，只补齐核实后的缺口；核查完成前禁止任何写操作，不能把 unknown_after_interrupt 当作成功。";

function unknownAfterInterrupt(result) {
  try {
    const value = typeof result === "string" ? JSON.parse(result) : result;
    return ["unknown_after_interrupt", "mutation_result_unknown"].includes(value?.status) && value.notReplayed === true && value.requiresVerification === true;
  } catch { return false; }
}

export function recoveryToolAllowed(inspectionRequired, name, isReadonly) {
  return !inspectionRequired || isReadonly(name);
}

/** Rebuild only complete model rounds. Cursor indexes the original, seq-sorted
 * ledger (including duplicate deliveries), never a partial tool round.
 * Incomplete evidence stays separate from provider messages for crash policy;
 * dropping messages must never imply permission to replay a completed write.
 */
export function messagesFromSteps(steps, {steers = false} = {}) {
  const sorted = (Array.isArray(steps) ? steps : [])
    .map((step, idx) => ({ step, idx }))
    .sort((a, b) => (a.step?.seq ?? 0) - (b.step?.seq ?? 0) || a.idx - b.idx);
  const rounds = [];
  const byTurn = new Map();
  const turnBounds = new Map();
  const owners = new Map();
  const results = [];
  const seen = new Set();
  let current = null;
  let latestUnknown = -1;
  let latestVerification = -1;
  const complete = r => [...r.calls.keys()].every(id => id && r.results.has(id));
  const create = (start, turnId) => {
    const r = { start, end: start, responseStart:start, turnId, content: null, calls: new Map(), results: new Map() };
    rounds.push(r);
    if (turnId != null) byTurn.set(turnId, r);
    return r;
  };
  for (let i = 0; i < sorted.length; i += 1) {
    const s = sorted[i].step;
    if (!s || typeof s !== "object") continue;
    const kind = s.kind || s.type;
    const p = s.payload && typeof s.payload === "object" ? s.payload : {};
    if (p.child_run_id) continue;
    const identity = s.event_id ?? p.event_id;
    const key = identity != null ? `event:${identity}` : JSON.stringify([s.seq, kind, p]);
    if (seen.has(key)) continue;
    seen.add(key);
    const turnId = p.turn_id ?? s.turn_id;
    if (turnId != null) {
      const bounds = turnBounds.get(turnId) || { start: i, end: i };
      bounds.end = i;
      turnBounds.set(turnId, bounds);
    }
    if (kind === "recovery" && p.action === "inspection_verified") latestVerification = i;
    if (kind === "tool_result") {
      // Used only to infer boundaries of legacy logs without turn IDs.
      const owner = owners.get(String(p.id ?? ""));
      results.push({ p, i, turnId, owner });
      if (owner) owner.results.set(String(p.id), p);
      continue;
    }
    if (!["reply", "tool_call", "bash", "model_response"].includes(kind)) continue;
    let r;
    if (turnId != null) {
      r = byTurn.get(turnId) || create(i, turnId);
    } else {
      if (!current || (current.calls.size && complete(current)) ||
          (kind === "reply" && current.content != null)) current = create(i, null);
      r = current;
    }
    r.end = i;
    if (kind === "model_response") {
      r.content = p.content == null ? null : String(p.content);
      for (const call of p.tool_calls || []) {
        const id = String(call.id ?? "");
        r.calls.set(id, { id, type: "function", function: {
          name: String(call.function?.name ?? ""),
          arguments: call.function?.arguments ?? "{}",
        } });
        owners.set(id, r);
      }
    } else if (kind === "reply") {
      r.content = p.text == null || p.text === "" ? null : String(p.text);
    } else {
      const id = String(p.id ?? "");
      if (!r.calls.has(id)) r.calls.set(id, {
        id, type: "function", function: {
          name: String(p.name ?? ""),
          arguments: typeof p.args === "string" ? p.args : JSON.stringify(p.args ?? {}),
        },
      });
      owners.set(id, r);
    }
  }
  // Pair by both turn and call identity, including out-of-order persisted results.
  for (const r of rounds) r.results.clear();
  for (const { p, i, turnId, owner } of results) {
    const id = String(p.id ?? "");
    const r = turnId != null ? byTurn.get(turnId) : owner || owners.get(id);
    if (!r?.calls.has(id) || r.results.has(id)) continue;
    r.results.set(id, p);
    if (unknownAfterInterrupt(p.result)) latestUnknown = Math.max(latestUnknown, i);
    r.start = Math.min(r.start, i);
    r.end = Math.max(r.end, i);
  }
  for (const r of rounds) {
    const bounds = turnBounds.get(r.turnId);
    if (bounds) { r.start = Math.min(r.start, bounds.start); r.end = Math.max(r.end, bounds.end); }
  }
  rounds.sort((a, b) => a.start - b.start);
  const incomplete = rounds.find(r => !complete(r));
  // A round crossing the cutoff is also withheld: no partial causal history.
  let cutoff = incomplete?.start ?? sorted.length;
  for (const r of [...rounds].reverse()) {
    if (r.start < cutoff && r.end >= cutoff) cutoff = r.start;
  }
  const messages = [];
  const directions = [];
  const seenSteers = new Set();
  if (steers) {
    const limit = incomplete?.start === cutoff ? incomplete.responseStart : cutoff;
    for (let i = 0; i < limit; i++) {
      const {step} = sorted[i];
      if (step?.kind !== "steer" || step.payload?.child_run_id || typeof step.payload?.message !== "string") continue;
      const key = step.payload.revision || step.payload.event_id || step.id || step.seq;
      if (seenSteers.has(key)) continue;
      seenSteers.add(key);
      directions.push({i, message:step.payload.message, revision:step.payload.revision});
    }
  }
  function appendDirections(before) {
    while (directions.length && directions[0].i < before) {
      const {message,revision} = directions.shift();
      const m = {role:"user", content:message.startsWith(steerPrefix) ? message : steerPrefix + message};
      if (revision) recordedRevisions.set(m,revision);
      messages.push(m);
    }
  }
  for (const r of rounds) {
    if (r.start >= cutoff || !complete(r)) continue;
    if (!r.calls.size && r.content == null) continue;
    appendDirections(r.responseStart);
    const m = { role: "assistant", content: r.content };
    if (r.calls.size) m.tool_calls = [...r.calls.values()];
    messages.push(m);
    for (const id of r.calls.keys()) {
      const receipt = r.results.get(id);
      const result = receipt?.result;
      messages.push({ role: "tool", tool_call_id: id, content: result == null ? "" : String(result),
        ...(receipt?.status && receipt.status !== "done" ? {failedRead:true} : {}) });
    }
    if ([...r.results.values()].some(p => unknownAfterInterrupt(p.result))) {
      messages.push({ role: "user", content: RECOVERY_INSPECTION_INSTRUCTION });
    }
  }
  appendDirections(Infinity);
  const replay = { messages, resumeCursor: cutoff };
  if (latestUnknown > latestVerification) replay.requiresVerification = true;
  if (incomplete) replay.incompleteRound = {
    turn_id: incomplete.turnId,
    content: incomplete.content,
    hasFollowingRounds: rounds.some(r => r !== incomplete && r.start >= cutoff),
    toolCalls: [...incomplete.calls.values()],
    completedResults: [...incomplete.results.values()],
    pendingToolCallIds: [...incomplete.calls.keys()].filter(id => !id || !incomplete.results.has(id)),
  };
  return replay;
}

/** A completed write cannot be forgotten just because another call is missing.
 * Only unresolved side effects need review; completed results are reused by
 * recoverReadonlyRound and are never executed again.
 */
function recoveryCallName(call) {
  const fn = call.function;
  if (String(fn?.name).trim().replace(/\./g, "_").toLowerCase() !== "tool_invoke") return fn?.name;
  try {
    const args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments;
    return args?.name;
  } catch { return undefined; }
}

export function incompleteRoundNeedsReview(replay, sideEffectOfTool) {
  if (replay?.incompleteRound?.hasFollowingRounds) return true;
  return Boolean(replay?.incompleteRound?.toolCalls.some(call => {
    if (!replay.incompleteRound.pendingToolCallIds.includes(call.id)) return false;
    const name = recoveryCallName(call);
    return !name || sideEffectOfTool(name) !== "none";
  }));
}

/** Execute only missing, proven read calls; reuse every acknowledged result.
 * executeRead must persist its result before resolving. All safety checks run
 * before the first call, so an unsafe mixed round never partly executes here.
 */
export async function recoverReadonlyRound(replay, isReadonly, executeRead, options = {}) {
  const round = replay?.incompleteRound;
  if (!round) return replay?.messages || [];
  const needsReview = incompleteRoundNeedsReview(replay, name => isReadonly(name) ? "none" : "artifact_write");
  if (round.toolCalls.some(call => !call.id) || round.hasFollowingRounds || ["refuse", "mark_done"].includes(options.operatorDecision) ||
      (needsReview && options.operatorDecision !== "resume")) {
    throw new Error("未完成工具轮包含未确认写操作，请核对执行账本后处理；mark_done 不能替代独立 Done Contract 验收");
  }
  if (needsReview) {
    if (!options.persistUnknown || !options.recordPolicy) throw new Error("未完成工具轮缺少恢复事实持久化通道");
    await options.recordPolicy({ action: "resume", operatorDecision: "resume", notReplayed: true, requiresVerification: true,
      pendingToolCallIds: round.pendingToolCallIds });
  }
  const results = new Map(round.completedResults.map(p => [String(p.id), p.result]));
  for (const call of round.toolCalls) {
    if (results.has(call.id)) continue;
    if (isReadonly(recoveryCallName(call))) {
      results.set(call.id, await executeRead(call, round.turn_id));
    } else {
      const result = JSON.stringify({ status: "unknown_after_interrupt", notReplayed: true, requiresVerification: true });
      await options.persistUnknown(call, round.turn_id, result);
      results.set(call.id, result);
      replay.requiresVerification = true;
    }
  }
  const messages = [...replay.messages,
    { role: "assistant", content: round.content ?? null, tool_calls: round.toolCalls },
    ...round.toolCalls.map(call => ({ role: "tool", tool_call_id: call.id, content: String(results.get(call.id) ?? "") })),
  ];
  if (replay.requiresVerification) messages.push({ role: "user", content: RECOVERY_INSPECTION_INSTRUCTION });
  return messages;
}

export function resolveFleetMemoryPath(path, fleetWorkdir, projectId) {
  const base = String(fleetWorkdir).replace(/\/$/, "");
  const raw = String(path || "").trim();
  if (!raw) return `${base}/note.md`;
  if (!fleetWorkdir) {
    if (raw.startsWith("/memories/") || raw.startsWith("memories/")) {
      return raw.startsWith("/") ? raw : `/${raw}`;
    }
    // 短路径（如 bible/premise.md）落到当前项目命名空间，避免 API 400
    const ns = projectId ? `/memories/projects/${projectId}` : "/memories/user";
    return `${ns}/${raw.replace(/^\/+/, "")}`;
  }
  if (raw.startsWith(base)) return raw;
  // 已是绝对 memories 路径时，仍挂到 fleet 命名空间下，避免串写
  const leaf = raw.replace(/^\/+/, "").split("/").filter(Boolean).pop() || "note.md";
  if (raw.startsWith("/memories/") || raw.startsWith("memories/")) {
    return `${base}/${leaf}`;
  }
  return `${base}/${raw.replace(/^\/+/, "")}`;
}

// Only the control plane can endorse a native write on the current input and pack.
export function recoveredBibleWrite(replay, {runId, jobId, projectId, input, scope, leaseVersion, fleetWorkdir}) {
  const run = replay?.run;
  const stepId = run?.currentBibleWriteStepId;
  if (run?.id !== runId || run.projectId !== projectId || run.agentId !== "qc.bible_guard" ||
      run.status !== "running" || typeof stepId !== "string" || !stepId.startsWith("bible-write:") || !scope ||
      !run.inputJson || !input || !Array.isArray(replay.steps) ||
      !Number.isSafeInteger(leaseVersion) || workingHash(run.inputJson) !== workingHash(input)) return;
  const steps = replay.steps.filter(s => s.runId === runId && !s.payload?.child_run_id && !s.payload?.parent_run_id);
  const hit = steps.find(s => s.id === stepId);
  const p = hit?.payload;
  const proof = p?.bibleWriteProof;
  if (!proof || proof.v !== 1 || proof.jobId !== jobId || proof.workingScope !== scope ||
      !Number.isSafeInteger(proof.leaseVersion) || proof.leaseVersion < 1 || proof.leaseVersion >= leaseVersion ||
      proof.steerRevision !== (input.steerRevision ?? null) || !/^[a-f0-9]{64}$/.test(proof.admittedInputHash) ||
      !p.event_id || p.event || p.requiresVerification || !p.id || hit.actor !== "agent:qc.bible_guard" || hit.kind !== "tool_result" ||
      !hit.turnId || p.turn_id !== hit.turnId || p.status !== "done" || p.name !== "memory_write") return;
  const pair = steps.filter(s => ["tool_call","bash","tool_result"].includes(s.kind) && s.payload?.id === p.id);
  const [call, result] = pair;
  if (pair.length !== 2 || result !== hit || call.kind !== "tool_call" || call.actor !== hit.actor ||
      !call.payload.event_id || call.payload.event || call.turnId !== hit.turnId || call.payload.turn_id !== hit.turnId || call.payload.name !== p.name ||
      !(call.seq < hit.seq)) return;
  try {
    const out = JSON.parse(p.result);
    const args = call.payload.args;
    const path = `/memories/projects/${projectId}/bible_pack.md`;
    if (out.ok === true && out.path === path && out.row?.path === path && out.row.projectId === projectId &&
        out.row.isHypothesis === false && out.row.updatedAt && typeof args.path === "string" &&
        resolveFleetMemoryPath(args.path, fleetWorkdir, projectId) === path && !args.isHypothesis &&
        args.expectedHash !== out.hash && out.row.hash === out.hash &&
        createHash("sha256").update(args.content).digest("hex") === out.hash) return stepId;
  } catch { /* malformed native evidence cannot grant credit */ }
}

// Invalidating credit leaves its terminal dependency attached until an acknowledged
// substantive replacement. A failed or unchanged write cannot turn it into fresh credit.
export function restoreBibleWriteCredit(context, tools, stepId) {
  context.bibleTerminalDependency = {bibleWriteStepId:stepId};
  context.usedCarry = true;
  tools._successfulTools.add("memory_write");
  context.invalidateCarriedWrite = () => {
    if (context.bibleTerminalDependency) tools._invalidateBibleWrite();
  };
  context.acceptBibleReplacement = substantive => {
    if (substantive === true) delete context.bibleTerminalDependency;
  };
}
