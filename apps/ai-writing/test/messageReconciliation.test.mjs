import test from 'node:test';
import assert from 'node:assert/strict';
import { acknowledgedClientIds, reconcileMessage } from '../src/features/agent-chat/messageReconciliation.ts';
const optimistic=(client,id=client)=>({id,conversationId:'c',role:'user',content:'相同指令',actions:[],optimisticClientMessageId:client,contextRefs:[{id:'local'}]});
const persisted=(clients,id='server')=>({id,conversationId:'c',role:'user',content:'相同指令',actions:[{type:'inbox_event',payloads:clients.map(clientMessageId=>({clientMessageId}))}],contextRefs:[{id:'canonical'}]});
test('SSE replaces only correlated optimistic message and adopts authoritative references',()=>{
 const other=optimistic('second'),incoming=persisted(['first']);
 const result=reconcileMessage([optimistic('first'),other],incoming);
 assert.deepEqual(result,[incoming,other]);
 assert.deepEqual(result[0].contextRefs,[{id:'canonical'}]);
});
test('merged inbox event replaces every matching optimistic row once',()=>{
 const incoming=persisted(['a','b']);
 assert.deepEqual(reconcileMessage([optimistic('a'),optimistic('b')],incoming),[incoming]);
 assert.deepEqual(reconcileMessage([incoming,optimistic('b')],incoming),[incoming]);
});
test('identical text, another conversation and uncorrelated legacy messages never merge',()=>{
 const a=optimistic('a');
 for(const incoming of [persisted(['b']),{...persisted(['a']),conversationId:'other'},{...persisted([])}])
  assert.deepEqual(reconcileMessage([a],incoming),[a,incoming]);
});
test('assistant/tool messages cannot claim an optimistic user correlation',()=>{
 const a=optimistic('a');const incoming={...persisted(['a']),role:'assistant'};
 assert.deepEqual(reconcileMessage([a],incoming),[a,incoming]);
});

test('only durable user inbox acknowledgements identify in-flight sends across snapshots', () => {
  const ack = persisted(['first', 'second', 'first']);
  assert.deepEqual([...acknowledgedClientIds(ack)], ['first', 'second']);
  for (const role of ['assistant', 'tool', 'system']) {
    assert.equal(acknowledgedClientIds({...ack, role}).size, 0);
  }
  assert.equal(acknowledgedClientIds({...ack, actions: [
    {type: 'status', payloads: [{clientMessageId: 'unrelated'}]},
    {type: 'inbox_event', payloads: [null, {}, {clientMessageId: ''}]},
  ]}).size, 0);
  const snapshot = {...ack, content: 'persisted content'};
  assert.deepEqual(reconcileMessage([ack], snapshot), [snapshot]);
});
