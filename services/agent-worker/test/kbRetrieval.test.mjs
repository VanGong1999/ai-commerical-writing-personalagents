import assert from "node:assert/strict";
import { test } from "node:test";
import { searchKb } from "../src/kbRetrieval.js";
import { createWritingTools } from "../src/tools.js";
import { api } from "../src/apiClient.js";

const fixtures = {
  async searchKnowledge() { return { hits: [{ id: "method", path: "method.md", summary: "写法" }], mode: "hybrid" }; },
  async searchUploadedKb() { return {
    docs: [{ id: "doc", title: "书稿", storageUri: "inline:SECRET FULL MANUSCRIPT" }],
    matches: [{ docId: "doc", title: "书稿", snippets: [{ locator: "第2章", text: "转折".repeat(1000) }] }],
    tropes: [{ id: "trope", name: "追妻", summary: "失而复得", docId: "doc" }],
  }; },
};

test("legacy search uses only methodology and reports honest local fallback", async () => {
  const result = await searchKb({ searchKnowledge: fixtures.searchKnowledge }, "写法");
  assert.equal(result.sourceScope, "methodology");
  assert.equal(result.hits[0].position, "method.md");
  const fallback = await searchKb({ searchKnowledge: async () => { throw Error("offline"); } }, "写法", {}, () => [{ id: "cached" }]);
  assert.equal(fallback.mode, "local-fallback");
  assert.equal(fallback.errors[0].fallback, "local-index");
});

test("uploaded search exposes bounded snippets with locators and hides storage content", async () => {
  const result = await searchKb({ searchUploadedKb: fixtures.searchUploadedKb }, "转折", { sourceScope: "documents" });
  assert.equal(result.hits[0].docId, "doc");
  assert.equal(result.hits[0].position, "第2章");
  assert.equal(result.hits[0].snippet.length, 600);
  assert.ok(!JSON.stringify(result).includes("SECRET"));
});

test("all interleaves corpora and supports tropes-only and partial failures", async () => {
  const result = await searchKb(fixtures, "转折", { sourceScope: "all", limit: 3 });
  assert.deepEqual(result.hits.map((h) => h.source), ["methodology", "documents", "tropes"]);
  const tropes = await searchKb(fixtures, "追妻", { sourceScope: "tropes" });
  assert.equal(tropes.hits.length, 1);
  assert.equal(tropes.hits[0].source, "tropes");
  const partial = await searchKb({ ...fixtures, searchUploadedKb: async () => { throw Error("offline"); } }, "写法", { sourceScope: "all" });
  assert.equal(partial.hits[0].source, "methodology");
  assert.equal(partial.errors[0].error, "search_unavailable");
});

test("kb_read fetches a bounded uploaded text page and keeps service errors honest", async () => {
  const original = api.getKbDocText;
  try {
    api.getKbDocText = async (id, opts) => {
      assert.equal(id, "doc");
      assert.deepEqual(opts, { offset: 100, limit: 50 });
      return { text: "正文", nextOffset: 150 };
    };
    const tools = createWritingTools({ projectId: "p1", publish() {}, allowlist: ["kb_read"] });
    const read = tools.find((t) => t.name === "kb_read");
    const result = await read.execute("t1", { docId: "doc", sourceScope: "documents", offset: 100, limit: 50 });
    assert.equal(JSON.parse(result.content[0].text).text, "正文");
    api.getKbDocText = async () => { throw Error("503 unavailable"); };
    const unavailable = await read.execute("t2", { docId: "doc", sourceScope: "documents" });
    assert.match(JSON.stringify(unavailable), /503/);
    assert.ok(!JSON.stringify(unavailable).includes("doc_not_found"));
  } finally { api.getKbDocText = original; }
});

test("nested scout can research but receives no implicit core write capabilities", () => {
  const tools = createWritingTools({ projectId: "p1", publish() {}, depth: 1,
    nestedStrictAllowlist: true, allowlist: ["kb_search", "kb_read", "web_search", "artifact_list"] });
  assert.ok(tools.some((t) => t.name === "web_search"));
  assert.ok(!tools.some((t) => t.name === "artifact_create"));
  assert.ok(!tools._callableSet.has("artifact_create"));
  assert.ok(!tools._callableSet.has("bible_write"));
});

test("done_check ignores model artifact counts and unrelated project history", async () => {
  const original = api.listArtifacts;
  try {
    let rows = [{ id: "old", type: "manuscript", createdByRunId: "older-run" }];
    api.listArtifacts = async () => rows;
    const tools = createWritingTools({ projectId: "p1", runId: "current", publish() {},
      doneContract: [{ type: "artifact_count", artifact: "manuscript", min: 1 }] });
    const done = tools.find((t) => t.name === "done_check");
    const failed = await done.execute("done1", { artifactCounts: { manuscript: 999 } });
    assert.equal(failed.details.ok, false);
    rows.push({ id: "new", type: "manuscript", createdByRunId: "current" });
    const passed = await done.execute("done2", { artifactCounts: { manuscript: 0 } });
    assert.equal(passed.details.ok, true);
  } finally { api.listArtifacts = original; }
});

test("web_search preserves disabled status and never substitutes local docs for web evidence", async () => {
  const original = api.webSearch;
  try {
    const tools = createWritingTools({ projectId: "p1", publish() {}, allowlist: ["web_search"] });
    const web = tools.find((t) => t.name === "web_search");
    api.webSearch = async () => ({ web: { enabled: false, source: "disabled", results: [], fetchedAt: "2026-11-19T00:00:00Z" } });
    const disabled = JSON.parse((await web.execute("web1", { query: "今天热榜" })).content[0].text);
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.fetchedAt, "2026-11-19T00:00:00Z");
    api.webSearch = async () => ({ docs: [{ title: "历史文稿" }] });
    const missing = JSON.parse((await web.execute("web2", { query: "最新" })).content[0].text);
    assert.equal(missing.enabled, false);
    assert.deepEqual(missing.results, []);
    assert.ok(!missing.docs);
  } finally { api.webSearch = original; }
});
