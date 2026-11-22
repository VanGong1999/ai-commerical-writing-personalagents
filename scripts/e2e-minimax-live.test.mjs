import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('manual review resumes existing runs with version-bound approval',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'e2e-live-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const runs=[];
  const arts=[];
  let ack=false;
  const server=http.createServer(async(req,res)=>{
    const route=req.url.replace('/api/v1','');
    let data;
    if(route==='/agents/catalog') data={agents:['topic.logline_title','char.bible_big5','struct.chapter_outline','prose.novel_body','qc.de_ai'].map(id=>({id,formats:['*']}))};
    else if(route==='/projects') data={id:'p'};
    else if(route==='/runs') {
      const run='r'+runs.length;
      let raw='';
      for await (const chunk of req) raw+=chunk;
      const input=JSON.parse(raw).inputJson;
      assert.equal(input.chapter_no,1);
      assert.equal(input.ep_no,undefined);
      if (runs.length===4) assert.equal(input.selectedBodyId,'ar3');
      runs.push(run);
      if(runs.length<=4) arts.push({id:'a'+run,type:['logline','character','chapter_outline','manuscript'][runs.length-1],version:1,createdByRunId:run,bodyMarkdown:'章'.repeat(350)});
      if(runs.length===4) arts.push({...arts.at(-1),id:'alternate'});
      data={id:run};
    } else if(route.endsWith('/replay')) data={steps:[{kind:'tool_result',payload:{id:'g',name:'gate_run',result:JSON.stringify({passed:true,checks:[{id:'deai_checklist',result:'pass'}]})}},{kind:'tool_call',payload:{id:'g',name:'gate_run',args:{name:'DeAIChecklist',payload:{artifactId:'ar3'}}}}]};
    else if(route.startsWith('/runs/')) data={status:'succeeded',model:'MiniMax-mock',tokenCompletion:10,gateResults:[{id:'deai_checklist',result:'pass'}]};
    else if(route.startsWith('/usage')) data=runs.map(runId=>({runId,model:'MiniMax-test',completionTokens:10}));
    else if(route.endsWith('/versions')) data=route.includes('alternate')?[{version:1}]:[];
    else if(route.startsWith('/context/artifacts/') && route.endsWith('/text')) data={projectId:'p',version:1,text:'章'.repeat(350)};
    else if(route.endsWith('/artifacts')) data=arts;
    else if(route.endsWith('/logic-ack')) {
      let body='';
      for await (const part of req) body+=part;
      assert.deepEqual(JSON.parse(body).expectedVersions,Object.fromEntries(arts.map(a=>[a.id,1])));
      ack=true;data={logicAck:true};}
    else if(route==='/projects/p') data={progress:{logicAck:ack,logicAckVersions:ack ? Object.fromEntries(arts.map(a=>[a.id,1])) : {}}};
    else {res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(data));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const source=join(dir,'source.txt');
  const report=join(dir,'report.json');
  await writeFile(source,'原创输入'.repeat(30));
  const execute=(approval,choice)=>promisify(execFile)(process.execPath,['scripts/e2e-minimax-live.mjs','short_novel',report],{env:{...process.env,E2E_API_BASE:'http://127.0.0.1:'+server.address().port,E2E_SOURCE_FILE:source,E2E_BODY_ARTIFACT_ID:choice,E2E_REVIEW_APPROVAL:approval}});
  await assert.rejects(execute(''),/E2E_BODY_ARTIFACT_ID/);
  assert.equal(runs.length,4);
  await assert.rejects(execute('','ar3'),/REVIEW_REQUIRED/);
  await assert.rejects(execute('','alternate'),/QC_VERSION_DRIFT/);
  assert.equal(ack,false);
  const state=JSON.parse(await readFile(report));
  arts[3].version=2;
  await assert.rejects(execute(state.reviewToken),/QC_VERSION_DRIFT/);
  assert.equal(ack,false);
  arts[3].version=1; // independent legacy-report fixture
  const legacy=structuredClone(state);
  delete legacy.steps.qc.reviewTarget;
  await writeFile(report,JSON.stringify(legacy));
  await assert.rejects(execute(state.reviewToken,'ar3'),/QC_TARGET_VERSION_UNKNOWN/);
  assert.equal(ack,false);
  await writeFile(report,JSON.stringify(state));
  await execute(state.reviewToken);
  assert.equal(ack,true);
  assert.equal(runs.length,5);
  assert.equal(JSON.parse(await readFile(report)).status,'passed');
});

test('ambiguous stop reconciles the admitted run without a second POST',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'e2e-live-stop-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let stopped=false;
  let stops=0;
  const server=http.createServer((req,res)=>{
    const path=req.url.replace('/api/v1','');
    let data;
    if(path==='/agents/catalog') data={agents:[{id:'orch.writing',formats:['*']}]};
    else if(path==='/runs/r') data={status:stopped?'cancelled':'running'};
    else if(path==='/runs/r/replay') data={steps:[]};
    else if(path==='/tasks/runs/r/stop') {stopped=true;stops++; res.destroy();return;}
    else {res.writeHead(404);res.end();return;}
    res.end(JSON.stringify(data));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const file=join(dir,'report.json');
  const base='http://127.0.0.1:'+server.address().port;
  await writeFile(file,JSON.stringify({base,scenario:'single',steps:{project:{id:'p'},parent:{id:'r',submittedAt:1}}}));
  await assert.rejects(promisify(execFile)(process.execPath,['scripts/e2e-minimax-live.mjs','single',file],{env:{...process.env,E2E_API_BASE:base}}),/deadline reached/);
  const {steps}=JSON.parse(await readFile(file));
  assert.equal(stops,1);
  assert.equal(steps.parent.status,'cancelled');
  assert.ok(steps.parent.stopIntent);
  assert.deepEqual(steps.parent.unresolvedIds,[]);
});

test('terminal parent retains known children across a replay failure and incomplete snapshot',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'e2e-live-replay-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let reads=0;
  const server=http.createServer((req,res)=>{
    const route=req.url.replace('/api/v1','');
    let data;
    if(route==='/agents/catalog') data={agents:[{id:'orch.writing',formats:['*']}]};
    else if(route==='/runs/r') data={status:'succeeded'};
    else if(route==='/runs/r/replay') {
      reads++;
      if(reads===1) {res.writeHead(400); res.end(); return;}
      data={steps:reads===2?[]:['child','other'].map(child_run_id=>({kind:'run_end',payload:{child_run_id,status:'cancelled'}}))};
    } else {res.writeHead(404);res.end();return;}
    res.end(JSON.stringify(data));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const file=join(dir,'report.json');
  const base='http://127.0.0.1:'+server.address().port;
  await writeFile(file,JSON.stringify({base,scenario:'single',steps:{project:{id:'p'},parent:{id:'r',childAtCancel:'child',observedChildren:{other:{id:'other'}}}}}));
  await assert.rejects(promisify(execFile)(process.execPath,['scripts/e2e-minimax-live.mjs','single',file],{env:{...process.env,E2E_API_BASE:base}}),/400/);
  assert.equal(reads,3);
  const step=JSON.parse(await readFile(file)).steps.parent;
  assert.equal(step.observedChildren.child.status,'cancelled');
  assert.equal(step.observedChildren.other.status,'cancelled');
  assert.deepEqual(step.unresolvedIds,[]);
});

test('nested cancellation rejects pre-inference child terminal evidence',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'e2e-pre-inference-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const server=http.createServer((req,res)=>{
    const path=req.url.replace('/api/v1','');
    let data;
    if(path==='/agents/catalog') data={agents:[{id:'orch.writing',formats:['*']}]};
    else if(path==='/runs/r') data={status:'cancelled'};
    else if(path==='/runs/r/replay') data={steps:[
      {kind:'tool_call',payload:{id:'spawn',name:'subagent_spawn',args:{agentId:'topic.logline_title'}}},
      {kind:'run_end',actor:'agent:topic.logline_title',payload:{child_run_id:'child',status:'cancelled'}}]};
    else if(path.startsWith('/usage')) data=['r','child'].map(runId=>({runId,model:'MiniMax-test'}));
    else {res.writeHead(404);res.end();return;}
    res.end(JSON.stringify(data));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const file=join(dir,'report.json');
  const base='http://127.0.0.1:'+server.address().port;
  await writeFile(file,JSON.stringify({base,scenario:'nested-cancel',steps:{project:{id:'p'},parent:{id:'r',submittedAt:1,childAtCancel:'child',stopIntent:true}}}));
  await assert.rejects(promisify(execFile)(process.execPath,['scripts/e2e-minimax-live.mjs','nested-cancel',file],{env:{...process.env,E2E_API_BASE:base}}),/missing child inference/);
});

test('scene body submission requests full canonical screenplay at episode length',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'e2e-scene-input-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const ids=['topic.want_how','char.bible_big5','struct.ep_outline_duanju','scene.triple'];
  const arts=['topic_card','character','episode_outline'].map((type,i)=>({id:'a'+i,type,version:1,createdByRunId:ids[i],bodyMarkdown:'素材'.repeat(30)}));
  let submitted;
  const server=http.createServer(async(req,res)=>{
    const path=req.url.replace('/api/v1','');
    let data;
    if(path==='/projects') data={id:'p'};
    else if(path==='/agents/catalog') data={agents:ids.map(id=>({id,formats:['duanju']}))};
    else if(path==='/runs'){
      let raw='';
      for await(const chunk of req) raw+=chunk;
      const body=JSON.parse(raw);
      if(body.agentId==='scene.triple'){
        submitted=body.inputJson;
        res.writeHead(400);res.end('fixture captured body');return;
      }
      data={id:body.agentId};
    } else if(path.endsWith('/replay')) data={steps:[]};
    else if(path.startsWith('/runs/')) data={status:'succeeded',model:'MiniMax-test',tokenCompletion:1};
    else if(path.startsWith('/usage')) data=ids.map(runId=>({runId,model:'MiniMax-test'}));
    else if(path.endsWith('/artifacts')) data=arts;
    else {res.writeHead(404);res.end();return;}
    res.end(JSON.stringify(data));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const source=join(dir,'source');
  await writeFile(source,'原创素材'.repeat(30));
  await assert.rejects(promisify(execFile)(process.execPath,['scripts/e2e-minimax-live.mjs','duanju',join(dir,'report')],{env:{...process.env,E2E_API_BASE:'http://127.0.0.1:'+server.address().port,E2E_SOURCE_FILE:source}}),/400/);
  assert.match(submitted.task,/bodyJson\.script_body/);
  assert.match(submitted.task,/完整剧本正文/);
  assert.match(submitted.task,/至少800个汉字/);
  assert.match(submitted.task,/同一地点/);
});

test('dead lease recovery, exclusive live owner, and SIGTERM during admission',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'e2e-signal-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,'report');
  const dead=promisify(execFile)(process.execPath,['-e','']);
  const pid=dead.child.pid;
  await dead;
  await writeFile(file+'.lock',String(pid));
  const admission=Promise.withResolvers();
  let posts=0, stops=0;
  const server=http.createServer((req,res)=>{
    const path=req.url.replace('/api/v1','');
    let data;
    if(path==='/agents/catalog') data={agents:[{id:'orch.writing',formats:['*']}]};
    else if(path==='/runs') {posts++; admission.resolve(res);return;}
    else if(path==='/runs/r') data={status:stops?'cancelled':'running'};
    else if(path==='/tasks/runs/r/stop') {stops++;data={};}
    else if(path==='/runs/r/replay') data={steps:[{kind:'run_end',payload:{child_run_id:'c',status:'cancelled'}}]};
    else if(path.startsWith('/usage')) data=[];
    else {res.writeHead(404);res.end();return;}
    res.end(JSON.stringify(data));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  await writeFile(file,JSON.stringify({base,scenario:'single',steps:{project:{id:'p'}}}));
  const execute=()=>promisify(execFile)(process.execPath,['scripts/e2e-minimax-live.mjs','single',file],{env:{...process.env,E2E_API_BASE:base}});
  const owner=execute();
  const pending=await Promise.race([admission.promise,owner]);
  await assert.rejects(execute(),/database is locked/);
  owner.child.kill('SIGTERM');
  pending.end(JSON.stringify({id:'r'}));
  await assert.rejects(owner,/interrupted by SIGTERM/);
  const state=JSON.parse(await readFile(file));
  assert.equal(state.status,'blocked');
  assert.equal(state.steps.parent.observedChildren.c.status,'cancelled');
  assert.deepEqual(state.steps.parent.unresolvedIds,[]);
  await assert.rejects(execute(),/missing actual usage/);
  assert.equal(posts,1);
  assert.equal(stops,1);
});
