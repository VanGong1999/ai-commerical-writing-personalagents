import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {completedKbArtifacts} from '../src/completionArtifacts.js';
import {createWritingTools} from '../src/tools.js';
import {api} from '../src/apiClient.js';

test('KB join rejects a fabricated project link, stale report, duplicate type or changed content',()=>{
 const markdown='报告正文';
 const scope={runId:'r',docId:'d',projectId:'p'};
 const report={id:'report',docId:'d',reportType:'seven_steps',bodyMarkdown:markdown,bodyJson:{
  ...scope,artifactId:'a',status:'completed',contentHash:createHash('sha256').update(markdown).digest('hex')}};
 const art={id:'a',createdByRunId:'r',type:'analysis_report',bodyMarkdown:markdown,
  bodyJson:{docId:'d',reportId:'report',reportType:'seven_steps'}};
 assert.deepEqual(completedKbArtifacts([art,art],[report],scope),[art]);
 for (const r of [{...report,id:'other'},{...report,docId:'other'},{...report,bodyMarkdown:'changed'},
  {...report,bodyJson:{...report.bodyJson,runId:'old'}},{...report,bodyJson:{...report.bodyJson,contentHash:'stale'}}]){
  assert.deepEqual(completedKbArtifacts([art],[r],scope),[]);
 }
});

test('batch parent forwards only its trusted run and project identity',async()=>{
 const original=api.dispatchBatch;
 try{
  const calls=[];
  api.dispatchBatch=async(...args)=>{calls.push(args);return {status:'dispatched',taskGroupId:'g',runIds:['c','q'],episodeNos:[1]}};
  const ctx={projectId:'p',runId:'r',parentAgentId:'orch.batch_writer',allowlist:['job_enqueue','gate_run'],completionScope:{},publish(){}};
  const tools=createWritingTools(ctx);
  assert.ok(!tools._callableSet.has('artifact_create'));
  const enqueue=tools.find(t=>t.name==='job_enqueue');
  assert.equal(JSON.parse((await enqueue.execute('expansion',{type:'autopilot.batch',payload:{count:10}})).content[0].text).isError,true);
  assert.equal(tools._successfulTools.has('job_enqueue'),false);
  await enqueue.execute('valid',{type:'autopilot.batch',payload:{}});
  assert.deepEqual(calls,[['p','r']]);
  assert.deepEqual(ctx.completionScope.dispatchReceipt.runIds,['c','q']);
 }finally{api.dispatchBatch=original}
});

test('zero-length third batch body stops the group', async t=>{
 const {afterBodyLifecycle}=await import('../src/batchLifecycle.js');
 const slots=[1,2,3].map(episodeNo=>({episodeNo,runId:'run'+episodeNo}));
 t.mock.method(api,'listArtifacts',async()=>slots.map(s=>({createdByRunId:s.runId,bodyJson:{episodeNo:s.episodeNo},bodyMarkdown:'字'.repeat(s.episodeNo===3?0:1000)})));
 t.mock.method(api,'putMemoryFile',async()=>({}));
 t.mock.method(api,'getAppSettings',async()=>({featureToggles:{storyGraphAutoUpdate:false,foreshadowAutoUpdate:false}}));
 const result=await afterBodyLifecycle({projectId:'p',agentId:'prose.episode_body',input:{taskGroupId:'g',batchBodySlots:slots}});
 assert.equal(result.hardStop,true);
});

test('pipeline setup cannot spawn another workflow or replace author drafts', async t => {
  const tools = createWritingTools({
    projectId: 'p', runId: 'r', parentAgentId: 'orch.writing', pipelineMember: true,
    allowlist: ['subagent_spawn','job_enqueue','gate_run','artifact_update','ontology_action'],
    publish() {},
  });
  for (const name of ['subagent_spawn','job_enqueue','job_cancel','ontology_action']) {
    assert.equal(tools._callableSet.has(name), false);
    assert.equal(tools._searchableSet.has(name), false);
    assert.equal(tools.some(tool => tool.name === name), false);
  }
  assert.ok(tools._callableSet.has('gate_run'));
  t.mock.method(api,'listArtifacts',async () => [{id:'a', createdByRunId:'author'}]);
  const forbidden = t.mock.method(api,'updateArtifact',async () => assert.fail('author draft was modified'));
  const result = await tools.find(tool => tool.name === 'artifact_update').execute('edit', {
    artifactId:'a', expectedVersion:1, bodyMarkdown:'替换',
  });
  assert.equal(JSON.parse(result.content[0].text).isError,true);
  assert.equal(forbidden.mock.callCount(),0);
});

test('author edit after agent write cannot replace its delivery version', async () => {
  const { writtenVersions } = await import('../src/runSession.js');
  const result = (name, version, extra={}) => ({type:'tool_result',runId:'r',payload:{
    status:'done',name,result:JSON.stringify({id:'a',projectId:'p',version, ...extra})}});
  assert.deepEqual(writtenVersions([
    result('artifact_create',1),result('artifact_list',2),result('artifact_create',2,{reused:true}),
    {...result('artifact_update',4),runId:'other'},
  ],'r','p',['a']),{a:1});
  assert.deepEqual(writtenVersions([result('artifact_update',3),result('artifact_list',4)],'r','p',['a']),{a:3});
  const write={type:'tool_result',runId:'r',payload:{status:'done',artifactWrite:{id:'a',projectId:'p',version:1}}};
  const changed=patch=>({...write,payload:{...write.payload,...patch}});
  assert.deepEqual(writtenVersions([write,changed({child_run_id:'child',artifactWrite:{...write.payload.artifactWrite,version:4}}),
    changed({status:'error',artifactWrite:{...write.payload.artifactWrite,version:5}}),
    changed({artifactWrite:{id:'a',projectId:'other',version:8}})],'r','p',['a']),{a:1});
});

test('resumed worker redelivers the completed job receipt without another model turn', async t => {
  const { runAgentJob } = await import('../src/runSession.js');
  const saved = {runId:'task22-recover',status:'succeeded',receiptId:'receipt_task22-recover',artifactIds:['artifact'],
    outputVersions:{artifact:1},receipt:{status:'succeeded',attestation:'original',inputHash:createHash('sha256').update('{}').digest('hex').slice(0,24)}};
  t.mock.method(api,'getRunReplay', async () => ({steps:[{kind:'receipt',payload:{
    jobId:'task22-job',leaseVersion:1,terminalResult:saved}}]}));
  const result = await runAgentJob({job:{id:'task22-job',leaseVersion:2,projectId:'project22',payload:{}},
    run:{id:saved.runId,agentId:'topic.market_brief',inputJson:{}},publish(){}});
  assert.deepEqual(result,saved);
});

test('hard interrupt with changed input passes the saved terminal receipt and executes the new instruction', async t => {
  const {runAgentJob} = await import('../src/runSession.js');
  const agentId='topic.market_brief',runId='task22-steer',projectId='p';
  const original={assistantPrompt:'旧指令',reuseArtifactIds:[]};
  const inputHash=createHash('sha256').update(JSON.stringify(original)).digest('hex').slice(0,24);
  const saved={runId,status:'succeeded',receipt:{inputHash}};
  t.mock.method(api,'getRunReplay',async()=>({steps:[{kind:'receipt',payload:{jobId:'job',terminalResult:saved}}]}));
  const reached=t.mock.method(api,'listArtifacts',async()=>{throw new Error('reached revised execution')});
  const job={id:'job',leaseVersion:2,projectId,payload:{}};
  const run={id:runId,agentId,inputJson:original};
  assert.deepEqual(await runAgentJob({job,run,publish(){}}),saved);
  assert.equal(reached.mock.callCount(),0);
  await assert.rejects(runAgentJob({job,run:{...run,inputJson:{...original,assistantPrompt:'旧指令\n【中断后新指令】改成夜景'}},
    publish(){}}),/reached revised execution/);
  assert.equal(reached.mock.callCount(),1);
});

test('idempotent report writers return the immutable creation version after later author edits', async t => {
  const report={id:'a',projectId:'p',createdByRunId:'r',version:4,bodyJson:{reportId:'kb'}};
  const history=[{artifactId:'a',version:4,actor:'user'}];
  t.mock.method(api,'listArtifactVersions',async()=>history);
  t.mock.method(api,'saveProposalChecklist',async()=>report);
  t.mock.method(api,'writeKbReport',async()=>({id:'kb',reportType:'seven_steps',bodyJson:{contentHash:'hash'}}));
  for(const [role,toolName,params,actor] of [
    ['colleague.proactive','checklist_open',{title:'建议',items:[]},'agent:r'],
    ['kb.report_pipeline','kb_write_report',{docId:'d',reportType:'seven_steps',body:{title:'分析',bodyMarkdown:'分析已完成并提供了书中的实际示例。'}},'agent:kb.report_pipeline'],
  ]) {
    const tools=createWritingTools({projectId:'p',runId:'r',parentAgentId:role,allowlist:[toolName],
      completionScope:{docId:'d',verifiedReports:async()=>[report]},publish(){}});
    const tool=tools.find(t=>t.name===toolName);
    assert.equal((await tool.execute('no-provenance',params)).artifactWrite,undefined);
    history.push({artifactId:'a',version:1,actor});
    assert.deepEqual((await tool.execute('delivered',params)).artifactWrite,{id:'a',projectId:'p',version:1});
    history.pop();
  }
});
