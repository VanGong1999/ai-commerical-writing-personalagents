// Called from the SQLite QA signing test. All worker HTTP/model I/O is in memory.
import assert from 'node:assert/strict';
import { api } from '../../../agent-worker/src/apiClient.js';
import { runAgentJob } from '../../../agent-worker/src/runSession.js';

const [projectId, runId, manuscriptId] = process.argv.slice(2);
const articles = [], steps = [];
for (const key of Object.keys(api)) if (typeof api[key] === 'function') api[key] = async () => [];
api.appendRunStep = async (_id, step) => steps.push(step);
api.getRunReplay = async () => ({steps:[...steps]});
api.getProject = async () => ({id:projectId,format:'manju',progress:{}});
api.listArtifacts = async () => articles;
api.createArtifact = async (pid, body) => {
  const art = {...body,id:'qc-'+runId,projectId:pid,version:1};
  articles.push(art);
  return art;
};

const items = ['逻辑','AI表述','镜头','人设语言','钩子伏笔','画面时长'].map(category =>
  ({category, location:'第一集',text:'核对'+category,done:false}));
const call = (id,name,args) => ({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
let calls = 0;
api.agentChat = async ({messages}) => {
  calls++;
  assert.ok(calls <= 3, 'unexpected model turn');
  const tools = [];
  if (calls === 1) tools.push(call('open','checklist_open',{title:'逐集校验',items}));
  else assert.ok(messages.some(m => String(m.content).includes(calls === 2 ? '再核对夜景' : '复核对白')), 'new direction reached model');
  tools.push(call('ack-'+calls,'gate_run',{name:'LogicAck'}));
  return {choices:[{finish_reason:'tool_calls',message:{tool_calls:tools}}]};
};
const job = {id:'job-'+runId,projectId,leaseVersion:1,payload:{}};
const inputJson = {artifactIds:[manuscriptId],qaSourceVersions:{[manuscriptId]:1}};
const run = {id:runId,projectId,agentId:'qc.human_checklist',inputJson};
const execute = input => runAgentJob({job,run:{...run,inputJson:input},publish(){}});
const result = await execute(inputJson);
assert.equal(result.status,'succeeded');
assert.equal(result.exitReason,'pending_human_ack');
assert.deepEqual(result.outputVersions,{[articles[0].id]:1});
assert.equal(steps.find(s => s.kind==='tool_result' && s.payload.name==='checklist_open')
  .payload.artifactWrite.version,1);
job.leaseVersion++;
const replay = await execute(inputJson);
assert.equal(replay.receipt.attestation,result.receipt.attestation);
assert.equal(calls,1);
const revised = {...inputJson,assistantPrompt:'【追加指令】再核对夜景',steerRevision:'accepted-event'};
const updated = await execute(revised);
assert.notEqual(updated.receipt.inputHash,result.receipt.inputHash);
assert.equal(updated.steerRevision,revised.steerRevision);
assert.equal((await execute(revised)).receipt.attestation,updated.receipt.attestation);
assert.equal(calls,2);
// A steer first seen during the loop must sign the version the model actually received.
const atStart = {...inputJson, assistantPrompt:'再读一遍',steerRevision:'previous'};
const duringTurn = {...atStart,assistantPrompt:'追加复核对白',steerRevision:'during-turn'};
api.getSteer = async () => ({messages:[],inputJson:duringTurn});
const soft = await execute(atStart);
assert.equal(soft.steerRevision,duringTurn.steerRevision);
assert.equal((await execute(duringTurn)).receipt.attestation,soft.receipt.attestation);
assert.equal(calls,3);
console.log(JSON.stringify({art:articles[0],result}));
