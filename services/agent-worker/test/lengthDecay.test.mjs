import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { api } from '../src/apiClient.js';
import { afterBodyLifecycle, finalBodyGateEvidence } from '../src/batchLifecycle.js';
import { createWritingTools } from '../src/tools.js';
import { runAgentJob } from '../src/runSession.js';

const agentId = 'prose.episode_body';
const projectId = 'decay-project';
const slots = [1, 2].map(episodeNo => ({ episodeNo, runId: 'decay-run-' + episodeNo }));
const input = { format: 'manju', episodeNo: 2, taskGroupId: 'group', batchBodySlots: slots };

function fixture(t) {
  for (const [name, method] of Object.entries(api)) {
    if (typeof method === 'function') t.mock.method(api, name, async () => []);
  }
  const manuscripts = slots.map(({ episodeNo, runId }) => ({
    id: 'decay-ep-' + episodeNo, projectId, type: 'manuscript', createdByRunId: runId,
    status: 'candidate', version: 1, bodyJson: { episodeNo },
    bodyMarkdown: '场景1：'.padEnd(episodeNo === 1 ? 1200 : 800, '字'),
  }));
  api.listArtifacts.mock.mockImplementation(async (_project, type) =>
    !type || type === 'manuscript' ? manuscripts : []);
  api.getProject.mock.mockImplementation(async () => ({ id: projectId, format: 'manju', progress: {} }));
  api.getMemoryFile.mock.mockImplementation(async () => ({ content: '人物手记' }));
  api.getAppSettings.mock.mockImplementation(async () => ({
    featureToggles: { storyGraphAutoUpdate: false, foreshadowAutoUpdate: false },
  }));
  api.listJobs.mock.mockImplementation(async () => [
    { id: 'other-batch', taskGroupId: 'another-group', status: 'queued', agentId },
    { id: 'already-writing', status: 'running', agentId },
  ]);
  return manuscripts;
}

function isolatedModel(t, calls) {
  const directory = mkdtempSync(join(tmpdir(), 'length-decay-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const previous = process.env.AGENT_SESSION_ROOT;
  process.env.AGENT_SESSION_ROOT = directory;
  t.after(() => { if (previous === undefined) delete process.env.AGENT_SESSION_ROOT; else process.env.AGENT_SESSION_ROOT = previous; });
  api.agentChat.mock.mockImplementation(async () => {
    const [name, args] = calls.shift();
    return { choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{
      id: 'tool-' + calls.length, type: 'function', function: { name, arguments: JSON.stringify(args) },
    }] } }] };
  });
}

test('gate_run binds LengthDecay to the saved run manuscript and its configured minimum', async t => {
  const manuscripts = fixture(t);
  const [previous, current] = manuscripts;
  const runId = slots[1].runId;
  const bodyInput = { ...input, minChars: 800 };
  const tools = createWritingTools({ projectId, runId, bodyInput, parentAgentId: agentId,
    allowlist: ['gate_run'], doneContract: [{ type: 'gate_pass', gates: ['LengthDecay'] }], publish() {} });
  async function gate(payload) {
    const out = await tools.find(tool => tool.name === 'gate_run').execute('check', {
      name: 'LengthDecay', payload: { ...payload, cancelOnFail: true },
    });
    return JSON.parse(out.content[0].text);
  }
  for (const payload of [{ artifactId: current.id, lengths: [1200, 799], minChars: 9000 },
    { artifactId: current.id }, { lengths: [100, 200] }]) {
    const result = await gate(payload);
    assert.deepEqual(result.cancelled, []);
    assert.ok(result.cancellationNote);
    assert.equal(result.checks[0].result, 'warn');
    assert.match(result.checks[0].message, /1200.*800.*70%/);
    assert.deepEqual(result.remainingRequiredGates, []);
    assert.equal(tools._gateEvidence.LengthDecay.result, 'warn');
  }
  for (const artifactId of [previous.id, 'missing']) {
    const result = await gate({ artifactId, lengths: [800, 1200] });
    assert.equal(result.checks[0].result, 'inconclusive');
    assert.deepEqual(result.remainingRequiredGates, ['LengthDecay']);
  }
  current.bodyMarkdown = current.bodyMarkdown.slice(0, 799);
  const short = await gate({ artifactId: current.id, lengths: [1200, 1200], minChars: 1 });
  assert.equal(short.passed, false);
  assert.match(short.checks[0].message, /799.*800/);
  manuscripts.pop();
  assert.equal((await gate({ lengths: [900, 900] })).checks[0].result, 'inconclusive');
  assert.equal(api.listJobs.mock.callCount(), 0);
  assert.equal(api.cancelJob.mock.callCount(), 0);
});

test('decay_detect is count-only diagnostic even when cancellation is requested', async t => {
  fixture(t);
  const tools = createWritingTools({ projectId, runId: slots[1].runId, parentAgentId: agentId,
    allowlist: ['decay_detect'], publish() {} });
  for (const [lengths, expected] of [[[1200, 800], 'warn'], [[1200, 799], 'fail'], [[], 'inconclusive'], [[1200, 900], 'pass']]) {
    const out = await tools.find(tool => tool.name === 'decay_detect').execute('check', { lengths, cancelOnFail: true });
    const result = JSON.parse(out.content[0].text);
    assert.equal(result.gate.result, expected);
    assert.equal(result.hardStop, false);
    assert.deepEqual(result.cancelled, []);
    if (expected === 'warn' || expected === 'pass') {
      assert.deepEqual(result.warns, [{ at: 1, from: 1200, to: lengths[1] }]);
    }
  }
  assert.deepEqual(tools._gateEvidence, {});
  assert.equal(api.listJobs.mock.callCount(), 0);
  assert.equal(api.cancelJob.mock.callCount(), 0);
});

test('non-batch lifecycle selects the owned current body before measuring empty and first episodes', async t => {
  const rows = fixture(t);
  const runId = 'new-body';
  const body = { ...rows[1], createdByRunId: runId, bodyJson: { episodeNo: 3 }, bodyMarkdown: '' };
  rows.push(body, { ...rows[1], bodyJson: { episodeNo: 6 } });
  const run = (extra = {}) => afterBodyLifecycle({ projectId, agentId, runId, input: extra });
  const empty = await run();
  assert.deepEqual(empty.lengths, [1200, 800, 0]);
  assert.equal(empty.hardStop, true);
  rows.splice(0, rows.length, body);
  for (const [count, result] of [[800, 'pass'], [799, 'fail']]) {
    body.bodyMarkdown = '字'.repeat(count);
    assert.equal((await run()).decay.result, result);
  }
  body.bodyMarkdown = '字'.repeat(850);
  assert.equal((await run({ wordTarget: { min: 900 } })).decay.result, 'fail');
  rows.splice(0, rows.length, { ...body, createdByRunId: 'foreign' });
  assert.equal((await run()).decay.result, 'inconclusive');
  assert.equal((await run({reuseArtifactIds: [body.id]})).decay.result, 'pass');
  rows[0].status = 'archived';
  assert.equal((await run({reuseArtifactIds: [body.id]})).decay.result, 'inconclusive');
  assert.equal(api.listJobs.mock.callCount(), 0);
  assert.equal(api.cancelJob.mock.callCount(), 0);
});

test('post-body lifecycle keeps the warning and validates every batch slot', async t => {
  const manuscripts = fixture(t);
  for (const source of [input, { format: 'manju' }]) {
    const result = await afterBodyLifecycle({ projectId, agentId, input: source });
    assert.equal(result.decay.result, 'warn');
    assert.equal(result.hardStop, false);
    assert.equal(result.passed, true);
    assert.deepEqual(result.cancelled, []);
  }
  assert.equal(api.listJobs.mock.callCount(), 0);
  const owned = manuscripts.pop();
  for (const invalid of [[], [owned, owned], [{ ...owned, createdByRunId: 'another' }],
    [{ ...owned, bodyJson: { episodeNo: 3 } }]]) {
    manuscripts.splice(1, manuscripts.length, ...invalid);
    await assert.rejects(afterBodyLifecycle({ projectId, agentId, input }), /批次正文缺失、重复或集号不符/);
  }
});

test('saved body and scan count Unicode characters consistently with LengthBand', async t => {
  const manuscripts = fixture(t);
  const text = '😀'.repeat(799);
  manuscripts[1].bodyMarkdown = text;
  const post = await afterBodyLifecycle({ projectId, agentId, input });
  assert.deepEqual(post.lengths, [1200, 799]);
  assert.equal(post.hardStop, true);
  const tools = createWritingTools({ projectId, parentAgentId: agentId, allowlist: ['scan_length'], publish() {} });
  const scan = await tools.find(tool => tool.name === 'scan_length').execute('scan', { text, minChars: 800, maxChars: 1200 });
  assert.equal(JSON.parse(scan.content[0].text).n, 799);
});

test('standalone scenes use their script contract and batch episodes retain the episode minimum', async t => {
  fixture(t);
  const scene = { id: 'scene-1', type: 'scene', projectId, version: 1, createdByRunId: 'scene-run',
    bodyJson: { scene_header: '1|门厅|内|夜', triple: { info:'通知', progress:'敲门', change:'开门' },
      clip_candidate:'脚步停在门外', script_body: '字'.repeat(360) } };
  api.listArtifacts.mock.mockImplementation(async () => [scene]);
  const ctx = { projectId, runId: scene.createdByRunId, agentId: 'scene.triple' };
  const measure = (input = {}) => afterBodyLifecycle({ ...ctx, input: { format: 'duanju', ...input } });
  const tools = createWritingTools({ ...ctx, parentAgentId: ctx.agentId, allowlist: ['gate_run'], publish() {},
    doneContract: [{type:'artifact_count',artifact:'scene',min:1},{type:'gate_pass',gates:['Schema']}] });
  const schema = async () => JSON.parse((await tools.find(tool => tool.name === 'gate_run').execute('schema',
    {name:'Schema',payload:{artifactId:scene.id}})).content[0].text).passed;
  assert.equal(await schema(), true);
  assert.equal((await measure()).decay.result, 'pass');
  assert.equal((await measure({ minChars: 800 })).hardStop, true);
  assert.equal((await measure({ taskGroupId: 'g', batchBodySlots: [{ episodeNo: 1, runId: ctx.runId }] })).hardStop, true);
  scene.bodyJson.script_body = '  ' + '😀 '.repeat(59) + '😀字  ';
  assert.equal(await schema(), true);
  const boundary = await measure();
  assert.deepEqual(boundary.lengths, [120]);
  assert.equal(boundary.hardStop, false);
  scene.bodyJson.script_body = scene.bodyJson.script_body.trim().slice(0, -1);
  assert.equal(await schema(), false);
  assert.equal((await measure()).hardStop, true);
  scene.bodyJson.script_body = '字'.repeat(360);
  delete scene.bodyJson.clip_candidate;
  assert.equal(await schema(), false);
});

test('a final body measurement cannot create a missing gate or bind an unsuccessful artifact lookup', () => {
  const post = { decay: {id:'length_decay', name:'字数衰减', result:'pass',
    evidence:{artifactId:'current',version:2}} };
  const scope = { runId:slots[1].runId, projectId };
  assert.deepEqual(finalBodyGateEvidence({}, post, [], scope), {});
  const missing = {id:'length_decay', name:'字数衰减', result:'inconclusive'};
  const prior = {length_decay:missing, LengthDecay:{...missing,id:'LengthDecay',name:'LengthDecay'}};
  const final = finalBodyGateEvidence(prior, post, [], scope);
  assert.equal(final.LengthDecay.result, 'inconclusive');
  assert.equal(final.length_decay.evidence, undefined);
  assert.equal(final.Schema, undefined);
});

for (const editAfterPost of [false, true]) {
  test('standalone scene receipt validates the delivered script and required fields, edit=' + editAfterPost, async t => {
    fixture(t);
    const runId = 'scene-run';
    let scene = { id:'scene-one', type:'scene', projectId, createdByRunId:runId, status:'candidate', version:1,
      bodyJson:{scene_header:'1|门厅|内|夜', triple:{info:'通知', progress:'敲门', change:'开门'},
        clip_candidate:'脚步停在门外', script_body:'字'.repeat(360)} };
    api.listArtifacts.mock.mockImplementation(async (_project, type) => !type || type === 'scene' ? [scene] : []);
    isolatedModel(t, [['gate_run', {name:'Schema', payload:{artifactId:scene.id}}], ['done_check', {}]]);
    const events = [];
    const running = runAgentJob({ job:{id:'scene-job',projectId,leaseVersion:1,payload:{maxTurns:2}},
      run:{id:runId,agentId:'scene.triple',inputJson:{format:'duanju'}}, publish:event => {
        events.push(event);
        if (event.phase === 'post_body' && editAfterPost) {
          scene = {...scene,version:2,bodyJson:{...scene.bodyJson,clip_candidate:''}};
        }
      } });
    if (editAfterPost) {
      await assert.rejects(running, /Done Contract/);
      assert.ok(events.find(e => e.type === 'receipt').gates.some(g => g.id === 'Schema' && g.result === 'fail'));
    } else {
      const result = await running;
      assert.equal(result.status, 'succeeded');
      assert.equal(result.lifecycle.hardStop, false);
    }
  });
}

function episodeGateCalls(artifactId, decayPayload) {
  return ['LengthBand', 'LengthDecay', 'SceneCount'].map(name => ['gate_run', {
    name, payload: { artifactId, ...(name === 'LengthDecay' ? decayPayload : {}) },
  }]).concat([['done_check', {}]]);
}

for (const finalLength of [900, 1020]) {
  test('receipt reevaluates the bound review ratio for final length ' + finalLength, async t => {
    const manuscripts = fixture(t);
    const current = manuscripts[1];
    current.bodyMarkdown = '场景1：'.padEnd(900, '字');
    isolatedModel(t, episodeGateCalls(current.id, { ratio: 0.85, minChars: 950, cancelOnFail: true }));
    const events = [];
    const result = await runAgentJob({
      job: { id: 'ratio-job', projectId, leaseVersion: 1, payload: { maxTurns: 4 } },
      run: { id: slots[1].runId, agentId, inputJson: { ...input, minChars: 850 } },
      publish: event => {
        events.push(event);
        if (event.phase === 'post_body' && finalLength !== 900) {
          manuscripts[1] = { ...current, version: 2, bodyMarkdown: '场景1：'.padEnd(finalLength, '字') };
        }
      },
    });
    assert.equal(result.status, 'succeeded');
    assert.match(result.receipt.handoff, /repair=0; hardStop=false/);
    assert.ok(events.some(e => e.type === 'gates' && e.gates.some(g =>
      g.id === 'length_decay' && g.result === 'warn' && /85%/.test(g.message))));
    const version = manuscripts[1].version;
    const bound = result.receipt.gateResults.find(g => g.id === 'LengthDecay');
    assert.equal(bound.result, finalLength === 900 ? 'warn' : 'pass');
    assert.deepEqual(bound.evidence, { artifactId: current.id, version, minChars: 850, ratio: 0.85 });
    assert.match(bound.message, finalLength === 900 ? /1200.*900.*85%/ : /1020/);
    assert.deepEqual(result.lifecycle.lengths, [1200, finalLength]);
    assert.equal(result.lifecycle.decay.result, 'pass');
    assert.equal(result.lifecycle.decay.evidence.ratio, 0.7);
    assert.equal(api.cancelJob.mock.callCount(), 0);
  });
}

for (const finalBody of ['valid', 'shortened', 'removed', 'newer-short', 'newer-valid']) {
  test('episode run checks the saved body again before the receipt: ' + finalBody, async t => {
    const manuscripts = fixture(t);
    isolatedModel(t, episodeGateCalls(manuscripts[1].id, { lengths: [1200, 799], cancelOnFail: true }));
    const events = [];
    const running = runAgentJob({ job: { id: 'decay-job', projectId, leaseVersion: 1, payload: { maxTurns: 4 } },
      run: { id: slots[1].runId, agentId, inputJson: finalBody === 'valid' ? input : {format:'manju', episodeNo:2} },
      publish: event => {
        events.push(event);
        if (event.phase === 'post_body' && finalBody.startsWith('newer-')) {
          const length = finalBody === 'newer-short' ? 799 : 1000;
          manuscripts[1] = {...manuscripts[1], version: 2, bodyMarkdown: '字'.repeat(length)};
        }
        if (event.phase === 'done_exit' && event.ok) {
          if (finalBody === 'removed') manuscripts.pop();
          if (finalBody === 'shortened') manuscripts[1].bodyMarkdown = '字'.repeat(799);
        }
      } });
    if (finalBody.startsWith('newer-')) {
      if (finalBody === 'newer-short') await assert.rejects(running, /当前 799 字 < 800/);
      else {
        const result = await running;
        assert.equal(result.status, 'succeeded');
        assert.equal(result.outputVersions[manuscripts[1].id], undefined);
      }
      const receipt = events.find(e => e.type === 'receipt');
      const expected = finalBody === 'newer-short' ? 'fail' : 'pass';
      assert.equal(events.find(e => e.phase === 'post_body').gates[0].result, 'warn');
      const checks = receipt.gates.filter(g => ['length_decay','LengthDecay'].includes(g.id));
      assert.ok(checks.some(g => g.id === 'LengthDecay'));
      assert.ok(checks.every(g => g.result === expected && g.evidence.version === 2 &&
        g.evidence.artifactId === manuscripts[1].id));
      assert.equal(receipt.lifecycle.post.lengths.at(-1), finalBody === 'newer-short' ? 799 : 1000);
      assert.equal(api.cancelJob.mock.callCount(), 0);
      return;
    }
    if (finalBody !== 'valid') {
      await assert.rejects(running, finalBody === 'shortened' ? /当前 799 字 < 800/ : /缺少本次运行的有效正文/);
      const evidence = events.find(e => e.phase === 'post_body').gates[0];
      assert.equal(evidence.result, finalBody === 'shortened' ? 'fail' : 'inconclusive');
      assert.equal(api.cancelJob.mock.callCount(), 0);
      return;
    }
    const result = await running;
    assert.equal(result.status, 'succeeded');
    assert.equal(result.exitReason, 'done_contract_pass');
    assert.match(result.receipt.handoff, /repair=0; hardStop=false/);
    assert.ok(result.receipt.gateResults.some(g => g.id === 'length_decay' && g.result === 'warn'));
    assert.ok(events.some(e => e.phase === 'post_body' && e.gates[0].result === 'warn'));
    assert.equal(api.cancelJob.mock.callCount(), 0);
  });

}
