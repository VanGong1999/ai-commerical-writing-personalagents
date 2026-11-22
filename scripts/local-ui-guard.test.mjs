import test from 'node:test';
import assert from 'node:assert/strict';
import {localUiAllowed, localUiGuard} from './local-ui-guard.mjs';
const request = (peer, headers={}) => ({socket:{remoteAddress:peer}, headers:{host:'localhost:5173', ...headers}});
test('local UI works, remote and rebinding requests are blocked before proxy injection', () => {
  assert.equal(localUiAllowed(request('127.0.0.1')), true);
  assert.equal(localUiAllowed(request('::1')), true);
  assert.equal(localUiAllowed(request('::ffff:127.0.0.1')), true);
  assert.equal(localUiAllowed(request('192.168.1.12', {'x-forwarded-for':'127.0.0.1'})), false);
  assert.equal(localUiAllowed(request('127.0.0.1', {host:'evil.example'})), false);
  assert.equal(localUiAllowed(request('127.0.0.1', {origin:'https://evil.example'})), false);
  assert.equal(localUiAllowed(request('127.0.0.1', {origin:'null'})), false);
  assert.equal(localUiAllowed(request('127.0.0.1', {'sec-fetch-site':'cross-site'})), false);
});

for (const hook of ['configureServer', 'configurePreviewServer']) {
  test(`${hook} installs the local access middleware without returning a post-hook`, (t) => {
    const handlers = [];
    // Connect's use() returns its callable app for chaining.
    const middlewares = Object.assign(() => {}, {
      use(handler) {
        handlers.push(handler);
        return middlewares;
      },
    });

    assert.equal(localUiGuard()[hook]({middlewares}), undefined);
    assert.equal(handlers.length, 1);

    const [guard] = handlers;
    const response = {statusCode: 200, end: t.mock.fn()};
    const next = t.mock.fn();
    guard(request('127.0.0.1'), response, next);
    assert.equal(next.mock.callCount(), 1);
    assert.equal(response.end.mock.callCount(), 0);

    guard(request('192.168.1.12'), response, next);
    assert.equal(next.mock.callCount(), 1);
    assert.equal(response.statusCode, 403);
    assert.equal(response.end.mock.callCount(), 1);
  });
}
