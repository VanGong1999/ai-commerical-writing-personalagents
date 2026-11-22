import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/apiClient.js';

test('local admission rejection retains provenance and never reports a provider throttle',async()=>{
 const original=globalThis.fetch;const paths=[];
 globalThis.fetch=async url=>{paths.push(String(url));return new Response(JSON.stringify({
  code:'local_queue_timeout',source:'local',retryable:true,retryAfter:1,message:'本地容量等待超时',
 }),{status:503,headers:{'Content-Type':'application/json'}});};
 try {
  await assert.rejects(api.chat([]),e=>e.code==='local_queue_timeout' && e.source==='local' && e.status===503);
  assert.equal(paths.length,1);
 } finally {globalThis.fetch=original;}
});

test('upstream 429 is not reported twice by worker HTTP client',async()=>{
 const original=globalThis.fetch;const paths=[];
 globalThis.fetch=async url=>{paths.push(String(url));return new Response(JSON.stringify({
  code:'provider_rate_limited',source:'provider',retryable:false,governorReported:true,message:'quota exceeded',
 }),{status:429});};
 try {
  await assert.rejects(api.chat([]),e=>e.retryable===false && e.source==='provider');
  assert.equal(paths.length,1);
 } finally {globalThis.fetch=original;}
});

test('lost mutation response is not retried after a possible committed artifact write', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError('fetch failed after commit'); };
  try {
    await assert.rejects(api.createArtifact('p', { type: 'custom_note', title: 'new', bodyMarkdown: 'text' }), error => error.code === 'mutation_result_unknown');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('proxy failure on mutation also requires inspection rather than retry', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('gateway error', { status: 502 }); };
  try {
    await assert.rejects(api.createArtifact('p', { type: 'custom_note', title: 'new', bodyMarkdown: 'text' }), error => error.code === 'mutation_result_unknown');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('read-only citation batch retries a lost response without opening write recovery', async t => {
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(init.method, 'POST');
    attempts++;
    if (attempts === 1) throw new TypeError('fetch failed');
    if (attempts === 2) return new Response('gateway', {status:502});
    return Response.json({citations:[]});
  });
  assert.deepEqual(await api.knowledgeCitations('r','j','version',[]), {citations:[]});
  assert.equal(attempts,3);
});
