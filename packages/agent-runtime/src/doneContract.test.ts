import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateDoneContract, shouldExitLoop } from "./doneContract.ts";

it('requires actual successful tool evidence for biography memory persistence',()=>{
  const contract=[{type:'tool_success' as const,tool:'bible_write'}];
  assert.equal(evaluateDoneContract(contract,{}).ok,false);
  assert.equal(evaluateDoneContract(contract,{successfulTools:new Set(['bible_write'])}).ok,true);
});

describe("evaluateDoneContract", () => {
  it("fails when artifact count insufficient (hallucinated done)", () => {
    const ev = evaluateDoneContract(
      [{ type: "artifact_count", artifact: "core_hook", min: 10 }],
      { artifactCounts: { core_hook: 2 } },
    );
    assert.equal(ev.ok, false);
    assert.equal(shouldExitLoop(ev), false);
    assert.match(ev.repairHint, /core_hook/);
  });

  it("passes when artifacts and gates ok", () => {
    const ev = evaluateDoneContract(
      [
        { type: "artifact_count", artifact: "manuscript", min: 1 },
        { type: "gate_pass", gates: ["LengthBand"] },
      ],
      {
        artifactCounts: { manuscript: 1 },
        gateById: {
          LengthBand: {
            id: "length_band",
            name: "LengthBand",
            result: "pass",
            message: "ok",
          },
        },
      },
    );
    assert.equal(ev.ok, true);
    assert.equal(shouldExitLoop(ev), true);
  });

  it("blocks exit on missing user_ack", () => {
    const ev = evaluateDoneContract(
      [{ type: "user_ack", checklist: "human_qc_min" }],
      { userAcks: {} },
    );
    assert.equal(ev.ok, false);
    assert.match(ev.failed[0].message, /human_qc_min/);
  });

  it("resolves gate_pass case-insensitively and by name (mutation would fail)", () => {
    const ev = evaluateDoneContract(
      [{ type: "gate_pass", gates: ["LengthBand"] }],
      {
        gateById: {
          "length_band": {
            id: "length_band",
            name: "LengthBand",
            result: "pass",
            message: "ok",
          },
        },
      },
    );
    assert.equal(ev.ok, true);
  });

  it("treats inconclusive gate as not-passed (aligned with allPassed)", () => {
    const ev = evaluateDoneContract(
      [{ type: "gate_pass", gates: ["LengthBand"] }],
      {
        gateById: {
          LengthBand: {
            id: "length_band",
            name: "LengthBand",
            result: "inconclusive",
            message: "no length data",
          },
        },
      },
    );
    assert.equal(ev.ok, false);
    assert.equal(shouldExitLoop(ev), false);
  });

  it("resolves snake_case gate id against CamelCase clause name", () => {
    const ev = evaluateDoneContract(
      [{ type: "gate_pass", gates: ["EightTropeCoverage"] }],
      {
        gateById: {
          eight_trope_coverage: {
            id: "eight_trope_coverage",
            name: "八桥段覆盖",
            result: "pass",
            message: "已覆盖 3 类桥段",
          },
        },
      },
    );
    assert.equal(ev.ok, true);
  });
});
