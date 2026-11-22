#!/usr/bin/env node
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {api,waitRun} from './e2e-helpers.mjs';
import {createWritingTools} from '../services/agent-worker/src/tools.js';
import {runNestedAgentJob} from '../services/agent-worker/src/runSession.js';

const existingParent = process.env.E2E_PARENT_RUN_ID
  ? await api('GET',`/runs/${process.env.E2E_PARENT_RUN_ID}`) : null;
const project = existingParent ? {id:existingParent.projectId}
  : await api('POST','/projects',{title:`E2E-MiniMax-nested-${Date.now()}`,format:'manju',market:'cn'});
const parent = existingParent || await api('POST','/runs',{projectId:project.id,agentId:'topic.logline_title',
  inputJson:{format:'manju',task:'为重生回破产前三天、谈判阻止夺权的林舟，写一条标题与logline。'}});
await waitRun(parent.id,'nested test parent');
const children=[];
const tools=createWritingTools({projectId:project.id,publish(){},allowlist:['subagent_spawn'],
  spawnNested:async spec=>{
    const child=await runNestedAgentJob({...spec,parentRunId:parent.id,controlRunId:parent.id,
      projectId:project.id,input:{format:'manju',task:spec.task},publish(){}});
    children.push(child);
    return child;
  }});
const spawn=tools.find(t=>t.name==='subagent_spawn');
const output=await spawn.execute('live-nested',{role:'worker',agentId:'topic.logline_title',
  task:'先读 deliver/logline 技能，为《重生破产前夜》写一条片名与一句话卖点。林舟重生回破产前三天，通过谈判阻止合伙人周明夺权。创建一个 logline 候选，执行 Schema、TitleClarityGate 和 done_check。'});
const result=JSON.parse(output.content[0].text);
writeFileSync('/tmp/xzm-minimax-subagent-report.json',JSON.stringify({projectId:project.id,result,children},null,2));
assert.equal(result.ok,true);
assert.equal(result.status,'succeeded');
assert.equal(children.length,1);
assert.equal(result.artifactIds.length,1);
const replay=await api('GET',`/runs/${parent.id}/replay`);
assert.ok(replay.steps.some(s=>s.kind==='tool_call' && s.payload.child_run_id===result.runId &&
  s.payload.name==='skill_read' && JSON.stringify(s.payload.args).includes('deliver/logline')));
const artifacts=await api('GET',`/projects/${project.id}/artifacts`);
assert.equal(artifacts.filter(a=>a.createdByRunId===result.runId && a.type==='logline').length,1);
console.log(`PASS subagent_spawn -> ${result.agentId} ${result.runId} artifacts=1`);
