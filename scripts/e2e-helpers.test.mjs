import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from './e2e-helpers.mjs';

test('an ambiguous POST response never repeats a write', async t => {
  const request = t.mock.method(globalThis, 'fetch', async () => new Response('', {status:503}));
  await assert.rejects(api('POST','/runs',{}), /503/);
  assert.equal(request.mock.callCount(),1);
  assert.ok(request.mock.calls[0].arguments[1].signal instanceof AbortSignal);
});
