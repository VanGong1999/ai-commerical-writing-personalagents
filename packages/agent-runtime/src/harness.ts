/**
 * Harness 组装层把 Loop / Tools / Security / Context / Session /
 * DoneContract / Receipt / Subagents / Policy 缝合为可配置运行时策略。
 */

import type { DoneContract } from "./types.js";
import type { SecurityMode, SecurityPolicy } from "./security.ts";
import { defaultSecurityPolicy } from "./security.ts";
import type { CompactionConfig } from "./context.ts";
import type { SubagentPolicy } from "./subagents.ts";
import { DEFAULT_SUBAGENT_POLICY } from "./subagents.ts";

export type HarnessConfig = {
  maxTurns: number;
  /** Done Contract 失败后最多踢回修复轮数 */
  maxRepairRounds: number;
  securityMode: SecurityMode;
  security?: SecurityPolicy;
  compaction?: CompactionConfig;
  subagents?: SubagentPolicy;
  /** 会话 JSONL 根目录；空则仅内存事件 */
  sessionRoot?: string;
  /** 是否在结束前强制 evaluateDoneContract */
  enforceDoneContract: boolean;
  /** 渐进式技能披露：系统提示只注入 name+description */
  progressiveSkills: boolean;
};

export const DEFAULT_HARNESS: HarnessConfig = {
  maxTurns: 24,
  maxRepairRounds: 3,
  securityMode: "safe",
  security: defaultSecurityPolicy("safe"),
  compaction: {
    triggerTokens: 24_000,
    keepTailTokens: 2_000,
    keepHeadUserMessages: 2,
  },
  subagents: DEFAULT_SUBAGENT_POLICY,
  sessionRoot: process.env.AGENT_SESSION_ROOT || "",
  enforceDoneContract: true,
  progressiveSkills: true,
};

export function resolveHarness(partial?: Partial<HarnessConfig>): HarnessConfig {
  const mode = partial?.securityMode || DEFAULT_HARNESS.securityMode;
  return {
    ...DEFAULT_HARNESS,
    ...partial,
    security: partial?.security || defaultSecurityPolicy(mode),
    compaction: { ...DEFAULT_HARNESS.compaction, ...partial?.compaction },
    subagents: { ...DEFAULT_SUBAGENT_POLICY, ...partial?.subagents },
  };
}

export type LoopExitReason =
  | "model_stop"
  | "max_turns"
  | "done_contract_pass"
  | "done_contract_exhausted"
  | "cancelled"
  | "error";

export type LoopState = {
  turn: number;
  repairRound: number;
  exitReason?: LoopExitReason;
  doneContract?: DoneContract[];
};
