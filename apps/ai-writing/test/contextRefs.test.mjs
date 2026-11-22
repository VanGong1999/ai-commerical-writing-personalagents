import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionRequest, applySelectionEdit, sameReference } from '../src/features/references/selection.ts';

test('selection preserves whitespace, repeated occurrences and UTF16 emoji positions', () => {
  const text = '😀开场\n  他说：走。\n  他说：走。';
  const start = text.lastIndexOf('  他说');
  const ref = selectionRequest({kind:'artifact', sourceId:'a', version:2, title:'第3集'}, text, start, text.length);
  assert.equal(ref.quote, '  他说：走。');
  assert.equal(ref.start, start);
  assert.equal(ref.draftText, text);
  assert.equal(sameReference(ref, {...ref, start: text.indexOf('  他说')}), false);
});

test('applying an edit changes only its selected range', () => {
 const ref = selectionRequest({kind:'artifact',sourceId:'a',version:2}, '前文。原文。后文。', 3, 6);
 assert.equal(applySelectionEdit('a', '前文。原文。后文。', ref, '改写。'), '前文。改写。后文。');
});

test('changed source, changed draft and mismatching selection are refused', () => {
 const ref = selectionRequest({kind:'artifact',sourceId:'a',version:2}, '甲乙丙', 1, 2);
 assert.throws(() => applySelectionEdit('b', '甲乙丙', ref, '新'), /切换/);
 assert.throws(() => applySelectionEdit('a', '甲乙丙丁', ref, '新'), /修改/);
 assert.throws(() => applySelectionEdit('a', '甲乙丙', {...ref, quote:'错'}, '新'), /选区/);
});

test('empty or invalid ranges including split surrogate pairs are rejected', () => {
 for (const [s,e] of [[0,0],[-1,2],[0,5],[1,2]]) {
  assert.throws(() => selectionRequest({kind:'draft',sourceId:'a'}, '😀甲', s,e));
 }
});

test('edited draft snapshots outside the selection remain distinct references', () => {
 const a=selectionRequest({kind:'draft',sourceId:'a'},'甲乙丙',1,2);
 const b=selectionRequest({kind:'draft',sourceId:'a'},'甲乙丁',1,2);
 assert.equal(sameReference(a,b),false);
});

test('failed send restores its refs without deleting next-turn refs', async () => {
 const {mergeReferences}=await import('../src/features/references/selection.ts');
 const sent=selectionRequest({kind:'draft',sourceId:'a'},'甲乙丙',0,1);
 const next=selectionRequest({kind:'draft',sourceId:'b'},'丁戊己',0,1);
 assert.deepEqual(mergeReferences([next],[sent]),[next,sent]);
 assert.deepEqual(mergeReferences([next,sent],[sent]),[next,sent]);
});
