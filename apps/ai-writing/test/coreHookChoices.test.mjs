import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";
import { hookReviewSelection } from "../src/features/studio/hookReviewSelection.ts";

// Resolve the workspace domain package the same way as the app.
const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true },
});
const { coreHookRows, routineCoreHookArtifacts, selectedCoreHooks } = await vite
  .ssrLoadModule("/src/lib/coreHookChoices.ts")
  .finally(() => vite.close());

const time = "2026-11-20T00:00:00Z";
const batchId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000099";

function artifact(id, status, bodyJson, version = 2) {
  return {
    id,
    projectId,
    type: "core_hook",
    title: "核心梗",
    status,
    bodyMarkdown: "",
    bodyJson,
    schemaVersion: "1",
    version,
    createdAt: time,
    updatedAt: time,
  };
}

function hook(title) {
  return {
    titleHook: title,
    coreHook: "主角在开箱直播中揭穿造假",
    motivation: "揭穿标签造假",
    openingStructure: "当众开箱",
    crisis: "被指破坏货物",
    tags: ["反转"],
  };
}

test("Studio keeps ten canonical rows and their review references beside five archived copies", () => {
  const items = Array.from({ length: 10 }, (_, index) => hook(`核心梗候选 ${index + 1}`));
  items[9] = {
    ...items[9],
    favorited: true,
    criticReview: {
      ref: `${batchId}#9`,
      sourceVersion: 1,
      runId: "critic-run",
      marketFit: 1,
      innovation: 1,
      motivation: 1,
      opening: 1,
      compliance: 1,
      total: 5,
      rank: 10,
      recommendation: "淘汰",
      reason: "可以继续改写",
    },
  };
  const batch = artifact(batchId, "candidate", { items });
  const archivedCopies = items.slice(0, 5).map((item, index) =>
    artifact(`00000000-0000-4000-8000-00000000001${index}`, "archived", { candidate: item })
  );
  const rows = coreHookRows([...archivedCopies, batch]);

  assert.equal(rows.length, 10);
  assert.deepEqual(rows.map((row) => row.id), [
    `${batchId}#0`, `${batchId}#1`, `${batchId}#2`, `${batchId}#3`, `${batchId}#4`,
    `${batchId}#5`, `${batchId}#6`, `${batchId}#7`, `${batchId}#8`, `${batchId}#9`,
  ]);
  const { reviewRows } = hookReviewSelection(rows, new Set([archivedCopies[0].id, `${batchId}#9`]));
  assert.equal(reviewRows.length, 10);
  const last = reviewRows[9];
  assert.equal(last.itemIndex, 9);
  assert.equal(last.artifact, batch);
  assert.equal(last.artifact.version, 2);
  assert.equal(last.body.titleHook, "核心梗候选 10");
  assert.equal(last.body.criticReview?.ref, `${batchId}#9`);
  assert.equal(last.body.criticReview?.recommendation, "淘汰");
  assert.equal(last.body.favorited, true);
});

test("Studio retains draft and adopted rows while skipping a rejected batch", () => {
  const rejected = artifact(batchId, "rejected", { items: [hook("驳回产物")] });
  const draft = artifact("00000000-0000-4000-8000-000000000002", "draft", {
    candidate: hook("草稿产物"),
  }, 3);
  const adopted = artifact("00000000-0000-4000-8000-000000000003", "adopted", hook("采纳产物"), 4);
  const rows = coreHookRows([rejected, draft, adopted]);
  assert.deepEqual(rows.map(({ id, artifact, body }) => [id, artifact.version, body.titleHook]), [
    [draft.id, 3, "草稿产物"],
    [adopted.id, 4, "采纳产物"],
  ]);
});

test("Studio has no actionable selection after the only checked hook is archived", () => {
  const checked = artifact(batchId, "candidate", { items: [hook("已勾选")] });
  const selected = new Set([`${batchId}#0`]);
  assert.deepEqual(selectedCoreHooks(coreHookRows([checked]), selected).selectedIds, [`${batchId}#0`]);

  const refreshed = coreHookRows([{ ...checked, status: "archived", version: 3 }]);
  assert.deepEqual(selectedCoreHooks(refreshed, selected), { selectedRows: [], selectedIds: [] });
});

test("Studio uses row order for selected generation and check order for draft adoption", () => {
  const rejected = artifact("00000000-0000-4000-8000-000000000004", "rejected", hook("已驳回"));
  const batch = artifact(batchId, "candidate", { items: [hook("第一行"), hook("第二行")] });
  const selected = new Set([rejected.id, `${batchId}#1`, `${batchId}#0`]);

  const { selectedRows, selectedIds } = selectedCoreHooks(coreHookRows([rejected, batch]), selected);
  assert.deepEqual(selectedRows.map((row) => row.body.titleHook), ["第一行", "第二行"]);
  assert.deepEqual(selectedIds, [`${batchId}#1`, `${batchId}#0`]);
});

test("Studio reviews only selected active references when there are over 100 rows", () => {
  const extraId = "00000000-0000-4000-8000-000000000005";
  const archivedId = "00000000-0000-4000-8000-000000000006";
  const batch = artifact(batchId, "candidate", {
    items: Array.from({ length: 100 }, (_, index) => hook(`核心梗候选 ${index + 1}`)),
  }, 3);
  const extra = artifact(extraId, "draft", { items: [hook("追加候选")] }, 5);
  const archived = artifact(archivedId, "archived", { items: [hook("归档候选")] });
  const rows = coreHookRows([batch, archived, extra]);
  const review = hookReviewSelection(rows, new Set([`${archivedId}#0`, `${extraId}#0`, `${batchId}#47`]));

  assert.equal(review.requiresSelection, true);
  assert.equal(review.reviewRangeValid, true);
  assert.deepEqual(review.reviewRows.map(({ id, artifact }) => [id, artifact.id, artifact.version]), [
    [`${batchId}#47`, batchId, 3],
    [`${extraId}#0`, extraId, 5],
  ]);
  assert.equal(hookReviewSelection(rows, new Set([`${archivedId}#0`])).reviewRangeValid, false);
});

test("routines consider draft and candidate hooks in source order", () => {
  const artifacts = ["archived", "rejected", "adopted", "draft", "candidate"].map((status, index) =>
    artifact(`00000000-0000-4000-8000-00000000002${index}`, status, hook(status))
  );
  const otherType = { ...artifacts[3], id: "00000000-0000-4000-8000-000000000030", type: "character" };
  assert.deepEqual(routineCoreHookArtifacts([otherType, ...artifacts]).map((item) => item.id), [
    "00000000-0000-4000-8000-000000000023",
    "00000000-0000-4000-8000-000000000024",
  ]);
});
