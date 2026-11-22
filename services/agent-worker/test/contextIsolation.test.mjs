import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bootstrapRunMemory, loadAgentLessons, lessonsPath } from '../src/contextMemory.js';
import { buildAgentSystemSlots } from '../src/runSession.js';
import { listAgents, loadSkill } from '@xiezuomanju/agent-runtime';

test('bootstrap reads canonical bible and only this project agent lessons', async () => {
  const reads = [];
  const own = lessonsPath('p', 'a');
  const client = {
    bootstrapMemoryMounts: async () => [],
    memoryTree: async () => { throw new Error('must not enumerate other projects'); },
    getMemoryFile: async path => { reads.push(path); return { content: path === own ? 'OWN LESSON' : path.endsWith('/bible/decisions.md') ? 'CANONICAL LOCK' : 'UNRELATED' }; },
  };
  const memory = await bootstrapRunMemory(client, { projectId: 'p', agentId: 'a', runId: 'r' });
  assert.equal(memory.coreFacts, 'CANONICAL LOCK');
  assert.equal(memory.lessons, 'OWN LESSON');
  assert.deepEqual(reads, ['/memories/projects/p/bible/decisions.md', own]);
});

test('legacy decisions fallback and explicitly approved same-agent portable lessons reuse existing files', async () => {
  const own = lessonsPath('p', 'a');
  const portable = lessonsPath('approved', 'a');
  const reads = [];
  const client = { bootstrapMemoryMounts: async () => [], getMemoryFile: async path => {
    reads.push(path);
    return { content: path.endsWith('/bible/decisions.md') ? '' : path === own ? 'OWN' : path === portable ? 'PORTABLE' : path.endsWith('/decisions.md') ? 'LEGACY LOCK' : 'OTHER AGENT' };
  } };
  const out = await bootstrapRunMemory(client, { projectId: 'p', agentId: 'a', portableLessonPaths: [portable, lessonsPath('q', 'b')] });
  assert.equal(out.coreFacts, 'LEGACY LOCK');
  assert.equal(out.lessons, 'OWN\nPORTABLE');
  assert.ok(!reads.includes(lessonsPath('q', 'b')));
});

test('all registered launch prompts keep static prefix stable across projects, dates, tasks and preferences', () => {
  for (const agent of listAgents()) {
    const skill = loadSkill(agent.skillPath);
    for (const progressiveSkills of [true, false]) {
      const a = buildAgentSystemSlots(agent, skill, { progressiveSkills }, { coreFacts: 'PROJECT A LOCK', lessons: 'A LESSON', personalization: '用户偏好甲', task: '写人设', now: new Date('2026-11-18T00:00:00Z') });
      const b = buildAgentSystemSlots(agent, skill, { progressiveSkills }, { coreFacts: 'PROJECT B LOCK', lessons: 'B LESSON', personalization: '用户偏好乙', task: '检查世界观', now: new Date('2026-11-19T00:00:00Z') });
      assert.equal(a.staticPrefix, b.staticPrefix, agent.id);
      assert.ok(a.system.startsWith(a.staticPrefix + "\n\n"), agent.id);
      assert.equal(a.staticPrefixHash, b.staticPrefixHash, agent.id);
      assert.ok(a.staticPrefix?.includes('工具调用铁律'), agent.id);
      assert.ok(a.staticPrefix?.includes(skill.name) || !progressiveSkills, agent.id);
      assert.ok(!a.staticPrefix.includes('用户偏好甲'), agent.id);
      assert.ok(!a.staticPrefix.includes('2026-11-18'), agent.id);
      assert.notEqual(a.prefixHash, b.prefixHash, agent.id);
      assert.ok(a.slots.find(s => s.id === 'runtime_context').text.includes('2026-11-18'), agent.id);
      assert.ok(a.slots.find(s => s.id === 'personalization').text.includes('用户偏好甲'), agent.id);
    }
  }
});

test('bootstrap distinguishes absent decisions from unreadable mandatory decisions', async () => {
  const reads = [];
  const client = { bootstrapMemoryMounts: async () => [], getMemoryFile: async path => {
    reads.push(path);
    if (path.includes('/bible/')) throw new Error('503 /memory/file unavailable');
    return { content: 'STALE LEGACY LOCK' };
  } };
  await assert.rejects(bootstrapRunMemory(client, { projectId: 'p', agentId: 'a' }), /503/);
  assert.deepEqual(reads, ['/memories/projects/p/bible/decisions.md']);
  client.getMemoryFile = async () => { const error = new Error('missing'); error.status = 404; throw error; };
  const memory = await bootstrapRunMemory(client, { projectId: 'new', agentId: 'a' });
  assert.equal(memory.coreFacts, '');
});
