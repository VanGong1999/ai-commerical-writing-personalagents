import assert from "node:assert/strict";
import { test } from "node:test";
import { allPassed, checkLengthBand, checkLengthDecay } from "./gates.ts";

test("LengthBand counts Unicode codepoints and trims surrounding whitespace", () => {
  const check = checkLengthBand(`  ${"😀".repeat(100)}  `, 100, 100);
  assert.equal(check.result, "pass");
  assert.equal(check.message, "字数 100 合规");
});

test("LengthBand preserves inclusive soft boundaries for emoji and BMP text", () => {
  for (const char of ["😀", "字"]) {
    for (const [count, result] of [[74, "fail"], [75, "pass"], [100, "pass"], [125, "pass"], [126, "fail"]] as const) {
      assert.equal(checkLengthBand(char.repeat(count), 100, 100).result, result, `${char}: ${count}`);
    }
  }
});

test("LengthDecay reports relative decline separately from the measured minimum", () => {
  const warning = checkLengthDecay({ lengths: [1200, 800], minChars: 800 });
  assert.equal(warning.result, "warn");
  assert.equal(allPassed([warning]), true);
  assert.match(warning.message, /1200.*800.*70%/);
  assert.equal(checkLengthDecay({ lengths: [1200, 799] }).result, "fail");
  assert.equal(checkLengthDecay({ currentChars: 850, minChars: 900 }).result, "fail");
  assert.equal(checkLengthDecay({ prevChars: 1200 }).result, "inconclusive");
  assert.equal(checkLengthDecay({ lengths: [1200, 800], ratio: 0.6 }).result, "pass");
});

test("LengthDecay accepts a single measured count above the minimum", () => {
  assert.equal(checkLengthDecay({ lengths: [1070], minChars: 800 }).result, "pass");
});

test("LengthDecay rejects a single measured count below the minimum", () => {
  assert.equal(checkLengthDecay({ lengths: [799], minChars: 800 }).result, "fail");
});

test("LengthDecay stays inconclusive with an empty history and no current count", () => {
  assert.equal(checkLengthDecay({ lengths: [], minChars: 800 }).result, "inconclusive");
});

test("LengthDecay truncates fractional current counts before ratio checks", () => {
  const warning = checkLengthDecay({ currentChars: 899.9, prevChars: 1285 });
  assert.equal(warning.result, "warn");
  assert.match(warning.message, /1285.*899（/);
  assert.deepEqual(checkLengthDecay({ lengths: [1285, 899.9] }), warning);
  assert.equal(checkLengthDecay({ currentChars: 900, prevChars: 1285 }).result, "pass");
});
