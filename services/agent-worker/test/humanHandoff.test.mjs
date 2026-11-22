import { test } from "node:test";
import assert from "node:assert/strict";
import { canHandOffToHuman } from "../src/humanHandoff.js";
import { assertRegistered } from "@xiezuomanju/agent-runtime";

test("pending proposals require persisted valid proposals and only human failures", () => {
  const agent = assertRegistered("colleague.proactive");
  const row = { type:"qc_report", bodyJson:{items:[{message:"补本集梗概",agentId:"struct.cool12",needsApproval:true,priority:"P1"}]} };
  const evidence = {HumanConfirm:{id:"HumanConfirm",result:"fail"}};
  Object.assign(row,{id:"art",createdByRunId:"r",projectId:"p"});
  row.bodyJson.proposalIds = ["prop"];
  const proposals = [{id:"prop",projectId:"p",type:"colleague.proactive",priority:2,status:"pending",message:"补本集梗概",actions:[{type:"agent.run",agentId:"struct.cool12",needsApproval:true,sourceReportId:"art",sourceRunId:"r"}]}];
  assert.equal(canHandOffToHuman(agent,[row],evidence),false);
  assert.equal(canHandOffToHuman(agent,[row],evidence,proposals),true);
  assert.equal(canHandOffToHuman(agent,[],evidence),false);
  assert.equal(canHandOffToHuman(agent,[row],{}),false);
  assert.equal(canHandOffToHuman(agent,[row],{...evidence,Schema:{id:"Schema",result:"inconclusive"}}),false);
});

test("short-drama handoff needs both schema proof and checklist content", () => {
  const agent = assertRegistered("qc.human_qc_duanju");
  const row = {type:"qc_report",bodyJson:{items:[{id:"H1",question:"第十集冲突成立吗？",why_human:"需判断观众预期",related_artifact:"ep10",blocking:true}]}};
  assert.equal(canHandOffToHuman(agent,[row],{}),false);
  assert.equal(canHandOffToHuman(agent,[row],{Schema:{id:"Schema",result:"pass"}}),true);
  delete row.bodyJson.items[0].related_artifact;
  assert.equal(canHandOffToHuman(agent,[row],{Schema:{id:"Schema",result:"pass"}}),false);
});

test("model ack cannot satisfy HumanConfirm", async () => {
  const {createWritingTools} = await import("../src/tools.js");
  const tools = createWritingTools({projectId:"p", runId:"r",publish(){},allowlist:["gate_run"]});
  await tools.find(t=>t.name==="gate_run").execute("call",{name:"HumanConfirm",payload:{acked:true}});
  assert.equal(tools._gateEvidence.HumanConfirm.result,"fail");
});

test("six-check handoff requires all located checks and actual LogicAck evidence", () => {
  const agent = assertRegistered("qc.human_checklist");
  const items = ["逻辑","AI表述","镜头","人设语言","钩子伏笔","画面时长"].map(category => ({category,text:"核对角色行动",location:"EP01/S02"}));
  const reports = [{type:"qc_report",bodyJson:{items}}];
  const gates = {LogicAck:{id:"LogicAck",result:"fail"}};
  assert.equal(canHandOffToHuman(agent,reports,{}),false);
  assert.equal(canHandOffToHuman(agent,reports,gates),true);
  items.pop();
  assert.equal(canHandOffToHuman(agent,reports,gates),false);
});

test("bible guard records only complete project pack CAS success",async () => {
  const {createWritingTools} = await import("../src/tools.js");
  const {api} = await import("../src/apiClient.js");
  const prior = api.putMemoryFileCas;
  let writes = 0;
  api.putMemoryFileCas = async () => { writes++; return {hash:"new"}; };
  try {
    const tools = createWritingTools({projectId:"p",runId:"r",parentAgentId:"qc.bible_guard",publish(){},allowlist:["memory_write"]});
    const writer = tools.find(t=>t.name==="memory_write");
    const args = {path:"/memories/projects/p/bible_pack.md",expectedHash:"old",content:"incomplete"};
    assert.equal((await writer.execute("incomplete",args)).details.ok,false);
    args.content = ["locked_cast","gold_finger_limits","last_summary","recent_journals","story_graph_slice","recent_character_states","open_foreshadows","forbidden_drifts"].map(field=>field+": 核对原文").join("\n");
    assert.equal((await writer.execute("other",{...args,path:"/memories/projects/p/story_graph.md"})).details.ok,false);
    for (const invalid of [args.content.replaceAll(": 核对原文","").replaceAll("\n"," "), args.content.replace("locked_cast: 核对原文","locked_cast:"), args.content.replace("locked_cast: 核对原文","locked_cast: []")]) {
      assert.equal((await writer.execute("invalid",{...args,content:invalid})).details.ok,false);
    }
    args.content = args.content.replace("open_foreshadows: 核对原文","open_foreshadows: []");
    assert.equal(writes,0);
    assert.equal((await writer.execute("exact",args)).details.ok,true);
    assert.equal(writes,1);
    assert.ok(tools._successfulTools.has("memory_write"));
  } finally { api.putMemoryFileCas=prior; }
});

test("pending handoff agrees with persisted checklist checkboxes", async () => {
  const {createWritingTools} = await import("../src/tools.js");
  const {api} = await import("../src/apiClient.js");
  const prior = api.createArtifact;
  api.createArtifact = async (_project, row) => row;
  try {
    const tools = createWritingTools({projectId:"p",runId:"r",publish(){},allowlist:["checklist_open"]});
    const checklist = tools.find(t=>t.name==="checklist_open");
    for (const done of ["true","false",1,null,0,false,true,undefined]) {
      const item = {message:"补本集梗概",agentId:"struct.cool12",needsApproval:true,priority:"P1"};
      if (done !== undefined) item.done = done;
      const result = await checklist.execute("save",{title:"待审批",items:[item]});
      const row = JSON.parse(result.content[0].text);
      if (done !== undefined && typeof done !== "boolean") {
        assert.equal(row.error,"invalid_checklist");
        continue;
      }
      assert.ok(row.bodyMarkdown.startsWith(done === true ? "- [x]" : "- [ ]"));
      assert.equal(canHandOffToHuman(assertRegistered("colleague.proactive"),[row],
        {HumanConfirm:{id:"HumanConfirm",result:"fail"}}),false);
    }
  } finally { api.createArtifact = prior; }
});
