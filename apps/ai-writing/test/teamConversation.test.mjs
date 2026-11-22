import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { resolveTeamConversation, selectTeamConversation } from '../src/features/bots/teamConversation.ts';

const team = {
  id: 'team', name: '漫剧主线编组', templateId: 'manju', memberBotIds: ['chief', 'qc.de_ai'],
  speakPolicy: 'pipeline', rulesMd: '按阶段接力', truthSourcePath: '/memories/user/truth.md',
};
const preset = { id: 'manju', format: 'manju', stages: [{ id: 'review', memberBotIds: ['qc.de_ai'] }] };
const fullRules = { rulesMd: team.rulesMd, format: preset.format, stages: preset.stages };
const full = { id: 'created', teamId: team.id, kind: 'group', groupRules: fullRules };
const incomplete = { id: 'duplicate', teamId: team.id, kind: 'group', groupRules: { rulesMd: team.rulesMd } };

test('wizard handoff caches and opens the exact conversation after only its original create', async () => {
  const cache = new QueryClient();
  cache.setQueryData(['conversations'], [incomplete]);
  const creates = [];
  const api = {
    async createConversation(input) { creates.push(input); return full; },
    async listConversations() { assert.fail('handoff already has the response'); },
    async listSquads() { assert.fail('handoff already has full group rules'); },
  };
  const created = await api.createConversation({ groupRules: fullRules });
  const opened = await resolveTeamConversation(cache, api, team, created);
  assert.equal(creates.length, 1);
  assert.equal(opened, created);
  assert.deepEqual(opened.groupRules, fullRules);
  assert.deepEqual(cache.getQueryData(['conversations']), [full, incomplete]);
});

test('opening a saved preset team prefers the existing conversation with stages', async () => {
  const cache = new QueryClient();
  const api = {
    async listConversations() { return [incomplete, full]; },
    async createConversation() { assert.fail('a conversation already exists'); },
    async listSquads() { assert.fail('existing conversation already has stages'); },
  };
  assert.equal(await resolveTeamConversation(cache, api, team), full);
});

test('imported preset team fallback carries registered format and stages', async () => {
  const cache = new QueryClient();
  const api = {
    async listConversations() { return []; },
    async listSquads() { return { squads: [{ id: 'other' }, preset] }; },
    async createConversation(input) { return { id: 'fallback', ...input }; },
  };
  const opened = await resolveTeamConversation(cache, api, team);
  assert.deepEqual(opened.groupRules, {
    ...fullRules, speakPolicy: 'pipeline', truth_source_path: team.truthSourcePath,
  });
  assert.deepEqual(cache.getQueryData(['conversations']), [opened]);
});

test('late team lookup and wizard completion cannot replace the selected project', async () => {
  const generation = {current:0};
  const shown = [];
  let resolveA;
  const waitA = new Promise(resolve => { resolveA = resolve; });
  const a = selectTeamConversation(generation, 'A', () => waitA, c => shown.push(c.id));
  const openedWizard = generation.current;
  generation.current++; // project picker changes A to B
  await selectTeamConversation(generation, 'B', async () => ({id:'B-conv',projectId:'B'}), c => shown.push(c.id));
  resolveA({id:'A-conv',projectId:'A'});
  await a;
  await selectTeamConversation(generation, 'B', () => assert.fail('stale wizard must not load'), c => shown.push(c.id), openedWizard);
  await selectTeamConversation(generation, 'B', async () => ({id:'mismatch',projectId:'A'}), c => shown.push(c.id));
  assert.deepEqual(shown,['B-conv']);
});
