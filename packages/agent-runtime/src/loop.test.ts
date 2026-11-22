import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LOOPS, assertLoopGraphAcyclic, type Loop } from "./loop.ts";

describe("loop", () => {
  it("内置 LOOPS 无环", () => {
    assert.doesNotThrow(() => assertLoopGraphAcyclic(LOOPS));
  });

  it("构造环被检出", () => {
    const cyc: Loop[] = [
      { id: "propose", trigger: "cron", steps: [], edges: ["measure"], maxIterations: 1 },
      { id: "measure", trigger: "event", steps: [], edges: ["propose"], maxIterations: 1 },
    ];
    assert.throws(() => assertLoopGraphAcyclic(cyc), /cycle/i);
  });
});
