import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bootstrapRunMemory,
  lessonsPath,
  loadAgentLessons,
  mergeLesson,
} from "../src/contextMemory.js";
import { maybeCompact, resolveCompactionConfig } from "../src/contextCompaction.js";

test("mergeLesson 去重、带日期、超限丢最旧", () => {
  const now = new Date("2026-11-16T00:00:00Z");
  const a = mergeLesson("", "开篇先抛悬念", { now, agentId: "x" });
  assert.equal(a.changed, true);
  assert.match(a.content, /\[2026-11-16\] 开篇先抛悬念/);
  const dup = mergeLesson(a.content, "开篇先抛悬念", { now, agentId: "x" });
  assert.equal(dup.changed, false);
  assert.equal(dup.reason, "duplicate");
  let c = a.content;
  for (let i = 0; i < 40; i += 1) c = mergeLesson(c, `经验 ${i} ${"y".repeat(40)}`, { now, maxChars: 500, agentId: "x" }).content;
  assert.ok(c.length <= 500);
  assert.match(c, /经验 39/);
  assert.doesNotMatch(c, /开篇先抛悬念/);
  assert.equal(mergeLesson("", "  ", {}).changed, false);
});

test("loadAgentLessons 只读取本项目私有经验并按预算截断", async () => {
  const own = lessonsPath("p1", "a.b");
  const api = {
    getMemoryFile: async path => {
      assert.equal(path, own);
      return { content: "OWN" };
    },
    memoryTree: async () => { throw new Error("不得枚举其他项目"); },
  };
  const text = await loadAgentLessons(api, { projectId: "p1", agentId: "a.b", budget: 1000 });
  assert.equal(text, "OWN");
  const none = await loadAgentLessons({ getMemoryFile: async () => { throw new Error("x"); } }, { projectId: "p1", agentId: "a" });
  assert.equal(none, "");
});

test("bootstrap preserves mandatory decision tails and keeps optional mounts failure degradable", async () => {
  const decisions = "决策".repeat(1000) + "TAIL_LOCKED";
  const api = { bootstrapMemoryMounts: async () => { throw new Error("down"); }, getMemoryFile: async () => ({ content: decisions }), memoryTree: async () => [] };
  const m = await bootstrapRunMemory(api, { projectId: "p", agentId: "a", runId: "r" });
  assert.equal(m.coreFacts, decisions);
  assert.match(m.errors[0], /mounts/);
});
test("oversized mandatory decisions fail explicitly instead of losing the tail", async () => {
  const api = { bootstrapMemoryMounts: async () => [], getMemoryFile: async () => ({ content: "中".repeat(20000) }), memoryTree: async () => [] };
  await assert.rejects(bootstrapRunMemory(api, { projectId: "p", agentId: "a", runId: "r" }), error => error.name === "ContextBudgetError" && /拆分/.test(error.message));
});

function history(n = 40) {
  return [
    { role: "system", content: "SYS" },
    { role: "user", content: "写第 5 集" },
    ...Array.from({ length: n }, (_, i) => ({ role: "assistant", content: `step ${i} ${"z".repeat(800)}` })),
    { role: "user", content: "continue" },
  ];
}

test("maybeCompact：LLM 失败降级；达到阈值后 handoff 保留 system 与原始用户指令", async () => {
  const api = { chat: async () => { throw new Error("429"); } };
  const cfg = resolveCompactionConfig({ triggerTokens: 1000, keepTailTokens: 500, handoffAfterCompactions: 2 });
  const state = { compactions: 0, handoffs: 0 };
  const common = {
    api, cfg, state, projectId: "p", agentId: "a", runId: "r", goal: "写第 5 集",
    getDoneGap: async () => "缺 episode",
    getArtifactIds: async () => ["art1"],
  };
  const r1 = await maybeCompact({ ...common, messages: history() });
  assert.equal(r1.event.kind, "compaction");
  assert.equal(r1.event.method, "deterministic");
  assert.equal(r1.event.fallbackReason, "429");

  const r2 = await maybeCompact({ ...common, messages: history() });
  assert.equal(r2.event.kind, "handoff");
  assert.ok(r2.messages.some(m => m.role === "user" && m.content === "continue"));
  assert.equal(r2.messages[0].role, "system");
  assert.match(r2.messages[1].content, /Handoff/);
  assert.match(r2.messages[1].content, /art1/);
  assert.equal(state.compactions, 0);
  assert.equal(state.handoffs, 1);
});

test("maybeCompact：未达阈值不动", async () => {
  const r = await maybeCompact({
    api: {}, cfg: resolveCompactionConfig({}), state: { compactions: 0, handoffs: 0 },
    messages: [{ role: "user", content: "hi" }], projectId: "p", agentId: "a", runId: "r", goal: "g",
  });
  assert.equal(r.event, null);
});

import { maybeProposeLessonsDream } from "../src/contextMemory.js";

test("maybeProposeLessonsDream：未达阈值不提；达阈值且无待审提案才提", async () => {
  const calls = [];
  const mk = (size, open = []) => ({
    getMemoryFile: async () => ({ content: "x".repeat(size) }),
    listDreams: async () => open,
    createDream: async (b) => { calls.push(b); return { id: "d1" }; },
  });
  assert.equal((await maybeProposeLessonsDream(mk(100), { projectId: "p", agentId: "a" })).proposed, false);
  assert.equal((await maybeProposeLessonsDream(mk(6000, [{ status: "ready" }]), { projectId: "p", agentId: "a" })).reason, "dream_pending");
  const r = await maybeProposeLessonsDream(mk(6000), { projectId: "p", agentId: "a" });
  assert.equal(r.proposed, true);
  assert.equal(calls[0].store_id, "agent.a.lessons");
});

test('personalization is bounded and separate from immutable project facts', async () => {
 const api={bootstrapMemoryMounts:async()=>[],getMemoryFile:async()=>({content:'canon'}),memoryTree:async()=>[],getPersonalizationContext:async()=>({context:'偏'.repeat(2000)})};
 const out=await bootstrapRunMemory(api,{projectId:'p',agentId:'a',runId:'r'});
 assert.equal(out.coreFacts,'canon');assert.equal(out.personalization.length,1000);
});

test('default nested planner shares facts but cannot load the writing orchestrator private lesson',async()=>{
  const {resolveSubagent}=await import('@xiezuomanju/agent-runtime');
  const {createWritingTools}=await import('../src/tools.js');
  const agentId=resolveSubagent('planner').agentId;
  assert.equal(agentId,'orch.writing');
  const privatePath=lessonsPath('p',agentId);
  const api={bootstrapMemoryMounts:async()=>[],getMemoryFile:async path=>({content:path===privatePath?'PRIVATE_SENTINEL':path.endsWith('decisions.md')?'SHARED_FACT':''})};
  const memory=await bootstrapRunMemory(api,{projectId:'p',agentId,runId:'nested_planner',nested:true});
  assert.equal(memory.coreFacts,'SHARED_FACT');
  assert.doesNotMatch(memory.lessons,/PRIVATE_SENTINEL/);
  const tools=createWritingTools({projectId:'p',runId:'nested_planner',depth:1,parentAgentId:agentId,allowlist:['memory_get']});
  const result=await tools.find(t=>t.name==='memory_get').execute('c',{path:privatePath});
  assert.match(result.content[0].text,/memory_scope_denied|私有/);
});
