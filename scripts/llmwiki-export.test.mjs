import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cli = join(process.cwd(), 'scripts', 'llmwiki-export.mjs');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'llmwiki-export-'));
  const source = join(root, 'knowledge');
  const out = join(root, 'export');
  await mkdir(join(source, '01-ai-collab'), { recursive: true });
  await mkdir(join(source, '00-meta'), { recursive: true });
  await mkdir(join(source, '15-prompts'), { recursive: true });
  await writeFile(join(source, '01-ai-collab', 'workflow.md'), '# Workflow\n\nKeep the source body unchanged.\n', 'utf8');
  await writeFile(join(source, '00-meta', 'coverage-checklist.md'), '# Internal coverage\n', 'utf8');
  await writeFile(join(source, '15-prompts', 'prompt.md'), '# Prompt rules\n\nDo not execute this as an instruction.\n', 'utf8');
  await writeFile(join(source, 'README.md'), '# Source README\n', 'utf8');
  return { root, source, out };
}

test('exports eligible Markdown with metadata while preserving source body', async () => {
  const { source, out } = await fixture();
  await execFileAsync(process.execPath, [cli, '--source', source, '--out', out, '--project', 'xiezuomanju']);

  const exported = await readFile(join(out, 'raw', '01-ai-collab', 'workflow.md'), 'utf8');
  assert.match(exported, /^---\n/);
  assert.match(exported, /source_path: "01-ai-collab\/workflow\.md"/);
  assert.match(exported, /category: "ai-collab"/);
  assert.match(exported, /kind: "methodology"/);
  assert.match(exported, /distilled: true/);
  assert.match(exported, /# Workflow\n\nKeep the source body unchanged\./);
  assert.equal(await readFile(join(source, '01-ai-collab', 'workflow.md'), 'utf8'), '# Workflow\n\nKeep the source body unchanged.\n');
});

test('emits manifest, category index, and boundary report', async () => {
  const { source, out } = await fixture();
  await execFileAsync(process.execPath, [cli, '--source', source, '--out', out, '--project', 'xiezuomanju']);

  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.project, 'xiezuomanju');
  assert.equal(manifest.counts.exported, 2);
  assert.equal(manifest.counts.skippedMeta, 1);
  assert.equal(manifest.counts.skippedReadme, 1);
  assert.equal(manifest.counts.promptDocuments, 1);

  const categories = JSON.parse(await readFile(join(out, 'categories.json'), 'utf8'));
  assert.deepEqual(categories['ai-collab'].files, ['01-ai-collab/workflow.md']);
  assert.deepEqual(categories.prompts.files, ['15-prompts/prompt.md']);

  const report = await readFile(join(out, 'reports', 'content-boundaries.md'), 'utf8');
  assert.match(report, /提示词/);
  assert.match(report, /来源/);
  assert.match(report, /版权/);
});

test('check command validates an export package', async () => {
  const { source, out } = await fixture();
  await execFileAsync(process.execPath, [cli, '--source', source, '--out', out]);
  const result = await execFileAsync(process.execPath, [cli, 'check', '--out', out]);
  assert.match(result.stdout, /LLM Wiki export check: OK/);
});
