import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {manifest,sendWrite} from './e2e-capabilities-minimax.mjs';
import {schemaErrors,candidates} from './e2e-capabilities-minimax-probes.mjs';
import {intents} from './e2e-capabilities-minimax-fixtures.mjs';
test('all distinct surface cases have authentic schemas and editorial requests',()=>{
  const rows=manifest();
  for(const [phase,n] of Object.entries({agent:148,skill:137,worker:82,personal:51}))assert.equal(rows.filter(r=>r.phase===phase).length,n);
  for(const r of rows.filter(r=>r.spec.schema)){
    assert.ok(intents[r.id]);
    const names=candidates(r,rows).map(s=>s.function.name);
    assert.equal(names.length,7);
    assert.ok(names.includes(r.id));
  }
  assert.equal(rows.find(r=>r.key==='worker/bash').spec.schema,null);
});
test('schema validator checks nested value types',()=>{
  const schema={type:'object',required:['x'],properties:{x:{type:'array',items:{type:'integer'}}}};
  assert.equal(schemaErrors(schema,{x:[1]}).length,0);
  assert.ok(schemaErrors(schema,{x:['1']}).length);
});
test('retry only explicit HTTP 429 and respect server delay',async()=>{
  let requests=0;
  const server=createServer((req,res)=>{
    requests++;
    if(requests===1)res.writeHead(429,{'Retry-After':'0'}).end();
    else res.writeHead(200).end('{"id":"ok"}');
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  try{
    const record={path:'/runs',method:'POST',body:{}};
    const result=await sendWrite('http://127.0.0.1:'+server.address().port,record,{signal:new AbortController().signal,timeout:1000,save(){},backoff(ms){assert.equal(ms,0);}});
    assert.equal(result.id,'ok');assert.equal(requests,2);assert.equal(record.throttles.length,1);
  }finally{await new Promise(ok=>server.close(ok));}
});

import {contractScope,onlyHumanOutstanding,requiredGaps,cleanup} from './e2e-capabilities-minimax-evidence.mjs';
test('batch scope and genuine prior confirmation',()=>{
  assert.deepEqual(requiredGaps('| 字段 | 必填 | 说明 |',{}),[]);
  assert.match(contractScope({doneContract:[{type:'artifact_count',min:10}]}),/10/);
  assert.ok(requiredGaps('| characters | 是 | 已人工确认的人物卡 |',{characters:'id'}).length);
  assert.ok(requiredGaps('| candidates | 是 | 候选 |',{candidates:[]}).length);
});
test('unrelated failure cannot be attributed to human approval',()=>{
  const checks=[{id:'done.user_ack',result:'fail'}];
  assert.equal(onlyHumanOutstanding('cancelled',checks,'done_contract'),false);
  assert.equal(onlyHumanOutstanding('failed',checks,'provider error'),false);
  assert.equal(onlyHumanOutstanding('failed',[...checks,{id:'done.gate_pass.Schema',result:'fail'}],'done_contract'),false);
  assert.equal(onlyHumanOutstanding('failed',checks,'done_contract'),true);
});
test('cancellation or deadline during an acknowledged connection never replays an ambiguous write',async()=>{
  for(const reason of ['deadline','shutdown']){
    let requests=0;
    const controller=new AbortController();
    const server=createServer(()=>{requests++;if(reason==='shutdown')controller.abort();});
    await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
    try{
      const record={method:'POST',path:'/runs',body:{}};
      await assert.rejects(sendWrite('http://127.0.0.1:'+server.address().port,record,{signal:controller.signal,timeout:100,save(){},backoff(){}}));
      assert.equal(requests,1);assert.equal(record.retryAt,undefined);
    }finally{server.closeAllConnections();await new Promise(ok=>server.close(ok));}
  }
});
test('long retry-after persists a safe resumption time',async()=>{
  const server=createServer((req,res)=>res.writeHead(429,{'Retry-After':'120'}).end());
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  try{
    const record={method:'POST',path:'/runs',body:{}};
    await assert.rejects(sendWrite('http://127.0.0.1:'+server.address().port,record,{signal:new AbortController().signal,timeout:1000,save(){},backoff(){}}),/rate limited/);
    assert.ok(record.retryAt>Date.now()+110000);
  }finally{await new Promise(ok=>server.close(ok));}
});
test('synthetic children are reconciled only from their parent replay',async()=>{
  const state={writes:{run:{result:{id:'parent'}}}};
  const stopped=[];
  await cleanup(state,{save(){},async stop(id){stopped.push(id);},async get(path){
    if(path==='/runs/parent/replay')return {steps:[{kind:stopped.length?'run_end':'model_call',payload:{child_run_id:'child',status:stopped.length?'cancelled':'running'}}]};
    assert.equal(path,'/runs/parent');
    return {status:stopped.length?'cancelled':'running'};
  }});
  assert.deepEqual(stopped,['parent']);assert.equal(state.ownedRuns.child.status,'cancelled');
});
import {joinEvidence} from './e2e-capabilities-minimax-evidence.mjs';
test('trace joins require matching surface, source and attributed run',()=>{
  const agent={key:'agent/a',id:'a',phase:'agent',hash:'A',spec:{skillHash:'S'}};
  const worker={id:'tool_search',phase:'worker',hash:'W'};
  const personal={...worker,phase:'personal'};
  const state={hash:'A',toolHashes:{tool_search:'W'},writes:{run:{body:{agentId:'a'},result:{id:'r'}}},usage:[{model:'MiniMax'}],replay:{steps:[
    {runId:'r',kind:'tool_call',payload:{id:'c',name:'tool_search',args:{query:'台词'}}},
    {runId:'r',kind:'tool_result',payload:{id:'c',result:'{"ok":true}',status:'done'}}
  ]}};
  const reports=[{phase:'agent',cases:{'agent/a':state}}];
  assert.equal(joinEvidence(worker,[agent],reports).length,1);
  assert.equal(joinEvidence(personal,[agent],reports).length,0);
  assert.equal(joinEvidence({...worker,hash:'stale'},[agent],reports).length,0);
  state.replay.steps[1].runId='other';
  assert.equal(joinEvidence(worker,[agent],reports).length,0);
});

import {matchingOutline,shortManuscript} from './e2e-capabilities-minimax-evidence.mjs';
test('require matching unit, outline type and actual persisted short prose',()=>{
  const a={type:'episode_outline',bodyJson:{ep_no:1},title:'第1集'};
  assert.ok(matchingOutline(a,'episode_outline',1));
  assert.equal(matchingOutline(a,'chapter_outline',1),false);
  assert.equal(matchingOutline({...a,title:'第2集'},'episode_outline',1),false);
  assert.equal(matchingOutline({type:'episode_outline'},'episode_outline',1),false);
  assert.ok(shortManuscript({type:'manuscript',bodyMarkdown:'她推开门。'}));
  assert.equal(shortManuscript({type:'manuscript',bodyMarkdown:'标题',bodyJson:{script_body:'字'.repeat(1000)}}),false);
  assert.equal(shortManuscript({type:'scene',bodyMarkdown:'短文'}),false);
});
test('nested spawn without a child run_end prevents cleanup certification',async()=>{
  const state={writes:{run:{result:{id:'root'}}}};
  const paths=[];
  await assert.rejects(cleanup(state,{budget:1,save(){},async stop(){assert.fail();},async get(path){
    paths.push(path);
    if(path==='/runs/root')return {status:'failed'};
    return {steps:[{kind:'receipt',payload:{child_run_id:'child',spawned_run_id:'grandchild',status:'succeeded'}},{kind:'run_end',payload:{child_run_id:'child',status:'succeeded'}}]};
  }}),/reconciliation/);
  assert.deepEqual(paths.slice(0,2),['/runs/root','/runs/root/replay']);
  assert.equal(state.ownedRuns.grandchild.terminalProof,undefined);
});
test('confirmed live root retries a previously failed stop',async()=>{
  const state={writes:{run:{result:{id:'root'}}}};
  let count=0;
  await cleanup(state,{budget:3000,save(){},async stop(){if(++count===1)throw Error('503');},async get(path){
    return path.endsWith('/replay')?{steps:[]}:{status:count===2?'cancelled':'running'};
  }});
  assert.equal(count,2);assert.match(state.ownedRuns.root.lastStopError,/503/);
});
test('skill trace requires exact canonical ref and a matching successful read result',()=>{
  const agent={key:'agent/a',id:'a',phase:'agent',hash:'A',spec:{skillHash:'S'}};
  const skill={id:'a/b',phase:'skill',hash:'S',spec:{path:'skills/a/b/SKILL.md',name:'a-b',agents:['a']}};
  const state={hash:'A',writes:{run:{body:{agentId:'a'},result:{id:'r'}}},usage:[{model:'MiniMax'}],replay:{steps:[]}};
  const joined=()=>joinEvidence(skill,[agent],[{phase:'agent',cases:{'agent/a':state}}])[0].kind;
  assert.equal(joined(),'run_association');
  state.replay.steps.push({runId:'r',kind:'tool_call',payload:{id:'c',name:'skill_read',args:{ref:'a/b-extra'}}},{runId:'r',kind:'tool_result',payload:{id:'c',result:{relativePath:'a/b-extra/SKILL.md'}}});
  assert.equal(joined(),'run_association');
  state.replay.steps[0].payload.args.ref='a/b';
  assert.equal(joined(),'run_association');
  state.replay.steps[1].payload.result={relativePath:'a/b/SKILL.md'};
  assert.equal(joined(),'skill_read');
});

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
test('worker CLI resolves probe module and completes against fake HTTP',async()=>{
  const dir=await mkdtemp(tmpdir()+'/cap-cli-');
  const requests=[];
  const server=createServer((req,res)=>{
    requests.push(req.url);
    res.writeHead(200,{'Content-Type':'application/json'}).end('[]');
  });
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  try{
    const file=dir+'/report.json';
    await promisify(execFile)(process.execPath,['scripts/e2e-capabilities-minimax.mjs','worker',file,'^job_cancel$'],{env:{...process.env,E2E_API_BASE:'http://127.0.0.1:'+server.address().port},timeout:10000});
    assert.ok(requests.some(path=>path.endsWith('/artifacts')));
    assert.equal(JSON.parse(await readFile(file,'utf8')).cases['worker/job_cancel'].status,'blocked_prerequisites');
  }finally{await new Promise(ok=>server.close(ok));await rm(dir,{recursive:true,force:true});}
});
