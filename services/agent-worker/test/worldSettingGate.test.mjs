import test from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../src/apiClient.js';
import {createWritingTools} from '../src/tools.js';
import {getAgent} from '@xiezuomanju/agent-runtime';
const output = result => JSON.parse(result.content[0].text);
function setup() {
 const tools=createWritingTools({projectId:'p',runId:'r',publish(){},allowlist:['gate_run','done_check'],doneContract:getAgent('topic.world_setting').doneContract});
 return {tools,gate:tools.find(t=>t.name==='gate_run'),done:tools.find(t=>t.name==='done_check')};
}
test('world gate schema exposes body and explicit rule aliases',()=>{
 const {gate}=setup(); const props=gate.parameters.properties.payload.properties;
 assert.ok(props.body.properties.goldFinger);assert.ok(props.rules);assert.ok(props.goldFinger);
 assert.match(gate.description,/GoldFingerMinimal/);
});
test('GoldFingerMinimal accepts real rule aliases and structured mechanisms without losing them',async()=>{
 const {gate}=setup();
 for(const payload of [{text:'每日只能看穿三秒未来，使用后失明一小时'}, {rules:'每日只能看穿三秒未来'}, {goldFinger:{mechanism:'看穿未来三秒',limit:'每天一次',cost:'失明一小时'}}, {body:{goldFinger:{机制:'看穿未来三秒',上限:'每天一次'}}}]) {
  const result=output(await gate.execute('gate',{name:'GoldFingerMinimal',payload}));
  assert.equal(result.passed,true,JSON.stringify(payload));
 }
 const empty=output(await gate.execute('empty',{name:'GoldFingerMinimal',payload:{goldFinger:{}}}));
 assert.equal(empty.checks[0].result,'warn');assert.match(empty.checks[0].message,/未评估/);
});
test('GoldFingerMinimal resolves persisted markdown section and reports missing rules honestly',async()=>{
 const original=api.listArtifacts;
 try {
  api.listArtifacts=async()=>[{id:'world',bodyMarkdown:'## 故事梗五要素\n'+ '世界背景'.repeat(200)+'\n## 金手指\n- 类型：先知\n- 机制：每天看穿三秒未来\n- 上限/代价：一天一次，失明一小时\n## 世界观规则\n'+ '世界规则'.repeat(200)},{id:'missing',bodyMarkdown:'## 世界观\n这是一个只有世界描述的设定'}];
  const {gate,done}=setup();
  assert.equal(output(await gate.execute('world',{name:'GoldFingerMinimal',payload:{artifactId:'world'}})).passed,true);
  const missing=output(await gate.execute('missing',{name:'GoldFingerMinimal',payload:{artifactId:'missing'}}));
  assert.equal(missing.checks[0].result,'warn');assert.match(missing.checks[0].message,/未评估/);
  assert.equal((await done.execute('done',{})).details.ok,false);
 } finally {api.listArtifacts=original;}
});
test('artifact reference validates saved rule, not a short caller override or empty rule object',async()=>{
 const original=api.listArtifacts;
 try {
  api.listArtifacts=async()=>[{id:'long',bodyJson:{goldFinger:'真实规则'.repeat(100)}},{id:'empty',bodyJson:{rules:{},ruleFieldCount:3}}];
  const {gate}=setup();
  assert.equal(output(await gate.execute('long',{name:'GoldFingerMinimal',payload:{artifactId:'long',body:{goldFinger:'一天一次'},rules:'一天一次'}})).checks[0].result,'warn');
  for(const artifactId of ['empty','nonexistent']) {
   const result=output(await gate.execute(artifactId,{name:'GoldFingerMinimal',payload:{artifactId,text:'每日一次'}}));
   assert.equal(result.checks[0].result,'warn');assert.match(result.checks[0].message,/未评估/);
  }
 } finally {api.listArtifacts=original;}
});

test("world Schema considers each saved representation before declaring the rule missing",async t=>{
 const saved={id:"world",type:"setting",createdByRunId:"r",bodyJson:{goldFinger:{type:"系统"}}};
 t.mock.method(api,"listArtifacts",async()=>[saved]);
 const tools=createWritingTools({projectId:"p",runId:"r",parentAgentId:"topic.world_setting",allowlist:["gate_run"],publish(){}});
 const gate=tools.find(tool=>tool.name==="gate_run");
 for(const [bodyMarkdown,expected] of [
   ["## 金手指\n日落后能重听前一声，只能使用一次。",true],
   ["## 金手指\n- 类型：系统。机制：日落后可以重听最后一声。上限：每日一次。",true],
   ["## 金手指\n- 类型：系统 日落后可以重听最后一声，每日一次",true],
   ["## 金手指\n- 类型：系统日落后能重听最后一声",true],
   ["## 金手指\n- 类型：系统",false],
   ["## 金手指\n- 类型：回声",false],
 ]){
   saved.bodyMarkdown=bodyMarkdown;
   assert.equal(output(await gate.execute("check",{name:"Schema",payload:{artifactId:"world"}})).passed,expected);
 }
});

test("a structured category field alone provides no saved ability rule",async t=>{
 const saved={id:"world",type:"setting",createdByRunId:"r",bodyJson:{}};
 t.mock.method(api,"listArtifacts",async()=>[saved]);
 const tools=createWritingTools({projectId:"p",runId:"r",parentAgentId:"topic.world_setting",allowlist:["gate_run"],publish(){}});
 const gate=tools.find(tool=>tool.name==="gate_run");
 for(const [goldFinger,expected] of [
   [{type:"系统流"},false],
   [{category:"echo after dusk"},false],
   [{类型:"系统流",类别:"复合能力"},false],
   [{type:"系统流",mechanism:"日落后能重听前一声"},true],
 ]) {
   saved.bodyJson.goldFinger=goldFinger;
   const result=output(await gate.execute("check",{name:"Schema",payload:{artifactId:saved.id}}));
   assert.equal(result.passed,expected,JSON.stringify(goldFinger));
 }
});
