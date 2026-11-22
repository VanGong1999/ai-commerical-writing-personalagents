import assert from "node:assert/strict";
import { test } from "node:test";
import { Type } from "@sinclair/typebox";
import {
  repairJsonString,
  parseToolArgs,
  toProviderSchema,
  coerceArgs,
  validateArgs,
  buildProviderTool,
  structuredError,
} from "../src/toolSchema.js";

test("repairJsonString 去围栏与尾逗号", () => {
  const raw = '```json\n{"a":1,}\n```';
  assert.equal(JSON.parse(repairJsonString(raw)).a, 1);
});

test("parseToolArgs 成功与失败", () => {
  assert.equal(parseToolArgs('{"x":1}').ok, true);
  assert.equal(parseToolArgs("not-json").ok, false);
  assert.equal(parseToolArgs({ a: 1 }).args.a, 1);
});

test("toProviderSchema 保证 object", () => {
  const schema = toProviderSchema(Type.Object({ type: Type.String() }));
  assert.equal(schema.type, "object");
  assert.ok(schema.properties?.type);
});

test("coerceArgs 路径与数组", () => {
  const schema = {
    type: "object",
    properties: {
      path: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      bodyJson: { type: "object" },
    },
  };
  const out = coerceArgs(
    { path: ".", tags: "a", bodyJson: '{"k":1}' },
    schema,
  );
  assert.equal(out.path, "/");
  assert.deepEqual(out.tags, ["a"]);
  assert.equal(out.bodyJson.k, 1);
});

test("validateArgs 缺必填", () => {
  const tb = Type.Object({ type: Type.String(), title: Type.String() });
  const r = validateArgs({ title: "x" }, tb);
  assert.equal(r.ok, false);
  assert.equal(r.error.error, "invalid_args");
});

test("buildProviderTool 带完整 parameters", () => {
  const t = buildProviderTool({
    name: "artifact_create",
    description: "create",
    parameters: Type.Object({
      type: Type.String(),
      title: Type.String(),
      bodyMarkdown: Type.String(),
    }),
  });
  assert.equal(t.function.name, "artifact_create");
  assert.ok(t.function.parameters.properties.type);
  assert.ok(t.function.parameters.required?.includes("type"));
});

test("structuredError 字段齐全", () => {
  const e = structuredError({
    error: "x",
    field: "f",
    expected: "e",
    example: "ex",
    retryable: false,
    next: "n",
  });
  assert.equal(e.isError, true);
  assert.equal(e.retryable, false);
});

test('JSON recovery preserves quoted punctuation and unwraps only one complete object', () => {
  assert.deepEqual(parseToolArgs('```json\n{"text":"keep ,} and ,]",}\n```').args, {text:'keep ,} and ,]'});
  assert.deepEqual(parseToolArgs('Here: {"x":1} done.').args, {x:1});
  assert.equal(parseToolArgs('{"x":1} {"y":2}').ok, false);
  for (const raw of ['{"text":"unfinished', '{"x":', '{"x":1', 'false', '']) assert.equal(parseToolArgs(raw).ok, false, raw);
});

test('plain JSON schema enforces nested types and constraints', () => {
  const schema = {type:'object', required:['payload'], properties:{payload:{type:'object',required:['count'],properties:{count:{type:'integer', minimum:1},kind:{enum:['a','b']}}}}};
  assert.equal(validateArgs({payload:{count:'bad'}},schema).ok,false);
  assert.equal(validateArgs({payload:{count:0}},schema).ok,false);
  assert.equal(validateArgs({payload:{count:1,kind:'c'}},schema).ok,false);
  assert.equal(validateArgs({payload:{count:1,kind:'a'}},schema).ok,true);
});
