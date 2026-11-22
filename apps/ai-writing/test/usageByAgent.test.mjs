import assert from "node:assert/strict";
import test from "node:test";
import { usageActorNames, usageByAgent } from "../src/features/tokens/usageByAgent.ts";

test("historical usage gives roles with the same prefix their catalog names", () => {
  const name = usageActorNames([], [
    { botId: "prose.dialogue_voice", name: "台词个性化" },
    { botId: "prose.episode_body", name: "分集正文" },
  ]);
  assert.deepEqual(usageByAgent([
    { agentId: "prose.dialogue_voice", botId: "prose.dialogue_voice", promptTokens: 7, completionTokens: 3 },
    { agentId: "prose.episode_body", botId: "prose.episode_body", promptTokens: 4, completionTokens: 2 },
  ], name), [
    { format: "prose.dialogue_voice", label: "台词个性化", value: 10 },
    { format: "prose.episode_body", label: "分集正文", value: 6 },
  ]);
});

test("two colleagues with the same display name keep separate IDs and totals", () => {
  const name = usageActorNames([
    { id: "custom-a", name: "同名同事" },
    { id: "custom-b", name: "同名同事" },
  ]);
  assert.deepEqual(usageByAgent([
    { botId: "custom-a", promptTokens: 2, completionTokens: 1 },
    { botId: "custom-b", promptTokens: 4, completionTokens: 1 },
  ], name), [
    { format: "custom-b", label: "同名同事", value: 5 },
    { format: "custom-a", label: "同名同事", value: 3 },
  ]);
});

test("custom names come from the current roster and system actors stay identifiable", () => {
  const name = usageActorNames([
    { id: "custom-a", name: "新名称" },
  ], [
    { botId: "custom-a", name: "旧名称" },
    { botId: "eggbot", name: "蛋博士" },
  ]);
  assert.deepEqual(usageByAgent([
    { botId: "custom-a", promptTokens: 4, completionTokens: 1 },
    { botId: "eggbot", promptTokens: 3, completionTokens: 1 },
    { agentId: "run.digest", botId: "system:run.digest", promptTokens: 2, completionTokens: 1 },
  ], name), [
    { format: "custom-a", label: "新名称", value: 5 },
    { format: "eggbot", label: "蛋博士", value: 4 },
    { format: "system:run.digest", label: "system:run.digest", value: 3 },
  ]);
});

test("unknown and unattributed events preserve distinct identities and their token totals", () => {
  const name = usageActorNames([]);
  assert.deepEqual(usageByAgent([
    { agentId: "prose.retired", promptTokens: 8, completionTokens: 3 },
    { agentId: null, botId: "unattributed", promptTokens: 3, completionTokens: 2 },
    { agentId: null, botId: null, promptTokens: 1, completionTokens: 2 },
  ], name), [
    { format: "prose.retired", label: "prose.retired", value: 11 },
    { format: "unattributed", label: "未归属", value: 8 },
  ]);
});

test("legacy events normalized by the server add to the same canonical role", () => {
  const name = usageActorNames([], [
    { botId: "prose.dialogue_voice", name: "台词个性化" },
  ]);
  const normalizedLegacy = {
    agentId: "prose.dialogue_voice",
    botId: "prose.dialogue_voice",
    promptTokens: 2,
    completionTokens: 1,
  };
  assert.deepEqual(usageByAgent([
    normalizedLegacy,
    { agentId: "prose.dialogue_voice", botId: "prose.dialogue_voice", promptTokens: 7, completionTokens: 5 },
  ], name), [
    { format: "prose.dialogue_voice", label: "台词个性化", value: 15 },
  ]);
});
