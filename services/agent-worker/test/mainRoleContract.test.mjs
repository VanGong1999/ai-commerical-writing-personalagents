import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getAgent,loadSkill} from '@xiezuomanju/agent-runtime';
import {api} from '../src/apiClient.js';
import {createWritingTools} from '../src/tools.js';
import {runAgentJob} from '../src/runSession.js';
import {validateArgs} from '../src/toolSchema.js';

const result = async (tool, args) => JSON.parse((await tool.execute('test',args)).content[0].text);
function role(id, stage) {
  const agent=getAgent(id);
  return createWritingTools({projectId:'p', runId:'r', parentAgentId:id, pipelineMember:Boolean(stage),
    pipelineStageId:stage, allowlist:agent.tools, allowedGateNames:[...loadSkill(agent.skillPath).gates,
      ...agent.doneContract.flatMap(c=>c.gates || [])], doneContract:agent.doneContract, publish(){}});
}

test('genre advice reads explicit genre from parameters or a saved field and preserves uncertainty',async t=>{
  const row={id:'a',type:'other',bodyMarkdown:'作者尚未选题。'};
  t.mock.method(api,'listArtifacts',async()=>[row]);
  const gate=role('topic.genre_trim','S0_SETUP').find(t=>t.name==='gate_run');
  assert.doesNotMatch(gate.description+JSON.stringify(gate.parameters),/goldFinger/i);
  assert.match(gate.description,/payload.genre/);
  assert.equal(validateArgs({name:'GenreTrimGate',payload:{body:{genre:['wrong']}}},gate.parameters).ok,false);
  for (const name of ['GenreTrim','GenreTrimGate']) {
    const genre=' 末世诡异 ';
    for(const source of ['saved','body','top']){
      row.bodyJson=source==='saved'?{genre}:{};
      const payload={artifactId:'a',blacklist:['末世','诡异'],...(source==='body'?{body:{genre}}:source==='top'?{genre}:{})};
      const args={name,payload};
      assert.ok(validateArgs(args,gate.parameters).ok);
      const out=await result(gate,args);
      assert.equal(out.checks[0].result,'warn');
      assert.ok(out.checks[0].message.includes(genre));
      assert.match(out.checks[0].message,/末世、诡异/);
    }
    const unknown=await result(gate,{name,payload:{artifactId:'a',text:'末世',body:{genreFinger:'猜测'}}});
    assert.match(unknown.checks[0].message,/未评估.*跳过/);
    assert.equal(unknown.checks[0].result,'warn');
  }
});

test('genre delivery requires Schema on a real readable current-run report',async t=>{
  const row={id:'a',type:'other',title:'题材建议',createdByRunId:'r'};
  t.mock.method(api,'listArtifacts',async()=>[row]);
  const tools=role('topic.genre_trim','S0_SETUP');
  const done=()=>tools.find(t=>t.name==='done_check').execute('done',{});
  const schema=()=>result(tools.find(t=>t.name==='gate_run'),{name:'Schema',payload:{artifactId:'a'}});
  for(const [owner,body,expected] of [['r','',false],['r','# 仅有标题',false],
    ['r','另一标题\n===',false],['r','题材建议\n---',false],['r','---',false],['r','**题材建议**',false],
    ['r','<!-- 内部空壳 -->',false],['r','> **题材建议**',false],['foreign','没有当前榜单数据。',false],['r','作者保留末世题材。本次没有可核实的市场榜单。',true]]){
    row.createdByRunId=owner; row.bodyMarkdown=body;
    assert.equal((await done()).details.ok,false);
    assert.equal((await schema()).passed,expected);
  }
  assert.equal((await done()).details.ok,true);
  row.bodyMarkdown='---';
  row.bodyJson={genre_trim:{summary:'未提供榜单日期。'}};
  assert.equal((await schema()).passed,true);
  const gate=tools.find(t=>t.name==='gate_run');
  assert.equal((await result(gate,{name:'GenreTrimGate',payload:{genre:'末世',blacklist:['末世']}})).advisory,true);
  assert.equal((await done()).details.ok,true);
});

test('genre Schema and done use rendered report text, including HTML paragraphs and literal code',async t=>{
  const row={id:'a',createdByRunId:'r',type:'other',title:'题材 & 建议'};
  t.mock.method(api,'listArtifacts',async()=>[row]);
  for(const [body,expected] of [
    ['&#32;',false],['&emsp;',false],['**题材 &amp; 建议**',false],
    ['<div><h2>独立标题</h2><!-- 注释 --><p>&emsp;</p></div>',false],
    ['<div><b>题材</b> &amp; 建议</div>',false],['<div hidden>隐藏内容</div>',false],
    ['<p>作者尚未指定题材。</p>',true],['<p><b>未</b>定。</p>',true],
    ['`&#32;`',true],['```\n&emsp;\n```',true],
  ]) await t.test(JSON.stringify(body),async()=>{
    row.bodyMarkdown=body;
    const tools=role('topic.genre_trim','S0_SETUP');
    const check=await result(tools.find(tool=>tool.name==='gate_run'),{name:'Schema',payload:{artifactId:'a'}});
    assert.equal(check.passed,expected,body);
    assert.equal((await tools.find(tool=>tool.name==='done_check').execute('done',{})).details.ok,expected,body);
  });
});

test('genre role can deliver through artifact_create and Schema with optional advice skipped',async t=>{
  const rows=[];
  t.mock.method(api,'listArtifacts',async()=>rows);
  t.mock.method(api,'createArtifact',async(projectId,body)=>{
    const saved={...body,projectId,id:'report',version:1};
    rows.push(saved);
    return saved;
  });
  const tools=role('topic.genre_trim','S0_SETUP');
  const call=(name,args)=>result(tools.find(tool=>tool.name===name),args);
  const done=()=>tools.find(tool=>tool.name==='done_check').execute('done',{});
  const written=await call('artifact_create',{title:'题材参考',type:'other',bodyMarkdown:'作者保留末世题材，榜单日期尚待核实。'});
  assert.equal(written.id,'report');
  assert.equal(rows[0].createdByRunId,'r');
  const duplicate=await call('artifact_create',{title:'题材参考',type:'other',bodyMarkdown:'新增材料改变了题材结论。'});
  assert.equal(duplicate.error,'artifact_revision_required');
  assert.doesNotMatch(duplicate.message,/artifact_update/);
  assert.match(duplicate.message,/Schema/);
  assert.equal((await done()).details.ok,false);
  assert.equal((await call('gate_run',{name:'Schema',payload:{artifactId:written.id}})).passed,true);
  assert.equal((await done()).details.ok,true);
});

test('pipeline role discovery and indirect invoke respect the narrow scope',async()=>{
  for(const id of ['orch.writing','topic.genre_trim']){
    const tools=role(id,'S0_SETUP');
    const search=tools.find(t=>t.name==='tool_search');
    const invoke=tools._allGated.find(t=>t.name==='tool_invoke');
    for(const name of ['kb_search','fs_ls','memory_search','job_enqueue','subagent_spawn']){
      assert.ok(!tools._callableSet.has(name),id+' '+name);
      assert.ok(!(await result(search,{query:name})).load.includes(name));
      const schema=tools._allGated.find(tool=>tool.name==='tool_schema_get');
      assert.equal((await result(schema,{name})).error,'tool_not_found');
      assert.equal((await result(invoke,{name,args:{path:'/kb'}})).error,'tool_not_allowed');
    }
  }
  const standalone=role('orch.writing');
  assert.ok(standalone._callableSet.has('subagent_spawn'));
  assert.ok(standalone._callableSet.has('job_enqueue'));
});

test('worker S0 presents the stage, proves format and chunk, and delivers without a new artifact',async t=>{
  for(const key of Object.keys(api)) if(typeof api[key]==='function') t.mock.method(api,key,async()=>[]);
  const oldRoot=process.env.AGENT_SESSION_ROOT;
  const root=mkdtempSync(join(tmpdir(),'s0-contract-'));
  process.env.AGENT_SESSION_ROOT=root;
  t.after(()=>{if(oldRoot===undefined) delete process.env.AGENT_SESSION_ROOT; else process.env.AGENT_SESSION_ROOT=oldRoot;rmSync(root,{recursive:true,force:true});});
  api.getProject=async()=>({id:'p',format:'manju',progress:{}});
  const requests=[];
  api.agentChat=async ({messages,tools})=>{
    requests.push({prompt:messages.slice(0,2).map(m=>m.content).join('\n'),names:tools.map(x=>x.function.name)});
    const calls=requests.length===1?[['fmt','gate_run',{name:'FormatSelected'}],['chunk','gate_run',{name:'ChunkPolicy'}]]:
      requests.length===2?[['done','done_check',{}]]:[];
    return {choices:[{finish_reason:calls.length?'tool_calls':'stop',message:calls.length?
      {tool_calls:calls.map(([id,name,args])=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}}))}:{content:'格式与单块范围已确认。'}}]};
  };
  const r=await runAgentJob({job:{id:'j',projectId:'p',payload:{maxTurns:4}},run:{id:'r',agentId:'orch.writing',
    inputJson:{format:'manju',pipelineExecutionId:'group',pipelineStageId:'S0_SETUP'}},publish(){}});
  assert.equal(r.status,'succeeded');
  assert.deepEqual(r.artifactIds,[]);
  assert.ok(requests.length >= 2);
  assert.deepEqual(requests[0].names.sort(),['done_check','gate_run','project_get','skill_read','tool_search']);
  assert.match(requests[0].prompt,/群流程.*S0_SETUP/);
  assert.doesNotMatch(requests[0].prompt,/请完成任务：创建候选产物/);
  for(const id of ['ChunkPolicy','FormatSelected']) assert.ok(r.receipt.gateResults.some(g=>g.id===id && g.result==='pass'));
});

test('genre job repairs a missing Schema by reading the existing report and never creates another',async t=>{
  for(const key of Object.keys(api)) if(typeof api[key]==='function') t.mock.method(api,key,async()=>[]);
  const oldRoot=process.env.AGENT_SESSION_ROOT;
  const root=mkdtempSync(join(tmpdir(),'genre-contract-'));
  process.env.AGENT_SESSION_ROOT=root;
  t.after(()=>{if(oldRoot===undefined) delete process.env.AGENT_SESSION_ROOT; else process.env.AGENT_SESSION_ROOT=oldRoot;
    rmSync(root,{recursive:true,force:true});});
  const row={id:'prior',createdByRunId:'genre',projectId:'p',type:'other',version:1,title:'题材建议',bodyMarkdown:'本月榜单没有可核实的日期。'};
  api.listArtifacts=async()=>[row];
  const requests=[];
  api.agentChat=async ({messages})=>{
    requests.push(messages.map(m=>({...m})));
    const calls=[[],[['inspect','artifact_list',{artifactId:row.id,full:true}]],
      [['schema','gate_run',{name:'Schema',payload:{artifactId:row.id}}]],[['done','done_check',{}]]];
    const current=calls[requests.length-1] || [];
    return {choices:[{finish_reason:current.length?'tool_calls':'stop',message:current.length?
      {tool_calls:current.map(([id,name,args])=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}}))}:
      {content:'题材报告已经保存。'}}]};
  };
  const r=await runAgentJob({job:{id:'gj',projectId:'p',payload:{maxTurns:6}},run:{id:'genre',agentId:'topic.genre_trim',
    inputJson:{format:'manju',pipelineExecutionId:'group',pipelineStageId:'S0_SETUP'}},publish(){}});
  assert.equal(r.status,'succeeded');
  assert.deepEqual(r.artifactIds,[row.id]);
  assert.equal(api.createArtifact.mock.callCount(),0);
  assert.ok(requests.slice(2).flat().some(m=>m.role==='tool' && m.content.includes(row.bodyMarkdown)));
  assert.ok(r.receipt.gateResults.some(g=>g.id==='Schema' && g.result==='pass'));
  for(const prompt of [requests[0][1].content, requests[1].at(-1).content]){
    assert.match(prompt,/artifact_list/);
    assert.match(prompt,/Schema/);
    assert.match(prompt,/仅.*artifact_create/);
    assert.doesNotMatch(prompt,/请继续调用 artifact.create 补齐|请完成任务：创建候选产物/);
  }
});

test('served role skills match the source branch and optional advice',()=>{
  const catalog=JSON.parse(readFileSync(new URL('../../../packages/agent-runtime/skills/catalog.json',import.meta.url)));
  for(const [id,pattern] of [['topic.genre_trim',/可选.*GenreTrim/],['orch.writing',/pipelineStageId/]]){
    const skill=loadSkill(getAgent(id).skillPath);
    const served=catalog.skills.find(entry=>entry.name===skill.name);
    assert.equal(served.body,skill.body);assert.deepEqual(served.gates,skill.gates);
    assert.match(served.body,pattern);
  }
});
