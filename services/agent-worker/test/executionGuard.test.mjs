import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionGuard } from '../src/queueClaim.js';

test('duplicate envelopes and different jobs for the same run cannot execute together', async () => {
  const guard = createExecutionGuard();
  let release;
  let calls = 0;
  const pending = guard.run(['job:a', 'run:r'], async () => {
    calls++;
    await new Promise(resolve => { release = resolve; });
  });
  await guard.run(['job:a', 'run:r'], async () => { calls++; });
  await guard.run(['job:b', 'run:r'], async () => { calls++; });
  await guard.run(['job:c', 'run:s'], async () => { calls++; });
  assert.equal(calls, 2);
  release();
  await pending;
  await guard.run(['job:b', 'run:r'], async () => { calls++; });
  assert.equal(calls, 3);
});

test('failed execution releases all guard keys for recovery', async () => {
  const guard = createExecutionGuard();
  await assert.rejects(guard.run(['job:a', 'run:r'], async () => { throw new Error('lost'); }));
  let resumed = false;
  await guard.run(['job:b', 'run:r'], async () => { resumed = true; });
  assert.equal(resumed, true);
});
