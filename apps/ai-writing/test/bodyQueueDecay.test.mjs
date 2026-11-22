import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createServer } from 'vite';

const vite = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)),
  configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true },
  esbuild: { jsx: 'automatic' },
});
const { ManjuStagePanel } = await vite.ssrLoadModule('/src/features/studio/ManjuPanels.tsx')
  .finally(() => vite.close());

function queue(lengths, wordCounts = lengths) {
  const artifacts = lengths.map((length, i) => ({
    id: 'ep-' + i, type: 'manuscript', status: 'candidate', bodyMarkdown: '字'.repeat(length),
    bodyJson: { episodeNo: i + 1, wordCount: wordCounts[i] },
  }));
  const panel = createElement(ManjuStagePanel, {
    stage: 'S5_EP_BODY_BATCH', projectId: 'project', artifacts, onAdopt() {},
  });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, panel));
  const [, attributes] = html.match(/<button([^>]*)>注入 Bible 并串行前 3 集<\/button>/);
  return { html, disabled: attributes.includes('disabled') };
}

test('queue shows relative-length advice and permits the existing batch action', () => {
  const { html, disabled } = queue([1200, 800], [1200, 100]);
  assert.equal(disabled, false);
  assert.match(html, /1200[^<]*800[^<]*70%/);
  assert.match(html, /<td>800<\/td>/);
});

test('queue enforces the measured minimum even with a stale wordCount', () => {
  assert.equal(queue([1200, 799], [1200, 1000]).disabled, true);
  assert.equal(queue([799], [1000]).disabled, true);
  assert.equal(queue([]).disabled, false);
});
