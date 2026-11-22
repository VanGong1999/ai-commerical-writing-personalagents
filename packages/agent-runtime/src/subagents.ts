/**
 * 子智能体编排：子智能体视作工具。
 * 模式：single / parallel / chain；深度限制默认 2。
 */

export type SubagentMode = "single" | "parallel";

export type SubagentRole = "scout" | "planner" | "worker" | "reviewer" | "custom";

export type SubagentSpec = {
  role: SubagentRole;
  name: string;
  description: string;
  /** 可调用的 agentId（registry）或自定义 prompt 标签 */
  agentId?: string;
  maxTurns?: number;
  toolsAllowlist?: string[];
};

export type SubagentInvoke = {
  role: SubagentRole;
  task: string;
  mode?: SubagentMode;
  depth: number;
  parentRunId: string;
};

export type SubagentPolicy = {
  maxDepth: number;
  maxParallel: number;
};

export const DEFAULT_SUBAGENT_POLICY: SubagentPolicy = {
  maxDepth: 1,
  maxParallel: 3,
};

export const BUILTIN_SUBAGENTS: SubagentSpec[] = [
  {
    role: "scout",
    name: "Scout",
    description: "侦查：只读检索 bible/KB/产物/公开网络来源，汇总证据，禁止写产物。",
    agentId: "orch.writing",
    maxTurns: 6,
    toolsAllowlist: [
      "gate_run",
      "artifact_list",
      "bible_read",
      "kb_read",
      "kb_search",
      "web_search",
      "memory_search",
      "skill_list",
      "skill_read",
    ],
  },
  {
    role: "planner",
    name: "Planner",
    description: "规划：把任务拆成可验收步骤与 Done Contract 条款建议。",
    agentId: "orch.writing",
    maxTurns: 4,
    toolsAllowlist: ["artifact_list", "skill_list", "skill_read", "gate_run"],
  },
  {
    role: "worker",
    name: "Worker",
    description: "执行：按计划写产物并跑 Gate。",
    agentId: "orch.batch_writer",
    maxTurns: 12,
  },
  {
    role: "reviewer",
    name: "Reviewer",
    description: "评审：对抗式检查产物与 Done Contract，输出失败条款。",
    agentId: "topic.core_hook_critic",
    maxTurns: 6,
    toolsAllowlist: ["artifact_list", "gate_run", "skill_read", "diff_artifacts"],
  },
];

export function assertSubagentDepth(depth: number, policy = DEFAULT_SUBAGENT_POLICY): void {
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > policy.maxDepth) {
    throw new Error(`子智能体深度 ${depth} 超过上限 ${policy.maxDepth}`);
  }
}

export function assertParallelSize(tasks: string[], policy = DEFAULT_SUBAGENT_POLICY): void {
  if (!tasks?.length) {
    throw new Error("parallel tasks required");
  }
  if (tasks.length > policy.maxParallel) {
    throw new Error(`parallel tasks ${tasks.length} exceeds max ${policy.maxParallel}`);
  }
}

export function resolveSubagent(role: SubagentRole): SubagentSpec {
  const hit = BUILTIN_SUBAGENTS.find((s) => s.role === role);
  if (!hit) {
    return {
      role: "custom",
      name: String(role),
      description: "自定义子智能体",
      maxTurns: 8,
    };
  }
  return hit;
}

/** 工具合同：给 LLM 看的 subagent_spawn 描述 */
export const SUBAGENT_SPAWN_TOOL_DESC =
  "Spawn a subagent (scout|planner|worker|reviewer) with an isolated task. " +
  "Use when work can be parallelized or needs isolated context. " +
  "Returns a final report only; parent pays for the answer, child bears exploration cost. " +
  "Depth limited; do not nest beyond maxDepth.";
