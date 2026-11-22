import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../src/apiClient.js';
import {createWritingTools} from '../src/tools.js';

test('same task candidate identity is reused and changed content requires revision rather than a duplicate',async()=>{
 const original={list:api.listArtifacts,create:api.createArtifact};let writes=0;
 try {
  const existing={id:'a',type:'character',title:'林舟',bodyMarkdown:'小传',bodyJson:null,createdByRunId:'run',version:1};
  api.listArtifacts=async()=>[existing];
  api.createArtifact=async()=>{writes++;return {id:'duplicate'};};
  const tool=createWritingTools({projectId:'p',runId:'run',publish(){},allowlist:['artifact_create']}).find(t=>t.name==='artifact_create');
  const same=JSON.parse((await tool.execute('again',{type:'character',title:'林舟',bodyMarkdown:'小传'})).content[0].text);
  assert.equal(same.id,'a');assert.equal(writes,0);
  const changed=JSON.parse((await tool.execute('changed',{type:'character',title:'林舟',bodyMarkdown:'修订小传'})).content[0].text);
  assert.equal(changed.error,'artifact_revision_required');assert.equal(changed.artifactId,'a');assert.equal(writes,0);
 } finally {api.listArtifacts=original.list;api.createArtifact=original.create;}
});

test('ontology create returns exact materialized artifact even when title is reused',async()=>{
 const original={submit:api.ontologySubmit,list:api.listArtifacts};
 try {
  api.ontologySubmit=async()=>({ok:true,applied:[{rid:'new-object',artifactId:'new',artifactVersion:1}]});
  api.listArtifacts=async()=>[{id:'old',title:'同名候选',createdByRunId:'previous'},{id:'new',version:1,title:'同名候选',createdByRunId:'current'}];
  const result=await api.createArtifact('p',{type:'core_hook',title:'同名候选',bodyMarkdown:'新正文',createdByRunId:'current'});
  assert.equal(result.id,'new');
 }finally{api.ontologySubmit=original.submit;api.listArtifacts=original.list;}
});

test('ontology write receipt keeps v1 when the list after submit already sees author v2',async t=>{
 t.mock.method(api,'ontologySubmit',async()=>({ok:true,applied:[{artifactId:'a',artifactVersion:1}]}));
 t.mock.method(api,'listArtifacts',async()=>[{id:'a',projectId:'p',type:'core_hook',version:2,title:'作者',bodyMarkdown:'后来修改',createdByRunId:'r'}]);
 t.mock.method(api,'listArtifactVersions',async()=>[{artifactId:'a',actor:'agent:r',version:1,title:'原稿',bodyMarkdown:'岗位交付',status:'candidate'}]);
 {
  const row=await api.createArtifact('p',{type:'core_hook',title:'原稿',bodyMarkdown:'岗位交付',createdByRunId:'r'});
  assert.equal(row.version,1);
  assert.equal(row.bodyMarkdown,'岗位交付');
 }
});
