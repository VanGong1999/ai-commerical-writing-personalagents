import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCompleteModelResponse} from '../src/modelResponse.js';

test('truncated tool calls cannot be executed',()=>{
 assert.throws(()=>assertCompleteModelResponse({choices:[{finish_reason:'length',message:{tool_calls:[{id:'partial'}]}}]}),/截断/);
});
test('reasoning-only output is never a completed answer',()=>{
 assert.throws(()=>assertCompleteModelResponse({choices:[{finish_reason:'stop',message:{content:'',reasoning_content:'thinking'}}]}),/没有返回/);
});
test('complete visible answer or native tool turn is accepted',()=>{
 assert.doesNotThrow(()=>assertCompleteModelResponse({choices:[{finish_reason:'stop',message:{content:'正文'}}]}));
 assert.doesNotThrow(()=>assertCompleteModelResponse({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'real',function:{name:'artifact_list',arguments:'{}'}}]}}]}));
});

test('malformed native call shape and incomplete XML cannot be accepted as final answers',()=>{
 for(const message of [{tool_calls:{}},{tool_calls:[{id:'x'}]},{content:'<tool_call>{broken</tool_call>'}]) {
  assert.throws(()=>assertCompleteModelResponse({choices:[{message,finish_reason:'stop'}]}));
 }
});

test('repairs a truncated response within one request turn without executing incomplete tools',async()=>{
 const {requestModelWithRecovery}=await import('../src/modelResponse.js');
 const messages=[{role:'user',content:'create one artifact'}]; let n=0;const usage=[];
 const result=await requestModelWithRecovery({messages, request:async()=>++n===1 ? {usage:{completion_tokens:8},choices:[{finish_reason:'length',message:{tool_calls:[{id:'partial'}]}}]} : {choices:[{finish_reason:'stop',message:{content:'usable'}}]},onCompletion:c=>usage.push(c.usage)});
 assert.equal(n,2);assert.equal(result.choices[0].message.content,'usable');
 assert.equal(messages.some(m=>m.tool_calls),false);assert.match(messages.at(-1).content,/截断/);assert.equal(usage.length,2);
});

test('overflow retries require meaningful reduction and unrelated errors never compact',async()=>{
 const {requestModelWithRecovery}=await import('../src/modelResponse.js');let n=0;let compacted=0;
 const messages=[{role:'user',content:'x'.repeat(4000)}];
 const result=await requestModelWithRecovery({messages,request:async()=>{if(++n===1)throw new Error('context_length_exceeded');return {choices:[{message:{content:'ok'}}]};},compact:async()=>{compacted++;return [{role:'user',content:'goal preserved'}];}});
 assert.equal(compacted,1);assert.equal(result.choices[0].message.content,'ok');
 await assert.rejects(requestModelWithRecovery({messages,request:async()=>{throw new Error('context length exceeded');},compact:async()=>messages}),/context length/);
 await assert.rejects(requestModelWithRecovery({messages,request:async()=>{throw new Error('HTTP 401');},compact:async()=>{throw new Error('must not run');}}),/401/);
});

test('bounded repair and cancellation prevent unbounded retry and reject partial XML batches',async()=>{
 const {requestModelWithRecovery}=await import('../src/modelResponse.js'); let attempts=0;
 await assert.rejects(requestModelWithRecovery({messages:[],request:async()=>{attempts++;return {choices:[{message:{reasoning_content:'private'}}]};}}),/没有返回/);
 assert.equal(attempts,3);
 const controller=new AbortController();controller.abort(new Error('cancelled'));
 await assert.rejects(requestModelWithRecovery({messages:[],signal:controller.signal,request:()=>{throw new Error('must not run');}}),/cancelled/);
 assert.throws(()=>assertCompleteModelResponse({choices:[{message:{content:'<minimax:tool_call><invoke name="read"></invoke><invoke name="write">'}}]}),/XML/);
});

test('explicit invalid provider envelope errors repair in-turn without retrying arbitrary HTTP errors',async()=>{
 const {requestModelWithRecovery}=await import('../src/modelResponse.js');let calls=0;const messages=[];
 const result=await requestModelWithRecovery({messages,request:async()=>{if(++calls===1)throw Object.assign(new Error('invalid JSON envelope'),{code:'invalid_model_response'});return {choices:[{message:{content:'ok'}}]};}});
 assert.equal(calls,2);assert.equal(result.choices[0].message.content,'ok');assert.match(messages[0].content,/协议修复/);
});

test('second invalid argument prevents dispatch of the whole native batch', async () => {
  const { requestModelWithRecovery } = await import('../src/modelResponse.js');
  const calls = ['{}', '[42]'].map((args, i) => ({
    id: String(i), function: {name: 'save', arguments: args}
  }));
  const writes = [];
  await assert.rejects(async () => {
    const result = await requestModelWithRecovery({
      request: async () => ({choices: [{message: {tool_calls: calls}}]}),
      messages: [], maxRepairs: 0,
    });
    writes.push(...result.choices[0].message.tool_calls);
  });
  assert.deepEqual(writes, []);
});

test('unknown wrapper targets block dispatch and literal commentary coexists with native calls', () => {
  const call = (id, name, args) => ({id, function: {name, arguments: JSON.stringify(args)}});
  const write = call('1', 'save', {});
  const validate = name => {
    if (!['save', 'tool.invoke', 'tool_invoke'].includes(name)) throw new Error('unknown target');
  };
  for (const message of [
    {tool_calls: [write, call('2', 'tool.invoke', {name:'missing', args:{}})]},
  ]) {
    const effects = [];
    assert.throws(() => {
      assertCompleteModelResponse({choices:[{message}]}, validate);
      effects.push(...message.tool_calls);
    });
    assert.deepEqual(effects, []);
  }
  for (const content of ['<invoke> 示例', '<tool_call>', '<｜DSML｜function_calls>', '<invoke-example>示例</invoke-example>', '示例：<tool_call>', '`<tool_call>`', '```xml\n<tool_call>\n```']) {
    assert.doesNotThrow(() => assertCompleteModelResponse({choices:[{message:{content, tool_calls:[write]}}]}, validate));
  }
});

test('provider failures and unsupported standalone DSML retain usage without effects', async () => {
  const {requestModelWithRecovery} = await import('../src/modelResponse.js');
  const write = {id:'write', function:{name:'save', arguments:'{}'}};
  const candidates = [
    {finish_reason:'error', message:{tool_calls:[write]}},
    ...['<|DSML|invoke name', '<｜DSML｜function_calls', '<|DSML|invoke/>',
      '<|DSML|invoke name="save"></|DSML|invoke>'].map(content => ({finish_reason:'stop', message:{content}})),
  ];
  for (const choice of candidates) {
    const effects = [], usage = [];
    await assert.rejects(async () => {
      const result = await requestModelWithRecovery({messages:[], maxRepairs:0,
        request:async () => ({choices:[choice], usage:{completion_tokens:19}}),
        onCompletion:response => usage.push(response.usage.completion_tokens)});
      effects.push(result.choices[0].message);
    });
    assert.deepEqual(effects, []);
    assert.deepEqual(usage, [19]);
  }
});

test('exhausted shared repair allowance blocks overflow summary; unproductive compaction stops the job',async()=>{
  const {requestModelWithRecovery}=await import('../src/modelResponse.js');
  const {jobRetryDecision}=await import('../src/requestRetry.js');
  for(const exhausted of [true,false]){
    let summaries=0;
    const messages=[{role:"user",content:"keep original"}];
    await assert.rejects(requestModelWithRecovery({messages,
      request:async()=>{throw Object.assign(new Error("maximum context length"),{retryable:true});},
      onRepair:async()=>{if(exhausted) throw Object.assign(new Error("repair budget"),{retryable:false});},
      compact:async()=>{summaries++;return messages;}
    }),err=>!jobRetryDecision(err,0,3).retry);
    assert.equal(summaries,exhausted?0:1);
  }
});
