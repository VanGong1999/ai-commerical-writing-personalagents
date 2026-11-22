import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../src/apiClient.js';
import {createWritingTools} from '../src/tools.js';
import {validateArgs} from '../src/toolSchema.js';

function setup() {
 const tools=createWritingTools({projectId:'p',runId:'run',publish(){},allowlist:['gate_run','done_check','artifact_update','artifact_create'],doneContract:[{type:'gate_pass',gates:['Schema','FormatSelected']}]});
 return {tools,find:name=>tools.find(t=>t.name===name)};
}

test('artifact_update requires and forwards expectedVersion, returns compact receipt, and preserves stale-write errors',async()=>{
 const original=api.updateArtifact;
 try {
  const {find}=setup();
  const update=find('artifact_update');
  assert.equal(validateArgs({artifactId:'a',bodyMarkdown:'new'},update.parameters).ok,false);
  assert.equal(validateArgs({artifactId:'a',expectedVersion:0},update.parameters).ok,false);
  let request;
  api.updateArtifact=async(project,id,body)=>{request={project,id,body};return {id,projectId:project,type:'other',version:3,createdByRunId:'run',bodyMarkdown:'新稿'.repeat(10000),bodyJson:{full:'正文'.repeat(10000)}};};
  const result=JSON.parse((await update.execute('update',{artifactId:'a',expectedVersion:2,bodyMarkdown:'修改稿'})).content[0].text);
  assert.equal(request.body.expectedVersion,2);
  assert.equal(request.body.bodyMarkdown,'修改稿');
  assert.equal(result.version,3);
  assert.equal(result.createdByRunId,'run');
  assert.equal(result.bodyMarkdown,undefined);
  assert.equal(result.bodyJson,undefined);
  assert.ok(JSON.stringify(result).length<1000);
  api.updateArtifact=async()=>{throw new Error('409 version_conflict');};
  const stale=JSON.parse((await update.execute('stale',{artifactId:'a',expectedVersion:1,bodyMarkdown:'旧稿'})).content[0].text);
  assert.equal(stale.isError,true);
  assert.match(stale.message,/409 version_conflict/);
 } finally {api.updateArtifact=original;}
});

for (const writer of ['artifact_create','artifact_update']) {
 test(`${writer} invalidates earlier content gates while retaining format evidence`,async t=>{
  const original={list:api.listArtifacts,create:api.createArtifact,update:api.updateArtifact};
  t.mock.method(api,'getProject',async id=>({id,format:'manju'}));
  try {
   api.listArtifacts=async()=>[];
   const saved={id:'a',projectId:'p',type:'other',version:2,bodyMarkdown:'修改稿'};
   api.createArtifact=async()=>saved;
   api.updateArtifact=async()=>saved;
   const {tools,find}=setup();
   const gate=find('gate_run'),done=find('done_check');
   await gate.execute('format',{name:'FormatSelected',payload:{format:'manju'}});
   await gate.execute('schema',{name:'Schema',payload:{body:{title:'正文'},required:['title']}});
   assert.equal((await done.execute('before',{})).details.ok,true);
   await find(writer).execute('write',writer==='artifact_create'?{type:'other',title:'候选',bodyMarkdown:'修改稿'}:{artifactId:'a',expectedVersion:1,bodyMarkdown:'修改稿'});
   assert.equal(tools._gateEvidence.Schema,undefined);
   assert.equal(tools._gateEvidence.FormatSelected.result,'pass');
   assert.equal((await done.execute('after',{})).details.ok,false);
   await gate.execute('recheck',{name:'Schema',payload:{body:{title:'修改稿'},required:['title']}});
   assert.equal((await done.execute('rechecked',{})).details.ok,true);
  } finally {api.listArtifacts=original.list;api.createArtifact=original.create;api.updateArtifact=original.update;}
 });
}

test('passed gate identifies remaining required gates',async t=>{
 t.mock.method(api,'getProject',async id=>({id,format:'manju'}));
 const {find}=setup();
 const result=JSON.parse((await find('gate_run').execute('g',{name:'FormatSelected',payload:{format:'manju'}})).content[0].text);
 assert.deepEqual(result.remainingRequiredGates,['Schema']);
});

test('structured scene Schema uses the saved run artifact and rejects fabricated input',async t=>{
 const scene={id:'a',createdByRunId:'run',type:'scene',bodyMarkdown:'摘要',bodyJson:{}};
 t.mock.method(api,'listArtifacts',async()=>[scene]);
 const tools=createWritingTools({projectId:'p',runId:'run',publish(){},allowlist:['gate_run','artifact_create'],doneContract:[{type:'artifact_count',artifact:'scene',min:1}]});
 const gate=tools.find(t=>t.name==='gate_run');
 const check=async(name,payload)=>JSON.parse((await gate.execute('g',{name,payload})).content[0].text);
 const valid={scene_header:'室内',triple:{info:'甲',progress:'乙',change:'丙'},clip_candidate:'转折',script_body:'正文'.repeat(180)};
 assert.equal((await check('Schema',{artifactId:'a',body:valid,required:[]})).passed,false);
 scene.bodyJson=valid;
 assert.equal((await check('Schema',{artifactId:'a'})).passed,true);
 assert.equal((await check('LengthBand',{artifactId:'a',minChars:300,maxChars:500})).passed,true);
 const create=tools.find(t=>t.name==='artifact_create');
 assert.match(create.description,/select_score/);
 const result=JSON.parse((await create.execute('c',{type:'scene',title:'场',bodyMarkdown:'正文',bodyJson:{}})).content[0].text);
 assert.equal(result.isError,true);
});

test('IP schema requires a persisted four-score decision',async t=>{
 const {getAgent}=await import('@xiezuomanju/agent-runtime');
 const {doneContract}=getAgent('ip.select_score');
 assert.ok(doneContract.some(c=>c.artifact==='select_score' && c.min===1));
 const row={id:'ip',createdByRunId:'run',type:'select_score',bodyJson:{}};
 t.mock.method(api,'listArtifacts',async()=>[row]);
 const tools=createWritingTools({projectId:'p',runId:'run',publish(){},allowlist:['gate_run'],doneContract});
 const evaluate=async()=>JSON.parse((await tools.find(t=>t.name==='gate_run').execute('g',{name:'Schema',payload:{artifactId:'ip',required:[]}})).content[0].text);
 assert.equal((await evaluate()).passed,false);
 row.bodyJson={decision:'go',...Object.fromEntries(['data','genre','structure','characters'].map(k=>[k,{score:4}]))};
 assert.equal((await evaluate()).passed,true);
 row.type='other';
 assert.equal((await evaluate()).passed,false);
});

test('scene writes require canonical strings on create and replacement',async t=>{
 const scene={id:'scene',type:'scene',version:1};
 t.mock.method(api,'listArtifacts',async()=>[scene]);
 const update=t.mock.method(api,'updateArtifact',async()=>scene);
 const {find}=setup();
 for(const bodyJson of [{sceneHeader:'室内',scriptBody:'字'.repeat(130),clipCandidate:'转折',triple:{info:'甲',progress:'乙',change:'丙'}},{scene_header:42,script_body:'字'.repeat(130),clip_candidate:'转折',triple:{info:{},progress:'乙',change:'丙'}}]){
   const r=await find('artifact_update').execute('u',{artifactId:'scene',expectedVersion:1,bodyJson});
   assert.match(r.content[0].text,/script_body/);
 }
 assert.equal(update.mock.callCount(),0);
});

const pitchRef = id => ({id, version:1});
const pitchSourceIndex = {
  core_hook:pitchRef('hook'), logline:pitchRef('logline'), characters:[pitchRef('cast')],
  episode_outline:Array.from({length:10}, (_, i) => pitchRef(`outline-${i + 1}`)),
  manuscripts:Array.from({length:3}, (_, i) => pitchRef(`manuscript-${i + 1}`)),
  signedReport:pitchRef('signed-report'),
};
const pitchInput = {format:'manju', pipelineExecutionId:'pipeline', pipelineStageId:'S11_PITCH', sourceIndex:pitchSourceIndex};
const pitchAllow = ['artifact_list','artifact_create','gate_run'];
function pitchTools(overrides = {}) {
  return createWritingTools({projectId:'p', runId:'run', jobId:'job', publish(){}, allowlist:pitchAllow,
    parentAgentId:'deliver.pitch_pack', pipelineMember:true, pipelineStageId:'S11_PITCH', bodyInput:pitchInput,
    allowedGateNames:['Schema','PitchFourPack'], doneContract:[{type:'artifact_count',artifact:'other',min:1},
      {type:'gate_pass',gates:['PitchFourPack']}], ...overrides});
}

test('bound Pitch retries revise the saved candidate under CAS and cannot change its frozen sources', async t => {
  const own = {id:'pitch', type:'other', status:'candidate', projectId:'p', createdByRunId:'run', version:2,
    title:'投稿候选', bodyMarkdown:'原稿', bodyJson:{sourceIndex:pitchSourceIndex}};
  const rows = [own, {...own,id:'foreign',createdByRunId:'another-run'}, {...own,id:'another-project',projectId:'q'},
    {...own,id:'upstream',type:'manuscript'}, {...own,id:'archived',status:'archived'},
    {...own,id:'adopted',status:'adopted'}, {...own,id:'mismatched',bodyJson:{sourceIndex:{}}}];
  t.mock.method(api,'listArtifacts',async () => rows);
  const create = t.mock.method(api,'createArtifact',async () => assert.fail('retry must not create a new candidate'));
  const update = t.mock.method(api,'updateArtifact',async (project, id, patch) => {
    assert.equal(project,'p');
    assert.equal(id,'pitch');
    if (patch.expectedVersion !== own.version) throw new Error('409 version_conflict');
    Object.assign(own, {version:3, bodyMarkdown:patch.bodyMarkdown, bodyJson:patch.bodyJson});
    return own;
  });
  const tools = pitchTools();
  const call = async (name, params) => {
    const tool = tools.find(entry => entry.name === name);
    assert.ok(tool, `${name} should be initially callable`);
    return JSON.parse((await tool.execute(name,params)).content[0].text);
  };
  assert.ok(tools._searchableSet.has('artifact_update'));
  assert.ok(tools._callableSet.has('artifact_update'));
  assert.ok(tools.some(entry => entry.name === 'project_get'));
  const listed = await call('artifact_list',{artifactId:'pitch',full:true});
  const [{id:artifactId,version:expectedVersion}] = listed.artifacts;
  // Isolate the single-candidate retry from the adversarial targets below.
  const invalidTargets = rows.splice(1);
  const duplicate = await call('artifact_create',{type:'other',title:'改标题',bodyMarkdown:'修订稿',bodyJson:{sourceIndex:pitchSourceIndex}});
  assert.equal(duplicate.error,'artifact_revision_required');
  assert.equal(duplicate.artifactId,artifactId);
  assert.equal(duplicate.expectedVersion,expectedVersion);
  assert.equal(create.mock.callCount(),0);
  rows.push(...invalidTargets);
  const edits = {artifactId,expectedVersion,bodyMarkdown:'修订稿'};
  for (const rejected of invalidTargets) {
    assert.ok((await call('artifact_update',{...edits,artifactId:rejected.id})).isError,rejected.id);
  }
  assert.ok((await call('artifact_update',{...edits,status:'adopted'})).isError);
  assert.ok((await call('artifact_update',{...edits,bodyJson:{sourceIndex:{}}})).isError);
  assert.equal(update.mock.callCount(),0);
  assert.match((await call('artifact_update',{...edits,expectedVersion:1})).message,/409 version_conflict/);
  const reorderedIndex = Object.fromEntries(Object.entries(pitchSourceIndex).reverse());
  const revised = await call('artifact_update',{...edits,bodyJson:{sourceIndex:reorderedIndex}});
  assert.equal(revised.id,artifactId);
  assert.equal(revised.version,3);
  assert.equal(own.bodyMarkdown,'修订稿');
  assert.equal(own.status,'candidate');
});

test('Pitch revision permission requires the top-level bound stage and leaves unrelated roles unchanged', async t => {
  const own = {id:'pitch', type:'other', status:'candidate', projectId:'p', createdByRunId:'run', version:2,
    bodyJson:{sourceIndex:pitchSourceIndex}};
  t.mock.method(api,'listArtifacts',async () => [own]);
  const update = t.mock.method(api,'updateArtifact',async () => assert.fail('unbound call must not write'));
  for (const overrides of [
    {parentAgentId:'prose.episode_body'}, {pipelineMember:false}, {depth:1}, {pipelineStageId:'S10_HUMAN_QC'},
    {bodyInput:{...pitchInput,format:'ip_adapt'}}, {bodyInput:{...pitchInput,pipelineExecutionId:''}},
    {bodyInput:{...pitchInput,sourceIndex:{}}}, {allowlist:['artifact_list','gate_run']},
  ]) {
    const tools = pitchTools(overrides);
    assert.equal(tools._searchableSet.has('artifact_update'),false);
    assert.equal(tools._callableSet.has('artifact_update'),false);
    if (overrides.parentAgentId) continue;
    const raw = tools._allGated.find(entry => entry.name === 'artifact_update');
    const denied = await raw.execute('denied',{artifactId:'pitch',expectedVersion:2,bodyMarkdown:'修订稿'});
    assert.ok(JSON.parse(denied.content[0].text).isError);
  }
  assert.equal(update.mock.callCount(),0);
});

test('bound Pitch gate advertises its counts and still fails on missing source counts', async () => {
  const gate = pitchTools().find(entry => entry.name === 'gate_run');
  assert.deepEqual(Object.keys(gate.parameters.properties.payload.properties.counts.properties),
    ['coreHook','character','episodeOutline','manuscript']);
  const check = async counts => JSON.parse((await gate.execute('gate',{name:'PitchFourPack',payload:{counts}})).content[0].text);
  assert.equal((await check({coreHook:1,character:1,episodeOutline:10,manuscript:0})).passed,false);
  assert.equal((await check({coreHook:1,character:1,episodeOutline:10,manuscript:3})).passed,true);
});
