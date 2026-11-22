import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getAgent} from '@xiezuomanju/agent-runtime';
import {api} from '../src/apiClient.js';
import {createWritingTools} from '../src/tools.js';
import {runAgentJob} from '../src/runSession.js';

const agent = getAgent('topic.core_hook_batch');
const groupId = 'b600abd0-6071-4aab-a3bf-0f1618b59501';
const rows = Array.from({length:10}, (_, i) => ({
  candidate_no:i + 1, title:'交接簿' + i, core_hook:'夜班工人追查被改写的记录。', motivation:'讨回工资；证明清白',
  crisis:'调查记录被扣下', opening_structure:'收回饭盒时发现签名', opening_beats:['饭盒掉落'], tags:['职业悬疑'],
  four_step:{worldview:'夜班物流', identity_contrast:'看门人是见证人', goldfinger_limit:'只能看见来车', hook_point:'签名来自谁'},
}));
const group = {id:groupId, projectId:'p', createdByRunId:'r', status:'candidate', type:'core_hook', version:1, bodyJson:{items:rows}};

function persisted(t, artifacts) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE artifacts (row TEXT)');
  for (const a of artifacts) db.prepare('INSERT INTO artifacts VALUES (?)').run(JSON.stringify(a));
  t.mock.method(api, 'listArtifacts', async () => db.prepare('SELECT row FROM artifacts').all().map(a => JSON.parse(a.row)));
  return db;
}

for (const [name, artifacts, reuseArtifactIds, count, type = 'core_hook'] of [
  ['one group', [group], [], 10],
  ['mixed rows', [{...group, bodyJson:{items:[...rows.slice(0,8), {candidate:rows[8]}, {...rows[9], motivation:''}]}}], [], 9],
  ['empty or malformed containers', [[], null, 'invalid', Array(10).fill({})].map((items,i) => ({...group,id:'bad'+i,bodyJson:{items}})), [], 0],
  ['inactive and foreign', ['archived','rejected'].map(status=>({...group,id:status,status})).concat({...group,createdByRunId:'old'}), ['archived'], 0],
  ['authorized reuse', [{...group, createdByRunId:'old'}], [groupId], 10],
  ['wrapped legacy candidate', [{...group, bodyJson:{candidate:{
    titleHook:'老秤', coreHook:'守门人发现签收时间异常', openingStructure:'对照两张签收单',
    crisis:'原始单据即将销毁', motivation:{career:'保住工作',conflict:'查清是谁改写交接记录'}, tags:['悬疑'],
  }}}], [], 1],
  ['invalid stored evidence', [{...group, bodyJson:{items:[null, false, [], {title:'单据'},
    {...rows[0],motivation:{career:'  '}}, {...rows[0],tags:{item:['悬疑']}}, {...rows[0],core_hook:3},
    {...rows[0],opening_beats:{item:['单据被替换']}}]}}], [], 0],
  ['one saved candidate', [{...group, bodyJson:rows[0]}], [], 1],
  ['one checklist', [{...group,type:'qc_report'}], [], 1, 'qc_report'],
]) {
  test('done_check counts ' + name, async t => {
    persisted(t, artifacts);
    const create = t.mock.method(api,'createArtifact',async () => assert.fail('unexpected artifact_create'));
    const doneContract = type === 'core_hook' ? agent.doneContract : [{type:'artifact_count',artifact:type,min:10}];
    const tools = createWritingTools({projectId:'p',runId:'r',parentAgentId:agent.id, allowlist:agent.tools,
      doneContract,completionScope:{runId:'r',reuseArtifactIds},publish(){}});
    const execute = (name,args) => tools.find(tool => tool.name === name).execute('call',args);
    assert.equal((await execute('done_check',{})).details.ok, false);
    for (const name of ['Schema','ChunkPolicy']) {
      const gate = await execute('gate_run',{name,payload:{artifactId:artifacts[0].id}});
      assert.equal(JSON.parse(gate.content[0].text).passed,true);
    }
    const done = await execute('done_check',{});
    const ev = JSON.parse(done.content[0].text.split('## 原始 JSON\n')[1]);
    assert.equal(ev.checks[0].message, count < 10 ? 'Done Contract：'+type+' 现有 '+count+'，需要 ≥ 10' : type+'×10 满足 min=10');
    assert.equal(ev.ok,count === 10);
    assert.equal(create.mock.callCount(),0);
  });
}

for (const end of ['done_check','model stop','max turns','archived before receipt']) {
  const archiveOnExit = end === 'archived before receipt';
  const name = archiveOnExit ? 'archive after done_exit prevents stale batch success' :
    'resumed batch closes from ' + end + ' with only the original version';
  test(name, async t => {
    for (const key of Object.keys(api)) {
      if (typeof api[key] === 'function' && key !== 'listArtifacts') t.mock.method(api,key,async () => []);
    }
    const directory = mkdtempSync(join(tmpdir(),'batch-closure-'));
    t.after(() => rmSync(directory,{recursive:true,force:true}));
    const compact = end === 'model stop';
    for (const [key,value] of Object.entries({AGENT_SESSION_ROOT:directory,
      AGENT_COMPACT_TRIGGER_TOKENS:compact ? '1' : '1000000', AGENT_HANDOFF_AFTER_COMPACTIONS:'1', AGENT_LLM_COMPACTION:'false'})) {
      const previous = process.env[key];
      process.env[key] = value;
      t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    }
    const copies = rows.slice(1,6).map((row,i) => ({...group,id:'copy-'+i,version:2,status:'archived',bodyJson:row}));
    const db = persisted(t,[group,...copies]);
    const steps = [group,...copies].flatMap((a,i) => {
      const call = {name:'artifact_create',id:'previous-'+i,turn_id:'write-'+i};
      const artifactWrite = {id:a.id,version:1,projectId:'p'};
      return [{seq:2*i+1,kind:'tool_call',payload:{...call,args:{type:a.type,title:'候选',bodyJson:a.bodyJson}}},
        {seq:2*i+2,kind:'tool_result',payload:{...call,status:'done',result:JSON.stringify(artifactWrite),artifactWrite}}];
    });
    api.getRunReplay = async () => ({steps});
    api.getProject = async () => ({id:'p',format:'manju',progress:{}});
    const requests = [];
    api.agentChat = async ({messages}) => {
      requests.push(structuredClone(messages));
      const [name,args] = [['gate_run',{name:'Schema',payload:{artifactId:groupId}}],
        ['gate_run',{name:'ChunkPolicy',payload:{artifactId:groupId}}],['done_check',{}]][requests.length-1] || [];
      const stop = end === 'model stop' && requests.length >= 3;
      return {choices:[{finish_reason:stop ? 'stop' : 'tool_calls', message:stop ? {content:'候选已交付。'} :
        {tool_calls:[{id:'new-'+requests.length,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]};
    };
    const events = [];
    const running = runAgentJob({job:{id:'j',projectId:'p',leaseVersion:3,attempts:1,payload:{maxTurns:end === 'max turns' ? 2 : 3}},
      run:{id:'r',agentId:agent.id,inputJson:{format:'manju',steerRevision:'revision'}},resume:{attempt:2,checkpoint:{turn:2}},
      publish:event => {
        events.push(event);
        if (archiveOnExit && event.phase === 'done_exit' && event.ok) {
          const change = db.prepare("UPDATE artifacts SET row = ? WHERE json_extract(row, '$.id') = ?")
            .run(JSON.stringify({...group,status:'archived',version:2}),groupId);
          assert.equal(change.changes,1);
        }
      }});
    if (archiveOnExit) {
      await assert.rejects(running, error => error.retryable === false && error.message.includes('doneContract=FAIL'));
      assert.ok(events.some(e => e.phase === 'done_exit' && e.ok));
      const receipt = events.find(e => e.type === 'receipt');
      assert.equal(receipt.exitReason,'done_contract_exhausted');
      assert.ok(receipt.gates.some(g => g.id === 'done.artifact_count.core_hook' &&
        g.result === 'fail' && g.message.includes('现有 0')));
      for (const gate of ['Schema','ChunkPolicy']) assert.ok(receipt.gates.some(g => g.id === gate && g.result === 'pass'));
      const logged = api.appendRunStep.mock.calls.map(call => call.arguments[1]);
      assert.equal(logged.find(s => s.kind === 'receipt').payload.status,'failed');
      assert.ok(!logged.some(s => s.payload.terminalResult));
      return;
    }
    const result = await running;
    assert.equal(result.status,'succeeded');
    assert.equal(result.exitReason,'done_contract_pass');
    assert.deepEqual(result.artifactIds,[groupId]);
    assert.deepEqual(result.receipt.artifactIds,[groupId]);
    assert.deepEqual(result.outputVersions,{[groupId]:1});
    assert.equal(result.steerRevision,'revision');
    assert.equal(api.createArtifact.mock.callCount(),0);
    assert.equal(api.ontologySubmit.mock.callCount(),0);
    for (const gate of ['Schema','ChunkPolicy']) assert.ok(result.gates.some(g => g.id === gate && g.result === 'pass'));
    const logged = api.appendRunStep.mock.calls.map(call => call.arguments[1]);
    const receipt = logged.find(s => s.kind === 'receipt').payload;
    assert.equal(receipt.jobId,'j');
    assert.equal(receipt.leaseVersion,3);
    assert.deepEqual(receipt.terminalResult,result);
    assert.equal(logged.some(s => s.kind === 'tool_call' && s.payload.name === 'artifact_create'),false);
    if (compact) {
      const journals = api.putMemoryFile.mock.calls.map(call=>call.arguments[0]).filter(file=>file.path.includes('/journal/handoff-'));
      assert.ok(journals.at(-1).content.includes('Done Contract 全部通过'));
      assert.ok(!journals.at(-1).content.includes('copy-'));
    } else {
      assert.ok(requests[0].some(m=>m.role === 'tool' && m.tool_call_id === 'previous-0'));
      assert.ok(requests[0].some(m=>m.content?.includes('core_hook=10')));
      assert.ok(events.some(e=>e.gates?.some(g=>g.message?.includes('core_hook×10'))));
    }
  });
}
