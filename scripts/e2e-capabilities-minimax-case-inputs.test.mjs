import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {inputSection,verifiedGap,needsBody,populate,retrySafe,caseTimeout} from './e2e-capabilities-minimax-case-inputs.mjs';
import {requiredGaps} from './e2e-capabilities-minimax-evidence.mjs';

test('single-level 输入 heading stops before next heading and skips backticked alternatives header',()=>{
 const section=inputSection('# 输入\n| 字段 | 必填 | 说明 |\n| `a` / `b` | 是 | 正文 |\n# 输出\n| c | 是 | |');
 assert.deepEqual(requiredGaps(section,{b:1}),[]);
 assert.equal(needsBody('manuscript',{}),true);
});
test('only unsubmitted fully journaled blocks can retry; scale controls default deadline',()=>{
 const state={status:'blocked_prerequisites',writes:{project:{result:{id:'p'}}}};
 assert.ok(retrySafe(state));state.writes.run={};assert.equal(retrySafe(state),false);
 assert.equal(retrySafe({...state,writes:{project:{}}}),false);
 assert.equal(caseTimeout({doneContract:[{min:20}]}),480000);
 assert.equal(caseTimeout({doneContract:[]}),240000);
});
test('exact 1-10 outlines, missing typed references and hash-linked source clones',async()=>{
 const artifacts=Array.from({length:10},(_,i)=>({id:'o'+i,projectId:'old',type:'episode_outline',version:1,bodyJson:{episodeNo:i+1},bodyMarkdown:'outline '+i}));
 const inputs=[],input={},state={writes:{}};
 const result=await populate({a:{id:'test'},record:{requiredFields:{ep10_outline:'@episode_outlines.items',run:'@run.id'}},reviewed:{artifacts},source:{},format:'manju',projectId:'new',input,inputs,state,section:'',write:async(key,method,path,body)=>({...body,id:key,version:1,projectId:'new'})});
 assert.equal(input.ep10_outline.length,10);assert.equal(input.ep10_outline[9].sourceId,'o9');assert.equal(inputs.length,10);assert.deepEqual(result.missing,['run requires @run.id']);
});
test('seed adoption uses exact approved source version and optimistic version, only under explicit enablement',async()=>{
 const original={id:'c',version:3,projectId:'src',type:'character',bodyMarkdown:'已审人物稿',bodyJson:{characters:['甲']}};
 const existing=process.env.CAP_APPROVE_SEEDED_FIXTURES;
 try{
  for(const [flag,version,expected] of [['0',3,false],['1',2,false],['1',3,true],['1',3,'revoked'],['1',3,'edited'],['1',3,'nested']]){
   process.env.CAP_APPROVE_SEEDED_FIXTURES=flag;
   let copy;
   const result=await populate({a:{id:'sample'},record:{requiredFields:{characters:'@characters.json'}},reviewed:{projectId:'src',artifacts:[original],approval:{confirmedAt:'t',token:'proof',versions:{c:version}}},source:{},format:'manju',projectId:'clone',input:{},inputs:[],state:{writes:{}},section:'| characters | 是 | 已确认的人物 |',get:async()=>[copy],write:async(k,m,p,body)=>{
    if(k.startsWith('seed-adopt/')){assert.equal(body.expectedVersion,1);const bodyJson={...copy.bodyJson,adoptedAt:'t',adoptMode:'manual'};if(expected==='edited')bodyJson.characters=['乙'];if(expected==='nested')bodyJson.characters=[{adoptedAt:'t'}];const adopted={...copy,bodyJson,status:'adopted',version:2};copy=expected==='revoked'?{...copy,status:'candidate',version:3}:adopted;return adopted;}
    return copy={...body,id:'copy',projectId:'clone',version:1};
   }});
   assert.equal(result.approved.has('characters'),expected===true);
  }
 }finally{if(existing===undefined)delete process.env.CAP_APPROVE_SEEDED_FIXTURES;else process.env.CAP_APPROVE_SEEDED_FIXTURES=existing;}
});
test('batch requires exact units and independent matching current ack',async()=>{
 const arts=[1,2,3].map(n=>({id:'o'+n,type:'episode_outline',bodyJson:{episodeNo:n},bodyMarkdown:'EP'+n,version:1}));
 for(const mode of ['missing','stale','noack','valid','invalid']){
  const copies=[];
  const input={};
  const state={writes:{}};
  if(mode==='valid')for(const art of arts){
    const cached={...art,id:'seed/'+art.id,projectId:'new',version:1};
    state.writes[cached.id]={result:cached};
    copies.push({...cached,version:2});
  }
  const {missing,approved}=await populate({a:{id:'orch.batch_writer'},record:{requiredFields:{outline_ref:'@outline.text',episode_range:mode==='invalid'?'EPALL':'EP01–EP03'}},reviewed:{artifacts:mode==='missing'?arts.slice(0,2):arts},source:{},projectId:'new',input,inputs:[],state,section:'| `outline_ref` | 是 | 已 ack 的分集纲 |',get:async path=>path.endsWith('/artifacts')?copies:{progress:{logicAck:mode!=='noack',logicAckVersions:Object.fromEntries(copies.map(x=>[x.id,mode==='stale'?1:2]))}},write:async(k,m,p,b)=>{assert.ok(k.startsWith('seed/'));const x={...b,id:k,status:'adopted',version:2};copies.push(x);return x;}});
  assert.equal(verifiedGap('`outline_ref` needs verified approval',approved),mode==='valid');
  if(mode==='valid'){
    assert.deepEqual(input.outline_ref.map(x=>x.version),[2,2,2]);
    const hash=createHash('sha256').update(JSON.stringify(input.outline_ref)).digest('hex');
    assert.equal(state.fixtureEvidence.fields.outline_ref.valueHash,hash);
  }
  if(['missing','invalid'].includes(mode))assert.ok(missing.length);
  else assert.deepEqual(input.outline_ref.map(x=>x.episodeNo),[1,2,3]);
 }
});
