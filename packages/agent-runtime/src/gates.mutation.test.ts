/**
 * Check your checks：golden 必 pass，mutant 必 fail（或 warn）。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkChunkPolicy } from "./gates.ts";
import {
  checkSceneTriple,
  checkGoldFingerMinimal,
  checkClassicNarrative,
  checkCoreHookComplete,
  checkRedlineHard,
  checkFormatContract,
  checkDialogueLen,
  checkTragedyBudget,
  checkShowDontTell,
  checkPuzzleShell,
} from "./gates.extended.ts";

function assertFail(check: { result: string }, label: string) {
  assert.equal(check.result, "fail", label);
}

function assertPass(check: { result: string }, label: string) {
  assert.equal(check.result, "pass", label);
}

describe("gate mutation testing", () => {
  it("SceneTriple: golden pass / mutant fail", () => {
    assertPass(
      checkSceneTriple({ goal: "救妻", conflict: "反派阻挠", turn: "反杀" }),
      "golden",
    );
    assertFail(checkSceneTriple({ goal: "救妻" }), "mutant missing conflict/turn");
  });

  it("ChunkPolicy: wholeBook mutant fails", () => {
    assertPass(checkChunkPolicy({ requestedChars: 1000 }), "golden");
    assertFail(checkChunkPolicy({ wholeBook: true }), "mutant wholeBook");
  });

  it("GoldFingerMinimal: long rule reports its measured size", () => {
    assertPass(checkGoldFingerMinimal({ goldFinger: "限次透视一天一次" }), "golden");
    assert.equal(checkGoldFingerMinimal({ goldFinger: "x".repeat(300) }).result, "warn");
  });

  it("ClassicNarrative: multi-lead mutant fails", () => {
    assertPass(checkClassicNarrative({ leadCount: 1 }), "golden");
    assertFail(checkClassicNarrative({ leadCount: 2 }), "mutant multi");
  });

  it("CoreHookComplete: missing field mutant fails", () => {
    assertPass(
      checkCoreHookComplete({
        world: "末世",
        identity: "弃子掌局",
        goldFinger: "限次",
        hook: "揭身份",
      }),
      "golden",
    );
    assertFail(checkCoreHookComplete({ world: "末世" }), "mutant incomplete");
  });

  it("RedlineHard: prohibitive quotation prompts contextual review", () => {
    assertPass(checkRedlineHard("正常商业复仇剧情"), "golden");
    assert.equal(checkRedlineHard("未成年相关色情内容禁止").result, "warn");
  });

  it("FormatContract: novelish mutant fails", () => {
    assertPass(checkFormatContract("分镜1：画面\n台词：走", "manju"), "golden");
    const novel =
      "他心中暗想着往事。" +
      "不禁想到命运弄人。" +
      "宛如昨日重现。" +
      "涌上心头的情绪。" +
      "这是一段很长的纯小说叙述，只是不断铺陈心理活动与环境描写，完全不像可拍脚本。".repeat(6);
    assert.ok(novel.length > 200);
    assertFail(checkFormatContract(novel, "manju"), "mutant novel");
  });

  it("DialogueLen: oversize mutant fails", () => {
    assertPass(checkDialogueLen("短台词"), "golden");
    assertFail(checkDialogueLen("字".repeat(600), 500), "mutant long");
  });

  it("TragedyBudget / ShowDontTell mutants warn or fail", () => {
    const t = checkTragedyBudget({ tragedyRatio: 0.9 });
    assert.ok(t.result === "warn" || t.result === "fail", "tragedy mutant");
    const s = checkShowDontTell("他很愤怒。她很伤心。气氛很紧张。终于明白了。");
    assert.ok(s.result === "warn" || s.result === "fail", "tell mutant");
  });

  it("PuzzleShell mutant fails without reason", () => {
    assertPass(checkPuzzleShell({ shell: "升级" }), "non-puzzle");
    assertFail(checkPuzzleShell({ shell: "谜题", puzzleReason: "短" }), "mutant");
  });
});
