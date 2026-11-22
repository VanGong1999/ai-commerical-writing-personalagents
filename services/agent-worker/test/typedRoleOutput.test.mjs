import test from "node:test";
import assert from "node:assert/strict";
import { roleOutputError } from "../src/typedRoleOutput.js";

test("canonical expectation workflow rejects wrappers and string flags", () => {
  const check = body => roleOutputError("struct.expectation", "expectation_conflict", body);
  assert.ok(check({expectations:{item:[]}, chainIntact:"true"}));
  const body = {design:{core:{content:"找回失踪的姐姐"}}, conflicts:[{oneLiner:"档案被扣", chainUnbroken:false}]};
  assert.equal(check(body), null);
  assert.match(check({...body,conflicts:[{...body.conflicts[0],chainIntact:"false"}]}),/conflicts.0.chainIntact/);
  body.conflicts[0].chainUnbroken = "false";
  assert.match(check(body), /conflicts.0.chainUnbroken/);
});
test("cool stack requires native arrays and boolean fields", () => {
  const check = body => roleOutputError("topic.cool_point_5","other", body);
  const item = {id:"征服", primary:false, yy_payoff:"拿到档案", tropes_hint:["碾压"]};
  const body = {cool_stack:[item], focus_ok:false, gender_path:"male_self_act"};
  assert.equal(check(body),null);
  assert.match(check({...body,cool_stack:{item:[item]}}),/cool_stack/);
  assert.match(check({...body,focus_ok:"true"}),/focus_ok/);
  assert.match(check({...body,cool_stack:[{...item,primary:"false"}]}),/primary/);
});

test("worker rejects malformed writes and Schema checks the persisted artifact", async () => {
  const {createWritingTools} = await import("../src/tools.js");
  const {api} = await import("../src/apiClient.js");
  const old = {listArtifacts:api.listArtifacts,createArtifact:api.createArtifact};
  const rows = [];
  api.listArtifacts = async () => rows;
  api.createArtifact = async (_project,row) => {
    const saved = {...row,id:"artifact",version:1};
    rows.push(saved);
    return saved;
  };
  try {
    const tools = createWritingTools({projectId:"p",runId:"r",parentAgentId:"topic.cool_point_5",publish(){},allowlist:["artifact_create","gate_run"]});
    const write = tools.find(t=>t.name==="artifact_create");
    const gate = tools.find(t=>t.name==="gate_run");
    const bodyJson = {cool_stack:[{id:"秩序",primary:false,yy_payoff:"找回档案",tropes_hint:["打脸"]}],gender_path:"male_self_act",focus_ok:false};
    const request = {type:"other",title:"五大爽点",bodyMarkdown:"观众看见遗失的档案回到桌上。",bodyJson};
    let failed;
    try { failed = await write.execute("invalid",{...request,bodyJson:{...bodyJson,focus_ok:"false"}}); }
    catch (err) { failed = err.message; }
    assert.match(JSON.stringify(failed), /focus_ok/);
    assert.equal(JSON.parse(failed.content[0].text).error,"invalid_business_output");
    assert.equal(rows.length,0);
    await write.execute("valid",request);
    assert.equal(rows[0].bodyJson.focus_ok,false);
    await gate.execute("check",{name:"Schema",payload:{artifactId:"artifact"}});
    assert.equal(tools._gateEvidence.Schema.result,"pass");
    rows[0].bodyJson = {...bodyJson,focus_ok:"false"};
    await gate.execute("check-again",{name:"Schema",payload:{artifactId:"artifact"}});
    assert.equal(tools._gateEvidence.Schema.result,"fail");
  } finally { Object.assign(api,old); }
});

test("all captured conflict extension fields are reported together", async () => {
  const {readFile} = await import("node:fs/promises");
  const body = JSON.parse(await readFile(new URL("./fixtures/typed-role-rejection.json", import.meta.url)) );
  const error = roleOutputError("struct.expectation","expectation_conflict",body);
  for (const path of ["conflicts.0.competition","conflicts.0.pairing","conflicts.0.six.chainUnbroken"]) assert.ok(error.includes(path), error);
});

test("active role field guides address each nested enum and produce accepted data", async () => {
  const { roleOutputGuide } = await import("../src/typedRoleOutput.js");
  for (const [id,type] of [["struct.expectation","expectation_conflict"],["topic.cool_point_5","other"]]) {
    const guide = roleOutputGuide(id);
    const shape = JSON.parse(guide.slice(guide.indexOf("{")));
    if (id === "struct.expectation") {
      assert.equal(shape.design.core.status,"open|paid");
      assert.equal(shape.design.core.decayRisk,"none|forget|delay|fatigue");
      assert.equal(shape.conflicts[0].six.items[0].id.split("|").length,6);
      assert.equal(shape.conflicts[0].chainUnbroken,"boolean");
      assert.equal(roleOutputError(id,type,{design:{core:{content:"档案在哪里",status:shape.design.core.status.split("|")[0]}},conflicts:[{oneLiner:"厂长扣住档案",six:{items:shape.conflicts[0].six.items[0].id.split("|").map(id=>({id}))}}]}),null);
    } else {
      assert.equal(roleOutputError(id,type,{cool_stack:[{id:shape.cool_stack[0].id.split("|")[0],primary:true,yy_payoff:"当众洗清冤屈",tropes_hint:[]}],focus_ok:true,gender_path:shape.gender_path.split("|")[0]}),null);
    }
  }
  assert.equal(roleOutputGuide("orch.batch_writer"),"");
});

test("three local rejections close their ledgers before a non-retryable stop", async t => {
  const { api } = await import("../src/apiClient.js");
  const { openaiToolLoop } = await import("../src/runSession.js");
  const { createWritingTools } = await import("../src/tools.js");
  const { jobRetryDecision } = await import("../src/requestRetry.js");
  const {listAgents,loadSkill} = await import("@xiezuomanju/agent-runtime");
  const agent = listAgents().find(a=>a.id==="topic.cool_point_5");
  const steps=[];
  let calls=0, writes=0;
  for (const key of Object.keys(api)) if (typeof api[key]==="function") t.mock.method(api,key,async()=>[]);
  api.appendRunStep=async (_,step)=>steps.push(step);
  api.createArtifact=async()=>{writes++;};
  api.agentChat=async({messages})=>{
    for (const [i,msg] of messages.entries()) {
      if (!msg.tool_calls?.length) continue;
      assert.deepEqual(messages.slice(i+1,i+1+msg.tool_calls.length).map(m=>[m.role,m.tool_call_id]),
        msg.tool_calls.map(c=>["tool",c.id]));
    }
    const ids=calls===0?["c1","c2"]:["c3"];
    calls++;
    return {usage:{prompt_tokens:5*ids.length},choices:[{finish_reason:"tool_calls",message:{tool_calls:ids.map(id=>({
      id,type:"function",function:{name:"artifact_create",arguments:JSON.stringify({type:"other",title:"栈",bodyMarkdown:"候选",bodyJson:{focus_ok:"false"}})}
    }))}}]};
  };
  const ctx={agent,skill:loadSkill(agent.skillPath),projectId:"p",runId:"r",parentAgentId:agent.id,prompt:"输出爽点",publish(){},allowlist:["artifact_create"],nested:true,harness:{maxTurns:5,maxRepairRounds:2},completionScope:{runId:"r"}};
  const tools=createWritingTools(ctx);
  await assert.rejects(openaiToolLoop({...ctx,tools}),err=>/invalid_business_output/.test(err.message)&&!jobRetryDecision(err,0,3).retry);
  assert.equal(calls,2);
  assert.equal(writes,0);
  for(const id of ["c1","c2","c3"]){
    const events=steps.filter(e=>e.payload.id===id||e.payload.ledger?.ref===id);
    assert.deepEqual(events.map(e=>e.payload.ledger?.status??e.kind),["tool_call","pending","tool_result","failed"]);
    assert.equal(JSON.parse(events[2].payload.result).sideEffect,false);
  }
  const prior=steps.filter(e=>e.kind==="usage").map(e=>({type:e.kind,payload:e.payload}));
  const old=process.env.AGENT_MAX_PROMPT_TOKENS;
  process.env.AGENT_MAX_PROMPT_TOKENS="15";
  try {
    await assert.rejects(openaiToolLoop({...ctx,tools,priorEvents:prior}),err=>/15 >= 15/.test(err.message)&&err.retryable===false);
    assert.equal(calls,2);
    api.chat=async()=>({content:"Earlier work and open verification items summarized for continuation.",promptTokens:5,completionTokens:1});
    await assert.rejects(openaiToolLoop({...ctx,tools,priorEvents:prior.slice(0,1),
      harness:{...ctx.harness,compaction:{triggerTokens:1,keepTailTokens:1,handoffAfterCompactions:1}},
      startMessages:Array.from({length:16},()=>({role:"assistant",content:"x".repeat(1500)}))}),err=>/15 >= 15/.test(err.message)&&err.retryable===false);
    assert.ok(steps.some(e=>e.kind==="handoff"));
    assert.equal(calls,2);
    api.agentChat=async()=>{calls++;return {usage:{prompt_tokens:5},choices:[{finish_reason:"length",message:{content:"partial"}}]};};
    await assert.rejects(openaiToolLoop({...ctx,tools,priorEvents:prior.slice(0,1)}),err=>/15 >= 15/.test(err.message)&&err.retryable===false);
    assert.equal(calls,3);
  } finally { if(old===undefined) delete process.env.AGENT_MAX_PROMPT_TOKENS; else process.env.AGENT_MAX_PROMPT_TOKENS=old; }
});
