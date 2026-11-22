import test from 'node:test';
import assert from 'node:assert/strict';
import { maybeCompact } from '../src/contextCompaction.js';

test('handoff preserves newest settled tool group and later steering verbatim', async()=>{
 const messages=[{role:'system',content:'SYS'},{role:'user',content:'GOAL'},...Array.from({length:15},()=>({role:'assistant',content:'x'.repeat(1000)})),{role:'assistant',tool_calls:[{id:'last-call',function:{name:'gate_run',arguments:'{}'}}]},{role:'tool',tool_call_id:'last-call',content:'{"ok":true,"id":"gate-stable"}'},{role:'user',content:'【追加指令】保留结尾约束'}];
 const r=await maybeCompact({api:{chat:async()=>({content:'Summary of earlier completed work; continue checking results.'})},messages,cfg:{triggerTokens:1,keepTailTokens:100,handoffAfterCompactions:1},state:{compactions:0,handoffs:0},runId:'r',agentId:'a',projectId:'p',goal:'GOAL'});
 assert.equal(r.event.kind,'handoff');
 assert.ok(r.messages.some(m=>m.tool_call_id==='last-call'));
 assert.ok(r.messages.some(m=>m.tool_calls?.some(c=>c.id==='last-call')));
 assert.equal(r.messages.at(-1).content,'【追加指令】保留结尾约束');
});

test('handoff includes authoritative user instructions exactly once',async()=>{
 const steer='【追加指令】只处理选中段落';
 const messages=[{role:'system',content:'SYS'},{role:'user',content:'GOAL'},...Array.from({length:15},()=>({role:'assistant',content:'x'.repeat(1000)})),{role:'user',content:steer},{role:'assistant',content:'Latest observation'}];
 const r=await maybeCompact({api:{chat:async()=>({content:'Structured earlier work summary with enough detail to proceed.'})},messages,cfg:{triggerTokens:1,keepTailTokens:100,handoffAfterCompactions:1},state:{compactions:0,handoffs:0},runId:'r',agentId:'a',projectId:'p',goal:'GOAL'});
 assert.equal(r.messages.filter(m=>m.content===steer).length,1);
});

test('truncated LLM summaries fall back to deterministic evidence',async()=>{
 const messages=[{role:'system',content:'SYS'},{role:'user',content:'GOAL'},...Array.from({length:15},()=>({role:'assistant',content:'x'.repeat(1000)}))];
 const r=await maybeCompact({api:{chat:async()=>({content:'This is incomplete summary content with enough length to pass the old guard.',finishReason:'length'})},messages,cfg:{triggerTokens:1,keepTailTokens:100},state:{compactions:0,handoffs:0},projectId:'p',agentId:'a',runId:'r'});
 assert.equal(r.event.method,'deterministic');assert.match(r.event.fallbackReason,/summary_incomplete/);
});

test('repeated handoffs retain prior write and child run identities',async()=>{
 let messages=[{role:'system',content:'SYS'},{role:'user',content:'GOAL'},{role:'assistant',tool_calls:[{id:'write',function:{name:'artifact_create',arguments:'{}'}}]},{role:'tool',tool_call_id:'write',content:JSON.stringify({id:'must-survive',runId:'child-run',agentId:'writer',status:'succeeded'})}];
 const state={compactions:0,handoffs:0};
 for(let n=0;n<3;n++){
 messages.push(...Array.from({length:12},()=>({role:'assistant',content:'x'.repeat(1000)})));
 const r=await maybeCompact({api:{chat:async()=>({content:'Current completed work and next actionable gaps summarized.'})},messages,cfg:{triggerTokens:1,keepTailTokens:1,handoffAfterCompactions:1},state,projectId:'p',agentId:'a',runId:'r',goal:'GOAL'});messages=r.messages;
 assert.match(JSON.stringify(messages),/must-survive/);assert.match(JSON.stringify(messages),/child-run/);
 }
});
