import assert from "node:assert/strict";
import test from "node:test";
import { getAgent } from "@xiezuomanju/agent-runtime";
import { api } from "../src/apiClient.js";
import { validateArgs } from "../src/toolSchema.js";
import { createWritingTools } from "../src/tools.js";

const boundProject = {
  id: "bound-project", userId: "writer", title: "连载", format: "manju", genreTags: [],
  market: "cn", stage: "S9_DE_AI", status: "active", progress: {}, coverMeta: {},
  budgetTokens: null, promptPackId: null, tokenUsed: 0, createdAt: "2026-11-20T06:00:00Z",
  updatedAt: "2026-11-20T06:00:00Z", lastOpenedAt: "2026-11-20T06:00:00Z",
};

function setup(doneContract = [], ctx = {}) {
  const tools = createWritingTools({
    projectId: boundProject.id, runId: "run", doneContract, publish() {},
    allowlist: ["gate_run", "done_check"], ...ctx,
  });
  const gate = tools.find(tool => tool.name === "gate_run");
  const done = tools.find(tool => tool.name === "done_check");
  return {
    tools,
    async runGate(name, payload) {
      const args = validateArgs(payload === undefined ? { name } : { name, payload }, gate.parameters);
      assert.equal(args.ok, true);
      const { content } = await gate.execute("gate", args.args);
      return JSON.parse(content[0].text);
    },
    runDoneCheck: () => done.execute("done", {}),
  };
}

test("FormatSelected and its aliases use the bound project when format is omitted", async t => {
  t.mock.method(api, "getProject", async id => id === boundProject.id ? boundProject : null);
  t.mock.method(api, "listArtifacts", async () => []);
  const { tools, runGate, runDoneCheck } = setup([{ type: "gate_pass", gates: ["FormatSelected"] }]);

  for (const [name, payload] of [
    ["FormatSelected", undefined],
    ["Format", { text: "漫剧正文" }],
    ["format_selected", { artifactId: "candidate", text: "漫剧正文" }],
  ]) {
    const result = await runGate(name, payload);
    assert.equal(result.passed, true, name);
    assert.equal(result.checks[0].id, "format_selected");
    assert.deepEqual(result.checks[0].evidence, {
      source: "bound_project", projectId: "bound-project", format: "manju",
    });
    assert.deepEqual(tools._gateEvidence.FormatSelected.evidence, result.checks[0].evidence);
  }
  assert.equal((await runDoneCheck()).details.ok, true);
});

test("the scoped gate schema accepts Format only when FormatSelected is allowed", async t => {
  t.mock.method(api, "getProject", async () => boundProject);
  const { runGate } = setup([], { allowedGateNames: ["FormatSelected"] });
  assert.equal((await runGate("Format")).passed, true);

  const { tools } = setup([], { allowedGateNames: ["Schema"] });
  const gate = tools.find(tool => tool.name === "gate_run");
  assert.equal(validateArgs({ name: "Format" }, gate.parameters).ok, false);
  const { content } = await gate.execute("attempt", { name: "Format" });
  assert.equal(JSON.parse(content[0].text).error, "gate_not_applicable");
});

test("FormatSelected rejects a conflicting valid format and an explicitly invalid format", async t => {
  t.mock.method(api, "getProject", async () => boundProject);
  const { runGate } = setup();
  const conflict = await runGate("FormatSelected", { format: "duanju" });
  assert.equal(conflict.passed, false);
  assert.match(conflict.checks[0].message, /duanju.*manju.*冲突/);
  assert.equal(conflict.checks[0].evidence.format, "manju");

  for (const format of ["unknown-format", ""]) {
    const invalid = await runGate("FormatSelected", { format });
    assert.equal(invalid.passed, false);
    assert.match(invalid.checks[0].message, /未选择合法写作格式/);
  }
  assert.equal((await runGate("FormatSelected", { format: "manju" })).passed, true);
});

test("FormatSelected lookup errors and absent projects yield tool errors without pass evidence", async t => {
  let project;
  t.mock.method(api, "getProject", async () => {
    if (project instanceof Error) throw project;
    return project;
  });
  t.mock.method(api, "listArtifacts", async () => []);
  for (const response of [null, new Error("503 project API unavailable")]) {
    project = response;
    const { tools, runGate, runDoneCheck } = setup([{ type: "gate_pass", gates: ["FormatSelected"] }]);
    const result = await runGate("FormatSelected", { format: "manju" });
    assert.equal(result.isError, true);
    if (response instanceof Error) assert.match(result.message, /503 project API unavailable/);
    assert.notEqual(tools._gateEvidence.FormatSelected?.result, "pass");
    assert.equal((await runDoneCheck()).details.ok, false);
  }
});

test("FormatSelected never resolves a different project from payload or artifact data", async t => {
  const foreign = { ...boundProject, id: "foreign-project", format: "duanju" };
  t.mock.method(api, "getProject", async id => id === boundProject.id ? boundProject : foreign);
  const artifactReads = t.mock.method(api, "listArtifacts", async () => [{
    id: "foreign-artifact", projectId: foreign.id, bodyJson: { format: foreign.format },
  }]);
  const { runGate } = setup([], { inputJson: { format: "duanju" } });
  const result = await runGate("FormatSelected", {
    projectId: foreign.id, artifactId: "foreign-artifact", text: "格式是 duanju",
  });
  assert.equal(result.passed, true);
  assert.deepEqual(result.checks[0].evidence, {
    source: "bound_project", projectId: "bound-project", format: "manju",
  });
  assert.equal(artifactReads.mock.callCount(), 0);
});

test("a bound project with an unset format cannot obtain a format pass", async t => {
  t.mock.method(api, "getProject", async () => ({ ...boundProject, format: "" }));
  const { runGate } = setup();
  assert.equal((await runGate("FormatSelected")).passed, false);
  assert.equal((await runGate("FormatSelected", { format: "manju" })).passed, false);
});

test("completion hints defer to done_check when no mandatory gates remain", async t => {
  t.mock.method(api, "getProject", async () => boundProject);
  t.mock.method(api, "listArtifacts", async () => []);
  const artifactOnly = [{ type: "artifact_count", artifact: "manuscript", min: 1 }];
  const roleContract = getAgent("qc.de_ai").doneContract;
  for (const contract of [[], artifactOnly, roleContract]) {
    const { runGate, runDoneCheck } = setup(contract);
    const result = await runGate("FormatSelected", { format: "manju" });
    assert.deepEqual(result.remainingRequiredGates, []);
    assert.match(result.completionHint, /没有剩余必需门禁.*done_check/);
    const done = await runDoneCheck();
    assert.equal(done.details.ok, contract.length === 0);
    if (contract.length > 0) assert.match(done.content[0].text, /done.artifact_count.manuscript/);
    if (contract === roleContract) assert.match(done.content[0].text, /done.tool_success.artifact_create/);
  }
});

for (const gate of ["HookPresence", "hook-presence"]) {
  test(`completion hints accept the same warning as done_check for ${gate}`, async t => {
    t.mock.method(api, "listArtifacts", async () => []);
    const { runGate, runDoneCheck } = setup([{ type: "gate_pass", gates: [gate] }]);

    const result = await runGate("HookPresence");
    assert.equal(result.checks[0].result, "warn");
    assert.equal((await runDoneCheck()).details.ok, true);
    assert.deepEqual(result.remainingRequiredGates, []);
    assert.match(result.completionHint, /没有剩余必需门禁.*done_check/);
  });
}

test("completion hints resolve gate name variants for passes and failures", async t => {
  t.mock.method(api, "listArtifacts", async () => []);
  const { runGate, runDoneCheck } = setup([
    { type: "gate_pass", gates: ["chunk-policy", "length-band", "LogicAck"] },
  ]);

  const result = await runGate("ChunkPolicy");
  assert.deepEqual(result.remainingRequiredGates, ["length-band", "LogicAck"]);
  assert.doesNotMatch(result.completionHint, /未通过/);

  const failed = await runGate("LengthBand", { text: "正文" });
  assert.equal(failed.passed, false);
  assert.deepEqual(failed.remainingRequiredGates, ["length-band", "LogicAck"]);
  assert.match(failed.completionHint, /未通过的必需门禁（length-band）/);
  assert.equal((await runDoneCheck()).details.ok, false);
});

test("completion hints name the exact required gates and preserve failure and human repair guidance", async t => {
  t.mock.method(api, "getProject", async () => boundProject);
  t.mock.method(api, "listArtifacts", async () => []);
  const { runGate, runDoneCheck } = setup([{ type: "gate_pass", gates: ["ChunkPolicy", "Schema", "LogicAck"] }]);
  const first = await runGate("ChunkPolicy");
  assert.deepEqual(first.remainingRequiredGates, ["Schema", "LogicAck"]);
  assert.match(first.completionHint, /Schema.*LogicAck.*done_check/);
  assert.doesNotMatch(first.completionHint, /ChunkPolicy/);

  const schema = await runGate("Schema", { body: {}, required: ["title"] });
  assert.equal(schema.passed, false);
  assert.deepEqual(schema.remainingRequiredGates, ["Schema", "LogicAck"]);
  assert.match(schema.completionHint, /未通过.*Schema/);

  const ack = await runGate("LogicAck", { acked: true });
  assert.equal(ack.passed, false);
  assert.deepEqual(ack.remainingRequiredGates, ["Schema", "LogicAck"]);
  assert.match(ack.checks[0].message, /需人工 LogicAck/);
  assert.equal((await runDoneCheck()).details.ok, false);
});
