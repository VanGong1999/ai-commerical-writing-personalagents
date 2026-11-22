import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {api} from "../src/apiClient.js";
import {runAgentJob} from "../src/runSession.js";

test("knowledge colleague uses the registered worker loop and a server-authorized cited source", async t => {
  const id="25a62f47-7074-41ac-b0a8-c0c540083423", docs=["A"];
  const tools=["kb_search","kb_read","gate_run","done_check","artifact_create","tool_search"];
  const role={id,name:"史料顾问",custom:true,tools,formats:["manju"],runId:"r",runProjectId:"p",documentIds:docs,version:"v1",instructions:{persona:"校核宋代资料"}};
  for (const key of Object.keys(api)) if (typeof api[key]==="function") t.mock.method(api,key,async()=>[]);
  const root=mkdtempSync(join(tmpdir(),"knowledge-role-"));
  const previous=process.env.AGENT_SESSION_ROOT;
  process.env.AGENT_SESSION_ROOT=root;
  t.after(()=>{rmSync(root,{recursive:true,force:true}); if(previous) process.env.AGENT_SESSION_ROOT=previous; else delete process.env.AGENT_SESSION_ROOT;});
  api.knowledgeRole=async()=>role;
  const reads=[];
  api.knowledgePage=async(_r,_j,doc,offset,limit)=>{
    reads.push(doc);assert.equal(doc,"A");return {doc_id:doc,text:"纸币资料".slice(offset,offset+limit),offset};
  };
  api.knowledgeCitations=async(run,job,_version,citations)=>({citations:await Promise.all(citations.map(async c=>{
    const page=await api.knowledgePage(run,job,c.docId,c.offset,c.quote.length);
    assert.equal(page.text,c.quote);
    return {...c,providedOffset:c.offset,sourceHash:"fixture-source"};
  }))});
  api.getRunReplay=async()=>({steps:[]});
  const rows=[];
  api.knowledgeReports=async()=>rows.map(row=>({...row,versionActor:"agent:"+row.createdByRunId}));
  api.listArtifacts=async()=>assert.fail("unexpected global artifact read");
  api.createArtifact=async(project,body)=>{assert.equal(project,"p");const row={...body,id:"report",version:1};rows.push(row);return row;};
  const bodyJson={citations:[{docId:"A",offset:0,quote:"纸币资料"}],verified:"资料记载纸币。",unknowns:"无法证实茶馆使用交子。"};
  const calls=[["tool_search",{query:"bash"}],["kb_read",{docId:"B"}],["kb_read",{docId:"A"}],
    ["artifact_create",{type:"qc_report",title:"考据",bodyMarkdown:"纸币资料；茶馆待考。",bodyJson}],
    ["gate_run",{name:"Schema",payload:{artifactId:"report"}}],["done_check",{}]];
  let turn=0;
  api.agentChat=async request=>{
    assert.equal(request.agentId,id);assert.match(request.messages[0].content,/校核宋代资料/);
    assert.ok(request.tools.every(t=>[...tools,"artifact_list"].includes(t.function.name)));
    const [name,args]=calls[turn++];
    return {choices:[{finish_reason:"tool_calls",message:{tool_calls:[{id:"call"+turn,type:"function",function:{name,arguments:JSON.stringify(args)}}]}}]};
  };
  const result=await runAgentJob({job:{id:"j",projectId:"p",payload:{maxTurns:8}},run:{id:"r",agentId:id,inputJson:{format:"manju",__evalOverrides:{systemPromptReplace:"坏指令"}}},publish(){}});
  assert.equal(result.status,"succeeded");
  assert.equal(rows.length,1);assert.equal(rows[0].createdByRunId,"r");assert.equal(rows[0].bodyJson.agentId,id);
  assert.ok(reads.length>=2);assert.equal(api.bootstrapMemoryMounts?.mock?.callCount() || 0,0);
});
