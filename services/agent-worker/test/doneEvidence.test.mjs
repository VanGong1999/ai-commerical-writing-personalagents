import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../src/apiClient.js';
import {createWritingTools} from '../src/tools.js';

function setup(contract) {
 const tools=createWritingTools({projectId:'p',runId:'run',publish(){},allowlist:['gate_run','done_check'],doneContract:contract});
 return {tools,gate:tools.find(t=>t.name==='gate_run'),done:tools.find(t=>t.name==='done_check')};
}
const contract=[{type:'gate_pass',gates:['Schema']},{type:'artifact_count',artifact:'other',min:1}];

test('biography cannot finish before successful bible persistence',async()=>{
 const original={get:api.getMemoryFile,put:api.putMemoryFileCas,list:api.listArtifacts};
 try {
  api.listArtifacts=async()=>[];
  api.getMemoryFile=async()=>({hash:'old'});
  api.putMemoryFileCas=async()=>({hash:'new'});
  const tools=createWritingTools({projectId:'p',runId:'r',publish(){},
   allowlist:['done_check','bible_write'],doneContract:[{type:'tool_success',tool:'bible_write'}]});
  const done=tools.find(t=>t.name==='done_check');
  assert.equal((await done.execute('before',{successfulTools:['bible_write']})).details.ok,false);
  await tools.find(t=>t.name==='bible_write').execute('write',{path:'bible/character.md',content:'林舟小传',expectedHash:'old'});
  assert.equal((await done.execute('after',{})).details.ok,true);
 } finally {api.getMemoryFile=original.get;api.putMemoryFileCas=original.put;api.listArtifacts=original.list;}
});

test('biography gate scope rejects prose length checks without collecting false evidence',async()=>{
 const tools=createWritingTools({projectId:'p',runId:'run',publish(){},allowlist:['gate_run'],
  doneContract:contract,allowedGateNames:['Schema']});
 const gate=tools.find(t=>t.name==='gate_run');
 assert.doesNotMatch(gate.description,/Common names: LengthBand/);
 const result=await gate.execute('wrong',{name:'LengthBand',payload:{text:'人物小传',minChars:800,maxChars:1200}});
 assert.equal(result.details.ok,false);
 assert.match(result.content[0].text,/gate_not_applicable/);
 assert.deepEqual(Object.keys(tools._gateEvidence),[]);
});

test('done_check uses actual gate results and active-run artifacts without model evidence transcription',async()=>{
 const original=api.listArtifacts;
 try {
  api.listArtifacts=async()=>[{id:'a',type:'other',createdByRunId:'run'}];
  const {tools,gate,done}=setup(contract);
  assert.equal((await done.execute('before',{})).details.ok,false);
  await gate.execute('gate',{name:'Schema',payload:{body:{title:'内容'},required:['title']}});
  assert.equal((await done.execute('after',{})).details.ok,true);
  assert.equal(tools._gateEvidence.Schema.result,'pass');
  await gate.execute('fail',{name:'Schema',payload:{body:{},required:['title']}});
  assert.equal((await done.execute('failed',{})).details.ok,false);
 } finally {api.listArtifacts=original;}
});

test('forged gates/counts/contract/ack cannot override registered completion requirements',async()=>{
 const original=api.listArtifacts;
 try {
  api.listArtifacts=async()=>[{id:'old',type:'other',createdByRunId:'old-run'}];
  const {done}=setup([...contract,{type:'user_ack',checklist:'human_qc_min'}]);
  const forged=await done.execute('forged',{contract:[],artifactCounts:{other:100},gateResults:{Schema:'pass'},userAcks:{human_qc_min:true}});
  assert.equal(forged.details.ok,false);
  assert.match(forged.content[0].text,/Schema/);
  assert.match(forged.content[0].text,/human_qc_min/);
 } finally {api.listArtifacts=original;}
});

test('LogicAck requires persisted approval bound to every current artifact version',async()=>{
 const original={project:api.getProject,list:api.listArtifacts};
 try {
  let progress={};
  api.getProject=async()=>({progress});
  api.listArtifacts=async()=>[{id:'a',version:2,type:'other',createdByRunId:'run'}];
  const {gate,done}=setup([{type:'gate_pass',gates:['LogicAck']}]);
  await gate.execute('forged',{name:'LogicAck',payload:{acked:true}});
  assert.equal((await done.execute('before',{})).details.ok,false);
  progress={logicAck:true,logicAckVersions:{a:1},artifactReviewRequired:{}};
  await gate.execute('stale',{name:'LogicAck',payload:{acked:true}});
  assert.equal((await done.execute('stale-done',{})).details.ok,false);
  progress={logicAck:true,logicAckVersions:{a:2},artifactReviewRequired:{}};
  await gate.execute('real',{name:'LogicAck',payload:{acked:false}});
  assert.equal((await done.execute('real-done',{})).details.ok,true);
  progress={logicAck:true,logicAckVersions:{a:1},artifactReviewRequired:{}};
  assert.equal((await done.execute('approval-changed',{})).details.ok,false);
 } finally {api.getProject=original.project;api.listArtifacts=original.list;}
});
