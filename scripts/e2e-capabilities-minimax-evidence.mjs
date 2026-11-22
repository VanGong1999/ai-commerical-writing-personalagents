import {setTimeout as wait} from 'node:timers/promises';

const terminal=new Set(['succeeded','failed','cancelled','dead']);
export function contractScope(agent){
  const n=Math.max(1,...agent.doneContract.filter(c=>c.type==='artifact_count').map(c=>c.min||1));
  if(n>1)return '按契约完成整批 '+n+' 项，逐项对应序号。';
  if(/episode-outline/.test(agent.skillPath))return '完成第1至10集的分集结构。';
  return '完成本岗位的一次独立交付。';
}
export function matchingOutline(art,type,no){
  if(!art || art.type!==type || !['chapter_outline','episode_outline'].includes(type))return false;
  const chapter=type==='chapter_outline';
  const keys=chapter?['chapterNo','chapter_no','ch_no','chapter']:['episodeNo','episode_no','ep_no','epNo','episode'];
  const numbers=keys.flatMap(k=>[art[k],art.bodyJson?.[k]]).filter(v=>typeof v==='number'||typeof v==='string'&&/^\d+$/.test(v)).map(Number);
  const heading=chapter?/第\s*([0-9]+)\s*章/:/第\s*([0-9]+)\s*集/;
  const title=String(art.title||'').match(heading);
  if(title)numbers.push(Number(title[1]));
  return numbers.length>0 && numbers.every(n=>n===no);
}
export function shortManuscript(art){
  return art?.type==='manuscript' && typeof art.bodyMarkdown==='string' && art.bodyMarkdown.trim().length>0 &&
    [...art.bodyMarkdown.trim()].length<800 && !Object.values(art.bodyJson||{}).some(v=>typeof v==='string' && [...v].length>=800);
}
export function requiredGaps(section,input){
  const gaps=[];
  for(const line of section.split('\n')){
    const [,field,required,desc]=line.split('|').map(s=>s.trim());
    if(!field||['字段','参数','输入','名称'].includes(field)||!/^是$|^必填$/.test(required))continue;
    const names=field.replaceAll('`','').split(/\s*\/\s*/);
    if(!names.some(k=>Object.hasOwn(input,k) && input[k]!=null && (!Array.isArray(input[k])||input[k].length)))gaps.push(field);
    if(/人工确认|已确认|已 ack|已采纳/.test(desc||''))gaps.push(field+' needs verified approval');
  }
  return gaps;
}
export function receipts(state){
  const id=state.writes?.run?.result?.id;
  const events=(state.replay?.steps||[]).filter(e=>e.runId===id && !e.payload?.child_run_id);
  const calls=new Map(events.filter(e=>e.kind==='tool_call').map(e=>[e.payload.id,e]));
  return events.filter(e=>e.kind==='tool_result' && calls.has(e.payload.id)).map(e=>{
    const call=calls.get(e.payload.id).payload;
    let result=e.payload.result;
    if(typeof result==='string'){try{result=JSON.parse(result.split('## 原始 JSON\n').at(-1));}catch{}}
    return {runId:id,callId:call.id,name:call.name,args:call.args,result,status:e.payload.status};
  });
}
export function onlyHumanOutstanding(status,checks,terminalReason){
  const failed=checks?.filter(c=>c.result!=='pass');
  return status==='failed' && /done.contract|user.ack|门禁|契约/i.test(terminalReason||'') &&
    failed?.length>0 && failed.every(c=>/^done\.user_ack(?:\.|$)/.test(c.id));
}
export async function cleanup(state,{get,stop,save,budget=30000}){
  const root=state.writes.run?.result?.id;
  if(!root)return;
  const owned=state.ownedRuns||={[root]:{}};
  const until=Date.now()+budget;
  do{
    const info=owned[root];
    info.status=(await get('/runs/'+root)).status;
    const replay=await get('/runs/'+root+'/replay');
    for(const e of replay.steps||[]){
      for(const child of [e.payload?.spawned_run_id,e.payload?.child_run_id]){
        if(child && child!==root)owned[child]||={};
      }
      const child=e.payload?.child_run_id;
      if(child && child!==root && e.kind==='run_end' && terminal.has(e.payload.status)){
        owned[child].status=e.payload.status;owned[child].terminalProof=e.id||'child_run_end';
      }
    }
    if(!terminal.has(info.status) && Date.now()>=(info.nextStopAt||0)){
      info.stopIntent=Date.now();
      info.stopAttempts=(info.stopAttempts||0)+1;
      info.nextStopAt=Date.now()+Math.min(5000,500*2**Math.min(4,info.stopAttempts-1));save();
      try{await stop(root);}catch(error){info.lastStopError=String(error);}
    }
    save();
    if(Object.entries(owned).every(([id,i])=>terminal.has(i.status) && (id===root || i.terminalProof)))return;
    await wait(Math.min(500,Math.max(1,until-Date.now())));
  }while(Date.now()<until);
  throw Error('owned runs still need reconciliation');
}

export function joinEvidence(row,rows,reports){
  const evidence=[];
  for(const report of reports){
    if(report.phase==='personal' && row.phase==='personal'){
      const c=report.cases?.[row.key];
      if(c?.hash===row.hash && c.executionReceipt?.surface==='personal' && c.executionReceipt?.runId && c.executionReceipt?.callId)evidence.push(c.executionReceipt);
    }
    if(report.phase!=='agent')continue;
    for(const [key,s] of Object.entries(report.cases||{})){
      const agent=rows.find(r=>r.key===key);
      if(agent?.phase!=='agent'||s.hash!==agent.hash||!s.usage?.length||!s.usage.every(u=>/minimax/i.test(u.model)))continue;
      const runId=s.writes?.run?.result?.id;
      if(!runId||s.writes.run.body?.agentId!==agent.id)continue;
      const audit=receipts(s);
      if(row.phase==='worker' && row.hash===s.toolHashes?.[row.id]){
        for(const r of audit.filter(r=>r.name===row.id))evidence.push({...r,surface:'worker',sourceHash:row.hash});
      }
      if(row.phase==='skill' && row.hash===agent.spec.skillHash && row.spec.agents.includes(agent.id)){
        const names=new Set([row.id,row.spec.name,row.spec.path,row.spec.path?.replace(/^skills\//,'')].filter(Boolean));
        const loaded=audit.filter(r=>r.name==='skill_read' && names.has(r.args?.ref||r.args?.relativePath||r.args?.name) &&
          !r.result?.error && names.has(r.result?.relativePath||r.result?.name));
        const gates=audit.filter(r=>r.name==='gate_run').map(r=>({runId,callId:r.callId,name:r.args?.name,passed:r.result?.passed}));
        evidence.push({kind:loaded.length?'skill_read':'run_association',runId,agentId:agent.id,sourceHash:row.hash,loaded:loaded.map(r=>r.callId),gates,
          doneChecks:audit.filter(r=>r.name==='done_check').at(-1)?.result?.checks||[],runStatus:s.runStatus,caseStatus:s.status});
      }
    }
  }
  return evidence;
}
