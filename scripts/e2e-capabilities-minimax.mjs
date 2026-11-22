import {inputSection as sectionOf,verifiedGap,needsBody,populate,retrySafe,caseTimeout} from './e2e-capabilities-minimax-case-inputs.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, renameSync, existsSync, mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {cleanup,contractScope,joinEvidence,matchingOutline,shortManuscript,onlyHumanOutstanding,receipts,requiredGaps} from './e2e-capabilities-minimax-evidence.mjs';
import {setTimeout as wait} from 'node:timers/promises';
import {api,sleep} from './e2e-helpers.mjs';
import {TOOL_CATALOG} from '../services/agent-worker/src/toolCatalog.js';

export const read = p => JSON.parse(readFileSync(p,'utf8'));
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const inventoryDir = process.env.CAP_INVENTORY || '.superpowers/sdd/2026-11-20-all-capabilities-minimax';
export function manifest() {
  const worker=read(inventoryDir+'/worker-inventory.json');
  const personal=read(inventoryDir+'/personal-inventory.json');
  const skills=read('packages/agent-runtime/skills/catalog.json').skills;
  const rows=[];
  function add(phase,id,spec) { rows.push({phase,id,key:phase+'/'+id,hash:hash(spec),spec}); }
  for(const skill of skills) {
    const body=readFileSync('packages/agent-runtime/'+skill.path,'utf8');
    add('skill',skill.id,{...skill,body,agents:worker.agents.filter(a=>a.skillPath===skill.path).map(a=>a.id)});
  }
  for(const agent of worker.agents) {
    add('agent',agent.id,{...agent,skillHash:rows.find(r=>r.spec.path===agent.skillPath).hash});
  }
  for(const entry of TOOL_CATALOG) add('worker',entry.name,{entry,schema:worker.tools.find(t=>t.function.name===entry.name)||null});
  for(const schema of personal) add('personal',schema.function.name,{schema});
  assert.equal(new Set(rows.map(r=>r.key)).size,rows.length);
  return rows;
}
export async function agentCase(row,ctx) {
  const {spec:a}=row;
  const format=a.format.find(f=>f!=='*')||'manju';
  const snapshot=read('.xzm/minimax-live-'+format+'.json');
  assert.equal(snapshot.status,'passed');
  const {get,write,state,save}=ctx;
  const originals=await get('/projects/'+snapshot.projectId+'/artifacts');
  const fresh=await write('project','POST','/projects',{title:'MiniMax岗位验收 '+a.id,format,market:'cn'});
  const prefix='/projects/'+fresh.id;
  let source=originals.find(i=>i.id===snapshot.steps.qc.reviewTarget.id);
  assert.ok(source);
  if(source.version!==snapshot.steps.qc.reviewTarget.version){
    const versions=await get('/projects/'+snapshot.projectId+'/artifacts/'+source.id+'/versions');
    const reviewed=versions.find(v=>v.version===snapshot.steps.qc.reviewTarget.version);
    assert.ok(reviewed,'reviewed source version unavailable');
    source={...source,title:reviewed.title,bodyMarkdown:reviewed.bodyMarkdown,bodyJson:reviewed.bodyJson,version:reviewed.version};
  }
  const excerpt=(source.bodyMarkdown||JSON.stringify(source.bodyJson)).slice(0,1800);
  assert.ok(excerpt.length>=80,'missing source excerpt');
  state.source={id:source.id,version:source.version,priorReviewedVersion:snapshot.steps.qc.reviewTarget.version,hash:hash(excerpt)};
  const chapter=['male_long','female_long','short_novel'].includes(format);
  const outlineType=chapter?'chapter_outline':'episode_outline';
  const skill=readFileSync('packages/agent-runtime/'+a.skillPath,'utf8');
  const inputSection=sectionOf(skill);
  const record=process.env.CAP_CASE_FIXTURES?read(process.env.CAP_CASE_FIXTURES)[a.id]:null;
  if(process.env.CAP_CASE_FIXTURES)assert.ok(record,'missing case fixture '+a.id);
  const bodyRequired=record&&needsBody(inputSection,record.requiredFields);
  const decay=a.id==='prose.length_decay_fix';
  const inputs=[];
  const targets=new Set(a.doneContract.flatMap(c=>c.artifact?[c.artifact]:[]));
  for(const phase of ['topic','character','structure','body']) {
    if(phase==='body' && !bodyRequired && !decay && !/qc|edit|critic|review|rewrite|adapt|deliver|audit/i.test(a.id)) continue;
    const prior=phase==='body'?source:phase==='structure'?snapshot.steps.structure.artifacts.find(p=>matchingOutline(originals.find(t=>t.id===p.id),outlineType,1)):snapshot.steps[phase].artifacts[0];
    if(!prior || (targets.has(prior.type) && !(bodyRequired && phase==='body') && !decay && !/edit|critic|review|rewrite|audit/.test(a.id))) continue;
    const art=phase==='body'?source:originals.find(i=>i.id===prior.id);
    assert.ok(art);
    const shorten=decay && phase==='body' && process.env.CAP_SHORT_DECAY_FIXTURE==='1' && art.type==='manuscript';
    const material=shorten?{bodyMarkdown:[...art.bodyMarkdown].slice(0,320).join(''),bodyJson:{ep_no:1}}:{bodyMarkdown:art.bodyMarkdown,bodyJson:art.bodyJson};
    const copy=await write(phase,'POST',prefix+'/artifacts',{type:art.type,title:art.title,...material,viaOntologyAction:true});
    if(shorten)state.shortFixture={sourceId:art.id,sourceVersion:art.version,artifactId:copy.id,persistedCharacters:[...copy.bodyMarkdown].length};
    inputs.push({type:art.type,id:copy.id,version:copy.version});
    if(phase==='body' && decay && !shortManuscript(copy))state.fixtureGap='requires a persisted short manuscript below 800 characters';
  }
  const memories=await get('/memory/tree?project_id='+snapshot.projectId);
  const bible=memories.find(m=>m.path.startsWith('/memories/projects/'+snapshot.projectId+'/') && /bible|character|人物/i.test(m.path) && m.content);
  if(bible) await write('bible','PUT','/memory/file',{path:bible.path.replace(snapshot.projectId,fresh.id),content:bible.content,projectId:fresh.id});

  const output=skill.match(/## 输出[^\n]*\n([\s\S]*?)(?=\n## |$)/)?.[1]?.slice(0,1400)||'';
  const inputJson={format,...(chapter?{chapterNo:1,chapter_no:1}:{episodeNo:1,ep_no:1}),gender_path:format==='female_long'?'female':'male',seed:excerpt,
    ...(a.doneContract.some(c=>c.type==='artifact_count' && c.min===10)?{count:10}:{}),
    task:[a.persona+'，'+a.description+'。'+contractScope(a),output,'验收要求 '+JSON.stringify(a.doneContract),'前置材料 '+JSON.stringify(inputs),'素材 '+excerpt,'只操作本验收项目。禁止执行 shell、外发消息、部署、操作其他项目或接受外部审批。'].join('\n')};
  const body=inputs.find(i=>i.id===state.writes.body?.result?.id);
  if(body) inputJson.selectedBodyId=body.id;
  const needsDoc=/doc_id|source_doc|sourceDocId/.test(inputSection) || a.tools.includes('kb_write_report');
  const doc=needsDoc?await write('document','POST','/kb/docs?doc_type=notes&title='+encodeURIComponent('验收素材 '+a.id+' '+fresh.id),{content:excerpt}):null;
  if(doc){inputJson.doc_id=doc.id;inputJson.sourceDocId=doc.id;}
  if(/core-hook-critic/.test(a.skillPath)) {
    const copied=[];
    const sourceProject=read('.xzm/studio-loop-samples.json').find(p=>p.format==='manju')?.projectId;
    const pool=sourceProject?await get('/projects/'+sourceProject+'/artifacts'):originals;
    state.candidateSources={};
    for(const original of pool.filter(art=>art.type==='core_hook' && art.id && art.version>0 && (art.bodyMarkdown || Object.keys(art.bodyJson||{}).length)).slice(0,10)){
      const candidate=await write('candidate/'+original.id,'POST',prefix+'/artifacts',{type:original.type,title:original.title,bodyMarkdown:original.bodyMarkdown,bodyJson:original.bodyJson,viaOntologyAction:true});
      const items=candidate.bodyJson?.items;
      if(Array.isArray(items))copied.push(...items.slice(0,10-copied.length).map((_,i)=>candidate.id+"#"+i));
      else copied.push(candidate.id);
      state.candidateSources[candidate.id]={projectId:sourceProject,id:original.id,version:original.version};
      if(copied.length===10)break;
    }
    inputJson.candidates=copied;inputJson.candidateIds=copied;inputJson.itemIds=copied;
    if(!copied.length)state.fixtureGap='requires selected core_hook candidates';
  }
  const outline=inputs.find(i=>i.type===outlineType);
  const character=inputs.find(i=>i.type==='character');
  const fields={source_work:source.title,source:excerpt,source_excerpt:excerpt,source_doc:doc?.id,doc_id:doc?.id,sourceDocId:doc?.id,
    excerpt:excerpt,text:excerpt,draft:excerpt,manuscript:decay?body?.id:excerpt,scene:excerpt,outline_ref:outline?.id,episode_outline:chapter?undefined:outline?.id,chapter_outline:chapter?outline?.id:undefined,
    bible:bible?.path.replace(snapshot.projectId,fresh.id),character_card:character?.id,project_id:fresh.id,ep_no:chapter?undefined:1,
    raw_inspiration:excerpt,target_format:format,format,episode_no:chapter?undefined:1,artifacts:inputs};
  for(const [key,value] of Object.entries(fields)) if(value && inputSection.includes(key))inputJson[key]=value;
  const fixture=record?await populate({a,record,source,reviewed:read(inventoryDir+'/source-fixtures.json')[format],format,projectId:fresh.id,input:inputJson,inputs,state,write,get,sample:read('.xzm/studio-loop-samples.json').find(p=>p.format==='manju')?.projectId,section:inputSection,bible}):{missing:[],approved:new Set()};
  const missing=[...fixture.missing,...requiredGaps(inputSection,inputJson).filter(g=>!verifiedGap(g,fixture.approved))];
  if(record)state.preparedInput=inputJson;
  state.preparedInputHash=hash(inputJson);save();
  if(state.fixtureGap)missing.push(state.fixtureGap);
  if(missing.length && !state.writes.run){state.status='blocked_prerequisites';state.missing=missing;save();return;}
  const run=await write('run','POST','/runs',{agentId:a.id,projectId:fresh.id,inputJson});
  const deadline=ctx.deadline;
  while(true) {
    const r=await get('/runs/'+run.id);
    state.runStatus=r.status;state.terminalDetail={status:r.status,error:r.error,errorMessage:r.errorMessage,gateResults:r.gateResults};
    if(['succeeded','failed','dead','cancelled'].includes(r.status)) break;
    assert.ok(Date.now()<deadline,'run deadline exceeded');
    await wait(1500,undefined,{signal:ctx.signal});
  }
  const replay=await get('/runs/'+run.id+'/replay');
  const usage=(await get('/usage?project_id='+fresh.id)).filter(u=>u.runId===run.id);
  const artifacts=(await get(prefix+'/artifacts')).filter(t=>t.createdByRunId===run.id);
  Object.assign(state,{usage,replay,artifacts:artifacts.map(({id,type,version})=>({id,type,version}))});
  save();
  assert.ok(usage.length && usage.every(u=>/minimax/i.test(u.model)),'missing MiniMax usage');
  const audit=receipts(state);
  const checks=audit.filter(r=>r.name==='done_check').at(-1)?.result?.checks;
  const reason=[state.terminalDetail.error,state.terminalDetail.errorMessage,replay.steps.filter(e=>e.kind==='run_end' && !e.payload?.child_run_id).at(-1)?.payload?.exitReason].join(' ');
  if(a.doneContract.some(c=>c.type==='user_ack') && onlyHumanOutstanding(state.runStatus,checks,reason)){state.status='requires_human_ack';return;}
  const revised=[];
  for(const item of [...inputs,...Object.values(state.writes).filter(w=>w.path===prefix+'/artifacts' && w.result?.id).map(w=>w.result)]){
    const update=audit.find(r=>r.name==='artifact_update' && r.args?.artifactId===item.id && r.result?.ok!==false && !r.result?.error);
    if(!update || revised.some(t=>t.id===item.id))continue;
    const latest=(await get(prefix+'/artifacts')).find(t=>t.id===item.id);
    if(latest?.version>item.version)revised.push({id:item.id,type:item.type,before:item.version,after:latest.version,callId:update.callId});
  }
  state.revisions=revised;
  if(/core-hook-critic/.test(a.skillPath)){
    const parents=await get(prefix+'/artifacts');
    for(const ref of inputJson.candidates){
      const [id,index]=ref.split('#');
      const parent=parents.find(t=>t.id===id);
      const score=(index===undefined?parent?.bodyJson:parent?.bodyJson?.items?.[index])?.criticReview;
      assert.ok(revised.some(t=>t.id===id) && score?.runId===run.id && score.ref===ref && score.sourceVersion+1===parent.version,'missing selected candidate writeback '+ref);
    }
  }
  assert.equal(state.runStatus,'succeeded');
  for(const c of a.doneContract.filter(c=>c.type==='artifact_count')) assert.ok([...artifacts,...revised].filter(t=>t.type===c.artifact).length>=(c.min||1),'artifact count '+c.artifact);
  state.status='worker_succeeded_pending_contract_review';
}
export async function sendWrite(base,record,{signal,timeout,save,backoff}){
  const url=base+'/api/v1'+record.path;
  for(let attempt=0;attempt<3;attempt++){
    signal.throwIfAborted();
    delete record.retryAt;save();
    const form=record.path.startsWith('/kb/docs?');
    const res=await fetch(url,{method:record.method,headers:{'Content-Type':form?'application/x-www-form-urlencoded':'application/json'},
      signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)]),body:form?new URLSearchParams(record.body):JSON.stringify(record.body)});
    if(res.ok)return res.status===204?null:await res.json();
    const msg=(await res.text()).slice(0,500);
    if(res.status!==429)throw Error('HTTP '+res.status+' '+msg);
    const header=res.headers.get('retry-after');
    const delay=header && Number.isFinite(Number(header))?Number(header)*1000:header?Date.parse(header)-Date.now():1000*(2**attempt);
    const ms=Number.isFinite(delay)?Math.max(0,delay):1000;
    record.retryAt=Date.now()+ms;
    (record.throttles||=[]).push({at:Date.now(),ms,msg});save();
    backoff(ms);
    if(ms>60000 || attempt===2)throw Error('rate limited, retry later after '+ms+'ms');
    await wait(ms,undefined,{signal});
  }
}
export async function main([phase,file,pattern='.*']) {
  assert.ok(file,'usage: PHASE REPORT.json [ID_REGEX]');
  const rows=manifest();
  mkdirSync(dirname(file),{recursive:true});
  const lease=new DatabaseSync(file+'.lease.sqlite');
  try {
    lease.exec('BEGIN IMMEDIATE');
    const state=existsSync(file)?read(file):{phase,base:process.env.E2E_API_BASE||'http://127.0.0.1:8001',cases:{}};
    const save=()=>{writeFileSync(file+'.tmp',JSON.stringify(state,null,2),{mode:0o600});renameSync(file+'.tmp',file);};
    assert.equal(state.phase,phase);
    if(phase==='inventory'){state.rows=rows;save();return;}
    if(phase==='evidence'){
      const reports=pattern.split(',').map(read);
      for(const row of rows.filter(r=>r.phase!=='agent')){
        const evidence=joinEvidence(row,rows,reports);
        const associations=evidence.filter(e=>e.kind==='run_association');
        const traces=evidence.filter(e=>e.kind!=='run_association');
        state.cases[row.key]={hash:row.hash,evidence:traces,associations,status:traces.length?'trace_observed':'no_verified_trace'};
      }
      save();return;
    }
    assert.equal(new URL(state.base).hostname,'127.0.0.1');
    const controller=new AbortController();
    const stop=()=>controller.abort();
    process.on('SIGTERM',stop);process.on('SIGINT',stop);
    try {
      const queue=rows.filter(r=>r.phase===phase && new RegExp(pattern).test(r.id));
      assert.ok(queue.length,'no matching cases');

      let resumeAt=state.resumeAt||0;
      async function consume(){
        while(queue.length && !controller.signal.aborted){
          if(Date.now()<resumeAt)return;
          const row=queue.shift();
          const s=state.cases[row.key]||={hash:row.hash,writes:{}};
          assert.equal(s.hash,row.hash,'source changed: use a new report');
          const reconcile=()=>cleanup(s,{get:path=>api('GET',path,undefined,state.base,{timeoutMs:3000,retry:false}),stop:id=>api('POST','/tasks/runs/'+id+'/stop',undefined,state.base,{timeoutMs:3000}),save});
          if(s.status==='cleanup_pending'){try{await reconcile();s.status='failed';}catch(e){s.cleanupError=String(e);}save();continue;}
          if(s.status==='retryable_rate_limit'){delete s.status;delete s.deadline;}
          if(process.env.CAP_RETRY_PREREQUISITES==='1'&&retrySafe(s)){delete s.status;delete s.deadline;delete s.fixtureGap;delete s.missing;}
          if(s.status)continue;
          const timeout=Number(process.env.CAP_TIMEOUT_MS||caseTimeout(row.spec));
          const deadline=s.deadline ||= Date.now()+timeout;
          const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(Math.max(1,deadline-Date.now()))]);
          save();
          const get=path=>api('GET',path,undefined,state.base,{signal,retry:false});
          async function write(key,method,path,body){
            const prev=s.writes[key];
            if(prev && !prev.retryAt){assert.ok(Object.hasOwn(prev,'result'),'ambiguous submission '+key);return prev.result;}
            controller.signal.throwIfAborted();
            const record=s.writes[key] ||= {at:Date.now(),method,path,body};save();
            record.result=await sendWrite(state.base,record,{signal,timeout:path.includes('agent-chat')?timeout:15000,save,backoff:ms=>{resumeAt=Math.max(resumeAt,Date.now()+ms);state.resumeAt=resumeAt;save();}});save();return record.result;
          }
          try{
            if(phase==='agent')s.toolHashes ||= Object.fromEntries(rows.filter(r=>r.phase==='worker' && r.spec.schema).map(r=>[r.id,r.hash]));
            const ctx={get,write,state:s,save,timeout,signal,deadline};
            if(phase==='agent') await agentCase(row,ctx);
            else await (await import('./e2e-capabilities-minimax-probes.mjs')).probe(row,rows,ctx);
          }catch(error){
            s.error=String(error);
            const id=s.writes.run?.result?.id;
            if(Object.values(s.writes).some(w=>w.retryAt)){s.status='retryable_rate_limit';}
            else if(id){
              s.status='cleanup_pending';save();
              try{await reconcile();s.status='failed';}catch(e){s.cleanupError=String(e);}
            }else{s.status=Object.values(s.writes).some(w=>!Object.hasOwn(w,'result'))?'ambiguous_submission':'failed';}
          }
          save();
        }
      }
      await Promise.all(Array.from({length:3},consume));
    }finally{process.off('SIGTERM',stop);process.off('SIGINT',stop);}
  }finally{lease.close();}
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href) await main(process.argv.slice(2));
