import assert from "node:assert/strict";
import test from "node:test";
import { createWritingTools } from "../src/tools.js";

for (const name of ["speak_aloud_lint", "speak_aloud_hint", "regex_redline"]) {
  test(name + " returns contextual evidence without tool errors", async () => {
    const tools = createWritingTools({projectId: "fixture", runId: "fixture", allowlist: [name], publish() {}});
    const tool = tools._allGated.find(entry => entry.name === name);
    for (const scene of ["妈", "爸", "姐"]) {
      const params = name === "regex_redline" ? {text: "班主任：避免美化自残。"} : {lines: [scene + "，门锁了，灯关了，药放好了，我走了。"]};
      const result = JSON.parse((await tool.execute(scene, params)).content[0].text);
      assert.equal(result.ok, true);
      if (name === "regex_redline") assert.equal(result.assessment, "pending_context_review");
      else assert.equal(result.issues[0].at, 0);
    }
    if (name !== "regex_redline") assert.equal(JSON.parse((await tool.execute("invalid", {lines: [42]})).content[0].text).ok, false);
  });
}
