import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {initConfig} from '../dist/config.js';
import {api, apiForm, apiBinary, rootHealth} from '../dist/http.js';
import {streamSse} from '../dist/sse.js';

test('CLI sends its credential on JSON, health, uploads, downloads and SSE', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers['x-xzm-local-token']);
    req.resume();
    if (req.url.endsWith('/events')) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.end('data: {"type":"done"}\n\n');
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end('{}');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const previous = process.env.LOCAL_API_TOKEN;
  process.env.LOCAL_API_TOKEN = 'isolated-cli-secret';
  initConfig({apiBase:`http://127.0.0.1:${server.address().port}`});
  try {
    await api('GET', '/test');
    await rootHealth();
    await apiForm('/test', new FormData());
    await apiBinary('GET', '/test');
    await streamSse('GET', '/events', undefined, () => false);
    assert.deepEqual(seen, Array(5).fill('isolated-cli-secret'));
  } finally {
    if (previous === undefined) delete process.env.LOCAL_API_TOKEN;
    else process.env.LOCAL_API_TOKEN = previous;
    await new Promise(resolve => server.close(resolve));
  }
});
