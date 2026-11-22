import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILE = join(HERE, "..", "src", "..", "sandbox-agent-worker.sb");

describe("os sandbox profile", () => {
  it("ships a deny-default profile with a repo-root placeholder", () => {
    assert.ok(existsSync(PROFILE), "sandbox profile should exist");
    const raw = readFileSync(PROFILE, "utf8");
    assert.match(raw, /\(deny default\)/);
    assert.match(raw, /__REPO_ROOT__/);
  });
});
