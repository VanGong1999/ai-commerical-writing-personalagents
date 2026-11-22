import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decideResumePolicy,
  makeIdempotencyKey,
  ledgerFromSessionEvents,
  ledgerHas,
} from "./policy.ts";

describe("control-plane policy", () => {
  it("asks operator when tool_call in doubt with side effect", () => {
    const d = decideResumePolicy({
      lastEventType: "tool_call",
      sideEffect: "artifact_write",
    });
    assert.equal(d.action, "ask_operator");
    assert.match(d.reason, /in doubt/i);
  });

  it("safe retries model_call interrupt", () => {
    const d = decideResumePolicy({ lastEventType: "model_call", sideEffect: "none" });
    assert.equal(d.action, "safe_retry");
  });

  it("idempotency key is stable", () => {
    const a = makeIdempotencyKey("agent.x", { a: 1 });
    const b = makeIdempotencyKey("agent.x", { a: 1 });
    assert.equal(a, b);
  });

  it("restores a ledger from persisted session events and refuses re-apply", () => {
    const key = makeIdempotencyKey("agent.x", { a: 1 });
    const events = [
      {
        type: "ledger",
        payload: {
          ledger: { idempotencyKey: key, kind: "artifact_write", status: "applied" },
        },
      },
    ];
    const ledger = ledgerFromSessionEvents(events);
    assert.equal(ledgerHas(ledger, key), true);
    const d = decideResumePolicy({
      lastEventType: "tool_call",
      sideEffect: "artifact_write",
      alreadyApplied: ledgerHas(ledger, key),
    });
    assert.equal(d.action, "refuse");
  });
});
