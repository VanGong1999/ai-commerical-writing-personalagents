import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {api} from '../src/apiClient.js';
import {freezeCritic} from '../src/criticReview.js';
import {createWritingTools} from '../src/tools.js';
import {runAgentJob} from '../src/runSession.js';

const agentId = 'topic.core_hook_critic';
const input = {gender_path:'male', artifactIds:['a#0','a#1'], artifactVersions:{a:1}};
const reviews = input.artifactIds.map((ref,i) => ({ref,rank:i+1,marketFit:4,innovation:4,compliance:4,
  opening:3+i,motivation:4-i,recommendation:'可改后再评',reason:'交接记录提供了核实线索。'}));
const args = {artifactId:'a',expectedVersion:1,reviews};
function fixture(t, ids=['a']) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE versions(id TEXT,v INTEGER,doc TEXT,PRIMARY KEY(id,v))');
  const insert = row => db.prepare('INSERT INTO versions VALUES(?,?,?)').run(row.id,row.version,JSON.stringify(row));
  for (const id of ids) insert({id,projectId:'p',type:'core_hook',version:1,status:'candidate',title:'候选',
    bodyMarkdown:'作者原文',bodyJson:{items:[{core_hook:'查验交接记录'},{core_hook:'核对档案编号'},{memo:'未选择'}]}});
  const list = () => db.prepare('SELECT doc,MAX(v) FROM versions GROUP BY id').all().map(r=>JSON.parse(r.doc));
  t.mock.method(api,'listArtifacts',async()=>list());
  t.mock.method(api,'listArtifactVersions',async(projectId,id)=>{
    assert.equal(projectId,'p');
    return db.prepare('SELECT doc FROM versions WHERE id=?').all(id).map(r=>{
      const {id,version,title,status,bodyMarkdown,bodyJson}=JSON.parse(r.doc);
      return {artifactId:id,version,title,status,bodyMarkdown,bodyJson,actor:'user'};
    });
  });
  t.mock.method(api,'updateArtifact',async(p,id,{expectedVersion,bodyJson})=>{
    const row=list().find(r=>r.id===id);
    assert.equal(expectedVersion,row.version);
    const next={...row,bodyJson,version:row.version+1};
    insert(next);
    return next;
  });
  return {db,list,insert};
}

async function firstWrite(selection=input,params=args) {
  const critic=await freezeCritic(api,'p','r',selection);
  const tools=createWritingTools({critic,projectId:'p',runId:'r',parentAgentId:agentId,
    allowlist:['artifact_update'],publish(){}});
  const result=await tools._allGated.find(t=>t.name==='artifact_update').execute('write',params);
  assert.deepEqual(result.artifactWrite,{id:'a',projectId:'p',version:2});
  const step={runId:'r',actor:'agent:'+agentId};
  const payload={id:'write',name:'artifact_update'};
  return {critic, steps:[{...step,seq:1,kind:'tool_call',payload:{...payload,args:params}},
    {...step,seq:2,kind:'tool_result',payload:{...payload,status:'done',artifactWrite:result.artifactWrite,result:result.content[0].text}}]};
}

test('equal totals allow either opening order; duplicate ranks and rising totals fail',async t=>{
  for(const [patch,expected] of [[{},'pass'],[{rank:1},'fail'],[{marketFit:5},'fail']]){
    await t.test(JSON.stringify(patch),async t=>{
      fixture(t);
      const {critic}=await firstWrite(input,{...args,reviews:[reviews[0],{...reviews[1],...patch}]});
      const result=await critic.check(true);
      assert.equal(result.result,expected,result.message);
    });
  }
});

test('proof and both snapshots bind the selected rows and protect the original',async t=>{
  const {list,insert}=fixture(t,['a','b']);
  const selection={...input,artifactIds:[...input.artifactIds,'b#0'],artifactVersions:{a:1,b:1}};
  const {steps}=await firstWrite(selection);
  const restore=(steps)=>freezeCritic(api,'p','r',selection,{steps,agentId});
  const change=(i,fields)=>steps.map((s,j)=>j===i?{...s,...fields}:s);
  const payload=(i,fields)=>change(i,{payload:{...steps[i].payload,...fields}});
  for (const bad of [[],steps.slice(0,1),steps.slice(1),[steps[1],steps[0]],change(0,{runId:'other'}),
    change(1,{actor:'user'}),
    steps.map((s,i)=>({...s,payload:{...s.payload,turn_id:'different-'+i}})),
    change(1,{turnId:'column',payload:{...steps[1].payload,turn_id:'payload'}}),payload(1,{id:'other'}),payload(1,{child_run_id:'child'}),payload(1,{status:'error'}),
    payload(1,{artifactWrite:undefined}),payload(1,{artifactWrite:{id:'a',projectId:'other',version:2}}),
    payload(0,{args:{...args,expectedVersion:2}}),payload(0,{args:{...args,reviews:reviews.slice(1)}}),
    payload(0,{args:{...args,reviews:[{...reviews[0],reason:'被修改的评价'},reviews[1]]}})]) {
    await assert.rejects(restore(bad));
  }
  const original=await api.listArtifactVersions('p','a');
  const versions=api.listArtifactVersions;
  for(const history of [original.slice(1),original.slice(0,1),
    [{...original[0],bodyJson:{items:[...original[0].bodyJson.items,{memo:'原有额外行'}]}},original[1]],
    [original[0],{...original[1],status:'adopted'}]]){
    api.listArtifactVersions=async()=>history;
    await assert.rejects(restore(steps));
  }
  api.listArtifactVersions=versions;
  const critic=await restore(steps);
  assert.match(critic.guidance,/a#0.*1.*19/);
  assert.match(critic.guidance,/a#1.*2.*19/);
  assert.equal((await critic.check(true)).result,'fail');
  await critic.write(args);
  assert.equal(api.updateArtifact.mock.callCount(),1);
  await critic.write({artifactId:'b',expectedVersion:1,reviews:[{...reviews[0],ref:'b#0',rank:3}]});
  assert.equal((await critic.check(true)).result,'pass');
  assert.deepEqual(list()[0].bodyJson.items[2],{memo:'未选择'});
  insert({...list()[0],status:'adopted',version:3});
  await assert.rejects(restore(steps));
  assert.equal(await critic.complete(),false);
});

for(const maxTurns of [1,2]) test('restarted critic requires both Schema and done_check with '+maxTurns+' available turns',async t=>{
  for(const key of Object.keys(api)) if(typeof api[key]==='function' &&
    !['listArtifacts','updateArtifact','listArtifactVersions'].includes(key)) t.mock.method(api,key,async()=>[]);
  const {db,list}=fixture(t);
  const root=mkdtempSync(join(tmpdir(),'critic-recovery-'));
  const previous=process.env.AGENT_SESSION_ROOT;
  process.env.AGENT_SESSION_ROOT=root;
  t.after(()=>{if(previous===undefined) delete process.env.AGENT_SESSION_ROOT; else process.env.AGENT_SESSION_ROOT=previous;
    rmSync(root,{recursive:true,force:true});});
  api.getProject=async()=>({id:'p',format:'male_long',progress:{}});
  const controller=new AbortController();
  db.exec('CREATE TABLE steps(seq INTEGER PRIMARY KEY,doc TEXT)');
  api.appendRunStep.mock.mockImplementation(async(runId,step)=>{
    db.prepare('INSERT INTO steps(doc) VALUES (?)').run(JSON.stringify({...step,runId}));
    if(step.kind==='tool_result' && step.payload.artifactWrite)controller.abort('interrupt');
  });
  api.getRunReplay=async()=>({steps:db.prepare('SELECT seq,doc FROM steps ORDER BY seq').all()
    .map(({seq,doc})=>({...JSON.parse(doc),seq}))});
  const requests=[];
  api.agentChat=async ({messages})=>{
    requests.push(structuredClone(messages));
    const [name,params]=[['artifact_update',args],['gate_run',{name:'Schema'}],['done_check',{}]][requests.length-1];
    return {choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'new-'+requests.length,type:'function',function:{name,arguments:JSON.stringify(params)}}]}}]};
  };
  const run={id:'r',agentId,inputJson:{...input,steerRevision:'revision'}};
  const job={id:'j',projectId:'p',leaseVersion:1,payload:{maxTurns:3}};
  await assert.rejects(runAgentJob({job,run,publish(){},signal:controller.signal}),/interrupted/);
  const original=list();
  assert.equal(original[0].version,2);
  assert.equal(requests.length,1);
  const restart=()=>runAgentJob({job:{...job,leaseVersion:2,attempts:1,payload:{maxTurns}},run,resume:{attempt:2,checkpoint:{turn:2}},publish(){}});
  const replay=api.getRunReplay;
  api.getRunReplay=async()=>({steps:(await replay()).steps.map(s=>s.payload.artifactWrite ?
    {...s,payload:{...s.payload,artifactWrite:{...s.payload.artifactWrite,projectId:'other'}}} : s)});
  await assert.rejects(restart(),/缺少本轮成功写回/);
  assert.equal(requests.length,1);
  api.getRunReplay=replay;
  const firstAttemptSteps=api.appendRunStep.mock.callCount();
  const originalLedger=(await replay()).steps;
  if(maxTurns===1) {
    await assert.rejects(restart(),/Done Contract/);
    const logged=api.appendRunStep.mock.calls.slice(firstAttemptSteps).map(c=>c.arguments[1]);
    assert.deepEqual(logged.filter(s=>s.kind==='tool_call').map(s=>s.payload.name),['gate_run']);
    assert.equal(logged.find(s=>s.kind==='receipt').payload.status,'failed');
    assert.ok(!logged.some(s=>s.payload.terminalResult));
    assert.deepEqual((await replay()).steps.slice(0,originalLedger.length),originalLedger);
    return;
  }
  const result=await restart();
  assert.ok(!JSON.stringify(requests[1]).includes(reviews[0].reason));
  assert.deepEqual((await replay()).steps.slice(0,originalLedger.length),originalLedger);
  assert.ok(originalLedger.some(s=>s.kind==='tool_call' && s.payload.args?.reviews?.[0].reason===reviews[0].reason));
  assert.equal(result.status,'succeeded');
  assert.deepEqual(result.outputVersions,{a:2});
  assert.equal(result.steerRevision,'revision');
  assert.deepEqual(list(),original);
  assert.equal(api.updateArtifact.mock.callCount(),1);
  assert.equal(api.createArtifact.mock.callCount(),0);
  assert.equal(api.ontologySubmit.mock.callCount(),0);
  assert.ok(requests[1].some(m=>m.role==='user' && m.content.includes('已核验写回') && m.content.includes('Schema')));
  assert.ok(result.gates.some(g=>g.id==='Schema' && g.result==='pass'));
  const logged=api.appendRunStep.mock.calls.slice(firstAttemptSteps).map(c=>c.arguments[1]);
  assert.deepEqual(logged.filter(s=>s.kind==='tool_call').map(s=>s.payload.name),['gate_run','done_check']);
  const receipt=logged.find(s=>s.kind==='receipt').payload;
  assert.equal(receipt.jobId,'j');
  assert.equal(receipt.leaseVersion,2);
  assert.deepEqual(receipt.terminalResult,result);
});
