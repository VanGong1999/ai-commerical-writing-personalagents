import test from 'node:test';
import assert from 'node:assert/strict';
import {waitBeforeJobRetry} from '../src/retryControl.js';

test('pause during retry backoff releases lease with checkpoint instead of leaving a running job',async()=>{
 const calls=[];const controller=new AbortController();
 const pending=waitBeforeJobRetry(60000,{signal:controller.signal,api:{releaseLease:async(...args)=>calls.push(args)},
   jobId:'j',runId:'r',owner:'owner',leaseVersion:2,checkpoint:{turn:5}});
 controller.abort(new Error('paused'));
 assert.equal(await pending,false);
 assert.deepEqual(calls,[['r',{owner:'owner',leaseVersion:2,state:'paused',checkpoint:{turn:5}}]]);
});

test('stop during retry backoff finalizes cancellation; lost lease writes nothing',async()=>{
 for(const reason of ['cancelled','lease_lost','interrupted']) {
  const calls=[];const controller=new AbortController();
  const api={patchRunStatus:async(...args)=>calls.push(['run',...args]),patchJobStatus:async(...args)=>calls.push(['job',...args])};
  const pending=waitBeforeJobRetry(60000,{signal:controller.signal,api,jobId:'j',runId:'r',leaseVersion:2,
    notifyTerminal:async(...args)=>calls.push(['fleet',...args])});
  controller.abort(new Error(reason));assert.equal(await pending,false);
  if(reason==='lease_lost') assert.equal(calls.length,0);
  if(reason==='cancelled') assert.deepEqual(calls.map(c=>c[0]),['run','job','fleet']);
  if(reason==='interrupted') assert.deepEqual(calls.slice(0,2).map(c=>c[2].status),['queued','queued']);
 }
});
