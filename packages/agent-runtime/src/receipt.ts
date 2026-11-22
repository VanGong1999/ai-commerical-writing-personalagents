import { createHash } from "node:crypto";
import type { DoneContract, GateCheck, Receipt } from "./types.js";
import { buildReceiptHandoff } from "./gates.ts";

export type ReceiptInput = {
  runId: string;
  agentId: string;
  status: Receipt["status"];
  gateResults: GateCheck[];
  artifactIds: string[];
  tokenPrompt?: number;
  tokenCompletion?: number;
  tokenCacheHit?: number;
  tokenCacheMiss?: number;
  notes?: string;
  engine?: string;
  doneContractOk?: boolean;
  narrative?: string;
  input?: unknown;
  doneContract?: DoneContract[];
  inputHash?: string;
  doneContractHash?: string;
  createdAt?: string;
};

function hashText(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex").slice(0, 24);
}

/** 收据 attestation：绑定 run + gates + artifacts，防伪造弱声明。 */
export function attestReceipt(receipt: Omit<Receipt, "createdAt"> & { createdAt?: string }): string {
  const payload = JSON.stringify({
    runId: receipt.runId,
    agentId: receipt.agentId,
    status: receipt.status,
    gates: receipt.gateResults.map((g) => ({ id: g.id, result: g.result })),
    artifacts: receipt.artifactIds,
    inputHash: receipt.inputHash,
    doneContractHash: receipt.doneContractHash,
    handoff: receipt.handoff,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 24);
}

export function buildReceipt(input: ReceiptInput): Receipt & { attestation: string; narrative: string } {
  const createdAt = input.createdAt || new Date().toISOString();
  const inputHash =
    input.inputHash || (input.input !== undefined ? hashText(input.input) : undefined);
  const doneContractHash =
    input.doneContractHash ||
    (input.doneContract !== undefined ? hashText(input.doneContract) : undefined);
  const handoff = buildReceiptHandoff(
    input.agentId,
    input.gateResults,
    [
      input.notes || "",
      input.engine ? `engine=${input.engine}` : "",
      input.doneContractOk === false ? "doneContract=FAIL" : "doneContract=PASS",
    ]
      .filter(Boolean)
      .join("; "),
  );
  const base: Receipt = {
    runId: input.runId,
    agentId: input.agentId,
    status: input.status,
    gateResults: input.gateResults,
    artifactIds: input.artifactIds,
    tokenPrompt: input.tokenPrompt ?? 0,
    tokenCompletion: input.tokenCompletion ?? 0,
    tokenCacheHit: input.tokenCacheHit ?? 0,
    tokenCacheMiss: input.tokenCacheMiss ?? 0,
    handoff,
    inputHash,
    doneContractHash,
    createdAt,
  };
  const narrative =
    input.narrative ||
    [
      `## Run Narrative — ${input.agentId}`,
      "",
      `- run: ${input.runId}`,
      `- status: ${input.status}`,
      `- artifacts: ${input.artifactIds.length}`,
      `- fails: ${input.gateResults.filter((g) => g.result === "fail").map((g) => g.name).join(", ") || "无"}`,
      "",
      handoff,
    ].join("\n");
  return {
    ...base,
    attestation: attestReceipt(base),
    narrative,
  };
}

export function receiptIdFor(runId: string): string {
  return `receipt_${runId}`;
}
