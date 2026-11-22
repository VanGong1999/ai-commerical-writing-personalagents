import test from "node:test";
import assert from "node:assert/strict";
import {getAgent, runGateBattery} from "@xiezuomanju/agent-runtime";
import {createWritingTools} from "../src/tools.js";
import {api} from "../src/apiClient.js";

function role(id,ctx={}) {
  const tools = createWritingTools({projectId:"p",runId:"current",parentAgentId:id,
    doneContract:getAgent(id).doneContract,publish(){},...ctx,allowlist:["gate_run","done_check","similarity_heuristic","artifact_create","memory_write","bible_write"]});
  const call = async (name,args) => JSON.parse((await tools.find(t=>t.name===name).execute("call",args)).content[0].text);
  return {call,gate:(name,payload={})=>call("gate_run",{name,payload}),done:async()=>(await tools.find(t=>t.name==="done_check").execute("check",{})).details.ok};
}
const manuscript = {type:"manuscript",bodyMarkdown:"甲和乙分别回答：“九点到站。”"};
const shell = {story_shell:"谜题",shell_reason:"遗嘱逐集揭密",pay_model:"重付费",midpoint_type:"红利代价"};
const fixtures = [
  ["prose.dialogue_voice",manuscript,"VoiceDiversity",{score:.60}],
  ["imitate.wash",{type:"qc_report",bodyMarkdown:"可学信息差。仅收到对标短摘，重合未评估。"},"SimilarityRisk",{}],
  ["scene.comedy",{type:"other",bodyJson:{comedy_inserts:[{beat:"两名服务生接连端错菜",element:"道具错位"}]}},"ComedyDose",{body:{dose:"整部",yy_intensity:"不强",comedy_cast_count:2}}],
  ["world.setting_cap",{type:"other",bodyJson:{settings_found:[{name:"循环",is_main:true},{name:"失物账簿",is_main:true},{name:"票色",is_main:false}]}},"SettingCap",{body:{settingCount:3}}],
  ["struct.bridge8",{type:"other",bodyJson:{trope_plan:{primary:"",secondary:[],visual_beat:"姐妹默默整理葬礼后的信",no_fit_reason:"这场只记录日常动作"}}},"EightTropeCoverage",{tropes:[]}],
  ["topic.story_shell",{type:"topic_card",bodyJson:shell},"ShellGate",{artifactId:"saved"}],
];
for(const [id,artifact,optional,payload] of fixtures) test(id+" delivers the current saved output with or without optional review",async t=>{
  const rows=[];
  t.mock.method(api,"listArtifacts",async()=>rows);
  const r=role(id);
  await r.gate("Schema",{artifactId:"saved"});
  assert.equal(await r.done(),false,"absent output");
  rows.push({...artifact,id:"saved",createdByRunId:"foreign"});
  await r.gate("Schema",{artifactId:"saved"});
  assert.equal(await r.done(),false,"foreign output");
  rows[0].createdByRunId="current";
  assert.equal((await r.gate("Schema",{artifactId:"saved"})).checks[0].result,"pass");
  assert.equal(await r.done(),true,"skipped optional review");
  assert.equal((await r.gate(optional,payload)).checks[0].result,"warn");
  assert.equal(await r.done(),true,"visible warning");
});
test("mixed schema checks retain structural failures",async t=>{
  const row={id:"saved",createdByRunId:"current"};
  t.mock.method(api,"listArtifacts",async()=>[row]);
  for(const [id,type,body] of [
    ["topic.story_shell","topic_card",{...shell,shell_reason:""}],
    ["topic.story_shell","topic_card",{...shell,midpoint_type:"非枚举"}],
    ["scene.comedy","other",{comedy_inserts:[{beat:"只写落点"}]}],
    ["struct.bridge8","other",{trope_plan:{primary:"",secondary:[]}}],
    ["world.setting_cap","other",{}],
    ["topic.world_setting","setting",{goldFinger:{type:"系统"}}],
  ]){
    Object.assign(row,{type,bodyJson:body});
    assert.equal((await role(id).gate("Schema",{artifactId:"saved"})).passed,false,id);
  }
});
test("quoted pacing, reported suspicion and movement preserve objective integrity",()=>{
  const evaluate=(name,payload)=>runGateBattery(name,payload)[0];
  for(const [gate,payload] of [["OutlineNoEvenActs",{text:"利润平均分配？"}],["OOC",{flagged:true,bible:"她独居，孩子有危险时一定出门。",text:"她奔出屋去救孩子。"}],["OOC",{bible:"她独居。"}]]) assert.equal(evaluate(gate,payload).result,"warn");
  const graph={nodes:[{id:"a"}],edges:[],characterStates:["家","车站"].map(location=>({characterId:"甲",episode:3,location}))};
  assert.equal(evaluate("GraphConsistency",{graph}).result,"warn");
  graph.edges.push({from:"a",to:"absent"});
  assert.equal(evaluate("GraphConsistency",{graph}).result,"fail");
  assert.equal(evaluate("LogicAck",{acked:false}).result,"fail");
});

test("a quoted station notice yields full source coverage and a boundary report",async t=>{
  const r=role("imitate.wash");
  const notice="列车即将进站，请站在黄色安全线内";
  t.mock.method(api,"listArtifacts",async()=>[{id:"r",createdByRunId:"current",type:"qc_report",bodyMarkdown:"重合来自广播原句，核查引述归属。"}]);
  const result=await r.call("similarity_heuristic",{source:notice,draft:"她看表，广播响起：“"+notice+"。”"});
  assert.equal(result.score,1);
  assert.equal(result.checks[0].result,"warn");
  assert.equal((await r.call("similarity_heuristic",{source:notice,draft:""})).score,null);
  await r.gate("Schema",{artifactId:"r"});
  assert.equal(await r.done(),true);
});

test("explicit exercise fields are checked against saved annotations",async t=>{
  const row={id:"saved",type:"other",createdByRunId:"current"};
  t.mock.method(api,"listArtifacts",async()=>[row]);
  const check=async (id,ctx)=>(await role(id,ctx).gate("Schema",{artifactId:"saved",body:{require_trope_tag:false,max_main_settings:100}})).passed;
  const plan={primary:"",secondary:[],visual_beat:"两姐妹分拣信件",no_fit_reason:"日常纪实"};
  row.bodyJson={trope_plan:plan};
  assert.equal(await check("struct.bridge8",{requireTropeTag:true}),false);
  assert.equal(await check("struct.bridge8",{requireTropeTag:"false"}),true);
  plan.primary="因果"; plan.visual_beat="旧信找到了欠款凭证，债主终于收回欠债";
  assert.equal(await check("struct.bridge8",{requireTropeTag:true}),true);
  row.bodyJson=fixtures[3][1].bodyJson;
  assert.equal(await check("world.setting_cap",{maxMainSettings:2}),true);
  assert.equal(await check("world.setting_cap",{maxMainSettings:1}),false);
  assert.equal(await check("world.setting_cap",{maxMainSettings:NaN}),false);
  assert.equal(await check("world.setting_cap",{maxMainSettings:"false"}),false);
});

test("ten saved outlines can retain quoted pricing language",async t=>{
  const rows=Array.from({length:9},(_,i)=>({id:String(i),type:"episode_outline",createdByRunId:"current",
    bodyJson:{episodeNo:i+1,summary:"追问账本去向",beats:["利润平均分配？"],coolPoint:"反转",cliffType:"情感钩"}}));
  t.mock.method(api,"listArtifacts",async()=>rows);
  const r=role("struct.episode_outline");
  assert.equal(await r.done(),false);
  rows.push({...rows[0],id:"10",bodyJson:{...rows[0].bodyJson,episodeNo:10}});
  assert.equal(await r.done(),true);
});

test("chapter retains a flagged rescue scene and still owes a manuscript",async t=>{
  const rows=[];
  t.mock.method(api,"listArtifacts",async()=>rows);
  const r=role("prose.novel_body");
  const text="她听见孩子呼救，推开门跑出去。".repeat(60);
  await r.gate("LengthBand",{text,minChars:800,maxChars:1200});
  await r.gate("ChunkPolicy",{count:1});
  await r.gate("OOC",{flagged:true,bible:"她独居，孩子遇险时一定出门",text});
  assert.equal(await r.done(),false);
  rows.push({...manuscript,bodyMarkdown:text,createdByRunId:"current"});
  assert.equal(await r.done(),true);
});

test("prewrite pack without a draft requires an actual scoped write and a graph check",async t=>{
  t.mock.method(api,"listArtifacts",async()=>[]);
  t.mock.method(api,"putMemoryFileCas",async()=>({hash:"saved"}));
  const r=role("qc.bible_guard");
  const graph={nodes:[{id:"lead"}],edges:[]};
  await r.gate("GraphConsistency",{graph,requireNonEmpty:true});
  assert.equal(await r.done(),false);
  const content=["locked_cast: 林舟","gold_finger_limits: 无能力","last_summary: EP01开篇","recent_journals: []",
    "story_graph_slice: lead","recent_character_states: []","open_foreshadows: []","forbidden_drifts: []"].join("\n");
  assert.equal((await r.call("memory_write",{path:"/memories/projects/p/bible_pack.md",expectedHash:"old",content})).ok,true);
  await r.gate("GraphConsistency",{graph,requireNonEmpty:true});
  assert.equal(await r.done(),true);
});

test("saved world accepts long worked examples after the bible write",async t=>{
  const rows=[];
  t.mock.method(api,"listArtifacts",async()=>rows);
  t.mock.method(api,"createArtifact",async(pid,params)=>{
    const saved={...params,id:"world",type:"setting",createdByRunId:"current"};
    rows.push(saved);return saved;
  });
  t.mock.method(api,"putMemoryFileCas",async()=>({hash:"saved"}));
  const r=role("topic.world_setting");
  await r.gate("Schema",{artifactId:"world"});
  assert.equal(await r.done(),false);
  const rule="黄昏可重放最近声音一次。"+"边界例：在车站只能重放最后一次广播。".repeat(25);
  const created=await r.call("artifact_create",{type:"setting",title:"回声规则",bodyJson:{goldFinger:rule},bodyMarkdown:"车站世界的回声机制"});
  assert.equal(created.id,"world");
  assert.equal((await r.gate("Schema",{artifactId:"world"})).passed,true);
  assert.equal(await r.done(),false);
  await r.call("bible_write",{path:"bible/world.md",content:rule,expectedHash:"old"});
  assert.equal(await r.done(),true);
  assert.equal((await r.gate("GoldFingerMinimal",{artifactId:"world"})).checks[0].result,"warn");
});

for (const [agentId, candidate] of fixtures.filter(([id])=>["scene.comedy","world.setting_cap","struct.bridge8"].includes(id))) {
  test(agentId+" checks the saved report type",async t=>{
    const row={...candidate,id:"saved",createdByRunId:"current",type:"manuscript"};
    t.mock.method(api,"listArtifacts",async()=>[row]);
    const r=role(agentId);
    assert.equal((await r.gate("Schema",{artifactId:row.id})).passed,false);
    assert.equal(await r.done(),false);
  });
}

test("saved secondary tags must form an array of eight-trope categories",async t=>{
  const plan={primary:"因果",visual_beat:"欠债人还款"};
  const row={type:"other",id:"s",createdByRunId:"current",bodyJson:{trope_plan:plan}};
  t.mock.method(api,"listArtifacts",async()=>[row]);
  const r=role("struct.bridge8");
  for(const [secondary,expected] of [["invalid",false],[["unknown"],false],[[],true],[["地位"],true]]){
    plan.secondary=secondary;
    assert.equal((await r.gate("Schema",{artifactId:"s"})).passed,expected);
  }
});
