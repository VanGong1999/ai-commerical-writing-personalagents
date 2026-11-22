import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compactMessages,
  estimateTokens,
  microCompactToolResults,
  type ChatMessage,
} from "./context.ts";

describe("context compaction", () => {
  it("micro-compacts long tool results", () => {
    const long = "x".repeat(5000);
    const out = microCompactToolResults([{ role: "tool", content: long, tool_call_id: "1" }], 1200);
    assert.ok((out[0].content as string).length < 1200);
    assert.match(out[0].content as string, /truncated/);
  });

  it("compacts when over trigger and keeps system", () => {
    const messages = [
      { role: "system" as const, content: "SYS_NEVER_COMPRESS" },
      { role: "user" as const, content: "goal A" },
      { role: "user" as const, content: "goal B" },
      ...Array.from({ length: 40 }, (_, i) => ({
        role: "assistant" as const,
        content: `step ${i} ` + "y".repeat(800),
      })),
      { role: "user" as const, content: "continue please" },
    ];
    const before = estimateTokens(messages);
    const result = compactMessages(messages, { triggerTokens: 1000, keepTailTokens: 500 });
    assert.equal(result.compacted, true);
    assert.ok(result.estimatedAfter < before);
    assert.ok(result.messages.some((m) => m.role === "system" && m.content === "SYS_NEVER_COMPRESS"));
    assert.match(result.summary || "", /Compacted Context/);
  });

  it("never leaves an orphan tool result at the kept tail boundary", () => {
    const history: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 40; i += 1) {
      history.push({
        role: "assistant",
        content: `step ${i} ` + "z".repeat(400),
        tool_calls: [{ id: `call_${i}`, function: { name: "gate_run", arguments: "{}" } }],
      });
      history.push({
        role: "tool",
        tool_call_id: `call_${i}`,
        content: "x".repeat(300),
      });
    }
    const messages = [
      { role: "system" as const, content: "SYS_NEVER_COMPRESS" },
      { role: "user" as const, content: "goal" },
      ...(history as ChatMessage[]),
      { role: "user" as const, content: "final user" },
    ];
    const result = compactMessages(messages, { triggerTokens: 1000, keepTailTokens: 500 });
    assert.equal(result.compacted, true);
    for (let i = 1; i < result.messages.length; i += 1) {
      const prev = result.messages[i - 1];
      const cur = result.messages[i];
      if (cur.role === "tool") {
        assert.ok(
          prev.role === "tool" ||
            (prev.role === "assistant" && Array.isArray(prev.tool_calls) && prev.tool_calls.length > 0),
          `orphan tool result at index ${i}`,
        );
      }
    }
  });
});

import {
  buildCompactionPrompt,
  buildHandoffPack,
  compactMessagesAsync,
  deterministicSummary,
  resolveTrigger,
  shouldHandoff,
} from "./context.ts";
import {
  assembleSystemPrompt,
  hashToolOrder,
  isAppendOnly,
  dateStamp,
} from "./contextSlots.ts";

function bigHistory(n = 40): ChatMessage[] {
  return [
    { role: "system", content: "SYS" },
    { role: "user", content: "goal A" },
    { role: "user", content: "goal B" },
    ...Array.from({ length: n }, (_, i) => ({
      role: "assistant" as const,
      content: `step ${i} ` + "y".repeat(800),
    })),
    { role: "user", content: "continue" },
  ];
}

describe("structured compaction", () => {
  it("uses LLM summary when available and valid", async () => {
    const r = await compactMessagesAsync(bigHistory(), { triggerTokens: 1000, keepTailTokens: 500 }, async () =>
      "## Compacted Context\n### 目标与用户意图\n- 写完 20 集\n### 下一步\n- 继续第 5 集，保持人设一致，调用 done_check",
    );
    assert.equal(r.compacted, true);
    assert.equal(r.method, "llm");
    assert.match(r.summary || "", /写完 20 集/);
  });

  it("falls back to deterministic summary on LLM failure", async () => {
    const r = await compactMessagesAsync(bigHistory(), { triggerTokens: 1000, keepTailTokens: 500 }, async () => {
      throw new Error("rate limited");
    });
    assert.equal(r.method, "deterministic");
    assert.equal(r.fallbackReason, "rate limited");
    assert.match(r.summary || "", /Compacted Context/);
  });

  it("falls back on empty / oversize LLM output", async () => {
    const r = await compactMessagesAsync(bigHistory(), { triggerTokens: 1000, keepTailTokens: 500 }, async () => "ok");
    assert.equal(r.method, "deterministic");
  });

  it("does nothing under the trigger", async () => {
    const r = await compactMessagesAsync([{ role: "user", content: "hi" }], {});
    assert.equal(r.compacted, false);
    assert.equal(r.method, "none");
  });

  it("window ratio triggers earlier than the absolute threshold", () => {
    assert.equal(resolveTrigger({ triggerTokens: 24_000 }), 24_000);
    assert.equal(
      resolveTrigger({ triggerTokens: 24_000, effectiveWindowTokens: 20_000, triggerRatio: 0.5 }),
      10_000,
    );
  });

  it("carries a prior summary forward when re-compacting (iterative)", () => {
    const first = compactMessages(bigHistory(), { triggerTokens: 1000, keepTailTokens: 500 });
    const more: ChatMessage[] = [
      ...first.messages,
      ...Array.from({ length: 40 }, (_, i) => ({ role: "assistant" as const, content: `more ${i} ` + "q".repeat(800) })),
      { role: "user", content: "again" },
    ];
    const second = compactMessages(more, { triggerTokens: 1000, keepTailTokens: 500 });
    assert.equal(second.compacted, true);
    assert.match(second.summary || "", /先前摘要/);
    // 只保留一份摘要消息，不累积
    const summaries = second.messages.filter(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.startsWith("## Compacted Context"),
    );
    assert.equal(summaries.length, 1);
  });

  it("deterministicSummary stays deterministic", () => {
    const m = bigHistory(5);
    assert.equal(deterministicSummary(m), deterministicSummary(m));
  });

  it("builds an 11-section compaction prompt", () => {
    const p = buildCompactionPrompt(bigHistory(2));
    assert.match(p.system, /11 段/);
    assert.match(p.system, /下一步/);
  });
});

describe("handoff", () => {
  it("builds a goal-only handoff pack without tool history", () => {
    const pack = buildHandoffPack({
      runId: "r1",
      agentId: "prose.episode_body",
      goal: "写第 5 集",
      doneGap: "缺 1 个 episode artifact",
      artifactIds: ["a1", "a2"],
      compactions: 3,
      recentConclusions: ["第 4 集已通过 gate"],
    });
    assert.match(pack, /写第 5 集/);
    assert.match(pack, /a2/);
    assert.doesNotMatch(pack, /tool_calls/);
  });

  it("decides handoff by compaction count or post-compaction ratio", () => {
    assert.equal(shouldHandoff({ compactionsSoFar: 3, estimatedAfter: 10, cfg: { handoffAfterCompactions: 3 } }).handoff, true);
    assert.equal(shouldHandoff({ compactionsSoFar: 1, estimatedAfter: 10, cfg: { handoffAfterCompactions: 3 } }).handoff, false);
    assert.equal(
      shouldHandoff({ compactionsSoFar: 1, estimatedAfter: 9_000, cfg: { effectiveWindowTokens: 10_000, resetRatio: 0.8 } }).handoff,
      true,
    );
  });
});

describe("context slots", () => {
  it("is deterministic and keeps fixed slot order regardless of input key order", () => {
    const a = assembleSystemPrompt({ lessons: "L", role: "R", contract: "C" });
    const b = assembleSystemPrompt({ role: "R", contract: "C", lessons: "L" });
    assert.equal(a.system, b.system);
    assert.equal(a.prefixHash, b.prefixHash);
    assert.deepEqual(a.slots.map((s) => s.id), ["role", "contract", "lessons"]);
  });

  it("changing one slot changes only that slot hash", () => {
    const a = assembleSystemPrompt({ role: "R", contract: "C" });
    const b = assembleSystemPrompt({ role: "R", contract: "C2" });
    assert.equal(a.slots[0].hash, b.slots[0].hash);
    assert.notEqual(a.slots[1].hash, b.slots[1].hash);
    assert.notEqual(a.prefixHash, b.prefixHash);
  });

  it("truncates optional lessons over budget", () => {
    const p = assembleSystemPrompt({ lessons: "x".repeat(5000) }, { lessons: 100 });
    assert.equal(p.slots[0].truncated, true);
    assert.ok(p.slots[0].chars <= 100 + 10);
  });

  it("detects append-only tool order", () => {
    assert.equal(isAppendOnly(["a", "b"], ["a", "b", "c"]), true);
    assert.equal(isAppendOnly(["a", "b"], ["b", "a", "c"]), false);
    assert.equal(isAppendOnly(["a", "b"], ["a"]), false);
    assert.notEqual(hashToolOrder(["a", "b"]), hashToolOrder(["b", "a"]));
  });

  it("date stamp is stable within a day", () => {
    assert.equal(dateStamp(new Date(2026, 10, 16, 1)), dateStamp(new Date(2026, 10, 16, 23)));
    assert.match(dateStamp(new Date(2026, 10, 16)), /^2026-11-16$/);
  });
});

describe("mixed-script token budgets", () => {
  it("counts Chinese prose, mixed JSON arguments and emoji conservatively", () => {
    assert.ok(estimateTokens([{ role: "user", content: "中".repeat(1000) }]) >= 1000);
    assert.ok(estimateTokens([{ role: "user", content: "abcd".repeat(100) }]) >= 100);
    assert.ok(estimateTokens([{ role: "user", content: "😀".repeat(100) }]) >= 300);
    assert.ok(estimateTokens([{ role: "user", content: "❤".repeat(100) }]) >= 300);
    assert.ok(estimateTokens([{ role: "assistant", tool_calls: [{ function: { arguments: JSON.stringify({ text: "中".repeat(500) }) } }] }]) >= 500);
  });
  it("triggers compaction for Chinese histories before window exhaustion", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "锁定规则" }, { role: "user", content: "目标" },
      ...Array.from({ length: 6 }, () => ({ role: "assistant" as const, content: "中".repeat(1000) })),
    ];
    assert.equal(compactMessages(messages, { triggerTokens: 3000, keepTailTokens: 500 }).compacted, true);
  });
  it("never clips critical contract or project decision tails", () => {
    for (const slot of ["contract", "core_facts"] as const) {
      assert.throws(() => assembleSystemPrompt({ [slot]: "锁定决策".repeat(100) }, { [slot]: 50 }), error => {
        assert.equal((error as Error).name, "ContextBudgetError");
        assert.match((error as Error).message, /拆分/);
        return true;
      });
      const content = "锁定决策尾部";
      assert.ok(assembleSystemPrompt({ [slot]: content }).system.includes(content));
    }
  });
});

it('date stamp uses Shanghai business day independent of worker timezone',()=>{
 const original=process.env.TZ;
 try {
  for(const zone of ['UTC','America/Los_Angeles']) {process.env.TZ=zone;assert.equal(dateStamp(new Date('2026-11-18T16:30:00Z')),'2026-11-19');}
 } finally {if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
});

it('keeps the newest complete tool exchange when its result exceeds tail budget',()=>{
 const messages:ChatMessage[]=[...bigHistory(),{role:'assistant',tool_calls:[{id:'latest',function:{name:'artifact_create',arguments:'{}'}}]},{role:'tool',tool_call_id:'latest',content:JSON.stringify({id:'artifact-stable',ok:true,body:'x'.repeat(5000)})}];
 const result=compactMessages(messages,{triggerTokens:1,keepTailTokens:20});
 assert.ok(result.messages.some(m=>m.tool_call_id==='latest'));
 assert.ok(result.messages.some(m=>m.tool_calls?.some((c:any)=>c.id==='latest')));
});
it('preserves late steering and stable success evidence even with an unhelpful LLM summary',async()=>{
 const steer='【追加指令】'+ '约束'.repeat(900)+'FINAL_CONSTRAINT';
 const messages:ChatMessage[]=[...bigHistory(),{role:'user',content:steer},{role:'assistant',tool_calls:[{id:'write-1',function:{name:'artifact_create',arguments:'{}'}}]},{role:'tool',tool_call_id:'write-1',content:JSON.stringify({ok:true,id:'stable-id',revision:7})},...bigHistory(20).filter(m=>m.role==='assistant')];
 const r=await compactMessagesAsync(messages,{triggerTokens:1,keepTailTokens:100},async()=> 'Generic summary without any evidence. Continue the task carefully.');
 const text=JSON.stringify(r.messages);
 assert.ok(text.includes(steer));
 assert.match(text,/stable-id/); assert.match(text,/write-1/); assert.match(text,/revision/);
});
it('handoff preserves full goal, done gap and artifact IDs',()=>{
 const pack=buildHandoffPack({runId:'r',agentId:'a',goal:'x'.repeat(1500)+'GOAL_END',doneGap:'y'.repeat(900)+'GAP_END',artifactIds:Array.from({length:40},(_,i)=>`artifact-${i}`),summary:'s'.repeat(2500)+'SUMMARY_END',compactions:4});
 for(const needle of ['GOAL_END','GAP_END','artifact-0','SUMMARY_END']) assert.ok(pack.includes(needle),needle);
});

it('iterative LLM compaction cannot erase prior stable references or ID arrays',async()=>{
 const first=compactMessages([...bigHistory(),{role:'assistant',tool_calls:[{id:'create',function:{name:'artifact_create',arguments:'{}'}}]},{role:'tool',tool_call_id:'create',content:JSON.stringify({ok:true,artifactIds:['ref-first','ref-second']})},...bigHistory(12).filter(m=>m.role==='assistant')],{triggerTokens:1,keepTailTokens:20});
 const second=await compactMessagesAsync([...first.messages,...bigHistory(20).filter(m=>m.role==='assistant')],{triggerTokens:1,keepTailTokens:20},async()=> 'A generic valid summary deliberately missing all original stable references.');
 for(const ref of ['ref-first','ref-second','artifact_create']) assert.ok(JSON.stringify(second.messages).includes(ref),ref);
});
