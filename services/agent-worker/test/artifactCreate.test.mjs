import assert from "node:assert/strict";
import { test } from "node:test";

import { buildArtifactPayload } from "../src/tools.js";

test("artifact payload 携带 createdByRunId", () => {
  const p = buildArtifactPayload({ runId: "r1", type: "core_hook", title: "t", bodyMarkdown: "x" });
  assert.equal(p.createdByRunId, "r1");
});

test("artifact payload 保留其余字段并按契约返回完整形态", () => {
  const p = buildArtifactPayload({
    runId: "r1",
    type: "manuscript",
    title: "第 1 集",
    bodyMarkdown: "正文",
    bodyJson: { episodeNo: 1 },
    status: "candidate",
  });
  assert.deepEqual(p, {
    type: "manuscript",
    title: "第 1 集",
    bodyMarkdown: "正文",
    bodyJson: { episodeNo: 1 },
    status: "candidate",
    createdByRunId: "r1",
  });
});
