import test from 'node:test';
import assert from 'node:assert/strict';
import {notifyFleetTerminal} from '../src/fleetLifecycle.js';

test('queued retries and paused workers cannot terminate fleet members',async()=>{
  const api={getJob(){throw new Error('must not notify');}};
  for(const status of ['queued','paused','running','lease_lost','interrupted'])
    await notifyFleetTerminal(api,'job','run',status);
});

test('final failure and success notify the matching fleet member',async()=>{
  const calls=[];
  const api={getJob:async()=>({payload:{fleetId:'f',fleetIndex:1,input:{fleetMember:'角色'}}}),
    patchFleetMember:async(...args)=>calls.push(args)};
  await notifyFleetTerminal(api,'job','run','failed','exhausted');
  await notifyFleetTerminal(api,'job','run','succeeded','complete');
  assert.deepEqual(calls.map(c=>c[1].status),['failed','done']);
  assert.equal(calls[0][1].index,1);
  assert.equal(calls[0][1].runId,'run');
});
