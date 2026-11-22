import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {api} from '../src/apiClient.js';
import {buildProviderTool, validateArgs} from '../src/toolSchema.js';
import {createWritingTools} from '../src/tools.js';

// Native artifact_create at step 34 of the captured MiniMax run and its uploaded document.
const capture = JSON.parse(readFileSync(new URL('./fixtures/knowledge-report-native.json', import.meta.url), 'utf8'));
function knowledgeCreate() {
  const {projectId, runId, jobId, agentId, roleVersion, docId} = capture;
  const tools = createWritingTools({projectId, runId, jobId, parentAgentId:agentId,
    knowledge:{version:roleVersion, documentIds:[docId]}, allowlist:['artifact_create'], publish(){}});
  return tools.find(tool => tool.name === 'artifact_create');
}

test('the custom provider schema describes the required knowledge report and its citation fields', () => {
  const schema = buildProviderTool(knowledgeCreate()).function.parameters;
  const args = capture.args;
  assert.equal(validateArgs(args, schema).ok, true);
  for (const key of ['verified', 'unknowns', 'citations']) {
    const input = structuredClone(args);
    delete input.bodyJson[key];
    assert.equal(validateArgs(input, schema).error?.field, 'bodyJson/' + key);
  }
  for (const key of ['docId', 'quote', 'offset']) {
    const input = structuredClone(args);
    delete input.bodyJson.citations[0][key];
    assert.equal(validateArgs(input, schema).error?.field, 'bodyJson/citations/0/' + key);
  }
  const {bodyJson} = args;
  const cite = bodyJson.citations[0];
  for (const invalid of [
    {verified:bodyJson.unknowns}, {unknowns:[bodyJson.unknowns[0], 1]},
    {citations:[]}, {citations:Array(25).fill(cite)},
    {citations:[{...cite, quote:null}]}, {citations:[{...cite, offset:'9.3e1'}]},
  ]) {
    assert.equal(validateArgs({...args, bodyJson:{...bodyJson, ...invalid}}, schema).ok, false);
  }
  assert.equal(validateArgs({...args, bodyJson:undefined}, schema).ok, false);
  assert.equal(validateArgs({...args, type:'other'}, schema).ok, false);
});

test('native report reaches the writer with every unknown, exact source bytes and numeric citation positions', async t => {
  const tool = knowledgeCreate();
  const {args, source, sourceHash, projectId, runId, jobId, agentId, roleVersion} = capture;
  const original = structuredClone(args);
  const positions = [93, 105, 340];
  const proposed = args.bodyJson.citations.map(({docId, quote}, index) => {
    const offset = positions[index];
    assert.equal(source.indexOf(quote), offset);
    assert.equal(source.lastIndexOf(quote), offset);
    return {docId, quote, offset};
  });
  assert.equal(createHash('sha256').update(source).digest('hex'), sourceHash);
  const anchors = proposed.map(cite => ({...cite, providedOffset:cite.offset, sourceHash}));
  const verification = t.mock.method(api, 'knowledgeCitations', async () => ({citations:anchors}));
  t.mock.method(api, 'knowledgeReports', async () => []);
  const write = t.mock.method(api, 'createArtifact', async () => { throw Error('offline test stops at writer'); });

  const legacy = {...args, bodyJson:{...args.bodyJson, unknowns:args.bodyJson.unknowns[0], citations:proposed}};
  for (const input of [args, legacy]) {
    const checked = validateArgs(input, tool.parameters);
    assert.equal(checked.ok, true);
    const result = await tool.execute('capture', checked.args);
    assert.deepEqual(verification.mock.calls.at(-1)?.arguments, [runId, jobId, roleVersion, proposed], result.content[0].text);
    const items = input.bodyJson.unknowns;
    const expected = {...input.bodyJson, citations:anchors, agentId, roleVersion};
    if (Array.isArray(items)) Object.assign(expected, {unknownItems:items, unknowns:items.join('\n')});
    assert.deepEqual(write.mock.calls.at(-1)?.arguments, [projectId, {
      type:args.type, title:args.title, bodyMarkdown:args.bodyMarkdown, bodyJson:expected,
      status:'candidate', createdByRunId:runId,
    }], result.content[0].text);
  }
  assert.equal(verification.mock.callCount(), 2);
  assert.equal(write.mock.callCount(), 2);
  assert.deepEqual(args, original, 'the native tool arguments remain available for replay');
});

test('malformed unknown items and offsets stop before authorized citation verification', async t => {
  const tool = knowledgeCreate();
  const verification = t.mock.method(api, 'knowledgeCitations', async () => assert.fail('unexpected source read'));
  const submit = async bodyJson => {
    const result = await tool.execute('invalid', {...capture.args, bodyJson});
    return JSON.parse(result.content[0].text);
  };
  const body = capture.args.bodyJson;
  for (const unknowns of [[], [body.unknowns[0], 1], [' '], null]) {
    const rejected = await submit({...body, unknowns});
    assert.equal(rejected.ok, false);
    assert.match(rejected.message, /unknowns/);
  }
  assert.match((await submit({...body, unknownItems:body.unknowns.slice(1)})).message, /unknownItems/);
  for (const offset of ['93x', '93.0', '9.3e1', '+93', ' 93', '093', '-1', '9007199254740992',
    Number.MAX_SAFE_INTEGER + 1, -1, 1.5, true, null, [93]]) {
    const rejected = await submit({...body, citations:[{...body.citations[0], offset}]});
    assert.equal(rejected.ok, false);
    assert.match(rejected.message, /offset/, String(offset));
  }
  assert.equal(verification.mock.callCount(), 0);
});

test('knowledge Schema tracks current authorized quotes and the exact saved artifact version', async t => {
  const actor='adviser', runId='r', knowledge={documentIds:['A'],version:'v'};
  let digest='digest1', available=true;
  const quote='字据', original={docId:'A',quote,offset:3};
  const body={verified:'字据留存',unknowns:'发行地点待查',agentId:actor,roleVersion:'v',
    citations:[{...original,providedOffset:2,sourceHash:digest}]};
  const art={id:'report',type:'qc_report',status:'candidate',createdByRunId:runId,versionActor:'agent:'+runId,version:1,bodyJson:body};
  const rows=[art];
  t.mock.method(api,'listArtifacts',async()=>assert.fail('custom role must not load project artifacts'));
  t.mock.method(api,'knowledgeReports',async()=>rows);
  t.mock.method(api,'knowledgeCitations',async(_run,_job,_version,citations)=>{
    if (!available) throw new Error('授权资料不可读');
    return {citations:citations.map(c=>({...c,providedOffset:c.offset,offset:3,sourceHash:digest}))};
  });
  const tools=createWritingTools({knowledge, runId, jobId:'j', projectId:'p', parentAgentId:actor,
    allowlist:['gate_run','done_check'], allowedGateNames:['Schema'], publish(){},
    doneContract:[{type:'artifact_count',artifact:'qc_report',min:1},{type:'gate_pass',gates:['Schema']}]});
  const invoke=(name,args)=>tools.find(t=>t.name===name).execute('call',args);
  const schema=async()=>JSON.parse((await invoke('gate_run',{name:'Schema',payload:{artifactId:'report'}})).content[0].text);
  const done=async()=>(await invoke('done_check',{})).details.ok;
  assert.equal((await schema()).passed,true);
  assert.equal(await done(),true);
  available=false;
  assert.equal((await schema()).passed,false);
  available=true;
  assert.equal(await done(),false,'failed Schema supersedes the old pass');
  assert.equal((await schema()).passed,true);
  art.version++;
  assert.equal(await done(),false,'new persisted version needs its own Schema');
  assert.equal((await schema()).passed,true);
  assert.deepEqual(tools._gateEvidence.Schema.evidence,{source:'knowledge_report',artifactId:'report',version:2,versionActor:'agent:'+runId});
  digest='digest2';
  await tools._recheckKnowledgeSchema(rows);
  assert.equal(tools._gateEvidence.Schema.result,'fail','terminal snapshot rechecks source digest');
  body.citations=[original]; // previously validated report with only exact-offset metadata
  assert.equal((await schema()).passed,true);
  assert.equal(await done(),true);
  assert.deepEqual(body.citations,[original],'validation preserves historical bytes');
  body.citations=[{...original,offset:2}];
  assert.equal((await schema()).passed,false,'old-format reports require their original exact anchor');
  body.citations=[{...original,providedOffset:String(original.offset),sourceHash:digest}];
  assert.equal((await schema()).passed,false,'saved anchor metadata must retain its integer type');
  body.citations=[original];
  body.unknowns=[body.unknowns];
  assert.equal((await schema()).passed,false,'saved reports must already have canonical unknown text');
});

test('custom worker replays only execution steps under the same authorization',async()=>{
  const {knowledgeReplaySteps}=await import('../src/runSession.js');
  const admission=[{kind:'dispatch',actor:'chief',payload:{event:'plan'}},
    {kind:'tool_result',actor:'chief',payload:{event:'tool_result',tool:'run_agent'}}];
  assert.deepEqual(knowledgeReplaySteps(admission,'v1'),[]);
  const steps=[{kind:'run_start',payload:{roleVersion:'v1'}},{kind:'tool_call',payload:{id:'c',turn_id:'t'}}];
  assert.deepEqual(knowledgeReplaySteps([...admission,...steps],'v1'),steps);
  assert.throws(()=>knowledgeReplaySteps(steps,'v2'));
  assert.throws(()=>knowledgeReplaySteps([steps[1]],'v1'));
});

test('knowledge inspection only exposes receipts from the authorized output endpoint',async t=>{
  const forbidden=t.mock.method(api,'listArtifacts',async()=>{throw Error('unexpected project read')});
  const scope=t.mock.method(api,'knowledgeOutputs',async()=>({artifacts:[{id:'r1',version:1,status:'candidate'}]}));
  const tools=createWritingTools({projectId:'p',jobId:'j',runId:'r',parentAgentId:'adviser',knowledge:{version:'v'},
    allowlist:['kb_read','done_check'],publish(){}});
  const inspect=tools._allGated.find(t=>t.name==='artifact_list');
  const output=await inspect.execute('c',{});
  assert.deepEqual(JSON.parse(output.content[0].text).artifacts,[{id:'r1',version:1,status:'candidate'}]);
  assert.deepEqual(scope.mock.calls[0].arguments,['r','j','v']);assert.equal(forbidden.mock.callCount(),0);
  assert.equal(tools._allGated.some(t=>t.name==='tool_invoke' || t.name==='memory_search'),false);
});

test('worker ledger keeps the admitted root job when writing child and custom events', async t => {
  const {persistEvent,runNestedAgentJob} = await import('../src/runSession.js');
  const writes=t.mock.method(api,'appendRunStep',async()=>({ok:true}));
  const root={controlJobId:'job',knowledgeActor:'uuid',append(){}};
  await persistEvent(root,{type:'run_start',runId:'r',agentId:'uuid',payload:{roleVersion:'v'}});
  const child={controlRunId:'r',controlJobId:'job',parentRunId:'r',append(){}};
  await persistEvent(child,{type:'thinking',runId:'nested_r_1_abc_run',agentId:'char.bio_manju',payload:{}});
  assert.deepEqual(writes.mock.calls.map(c=>[c.arguments[0],c.arguments[1].job_id,c.arguments[1].actor]),
    [['r','job','uuid'],['r','job','agent:char.bio_manju']]);
  const payload=writes.mock.calls[1].arguments[1].payload;
  assert.equal(payload.child_run_id,'nested_r_1_abc_run');
  assert.equal(payload.parent_run_id,'r');
  const admissionRejected=new Error('test admission rejected before starting child');
  await assert.rejects(runNestedAgentJob({agentId:'char.bio_manju',projectId:'p',parentRunId:'r',depth:1,
    input:{},admitChild:async id=>{assert.match(id,/^nested_r_1_.+_run$/);throw admissionRejected;}}),
    error=>error===admissionRejected);
});

const group = JSON.parse(readFileSync(new URL('./fixtures/knowledge-group-native.json', import.meta.url), 'utf8'));
const groupReceipt = JSON.parse(group.results[0].result);

test('a fresh Schema and Done cannot certify a user edit of the recorded group candidate', async t => {
  const role = group.roles[1], native = group.calls[0].args;
  const anchors = native.bodyJson.citations.map(c => {
    const offset = capture.source.indexOf(c.quote);
    assert.ok(offset >= 0);
    assert.equal(capture.source.lastIndexOf(c.quote), offset);
    return {...c, offset, providedOffset:Number(c.offset), sourceHash:capture.sourceHash};
  });
  const row = {...groupReceipt, bodyMarkdown:native.bodyMarkdown, versionActor:'agent:'+role.runId,
    bodyJson:{...native.bodyJson, unknownItems:native.bodyJson.unknowns, unknowns:native.bodyJson.unknowns.join('\n'),
      citations:anchors, agentId:role.id, roleVersion:role.version}};
  t.mock.method(api,'knowledgeReports',async()=>[row]);
  t.mock.method(api,'knowledgeCitations',async()=>({citations:anchors}));
  const tools = createWritingTools({knowledge:role,runId:role.runId,jobId:group.jobId,projectId:role.runProjectId,
    parentAgentId:role.id,allowlist:role.tools,allowedGateNames:['Schema'],publish(){},
    doneContract:[{type:'artifact_count',artifact:'qc_report',min:1},{type:'gate_pass',gates:['Schema']}]});
  const call = (name, args) => tools.find(tool=>tool.name===name).execute('test',args);
  const schema = async () => JSON.parse((await call('gate_run',{name:'Schema',payload:{artifactId:row.id}})).content[0].text);
  assert.equal((await schema()).passed,true);
  assert.equal((await call('done_check',{})).details.ok,true);
  row.bodyMarkdown = '作者修订正文';
  row.version++;
  for (const actor of ['user', null, 'agent:'+group.roles[0].runId]) {
    row.versionActor = actor;
    assert.equal((await schema()).passed,false);
    assert.equal((await call('done_check',{})).details.ok,false);
  }
});

test('both real group recipients keep the overall request and their own assignment at the model boundary', async t => {
  const {runAgentJob} = await import('../src/runSession.js');
  const {mkdtempSync, rmSync} = await import('node:fs');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'group-leaf-'));
  t.mock.method(api,'bootstrapMemoryMounts',async()=>assert.fail('private memory read'));
  for (const key of Object.keys(api)) {
    if (typeof api[key] === 'function' && !api[key].mock) t.mock.method(api,key,async()=>[]);
  }
  const previous = process.env.AGENT_SESSION_ROOT;
  process.env.AGENT_SESSION_ROOT = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.AGENT_SESSION_ROOT;
    else process.env.AGENT_SESSION_ROOT = previous;
    rmSync(dir,{recursive:true,force:true});
  });
  for (const [index, role] of group.roles.entries()) {
    api.knowledgeRole = async () => ({...role, custom:true, formats:['manju'], canReviseOwnReport:true});
    const requests = [];
    api.agentChat = async request => { requests.push(request); throw Error('stop before real provider'); };
    try {
      await runAgentJob({job:{id:group.jobId, projectId:role.runProjectId,payload:{}},
        run:{id:role.runId,agentId:role.id,inputJson:{assistantPrompt:group.prompt,label:role.name}},publish(){}});
    } catch (error) { assert.match(error.message,/stop before real provider/); }
    assert.ok(requests.length);
    const {messages,tools} = requests[0];
    assert.ok(messages[0].content.includes(role.name+'（'+role.id+'）'));
    assert.match(messages[0].content,/其他同事由系统分别派单/);
    assert.match(messages[0].content,/只在用户需要时展开推断或创作建议/);
    assert.ok(messages.some(m => m.role === 'user' && m.content.includes(group.prompt)));
    assert.ok(!JSON.stringify(messages).includes(group.roles[1-index].id));
    assert.ok(tools.some(t => t.function.name === 'artifact_update'));
  }
});

test('the two recorded creates yield one owned receipt, and revision uses only the bound CAS endpoint', async t => {
  const role = group.roles[1], [first,second] = group.calls.map(c => c.args);
  const makeTools = grants => createWritingTools({knowledge:{...role,...grants}, runId:role.runId,
    projectId:role.runProjectId, parentAgentId:role.id, jobId:group.jobId, leaseVersion:7,
    allowlist:role.tools, publish(){}});
  const tools = makeTools({canReviseOwnReport:true});
  const forbidden = makeTools({canReviseOwnReport:false});
  const search = async ts => JSON.parse((await ts.find(t=>t.name==='tool_search').execute(
    'search',{query:'artifact_update'})).content[0].text).tools.map(t=>t.name);
  assert.ok((await search(tools)).includes('artifact_update'));
  assert.ok(!(await search(forbidden)).includes('artifact_update'));
  for (const names of [forbidden._catalogNames,forbidden._initialVisibleNames,[...forbidden._callableSet]])
    assert.ok(!names.includes('artifact_update'));
  const row = {...first,...groupReceipt,bodyJson:{...first.bodyJson, agentId:role.id,roleVersion:role.version}};
  t.mock.method(api,'knowledgeReports',async()=>[row]);
  const checked = t.mock.method(api,'knowledgeCitations',async(_r,_j,_v,cites)=>({citations:cites.map(c=>{
    const offset = capture.source.indexOf(c.quote);
    assert.ok(offset >= 0);
    return {...c,offset,providedOffset:c.offset,sourceHash:capture.sourceHash};
  })}));
  t.mock.method(api,'updateArtifact',async()=>assert.fail('unexpected global mutation'));
  t.mock.method(api,'createArtifact',async()=>assert.fail('unexpected second create'));
  const invoke = async (ts,name,args) => ts.find(t=>t.name===name).execute('recorded',args);
  const conflict = JSON.parse((await invoke(tools,'artifact_create',second)).content[0].text);
  assert.equal(conflict.error,'artifact_revision_required');
  assert.equal(conflict.artifactId,groupReceipt.id);
  assert.equal(conflict.expectedVersion,1);
  assert.match(conflict.message,/artifact_update/);
  assert.doesNotMatch(JSON.parse((await invoke(forbidden,'artifact_create',second)).content[0].text).message,/artifact_update/);
  const read = JSON.parse((await invoke(tools,'artifact_list',{full:true})).content[0].text);
  assert.equal(read.artifacts[0].bodyMarkdown,first.bodyMarkdown);
  const updateTool = tools.find(t=>t.name==='artifact_update');
  const schema = buildProviderTool(updateTool).function.parameters;
  const {type,...edits} = second;
  const params = {...edits,artifactId:row.id,expectedVersion:1};
  assert.equal(validateArgs(params,schema).ok,true);
  assert.equal(validateArgs({...params,status:'adopted'},schema).ok,false);
  const writer = t.mock.method(api,'reviseKnowledgeReport',async()=>({...row,version:2}));
  const updated = await invoke(tools,'artifact_update',params);
  assert.equal(updated.artifactWrite.version,2);
  const [run,job,id,patch] = writer.mock.calls[0].arguments;
  assert.deepEqual([run,job,id],[role.runId,group.jobId,row.id]);
  assert.deepEqual([patch.expectedVersion,patch.roleVersion,patch.leaseVersion],[1,role.version,7]);
  assert.equal(patch.bodyMarkdown,second.bodyMarkdown);
  assert.deepEqual(patch.bodyJson.unknownItems,second.bodyJson.unknowns);
  assert.equal(checked.mock.callCount(),3);
  const stale = structuredClone(params);
  stale.bodyJson.citations = patch.bodyJson.citations.map(c=>({...c,sourceHash:'stale'}));
  const rejected = await invoke(tools,'artifact_update',stale);
  assert.match(JSON.parse(rejected.content[0].text).message,/原文版本/);
  assert.equal(writer.mock.callCount(),1);
});

test('lost response to owned revision is an unknown write without automatic resubmission', async t => {
  const fetch = t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('fetch failed');});
  await assert.rejects(api.reviseKnowledgeReport('r','j','a',{expectedVersion:1}), e=>e.code==='mutation_result_unknown');
  assert.equal(fetch.mock.callCount(),1);
});
