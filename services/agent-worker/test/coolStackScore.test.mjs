import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "@sinclair/typebox/value";
import { createWritingTools } from "../src/tools.js";
import { searchCatalog } from "../src/toolCatalog.js";

// Actual beats from topic.cool_point_5 replay d427c79e-655f-4a7f-882b-9603b7f37a7c.
const beats = [
  "货运工被主任与保安合谋诬为偷货，当众被扣工资、被搜身",
  "他掏出可追溯过磅凭证与送检单，逐条对上时间与车号",
  "主任抢单撕单，他早有备份，叫来第三方检测与货主",
  "保安反咬，他调出地磅原始记录，配重造假当场露馅",
  "主任当众交代造假链条，被撤职，货运工拿回清白与赔偿",
];
const name = "cool_stack_score";
const { _allGated } = createWritingTools({
  projectId: "fixture",
  runId: "fixture",
  allowlist: [name],
  publish: () => {},
});
const tool = _allGated.find((entry) => entry.name === name);
const search = _allGated.find((entry) => entry.name === "tool_search");
const result = async (entry, params) => JSON.parse((await entry.execute("fixture", params)).content[0].text);
const score = (params) => result(tool, params);

test("captured natural reversals stay semantically unknown at every observed window", async () => {
  for (const window of [5, 3, 10]) {
    const actual = await score({ beats, window });
    assert.equal(actual.beatCount, 5);
    assert.equal(actual.hits, 0);
    assert.equal(actual.density, 0);
    assert.equal(actual.stacked, false);
    assert.equal(actual.measurement, "keyword_heuristic");
    assert.equal(actual.advisory, true);
    assert.equal(actual.semanticAssessment, "unknown");
    assert.deepEqual(actual.matchedSignals, []);
    assert.equal(actual.nextAction.code, "review_story_and_deliver");
    assert.equal(actual.nextAction.rescoreRequiresNewStoryEvidence, true);
  }
});

test("literal signal evidence counts matching beats and only the advisory flag depends on window", async () => {
  const beats = ["他没有打脸，也没有反杀", "这是个反杀标签", "画面切走"];
  for (const [window, stacked] of [[3, true], [4, false]]) {
    const actual = await score({ beats, window });
    assert.equal(actual.hits, 2);
    assert.equal(actual.density, 0.67);
    assert.equal(actual.stacked, stacked);
    assert.equal(Boolean(actual.warn), stacked);
    assert.equal(actual.semanticAssessment, "unknown");
    assert.deepEqual(actual.matchedSignals, [
      { signal: "打脸", beatCount: 1 },
      { signal: "反杀", beatCount: 2 },
    ]);
  }
});

test("empty input has no evidence and does not prompt a score retry", async () => {
  const actual = await score({ beats: [] });
  assert.equal(actual.status, "empty_input");
  assert.equal(actual.beatCount, 0);
  assert.equal(actual.hits, 0);
  assert.equal(actual.density, 0);
  assert.equal(actual.stacked, false);
  assert.equal(actual.semanticAssessment, "unknown");
  assert.equal(actual.nextAction.code, "review_story_and_deliver");
});

test("schema and direct execution both reject invalid windows", async () => {
  for (const window of [0, -1, 1.5, "5", null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const params = { beats, window };
    assert.equal(Value.Check(tool.parameters, params), false, String(window));
    const actual = await score(params);
    assert.equal(actual.error.code, "invalid_window");
    assert.equal(actual.hits, undefined);
  }
  for (const params of [{ beats }, { beats, window: 1 }, { beats, window: Number.MAX_SAFE_INTEGER }]) {
    assert.equal(Value.Check(tool.parameters, params), true);
    assert.equal((await score(params)).window, params.window ?? 5);
  }
});

test("score discovery and runtime expose the same registered description", async () => {
  const entry = searchCatalog(name)[0];
  assert.equal(entry.name, name);
  assert.ok(entry.description);
  assert.equal(entry.description, tool.description);
  assert.equal((await result(search, { query: name })).tools[0].description, entry.description);
});
