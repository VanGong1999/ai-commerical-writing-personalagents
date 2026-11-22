import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  agentPrivateMemoryGate,
  callBudgetGate,
  defaultSecurityPolicy,
  gateToolCall,
  withSecurityGate,
} from "./security.ts";

describe("security gate", () => {
  it("denies bash in all modes", () => {
    const v = gateToolCall("bash", { command: "ls" }, defaultSecurityPolicy("yolo"));
    assert.equal(v.decision, "deny");
  });

  it("readonly blocks writes", () => {
    const v = gateToolCall("artifact_create", { title: "x" }, defaultSecurityPolicy("readonly"));
    assert.equal(v.decision, "deny");
  });

  it("allows list in readonly", () => {
    const v = gateToolCall("artifact_list", {}, defaultSecurityPolicy("readonly"));
    assert.equal(v.decision, "allow");
  });

  it("denies path escape", () => {
    const v = gateToolCall(
      "artifact_create",
      { path: "/etc/passwd" },
      defaultSecurityPolicy("safe"),
    );
    assert.equal(v.decision, "deny");
  });

  it("denies cross-project memory writes", () => {
    const policy = defaultSecurityPolicy("safe", { projectId: "p1" });
    const v = gateToolCall(
      "bible_write",
      { path: "/memories/projects/p2/characters.md", content: "x" },
      policy,
    );
    assert.equal(v.decision, "deny");
  });

  it("allows same-project memory writes", () => {
    const policy = defaultSecurityPolicy("safe", { projectId: "p1" });
    const v = gateToolCall(
      "bible_write",
      { path: "/memories/projects/p1/characters.md", content: "x" },
      policy,
    );
    assert.equal(v.decision, "allow");
  });

  it("safe mode auto-allows whitelisted writing tools (documented product deviation)", () => {
    const v = gateToolCall("artifact_create", { title: "x" }, defaultSecurityPolicy("safe"));
    assert.equal(v.decision, "allow");
  });

  it("safe mode asks on dangerous writes", () => {
    const v = gateToolCall(
      "artifact_create",
      { note: "delete" },
      defaultSecurityPolicy("safe"),
    );
    assert.equal(v.decision, "ask");
  });

  it("ask without an approver is fail-closed (deny)", async () => {
    const policy = defaultSecurityPolicy("safe");
    const tool = {
      name: "artifact_create",
      execute: async () => ({ content: [{ type: "text", text: "created" }] }),
    };
    const wrapped = withSecurityGate(tool, policy);
    const out = await wrapped("call_1", { note: "delete" });
    const parsed = JSON.parse(out.content[0].text);
    assert.equal(parsed.isError, true);
    assert.equal(parsed.error, "security_ask_denied");
  });
});

describe("PolicyGate 栈", () => {
  it("私有记忆：不能读写他人 procedural，可访问自己的（yolo 下也生效）", () => {
    const policy = { ...defaultSecurityPolicy("yolo", { projectId: "p1" }), gates: [agentPrivateMemoryGate("prose.a")] };
    const other = gateToolCall("memory_get", { path: "/memories/projects/p1/procedural/prose.b/lessons.md" }, policy);
    assert.equal(other.decision, "deny");
    assert.match(other.reason, /private_memory/);
    const mine = gateToolCall("memory_get", { path: "/memories/projects/p1/procedural/prose.a/lessons.md" }, policy);
    assert.equal(mine.decision, "allow");
    const shared = gateToolCall("memory_get", { path: "/memories/projects/p1/bible/world.md" }, policy);
    assert.equal(shared.decision, "allow");
  });

  it("调用预算：超过上限 deny，其它工具不受影响", () => {
    const gate = callBudgetGate({ lesson_note: 2 });
    const policy = { ...defaultSecurityPolicy("safe"), gates: [gate] };
    assert.equal(gateToolCall("lesson_note", {}, policy).decision, "allow");
    assert.equal(gateToolCall("lesson_note", {}, policy).decision, "allow");
    const third = gateToolCall("lesson_note", {}, policy);
    assert.equal(third.decision, "deny");
    assert.match(third.reason, /上限 2/);
    assert.equal(gateToolCall("artifact_list", {}, policy).decision, "allow");
  });

  it("内置 deny 优先于闸门；ask 取最严", () => {
    const askGate = { id: "g", check: () => ({ decision: "ask" as const, reason: "x" }) };
    const policy = { ...defaultSecurityPolicy("safe"), gates: [askGate] };
    assert.equal(gateToolCall("bash", {}, policy).decision, "deny");
    const v = gateToolCall("artifact_list", {}, policy);
    assert.equal(v.decision, "ask");
    assert.match(v.reason, /\[g\]/);
  });
});

describe('configured virtual file namespaces',()=>{
 it('allows readonly VFS browsing but not raw host paths or traversal',()=>{
  const policy=defaultSecurityPolicy('readonly');
  for(const path of ['/','/files/notes/story.md','/projects/p/artifacts','/kb','/workspace']) {
   assert.equal(gateToolCall('fs_read',{path},policy).decision,'allow',path);
  }
  for(const path of ['/etc/passwd','/files/notes/../secret.md','/files-other/notes/story.md']) {
   assert.equal(gateToolCall('fs_read',{path},policy).decision,'deny',path);
  }
  assert.equal(gateToolCall('fs_write',{path:'/files/notes/story.md',content:'x'},policy).decision,'deny');
 });
});

it("preserves uncertain mutation failures for the runtime inspection barrier", async () => {
  const error = Object.assign(new Error("result unknown"), { code: "mutation_result_unknown" });
  const wrapped = withSecurityGate({ name: "artifact_create", execute: async () => { throw error; } }, defaultSecurityPolicy("yolo"));
  await assert.rejects(wrapped("call", {}), caught => caught === error);
});
