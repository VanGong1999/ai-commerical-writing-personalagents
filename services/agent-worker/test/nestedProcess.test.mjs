import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {runNestedProcess, nestedRunId, writeFrame} from '../src/nestedProcess.js';

test('frozen clock still yields unique sibling identities', () => {
  const original = Date.now;
  Date.now = () => 1;
  try { assert.equal(new Set(Array.from({length:128}, () => nestedRunId('p',1))).size,128); }
  finally { Date.now = original; }
});

test('large final UTF-8 frame drains before exit', async () => {
  const url = new URL('../src/nestedProcess.js', import.meta.url).href;
  const source = `import {writeFrame} from ${JSON.stringify(url)}; await writeFrame({kind:'result', result:'猫'.repeat(900000)}); process.exit(0)`;
  assert.equal(await runNestedProcess({args:['--input-type=module','-e',source]}),'猫'.repeat(900000));
});

for (const mode of ['abort','timeout']) test(mode+' closes a SIGTERM-ignoring child and removes abort listener',async () => {
  const controller = new AbortController();
  const source = "process.on('SIGTERM',()=>{}); console.log(JSON.stringify({kind:'event',event:process.pid})); setInterval(()=>{},1000)";
  let pid;
  await assert.rejects(runNestedProcess({args:['-e',source],signal:controller.signal,timeoutMs:1000,graceMs:30,
    publish:id=>{pid=id;if(mode==='abort') controller.abort();}}), mode==='abort'?/cancelled/:/timeout/);
  assert.ok(pid);
  assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
});

test('existing failed or successful proof wins over exceptional close; pre-proof cancellation writes once',async()=>{
  const {confirmNestedTerminal}=await import('../src/nestedProcess.js');
  for(const status of ['failed','succeeded',null]){
    const steps=status?[{kind:'run_end',payload:{child_run_id:'c',status}}]:[];
    const child={runId:'c',status:'cancelled',exitReason:'cancelled'};
    const confirm=()=>confirmNestedTerminal(child,async()=>({steps}),async payload=>steps.push({kind:'run_end',payload}));
    assert.equal((await confirm()).status,status||'cancelled');
    await confirm();
    assert.equal(steps.length,1);
    if(!status) assert.equal(steps[0].payload.event_id,'c:run_end');
  }
});
