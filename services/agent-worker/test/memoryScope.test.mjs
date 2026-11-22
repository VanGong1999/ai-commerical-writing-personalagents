import test from 'node:test';import assert from 'node:assert/strict';
import {api} from '../src/apiClient.js';import {createWritingTools} from '../src/tools.js';
test('search, grep and list exclude other projects, agents and pathless results',async()=>{
 const oldSearch=api.searchMemory,oldTree=api.memoryTree;
 const rows=[{path:'/memories/projects/p/bible/world.md',content:'needle shared'},{path:'/memories/projects/p/procedural/me/lessons.md',content:'needle own'},{path:'/memories/projects/p/procedural/other/lessons.md',content:'needle other'},{path:'/memories/projects/p2/bible/world.md',content:'needle foreign'},{content:'needle pathless'},{path:'/memories/user/private.md',content:'needle global'}];
 try{
 api.searchMemory=async(q,opts)=>{assert.equal(opts.projectId,'p');return rows};api.memoryTree=async(opts)=>{assert.equal(opts.projectId,'p');return rows};
 const tools=createWritingTools({projectId:'p',parentAgentId:'me',publish:()=>{},allowlist:['memory_search','memory_grep','memory_list']});
 for(const name of ['memory_search','memory_grep','memory_list']){const out=await tools.find(t=>t.name===name).execute('call',{query:'needle'});const text=JSON.stringify(out);assert.match(text,/world.md/);assert.match(text,/own/);for(const bad of ['foreign','pathless','global','other/lessons'])assert.ok(!text.includes(bad),name+bad);}
 }finally{api.searchMemory=oldSearch;api.memoryTree=oldTree}
});

test('an agent cannot write a different project memory namespace',async()=>{
 const old=api.putMemoryFileCas;let calls=0;
 try{api.putMemoryFileCas=async()=>{calls++;return{hash:'h'}};
 const tools=createWritingTools({projectId:'p',parentAgentId:'me',publish:()=>{},allowlist:['memory_write'],securityMode:'yolo'});
 const out=await tools.find(t=>t.name==='memory_write').execute('write',{path:'/memories/projects/other/bible/world.md',content:'wrong',expectedHash:null});
 assert.equal(calls,0);assert.match(JSON.stringify(out),/scope|项目/);
 }finally{api.putMemoryFileCas=old}
});
