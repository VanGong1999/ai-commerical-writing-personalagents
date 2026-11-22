import {createHash} from 'node:crypto';
import {matchingOutline} from './e2e-capabilities-minimax-evidence.mjs';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const inputSection=skill=>skill.match(/^#{1,2}\s+输入[^\n]*\n([\s\S]*?)(?=^#{1,2}\s|(?![\s\S]))/m)?.[1]||'';
export const verifiedGap=(gap,approved)=>gap.endsWith(' needs verified approval')&&gap.slice(0,-' needs verified approval'.length).replaceAll('`','').split(/\s*\/\s*/).some(field=>approved.has(field.trim()));
export const needsBody=(section,fields)=>/\b(manuscripts?|scene|draft|dialogue|body)\b|待校正正文/.test(section)||Object.values(fields).some(v=>/^@(scene|manuscript|body)\./.test(v));
export const caseTimeout=a=>a?.doneContract?.some(c=>Number(c.min)>=10||['manuscript','scene_script'].includes(c.artifact))?480000:240000;
export const retrySafe=s=>s.status==='blocked_prerequisites'&&!s.writes.run&&Object.values(s.writes).every(w=>Object.hasOwn(w,'result'));

export async function populate({a,record,source,reviewed,format,projectId,input,inputs,state,write,get,sample,section,bible}){
  const fields=record.requiredFields;
  const missing=[],approved=new Set();
  const proof=state.fixtureEvidence={recommendationHash:digest(record),reviewedHash:digest(reviewed),fields:{}};
  const clones=Object.values(state.writes).map(w=>w.result).filter(x=>x?.projectId===projectId&&x.type);
  let pool;
  const material=x=>{
    if(!x.bodyJson || typeof x.bodyJson!=='object' || Array.isArray(x.bodyJson))return [x.bodyMarkdown,x.bodyJson];
    const {adoptedAt,adoptMode,...story}=x.bodyJson;
    return [x.bodyMarkdown,story];
  };
  async function seed(art){
    if(!art)return;
    let copy=clones.find(x=>x.type===art.type&&digest(material(x))===digest(material(art)));
    if(!copy){
      copy=await write('seed/'+art.id,'POST','/projects/'+projectId+'/artifacts',{type:art.type,title:art.title,bodyMarkdown:art.bodyMarkdown,bodyJson:art.bodyJson,viaOntologyAction:true});
      clones.push(copy);
    }
    if(!inputs.some(x=>x.id===copy.id))inputs.push({id:copy.id,type:copy.type,version:copy.version});
    return {id:copy.id,version:copy.version,sourceId:art.id,sourceVersion:art.version,sourceProjectId:art.projectId,hash:digest(material(art)),excerpt:art.bodyMarkdown?.slice(0,450)};
  }
  for(const [rawField,value] of Object.entries(fields)){
    const names=rawField.replaceAll('`','').split(/\s*\/\s*/);
    const field=names.includes('characters')&&value==='@characters.json'?'characters':names[0];
    if(typeof value!=='string'||!value.startsWith('@')){input[field]=value;proof.fields[field]={kind:'test_constraint'};continue;}
    const [kind,key]=value.slice(1).split('.');
    let art,result,citation;
    const approvalItems=[];
    const arts=reviewed.artifacts;
    const one=type=>arts.find(x=>x.type===type);
    if(kind==='project')result=key==='id'?projectId:format;
    else if(kind==='kbdoc')result=key==='id'?input.doc_id:input.doc_id&&source.bodyMarkdown?.slice(0,600);
    else if(kind==='bible'&&key==='json'&&bible)result={path:bible.path.replace(reviewed.projectId,projectId),excerpt:bible.content.slice(0,500)};
    else if(kind==='stage')result=inputs.length?[...inputs]:undefined;
    else if(kind==='core_hooks')result=input.candidates?.length>=1 && input.candidates.length<=100?input.candidates:undefined;
    else if(a.id==='orch.batch_writer'&&field==='outline_ref'){
      const range=/^EP(\d{1,3})\s*[-–—]\s*(?:EP)?(\d{1,3})$/i.exec(fields.episode_range||'');
      const start=Number(range?.[1]),end=Number(range?.[2]);
      if(start>=1&&end>=start&&end-start<100){
        for(let n=start;n<=end;n++){
          const original=arts.find(x=>matchingOutline(x,'episode_outline',n));
          if(!original){missing.push('episode_range missing EP'+n);continue;}
          const item=await seed(original);item.episodeNo=n;approvalItems.push([original,item]);
        }
        if(approvalItems.length===end-start+1)result=approvalItems.map(([,item])=>item);
      }else missing.push('invalid bounded episode_range');
    }
    else if(kind==='episode_outlines'){
      const count=/eps1_10|ep10_outline|episodes|episode_outlines/.test(field)||/前\s*(10|十)\s*集/.test(section)?10:1;
      const items=[];
      for(let n=1;n<=count;n++){const o=arts.find(x=>matchingOutline(x,'episode_outline',n));if(o){const item=await seed(o);items.push(item);approvalItems.push([o,item]);}}
      if(items.length===count)result=count===1?items[0]:items;
    }else{
      if(['body','scene','source','manuscript'].includes(kind))art=source;
      if(kind==='source'&&['summary','theme'].includes(key))art=arts.find(x=>x.bodyJson?.[key]||(key==='summary'&&x.bodyJson?.logline));
      if(['character','characters'].includes(kind))art=one('character');
      if(['outline','episode_outline','chapter_outline','cool_point','cool_points'].includes(kind))art=arts.find(x=>matchingOutline(x,kind==='chapter_outline'?'chapter_outline':kind==='episode_outline'?'episode_outline':/long|novel/.test(format)?'chapter_outline':'episode_outline',1));
      const topic=arts.find(x=>x.type==='topic_card'&&x.bodyJson?.want_how&&x.bodyJson?.via_what);
      if(topic&&['story_shell','cool_points','cool_point'].includes(kind))art=topic;
      if(kind==='gold_finger')art=source;
      if(kind==='core_hook'){
        art=one(kind)||topic;
        if(!art&&sample&&format==='manju'){pool ||=await get('/projects/'+sample+'/artifacts');art=pool.find(x=>x.type===kind&&x.status==='adopted');}
      }
      if(field==='master_outline')art=one('master_outline');
      else art ||= one(kind);
      if(art){
        const data=art.bodyJson||{};
        const alias={summary:'summary',selected:'coolPoint',rules:'goldFinger',goal:'goal',locations:'locations',setup:'setup'};
        if(key==='goalAndMethod'&&data.want_how&&data.via_what)result={want_how:data.want_how,via_what:data.via_what};
        else if(kind==='core_hook'&&key==='goal')result=data.want_how||data.motivation||data.goal;
        else if(kind==='core_hook'&&key==='method')result=data.via_what||data.method;
        else if(kind==='core_hook'&&key==='promise')result=data.four_step?.hook_point||data.logline;
        else if(kind==='core_hook'&&key==='payoffSource')result=data.cool_axis||data.payoffSource;
        else if(kind==='story_shell'&&key==='text')result=data.logline||art.bodyMarkdown?.slice(0,600);
        else if(kind==='cool_points'&&key==='selected')result=data.main_cool_points||data.coolPoint;
        else if(kind==='cool_point'&&key==='text')result=data.coolPoint||data.cool_point;
        else if(kind==='scene'&&['locations','location'].includes(key))result=data.scene_header?.split?.('|')[1]||data.location;
        else if(kind==='scene'&&key==='expectedPayoff')result=data.turn;
        else if(kind==='scene'&&key==='setup')result=data.conflict;
        else if(kind==='scene'&&key==='summary')result=data.goal&&data.conflict?{goal:data.goal,conflict:data.conflict,turn:data.turn}:data.summary;
        else if(kind==='source'&&key==='summary')result=data.summary||data.logline;
        else if(['text','excerpt','fullText'].includes(key)||kind==='character'&&key==='summary')result=art.bodyMarkdown?.slice(0,650);
        else if(key==='json')result=kind==='character'||kind==='characters'?data.characters||{title:art.title,excerpt:art.bodyMarkdown?.slice(0,600)}:Object.fromEntries(Object.entries(data).filter(([k])=>k!=='bodyMarkdown'));
        else if(key==='title')result=art.title;
        else if(key==='dialogue')result=art.bodyMarkdown?.split('\n').filter(l=>/^.{1,15}[：:]/.test(l)).slice(0,6).join('\n');
        else result=data[key]??data[alias[key]];
        if(result){
          citation=kind==='source'?{sourceId:art.id,sourceVersion:art.version,hash:digest(material(art))}:kind==='manuscript'&&state.shortFixture?{}:await seed(art);
          if(kind==='manuscript'&&state.shortFixture){
            const short=state.writes.body.result;
            citation={id:short.id,version:short.version,sourceId:art.id,sourceVersion:art.version,hash:digest(material(short)),excerpt:short.bodyMarkdown.slice(0,320)};
          }
          if(kind==='manuscript'||kind==='body')result=citation;
          if(kind==='manuscript'||kind==='body')input.selectedBodyId=citation.id;
        }
      }
    }
    if(result===undefined||result===null||result===''||typeof result==='object'&&!Object.keys(result).length){missing.push(field+' requires '+value);delete input[field];continue;}
    input[field]=result;proof.fields[field]={ref:value,citation};
    if(art&&citation?.id)approvalItems.push([art,citation]);
    const approvalLine=section.split('\n').find(l=>l.split('|')[1]?.replaceAll('`','').trim()===field);
    if(/已\s*ack/i.test(approvalLine||'')&&approvalItems.length){
      const current=await get('/projects/'+projectId+'/artifacts');
      const {progress}=await get('/projects/'+projectId);
      if(progress?.logicAck===true&&approvalItems.every(([,item])=>{
        const persisted=current.find(x=>x.id===item.id);
        return persisted&&digest(material(persisted))===item.hash&&progress.logicAckVersions?.[item.id]===persisted.version;
      })){
        for(const [,item] of approvalItems){
          item.version=progress.logicAckVersions[item.id];
          inputs.find(x=>x.id===item.id).version=item.version;
        }
        proof.fields[field].ack={at:progress.logicAckAt,versions:Object.fromEntries(approvalItems.map(([,x])=>[x.id,x.version]))};
        approved.add(field);
      }
    }else if(process.env.CAP_APPROVE_SEEDED_FIXTURES==='1'&&/已确认|已采纳|人工确认/.test(approvalLine||'')&&approvalItems.length){
      const receipts=[];
      for(const [original,item] of approvalItems){
        if(!['character','episode_outline','chapter_outline','core_hook'].includes(original.type)||!reviewed.approval?.confirmedAt||reviewed.approval.versions?.[original.id]!==original.version||original.projectId!==reviewed.projectId)continue;
        const current=(await get('/projects/'+projectId+'/artifacts')).find(x=>x.id===item.id);
        if(!current||digest(material(current))!==item.hash)continue;
        const adopted=await write('seed-adopt/'+item.id,'POST','/projects/'+projectId+'/artifacts/'+item.id+'/adopt',{mode:'strong',expectedVersion:current.version});
        const persisted=(await get('/projects/'+projectId+'/artifacts')).find(x=>x.id===item.id);
        if(persisted?.status==='adopted'&&persisted.version===adopted.version&&digest(material(persisted))===item.hash&&adopted.status==='adopted'&&adopted.id===current.id&&digest(material(adopted))===item.hash){
          receipts.push({source:reviewed.approval.token,sourceVersion:original.version,id:item.id,version:adopted.version});
          item.version=adopted.version;
          const baseline=inputs.find(x=>x.id===item.id);
          if(baseline)baseline.version=adopted.version;
        }
      }
      proof.fields[field].approvals=receipts;
      if(receipts.length===approvalItems.length)approved.add(field);
    }
  }
  for(const [field,evidence] of Object.entries(proof.fields)){
    if(evidence.ref)evidence.valueHash=digest(input[field]);
  }
  if(['colleague.proactive','mem.curator'].includes(a.id))input.project={id:projectId,format};
  if(a.id==='mem.curator'){
    const project=state.writes.project?.result;
    if(project?.stage)input.stage=project.stage;
  }
  if(a.id==='analytics.review')Object.assign(input,{views:12000,favorites:430,retention:{opening:0.79,midpoint:0.52,ending:0.37},meta:'合成业务测试数据',dataOrigin:'合成业务测试数据'});
  return {missing,approved};
}
