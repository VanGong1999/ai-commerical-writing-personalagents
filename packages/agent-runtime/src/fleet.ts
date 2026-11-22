/**
 * Fleet：多 Harness 实例并行。
 * 每个实例独立 name/workdir/task；合并策略由编排方决定（synthesis|union|ordered）。
 * workdir 为逻辑命名空间（记忆/产物前缀），非 OS worktree 拷贝。
 */

export const MAX_FLEET_MEMBERS = 4;

export type FleetMember = {
  name: string;
  workdir: string;
  task: string;
  agentId?: string;
  securityMode?: "readonly" | "safe" | "yolo";
};

export type FleetPlan = {
  id: string;
  mode: "synthesis" | "union" | "ordered";
  members: FleetMember[];
  mergePolicy: "semantic_repair" | "refuse" | "human";
  projectId?: string;
};

export type FleetMemberReport = {
  name: string;
  status: "pending" | "running" | "done" | "failed";
  summary?: string;
  runId?: string;
  jobId?: string;
  index?: number;
};

export type FleetResult = {
  planId: string;
  mode: FleetPlan["mode"];
  mergePolicy: FleetPlan["mergePolicy"];
  projectId?: string;
  reports: FleetMemberReport[];
  synthesisJobId?: string;
};

/** 逻辑隔离前缀：/memories/projects/{projectId}/fleet/{fleetId}/{member}/… */
export function fleetWorkdirKey(projectId: string, fleetId: string, memberName: string): string {
  const safe = String(memberName || "member")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 48);
  return `/memories/projects/${projectId}/fleet/${fleetId}/${safe}`;
}

export function assertFleetSize(members: FleetMember[]): void {
  if (!members?.length) throw new Error("fleet members required");
  if (members.length > MAX_FLEET_MEMBERS) {
    throw new Error(`fleet members ${members.length} exceeds max ${MAX_FLEET_MEMBERS}`);
  }
}

/** 仅生成可入队的 Job 信封；真正并行由 worker/队列执行。 */
export function planFleetJobs(plan: FleetPlan): Array<{
  type: "agent.run";
  payload: Record<string, unknown>;
}> {
  assertFleetSize(plan.members);
  return plan.members.map((m, i) => ({
    type: "agent.run" as const,
    payload: {
      fleetId: plan.id,
      fleetIndex: i,
      fleetMode: plan.mode,
      mergePolicy: plan.mergePolicy,
      agentId: m.agentId || "orch.writing",
      workdir: m.workdir || fleetWorkdirKey(plan.projectId || "unknown", plan.id, m.name),
      securityMode: m.securityMode || "safe",
      input: {
        task: m.task,
        fleetMember: m.name,
        fleetWorkdir: m.workdir || fleetWorkdirKey(plan.projectId || "unknown", plan.id, m.name),
      },
    },
  }));
}

export function emptyFleetResult(plan: FleetPlan): FleetResult {
  return {
    planId: plan.id,
    mode: plan.mode,
    mergePolicy: plan.mergePolicy,
    projectId: plan.projectId,
    reports: plan.members.map((m, i) => ({
      name: m.name,
      status: "pending" as const,
      index: i,
    })),
  };
}

export type MergeOutput = {
  mode: FleetPlan["mode"];
  markdown: string;
  /** synthesis 再入队用的 input 草稿 */
  synthesisInput?: Record<string, unknown>;
  memberSummaries: string[];
};

/**
 * ordered：按 index 拼接；union：列表；synthesis：产出汇总 input 草稿。
 */
export function mergeFleetReports(
  mode: FleetPlan["mode"],
  reports: FleetMemberReport[],
): MergeOutput {
  const sorted = [...reports].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const lines = sorted.map((r, i) => {
    const idx = r.index ?? i;
    return `### [${idx}] ${r.name} (${r.status})\n${r.summary || "（无摘要）"}`;
  });
  const memberSummaries = sorted.map((r) => r.summary || `${r.name}:${r.status}`);

  if (mode === "union") {
    return {
      mode,
      markdown: ["## Fleet Union", "", ...memberSummaries.map((s) => `- ${s}`)].join("\n"),
      memberSummaries,
    };
  }

  if (mode === "synthesis") {
    const markdown = ["## Fleet Synthesis Source", "", ...lines].join("\n");
    return {
      mode,
      markdown,
      memberSummaries,
      synthesisInput: {
        task: "综合以下舰队成员报告，产出统一结论与下一步建议（禁止重跑探索）。",
        fleetReports: sorted,
        sourceMarkdown: markdown,
      },
    };
  }

  // ordered
  return {
    mode: "ordered",
    markdown: ["## Fleet Ordered", "", ...lines].join("\n"),
    memberSummaries,
  };
}

export function fleetAllTerminal(reports: FleetMemberReport[]): boolean {
  return reports.length > 0 && reports.every((r) => r.status === "done" || r.status === "failed");
}
