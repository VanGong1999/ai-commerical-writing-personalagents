import test from 'node:test';
import assert from 'node:assert/strict';
import { pairSteps, entryTitle, entryResultText } from '../src/features/agent-chat/stepFormat.ts';

test('factual context and recovery events retain inspectable payloads with readable titles',()=>{
 const entries=pairSteps([{id:'1',seq:1,actor:'agent:writer',kind:'context',payload:{prefixHash:'abc',slots:[{id:'core_facts',chars:28}]},createdAt:''},{id:'2',seq:2,actor:'agent:writer',kind:'recovery',payload:{message:'复用已完成写入',pendingReadCount:1},createdAt:''}]);
 assert.deepEqual(entries[0].result,{prefixHash:'abc',slots:[{id:'core_facts',chars:28}]});
 assert.equal(entryTitle(entries[0]),'本次上下文');
 assert.equal(entryTitle(entries[1]),'恢复执行');
 assert.match(entryResultText(entries[1]),/复用/);
});
