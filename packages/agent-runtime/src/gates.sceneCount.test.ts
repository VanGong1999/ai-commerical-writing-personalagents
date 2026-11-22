import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSceneCount } from './gates.extended.ts';

test('one explicit location with many actions and shots remains one scene',()=>{
 const body='【场景1】旧车站 内 夜\n'+Array.from({length:20},(_,i)=>`△林晚检查第${i+1}件物品。\n分镜${i+1}：手部特写。`).join('\n\n');
 assert.equal(checkSceneCount(body).result,'pass');
 assert.match(checkSceneCount(body).message,/1/);
});
test('four explicit scene boundaries exceed a limit of three',()=>{
 for(const headers of [Array.from({length:4},(_,i)=>`场${i+1}：旧站`),Array.from({length:4},(_,i)=>`场景${i+1}：旧站`),Array.from({length:4},(_,i)=>`场景${i+1}｜旧站`),['第一场：旧站','第二场：街道','第三场：仓库','第四场：月台'],Array.from({length:4},(_,i)=>`1-${i+1} 旧站 内 夜`),Array.from({length:4},(_,i)=>`${i+1}|旧站|内|夜`)])
  assert.equal(checkSceneCount(headers.join('\n△动作。\n')).result,'fail');
});
test('unmarked prose, actions and storyboard paragraphs require human review',()=>{
 for(const text of ['',Array(20).fill('自然段。').join('\n\n'),Array(20).fill('△动作。\n分镜：特写。').join('\n\n'),'场景气氛很紧张。\n场面陷入沉默。\n场外传来声音。','1-1 特写\n1-2 中景\n1-3 全景\n1-4 近景'])
  assert.equal(checkSceneCount(text).result,'warn');
});
test('canonical numbered interior and Markdown scene headers are recognized',()=>{
 for(const text of ['场景1｜夜·月台\n△走近。','1-1 内 旧站 夜\n△走近。','### 场景：旧站\n△走近。','【景1】旧站\n△走近。'])
  assert.equal(checkSceneCount(text).result,'pass');
});
