import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {intents} from './e2e-capabilities-minimax-fixtures.mjs';
import {readFileSync} from 'node:fs';
const read=path=>JSON.parse(readFileSync(path,'utf8'));

const skills={
  '_meta':'以 qc.de_ai 为目标岗位，为“核对审校证据与原稿版本”起草新技能，含 YAML、角色、输入、步骤、输出、硬约束与自检。',
  'feishu/im-file-send':'文件 /missing/receipt-test.pdf 不存在，目标会话未获授权。描述操作结果，给出中文错误及 ok 字段。',
  'feishu/toolkit':'修改明早九点的日历事件标题为“核稿”。未提供日历或事件 ID。给出模块、动作和处理结果。'
};
const distractors={web_search:['kb_search','memory_search','tool_search'],ab_pingpong_detect:['voice_diversity_score','speak_aloud_lint','line_split_attitude_info_subtext'],prompt_validate_lock:['prompt_render','prompt_4part_build']};
const order=s=>createHash('sha256').update(s).digest('hex');
export function candidates(row,rows){
  const all=rows.filter(r=>r.phase===row.phase && r.spec.schema && r.key!==row.key);
  function rank(r){
    if(distractors[row.id]?.includes(r.id)) return 4;
    if(row.id.split('_').some(p=>r.id.split('_').includes(p)))return 3;
    if(row.spec.entry?.category && r.spec.entry?.category===row.spec.entry.category)return 2;
    return 1;
  }
  const near=all.sort((a,b)=>rank(b)-rank(a)||order(row.key+a.key).localeCompare(order(row.key+b.key))).slice(0,6);
  return [row,...near].sort((a,b)=>order(a.key).localeCompare(order(b.key))).map(r=>r.spec.schema);
}
export function schemaErrors(schema,args){
  const validation=spawnSync('services/api/.venv/bin/python',['-c',
    'import json,sys,jsonschema; s,v=json.load(sys.stdin); validator=jsonschema.validators.validator_for(s)(s); print(json.dumps([str(e.message) for e in validator.iter_errors(v)]))'],
    {input:JSON.stringify([schema,args]),encoding:'utf8'});
  assert.equal(validation.status,0,validation.stderr);
  return JSON.parse(validation.stdout);
}
export async function probe(row,rows,{state,get,write,save}){
  if(row.phase==='skill' && row.spec.agents.length){state.status='requires_bound_agent_evidence';return;}
  if(row.phase!=='skill' && !row.spec.schema){state.status='blocked_disabled';return;}
  const report=read('.xzm/minimax-live-manju.json');
  const projectId=report.projectId;
  const target=report.steps.qc.reviewTarget;
  const skill=row.phase==='skill';
  const intent=skill?skills[row.id]:intents[row.id];
  assert.ok(intent,'missing editorial request for '+row.id);
  const artifacts=await get('/projects/'+projectId+'/artifacts');
  const seed=artifacts.find(a=>a.id===target.id);
  const context={projectId};
  const needsVerified={job_cancel:'live cancellable job',approve_proposal:'pending proposal',
    agent_pause:'running owned agent',stop_agent:'running owned agent',agent_resume:'paused owned agent',steer_agent:'running owned agent',
    check_async_task:'asynchronous task',update_async_task:'asynchronous task',cancel_async_task:'asynchronous task',
    fs_read:'existing sandbox file',fs_edit:'existing sandbox file',read:'existing sandbox file',edit:'existing sandbox file',
    memory_merge:'existing memory with exact old content',memory_freeze:'existing owned memory',bible_read:'existing character bible',memory_get:'existing memory file',lapi_checklist:'existing draft file'};
  if(needsVerified[row.id]){state.status='blocked_prerequisites';state.missing=[needsVerified[row.id]];return;}
  if(['kb_read','kb_write_report'].includes(row.id)){
    const id=read('.xzm/minimax-live-male_long.json').sourceDocId;
    const doc=await get('/kb/docs/'+id+'/text?limit=1');
    assert.ok(doc.text);context.docId=id;
  }
  if(['artifact_update','diff_artifacts','adopt_artifact','read_artifact','save_artifact','list_artifact_versions','rollback_artifact','gate_run','run_agent'].includes(row.id)){
    assert.ok(seed?.id && Number.isInteger(seed.version));Object.assign(context,{artifactId:seed.id,version:seed.version,title:seed.title});
  }
  if(['gate_run','clip_candidate_extract','hook_100word_check','scan_length','scan_hook_present','regex_redline'].includes(row.id))context.text=seed.bodyMarkdown.slice(0,800);
  if(row.id==='diff_artifacts'){
    const outline=artifacts.find(a=>a.id===report.steps.structure.artifacts[0].id && a.type.includes('outline'));
    assert.ok(outline);context.outlineId=outline.id;
  }
  if(row.id==='rollback_artifact'){
    const versions=await get('/projects/'+projectId+'/artifacts/'+seed.id+'/versions');
    const past=versions.find(v=>v.artifactId===seed.id && v.version<seed.version);
    if(!past){state.status='blocked_prerequisites';state.missing=['historical artifact version'];return;}
    context.versionId=past.id;
  }
  if(row.id==='agent_inspect'){
    const run=await get('/runs/'+report.steps.qc.id);
    assert.equal(run.projectId,projectId);context.runId=run.id;
  }
  const runId=state.runId ||= 'cap_probe_'+randomUUID();
  save();
  const result=await write('probe','POST','/llm/agent-chat',{projectId,runId,agentId:'orch.writing',messages:[
    {role:'system',content:'当前日期 '+new Date().toISOString().slice(0,10)+'。'+(skill?row.spec.body:'你是写作台助手。根据编辑意图只提出第一步工具调用，使用给定上下文，不虚构标识。')},
    {role:'user',content:intent+'\n'+JSON.stringify(context)}],...(skill?{}:{tools:candidates(row,rows)}),temperature:0.1,maxTokens:2500});
  assert.match(result.model,/minimax/i);
  state.usage=(await get('/usage?project_id='+projectId)).filter(u=>u.runId===runId);
  assert.ok(state.usage.length && state.usage.every(u=>/minimax/i.test(u.model)),'missing MiniMax usage');
  if(skill){state.status='received_pending_skill_review';return;}
  const calls=result.choices[0].message.tool_calls||[];
  state.selected=calls.map(c=>c.function.name);
  state.selectionCorrect=calls.length===1 && state.selected[0]===row.id;
  state.execution='not_attempted';
  if(!state.selectionCorrect){state.status='selection_mismatch';return;}
  const args=JSON.parse(calls[0].function.arguments);
  state.schemaErrors=schemaErrors(row.spec.schema.function.parameters,args);
  state.semanticReview='pending';
  if(row.id==='ab_pingpong_detect') state.semanticReview=JSON.stringify(args.speakers)===JSON.stringify(['甲','乙','甲','乙'])?'passed':'failed';
  state.status=state.schemaErrors.length?'invalid_arguments':'selected_schema_valid';
}
