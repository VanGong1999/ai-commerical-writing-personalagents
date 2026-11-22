import { Button, Panel, toast } from "@xiezuomanju/ui";
import { useCallback, useSyncExternalStore } from "react";
import { api } from "../../api/client";
import {
  clearPolicyPending,
  getPolicyPending,
  subscribePolicyPending,
} from "./policyPending";
import { runAgentFeedback } from "./runAgentFeedback";

export function PolicyBanner() {
  const pending = useSyncExternalStore(subscribePolicyPending, getPolicyPending, () => null);

  const decide = useCallback(
    async (decision: "resume" | "refuse") => {
      if (!pending) return;
      try {
        const policy = await api.policyResume({
          lastEventType: "tool_call",
          sideEffect: "artifact_write",
          alreadyApplied: false,
          operatorDecision: decision,
        });
        if (decision === "refuse") {
          clearPolicyPending();
          toast.info(policy.reason || "已拒绝恢复");
          return;
        }
        clearPolicyPending();
        toast.info("正在按操作员确认重投…");
        await runAgentFeedback(pending.projectId, pending.agentId, {
          inputJson: pending.inputJson,
          operatorDecision: "resume",
          label: `${pending.agentId}（恢复）`,
        });
      } catch (e) {
        toast.fail(e instanceof Error ? e.message : String(e));
      }
    },
    [pending],
  );

  if (!pending) return null;

  return (
    <Panel title="控制平面 · 需操作员确认" style={{ marginBottom: 12, borderColor: "var(--warn, #a96a12)" }}>
      <p style={{ margin: "0 0 10px", fontSize: "var(--fs-sm)" }}>{pending.reason}</p>
      <p className="faint" style={{ margin: "0 0 10px", fontSize: "var(--fs-sm)" }}>
        Agent <code>{pending.agentId}</code>
        {pending.runId ? ` · Run ${pending.runId.slice(0, 8)}…` : ""}
        {pending.jobId ? ` · Job ${pending.jobId.slice(0, 8)}…` : ""}
      </p>
      <div className="row" style={{ gap: 8 }}>
        <Button variant="primary" onClick={() => void decide("resume")}>
          继续（resume）
        </Button>
        <Button onClick={() => void decide("refuse")}>拒绝</Button>
        <Button onClick={() => clearPolicyPending()}>稍后处理</Button>
      </div>
    </Panel>
  );
}
