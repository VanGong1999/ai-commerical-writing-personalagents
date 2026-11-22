#!/usr/bin/env node
// Real-provider collaboration regression. Fail on missing evidence, not just failed HTTP.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {api, sleep, waitRun} from './e2e-helpers.mjs';

const timeout = Number(process.env.E2E_RUN_TIMEOUT_MS || 360000);
const report = {provider: null, projects: [], fleets: [], runs: [], passed: false};
const output = process.env.E2E_REPORT || '/tmp/xzm-minimax-colleagues-report.json';
const brief = '《重生破产前夜》：林舟重生回公司破产前三天，阻止合伙人周明侵吞公司。';

async function evidence(projectId, runId, agentId, type, skill) {
  const run = await waitRun(runId, agentId, timeout);
  assert.match(run.model, /MiniMax/i);
  const replay = await api('GET', `/runs/${runId}/replay`);
  const calls = replay.steps.filter(s => s.kind === 'tool_call' && !s.payload.child_run_id).map(s => s.payload);
  const artifacts = (await api('GET', `/projects/${projectId}/artifacts`))
    .filter(a => a.createdByRunId === runId);
  assert.equal(artifacts.length, 1, `${agentId}: missing or repeated candidate`);
  assert.equal(artifacts[0].type, type);
  assert.ok(calls.some(c => c.name === 'skill_read' &&
    String(c.args.relativePath || c.args.ref || c.args.name || '').includes(skill)), 'active skill was not read');
  assert.ok(calls.some(c => c.name === 'done_check'), 'missing completion check');
  assert.ok(calls.some(c => c.name === 'gate_run' && c.args.name === 'Schema'), 'missing schema gate');
  if (type === 'character') {
    assert.ok(calls.some(c => c.name === 'bible_write'), 'missing character memory');
    const wrongCalls = calls.filter(c => c.name === 'gate_run' && /Length|SceneCount/.test(c.args.name));
    for(const call of wrongCalls) {
      const result = replay.steps.find(s => s.kind === 'tool_result' && s.payload.id === call.id);
      assert.match(result?.payload.result || '', /gate_not_applicable|invalid_args/, 'biography executed prose gate');
    }
  }
  const row = {runId, agentId, model:run.model, status:run.status,
    artifactIds:artifacts.map(a => a.id), calls:calls.map(c => c.name),
    startedAt:run.startedAt, finishedAt:run.finishedAt};
  report.runs.push(row);
  console.log(`PASS ${agentId} ${runId} artifacts=1 calls=${calls.length}`);
  return run;
}

async function fleetCase(mode) {
  const reused = mode === 'union' && process.env.E2E_REUSE_UNION_FLEET
    ? await api('GET',`/agents/fleet/${process.env.E2E_REUSE_UNION_FLEET}`) : null;
  const project = reused ? await api('GET',`/projects/${reused.projectId}`)
    : await api('POST', '/projects', {title:`E2E-MiniMax-${mode}-${Date.now()}`,format:'manju',market:'cn'});
  report.projects.push(project.id);
  const specs = mode === 'union' ? [
    ['选题同事','topic.logline_title','logline','deliver/logline','写一条片名与一句话卖点。'],
    ['主角同事','char.bio_manju','character','manju/bio','只写主角林舟小传。'],
    ['配角同事','char.bio_manju','character','manju/bio','只写对手周明小传。'],
  ] : [
    ['选题同事','topic.logline_title','logline','deliver/logline','写一条片名与一句话卖点。'],
    ['人设同事','char.bio_manju','character','manju/bio','先读取 fleetUpstream 中的产物，再只写主角林舟小传。'],
  ];
  const fleet = reused ? {fleetId:reused.planId,jobs:reused.reports} : await api('POST', '/agents/fleet', {projectId:project.id, mode, mergePolicy:'human',
    members:specs.map(([name,agentId,,,task]) => ({name,agentId,task:brief+task+'先读专职技能，不写正文，仅创建一个候选。'}))});
  report.fleets.push({id:fleet.fleetId,mode,projectId:project.id});
  const runs = await Promise.all(specs.map((s,i) => evidence(project.id,fleet.jobs[i].runId,...s.slice(1,4))));
  const deadline = Date.now()+15000;
  let state;
  do {
    state = await api('GET', `/agents/fleet/${fleet.fleetId}`);
    if(state.reports.every(r => r.status === 'done')) break;
    await sleep(500);
  } while(Date.now()<deadline);
  assert.ok(state.reports.every(r => r.status === 'done'), 'fleet members did not all complete');
  assert.equal(state.awaitingHumanMerge,true);
  assert.ok(!state.mergedArtifactId,'human confirmation was bypassed');
  if(mode === 'ordered') {
    assert.equal(runs[1].inputJson.fleetUpstream[0].runId,runs[0].id);
    assert.deepEqual(runs[1].inputJson.fleetUpstream[0].artifactIds,runs[0].outputArtifactIds);
    const replay = await api('GET', `/runs/${runs[1].id}/replay`);
    const firstEnd = await api('GET', `/runs/${runs[0].id}/replay`);
    assert.ok(replay.steps.find(s=>s.kind==='model_call').createdAt >=
      firstEnd.steps.find(s=>s.kind==='run_end').createdAt, 'ordered members overlapped');
  } else {
    const intervals = await Promise.all(runs.map(r=>api('GET',`/runs/${r.id}/replay`)));
    const start = intervals.map(r=>r.steps.find(s=>s.kind==='model_call').createdAt);
    const end = intervals.map(r=>r.steps.find(s=>s.kind==='run_end').createdAt);
    assert.ok(start.some((s,i)=>start.some((other,j)=>i!==j && s<end[j] && other<end[i])),
      'no two colleagues executed concurrently');
  }
  console.log(`PASS fleet ${mode} ${fleet.fleetId}`);
}

try {
  const providers = await api('GET','/settings/providers');
  report.provider = providers.find(p=>p.isDefault)?.selectedModel;
  assert.match(report.provider,/MiniMax/i);
  await fleetCase('union');
  await fleetCase('ordered');
  report.passed = true;
  console.log('ALL GREEN minimax-colleagues');
} catch(error) {
  report.error = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  writeFileSync(output,JSON.stringify(report,null,2));
  console.log(`Report: ${output}`);
}
