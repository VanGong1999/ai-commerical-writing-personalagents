import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { api } from '../src/apiClient.js';
import { runAgentJob } from '../src/runSession.js';

for (const [scenario, compact, hasBaseline, hasHistory = true] of [
  ['after exact replay', false, true],
  ['through repeated handoffs', true, true],
  ['without a dispatched prompt snapshot', false, false],
  ['through a checkpoint-only handoff', true, false, false],
]) {
  test('recovered worker presents durable operator directions ' + scenario, async t => {
    for (const key of Object.keys(api)) {
      if (typeof api[key] === 'function') t.mock.method(api, key, async () => []);
    }
    const root = mkdtempSync(join(tmpdir(), 'resume-direction-'));
    const env = {
      AGENT_SESSION_ROOT: root,
      AGENT_COMPACT_TRIGGER_TOKENS: compact ? '1' : '1000000',
      AGENT_HANDOFF_AFTER_COMPACTIONS: '1',
      AGENT_LLM_COMPACTION: 'false',
    };
    for (const [key, value] of Object.entries(env)) {
      const previous = process.env[key];
      process.env[key] = value;
      t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    }
    t.after(() => rmSync(root, {recursive:true, force:true}));

    const original = { format:'manju', pipelineStageId:'S0_SETUP', pipelineExecutionId:'group', assistantPrompt:'交接单 #128：核对本次格式与范围。\n\n【追加指令】这是上游原文中的示例。' };
    const first = '请重新核对来源 A17。\n保留作者的原话。';
    const second = '请再核对来源 B23 的范围。';
    const initial = {...original, assistantPrompt:original.assistantPrompt+'\n\n【追加指令】'+first, steerRevision:'accepted-1'};
    const revised = {...initial, assistantPrompt:initial.assistantPrompt+'\n\n【追加指令】'+second, steerRevision:'accepted-2'};
    const requests = [];
    let polls = 0;
    api.getSteer = async () => ({messages:[], inputJson:++polls === 1 ? initial : revised});
    api.getRunReplay = async () => ({steps:hasHistory ? [
      {seq:1,kind:'tool_call',payload:{turn_id:'previous',id:'prior-done',name:'done_check',args:{}}},
      {seq:2,kind:'tool_result',payload:{turn_id:'previous',id:'prior-done',name:'done_check',result:'{"ok":true}'}},
      {seq:3,kind:'reply',payload:{turn_id:'reply',text:'原交接已经完成。'}},
    ] : []});
    api.getProject = async () => ({id:'p',format:'manju',progress:{}});
    api.agentChat = async ({messages}) => {
      requests.push(structuredClone(messages));
      const [name, args] = [
        ['gate_run',{name:'FormatSelected'}], ['gate_run',{name:'ChunkPolicy'}], ['done_check',{}],
      ][requests.length-1];
      return {choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'new-'+requests.length,
        type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]};
    };
    const outcome = await runAgentJob({
      job:{id:'j',projectId:'p',leaseVersion:2,payload:{input:hasBaseline ? original : undefined,maxTurns:4}},
      run:{id:'r',agentId:'orch.writing',inputJson:initial},
      resume:{checkpoint:{turn:2},attempt:2}, publish(){},
    });
    assert.equal(outcome.steerRevision, revised.steerRevision);
    assert.equal(outcome.status, 'succeeded');
    assert.equal(requests.length, 3);
    const firstRequest = requests[0];
    assert.equal(firstRequest[0].role, 'system');
    if (hasHistory) {
      const prior = firstRequest.findIndex(m => m.tool_calls?.some(call => call.id === 'prior-done'));
      assert.ok(prior > 0);
      assert.deepEqual(firstRequest[prior+1], {role:'tool',tool_call_id:'prior-done',content:'{"ok":true}'});
      assert.ok(firstRequest.some(m => m.role === 'assistant' && m.content === '原交接已经完成。'));
    } else {
      assert.ok(firstRequest.some(m => m.content?.includes('【续跑提示】')));
      assert.ok(firstRequest.some(m => m.content?.startsWith('## Handoff')));
    }
    assert.equal(firstRequest.at(-1).role,'user', 'the historical conclusion must precede the active direction');
    assert.ok(firstRequest.at(-1).content.includes(first));
    if (hasBaseline) assert.ok(!firstRequest.at(-1).content.includes('上游原文中的示例'));
    else assert.ok(firstRequest.at(-1).content.includes(initial.assistantPrompt));
    assert.ok(requests[1].at(-1).content.includes(second));
    assert.ok(!requests[1].at(-1).content.includes(first));
    for (const [index, messages] of requests.entries()) {
      const conclusion = messages.findIndex(m => m.role === 'assistant' && m.content === '原交接已经完成。');
      const correction = messages.findIndex(m => m.role === 'user' && m.content.includes(first));
      assert.ok(correction >= 0);
      if (conclusion >= 0) assert.ok(correction > conclusion, 'the recovered direction must follow retained history');
      const text = messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
      assert.equal(text.split('交接单 #128').length-1, 1);
      assert.equal(text.split('来源 A17').length-1, 1);
      assert.equal(text.split('来源 B23').length-1, index === 0 ? 0 : 1);
    }
    if (compact) {
      const journals = api.putMemoryFile.mock.calls.map(call => call.arguments[0])
        .filter(file => file.path.startsWith('/memories/projects/p/journal/handoff-r-'));
      assert.equal(journals.length, requests.length);
      for (const [index, file] of journals.entries()) {
        const goal = file.content.split('### 目标\n')[1].split('\n### Done Contract')[0];
        assert.ok(goal.includes('交接单 #128'), 'standalone journal needs base task');
        assert.ok(goal.includes(first), 'standalone journal needs admitted multiline direction');
        assert.equal(goal.includes(second), index > 0, 'standalone journal tracks subsequently admitted direction');
      }
    }
    assert.equal(api.createArtifact.mock.callCount(),0);
  });
}
