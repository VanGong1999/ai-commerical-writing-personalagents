import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {checkPromptLock} from '../../../packages/domain/src/gateRules.ts';
import {api} from '../src/apiClient.js';
import {createWritingTools} from '../src/tools.js';
const lockedSystem='固定规则：动机清晰，禁止一次全书。';
const lockedHash='h'+createHash('sha256').update(lockedSystem).digest('hex').slice(0,12);
const active={id:'manju.hook.batch',name:'核心梗',format:['manju'],stage:'S1_HOOK_BATCH',lockedSystem,lockedHash,editableInstruction:'生成候选',variables:[{key:'_skillPath',defaultValue:'manju/core-hook'}]};

test('pack ID resolves only current agent prompt instead of dumping all bodies', async()=>{
 const before=api.listPrompts;
 try {
  api.listPrompts=async()=>[active,{id:'unrelated',lockedSystem:'UNRELATED SECRET '.repeat(3000)}];
  const tools=createWritingTools({projectId:'p',parentAgentId:'topic.core_hook_batch',allowlist:['prompt_render','prompt_validate_lock','artifact_create'],publish(){}});
  const t=tools.find(x=>x.name==='prompt_render');
  const response=await t.execute('r',{promptId:'pack.manju.default'});
  const parsed=JSON.parse(response.content[0].text);
  assert.equal(parsed.id,active.id);
  assert.doesNotMatch(response.content[0].text,/UNRELATED SECRET/);
  const missing=await t.execute('m',{promptId:'missing'});
  assert.equal(JSON.parse(missing.content[0].text).error,'prompt_not_found');
  assert.doesNotMatch(missing.content[0].text,/UNRELATED SECRET/);
 } finally {api.listPrompts=before;}
});

test('canonical prompt-id validation needs no model transcription and failed lock blocks writing',async()=>{
 const before=api.listPrompts;
 try {
  api.listPrompts=async()=>[active];
  const tools=createWritingTools({projectId:'p',parentAgentId:'topic.core_hook_batch',allowlist:['prompt_render','prompt_validate_lock','artifact_create'],publish(){}});
  const lock=tools.find(x=>x.name==='prompt_validate_lock');
  const create=tools.find(x=>x.name==='artifact_create');
  await lock.execute('bad',{promptId:active.id,lockedSystem:'改坏规则',lockedHash});
  const blocked=await create.execute('write',{type:'core_hook',title:'不应写入',bodyMarkdown:'内容'});
  assert.match(blocked.content[0].text,/锁定|prompt_lock/);
  const good=await lock.execute('good',{promptId:active.id});
  assert.equal(JSON.parse(good.content[0].text).result,'pass');
 }finally {api.listPrompts=before;}
});

test('rendered core hook catalog template supports grounded advantages under the canonical lock', async () => {
 const catalog = JSON.parse(readFileSync(new URL('../../../packages/prompt-registry/catalog.json', import.meta.url), 'utf8'));
 const template = catalog.prompts.find(prompt => prompt.id === 'manju.hook.batch');
 const {outputSchema, exampleSlots, ...served} = template;
 served.variables = [...served.variables, {
  key:'_skillPath', label:'对应 Skill', type:'string', required:false, defaultValue:catalog.skillLinks[template.id],
 }];
 const before = api.listPrompts;
 try {
  api.listPrompts = async () => [served];
  const tools = createWritingTools({
   projectId:'p', parentAgentId:'topic.core_hook_batch',
   allowlist:['prompt_render','prompt_validate_lock'], publish(){},
  });
  const render = tools.find(tool => tool.name === 'prompt_render');
  const lock = tools.find(tool => tool.name === 'prompt_validate_lock');
  const rendered = JSON.parse((await render.execute('render', {promptId:'manju.hook.batch'})).content[0].text);
  assert.deepEqual(rendered, served);
  assert.equal(outputSchema, 'CoreHookBatch');
  assert.equal(rendered.variables.find(variable => variable.key === 'count').defaultValue, 10);
  assert.match(rendered.lockedSystem, /上限 100/);
  assert.match(rendered.lockedSystem, /(?:通过 Gate|Gate 通过).{0,40}adopted|adopted.{0,40}(?:通过 Gate|Gate 通过)/);
  assert.deepEqual(rendered.requiredPhrases, ['动机','开篇','核心梗']);
  for (const phrase of rendered.requiredPhrases) assert.ok(rendered.editableInstruction.includes(phrase));
  assert.equal(JSON.parse((await lock.execute('lock', {promptId:rendered.id})).content[0].text).result, 'pass');
  assert.doesNotMatch(rendered.lockedSystem, /男女频题材不得混杂|不脱离市场|须微创新|金手指须限制型/);
  assert.doesNotMatch(rendered.editableInstruction, /男频热门向|融梗但微创新/);
  assert.match(rendered.editableInstruction, /职业.{0,24}(?:知识|资源)/);
  assert.match(rendered.editableInstruction, /课程.{0,24}(?:示例|举例)/);
 } finally { api.listPrompts = before; }
});

async function withRenderedCatalogPrompts(run) {
 const catalog = JSON.parse(readFileSync(new URL('../../../packages/prompt-registry/catalog.json', import.meta.url), 'utf8'));
 const served = catalog.prompts.map(({outputSchema, exampleSlots, ...row}) => ({
  ...row,
  variables:[...row.variables, {
   key:'_skillPath', label:'对应 Skill', type:'string', required:false, defaultValue:catalog.skillLinks[row.id],
  }],
 }));
 const before = api.listPrompts;
 try {
  api.listPrompts = async () => served;
  await run(async promptId => {
   const tools = createWritingTools({
    projectId:'p', parentAgentId:catalog.agentLinks[promptId],
    allowlist:['prompt_render','prompt_validate_lock'], publish(){},
   });
   const render = tools.find(tool => tool.name === 'prompt_render');
   const lock = tools.find(tool => tool.name === 'prompt_validate_lock');
   const rendered = JSON.parse((await render.execute('render', {promptId})).content[0].text);
   assert.equal(rendered.id, promptId);
   assert.equal(JSON.parse((await lock.execute('lock', {promptId:rendered.id})).content[0].text).result, 'pass');
   return rendered;
  });
 } finally {api.listPrompts = before;}
}

function assertValidPromptInstructions({editableInstruction, requiredPhrases, lockedHash, lockedSystem}) {
 const checks = checkPromptLock(editableInstruction, requiredPhrases, lockedHash, lockedSystem);
 assert.deepEqual(checks.filter(check => check.result !== 'pass'), []);
}

test('locked de-AI prompt preserves deliberate simile, long dialogue and limited viewpoint', () => withRenderedCatalogPrompts(async render => {
 const prompt = await render('manju.deai');
 assert.doesNotMatch(prompt.lockedSystem, /长句不超过\s*20\s*字|禁止一切套路比喻|删除「感觉」/);
 assert.match(prompt.lockedSystem, /保留.{0,60}(?:有意|有叙事作用).{0,10}比喻.{0,90}长句/);
 assert.match(prompt.lockedSystem, /「感觉」.{0,16}「似乎」.{0,60}线索/);
 assert.match(prompt.lockedSystem, /(?:有限视角|人物声口).{0,60}(?:照留|保留)/);
 assert.match(prompt.lockedSystem, /禁止改变主题.{0,40}结局/);
 assert.match(prompt.lockedSystem, /按集\/按场/);
 assert.deepEqual(prompt.gates, ['deai_checklist']);
 assertValidPromptInstructions(prompt);
}));

test('locked story prompts support an occupational realist lead and retain the bible and human confirmation', () => withRenderedCatalogPrompts(async render => {
 const bio = await render('manju.bio');
 const bible = await render('manju.bible_guard');
 const body = await render('manju.episode_body');
 const upgrade = await render('male.upgrade');
 for (const prompt of [bio, bible, body, upgrade]) {
  assert.match(prompt.lockedSystem, /职业.{0,24}(?:技能|知识|资源|权限)/);
  assert.match(prompt.lockedSystem, /无需.{0,14}(?:虚构|增设|新增).{0,8}(?:超能力|金手指|异能)/);
  assertValidPromptInstructions(prompt);
 }
 assert.match(bio.lockedSystem, /S3_BIO_ACK.{0,22}不得宣称可开写大纲/);
 assert.match(bible.lockedSystem, /locked_cast\s*\/\s*gold_finger_limits\s*\/\s*last_summary\s*\/\s*open_foreshadows/);
 assert.match(bible.lockedSystem, /人设 bible 为空.{0,12}fail/);
 assert.match(body.lockedSystem, /缺则拒绝/);
 assert.match(body.lockedSystem, /一次只写一集.{0,20}QA/);
 assert.equal(body.variables.find(variable => variable.key === 'targetChars').defaultValue, 1000);
 assert.match(body.lockedSystem, /实际 LengthDecay.{0,24}停止后续集/);
}));

test('locked redline and opening prompts put uncertain platform and genre judgments in review hints', () => withRenderedCatalogPrompts(async render => {
 const redline = await render('duanju.redline');
 const opening = await render('short.opening');
 assert.doesNotMatch(redline.lockedSystem, /高风险必须 fail/);
 assert.match(redline.lockedSystem, /(?:单个|单一)关键词.{0,40}(?:不能|不足以).{0,10}(?:认定|证明)/);
 assert.match(redline.lockedSystem, /(?:来源|出处).{0,50}(?:未知|待核实)/s);
 assert.match(redline.lockedSystem, /待复核提示/);
 assert.match(redline.lockedSystem, /不提供规避审查/);
 assert.doesNotMatch(opening.lockedSystem, /必须含冲突|禁止慢热/);
 assert.match(opening.lockedSystem, /慢热.{0,75}可保留/);
 assert.match(opening.lockedSystem, /只交付开篇.{0,40}禁止全书/);
 assert.match(opening.lockedSystem, /不得照抄原文句/);
 for (const prompt of [redline, opening]) assertValidPromptInstructions(prompt);
}));

test('locked outline and pitch prompts retain chunk, source and release requirements', () => withRenderedCatalogPrompts(async render => {
 const manju = await render('manju.ep10.outline');
 const outline = await render('duanju.ep10.outline');
 const pitch = await render('manju.pitch_pack');
 assert.match(manju.lockedSystem, /仅输出前 10 集/);
 assert.match(manju.lockedSystem, /episode_no.{0,120}hook_at_end.{0,25}据实填写/);
 assert.ok(manju.gates.includes('episode_hook'));
 assert.match(manju.lockedSystem, /episode_hook.{0,18}复核提示/);
 assert.match(manju.lockedSystem, /集尾标记为 false.{0,24}通过结构检查后.{0,24}仍可由作者确认或采纳/);
 assert.match(outline.lockedSystem, /仅输出 EP1–EP10/);
 assert.match(outline.lockedSystem, /episodeNo.{0,100}hookAtEnd.{0,24}beats\[\]/);
 assert.match(outline.lockedSystem, /hookAtEnd.{0,35}据实填写/);
 assert.match(outline.lockedSystem, /Ep1Hook.{0,30}(?:提示|复核)/);
 assert.match(outline.lockedSystem, /人工确认/);
 assert.match(pitch.lockedSystem, /禁止编造未在项目 artifact 中出现的设定/);
 assert.match(pitch.lockedSystem, /缺关键件.{0,40}不得宣称可投/);
 assert.match(pitch.lockedSystem, /材料齐全后仍须作者确认最终文本和投递/);
 for (const prompt of [manju, outline, pitch]) assertValidPromptInstructions(prompt);
}));

test('wildcard prompt author sees project templates without unrelated bodies', async () => {
 const previous = {listPrompts:api.listPrompts, getProject:api.getProject};
 try {
  api.getProject = async () => ({format:'manju'});
  api.listPrompts = async () => [active, {...active,id:'other',format:['duanju']}];
  const tools = createWritingTools({projectId:'p',parentAgentId:'prompt.four_part',allowlist:['prompt_render'],publish(){}});
  for (const args of [{},{promptId:'pack.manju.default'}]) {
   const result = await tools.find(t=>t.name==='prompt_render').execute('read',args);
   const index = JSON.parse(result.content[0].text).prompts;
   assert.deepEqual(index.map(p=>p.id),[active.id]);
   assert.equal(index[0].lockedSystem,undefined);
  }
 } finally {Object.assign(api,previous);}
});

test('story shell gates validate only the persisted current run topic card', async () => {
 const original = api.listArtifacts;
 const body = {story_shell:'目标',shell_reason:'宴会上追索名单',midpoint_type:'假目标真目标',pay_model:'重付费'};
 try {
  const card = {id:'card',type:'topic_card',createdByRunId:'r',bodyJson:body};
  api.listArtifacts = async () => [card,{...card,id:'foreign',createdByRunId:'old'},{...card,id:'wrong',type:'other'}];
  const tools = createWritingTools({projectId:'p',runId:'r',parentAgentId:'topic.story_shell',allowlist:['gate_run'],publish(){}});
  const gate = tools.find(t=>t.name==='gate_run');
  for (const name of ['Schema','ShellGate']) {
   for (const [artifactId,expected] of [['card',true],['foreign',false],['wrong',false],[undefined,false]]) {
    const result = await gate.execute('check',{name,payload:{artifactId,body}});
    assert.equal(JSON.parse(result.content[0].text).passed,expected);
   }
  }
 } finally {api.listArtifacts=original;}
});

test('prompt author requires a canonical template to earn PromptLock through either tool', async () => {
 const original = {listPrompts:api.listPrompts, getProject:api.getProject};
 try {
  api.getProject = async () => ({format:'manju'});
  api.listPrompts = async () => [active,{...active,id:'foreign',format:['duanju']}];
  const tools = createWritingTools({parentAgentId:'prompt.four_part',projectId:'p',allowlist:['prompt_validate_lock','gate_run'],publish(){}});
  const lock = tools.find(t => t.name === 'prompt_validate_lock');
  const gate = tools.find(t => t.name === 'gate_run');
  const lockedSystem = '自编规则';
  const pair = {lockedSystem,lockedHash:'h'+createHash('sha256').update(lockedSystem).digest('hex').slice(0,12)};
  assert.equal(JSON.parse((await lock.execute('fake',pair)).content[0].text).result,'fail');
  assert.equal(JSON.parse((await gate.execute('fake',{name:'PromptLock',payload:pair})).content[0].text).passed,false);
  assert.equal(JSON.parse((await lock.execute('foreign',{promptId:'foreign'})).content[0].text).result,'fail');
  assert.equal(JSON.parse((await lock.execute('real',{promptId:active.id})).content[0].text).result,'pass');
  assert.equal(JSON.parse((await gate.execute('real',{name:'PromptLock',payload:{promptId:active.id}})).content[0].text).passed,true);
  const standalone = createWritingTools({projectId:'p',allowlist:['prompt_validate_lock'],publish(){}}).find(t=>t.name==='prompt_validate_lock');
  assert.equal(JSON.parse((await standalone.execute('standalone',pair)).content[0].text).result,'pass');
 } finally {Object.assign(api,original);}
});

test('explicit downstream template IDs respect the wildcard project format', async () => {
 const original = {listPrompts:api.listPrompts, getProject:api.getProject};
 try {
  api.getProject = async () => ({format:'manju'});
  api.listPrompts = async () => [active,{...active,id:'foreign',format:['duanju'],lockedSystem:'foreign body'},{...active,id:'global',format:['*']}];
  const tools = createWritingTools({parentAgentId:'prompt.four_part',projectId:'p',allowlist:['prompt_render'],publish(){}});
  const render = tools.find(t => t.name === 'prompt_render');
  const result = await render.execute('foreign',{promptId:'foreign'});
  assert.equal(JSON.parse(result.content[0].text).error,'prompt_not_found');
  assert.doesNotMatch(result.content[0].text,/foreign body/);
  for (const id of [active.id,'global']) assert.equal(JSON.parse((await render.execute('valid',{promptId:id})).content[0].text).id,id);
 } finally {Object.assign(api,original);}
});
