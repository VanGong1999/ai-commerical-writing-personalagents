import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../src/apiClient.js';
import {createWritingTools} from '../src/tools.js';

function tool(name) {
  return createWritingTools({projectId:'p',runId:'run',publish(){},allowlist:['artifact_list','artifact_create']}).find(t=>t.name===name);
}
const parse = response => JSON.parse(response.content[0].text);
const rows = Array.from({length:45},(_,i)=>({id:`a${i}`,projectId:'p',type:'other',title:`候选${i}`,status:'candidate',version:1,createdByRunId:'run',updatedAt:'2026-11-19',bodyMarkdown:`正文${i} `+'甲'.repeat(12000),bodyJson:{episodeNo:i,notes:'乙'.repeat(12000)}}));

test('compact artifact list paginates metadata without emitting any bodies',async()=>{
  const original=api.listArtifacts;
  try {
    api.listArtifacts=async()=>rows;
    const list=tool('artifact_list');
    const first=parse(await list.execute('first',{}));
    assert.equal(first.artifacts.length,40);
    assert.equal(first.hasMore,true);
    assert.equal(first.nextOffset,40);
    assert.equal(first.count,45);
    assert.doesNotMatch(JSON.stringify(first),/甲|乙/);
    const rest=parse(await list.execute('rest',{offset:first.nextOffset}));
    assert.deepEqual(rest.artifacts.map(a=>a.id),rows.slice(40).map(a=>a.id));
    assert.equal(rest.hasMore,false);
  } finally { api.listArtifacts=original; }
});

test('full reads require bounded pages and can select one exact artifact',async()=>{
  const original=api.listArtifacts;
  try {
    api.listArtifacts=async()=>rows;
    const list=tool('artifact_list');
    const first=parse(await list.execute('full',{full:true}));
    assert.equal(first.artifacts.length,3);
    assert.equal(first.hasMore,true);
    assert.ok(JSON.stringify(first).length<30000);
    const exact=parse(await list.execute('exact',{full:true,artifactId:'a7',bodyOffset:4,bodyLimit:100}));
    assert.equal(exact.count,1);
    assert.equal(exact.artifacts.length,1);
    const artifact=exact.artifacts[0];
    assert.equal(artifact.id,'a7');
    assert.equal(artifact.bodyMarkdown,rows[7].bodyMarkdown.slice(4,104));
    assert.equal(artifact.bodyCoverage.markdown.hasMore,true);
    assert.equal(artifact.bodyCoverage.markdown.nextOffset,104);
    assert.equal(artifact.bodyCoverage.json.totalChars,JSON.stringify(rows[7].bodyJson).length);
    assert.equal(artifact.bodyJson,undefined);
    assert.equal(artifact.bodyJsonText.length,100);
    assert.match(exact.hint,/artifactId|bodyOffset/);
    const capped=parse(await list.execute('capped',{full:true,limit:999,bodyLimit:999999}));
    assert.equal(capped.artifacts.length,10);
    assert.ok(capped.artifacts.every(a=>a.bodyMarkdown.length<=8000 && (a.bodyJsonText||'').length<=8000));
    assert.equal(rows[7].bodyMarkdown.length,12004);
  } finally { api.listArtifacts=original; }
});

test('small JSON remains structured, missing identity is honest, and create returns only receipt',async()=>{
  const original={list:api.listArtifacts,create:api.createArtifact};
  try {
    api.listArtifacts=async()=>[{...rows[0],bodyMarkdown:'短文',bodyJson:{episodeNo:1}}];
    const list=tool('artifact_list');
    const small=parse(await list.execute('small',{full:true,artifactId:'a0'}));
    assert.deepEqual(small.artifacts[0].bodyJson,{episodeNo:1});
    assert.equal(small.artifacts[0].bodyCoverage.markdown.truncated,false);
    assert.deepEqual(parse(await list.execute('missing',{artifactId:'missing'})).artifacts,[]);
    api.createArtifact=async()=>rows[0];
    const created=parse(await tool('artifact_create').execute('create',{type:'other',title:'正文',bodyMarkdown:'甲'.repeat(12000)}));
    assert.equal(created.id,'a0');
    assert.equal(created.version,1);
    assert.equal(created.createdByRunId,'run');
    assert.equal(created.bodyChars,rows[0].bodyMarkdown.length);
    assert.equal(created.bodyMarkdown,undefined);
    assert.equal(created.bodyJson,undefined);
    assert.ok(JSON.stringify(created).length<1000);
  } finally {api.listArtifacts=original.list;api.createArtifact=original.create;}
});

test('body pagination preserves emoji boundaries and can read the complete unchanged source',async()=>{
  const original=api.listArtifacts;
  const body='甲'.repeat(99)+'😀'+'乙'.repeat(180);
  try {
    api.listArtifacts=async()=>[{...rows[0],bodyMarkdown:body,bodyJson:null}];
    const list=tool('artifact_list');
    let offset=0, combined='';
    do {
      const page=parse(await list.execute('page',{artifactId:'a0',full:true,bodyOffset:offset,bodyLimit:100})).artifacts[0];
      assert.equal(page.bodyCoverage.markdown.offset,offset);
      combined+=page.bodyMarkdown;
      offset=page.bodyCoverage.markdown.nextOffset;
    } while(offset!==null);
    assert.equal(combined,body);
    const middle=parse(await list.execute('middle',{artifactId:'a0',full:true,bodyOffset:100,bodyLimit:100})).artifacts[0];
    assert.equal(middle.bodyCoverage.markdown.offset,99);
    assert.ok(middle.bodyMarkdown.startsWith('😀'));
  } finally {api.listArtifacts=original;}
});
