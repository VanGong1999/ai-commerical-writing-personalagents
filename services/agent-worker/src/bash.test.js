import test from "node:test";
import assert from "node:assert/strict";
import { isBashAllowed } from "./bash.js";

test("bash whitelist", () => {
  assert.equal(isBashAllowed("ls -la"), true);
  assert.equal(isBashAllowed("cat foo.md"), true);
  assert.equal(isBashAllowed("git status"), true);
  assert.equal(isBashAllowed("git diff"), true);
  assert.equal(isBashAllowed("rm -rf /"), false);
  assert.equal(isBashAllowed("curl http://x"), false);
  assert.equal(isBashAllowed("python3 script.py"), true);
});
