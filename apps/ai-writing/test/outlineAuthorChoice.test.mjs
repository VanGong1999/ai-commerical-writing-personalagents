import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const vite = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: false,
  server: { middlewareMode: true, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true },
  esbuild: { jsx: "automatic" },
});
const {
  createOutlineTextDraft,
  deliverableCompletion,
  OutlineDualView,
  OutlineStoredVersion,
  outlineTextUpdates,
  rebaseOutlineTextRow,
  saveOutlineTextDraft,
} = await vite
  .ssrLoadModule("/src/features/studio/deliverables.tsx")
  .finally(() => vite.close());

function outline(episodeNo, body = {}, artifact = {}) {
  return {
    id: `outline-${episodeNo}`,
    projectId: "project",
    type: "episode_outline",
    title: `第${episodeNo}集大纲`,
    status: "draft",
    bodyMarkdown: "",
    bodyJson: {
      episodeNo,
      title: "查验货单",
      summary: "主人公公开对照两份货单。",
      beats: ["接过货单", "指出批号不符"],
      hookAtEnd: true,
      paywallPoint: "指出批号不符",
      ...body,
    },
    version: 3,
    schemaVersion: "1",
    createdAt: "2026-11-20T00:00:00Z",
    updatedAt: "2026-11-20T00:00:00Z",
    ...artifact,
  };
}

for (const format of ["manju", "duanju"]) {
  test(`${format} readiness counts complete episodes with either boolean hook value`, () => {
    for (const hookAtEnd of [false, true]) {
      const episodes = Array.from({ length: 10 }, (_, index) =>
        outline(index + 1, { hookAtEnd }),
      );
      const duplicate = { ...episodes[0], id: "another-source-for-episode-1" };
      const result = deliverableCompletion(format, [...episodes, duplicate]);
      assert.equal(result.outlineReadyCount, 10, `hookAtEnd=${hookAtEnd}`);
      assert.equal(result.outlineTarget, 10);
      assert.equal(result.done.outline, true);
    }
  });

  test(`${format} readiness follows the schema default and accepts Markdown summaries`, () => {
    const missingHook = outline(1);
    delete missingHook.bodyJson.hookAtEnd;
    const markdownOnly = outline(
      2,
      { summary: undefined },
      { bodyMarkdown: "守夜人核对巡逻记录。" },
    );
    const blankSummary = outline(
      3,
      { summary: " " },
      { bodyMarkdown: "会计交出盖章副本。" },
    );
    assert.equal(
      deliverableCompletion(format, [missingHook, markdownOnly, blankSummary]).outlineReadyCount,
      3,
    );
  });

  test(`${format} readiness rejects incomplete or malformed episode structure`, () => {
    const incomplete = [
      ["missing summary", { summary: undefined }],
      ["blank summary", { summary: " " }],
      ["missing beats", { beats: undefined }],
      ["empty beats", { beats: [] }],
      ["blank beats with a false hook", { beats: [" "], hookAtEnd: false }],
      ["missing paywall or cliff content", { paywallPoint: undefined }],
      ["string hook", { hookAtEnd: "false" }],
      ["null hook", { hookAtEnd: null }],
      ["non-array beats", { beats: "查验批号" }],
      ["non-string beat", { beats: [1] }],
      ["non-string summary", { summary: 42 }],
      ["non-string paywall", { paywallPoint: true }],
      ["missing episode number", { episodeNo: undefined }],
      ["missing title", { title: undefined }],
    ];
    for (const [reason, body] of incomplete) {
      assert.equal(deliverableCompletion(format, [outline(1, body)]).outlineReadyCount, 0, reason);
    }
  });
}

test("non-episodic formats still count chapter and Markdown outlines", () => {
  for (const format of ["short_novel", "male_long", "female_long", "ip_adapt"]) {
    const chapter = outline(1, {}, {
      type: "chapter_outline",
      bodyJson: null,
      bodyMarkdown: "主人公走访仓库。",
    });
    const legacyEpisode = outline(2, { beats: [], hookAtEnd: undefined, paywallPoint: undefined });
    const result = deliverableCompletion(format, [chapter, legacyEpisode]);
    assert.equal(result.outlineReadyCount, 2, format);
    assert.equal(result.outlineTarget, 1);
    assert.equal(result.done.outline, true);
  }
});

test("the primary outline table warns about false hooks and names author choice", () => {
  const missingHook = outline(3);
  delete missingHook.bodyJson.hookAtEnd;
  const panel = createElement(OutlineDualView, {
    artifacts: [outline(1, { hookAtEnd: false }), outline(2), missingHook],
  });
  const html = renderToStaticMarkup(
    createElement(QueryClientProvider, { client: new QueryClient() }, panel),
  );
  assert.match(html, /class="badge badge-warn">无<\/span>/);
  assert.match(html, /class="badge badge-ok">有<\/span>/);
  assert.match(html, /class="badge badge-warn">未标<\/span>/);
  assert.match(html, /集尾钩子供参考.*作者决定/);
});

test("the primary outline table safely displays valid rows beside malformed rows", () => {
  const panel = createElement(OutlineDualView, {
    artifacts: [
      outline(1),
      outline(2, { beats: "坏的情节点", summary: { text: "坏的摘要" } }),
      outline(3, {}, { bodyJson: null, bodyMarkdown: "仅有原稿文字。" }),
    ],
  });
  const html = renderToStaticMarkup(
    createElement(QueryClientProvider, { client: new QueryClient() }, panel),
  );
  assert.match(html, /主人公公开对照两份货单。/);
  assert.match(html, /仅有原稿文字。/);
});

const revisedText = `第1集 查验货单
摘要：会计当众公布两份货单的差异。
情节点：接过货单、指出批号不符
爽点：当面澄清误会
卡点：两人核对完清单后各自下班
`;

test("editing a summary preserves the existing hook decision and author metadata", () => {
  for (const hookAtEnd of [false, true]) {
    const episode = outline(1, {
      hookAtEnd,
      trap: "两人核对完清单后各自下班",
      thrill: "当面澄清误会",
      humanVerdict: "accept",
      cliffText: "核对结束后散场",
      authorMetadata: { source: "作者自定" },
    });
    const [{ patch }] = outlineTextUpdates({
      ...createOutlineTextDraft([episode]),
      text: revisedText,
    });
    assert.equal(patch.bodyJson.hookAtEnd, hookAtEnd);
    assert.deepEqual(patch.bodyJson, {
      ...episode.bodyJson,
      summary: "会计当众公布两份货单的差异。",
      revisedAt: patch.bodyJson.revisedAt,
    });
    assert.equal(patch.bodyMarkdown, revisedText.trim());
    assert.equal(episode.bodyJson.summary, "主人公公开对照两份货单。");
  }
});

test("the text save patch carries the source version without fabricating an unmarked hook", () => {
  const episode = outline(1, {}, { version: 7 });
  delete episode.bodyJson.hookAtEnd;
  const [update, ...other] = outlineTextUpdates({
    ...createOutlineTextDraft([episode, outline(2)]),
    text: revisedText,
  });
  assert.deepEqual(other, []);
  assert.equal(update.artifactId, "outline-1");
  assert.equal(Object.hasOwn(update.patch.bodyJson, "hookAtEnd"), false);
  assert.equal(update.patch.expectedVersion, 7);
});

const headedMarkdown = "## 原稿\n\n第1集 原稿里的标题\n情节点：原稿里的不同情节点\n\n末尾原文。\n";

test("the comparison shows a JSON-only update alongside the independently stored Markdown", () => {
  const initial = outline(1, { trap: "第一版卡点" }, { version: 1, bodyMarkdown: headedMarkdown });
  const current = {
    ...initial,
    version: 2,
    bodyJson: { ...initial.bodyJson, trap: "第二版卡点", beats: ["第二版新增情节点"] },
  };
  const [row] = createOutlineTextDraft([current]).rows;
  const html = renderToStaticMarkup(createElement(OutlineStoredVersion, { row }));
  assert.match(html, /卡点：第二版卡点/);
  assert.match(html, /情节点：第二版新增情节点/);
  assert.ok(html.includes(headedMarkdown), "all independently stored Markdown stays visible");
});

test("editing another episode keeps the opaque headed fallback out of the save patches", () => {
  const first = outline(1, { summary: undefined, hookAtEnd: false, authorMetadata: { source: "原稿" } }, {
    bodyMarkdown: headedMarkdown,
  });
  const second = outline(2);
  const draft = createOutlineTextDraft([first, second]);
  const updates = outlineTextUpdates({
    ...draft,
    text: draft.text.replace("主人公公开对照两份货单。", "只修改第二集摘要。"),
  });
  assert.deepEqual(updates.map((update) => update.artifactId), [second.id]);
  assert.equal(updates[0].patch.bodyJson.summary, "只修改第二集摘要。");
  assert.equal(first.bodyMarkdown, headedMarkdown);
  assert.deepEqual(first.bodyJson.authorMetadata, { source: "原稿" });
  assert.ok(!draft.text.includes("原稿里的标题"));
});

test("editing an episode that uses an opaque fallback keeps the full original Markdown", async () => {
  const episode = outline(1, { summary: undefined }, { bodyMarkdown: headedMarkdown });
  const draft = createOutlineTextDraft([episode]);
  const edited = {
    ...draft,
    text: draft.text.replace("接过货单", "展开旧账簿"),
  };
  const result = await saveOutlineTextDraft(edited, async (id, patch) => {
    assert.equal(id, episode.id);
    assert.equal(patch.bodyMarkdown, headedMarkdown);
    assert.equal(patch.bodyJson.summary, undefined);
    assert.deepEqual(patch.bodyJson.beats, ["展开旧账簿", "指出批号不符"]);
    return { ...episode, ...patch, version: 4 };
  });
  assert.deepEqual([...result.saved.keys()], [episode.id]);
  assert.deepEqual(outlineTextUpdates(result.draft), []);
});

test("numeric-string legacy episode numbers display and save without weakening readiness", () => {
  const episode = outline(4, { episodeNo: "04", hookAtEnd: false });
  const panel = createElement(OutlineDualView, { artifacts: [episode] });
  const html = renderToStaticMarkup(
    createElement(QueryClientProvider, { client: new QueryClient() }, panel),
  );
  assert.match(html, /<td>4<\/td>/);
  const draft = createOutlineTextDraft([episode]);
  const [{ patch }] = outlineTextUpdates({
    ...draft,
    text: draft.text.replace("主人公公开对照两份货单。", "只修改第四集摘要。"),
  });
  assert.equal(patch.bodyJson.episodeNo, "04");
  assert.equal(patch.bodyJson.hookAtEnd, false);
  assert.equal(deliverableCompletion("manju", [episode]).outlineReadyCount, 0);
});

test("generated drafts round-trip quoted headings, field labels and beat punctuation", () => {
  const summary = "他念出了旧册里的标题：\n第2集 旧题\n情节点：原文情节点";
  const beats = ["判断甲、乙两处相同", "跨行引文\n第1集 旧题"];
  const first = outline(1, { summary, beats, trap: "原来的卡点" });
  const second = outline(2);
  const draft = createOutlineTextDraft([first, second]);
  assert.deepEqual(outlineTextUpdates(draft), []);
  const secondOnly = outlineTextUpdates({
    ...draft,
    text: draft.text.replace("主人公公开对照两份货单。", "修改第二集的摘要。"),
  });
  assert.deepEqual(secondOnly.map((update) => update.artifactId), [second.id]);
  const [{ patch }] = outlineTextUpdates({
    ...draft,
    text: draft.text.replace("原来的卡点", "调整后的卡点"),
  });
  assert.equal(patch.bodyJson.summary, summary);
  assert.deepEqual(patch.bodyJson.beats, beats);
  assert.equal(patch.bodyJson.trap, "调整后的卡点");
});

test("duplicate editable headings cannot silently choose a block to save", () => {
  const draft = createOutlineTextDraft([outline(1), outline(2)]);
  assert.equal(
    outlineTextUpdates({ ...draft, text: draft.text + "\n\n" + revisedText }),
    null,
  );
});

test("ambiguous stored episode numbers do not block edits to unique episodes", () => {
  const duplicate = outline(1, { episodeNo: "01", title: "同集另一份大纲" }, { id: "other-outline-1" });
  const third = outline(3);
  const draft = createOutlineTextDraft([outline(1), duplicate, third]);
  assert.equal(draft.rows.length, 3);
  assert.ok(!draft.text.includes("第1集"));
  const edited = { ...draft, text: draft.text.replace("主人公公开对照两份货单。", "只修改第三集。") };
  const updates = outlineTextUpdates(edited);
  assert.deepEqual(updates.map((update) => update.artifactId), [third.id]);
  assert.equal(outlineTextUpdates({ ...edited, text: edited.text + "\n\n" + revisedText }), null);
});

function conflict() {
  return new Error('{"detail":{"code":"version_conflict","currentVersion":2}}');
}

test("a Markdown-only refresh does not advance the captured version of an edited draft", async () => {
  const initial = outline(1, { hookAtEnd: false }, { version: 1, bodyMarkdown: "原稿" });
  const draft = { ...createOutlineTextDraft([initial]), text: revisedText };
  const remote = { ...initial, version: 2, bodyMarkdown: "另一个作者通过原稿编辑器保存的内容" };
  const refreshed = createOutlineTextDraft([remote]);
  assert.equal(refreshed.text, createOutlineTextDraft([initial]).text);
  const result = await saveOutlineTextDraft(draft, async (id, patch) => {
    assert.equal(id, initial.id);
    assert.equal(patch.expectedVersion, 1);
    assert.equal(patch.bodyJson.hookAtEnd, false);
    throw conflict();
  });
  assert.deepEqual(result.conflicts, [1]);
  assert.equal(result.draft.text, revisedText);
  assert.equal(result.draft.rows[0].artifact.version, 1);
  assert.equal(refreshed.rows[0].artifact.bodyMarkdown, "另一个作者通过原稿编辑器保存的内容");
});

test("a mixed save retains the conflict and skips the committed episode on retry", async () => {
  const first = outline(1, { hookAtEnd: false }, { version: 1 });
  const second = outline(2, { hookAtEnd: true }, { version: 1 });
  const draft = {
    ...createOutlineTextDraft([first, second]),
    text: revisedText.trim() + "\n\n" + revisedText.trim().replace("第1集", "第2集"),
  };
  const slowWrite = Promise.withResolvers();
  let finished = false;
  const pending = saveOutlineTextDraft(draft, async (id, patch) => {
    if (id === first.id) throw conflict();
    await slowWrite.promise;
    return { ...second, ...patch, version: 2 };
  }).then((result) => {
    finished = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  slowWrite.resolve();
  const partial = await pending;
  assert.deepEqual(partial.conflicts, [1]);
  assert.deepEqual(partial.failed, []);
  assert.deepEqual([...partial.saved.keys()], [second.id]);
  assert.deepEqual(partial.draft.rows.map((row) => row.artifact.version), [1, 2]);
  assert.equal(partial.draft.text, draft.text);
  assert.deepEqual(
    outlineTextUpdates(partial.draft).map(({ artifactId, patch }) => [artifactId, patch.expectedVersion]),
    [[first.id, 1]],
  );

  const latest = outline(1, { hookAtEnd: false, authorMetadata: { source: "新元数据" } }, {
    version: 2,
    bodyMarkdown: "保留作者原稿供对照",
  });
  const rebased = rebaseOutlineTextRow(partial.draft, createOutlineTextDraft([latest]).rows[0]);
  assert.equal(rebased.text, draft.text);
  const saved = await saveOutlineTextDraft(rebased, async (id, patch) => {
    assert.equal(id, first.id);
    assert.equal(patch.expectedVersion, 2);
    assert.equal(patch.bodyJson.hookAtEnd, false);
    assert.deepEqual(patch.bodyJson.authorMetadata, { source: "新元数据" });
    return { ...latest, ...patch, version: 3 };
  });
  assert.deepEqual([...saved.saved.keys()], [first.id]);
  assert.deepEqual(saved.conflicts, []);
  assert.deepEqual(outlineTextUpdates(saved.draft), []);
});
