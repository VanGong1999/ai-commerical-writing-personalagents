import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { attestReceipt, buildReceipt, receiptIdFor } from "./receipt.ts";

describe("receipt", () => {
  it("builds attested receipt with handoff narrative", () => {
    const r = buildReceipt({
      runId: "run1",
      agentId: "topic.core_hook_batch",
      status: "succeeded",
      gateResults: [{ id: "g1", name: "Schema", result: "pass", message: "ok" }],
      artifactIds: ["a1"],
      engine: "openai-tools",
      doneContractOk: true,
    });
    assert.equal(r.runId, "run1");
    assert.ok(r.attestation);
    assert.match(r.handoff, /Handoff/);
    assert.match(r.narrative, /Run Narrative/);
    assert.equal(receiptIdFor("run1"), "receipt_run1");
    assert.equal(attestReceipt(r), r.attestation);
  });

  it("binds input and done contract into the attestation (mutation changes it)", () => {
    const base = {
      runId: "run2",
      agentId: "prose.episode_body",
      status: "succeeded" as const,
      gateResults: [{ id: "g1", name: "LengthBand", result: "pass" as const, message: "ok" }],
      artifactIds: ["a2"],
      engine: "openai-tools",
      doneContractOk: true,
      input: { ep_no: 1 },
      doneContract: [{ type: "gate_pass" as const, gates: ["LengthBand"] }],
    };
    const r1 = buildReceipt(base);
    const r2 = buildReceipt({ ...base, input: { ep_no: 2 } });
    assert.ok(r1.inputHash && r1.doneContractHash);
    assert.notEqual(r1.attestation, r2.attestation);
  });
});
