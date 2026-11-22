import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "..", "src", "nestedEntry.js");

describe("nestedEntry", () => {
  it("exits 2 when NESTED_AGENT_SPEC is missing", () => {
    const r = spawnSync(process.execPath, [ENTRY], {
      env: { ...process.env, NESTED_AGENT_SPEC: "" },
    });
    assert.equal(r.status, 2);
    assert.match(String(r.stderr), /missing NESTED_AGENT_SPEC/);
  });
});
