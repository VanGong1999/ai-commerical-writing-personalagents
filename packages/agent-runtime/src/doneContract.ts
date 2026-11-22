import type { DoneContract, GateCheck } from "./types.js";
import { allPassed } from "./gates.ts";

/** 运行时观测面：确定性门用来核对 Done Contract，禁止「模型自称完成」。 */
export type DoneContractEvidence = {
  successfulTools?: Set<string>;
  /** artifact type → count（来自 listArtifacts 聚合） */
  artifactCounts?: Record<string, number>;
  /** gate id / name → 最近一次 GateCheck（来自 gate_run / pre/post） */
  gateById?: Record<string, GateCheck>;
  /** 人工确认 checklist id → 是否已 ack */
  userAcks?: Record<string, boolean>;
};

export type DoneContractEval = {
  ok: boolean;
  checks: GateCheck[];
  failed: GateCheck[];
  repairHint: string;
};

function normGateKey(s: string): string {
  return s.toLowerCase().replace(/[_\s-]+/g, "");
}

function resolveGate(
  name: string,
  gateById: Record<string, GateCheck> | undefined,
): GateCheck | undefined {
  if (!gateById) return undefined;
  const direct = gateById[name] || gateById[name.toLowerCase()];
  if (direct) return direct;
  const lower = normGateKey(name);
  for (const [k, v] of Object.entries(gateById)) {
    if (normGateKey(k) === lower) return v;
    if (v.name === name || v.id === name) return v;
    if (normGateKey(v.name) === lower || normGateKey(v.id) === lower) return v;
  }
  return undefined;
}

/** Classify a required gate using the same evidence rules as Done Contract. */
export function evaluateDoneGate(
  name: string,
  gateById: DoneContractEvidence["gateById"],
): "missing" | "failed" | "satisfied" {
  const hit = resolveGate(name, gateById);
  if (!hit) return "missing";
  // A warning records evidence. An inconclusive result cannot satisfy the gate.
  return hit.result === "fail" || hit.result === "inconclusive" ? "failed" : "satisfied";
}

function evalOne(clause: DoneContract, evidence: DoneContractEvidence): GateCheck {
  if (clause.type === 'tool_success') {
    const ok = evidence.successfulTools?.has(clause.tool) === true;
    return {id:`done.tool_success.${clause.tool}`,name:'必要工具已成功执行',
      result:ok?'pass':'fail',message:ok?`${clause.tool} 已成功执行`:`请先成功执行 ${clause.tool}，不能仅创建候选后结束`};
  }
  if (clause.type === "artifact_count") {
    const count = evidence.artifactCounts?.[clause.artifact] ?? 0;
    if (count < clause.min) {
      return {
        id: `done.artifact_count.${clause.artifact}`,
        name: `产物数量≥${clause.min}`,
        result: "fail",
        message: `Done Contract：${clause.artifact} 现有 ${count}，需要 ≥ ${clause.min}`,
      };
    }
    return {
      id: `done.artifact_count.${clause.artifact}`,
      name: `产物数量≥${clause.min}`,
      result: "pass",
      message: `${clause.artifact}×${count} 满足 min=${clause.min}`,
    };
  }

  if (clause.type === "gate_pass") {
    const missing: string[] = [];
    const failed: string[] = [];
    for (const g of clause.gates) {
      const status = evaluateDoneGate(g, evidence.gateById);
      if (status === "missing") missing.push(g);
      if (status === "failed") failed.push(g);
    }
    if (missing.length || failed.length) {
      const parts = [
        missing.length ? `未跑/缺失：${missing.join(",")}` : "",
        failed.length ? `失败：${failed.join(",")}` : "",
      ].filter(Boolean);
      return {
        id: `done.gate_pass.${clause.gates.join("+")}`,
        name: "门禁全部通过",
        result: "fail",
        message: `Done Contract gate_pass：${parts.join("；")}`,
      };
    }
    return {
      id: `done.gate_pass.${clause.gates.join("+")}`,
      name: "门禁全部通过",
      result: "pass",
      message: `gates OK：${clause.gates.join(",")}`,
    };
  }

  // user_ack
  const acked = Boolean(evidence.userAcks?.[clause.checklist]);
  if (!acked) {
    return {
      id: `done.user_ack.${clause.checklist}`,
      name: "人工确认",
      result: "fail",
      message: `Done Contract：checklist「${clause.checklist}」尚未人工 ack，禁止结束`,
    };
  }
  return {
    id: `done.user_ack.${clause.checklist}`,
    name: "人工确认",
    result: "pass",
    message: `checklist「${clause.checklist}」已确认`,
  };
}

/**
 * 确定性评估 Done Contract（Define Done Before You Run）。
 * 模型 emit done 后必须过此门；失败则踢回循环。
 */
export function evaluateDoneContract(
  contract: DoneContract[],
  evidence: DoneContractEvidence,
): DoneContractEval {
  const checks = (contract || []).map((c) => evalOne(c, evidence));
  const failed = checks.filter((c) => c.result === "fail");
  const repairHint = failed.length
    ? [
        "Done Contract 未通过，禁止结束。请按失败条款修复后再次调用工具：",
        ...failed.map((f) => `- ${f.id}: ${f.message}`),
        "修复后请创建缺失产物 / 重跑失败 Gate / 等待人工 ack，然后再停止。",
      ].join("\n")
    : "Done Contract 全部通过。";
  return {
    ok: allPassed(checks),
    checks,
    failed,
    repairHint,
  };
}

/** 是否允许结束 loop：合同通过且无 fail 级 gate */
export function shouldExitLoop(evalResult: DoneContractEval): boolean {
  return evalResult.ok;
}
