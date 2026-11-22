import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeProgrammaticReward, resolveRlMode, sessionEventsToShareGPT } from "./rlScore.ts";

describe("rlScore", () => {
  it("defaults to off", () => {
    assert.equal(resolveRlMode(undefined), "off");
    assert.equal(computeProgrammaticReward({}).mode, "off");
  });

  it("scores compliance signals in score_only", () => {
    const r = computeProgrammaticReward({
      mode: "score_only",
      biblePackReady: true,
      bibleHasGraphSlice: true,
      graphSchemaOk: true,
      foreshadowHasDue: true,
      foreshadowOverdueClear: true,
      lengthDecayPass: true,
      usedPayoffLedgerTool: true,
      usedGraphRelatedTool: true,
    });
    assert.equal(r.mode, "score_only");
    assert.equal(r.total, 1);
  });

  it("converts session events to sharegpt", () => {
    const { conversations } = sessionEventsToShareGPT([
      { type: "run_start", payload: { task: "x" } },
      { type: "token", text: "hello" },
      { type: "tool", payload: { name: "payoff_ledger" } },
    ]);
    assert.ok(conversations.some((c) => c.from === "human"));
    assert.ok(conversations.some((c) => c.from === "gpt"));
    assert.ok(conversations.some((c) => c.from === "tool"));
  });
});
