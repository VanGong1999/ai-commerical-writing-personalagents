import assert from "node:assert/strict";
import { test } from "node:test";
import { planAction } from "./actions.ts";
import { formatBindingsSummary } from "./format-bindings.ts";
import { fnSearchAround, fnWithGeneratedMermaid } from "./functions.ts";
import { isCutoverBlockedArtifactWrite, materializeObject } from "./materialize.ts";
import { makeRid, parseRid } from "./rid.ts";
import { createScenario, mergeScenarioPatches } from "./scenarios.ts";
import { OBJECT_TYPES, ACTION_TYPES, LINK_TYPES, INTERFACES } from "./catalog.ts";

test("rid roundtrip", () => {
  const rid = makeRid("CoreHook");
  const parsed = parseRid(rid);
  assert.equal(parsed?.typeApiName, "CoreHook");
});

test("catalog completeness floors", () => {
  assert.ok(OBJECT_TYPES.length >= 40);
  assert.ok(ACTION_TYPES.length >= 30);
  assert.ok(LINK_TYPES.length >= 15);
  assert.ok(INTERFACES.length >= 5);
});

test("six formats bound", () => {
  const summary = formatBindingsSummary();
  assert.equal(summary.length, 6);
  for (const row of summary) {
    assert.ok(row.objectTypeCount >= 8, row.format);
    assert.ok(row.actionTypeCount >= 5, row.format);
  }
});

test("plan AdoptObject", () => {
  const rid = makeRid("CoreHook");
  const res = planAction({
    actionApiName: "AdoptObject",
    projectId: "p1",
    actor: "user",
    parameters: { rid, mode: "strong" },
  });
  assert.equal(res.ok, true);
  assert.equal(res.edits[0]?.op, "update");
});

test("materialize story graph mermaid", () => {
  const m = materializeObject({
    typeApiName: "StoryGraph",
    properties: {
      nodes: [{ id: "c1", kind: "character", label: "林川" }],
      edges: [],
    },
  });
  assert.equal(m.artifactType, "story_graph");
  assert.match(m.bodyJson.mermaid as string, /flowchart/);
});

test("cutover blocks mapped artifact types", () => {
  assert.equal(isCutoverBlockedArtifactWrite("core_hook", false), true);
  assert.equal(isCutoverBlockedArtifactWrite("core_hook", true), false);
  assert.equal(isCutoverBlockedArtifactWrite("other", false), false);
});

test("searchAround", () => {
  const a = makeRid("StoryNode", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  const b = makeRid("StoryNode", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
  const hits = fnSearchAround([{ fromRid: a, toRid: b, linkType: "causes" }], a, { depth: 1 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rid, b);
});

test("scenario fork merge", () => {
  const rid = makeRid("CoreHook");
  const sc = createScenario({
    projectId: "p1",
    label: "结局A",
    objects: [{ rid, projectId: "p1", version: 1, status: "candidate", properties: { title: "v1" } }],
  });
  sc.forkedProperties[rid] = { title: "v2" };
  const patches = mergeScenarioPatches(sc, [{rid, projectId: "p1", version: 1, status: "candidate", properties: {title: "v1"}}]);
  assert.equal(patches[0].properties.title, "v2");
});

test("withGeneratedMermaid via fn", () => {
  const g = fnWithGeneratedMermaid({
    kind: "story_graph",
    schemaVersion: "story-graph/1",
    nodes: [],
    edges: [],
    characterStates: [],
    openQuestions: [],
    contradictions: [],
    mermaid: "",
  });
  assert.match(g.mermaid, /flowchart/);
});

test('scenario rejects stale primary and cross-project current objects', () => {
  const rid = makeRid('CoreHook');
  const object = { rid, projectId: 'p1', version: 1, status: 'candidate', properties: { title: 'first' } };
  const scenario = createScenario({projectId: 'p1', label: 'branch', objects: [object]});
  assert.throws(() => mergeScenarioPatches(scenario, [{...object, version: 2, properties: {title: 'primary'}}]), /scenario_conflict/);
  assert.throws(() => mergeScenarioPatches(scenario, [{...object, projectId: 'p2'}]), /project_boundary/);
});

test('content hashes ignore property insertion order recursively', async () => {
  const { contentHash } = await import('./hash.ts');
  assert.equal(contentHash({z: [{b: 1, a: 2}], a: true}), contentHash({a: true, z: [{a: 2, b: 1}]}));
});
