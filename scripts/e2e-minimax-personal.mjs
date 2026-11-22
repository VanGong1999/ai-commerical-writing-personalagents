#!/usr/bin/env node
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {api,sleep,waitRun} from './e2e-helpers.mjs';

const project=await api('POST','/projects',{title:`E2E-MiniMax-personal-${Date.now()}`,format:'manju',market:'cn'});
const conv=await api('POST','/conversations',{source:'assistant',projectId:project.id,title:'E2E Personal Agent current-project delegation'});
const report={projectId:project.id,conversationId:conv.id,passed:false};
try {
  const response=await fetch(`${process.env.E2E_API_BASE || 'http://127.0.0.1:8000'}/api/v1/conversations/${conv.id}/chat`,{
    method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(240000),
    body:JSON.stringify({projectId:project.id,message:'请在当前项目安排专职同事写一条片名与一句话卖点。林舟重生回公司破产前三天，通过商业谈判阻止合伙人周明侵吞公司。只要标题和logline，实际委派执行，入队后简短汇报即可。'})});
  assert.ok(response.ok);
  const sse=await response.text();
  report.events=sse.split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)));
  assert.ok(!report.events.some(e=>e.event==='error'),JSON.stringify(report.events.at(-1)));
  // 本脚本只批准当前测试项目的任务；不得批准模型误选的其他项目。
  const confirmation=report.events.find(e=>e.event==='confirm');
  if(confirmation) {
    assert.equal(confirmation.args.project_id,project.id);
    report.approval=await api('POST',`/conversations/${conv.id}/respond`,{approve:true});
    assert.ok(!report.approval.toolResult?.code,JSON.stringify(report.approval.toolResult));
  }
  let instances=[];
  const deadline=Date.now()+30000;
  do {
    instances=(await api('GET',`/tasks/instances?includeFinished=true`)).instances
      .filter(r=>r.conversationId===conv.id);
    if(instances.length) break;
    await sleep(1000);
  } while(Date.now()<deadline);
  assert.equal(instances.length,1,'expected exactly one delegated run');
  assert.equal(instances[0].projectId,project.id,'delegation escaped the bound project');
  assert.equal(instances[0].agentId,'topic.logline_title');
  const run=await waitRun(instances[0].runId,'Personal Agent delegated logline');
  assert.match(run.model,/MiniMax/i);
  assert.equal(run.projectId,project.id);
  assert.equal(run.outputArtifactIds.length,1);
  report.run=run;
  report.passed=true;
  console.log(`PASS Personal Agent -> topic.logline_title project=${project.id} run=${run.id}`);
} catch(error) {
  report.error=error.stack;
  console.error(error);
  process.exitCode=1;
} finally {
  writeFileSync('/tmp/xzm-minimax-personal-report.json',JSON.stringify(report,null,2));
}
