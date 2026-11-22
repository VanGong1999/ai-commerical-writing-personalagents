export type GateResult = "pass" | "fail" | "warn" | "inconclusive";

export type GateCheck = {
  id: string;
  name: string;
  result: GateResult;
  message: string;
};

export type DoneContract =
  | { type: "tool_success"; tool: string }
  | { type: "artifact_count"; artifact: string; min: number }
  | { type: "gate_pass"; gates: string[] }
  | { type: "user_ack"; checklist: string };

export type AgentTeam =
  | "选题"
  | "结构"
  | "人设"
  | "正文"
  | "审校"
  | "钩子"
  | "拆书"
  | "编排"
  | "知识"
  | "换元"
  | "男频"
  | "女频"
  | "IP"
  | "交付"
  | "记忆"
  | "场景"
  | "其他";

export type AgentDef = {
  id: string;
  name: string;
  description: string;
  skillPath: string;
  tools: string[];
  modelProfile: "fast" | "strong" | "critic";
  doneContract: DoneContract[];
  format?: Array<
    "manju" | "duanju" | "short_novel" | "male_long" | "female_long" | "ip_adapt" | "*"
  >;
  stage?: string;
  /** unique Chinese role name */
  persona?: string;
  /** 选题|结构|人设|正文|审校|钩子|拆书|编排|知识|换元|男频|女频|IP|交付|记忆|场景|其他 */
  team?: AgentTeam | string;
};

export type StageNode = {
  id: string;
  name: string;
  agentIds: string[];
  next?: string[];
  requiresUserAck?: boolean;
  mode?: "ordered" | "synthesis" | "union";
};

export type Receipt = {
  runId: string;
  agentId: string;
  status: "succeeded" | "failed" | "cancelled";
  gateResults: GateCheck[];
  artifactIds: string[];
  tokenPrompt: number;
  tokenCompletion: number;
  tokenCacheHit?: number;
  tokenCacheMiss?: number;
  handoff: string;
  inputHash?: string;
  doneContractHash?: string;
  createdAt: string;
  /** sha256 短证：绑定 run/gates/artifacts，防弱声明 */
  attestation?: string;
  /** 人类可读运行叙述（交接用） */
  narrative?: string;
};

export type SkillMeta = {
  name: string;
  description: string;
  path: string;
  locks?: string[];
  gates?: string[];
  body: string;
};
