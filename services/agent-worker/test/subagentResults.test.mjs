import test from 'node:test';
import assert from 'node:assert/strict';
import {createWritingTools} from '../src/tools.js';

function spawnTool(spawnNested) {
  return createWritingTools({projectId:'p',runId:'parent',publish(){},
    allowlist:['subagent_spawn'],spawnNested,
    bindDelegation:async()=>({revision:null,check:async()=>{},acceptResults:async()=>{}})}).find(t=>t.name==='subagent_spawn');
}

test('failed child completion is returned as failure to the parent',async()=>{
  const tool=spawnTool(async()=>({status:'failed',exitReason:'done_contract_exhausted',runId:'child'}));
  const result=JSON.parse((await tool.execute('c',{role:'worker',task:'写作'})).content[0].text);
  assert.equal(result.ok,false);
});

test('parallel child exceptions cannot be reported as successful collaboration',async()=>{
  const tool=spawnTool(async()=>{throw new Error('provider unavailable');});
  const result=JSON.parse((await tool.execute('c',{role:'worker',task:'写作',mode:'parallel',tasks:['a','b']})).content[0].text);
  assert.equal(result.ok,false);
  assert.equal(result.failed.length,2);
});

test('successful child exposes run and artifact evidence',async()=>{
  const tool=spawnTool(async()=>({status:'succeeded',runId:'child',artifactIds:['a'],exitReason:'done_contract_pass'}));
  const result=JSON.parse((await tool.execute('c',{role:'worker',task:'写作'})).content[0].text);
  assert.equal(result.ok,true);
  assert.equal(result.runId,'child');
  assert.deepEqual(result.artifactIds,['a']);
});

test('canonical orchestrator sees spawn, regular writer and read-only scout remain isolated',async()=>{
  const {assertRegistered,resolveSubagent}=await import('@xiezuomanju/agent-runtime');
  const make=(allowlist,extra={})=>createWritingTools({projectId:'p',runId:'parent',publish(){},allowlist,...extra});
  const canonical=make(assertRegistered('orch.writing').tools).find(tool=>tool.name==='subagent_spawn');
  assert.ok(canonical);
  const result=await canonical.execute('c',{role:'worker',task:'t',depth:0});
  assert.equal(JSON.parse(result.content[0].text).error,'depth_exceeded');
  assert.ok(!make(assertRegistered('topic.core_hook_batch').tools).some(tool=>tool.name==='subagent_spawn'));
  const scout=make(resolveSubagent('scout').toolsAllowlist,{depth:1,securityMode:'readonly',nestedStrictAllowlist:true});
  assert.ok(!scout.some(tool=>['subagent_spawn','artifact_create'].includes(tool.name)));
});
