import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveToolAccess, searchCatalog } from "../src/toolCatalog.js";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const runtime = "../../../packages/agent-runtime/";
for (const [query, name] of Object.entries({
  "Artifact.Create": "artifact_create",
  "检查台词是否机械地轮流问答": "ab_pingpong_detect",
  "帮我检查AB乒乓": "ab_pingpong_detect",
  "帮我检查LAPI清单": "lapi_checklist",
  "查今天的热点": "web_search",
  "翻项目记忆里我收藏的热点": "memory_search",
})) test(query, () => assert.equal(searchCatalog(query)[0]?.name, name));
test("disabled bash", () => {
  const old = process.env.AGENT_BASH_ENABLED;
  try {
    process.env.AGENT_BASH_ENABLED = "false";
    const { searchable, callable } = resolveToolAccess({ allowlist: ["bash"] });
    assert.equal(searchable.has("bash") || callable.has("bash"), false);
  } finally {
    if (old === undefined) delete process.env.AGENT_BASH_ENABLED;
    else process.env.AGENT_BASH_ENABLED = old;
  }
});
test("speaker ID parameter", () => assert.match(read("../src/tools.js").split('name: "ab_pingpong_detect"')[1].split("async execute")[0], /稳定.*说话人/));
test("prompt gate", () => assert.match(read(runtime+"skills/ai-collab/prompt-4part/SKILL.md"), /gates: \[PromptLock\]/));
test("critic update", () => assert.match(read(runtime+"src/registry.ts").split('id: "topic.hook_critic"')[1].split("modelProfile")[0], /artifact_update/));
test("graph endpoints", () => {
  const graph = JSON.parse(read(runtime+"skills/kb/graph-build/SKILL.md").split("```json")[1].split("```")[0]);
  for (const edge of graph.edges) for (const endpoint of [edge.source, edge.target]) assert.ok(graph.nodes.some(node => node.id === endpoint));
});
async function pure(name,args) {
  const {createWritingTools}=await import("../src/tools.js");
  const tool=createWritingTools({projectId:"fixture",runId:"test",allowlist:[name],publish:()=>{}})._allGated.find(t=>t.name===name);
  return JSON.parse((await tool.execute("test",args)).content[0].text);
}
test("scene triple merges explicit fields with scene metadata",async()=>{
  const fields={goal:"找到钥匙",conflict:"房门上锁",turn:"窗户开了"};
  for(const input of [fields,{body:fields},{...fields,body:{sceneNo:1}}])assert.equal((await pure("scene_triple_validate",input)).passed,true);
  assert.equal((await pure("scene_triple_validate",{goal:fields.goal})).passed,false);
});
test("literal voice overlap rejects object values and supports arrays",async()=>{
  const score=bySpeaker=>pure("voice_diversity_score",{bySpeaker});
  assert.match((await score({甲:{item:"找到钥匙"}})).error,/甲/);
  assert.equal((await score({甲:["找到钥匙"],乙:"找到钥匙"})).maxOverlap,1);
  assert.equal((await score({甲:"找到钥匙",乙:"风停雨歇"})).maxOverlap,0);
});
test("selected critic writes only exact rows once and fails stale or unearned gates",async()=>{
  const {freezeCritic}=await import("../src/criticReview.js");
  let arts=[{id:"a",projectId:"p",version:2,type:"core_hook",bodyJson:{items:[{candidate:{title:"甲",core_hook:"甲为救父寻找钥匙"},scores:{diff:4}},{title:"乙"}]}}];
  let writes=0;
  const api={listArtifacts:async()=>arts,updateArtifact:async(p,id,patch)=>{
    assert.equal(patch.expectedVersion,arts[0].version);writes++;
    return arts[0]={...arts[0],bodyJson:patch.bodyJson,version:3};
  }};
  const critic=await freezeCritic(api,"p","r",{gender_path:"male",artifactIds:["a#0"]});
  const score={ref:"a#0",rank:1,recommendation:"建议采用",reason:"开篇反转清楚",marketFit:5,innovation:4,motivation:4,opening:5,compliance:5};
  const params={artifactId:"a",expectedVersion:2,reviews:[score]};
  assert.equal((await critic.check()).result,"fail");
  await critic.write(params);await critic.write(params);
  assert.equal(writes,1);
  assert.deepEqual(arts[0].bodyJson.items[1],{title:"乙"});
  assert.deepEqual(arts[0].bodyJson.items[0].scores,{diff:4});
  assert.equal(arts[0].bodyJson.items[0].criticReview.total,23);
  assert.equal(await critic.complete(),false);
  assert.equal((await critic.check(true)).result,"pass");
  assert.equal(await critic.complete(),true);
  arts[0].version++;
  assert.equal(await critic.complete(),false);
  await assert.rejects(critic.write(params));
});
test("flat candidate and wrapped display retain independent review and old dimensions",async()=>{
  const {freezeCritic}=await import("../src/criticReview.js");
  const {registerHooks}=await import("node:module");
  const resolver=registerHooks({resolve(specifier,context,next){
    if(specifier==="./enums" && context.parentURL?.endsWith("/entities.ts"))return next("./enums.ts",context);
    return next(specifier,context);
  }});
  let flattenCoreHookCandidate;
  try {({flattenCoreHookCandidate}=await import("../../../packages/domain/src/entities.ts"));}
  finally {resolver.deregister();}
  const row={id:"a",projectId:"p",type:"core_hook",version:1,status:"adopted",title:"旧标题",bodyMarkdown:"原文",bodyJson:{candidate:{title:"开篇",scores:{empathy:2}}}};
  const api={listArtifacts:async()=>[row],updateArtifact:async(p,id,patch)=>Object.assign(row,{bodyJson:patch.bodyJson,version:2})};
  for(const input of [{},{candidates:["a","a"]},{artifactIds:["a#0"]},{artifactIds:["a"],artifactVersions:{a:2}}])await assert.rejects(freezeCritic(api,"p","r",{gender_path:"male",...input}));
  const critic=await freezeCritic(api,"p","r",{gender_path:"male",candidates:["a"]});
  const review={ref:"a",rank:1,marketFit:5,innovation:3,motivation:5,opening:4,compliance:5,recommendation:"建议采用",reason:"开篇冲突清晰"};
  row.bodyJson.criticReview={...review,runId:"r"};
  assert.equal((await critic.check(true)).result,"fail");
  delete row.bodyJson.criticReview;
  await assert.rejects(critic.write({artifactId:"a",expectedVersion:1,title:"改名",reviews:[review]}));
  await critic.write({artifactId:"a",expectedVersion:1,reviews:[review]});
  assert.equal(row.status,"adopted");assert.equal(row.bodyMarkdown,"原文");assert.equal(row.title,"旧标题");
  const flat=flattenCoreHookCandidate(row.bodyJson);
  assert.equal(flat.scores.empathy,2);assert.equal(flat.criticReview.marketFit,5);
  await assert.rejects(freezeCritic(api,"p","r",{gender_path:"male",artifactIds:["a"]}));
});
test("midpoint exposes all five types and actionable unknown result",async()=>{
  for(const midpoint of ["身份反转","目标升级","盟友背叛","真相半露","代价结算",1,5])assert.equal((await pure("midpoint_locator",{midpoint})).passed,true);
  const unknown=await pure("midpoint_locator",{midpoint:"false victory"});
  assert.equal(unknown.passed,false);assert.match(unknown.next,/具体情节/);
});
test("real tool gate and done_check demand selected current-run receipts",async()=>{
  const {api}=await import("../src/apiClient.js");
  const {createWritingTools}=await import("../src/tools.js");
  const {freezeCritic}=await import("../src/criticReview.js");
  const prior={listArtifacts:api.listArtifacts,updateArtifact:api.updateArtifact};
  const art={id:"a",projectId:"p",version:1,type:"core_hook",bodyJson:{items:[{core_hook:"甲为救父寻找钥匙"},{coreHook:"乙潜入档案室寻找证据"}]}};
  try {
    api.listArtifacts=async()=>[art];
    api.updateArtifact=async(p,id,{expectedVersion,bodyJson})=>{
      assert.equal(expectedVersion,art.version);art.version++;art.bodyJson=bodyJson;return art;
    };
    const critic=await freezeCritic(api,"p","r",{gender_path:"male",artifactIds:["a#0","a#1"]});
    const tools=createWritingTools({critic,projectId:"p",parentAgentId:"topic.hook_critic",runId:"r",publish(){},doneContract:[{type:"gate_pass",gates:["Schema"]}],allowlist:["gate_run","done_check","artifact_update"]});
    const call=async(name,args)=>JSON.parse((await tools._allGated.find(t=>t.name===name).execute("t",args)).content[0].text.split("## 原始 JSON\n").at(-1));
    const gate=()=>call("gate_run",{name:"Schema",payload:{passed:true}});
    assert.equal((await gate()).passed,false);
    const score={marketFit:4,innovation:4,motivation:4,opening:4,compliance:4,reason:"开篇目标清晰",recommendation:"建议采用"};
    await call("artifact_update",{artifactId:"a",expectedVersion:1,reviews:[{...score,ref:"a#0",rank:1},{...score,ref:"a#1",rank:2}]});
    assert.equal((await call("done_check",{})).ok,false);
    assert.equal((await gate()).passed,true);
    assert.equal((await call("done_check",{})).ok,true);
    art.version++;
    assert.equal((await call("done_check",{})).ok,false);
  } finally {Object.assign(api,prior);}
});
test("a ranked batch of tied core hooks can pass Schema without an elimination", async () => {
  const {freezeCritic} = await import("../src/criticReview.js");
  const narratives = [
    "质检员凭留样记录查出伪造的批号",
    "档案员循借阅痕迹追查缺失的卷宗",
    "验票员从作废票号查到被篡改的名单",
    "检修员对照巡检签名查出替班时段",
  ];
  const evidence = ["留样记录可形成第一条线索", "借阅痕迹可推动查证",
    "作废票号直接关联名单", "巡检签名可以定位替班时段"];
  const art = {id:"a",projectId:"p",version:1,type:"core_hook",status:"candidate",
    bodyMarkdown:"作者候选原文",bodyJson:{items:narratives.map(core_hook => ({core_hook}))}};
  const api = {
    listArtifacts: async () => [art],
    updateArtifact: async (_project, id, {expectedVersion, ...patch}) => {
      assert.equal(id, art.id);
      assert.equal(expectedVersion, art.version);
      return Object.assign(art, patch, {version:expectedVersion + 1});
    },
  };
  const refs = narratives.map((_, index) => `a#${index}`);
  const critic = await freezeCritic(api, "p", "r", {gender_path:"male",artifactIds:refs});
  const reviews = refs.map((ref, index) => ({
    ref, rank:index + 1, marketFit:4, innovation:4, motivation:4, opening:4, compliance:4,
    reason:evidence[index], recommendation:index === 0 ? "可改后再评" : "建议采用",
  }));
  const write = rows => critic.write({artifactId:"a",expectedVersion:1,reviews:rows});
  const withFirst = fields => [{...reviews[0], ...fields}, ...reviews.slice(1)];
  await assert.rejects(write(reviews.slice(1)), /全部所选行/);
  await assert.rejects(write(withFirst({ref:"b#0"})), /引用遗漏、重复或越界/);
  await assert.rejects(write(withFirst({rank:0})), /有效排名/);
  await assert.rejects(write(withFirst({marketFit:6})), /五维评分/);
  await assert.rejects(write(withFirst({recommendation:"未知建议"})), /有效排名/);
  await assert.rejects(write(withFirst({reason:"好"})), /具体理由/);
  assert.equal(art.version, 1);
  await write(reviews);
  assert.deepEqual(art.bodyJson.items.map(row => row.criticReview.total), [20,20,20,20]);
  assert.deepEqual(art.bodyJson.items.map(row => row.criticReview.recommendation),
    ["可改后再评","建议采用","建议采用","建议采用"]);
  assert.deepEqual(art.bodyJson.items.map(row => row.core_hook), narratives);
  assert.equal(art.status, "candidate");
  assert.equal(art.bodyMarkdown, "作者候选原文");
  const check = await critic.check(true);
  assert.equal(check.result, "pass", check.message);
  assert.equal(await critic.complete(), true);
});
test("critic requires actual selected narrative and a resolved gender path",async()=>{
  const {freezeCritic}=await import("../src/criticReview.js");
  const art={id:"a",projectId:"p",type:"core_hook",version:1,bodyJson:{items:[{candidate:{}}]},bodyMarkdown:"这是一份分组总稿"};
  let project={id:"p",format:"manju"};
  const api={listArtifacts:async()=>[art],getProject:async()=>project};
  const freeze=(ref,input)=>freezeCritic(api,"p","r",{artifactIds:[ref],...input});
  await assert.rejects(freeze("a#0",{gender_path:"male"}),/材料/);
  art.bodyMarkdown="";art.bodyJson={scores:{diff:5}};
  await assert.rejects(freeze("a",{gender_path:"female"}),/材料/);
  art.bodyJson={candidateIndex:1,title_hook:"假面",bodyMarkdown:"女主为寻找失踪的母亲潜入敌营"};
  await assert.rejects(freeze("a",{}),/频别/);
  assert.equal((await freeze("a",{gender_path:"female"})).genderPath,"female");
  project={id:"p",format:"male_long"};
  assert.equal((await freeze("a",{})).genderPath,"male");
});
test("critic panel reviews all up to 100 and a bounded explicit selection above 100",async()=>{
  const {hookReviewSelection}=await import("../../../apps/ai-writing/src/features/studio/hookReviewSelection.ts");
  const rows=Array.from({length:101},(_,i)=>({id:"hook-"+i}));
  const selected=new Set(["hook-2","hook-100","stale"]);
  assert.equal(hookReviewSelection(rows.slice(0,100),selected).reviewRows.length,100);
  assert.deepEqual(hookReviewSelection(rows,selected).reviewRows,[rows[2],rows[100]]);
  assert.equal(hookReviewSelection(rows,new Set()).reviewRangeValid,false);
  assert.equal(hookReviewSelection(rows,new Set(rows.map(x=>x.id))).reviewRangeValid,false);
});
