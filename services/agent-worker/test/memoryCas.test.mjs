import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/apiClient.js';
import { createWritingTools } from '../src/tools.js';
const path = '/memories/projects/p/bible/world.md';
const tools = () => createWritingTools({projectId:'p',parentAgentId:'me',allowlist:['memory_write','bible_write','memory_get','bible_read'],securityMode:'yolo',publish:()=>{}});
const result = out => JSON.parse(out.content[0].text);

test('CAS conflict returns winner for explicit merge without replaying stale content', async () => {
 const old = api.putMemoryFileCas; let writes=0; let winner='other agent confirmed decision';
 try {
  api.putMemoryFileCas=async body=>{writes++;if(writes===1){const error=new Error('conflict');error.code='memory_conflict';error.detail={current_hash:'winner',current_content:winner};throw error;}winner=body.content;return{hash:'overwritten'};};
  for(const name of ['memory_write','bible_write']) {
   writes=0;
   const out=result(await tools().find(t=>t.name===name).execute('write',{path,content:'stale replacement',expectedHash:'old'}));
   assert.equal(writes,1,name); assert.equal(out.error,'memory_conflict'); assert.equal(out.currentHash,'winner'); assert.equal(out.currentContent,winner);
   assert.equal(winner,'other agent confirmed decision');
  }
 } finally {api.putMemoryFileCas=old;}
});

test('omitted hash cannot overwrite existing files; only confirmed 404 permits new creation',async()=>{
 const oldGet=api.getMemoryFile,oldPut=api.putMemoryFileCas;let calls=0;
 try {
  api.putMemoryFileCas=async body=>{calls++;assert.equal(body.expected_hash,null);return{hash:'created'};};
  api.getMemoryFile=async()=>({hash:'current',content:'confirmed'});
  const tool=tools().find(t=>t.name==='memory_write');
  const out=result(await tool.execute('write',{path,content:'blind'}));
  assert.equal(out.error,'memory_hash_required');assert.equal(calls,0);
  api.getMemoryFile=async()=>{throw new Error('503 unavailable');};
  try {await tool.execute('write',{path,content:'blind'});}catch{}
  assert.equal(calls,0);
  api.getMemoryFile=async()=>{throw new Error('404 /memory/file: missing');};
  assert.equal(result(await tool.execute('write',{path,content:'new'})).ok,true);assert.equal(calls,1);
 }finally{api.getMemoryFile=oldGet;api.putMemoryFileCas=oldPut;}
});

test('both memory readers return version and provenance alongside paged content',async()=>{
 const oldGet=api.getMemoryFile,oldTouch=api.touchMemory;
 try {
  api.getMemoryFile=async()=>({path,hash:'version',content:'line 1\nline 2',is_hypothesis:true,source_run_id:'run-origin',updated_at:'2026-11-19'});
  api.touchMemory=async()=>null;
  for(const name of ['memory_get','bible_read']){
   const out=result(await tools().find(t=>t.name===name).execute('read',{path,limit:1}));
   assert.equal(out.hash,'version',name);assert.equal(out.isHypothesis,true,name);assert.equal(out.sourceRunId,'run-origin',name);assert.equal(out.updatedAt,'2026-11-19',name);assert.equal(out.truncated,true,name);
  }
 }finally{api.getMemoryFile=oldGet;api.touchMemory=oldTouch;}
});

test('CAS transport uncertainty and proxy errors preserve inspection requirement without retries', async()=>{
 const original=globalThis.fetch;
 try {
  for(const mode of ['network','body','proxy']) {
   let calls=0;
   globalThis.fetch=async()=>{calls++;if(mode==='network')throw new TypeError('fetch failed after commit');if(mode==='body')return {text:async()=>{throw new TypeError('stream lost');}};return new Response('gateway failed',{status:502});};
   await assert.rejects(api.putMemoryFileCas({path,content:'new',expected_hash:'old'}),e=>e.code==='mutation_result_unknown');
   assert.equal(calls,1,mode);
  }
  let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({detail:{current_hash:'winner',current_content:'newer'}}),{status:409});};
  await assert.rejects(api.putMemoryFileCas({path,content:'stale',expected_hash:'old'}),e=>e.code==='memory_conflict'&&e.detail.current_hash==='winner');
  assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});

test('all worker CAS writers reject wildcard hashes at security boundary before reads or writes',async()=>{
 const names=['getMemoryFile','putMemoryFileCas','fsWrite','fsEdit'];const old=Object.fromEntries(names.map(n=>[n,api[n]]));let calls=0;
 try{
  for(const name of names)api[name]=async()=>{calls++;return {hash:'current',content:'old'};};
  const tools=createWritingTools({projectId:'p',parentAgentId:'me',allowlist:['memory_write','bible_write','memory_merge','fs_write','fs_edit'],securityMode:'yolo',publish:()=>{}});
  for(const name of ['memory_write','bible_write','memory_merge','fs_write','fs_edit']){
   for(const field of ['expectedHash','expected_hash']){
    const out=await tools.find(t=>t.name===name).execute('wildcard',{path,content:'stale',old:'old',new:'stale',[field]:'*'});
    assert.equal(calls,0,name+field);assert.match(JSON.stringify(out),/wildcard|通配/);
   }
  }
  const internalWriter=tools._ctx._allToolsCatalog.find(t=>t.name==='memory_write');
  const internal=result(await internalWriter.execute('internal',{path,content:'stale',expectedHash:'*'}));
  assert.equal(internal.error,'memory_hash_required');assert.equal(calls,0);
 }finally{Object.assign(api,old);}
});
