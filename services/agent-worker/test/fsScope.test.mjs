import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/apiClient.js';
import { createWritingTools } from '../src/tools.js';

test('worker fs tools deny foreign and unbound paths before requesting API, scope allowed traversal', async () => {
 const names = ['fsLs','fsRead','fsGrep','fsFind'];
 const original = Object.fromEntries(names.map(n => [n,api[n]]));
 const calls = [];
 try {
  for (const name of names) api[name] = async (...args) => { calls.push([name,...args]); return {}; };
  const tools = createWritingTools({projectId:'p',parentAgentId:'me',publish:()=>{},allowlist:['fs_ls','fs_read','fs_grep','fs_find'],securityMode:'yolo'});
  for(const name of ['fs_ls','fs_read','fs_grep','fs_find']) {
   const tool = tools.find(t=>t.name===name);
   for(const path of ['/memories/projects/p2/bible/a.md','/memories/projects/p/procedural/other/a.md','/projects/p2','/runs','/threads','/inbox','/workspace','/memories/user/private.md']) {
    const before = calls.length;
    try { await tool.execute('deny',{path,pattern:'needle'}); } catch {}
    assert.equal(calls.length,before,name+path);
   }
   await tool.execute('allow', {path:name==='fs_read'?'/memories/projects/p/bible/a.md':undefined,pattern:'needle'});
  }
  assert.equal(calls.length,4);
  for(const [name,path,opts] of calls) {
   const scope = typeof path==='object'?path:opts;
   assert.equal(scope.project_id,'p',name);
   assert.equal(scope.agent_id,'me',name);
   if(name==='fsGrep'||name==='fsFind') assert.equal(scope.path,'/projects/p');
  }
 } finally {Object.assign(api,original);}
});
