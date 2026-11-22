import {checkSavedScene} from '../packages/agent-runtime/src/gates.extended.ts';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {api, sleep} from './e2e-helpers.mjs';

const [scenario, file] = process.argv.slice(2);
const plan = {
  manju: ['struct.episode_outline', 'prose.episode_body'],
  duanju: ['struct.ep_outline_duanju', 'scene.triple'],
  ip_adapt: ['struct.episode_outline', 'prose.episode_body'],
  short_novel: ['struct.chapter_outline', 'prose.novel_body'],
  male_long: ['struct.chapter_outline', 'prose.novel_body'],
  female_long: ['struct.chapter_outline', 'prose.novel_body'],
};
const nested = ['single','parallel','nested-failure','nested-cancel'].includes(scenario);
assert.ok(file && (nested || Object.hasOwn(plan,scenario)), 'usage: node scripts/e2e-minimax-live.mjs FORMAT|single|parallel|nested-failure|nested-cancel REPORT.json');
const base = process.env.E2E_API_BASE || 'http://127.0.0.1:8001';
// Exclusive per-report lease prevents two resumptions from submitting the same step.
const lease=file+'.lock';
// SQLite releases its writer lock on process death and serializes stale PID recovery.
const ownership=new DatabaseSync(lease+'.sqlite');
ownership.exec('BEGIN IMMEDIATE');
if (existsSync(lease)) {
  const pid=Number(readFileSync(lease,'utf8'));
  assert.ok(Number.isSafeInteger(pid) && pid>0,'invalid report owner PID');
  try {
    process.kill(pid,0);
    throw Error('report already owned by PID '+pid);
  } catch (error) {
    if (error.code!=='ESRCH') throw error;
  }
  unlinkSync(lease);
}
writeFileSync(lease,String(process.pid),{flag:'wx',mode:0o600});
process.on('exit',()=>{try {unlinkSync(lease);} finally {ownership.close();}});
const readController=new AbortController();
let interrupted;
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{interrupted ||= signal; readController.abort(Error('interrupted by '+signal));});
function checkSignal() {
  if (interrupted) throw Error('interrupted by '+interrupted);
}
const state = existsSync(file) ? JSON.parse(readFileSync(file)) : {base,scenario,steps:{}};
assert.equal(state.base,base);
assert.equal(state.scenario,scenario);
const format = nested ? 'manju' : scenario;
const call = (method,path,body) => {
  checkSignal();
  return api(method,path,body,base,method==='GET' ? {signal:readController.signal} : {});
};
function save() {
  writeFileSync(file+'.tmp',JSON.stringify(state,null,2), {mode:0o600});
  renameSync(file+'.tmp',file);
}
async function create(key,path,body) {
  checkSignal();
  const step = state.steps[key] ||= {};
  if (!step.id) {
    assert.ok(!step.submittedAt,'ambiguous write: reconcile '+key+' before resuming');
    step.submittedAt = Date.now();
    save();
    const result = await call('POST',path,body);
    assert.ok(result.id);
    step.id=result.id;
    save();
  }
  return step;
}
const terminal = new Set(['succeeded','failed','cancelled','dead']);
function childStates(step,replay) {
  const children = step.observedChildren ||= {};
  for(const id of [step.childAtCancel,...(step.children||[]).map(c=>c.runId)]) {
    if(id) children[id] ||= {id};
  }
  for (const event of replay.steps) {
    const id=event.payload?.child_run_id;
    if (!id) continue;
    const row=children[id] ||= {id};
    row.lastEvent=event.kind;
    if (event.kind==='run_end' && terminal.has(event.payload.status)) row.status=event.payload.status;
  }
  return children;
}
async function stopOnce(step, request) {
  if (step.stopIntent || step.cancelRequested) return;
  step.stopIntent={at:Date.now()};
  save();
  await request('POST','/tasks/runs/'+step.id+'/stop');
  step.stopIntent.responded=true;
  save();
}
async function reconcile(step) {
  childStates(step,{steps:[]});
  const until=Date.now()+30000;
  const request=(method,path)=>api(method,path,undefined,base,{retry:false,timeoutMs:Math.max(1,Math.min(3000,until-Date.now()))});
  let parentTerminal=false, verified=false;
  do {
    try {
      const parent=await request('GET','/runs/'+step.id);
      step.status=parent.status;
      parentTerminal=terminal.has(step.status);
    } catch(e) {step.cleanupReadError=e.message;}
    if (!parentTerminal) {
      try {await stopOnce(step,request);} catch(e) {step.stopError=e.message;}
    }
    try {
      const replay=await request('GET','/runs/'+step.id+'/replay');
      step.lastEvent=replay.steps.at(-1)?.kind;
      step.observedChildren=childStates(step,replay);
      verified=parentTerminal && Object.values(step.observedChildren).every(c=>terminal.has(c.status));
    } catch(e) {step.cleanupReplayError=e.message;}
    step.unresolvedIds=verified ? [] : [step.id,...Object.values(step.observedChildren||{}).filter(c=>!c.status).map(c=>c.id)];
    save();
    if (!verified && Date.now()<until) await sleep(500);
  } while (!verified && Date.now()<until);
}
function actualUsage(rows,id) {
  const usage=rows.filter(u=>u.runId===id).map(({model,promptTokens,completionTokens,durationMs})=>({model,promptTokens,completionTokens,durationMs}));
  assert.ok(usage.length, 'missing actual usage rows for '+id);
  for (const event of usage) assert.match(event.model,/minimax/i);
  return usage;
}
let catalog;
async function run(key,agentId,task,input={}) {
  catalog ||= (await call('GET','/agents/catalog')).agents;
  const supported=catalog.find(a=>a.id===agentId)?.formats || [];
  assert.ok(supported.includes('*') || supported.includes(format),agentId+' does not support '+format);
  const step = await create(key,'/runs',{projectId:state.projectId,agentId,inputJson:{
    format,task,...(plan[format]?.[0].includes("chapter") ? {chapterNo:1,chapter_no:1} : {episodeNo:1,ep_no:1}),...input,
  }});
  const timeout=Number(process.env.E2E_RUN_TIMEOUT_MS || 480000);
  let result;
  while (true) {
    result=await call('GET','/runs/'+step.id);
    step.status=result.status;
    save();
    if (terminal.has(result.status)) break;
    if (scenario==='nested-cancel' && !step.stopIntent && !step.cancelRequested) {
      const replay=await call('GET','/runs/'+step.id+'/replay');
      childStates(step,replay);
      save();
      const child=replay.steps.find(s=>s.kind==='model_call' && s.actor==='agent:topic.logline_title' && s.payload?.child_run_id);
      if (child) {
        step.childAtCancel=child.payload.child_run_id;
        await stopOnce(step,call);
      }
    }
    if (Date.now()-step.submittedAt >= timeout) {
      throw Error('deadline reached '+step.id);
    }
    await sleep(2500);
  }
  const {status,model,createdAt,finishedAt,tokenPrompt,tokenCompletion,gateResults}=result;
  Object.assign(step,{status,model,createdAt,finishedAt,tokenPrompt,tokenCompletion,gateResults});
  let replay=await call('GET','/runs/'+step.id+'/replay');
  const cancelledChild = steps => steps.find(s=>s.payload?.child_run_id===step.childAtCancel &&
    s.kind==='run_end' && s.payload.status==='cancelled');
  if (scenario==='nested-cancel' && (step.stopIntent || step.cancelRequested)) {
    childStates(step,replay);
    const until=Date.now()+30000;
    while (!cancelledChild(replay.steps) && Date.now()<until) {
      await sleep(1000);
      replay=await call('GET','/runs/'+step.id+'/replay');
      childStates(step,replay);
      save();
    }
  }
  step.exitReason=replay.steps.filter(s=>s.kind==='receipt' && !s.payload?.child_run_id).at(-1)?.payload?.exitReason;
  step.lastEvent=replay.steps.at(-1)?.kind;
  step.observedChildren=childStates(step,replay);
  const usageRows=await call('GET','/usage?project_id='+state.projectId);
  step.usage=actualUsage(usageRows,step.id);
  save();
  if (scenario==='nested-cancel') {
    assert.equal(status,'cancelled');
    assert.ok(replay.steps.some(s=>s.kind==='model_call' && s.actor==='agent:topic.logline_title' && s.payload?.child_run_id===step.childAtCancel),'missing child inference');
    assert.ok(step.childAtCancel && cancelledChild(replay.steps),'missing nested cancellation evidence');
    step.childCancelEvidence=step.observedChildren[step.childAtCancel];
    step.childCancelEvidence.usage=actualUsage(usageRows,step.childAtCancel);
    save();
    return {step,replay};
  }
  if (scenario!=='nested-failure') assert.equal(status,'succeeded',key+' '+step.id);
  if(model) assert.match(model,/minimax/i);
  return {step,replay};
}
async function main() {
  let source;
  if (!nested) {
    const docs = {male_long:'7c625e67-83ec-494c-82e2-f37137f06b38',female_long:'aec30d3e-b03c-48b8-8559-f6f938a42885',ip_adapt:'aaca71da-833e-4934-aae0-ed6affde8a7c'};
    if (process.env.E2E_SOURCE_FILE) {
      source=readFileSync(process.env.E2E_SOURCE_FILE,'utf8').trim().slice(0,1800);
    } else if (docs[format]) {
      state.sourceDocId=docs[format];
      source=(await call('GET','/kb/docs/'+docs[format]+'/text?limit=1800')).text;
    } else {
      const samples=JSON.parse(readFileSync(new URL('../.xzm/studio-loop-samples.json',import.meta.url)));
      const pid=samples.find(s=>s.format===format).projectId;
      const rows=await call('GET','/projects/'+pid+'/artifacts');
      const a=rows.find(a=>a.id===state.sourceArtifactId) || rows.find(a=>a.bodyMarkdown?.length>=80 && ['manuscript','scene','core_hook'].includes(a.type));
      assert.ok(a,'no eligible local source');
      state.sourceArtifactId=a.id;
      source=a.bodyMarkdown.slice(0,1800);
    }
    assert.ok(source.length>=80,'source too short');
    const digest=createHash('sha256').update(source).digest('hex');
    if (state.sourceHash) assert.equal(state.sourceHash,digest);
    Object.assign(state,{sourceHash:digest,sourceFile:process.env.E2E_SOURCE_FILE});
  }
  const project=await create('project','/projects',{title:'MiniMax验收-'+scenario+'-'+Date.now(),format,market:'cn'});
  state.projectId=project.id;
  save();
  if (nested) {
    const count=scenario==='parallel'?2:1;
    const task='必须使用 tool_search 查找 subagent_spawn 并实际调用，必须在调用参数中明确传 role=worker 和 agentId="topic.logline_title"，'+(count===2?'用 mode=parallel 和两个 tasks，分别':'以单项任务')+'为重生谈判阻止公司破产的故事创作片名和一句话卖点，每个子任务创建一条 logline 并完成门禁。完成后检查父任务门禁。';
    const {step,replay}=await run('parent','orch.writing',scenario==='nested-failure' ? '使用 subagent_spawn，指定 role=worker，agentId=e2e.missing_agent，任务为检查不存在的岗位。子任务失败立即报告错误，禁止替换岗位或重试。' : task);
    const calls=replay.steps.filter(s=>s.kind==='tool_call' && !s.payload.child_run_id);
    const spawn=calls.find(s=>s.payload.name==='subagent_spawn' && (count===1 || s.payload.args?.mode==='parallel'));
    assert.ok(spawn,'missing parent model spawn');
    if (scenario==='nested-cancel') assert.equal(spawn.payload.args?.agentId,'topic.logline_title','wrong cancellation target');
    if (scenario==='nested-cancel') {state.status='passed'; delete state.error; save(); return;}
    const output=replay.steps.find(s=>s.kind==='tool_result' && s.payload.id===spawn.payload.id);
    assert.ok(output,'missing parent spawn result');
    const result=JSON.parse(output.payload.result);
    if (scenario==='nested-failure') {
      assert.equal(result.ok,false,'child failure must be surfaced');
      assert.equal(spawn.payload.args.agentId,'e2e.missing_agent');
      assert.equal(result.error,'nested_failed');
      assert.match(result.message,/e2e\.missing_agent/);
      assert.ok(['failed','dead'].includes(step.status),'parent did not propagate failure');
      assert.ok(!replay.steps.some(s=>s.payload?.child_run_id && s.kind==='model_call'),'invalid child unexpectedly entered inference');
      step.failureEvidence={callId:spawn.payload.id,attemptedAgent:spawn.payload.args.agentId,parentStatus:step.status,childError:result.message,preInference:true};
      checkSignal();
  state.status='passed';
      delete state.error;
      save();
      return;
    }
    assert.equal(result.ok,true);
    const children=result.results || [result];
    assert.equal(new Set(children.map(c=>c.runId)).size,count);
    const artifacts=await call('GET','/projects/'+project.id+'/artifacts');
    step.children=children.map(c=>({runId:c.runId,status:c.status,exitReason:c.exitReason,artifactIds:c.artifactIds}));
    save();
    const intervals=[];
    for (const c of children) {
      assert.equal(c.status,'succeeded');
      const childSteps=replay.steps.filter(s=>s.payload?.child_run_id===c.runId);
      assert.ok(childSteps.some(s=>s.kind==='model_call'));
      const start=childSteps.find(s=>s.kind==='model_call')?.createdAt;
      const end=childSteps.find(s=>s.kind==='run_end')?.createdAt;
      intervals.push([Date.parse(start),Date.parse(end)]);
      const childUsage=actualUsage(await call('GET','/usage?project_id='+project.id),c.runId);
      assert.equal(step.observedChildren[c.runId]?.status,'succeeded');
      step.children.find(row=>row.runId===c.runId).usage=childUsage;
      save();
      assert.ok(artifacts.some(a=>a.createdByRunId===c.runId && a.type==='logline' && c.artifactIds.includes(a.id)));
    }
    if (count===2) assert.ok(Math.max(...intervals.map(i=>i[0]))<Math.min(...intervals.map(i=>i[1])),'child executions did not overlap');
  } else {
    const prefix='/projects/'+project.id;
    const topics={manju:'topic.logline_title',duanju:'topic.want_how',short_novel:'topic.logline_title',male_long:'male.opening',female_long:'struct.chase_wife',ip_adapt:'ip.select_score'};
    const topicTypes={manju:'logline',duanju:'topic_card',short_novel:'logline',male_long:'opening_hook',female_long:'chase_wife_pentalogy',ip_adapt:'select_score'};
    const outlineType=plan[format][0]==='struct.chapter_outline' ? 'chapter_outline' : 'episode_outline';
    const agents=[['topic',topics[format]],['character',format==='manju'?'char.bio_manju':'char.bible_big5'],['structure',plan[format][0]],['body',plan[format][1]],['qc','qc.de_ai']];
    for (const [key,agent] of agents) {
      if(key==='qc') {
        const qc=state.steps.qc ||= {};
        const candidates=state.steps.body.artifacts;
        const id=process.env.E2E_BODY_ARTIFACT_ID || qc.reviewTarget?.id || (candidates.length===1 && candidates[0].id);
        const selected=candidates.find(a=>a.id===id);
        assert.ok(selected,'Select E2E_BODY_ARTIFACT_ID from '+candidates.map(a=>a.id).join(', '));
        if(!qc.reviewTarget) {
          assert.ok(!qc.id && !qc.submittedAt,'QC_TARGET_VERSION_UNKNOWN: prior QC has no pre-submission version; retain it and run a fresh QC');
          qc.reviewTarget={id:selected.id,version:selected.version};
          save();
        }
        assert.ok(qc.reviewTarget.id===selected.id && qc.reviewTarget.version===selected.version,'QC_VERSION_DRIFT: selected body changed before QC or resume');
      }
      const previous=key==='qc' ? [state.steps.qc.reviewTarget.id] : agents.slice(0,agents.findIndex(([label])=>label===key)).flatMap(([label])=>state.steps[label]?.artifacts || []).map(a=>a.id);
      const instruction = {topic:'根据所给素材确定选题或作 IP 评估，创建本岗位要求的选题产物。',character:'写一个主角人物卡并写入人物记忆。',structure:'按岗位结构契约完成大纲，为第一章或第一集提供目标、冲突和钩子。',body:agent==='scene.triple'?'仅写第一集，用同一地点的一场戏讲完可独立观看的完整一集。把含动作、对白、转折和收束的完整剧本正文写入 bodyJson.script_body，至少800个汉字。摘要或批注不能替代正文；bodyMarkdown 可以同步呈现这份剧本。':plan[format][0].includes('chapter')?'仅写第一章，不续写后续。':'仅写第一集，不续写后续。',qc:'只审校指定正文，不改稿，不新建任何产物。执行 gate_run DeAIChecklist，payload 仅传给定正文 artifactId；不传 text。'}[key];
      const {step,replay}=await run(key,agent,key==='qc' ? instruction+' 唯一审校对象 '+previous[0] : instruction+'从素材提取冲突并原创，勿照抄。阅读前序产物 '+previous.join(',')+'。素材：'+source, key==='qc' ? {selectedBodyId:previous[0]} : {});
      const projectArts=await call('GET',prefix+'/artifacts');
      const arts=projectArts.filter(a=>a.createdByRunId===step.id);
      step.artifacts=arts.map(a=>({id:a.id,type:a.type,version:a.version}));
      save();
      if(key==='qc') {
        assert.equal(projectArts.find(a=>a.id===step.reviewTarget.id)?.version,step.reviewTarget.version,'QC_VERSION_DRIFT: body changed during QC');
        const targets=new Set([step.reviewTarget.id]);
        const calls=replay.steps.filter(s=>s.kind==='tool_call' && s.payload.name==='gate_run' &&
          s.payload.args?.name==='DeAIChecklist' && targets.has(s.payload.args.payload?.artifactId) &&
          !s.payload.args.payload.text);
        step.checkedBodies=[];
        for (const event of calls) {
          const result=replay.steps.find(s=>s.kind==='tool_result' && s.payload.id===event.payload.id && s.payload.name==='gate_run');
          if (!result) continue;
          const verdict=JSON.parse(result.payload.result);
          if (verdict.passed && verdict.checks?.some(g=>g.id==='deai_checklist' && g.result==='pass')) {
            step.checkedBodies.push({id:event.payload.args.payload.artifactId,version:step.reviewTarget.version,callId:event.payload.id});
          }
        }
        save();
        assert.ok([...targets].every(id=>step.checkedBodies.some(b=>b.id===id)),'missing matched QC result for qualifying body');
      } else {
        const expected={topic:topicTypes[format],character:'character',structure:outlineType,body:agent==='scene.triple'?'scene':'manuscript'}[key];
        const qualifying=arts.filter(a=>{
          if(a.type!==expected) return false;
          if(a.type==='scene') return checkSavedScene(a.bodyJson).result==='pass';
          if(a.type==='manuscript') return a.bodyMarkdown?.trim().length>=300;
          return Math.max(a.bodyMarkdown?.trim().length||0,JSON.stringify(a.bodyJson||{}).length)>30;
        });
        step.artifacts=qualifying.map(({id,type,version})=>({id,type,version}));
        save();
        assert.ok(qualifying.length,key+' qualifying '+expected+' missing');
      }
    }
    const artifacts=await call('GET',prefix+'/artifacts');
    const versions=Object.fromEntries(artifacts.map(a=>[a.id,a.version]).sort(([a],[b])=>a.localeCompare(b)));
    const reviewed=state.steps.qc.reviewTarget;
    assert.equal(versions[reviewed.id],reviewed.version,'QC_VERSION_DRIFT: approval manifest differs from checked version');
    const token=project.id+'-'+createHash('sha256').update(JSON.stringify(versions)).digest('hex').slice(0,16);
    state.reviewToken=token;
    save();
    if (state.approvedToken!==token) {
      assert.equal(process.env.E2E_REVIEW_APPROVAL,token,'REVIEW_REQUIRED: review project artifacts then supply exact token '+token);
      state.approvedToken=token;
      save();
    }
    const fresh=await call('GET',prefix);
    if (!fresh.progress?.logicAck || JSON.stringify(Object.entries(fresh.progress.logicAckVersions||{}).sort())!==JSON.stringify(Object.entries(versions).sort())) {
      assert.notEqual(state.ackIntent?.token,token,'unconfirmed prior approval: reconcile before resubmitting');
      state.ackIntent={token,versions,at:Date.now()};
      save();
      const ack=await call('POST',prefix+'/logic-ack',{expectedVersions:versions});
      assert.equal(ack.logicAck,true);
    }
    const confirmed=await call('GET',prefix);
    assert.equal(confirmed.progress.logicAck,true);
    assert.deepEqual(confirmed.progress.logicAckVersions,versions);
    state.approvalEvidence={token,versions,confirmedAt:confirmed.progress.logicAckAt};
    save();
    for(const a of state.steps.body.artifacts) {
      const history=await call('GET',prefix+'/artifacts/'+a.id+'/versions');
      const current=await call('GET','/context/artifacts/'+a.id+'/text');
      assert.equal(current.projectId,state.projectId);
      assert.equal(current.version,versions[a.id],'current saved version changed after approval');
      assert.ok(current.text?.trim(),'missing current saved text');
      assert.ok(history.every(v=>Number.isInteger(v.version) && v.version>0 && v.version<=current.version),'unexpected historical snapshot version');
      (state.savedBodyVersions ||= {})[a.id]={current:current.version,historical:history.map(v=>v.version)};
    }
  }
  checkSignal();
  state.status='passed';
  delete state.error;
  save();
}
main().catch(async error=>{
  state.status='blocked';
  state.error=error.message;
  save();
  for (const [key,step] of Object.entries(state.steps)) {
    if (key!=='project' && step.id && (!terminal.has(step.status) || step.stopIntent || step.cancelRequested || (nested && key==='parent'))) await reconcile(step);
  }
  console.error(error.message);
  process.exitCode=1;
});
