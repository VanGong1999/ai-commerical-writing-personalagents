import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/** 静态校验：避免依赖 domain 包在 strip-types 下的 ESM 解析问题 */
const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");

test("manju pack templates present in source", () => {
  for (const id of [
    "manju.hook.batch",
    "manju.bio",
    "manju.ep10.outline",
    "manju.bible_guard",
    "manju.episode_body",
    "manju.length_decay_fix",
    "manju.storyboard",
    "manju.deai",
    "manju.extend",
    "manju.pitch_pack",
  ]) {
    assert.match(SRC, new RegExp(`id: "${id}"`));
  }
  assert.match(SRC, /pack\.manju\.default/);
  assert.match(SRC, /manju\.storyboard/);
  assert.match(SRC, /manju\.pitch_pack/);
  assert.match(SRC, /S3_BIO/);
  assert.match(SRC, /S5_EP_BODY_BATCH/);
  assert.match(SRC, /S11_PITCH/);
});

test("duanju pack no longer empty", () => {
  assert.match(SRC, /id: "pack\.duanju\.default"/);
  assert.match(SRC, /duanju\.want_how/);
  assert.match(SRC, /duanju\.beat20/);
  assert.match(SRC, /duanju\.ep10\.outline/);
  assert.match(SRC, /duanju\.scene_triple/);
  assert.match(SRC, /duanju\.revise20/);
  assert.match(SRC, /duanju\.redline/);
  // templateIds 数组非空：出现 want_how / ep10 引用
  const packBlock = SRC.slice(SRC.indexOf('id: "pack.duanju.default"'));
  assert.match(packBlock, /duanju\.want_how/);
  assert.match(packBlock, /duanju\.ep10\.outline/);
  assert.doesNotMatch(packBlock.slice(0, 400), /templateIds:\s*\[\s*\]/);
  assert.match(SRC, /struct\.ep_outline_duanju/);
});

test("short ip female male packs present", () => {
  assert.match(SRC, /pack\.short\.default/);
  assert.match(SRC, /short\.opening/);
  assert.match(SRC, /short\.swap/);
  assert.match(SRC, /pack\.ip\.default/);
  assert.match(SRC, /ip\.select/);
  assert.match(SRC, /ip\.unit/);
  assert.match(SRC, /ip\.emotion/);
  assert.match(SRC, /ip\.rebuild/);
  assert.match(SRC, /pack\.female\.default/);
  assert.match(SRC, /female\.pace/);
  assert.match(SRC, /female\.tension/);
  assert.match(SRC, /female\.risk/);
  assert.match(SRC, /pack\.male\.default/);
  assert.match(SRC, /male\.upgrade/);
  assert.match(SRC, /male\.cool/);
});

test("served catalog keeps a valid lock for each canonical prompt", () => {
  const { prompts, packs } = JSON.parse(readFileSync(new URL("../catalog.json", import.meta.url), "utf8"));
  const ids = new Set(prompts.map((prompt: { id: string }) => prompt.id));
  assert.equal(ids.size, prompts.length);
  assert.deepEqual(ids, new Set(packs.flatMap((pack: { templateIds: string[] }) => pack.templateIds)));
  for (const { id, lockedSystem, lockedHash, editableInstruction, requiredPhrases } of prompts) {
    const calculatedHash = createHash("sha256").update(lockedSystem).digest("hex").slice(0, 12);
    assert.equal(lockedHash, `h${calculatedHash}`, id);
    for (const phrase of requiredPhrases) assert.ok(editableInstruction.includes(phrase), `${id}: ${phrase}`);
  }
});

test("all prompt ids have lockedHash nearby", () => {
  const ids = [...SRC.matchAll(/id: "(manju|duanju)\.[^"]+"/g)].map((m) => m[0]);
  assert.ok(ids.length >= 10, `expected >=10 prompt ids, got ${ids.length}`);
  assert.match(SRC, /lockedHash:/);
  assert.match(SRC, /requiredPhrases:/);
});
