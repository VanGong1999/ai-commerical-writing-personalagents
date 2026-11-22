import test from 'node:test';
import assert from 'node:assert/strict';
import {compactMessagesAsync} from './context.ts';

test('repeated compaction consolidates prior evidence instead of nesting summary archives',async()=>{
 let messages:any[]=[{role:'system',content:'static'},{role:'user',content:'goal'},{role:'assistant',tool_calls:[{id:'write',function:{name:'artifact_create',arguments:'{}'}}]},{role:'tool',tool_call_id:'write',content:JSON.stringify({id:'stable-artifact',version:3,ok:true})}];
 const sizes:number[]=[];
 for(let i=0;i<8;i++){
  messages.push(...Array.from({length:10},()=>({role:'assistant',content:'irrelevant '.repeat(100)})));
  const r=await compactMessagesAsync(messages,{triggerTokens:1,keepTailTokens:50},async()=> 'Consolidated current task notes. '+ 'Memo '.repeat(400));messages=r.messages;sizes.push(JSON.stringify(messages).length);
  assert.match(JSON.stringify(messages),/stable-artifact/);
 }
 assert.ok(sizes[7]<sizes[0]+1000,JSON.stringify(sizes));
});

test('obsolete read receipts are bounded while writes, uncertainty and source URLs survive',async()=>{
 const messages:any[]=[{role:'system',content:'S'},{role:'user',content:'goal'}];
 for(let i=0;i<100;i++)messages.push({role:'assistant',tool_calls:[{id:`r${i}`,function:{name:'artifact_list',arguments:'{}'}}]},{role:'tool',tool_call_id:`r${i}`,content:JSON.stringify({id:`view${i}`,version:1})});
 messages.push({role:'assistant',tool_calls:[{id:'write',function:{name:'artifact_create',arguments:'{}'}}]},{role:'tool',tool_call_id:'write',content:JSON.stringify({id:'created',requiresVerification:true,status:'mutation_result_unknown'})});
 messages.push({role:'assistant',tool_calls:[{id:'search',function:{name:'web_search',arguments:'{}'}}]},{role:'tool',tool_call_id:'search',content:JSON.stringify({results:[{url:'https://example.org/source'}]})});
 messages.push(...Array.from({length:10},()=>({role:'assistant',content:'old observations '.repeat(200)})));
 const r=await compactMessagesAsync(messages,{triggerTokens:1,keepTailTokens:20},async()=> 'Work summary has been consolidated with current progress and pending decisions.');
 const text=JSON.stringify(r.messages);assert.match(text,/created/);assert.match(text,/mutation_result_unknown/);assert.match(text,/https:\/\/example.org\/source/);assert.ok(text.length<7000,text.length.toString());
});

test('deterministic fallback preserves unresolved error and next-action sections',async()=>{
 const messages:any[]=[{role:'system',content:'S'},{role:'user',content:'goal'},{role:'assistant',tool_calls:[{id:'fail',function:{name:'artifact_create',arguments:'{}'}}]},{role:'tool',tool_call_id:'fail',content:'ERROR result unknown; inspect saved artifact before retry'},...Array.from({length:12},()=>({role:'assistant',content:'x'.repeat(1000)}))];
 const r=await compactMessagesAsync(messages,{triggerTokens:1,keepTailTokens:10},async()=>{throw new Error('provider unavailable')});
 const text=JSON.stringify(r.messages);assert.match(text,/### 未解决错误/);assert.match(text,/### 下一步/);assert.match(text,/inspect saved artifact/);
});

test('superseded revisions remain in replay and archive counts survive recompaction',async()=>{
 const messages:any[]=[{role:'user',content:'locked user constraints'}];
 for(let version=1;version<=240;version++) messages.push(
  {role:'assistant',tool_calls:[{id:'rev'+version,function:{name:'artifact_update',arguments:'{}'}}]},
  {role:'tool',tool_call_id:'rev'+version,content:JSON.stringify({ok:true,id:'artifact',version})});
 messages.push({role:'assistant',content:'tail'});
 const input=JSON.stringify(messages);
 const cfg={triggerTokens:1,keepTailTokens:1};
 const first=await compactMessagesAsync(messages,cfg);
 const second=await compactMessagesAsync([...first.messages,{role:'assistant',content:'next'}],cfg);
 for(const r of [first,second]){
  const memo=r.messages.find(m=>Array.isArray(m.compactionEvidence))!;
  assert.equal(memo.archivedReceiptCount,239);
  assert.match(String(memo.content),/rev240/);
  assert.equal(r.messages[0].content,'locked user constraints');
 }
 assert.equal(JSON.stringify(messages),input);
});
