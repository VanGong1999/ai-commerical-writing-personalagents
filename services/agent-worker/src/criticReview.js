import {isDeepStrictEqual} from "node:util";

export const criticAgents = new Set(["topic.core_hook_critic","topic.hook_critic"]);
export const dimensions = ["marketFit","innovation","motivation","opening","compliance"];
const recommendations = ["建议采用","可改后再评","淘汰"];
function requireValue(condition,message) {
  if (!condition) throw new Error(message);
}
function reviewBody(group,params,runId,count) {
  requireValue(Object.keys(params).every(k=>["artifactId","expectedVersion","reviews"].includes(k)),"评审仅可写 reviews");
  const {expectedVersion,reviews}=params;
  requireValue(group && expectedVersion===group.art.version && Array.isArray(reviews) && reviews.length===group.rows.size,"需按冻结版本提交该父产物的全部所选行");
  const body=structuredClone(group.art.bodyJson || {});
  const seen=new Set();
  const normalized=[];
  for(const row of reviews) {
    requireValue(row && group.rows.has(row.ref) && !seen.has(row.ref),"引用遗漏、重复或越界");
    seen.add(row.ref);
    requireValue(dimensions.every(k=>Number.isInteger(row[k]) && row[k]>=1 && row[k]<=5),"五维评分必须是 1–5 整数");
    requireValue(Number.isInteger(row.rank) && row.rank>=1 && row.rank<=count && recommendations.includes(row.recommendation) && typeof row.reason==="string" && row.reason.trim().length>=4,"需要有效排名、建议及具体理由");
    const score={ref:row.ref,sourceVersion:expectedVersion,runId,rank:row.rank,recommendation:row.recommendation,reason:row.reason.trim(),total:0};
    for(const k of dimensions){score[k]=row[k];score.total+=row[k];}
    const index=group.rows.get(row.ref);
    (index===undefined ? body : body.items[index]).criticReview=score;
    normalized.push(score);
  }
  return {body,reviews:normalized};
}

function sameNativeTurn(call,result) {
  // Older RunSteps lack a turn ID. Every turn identity actually present must agree.
  const turns=[call,result].flatMap(s=>[s.turnId,s.turn_id,s.payload.turnId,s.payload.turn_id]);
  return new Set(turns.filter(id=>id!=null)).size<=1;
}

function provenUpdate(steps,agentId,runId,art,expected) {
  const own=steps.filter(s=>s.runId===runId && s.actor==="agent:"+agentId && !s.payload?.child_run_id);
  for(const result of own) {
    const p=result.payload;
    if(result.kind!=="tool_result" || p?.name!=="artifact_update" || p.status!=="done" ||
        typeof p.id!=="string" || !p.id || p.artifactWrite?.id!==art.id ||
        p.artifactWrite.projectId!==art.projectId || p.artifactWrite.version!==art.version) continue;
    const pair=own.filter(s=>["tool_call","tool_result"].includes(s.kind) && s.payload?.id===p.id);
    const [call]=pair;
    if(pair.length===2 && pair[1]===result && call.kind==="tool_call" && sameNativeTurn(call,result) &&
        Number.isInteger(call.seq) && Number.isInteger(result.seq) && call.seq<result.seq &&
        call.payload.name==="artifact_update" && call.payload.args?.artifactId===art.id &&
        call.payload.args.expectedVersion===expected) return call.payload.args;
  }
  throw new Error("缺少本轮成功写回的调用和结果 "+art.id);
}

function checkRanks(receipts) {
  const scores=[...receipts.values()].flatMap(receipt=>receipt.reviews).sort((a,b)=>a.rank-b.rank);
  // Each rank is already bounded by the full selection. Uniqueness implies continuity once all rows exist.
  scores.forEach((score,i)=>{
    if(i)requireValue(scores[i-1].rank<score.rank && scores[i-1].total>=score.total,
      "排名需连续并按总分降序 "+score.ref);
  });
  return scores.length;
}

async function loadGroup(api,projectId,runId,art,expected,steps,agentId) {
  if(expected===art.version)return {art:structuredClone(art),rows:new Map()};
  requireValue(Number.isInteger(expected) && expected>0 && expected+1===art.version && criticAgents.has(agentId),
    "选择时的候选版本已变化 "+art.id);
  const params=provenUpdate(steps,agentId,runId,art,expected);
  const history=await api.listArtifactVersions(projectId,art.id);
  const snapshot=version=>{
    const matches=history.filter(row=>row.artifactId===art.id && row.version===version);
    requireValue(matches.length===1,"缺少唯一的候选版本快照 "+art.id);
    return matches[0];
  };
  const base=snapshot(expected);
  const written=snapshot(art.version);
  requireValue(["title","status","bodyMarkdown"].every(k=>typeof base[k]==="string" &&
    base[k]===written[k] && written[k]===art[k]) && Object.hasOwn(base,"bodyJson") &&
    Object.hasOwn(written,"bodyJson") && isDeepStrictEqual(written.bodyJson,art.bodyJson),
    "候选版本快照或现稿已变化 "+art.id);
  return {art:base,rows:new Map(),params,written};
}

export async function freezeCritic(api,projectId,runId,input,{steps=[],agentId}={}) {
  const refs=input.artifactIds ?? input.candidates;
  requireValue(Array.isArray(refs) && refs.length>=1 && refs.length<=100 && new Set(refs).size===refs.length,"需要 1–100 个不重复的明确候选引用");
  let genderPath=input.gender_path;
  if(genderPath===undefined) {
    const project=await api.getProject(projectId);
    if(project?.id===projectId)genderPath={male_long:"male",female_long:"female"}[project.format];
  }
  requireValue(["male","female"].includes(genderPath),"缺少有效频别，请明确选择男频（male）或女频（female）");
  const arts=await api.listArtifacts(projectId);
  const groups=new Map();
  const receipts=new Map();
  let passed=false;
  for (const ref of refs) {
    const match=typeof ref==="string" && /^([^#]+)(?:#(0|[1-9]\d*))?$/.exec(ref);
    requireValue(match,"候选引用格式错误");
    const [,id,index]=match;
    const art=arts.find(a=>a.id===id && a.projectId===projectId && a.type==="core_hook");
    requireValue(art && Number.isInteger(art.version) && art.version>0,"找不到项目候选 "+ref);
    if(!groups.has(id)) {
      const expected=input.artifactVersions===undefined ? art.version : input.artifactVersions?.[id];
      groups.set(id,await loadGroup(api,projectId,runId,art,expected,steps,agentId));
    }
    const group=groups.get(id);
    const items=group.art.bodyJson?.items;
    requireValue(index===undefined ? !Array.isArray(items) : Array.isArray(items) && items[index] && typeof items[index]==="object" && !Array.isArray(items[index]),"需要精确到有效候选行 "+ref);
    const selected=index===undefined ? group.art.bodyJson : items[index];
    requireValue(selected?.criticReview?.runId!==runId,"上次尝试已写回，缺少可验证的进程内收据，需重新选择 "+ref);
    const candidate=selected?.candidate ?? selected;
    const evidence=[candidate?.core_hook,candidate?.coreHook,candidate?.bodyMarkdown,candidate?.opening_structure,
      candidate?.openingStructure,candidate?.opening,candidate?.crisis,candidate?.motivation,
      index===undefined ? group.art.bodyMarkdown : undefined];
    requireValue(evidence.some(value=>typeof value==="string" && value.trim()),"缺少所选候选的核心梗或叙事材料 "+ref);
    group.rows.set(ref,index);
  }
  for(const [id,group] of groups) {
    if(!group.params)continue;
    const receipt=reviewBody(group,group.params,runId,refs.length);
    requireValue(isDeepStrictEqual(receipt.body,group.written.bodyJson),"已写候选与本轮所选行及评分不符 "+id);
    receipts.set(id,{...receipt,version:group.written.version});
  }
  checkRanks(receipts);
  async function check(mark=false) {
    try {
      const current=await api.listArtifacts(projectId);
      for(const [id,group] of groups) {
        const receipt=receipts.get(id);
        const art=current.find(a=>a.id===id && a.projectId===projectId);
        requireValue(receipt && art?.version===group.art.version+1 && isDeepStrictEqual(art.bodyJson,receipt.body),"缺少本轮写回或版本冲突 "+id);
      }
      const count=checkRanks(receipts);
      if(mark)passed=true;
      return {id:"critic_selected_rows",name:"候选逐条写回",result:"pass",message:"已验证 "+count+" 条本轮评审"};
    } catch(e) {
      passed=false;
      return {id:"critic_selected_rows",name:"候选逐条写回",result:"fail",message:e.message};
    }
  }
  async function write(params) {
    const id=params.artifactId;
    const group=groups.get(id);
    const expectedVersion=params.expectedVersion;
    const {body,reviews:normalized}=reviewBody(group,params,runId,refs.length);
    const current=(await api.listArtifacts(projectId)).find(a=>a.id===id && a.projectId===projectId);
    const previous=receipts.get(id);
    if(previous && current?.version===expectedVersion+1 && isDeepStrictEqual(current.bodyJson,body) && isDeepStrictEqual(previous.body,body))return current;
    requireValue(current?.version===expectedVersion,"候选版本冲突，需重新选择 "+id);
    passed=false;
    const art=await api.updateArtifact(projectId,id,{expectedVersion,bodyJson:body});
    requireValue(art?.id===id && art.version===expectedVersion+1 && isDeepStrictEqual(art.bodyJson,body),"写回响应不匹配 "+id);
    receipts.set(id,{body,reviews:normalized,version:art.version});
    return art;
  }
  const recovered=[...receipts].map(([id,receipt])=>({
    id,version:receipt.version,refs:receipt.reviews.map(score=>score.ref),
  }));
  const missing=[...groups.keys()].filter(id=>!receipts.has(id));
  const verifiedRanks=missing.length && recovered.length ? [...receipts.values()]
    .flatMap(receipt=>receipt.reviews.map(({ref,rank,total})=>({ref,rank,total}))) : [];
  const guidance=recovered.length ? "已核验写回："+JSON.stringify(recovered)+"。"+
    (missing.length ? "已写排名与总分："+JSON.stringify(verifiedRanks)+"。仅向以下父产物补写评审："+missing.join("、")+"。" : "全部所选行已写回。")+
    "运行 Schema，随后调用 done_check。" : "仅对明确所选候选评分，使用 artifact_update.reviews 写回。";
  const writtenVersions=()=>Object.fromEntries([...receipts].map(([id,r])=>[id,r.version]));
  return {genderPath,guidance,recovered:recovered.length>0,writtenVersions,versions:Object.fromEntries([...groups].map(([id,g])=>[id,g.art.version])),write,check,complete:async()=>passed && (await check()).result==="pass"};
}
