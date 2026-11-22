import test from 'node:test';
import assert from 'node:assert/strict';
import {retryRejectedModelRequest,jobRetryDecision,abortableDelay} from '../src/requestRetry.js';

test('local queuing retries the same model turn without replaying a job',async()=>{
 let calls=0,clock=0;const pauses=[];
 const result=await retryRejectedModelRequest(async()=>{
  if(++calls<3) throw Object.assign(new Error('busy'),{status:503,code:'local_queue_timeout',source:'local',retryable:true,retryAfter:1});
  return {content:'ok'};
 },{now:()=>clock,wait:async ms=>{pauses.push(ms);clock+=ms;},random:()=>0,maxWaitMs:5000});
 assert.equal(result.content,'ok');assert.equal(calls,3);assert.deepEqual(pauses,[1000,1000]);
});

test('retry budget is finite and respects the provider Retry-After',async()=>{
 let calls=0;const error=Object.assign(new Error('provider busy'),{status:429,source:'provider',retryable:true,retryAfter:60});
 await assert.rejects(retryRejectedModelRequest(async()=>{calls++;throw error;},{maxWaitMs:5000}),e=>e===error);
 assert.equal(calls,1);
});

test('quota and uncertain writes are never retried automatically',async()=>{
 for(const error of [Object.assign(new Error('quota'),{status:429,retryable:false}),Object.assign(new Error('write response lost'),{code:'mutation_result_unknown'})]) {
  let calls=0;await assert.rejects(retryRejectedModelRequest(async()=>{calls++;throw error;}),e=>e===error);
  assert.equal(calls,1);
 }
});

test('local capacity does not consume job failure attempts; provider failures are bounded',()=>{
 assert.deepEqual(jobRetryDecision({source:'local',retryable:true,status:503},3,3),{retry:true,nextAttempts:3,local:true});
 assert.equal(jobRetryDecision({source:'provider',retryable:true,status:429},3,3).retry,false);
 assert.equal(jobRetryDecision({retryable:false,status:429},0,3).retry,false);
});

test('abort interrupts queued delay immediately',async()=>{
 const controller=new AbortController();
 const pending=abortableDelay(60000,controller.signal);
 controller.abort(new Error('paused'));
 await assert.rejects(pending,/paused/);
});
