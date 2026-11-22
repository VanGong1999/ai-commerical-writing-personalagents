import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../src/apiClient.js';

test('worker supplies service credential for ordinary and CAS requests', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.LOCAL_API_TOKEN;
  process.env.LOCAL_API_TOKEN = 'isolated-test-token';
  const seen = [];
  globalThis.fetch = async (_url, init) => {
    seen.push(new Headers(init.headers).get('X-XZM-Local-Token'));
    return new Response('{}', {headers:{'Content-Type':'application/json'}});
  };
  try {
    await api.getMemoryFile('test');
    await api.putMemoryFileCas({path:'test', content:'content', expected_hash:'hash'});
    assert.deepEqual(seen, ['isolated-test-token', 'isolated-test-token']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.LOCAL_API_TOKEN;
    else process.env.LOCAL_API_TOKEN = originalToken;
  }
});
