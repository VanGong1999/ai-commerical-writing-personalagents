#!/usr/bin/env node
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';

const base=(process.env.E2E_API_BASE || 'http://127.0.0.1:8000').replace(/\/$/,'');
const timeout=Number(process.env.E2E_RUN_TIMEOUT_MS || 480000);
const output=process.env.E2E_REPORT || '/tmp/xzm-minimax-parallel-team.json';
const report={passed:false,provider:null,projectId:null,conversationId:null,members:[],governor:[]};
const expected=new Map([
  ['topic.logline_title','deliver/logline'],
  ['char.bio_manju','manju/bio'],
  ['topic.world_setting','topic/world-setting'],
]);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Mutations are never repeated automatically; a lost response requires inspection.
async function api(method,path,body) {
  const response=await fetch(`${base}/api/v1${path}`,{method,
    signal:AbortSignal.timeout(240000),headers:body?{'Content-Type':'application/json'}:undefined,
    body:body?JSON.stringify(body):undefined});
  if(!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${(await response.text()).slice(0,500)}`);
  return response.json();
}

try {
  report.provider=(await api('GET','/settings/providers')).find(p=>p.isDefault)?.selectedModel;
  assert.match(report.provider,/MiniMax/i);
  const project=await api('POST','/projects',{title:`E2E-MiniMax-three-distinct-${Date.now()}`,format:'manju',market:'cn'});
  report.projectId=project.id;
  const conv=await api('POST','/conversations',{source:'assistant',projectId:project.id,title:'三位不同同事并行协作验收'});
  report.conversationId=conv.id;
  console.log(`Project ${project.id}; conversation ${conv.id}`);
  const message='请在当前项目用协作编组功能同时安排三位不同的专职同事：片名一句话官写一个片名和一句话卖点；小传铸手只写主角林舟的人物小传并写入 bible；世界观筑造师写一个简洁设定包。共同故事是：林舟重生回家族公司破产前三天，凭上一世记忆和商业谈判阻止合伙人周明侵吞公司。这三项互不依赖，请使用并行编组，每人任务单独分配，不写正文、不进大纲、不自动采纳。每位同事先读对应技能、只创建一个候选、执行所需门禁和 done_check。创建编组后简短汇报即可，不要轮询，也不要另建守护任务组。';
  const response=await fetch(`${base}/api/v1/conversations/${conv.id}/chat`,{method:'POST',
    headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(240000),
    body:JSON.stringify({projectId:project.id,message})});
  assert.ok(response.ok);
  const text=await response.text();
  const events=text.split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)));
  report.dispatchEvents=events.filter(e=>['tool_call','tool_result','confirm','error','done'].includes(e.event));
  assert.ok(!events.some(e=>e.event==='error'),JSON.stringify(events.at(-1)));
  const confirmation=events.find(e=>e.event==='confirm');
  if(confirmation) {
    assert.equal(confirmation.tool,'create_fleet');
    assert.equal(confirmation.args.project_id,project.id);
    assert.equal(confirmation.args.mode || 'union','union');
    assert.equal(confirmation.args.members.length,3);
    report.approval=await api('POST',`/conversations/${conv.id}/respond`,{approve:true});
    assert.ok(report.approval.ok);
  }
  const fleets=(await api('GET',`/agents/fleets?projectId=${project.id}`)).fleets;
  assert.equal(fleets.length,1,'Personal Agent must create exactly one real fleet');
  const fleet=fleets[0];report.fleetId=fleet.planId;
  assert.equal(fleet.mode,'union');assert.equal(fleet.reports.length,3);
  assert.deepEqual(new Set(fleet.reports.map(r=>r.agentId)),new Set(expected.keys()));
  assert.equal(new Set(fleet.reports.map(r=>r.workdir)).size,3);
  console.log(`Fleet ${fleet.planId}: ${fleet.reports.map(r=>`${r.name}=${r.agentId}`).join('; ')}`);
  const deadline=Date.now()+timeout;let runs=[];let iteration=0;
  while(Date.now()<deadline) {
    runs=await Promise.all(fleet.reports.map(r=>api('GET',`/runs/${r.runId}`)));
    const governor=await api('GET','/internal/llm-governor');
    report.governor.push({at:new Date().toISOString(),...governor});
    if(iteration++%10===0) {
      console.log(runs.map(r=>`${r.agentId}:${r.status}`).join(' | '));
    }
    if(runs.every(r=>r.status==='succeeded')) break;
    assert.ok(!runs.some(r=>['failed','dead','cancelled'].includes(r.status)),JSON.stringify(runs.map(r=>({id:r.id,status:r.status}))));
    await sleep(2000);
  }
  assert.ok(runs.every(r=>r.status==='succeeded'),'three-person fleet timed out');
  const starts=[],ends=[];
  for(const run of runs) {
    assert.match(run.model,/MiniMax/i);
    const replay=await api('GET',`/runs/${run.id}/replay`);
    const steps=replay.steps.filter(s=>!s.payload.child_run_id);
    const calls=steps.filter(s=>s.kind==='tool_call').map(s=>s.payload);
    assert.ok(calls.some(c=>c.name==='skill_read' && JSON.stringify(c.args).includes(expected.get(run.agentId))),`${run.agentId}: wrong/missing skill`);
    assert.ok(calls.some(c=>c.name==='done_check'),`${run.agentId}: missing done_check`);
    assert.equal(run.outputArtifactIds.length,1,`${run.agentId}: missing/repeated artifact`);
    if(run.agentId==='char.bio_manju') assert.ok(calls.some(c=>c.name==='bible_write'));
    const startedAt=steps.find(s=>s.kind==='model_call').createdAt;
    const endedAt=steps.findLast(s=>s.kind==='run_end').createdAt;
    starts.push(startedAt);ends.push(endedAt);
    const jobId=fleet.reports.find(member=>member.runId===run.id).jobId;
    const job=await api('GET',`/jobs/${jobId}`);
    report.members.push({name:fleet.reports.find(r=>r.runId===run.id).name,agentId:run.agentId,runId:run.id,
      model:run.model,startedAt,endedAt,artifactIds:run.outputArtifactIds,jobAttempts:job.attempts,
      runStarts:steps.filter(s=>s.kind==='run_start').length,
      jobRestarts:Math.max(0,steps.filter(s=>s.kind==='run_start').length-1),
      tools:calls.map(c=>c.name),repairEvents:steps.filter(s=>s.kind==='model_repair').map(s=>s.payload)});
  }
  report.overlap={start:starts.sort().at(-1),end:ends.sort()[0]};
  assert.ok(report.overlap.start<report.overlap.end,'all THREE distinct agents must overlap in execution');
  assert.ok(report.governor.some(sample=>sample.inflight>=3),'three model admission leases must overlap, not merely three queued jobs');
  const final=await api('GET',`/agents/fleet/${fleet.planId}`);
  assert.equal(final.reports.length,3);
  assert.ok(final.reports.every(r=>r.status==='done'));
  assert.equal(final.awaitingHumanMerge,true);
  assert.ok(!final.mergedArtifactId);
  report.passed=true;
  console.log(`ALL GREEN: three distinct roles overlap ${report.overlap.start} — ${report.overlap.end}`);
} catch(error) {
  report.error=error.stack;process.exitCode=1;console.error(error);
} finally {writeFileSync(output,JSON.stringify(report,null,2));console.log(`Report ${output}`);}
