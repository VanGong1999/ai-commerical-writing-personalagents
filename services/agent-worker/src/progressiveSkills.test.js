/**
 * progressiveSkills + tool_search 冒烟（不调 LLM）。
 * 运行：cd services/agent-worker && node --test src/progressiveSkills.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("progressiveSkills source contract", () => {
  it("runSession builds system without dumping skill.body when progressive", () => {
    const src = readFileSync(join(HERE, "runSession.js"), "utf8");
    assert.match(src, /buildAgentSystemSlots/);
    assert.match(src, /progressiveSkills/);
    assert.match(src, /formatSkillCatalogForPrompt/);
    assert.match(src, /COST_LADDER/);
    // 默认路径不应再直接 `${skill.body}` 拼进 openai system
    assert.doesNotMatch(src, /content: `\$\{skill\.body\}/);
  });

  it("tools.js exposes discovery tools", () => {
    const src = readFileSync(join(HERE, "tools.js"), "utf8");
    assert.match(src, /name: "tool_search"/);
    assert.match(src, /name: "tool_schema_get"/);
    assert.match(src, /name: "tool_invoke"/);
    assert.match(src, /name: "memory_search"/);
    assert.match(src, /name: "memory_get"/);
    assert.match(src, /_allToolsCatalog/);
  });

  it("Agent model turns resolve through current Settings instead of startup env", () => {
    const sessionSrc = readFileSync(join(HERE, "runSession.js"), "utf8");
    const clientSrc = readFileSync(join(HERE, "apiClient.js"), "utf8");
    assert.match(sessionSrc, /api\.agentChat/);
    assert.doesNotMatch(sessionSrc, /new OpenAI\(/);
    assert.match(clientSrc, /agentChat:/);
    assert.match(clientSrc, /\/llm\/agent-chat/);
  });
});
