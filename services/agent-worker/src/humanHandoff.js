import { getAgent } from "@xiezuomanju/agent-runtime";

const humanGates = new Set(["HumanConfirm", "human_confirm", "LogicAck", "logic_ack"]);
const text = value => typeof value === "string" && Boolean(value.trim());

export function validChecklist(agentId, body) {
  const items = body?.items ?? body?.proposals ?? body?.human_todo;
  if (!Array.isArray(items) || !items.length || items.some(item => !item || (Object.hasOwn(item, "done") && item.done !== false))) return false;
  if (agentId === "colleague.proactive") return items.length <= 5 && items.every(item =>
    text(item.message) && getAgent(item.agentId) && item.needsApproval === true && ["P0","P1","P2"].includes(item.priority));
  if (agentId === "qc.human_qc_duanju") return items.every(item =>
    text(item.id) && text(item.question) && text(item.why_human) && text(item.related_artifact) && item.blocking === true);
  if (agentId === "qc.human_checklist") return ["逻辑","AI表述","镜头","人设语言","钩子伏笔","画面时长"].every(label =>
    items.some(item => item.category === label && text(item.text) && text(item.location)));
  return false;
}

function pendingProposalRows(report, proposals) {
  const {items, proposalIds} = report.bodyJson;
  return Boolean(report.id && report.projectId && report.createdByRunId) && Array.isArray(proposalIds) && proposalIds.length === items.length &&
    new Set(proposalIds).size === items.length && items.every((item,index) => {
      const row = proposals.find(p => p.id === proposalIds[index]);
      const [action] = row?.actions ?? [];
      return row?.status === "pending" && row.type === "colleague.proactive" && row.actions.length === 1 && row.priority === ({P0:3,P1:2,P2:1})[item.priority] && row.projectId === report.projectId && row.message === item.message &&
        action?.sourceReportId === report.id && action?.sourceRunId === report.createdByRunId &&
        action?.type === "agent.run" && action.agentId === item.agentId && action.needsApproval === true;
    });
}

export function canHandOffToHuman(agent, artifacts, evidence, proposals = []) {
  if (!artifacts.some(a => a.type === "qc_report" && validChecklist(agent.id, a.bodyJson) &&
      (agent.id !== "colleague.proactive" || pendingProposalRows(a, proposals)))) return false;
  if (Object.values(evidence).some(g => g.result !== "pass" && !humanGates.has(g.id))) return false;
  let pending = false;
  for (const clause of agent.doneContract) {
    if (clause.type === "user_ack") pending = true;
    else if (clause.type === "gate_pass") {
      for (const gate of clause.gates) {
        const result = evidence[gate]?.result;
        if (humanGates.has(gate) && result === "fail") pending = true;
        else if (result !== "pass") return false;
      }
    } else return false;
  }
  return pending;
}
