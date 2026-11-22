import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../src/apiClient.js';
import {ensureBiblePack} from '../src/batchLifecycle.js';
import {bibleGraphSlice} from '../src/storyGraphLifecycle.js';

for (const layout of ['bible/', '']) {
 test(`body lifecycle injects actual ${layout || 'legacy root'} bible files`,async()=>{
  const original={get:api.getMemoryFile,put:api.putMemoryFile,list:api.listArtifacts};
  const prefix='/memories/projects/test-project/';
  const files=new Map([
   [prefix+layout+'characters.md',{content:'贺大力：话少记数，不能远程感应'}],
   [prefix+layout+'world.md',{content:'每天仅第一次上秤准确，旧肩伤是代价'}],
   [prefix+layout+'decisions.md',{content:'仅测试EP01，人物与能力已复核'}],
  ]);
  let saved;
  try {
   api.getMemoryFile=async(path)=>{if(files.has(path))return files.get(path);throw new Error('404');};
   api.putMemoryFile=async(body)=>{saved=body;return body;};
   api.listArtifacts=async()=>[];
   await ensureBiblePack({projectId:'test-project',epOrCh:1});
   assert.match(saved.content,/贺大力/);
   assert.match(saved.content,/每天仅第一次上秤准确/);
   assert.match(saved.content,/仅测试EP01/);
   const graph=await bibleGraphSlice('test-project',1);
   assert.match(graph.worldText,/每天仅第一次上秤准确/);
  }finally{api.getMemoryFile=original.get;api.putMemoryFile=original.put;api.listArtifacts=original.list;}
 });
}
