import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPersistedState } from '../src/features/studio/persistedState.ts';
const defaults={name:'',role:'主角',motive:'',goal:'',wish:'',obstacle:'',method:'',result:'',bonus:'',desire:'',fear:'',secret:''};
const storage=value=>({getItem:()=>JSON.stringify(value)});
test('legacy char-seven localStorage retains writing and fills new seven-step fields before rendering',()=>{
 const old={name:'林月',role:'女主',desire:'找到父亲',fear:'失去家人',secret:'旧身份'};
 const form=loadPersistedState('deep:project:char-seven',defaults,storage(old));
 assert.equal(form.name,'林月');
 assert.equal(form.desire,'找到父亲');
 assert.equal(['motive','goal','wish','obstacle','method','result','bonus'].filter(k=>form[k].trim()).length,0);
 assert.deepEqual(form,{...defaults,...old});
});
test('null, wrong primitive types and malformed JSON cannot replace a form schema',()=>{
 for(const value of [null,[],17,'bad']) assert.deepEqual(loadPersistedState('k',defaults,storage(value)),defaults);
 const form=loadPersistedState('k',defaults,storage({name:null,motive:8,goal:[],secret:'保留'}));
 assert.equal(form.name,'');assert.equal(form.motive,'');assert.equal(form.goal,'');assert.equal(form.secret,'保留');
 assert.deepEqual(loadPersistedState('k',defaults,{getItem:()=>'{'}),defaults);
});
test('nested defaults and array records are repaired while preserving optional and dynamic fields',()=>{
 const schema={nested:{enabled:false},rows:[{text:'',done:false}],dynamic:{},ids:[1]};
 const result=loadPersistedState('k',schema,storage({nested:null,rows:[{text:'旧稿',done:'yes',extra:1},null],dynamic:{unit1:true},ids:[3,'x']}));
 assert.deepEqual(result,{nested:{enabled:false},rows:[{text:'旧稿',done:false,extra:1}],dynamic:{unit1:true},ids:[3]});
 assert.deepEqual(loadPersistedState('k',schema,storage({rows:[],ids:[]})).rows,[]);
});
test('actual artifact hydrator char-seven legacy shape renders safely and retains its biography',()=>{
 const legacy={name:'主角小传',want:'',need:'',ghost:'',lie:'',flaw:'',strength:'',arc:'主角寻找父亲的完整小传。'};
 const form=loadPersistedState('deep:project:char-seven',defaults,storage(legacy));
 assert.equal(form.arc,legacy.arc);
 assert.equal(['motive','goal','wish','obstacle','method','result','bonus'].filter(k=>form[k].trim()).length,0);
});
