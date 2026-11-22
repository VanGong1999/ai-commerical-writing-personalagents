/** 全局 Policy 存疑态：ask_operator 时供 Studio PolicyBanner 消费。 */

export type PolicyPending = {
  projectId: string;
  agentId: string;
  reason: string;
  jobId?: string;
  runId?: string;
  inputJson?: Record<string, unknown>;
};

let pending: PolicyPending | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getPolicyPending(): PolicyPending | null {
  return pending;
}

export function setPolicyPending(next: PolicyPending | null) {
  pending = next;
  emit();
}

export function clearPolicyPending() {
  pending = null;
  emit();
}

export function subscribePolicyPending(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
